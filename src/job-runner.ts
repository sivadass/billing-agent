import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { BillingAdapter, BillResult } from './adapters/types.js';
import { getAdapter } from './adapters/registry.js';
import { withBrowser } from './browser.js';
import { createMistralCaptchaSolver } from './captcha.js';
import type { AppConfig, JobConfig } from './config.js';
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
};

const defaultDeps: RunnerDeps = {
  withBrowser,
  sendNtfy,
  createMistralCaptchaSolver,
  getAdapter,
};

export type RunJobResult =
  | { ok: true; result: BillResult }
  | { ok: false; error: AppError };

export async function runJob(
  app: AppConfig,
  job: JobConfig,
  deps: Partial<RunnerDeps> = {},
): Promise<RunJobResult> {
  const runnerDeps = { ...defaultDeps, ...deps };
  const logger = createLogger(job.id);
  let screenshotPath: string | undefined;
  logger.info('job start');

  try {
    const result = await runnerDeps.withBrowser(app.browser, async (page) => {
      try {
        const adapter = runnerDeps.getAdapter(job.provider);
        const captchaSolver = runnerDeps.createMistralCaptchaSolver(app.mistral);
        return await adapter.run({
          page,
          credentials: job.credentials,
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

    await runnerDeps.sendNtfy({
      baseUrl: app.ntfy.baseUrl,
      topic: app.ntfy.topic,
      title: job.notify.title,
      body: formatSuccessBody(result),
      priority: 'default',
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
