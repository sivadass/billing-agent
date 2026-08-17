import cron from 'node-cron';
import type {
  AppConfig,
  BillingStore,
  BrowserLock,
  WatchDocument,
} from '@billing-agent/core';
import {
  ConfigError,
  createLogger,
  loadConfigFromStore,
  runJobs,
  sendNtfy,
  withBrowser,
  type Logger,
} from '@billing-agent/core';
import { isWatchLocked, runWatch } from '@billing-agent/price-monitor';

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

const DEFAULT_WATCH_SCHEDULE = '0 9 * * *';

export type SchedulerDeps = {
  cron: CronScheduler;
  runJobs: typeof runJobs;
  runWatch: typeof runWatch;
  isWatchLocked: typeof isWatchLocked;
  withBrowser: typeof withBrowser;
  sendNtfy: typeof sendNtfy;
  loadConfigFromStore: typeof loadConfigFromStore;
  logger: Logger;
  keepAlive: () => Promise<void>;
  store?: BillingStore;
  /** Shared with Run now and chat authoring; a held lock skips the tick rather than queueing it. */
  lock?: BrowserLock;
  pollIntervalMs: number;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  env: NodeJS.ProcessEnv;
};

const defaultDeps: SchedulerDeps = {
  cron,
  runJobs,
  runWatch,
  isWatchLocked,
  withBrowser,
  sendNtfy,
  loadConfigFromStore,
  logger: createLogger(),
  keepAlive: () =>
    new Promise<void>(() => {
      // Keep the daemon process alive while cron tasks are registered.
    }),
  pollIntervalMs: 5_000,
  setIntervalFn: setInterval,
  clearIntervalFn: clearInterval,
  env: process.env,
};

export async function startDaemon(
  app: AppConfig,
  deps: Partial<SchedulerDeps> = {},
): Promise<void> {
  const schedulerDeps = { ...defaultDeps, ...deps };
  let activeApp = app;
  let activeJobsGeneration = app.jobsGeneration;
  let activeWatchesGeneration = 0;
  let jobTasks: Array<{ stop?: () => void; destroy?: () => void }> = [];
  let watchTasks: Array<{ stop?: () => void; destroy?: () => void }> = [];

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

  const scheduleWatches = (
    watches: WatchDocument[],
  ): Array<{ stop?: () => void; destroy?: () => void }> => {
    if (!schedulerDeps.store) return [];
    const tasks: Array<{ stop?: () => void; destroy?: () => void }> = [];
    for (const watch of watches) {
      if (!watch.enabled) continue;
      const schedule = watch.schedule ?? DEFAULT_WATCH_SCHEDULE;
      if (!schedulerDeps.cron.validate(schedule)) {
        throw new ConfigError(
          `Invalid cron schedule for watch ${watch.id}: ${schedule}`,
        );
      }

      const task = schedulerDeps.cron.schedule(
        schedule,
        () => {
          if (schedulerDeps.isWatchLocked(watch.id)) {
            schedulerDeps.logger.warn('scheduled watch skipped because it is already running', {
              watchId: watch.id,
            });
            return;
          }
          const mistralApiKey = schedulerDeps.env[activeApp.mistral.apiKeyEnv];
          void schedulerDeps
            .runWatch({
              watch,
              store: schedulerDeps.store as BillingStore,
              sendNtfy: schedulerDeps.sendNtfy,
              ntfy: {
                baseUrl: activeApp.ntfy.baseUrl,
                topic: activeApp.ntfy.topic,
                priority: activeApp.ntfy.priority,
              },
              browserLoadHtml: async (url: string) =>
                schedulerDeps.withBrowser(activeApp.browser, async (page) => {
                  await page.goto(url, { waitUntil: 'domcontentloaded' });
                  return page.content();
                }),
              mistralApiKey,
              mistralModel: activeApp.mistral.model,
            })
            .catch((error: unknown) => {
              schedulerDeps.logger.error('scheduled watch failed', {
                watchId: watch.id,
                error: String(error),
              });
            });
        },
        { timezone: 'Asia/Kolkata' },
      );
      tasks.push(task);
      schedulerDeps.logger.info('scheduled watch', {
        watchId: watch.id,
        schedule,
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

  if (schedulerDeps.store) {
    const initialSettings = await schedulerDeps.store.getSettings();
    activeWatchesGeneration = initialSettings.watchesGeneration ?? 0;
    watchTasks = scheduleWatches(await schedulerDeps.store.listWatches());
  }
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
            if ((settings.watchesGeneration ?? 0) !== activeWatchesGeneration) {
              const store = schedulerDeps.store;
              if (!store) return;
              stopTasks(watchTasks);
              watchTasks = scheduleWatches(await store.listWatches());
              activeWatchesGeneration = settings.watchesGeneration ?? 0;
              schedulerDeps.logger.info('scheduler watches reloaded', {
                watchesGeneration: activeWatchesGeneration,
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
    stopTasks(watchTasks);
  }
}
