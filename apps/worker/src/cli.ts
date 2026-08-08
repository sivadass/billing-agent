#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import {
  AppError,
  ConfigError,
  connectStore,
  loadConfigFromStore,
  loadSeedConfig,
  registerBuiltInAdapters,
  runJobs,
} from '@billing-agent/core';
import { startDaemon } from './scheduler.js';

registerBuiltInAdapters();

const program = new Command();

program.name('billing-agent').description('Cron-friendly billing notifier');

/**
 * Runs a CLI action, printing AppError (config/usage/runtime) failures as a
 * plain message with exit code 2 instead of an unhandled-rejection stack trace.
 */
function withErrorHandling<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await action(...args);
    } catch (error) {
      if (error instanceof AppError) {
        console.error(error.message);
        process.exitCode = 2;
        return;
      }
      throw error;
    }
  };
}

function requireMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri = env.MONGODB_URI;
  if (!uri) {
    throw new ConfigError('Missing environment variable: MONGODB_URI');
  }
  return uri;
}

program
  .command('run')
  .option('--job <id>', 'run a single job id')
  .option('--all', 'run all enabled jobs')
  .action(
    withErrorHandling(async (options: { job?: string; all?: boolean }) => {
      if (!options.job && !options.all) {
        console.error('Specify --job <id> or --all');
        process.exitCode = 2;
        return;
      }

      const store = await connectStore(requireMongoUri());
      try {
        const app = await loadConfigFromStore(store);
        const jobIds = options.all ? 'all' : [options.job as string];
        const { failed } = await runJobs(app, jobIds);
        process.exitCode = failed > 0 ? 1 : 0;
      } finally {
        await store.close();
      }
    }),
  );

program
  .command('daemon')
  .action(withErrorHandling(async () => {
    const store = await connectStore(requireMongoUri());
    const app = await loadConfigFromStore(store);
    await startDaemon(app);
  }));

program
  .command('seed-jobs')
  .requiredOption('--from <path>', 'path to jobs seed json')
  .action(
    withErrorHandling(async (options: { from: string }) => {
      const seed = loadSeedConfig({ configPath: options.from });
      const store = await connectStore(requireMongoUri());
      try {
        await store.upsertSettings(seed.settings);
        for (const job of seed.jobs) {
          await store.upsertJob(job);
        }
      } finally {
        await store.close();
      }
    }),
  );

await program.parseAsync(process.argv);
