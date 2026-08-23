import cron from 'node-cron';
import type { AppConfig, BillingStore, BrowserLock } from '@billing-agent/core';
import {
  ConfigError,
  createLogger,
  loadConfigFromStore,
  runJobs,
  type Logger,
} from '@billing-agent/core';

type CronScheduleOptions = {
  timezone: string;
};

type CronScheduler = {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    task: () => void,
    options?: CronScheduleOptions,
  ): {
    stop?: () => void;
    destroy?: () => void;
  };
};

export type SchedulerDeps = {
  cron: CronScheduler;
  runJobs: typeof runJobs;
  loadConfigFromStore: typeof loadConfigFromStore;
  logger: Logger;
  keepAlive: () => Promise<void>;
  store?: BillingStore;
  /** Shared with Run now and chat authoring; a held lock skips the tick rather than queueing it. */
  lock?: BrowserLock;
  pollIntervalMs: number;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
};

const defaultDeps: SchedulerDeps = {
  cron,
  runJobs,
  loadConfigFromStore,
  logger: createLogger(),
  keepAlive: () =>
    new Promise<void>(() => {
      // Keep the daemon process alive while cron tasks are registered.
    }),
  pollIntervalMs: 5_000,
  setIntervalFn: setInterval,
  clearIntervalFn: clearInterval,
};

export async function startDaemon(
  app: AppConfig,
  deps: Partial<SchedulerDeps> = {},
): Promise<void> {
  const schedulerDeps = { ...defaultDeps, ...deps };
  let activeApp = app;
  let activeJobsGeneration = app.jobsGeneration;
  let jobTasks: Array<{ stop?: () => void; destroy?: () => void }> = [];

  const scheduleJobs = (nextApp: AppConfig): Array<{ stop?: () => void; destroy?: () => void }> => {
    const tasks: Array<{ stop?: () => void; destroy?: () => void }> = [];
    for (const job of nextApp.jobs) {
      if (!job.enabled || !job.schedule) continue;
      if (!schedulerDeps.cron.validate(job.schedule)) {
        throw new ConfigError(
          `Invalid cron schedule for job ${job.id}: ${job.schedule}`,
        );
      }

      const task = schedulerDeps.cron.schedule(
        job.schedule,
        () => {
          // A cron tick is never queued: whoever has Chromium (Run now, another
          // scheduled job, a chat session) keeps it, and this job waits for its
          // next slot.
          const holder = schedulerDeps.lock?.current();
          if (holder) {
            schedulerDeps.logger.warn(
              'scheduled job skipped because the browser is busy',
              { jobId: job.id, heldBy: holder.kind },
            );
            return;
          }

          void schedulerDeps
            .runJobs(activeApp, [job.id], {
              ...(schedulerDeps.store ? { store: schedulerDeps.store } : {}),
              ...(schedulerDeps.lock ? { lock: schedulerDeps.lock } : {}),
            })
            .catch((error: unknown) => {
              schedulerDeps.logger.error('scheduled job failed', {
                jobId: job.id,
                error: String(error),
              });
            });
        },
        { timezone: 'Asia/Kolkata' },
      );
      tasks.push(task);
      schedulerDeps.logger.info('scheduled job', {
        jobId: job.id,
        schedule: job.schedule,
        timezone: 'Asia/Kolkata',
      });
    }
    return tasks;
  };

  const stopTasks = (
    tasks: Array<{ stop?: () => void; destroy?: () => void }>,
  ): void => {
    for (const task of tasks) {
      if (typeof task.stop === 'function') task.stop();
      if (typeof task.destroy === 'function') task.destroy();
    }
  };

  jobTasks = scheduleJobs(activeApp);

  const timer = schedulerDeps.store
    ? schedulerDeps.setIntervalFn(() => {
        void (async () => {
          try {
            const settings = await schedulerDeps.store?.getSettings();
            if (!settings) return;
            if (settings.jobsGeneration !== activeJobsGeneration) {
              const refreshed = await schedulerDeps.loadConfigFromStore(
                schedulerDeps.store as BillingStore,
              );
              stopTasks(jobTasks);
              activeApp = refreshed;
              activeJobsGeneration = refreshed.jobsGeneration;
              jobTasks = scheduleJobs(activeApp);
              schedulerDeps.logger.info('scheduler jobs reloaded', {
                jobsGeneration: activeJobsGeneration,
              });
            }
          } catch (error) {
            schedulerDeps.logger.error('scheduler reload failed', {
              error: String(error),
            });
          }
        })();
      }, schedulerDeps.pollIntervalMs)
    : null;

  try {
    schedulerDeps.logger.info('daemon running');
    await schedulerDeps.keepAlive();
  } finally {
    if (timer !== null) {
      schedulerDeps.clearIntervalFn(timer);
    }
    stopTasks(jobTasks);
  }
}
