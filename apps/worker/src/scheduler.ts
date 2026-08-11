import cron from 'node-cron';
import type { AppConfig, BillingStore } from '@billing-agent/core';
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
  let activeGeneration = app.jobsGeneration;
  let scheduledTasks: Array<{ stop?: () => void; destroy?: () => void }> = [];

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
          void schedulerDeps
            .runJobs(activeApp, [job.id], schedulerDeps.store ? { store: schedulerDeps.store } : {})
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

  const stopTasks = (): void => {
    for (const task of scheduledTasks) {
      if (typeof task.stop === 'function') task.stop();
      if (typeof task.destroy === 'function') task.destroy();
    }
    scheduledTasks = [];
  };

  scheduledTasks = scheduleJobs(activeApp);

  const timer = schedulerDeps.store
    ? schedulerDeps.setIntervalFn(() => {
        void (async () => {
          try {
            const settings = await schedulerDeps.store?.getSettings();
            if (!settings || settings.jobsGeneration === activeGeneration) return;
            const refreshed = await schedulerDeps.loadConfigFromStore(
              schedulerDeps.store as BillingStore,
            );
            stopTasks();
            activeApp = refreshed;
            activeGeneration = refreshed.jobsGeneration;
            scheduledTasks = scheduleJobs(activeApp);
            schedulerDeps.logger.info('scheduler jobs reloaded', {
              jobsGeneration: activeGeneration,
            });
          } catch (error) {
            schedulerDeps.logger.error('scheduler reload failed', {
              error: String(error),
            });
          }
        });
      }, schedulerDeps.pollIntervalMs)
    : null;

  try {
    schedulerDeps.logger.info('daemon running');
    await schedulerDeps.keepAlive();
  } finally {
    if (timer !== null) {
      schedulerDeps.clearIntervalFn(timer);
    }
    stopTasks();
  }
}
