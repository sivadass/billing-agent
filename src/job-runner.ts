import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BillingAdapter, BillResult } from './adapters/types.js';
import { getAdapter } from './adapters/registry.js';
import { withBrowser } from './browser.js';
import { createMistralCaptchaSolver, type CaptchaSolver } from './captcha.js';
import {
  resolveJobCredentials,
  resolveMistralApiKey,
  type AppConfig,
  type JobConfig,
} from './config.js';
import { AppError, ConfigError, ScrapeError } from './errors.js';
import { createLogger } from './logger.js';
import {
  formatFailureBody,
  formatSuccessBody,
  sendNtfy,
} from './notify.js';

export type RunnerDeps = {
  withBrowser: typeof withBrowser;
  sendNtfy: typeof sendNtfy;
  createMistralCaptchaSolver: typeof createMistralCaptchaSolver;
  getAdapter: (provider: string) => BillingAdapter;
  env: NodeJS.ProcessEnv;
};

const defaultDeps: RunnerDeps = {
  withBrowser,
  sendNtfy,
  createMistralCaptchaSolver,
  getAdapter,
  env: process.env,
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

export async function runJob(
  app: AppConfig,
  job: JobConfig,
  deps: Partial<RunnerDeps> = {},
): Promise<RunJobResult> {
  const runnerDeps = { ...defaultDeps, ...deps };
  const logger = createLogger(job.id);
  let screenshotPath: string | undefined;
  const startedAt = Date.now();
  logger.info('job start');

  try {
    const credentials = resolveJobCredentials(job, runnerDeps.env);

    const result = await runnerDeps.withBrowser(app.browser, async (page) => {
      try {
        const adapter = runnerDeps.getAdapter(job.provider);
        const captchaSolver = createLazyCaptchaSolver(runnerDeps, app.mistral);
        return await adapter.run({
          page,
          credentials,
          captchaSolver,
          timeoutMs: app.browser.timeoutMs,
          logger,
        });
      } catch (cause) {
        if (app.browser.saveErrorScreenshot) {
          const safeJobId = job.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          const candidatePath = path.join(
            'tmp',
            `${safeJobId}-${Date.now()}.png`,
          );
          try {
            await mkdir(path.dirname(candidatePath), { recursive: true });
            await page.screenshot({ path: candidatePath });
            screenshotPath = candidatePath;
          } catch (screenshotError) {
            logger.warn('error screenshot failed', {
              error: String(screenshotError),
            });
          }
        }
        throw cause;
      }
    });

    if (result.notify !== false) {
      await runnerDeps.sendNtfy({
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: job.notify.title,
        body: formatSuccessBody(result),
        priority: app.ntfy.priority,
      });
    }

    logger.info('job success', {
      durationMs: Date.now() - startedAt,
      ...(result.notify === false ? { notifySkipped: true } : {}),
    });

    return { ok: true, result };
  } catch (cause) {
    const error =
      cause instanceof AppError
        ? cause
        : new ScrapeError(
            cause instanceof Error ? cause.message : String(cause),
            { cause },
          );

    logger.error('job failed', {
      durationMs: Date.now() - startedAt,
      code: error.code,
      error: error.message,
    });

    try {
      await runnerDeps.sendNtfy({
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: `Billing agent failed: ${job.id}`,
        body: formatFailureBody(job.id, error, screenshotPath),
        priority: 'high',
      });
    } catch (notifyError) {
      logger.error('failure notification failed', {
        error: String(notifyError),
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
