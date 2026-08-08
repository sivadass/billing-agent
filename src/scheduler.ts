import cron from 'node-cron';
import type { AppConfig } from './config.js';
import { ConfigError } from './errors.js';
import { runJobs } from './job-runner.js';
import { createLogger, type Logger } from './logger.js';

type CronScheduler = {
  validate(expression: string): boolean;
  schedule(expression: string, task: () => void): unknown;
};

export type SchedulerDeps = {
  cron: CronScheduler;
  runJobs: typeof runJobs;
  logger: Logger;
  keepAlive: () => Promise<void>;
};

const defaultDeps: SchedulerDeps = {
  cron,
  runJobs,
  logger: createLogger(),
  keepAlive: () =>
    new Promise<void>(() => {
      // Keep the daemon process alive while cron tasks are registered.
    }),
};

export async function startDaemon(
  app: AppConfig,
  deps: Partial<SchedulerDeps> = {},
): Promise<void> {
  const schedulerDeps = { ...defaultDeps, ...deps };

  for (const job of app.jobs) {
    if (!job.enabled || !job.schedule) continue;
    if (!schedulerDeps.cron.validate(job.schedule)) {
      throw new ConfigError(
        `Invalid cron schedule for job ${job.id}: ${job.schedule}`,
      );
    }

    schedulerDeps.cron.schedule(job.schedule, () => {
      void schedulerDeps.runJobs(app, [job.id]).catch((error: unknown) => {
        schedulerDeps.logger.error('scheduled job failed', {
          jobId: job.id,
          error: String(error),
        });
      });
    });
    schedulerDeps.logger.info('scheduled job', {
      jobId: job.id,
      schedule: job.schedule,
    });
  }

  schedulerDeps.logger.info('daemon running');
  await schedulerDeps.keepAlive();
}
