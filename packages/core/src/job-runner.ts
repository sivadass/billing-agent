import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Mistral } from '@mistralai/mistralai';
import type { BillingAdapter, BillResult } from './adapters/types.js';
import { getAdapter } from './adapters/registry.js';
import { withBrowser } from './browser.js';
import { createMistralCaptchaSolver, type CaptchaSolver } from './captcha.js';
import {
  resolveJobSecrets,
  resolveMistralApiKey,
  type AppConfig,
  type JobConfig,
} from './config.js';
import {
  AppError,
  ConfigError,
  LoginError,
  ScrapeError,
  TimeoutError,
} from './errors.js';
import { createLogger } from './logger.js';
import {
  formatFailureBody,
  formatSuccessBody,
  dispatchNotify,
  sendNtfy,
} from './notify.js';
import { decideNotify } from './compare.js';
import { tnpdclOverlayKeys, fingerprintFailure } from './overlay.js';
import {
  extractCompactDom,
  proposeOverlayPatch as proposeOverlayPatchWithDeps,
} from './recovery.js';
import type { BillingStore, RunDocument } from './store/types.js';

export type RunnerDeps = {
  withBrowser: typeof withBrowser;
  sendNtfy: typeof sendNtfy;
  dispatchNotify: typeof dispatchNotify;
  createMistralCaptchaSolver: typeof createMistralCaptchaSolver;
  getAdapter: (provider: string) => BillingAdapter;
  env: NodeJS.ProcessEnv;
  store?: BillingStore;
  onRunCreated?: (runId: string) => void;
  proposeOverlayPatch: (
    input: Parameters<typeof proposeOverlayPatchWithDeps>[0],
  ) => Promise<Awaited<ReturnType<typeof proposeOverlayPatchWithDeps>>>;
  extractCompactDom: typeof extractCompactDom;
};

const defaultDeps: RunnerDeps = {
  withBrowser,
  sendNtfy,
  dispatchNotify,
  createMistralCaptchaSolver,
  getAdapter,
  env: process.env,
  proposeOverlayPatch: async () => {
    throw new ConfigError('Recovery proposer not configured');
  },
  extractCompactDom,
};

export type RunJobResult =
  | { ok: true; result: BillResult }
  | { ok: false; error: AppError };

/**
 * Wraps captcha solver creation so the Mistral API key is only resolved (and
 * the client only constructed) the first time a captcha actually needs
 * solving. Adapters like `dummy` that never solve a captcha never touch
 * MISTRAL_API_KEY.
 */
function createLazyCaptchaSolver(
  runnerDeps: RunnerDeps,
  mistral: AppConfig['mistral'],
): CaptchaSolver {
  let solver: CaptchaSolver | undefined;
  return {
    async solveFromImageBase64(base64Png: string): Promise<string> {
      if (!solver) {
        const apiKey = resolveMistralApiKey(mistral, runnerDeps.env);
        solver = runnerDeps.createMistralCaptchaSolver({
          apiKey,
          model: mistral.model,
        });
      }
      return solver.solveFromImageBase64(base64Png);
    },
  };
}

function extractModelText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        'text' in part &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('');
}

function createRecoveryPatchProposer(
  app: AppConfig,
  runnerDeps: RunnerDeps,
): RunnerDeps['proposeOverlayPatch'] {
  return async (input) => {
    const apiKey = resolveMistralApiKey(app.mistral, runnerDeps.env);
    const mistral = new Mistral({ apiKey });
    return proposeOverlayPatchWithDeps(input, {
      completeJson: async ({ system, user, imageBase64 }) => {
        const response = await mistral.chat.complete({
          model: app.mistral.model,
          messages: [
            { role: 'system', content: system },
            imageBase64
              ? {
                  role: 'user',
                  content: [
                    { type: 'text', text: user },
                    {
                      type: 'image_url',
                      imageUrl: `data:image/png;base64,${imageBase64}`,
                    },
                  ],
                }
              : { role: 'user', content: user },
          ],
        });
        return extractModelText(response.choices[0]?.message?.content);
      },
    });
  };
}

function toAppError(cause: unknown): AppError {
  return cause instanceof AppError
    ? cause
    : new ScrapeError(cause instanceof Error ? cause.message : String(cause), {
        cause,
      });
}

function isRecoverableError(error: AppError): boolean {
  return (
    error instanceof LoginError ||
    error instanceof ScrapeError ||
    error instanceof TimeoutError
  );
}

/** Maps an adapter's `BillResult` onto the generic `RunDocument.result` shape. Never includes `provider` or `notify`. */
export function billResultToRecord(result: BillResult): Record<string, unknown> {
  const record: Record<string, unknown> = {
    amount: result.amount,
    accountLabel: result.accountLabel,
  };
  if (result.dueDate) record.dueDate = result.dueDate;
  if (result.billPeriod) record.billPeriod = result.billPeriod;
  if (result.status) record.status = result.status;
  if (result.rawNotes) record.rawNotes = result.rawNotes;
  return record;
}

function jobAdapterId(job: JobConfig): string {
  const legacyProvider = (job as JobConfig & { provider?: string }).provider;
  const adapterId = job.adapterId ?? legacyProvider;
  if (!adapterId) {
    throw new ConfigError(`Job ${job.id} is missing adapterId`);
  }
  return adapterId;
}

function projectLastResult(
  result: Record<string, unknown>,
  schema: JobConfig['schema'],
): Record<string, string | number> {
  const projected: Record<string, string | number> = {};
  for (const field of schema) {
    const value = result[field.key];
    if (typeof value === 'string' || typeof value === 'number') {
      projected[field.key] = value;
    }
  }
  return projected;
}

async function sendJobNotification(input: {
  app: AppConfig;
  job: JobConfig;
  runId: string;
  status: 'success' | 'failed';
  result: Record<string, unknown> | null;
  adapterNotify?: boolean;
  error?: AppError;
  screenshotPath?: string;
  dispatchNotifyImpl?: typeof dispatchNotify;
}): Promise<void> {
  const decision = decideNotify({
    on: input.job.notify.on,
    status: input.status,
    result: input.result,
    lastResult: input.job.lastResult,
    schema: input.job.schema,
    adapterNotify: input.adapterNotify,
  });

  if (input.status === 'success' && decision !== 'send_success') {
    return;
  }
  if (input.status === 'failed' && decision !== 'send_failure') {
    return;
  }

  const title =
    input.status === 'failed'
      ? `${input.job.notify.title} failed`
      : input.job.notify.title;
  const body =
    input.status === 'failed' && input.error
      ? formatFailureBody(input.job.id, input.error, input.screenshotPath)
      : formatSuccessBody(input.result ?? {}, input.job.schema);

  const channel =
    input.job.notify.channel.type === 'ntfy' && !input.job.notify.channel.topic
      ? { ...input.job.notify.channel, topic: input.app.ntfy.topic }
      : input.job.notify.channel;

  await (input.dispatchNotifyImpl ?? dispatchNotify)({
    channel,
    defaultNtfy: {
      baseUrl: input.app.ntfy.baseUrl,
      priority: input.app.ntfy.priority,
    },
    title,
    body,
    priority: input.status === 'failed' ? 'high' : input.app.ntfy.priority,
    webhookPayload: {
      jobId: input.job.id,
      runId: input.runId,
      status: input.status,
      result: input.status === 'success' ? input.result : null,
      error:
        input.status === 'failed' && input.error
          ? { code: input.error.code, message: input.error.message }
          : null,
    },
  });
}

async function captureScreenshot(
  app: AppConfig,
  job: JobConfig,
  logger: ReturnType<typeof createLogger>,
  page: {
    screenshot: (options: { path: string }) => Promise<Buffer | Uint8Array | void>;
  },
): Promise<{ path?: string; base64?: string }> {
  if (!app.browser.saveErrorScreenshot) return {};
  const safeJobId = job.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const candidatePath = path.join('tmp', `${safeJobId}-${Date.now()}.png`);
  try {
    await mkdir(path.dirname(candidatePath), { recursive: true });
    const png = await page.screenshot({ path: candidatePath });
    const base64 = Buffer.isBuffer(png)
      ? png.toString('base64')
      : png instanceof Uint8Array
        ? Buffer.from(png).toString('base64')
        : undefined;
    return { path: candidatePath, base64 };
  } catch (screenshotError) {
    logger.warn('error screenshot failed', {
      error: String(screenshotError),
    });
    return {};
  }
}

export async function runJob(
  app: AppConfig,
  job: JobConfig,
  deps: Partial<RunnerDeps> = {},
): Promise<RunJobResult> {
  const runnerDeps = { ...defaultDeps, ...deps };
  const logger = createLogger(job.id);
  let screenshotPath: string | undefined;
  let screenshotBase64: string | undefined;
  const startedAt = Date.now();
  const runId = randomUUID();
  let recoveryAttempted = false;
  let recoverySucceeded = false;
  let overlayActivated = false;
  logger.info('job start');

  const adapterId = jobAdapterId(job);

  if (runnerDeps.store) {
    await runnerDeps.store.createRun({
      id: runId,
      jobId: job.id,
      userId: job.userId,
      engine: job.engine,
      adapterId,
      status: 'running',
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      screenshotPath: null,
      recoveryAttempted: false,
      recoverySucceeded: false,
      overlayActivated: false,
      result: null,
    });
  }
  runnerDeps.onRunCreated?.(runId);

  try {
    const secrets = runnerDeps.store
      ? await resolveJobSecrets(job, runnerDeps.store, runnerDeps.env)
      : {};
    const proposePatch =
      deps.proposeOverlayPatch ?? createRecoveryPatchProposer(app, runnerDeps);

    const result = await runnerDeps.withBrowser(app.browser, async (page) => {
      const adapter = runnerDeps.getAdapter(adapterId);
      const captchaSolver = createLazyCaptchaSolver(runnerDeps, app.mistral);

      const activeOverlay = runnerDeps.store
        ? (
            await runnerDeps.store.listActiveOverlays({
              provider: adapterId,
              jobId: job.id,
            })
          )[0]?.patch
        : undefined;

      const runAdapter = (overlay = activeOverlay) =>
        adapter.run({
          page,
          credentials: secrets,
          captchaSolver,
          timeoutMs: app.browser.timeoutMs,
          logger,
          overlay,
        });

      try {
        return await runAdapter();
      } catch (cause) {
        const screenshot = await captureScreenshot(app, job, logger, page);
        screenshotPath = screenshot.path;
        screenshotBase64 = screenshot.base64;
        const error = toAppError(cause);
        if (
          !runnerDeps.store ||
          !isRecoverableError(error)
        ) {
          throw error;
        }

        recoveryAttempted = true;
        let urlPath: string | undefined;
        try {
          urlPath = new URL(page.url()).pathname;
        } catch {
          urlPath = undefined;
        }

        let title: string | undefined;
        try {
          title = await page.title();
        } catch {
          title = undefined;
        }

        const fingerprint = fingerprintFailure({
          code: error.code,
          urlPath,
          title,
        });

        const compactDom = await runnerDeps.extractCompactDom(page);
        const patch = await proposePatch({
          errorMessage: error.message,
          screenshotBase64,
          compactDom,
          allowedKeys: tnpdclOverlayKeys,
        });

        const retryResult = await runAdapter(patch);
        const overlay = await runnerDeps.store.recordOverlaySuccess({
          provider: adapterId,
          jobId: job.id,
          fingerprint,
          patch,
        });
        recoverySucceeded = true;
        overlayActivated = overlay.status === 'active' && overlay.successCount >= 3;
        return retryResult;
      }
    });

    const record = billResultToRecord(result);

    if (result.notify !== false) {
      const shouldNotifySuccess =
        decideNotify({
          on: job.notify.on,
          status: 'success',
          result: record,
          lastResult: job.lastResult,
          schema: job.schema,
        }) === 'send_success';

      if (shouldNotifySuccess) {
        await sendJobNotification({
          app,
          job,
          runId,
          status: 'success',
          result: record,
          dispatchNotifyImpl: runnerDeps.dispatchNotify,
        });
      } else {
        logger.info('notify skipped', { reason: job.notify.on });
      }
    } else {
      logger.info('notify skipped', { reason: 'adapter notify false' });
    }

    if (runnerDeps.store) {
      await runnerDeps.store.upsertJob({
        ...job,
        lastResult: projectLastResult(record, job.schema),
        updatedAt: new Date().toISOString(),
      });
    }

    logger.info('job success', {
      durationMs: Date.now() - startedAt,
      ...(result.notify === false ? { notifySkipped: true } : {}),
    });

    if (runnerDeps.store) {
      await runnerDeps.store.finishRun(runId, {
        status: 'success',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        errorCode: null,
        errorMessage: null,
        screenshotPath: screenshotPath ?? null,
        recoveryAttempted,
        recoverySucceeded,
        overlayActivated,
        result: record,
      });
    }

    return { ok: true, result };
  } catch (cause) {
    const error = toAppError(cause);

    logger.error('job failed', {
      durationMs: Date.now() - startedAt,
      code: error.code,
      error: error.message,
    });

    try {
      await sendJobNotification({
        app,
        job,
        runId,
        status: 'failed',
        result: null,
        error,
        screenshotPath,
        dispatchNotifyImpl: runnerDeps.dispatchNotify,
      });
    } catch (notifyError) {
      logger.error('failure notification failed', {
        error: String(notifyError),
      });
    }

    if (runnerDeps.store) {
      await runnerDeps.store.finishRun(runId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        errorCode: error.code,
        errorMessage: error.message,
        screenshotPath: screenshotPath ?? null,
        recoveryAttempted,
        recoverySucceeded,
        overlayActivated,
        result: null,
      });
    }

    return { ok: false, error };
  }
}

export async function runJobs(
  app: AppConfig,
  jobIds: 'all' | string[],
  deps: Partial<RunnerDeps> = {},
): Promise<{ failed: number }> {
  const selectedJobs =
    jobIds === 'all'
      ? app.jobs.filter((job) => job.enabled)
      : jobIds.map((jobId) => {
          const job = app.jobs.find((candidate) => candidate.id === jobId);
          if (!job) throw new ConfigError(`Unknown job id: ${jobId}`);
          return job;
        });
  let failed = 0;

  for (const job of selectedJobs) {
    const result = await runJob(app, job, deps);
    if (!result.ok) failed += 1;
  }

  return { failed };
}
