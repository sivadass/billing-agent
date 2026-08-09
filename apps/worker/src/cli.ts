#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import {
  AppError,
  ConfigError,
  connectStore,
  hashPassword,
  loadConfigFromStore,
  loadSeedConfig,
  registerBuiltInAdapters,
  runJob,
  runJobs,
} from '@billing-agent/core';
import { parseCorsOrigins, startServer } from '@billing-agent/api';
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

function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new ConfigError('Missing environment variable: JWT_SECRET');
  }
  return secret;
}

function resolveHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HTTP_PORT ?? '8080';
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError('HTTP_PORT must be a positive integer');
  }
  return port;
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
    const server = await startServer({
      port: resolveHttpPort(),
      jwtSecret: requireJwtSecret(),
      store,
      corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
      onRunJob: async (jobId: string) => {
        const latest = await loadConfigFromStore(store);
        const job = latest.jobs.find((item) => item.id === jobId);
        if (!job) {
          throw new ConfigError(`Unknown job id: ${jobId}`);
        }

        return await new Promise<string>((resolve, reject) => {
          let reported = false;
          void runJob(latest, job, {
            store,
            onRunCreated: (runId) => {
              reported = true;
              resolve(runId);
            },
          }).catch((error: unknown) => {
            if (!reported) {
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            console.error(
              `[daemon] run for ${jobId} failed after start:`,
              error instanceof Error ? error.message : error,
            );
          });
        });
      },
    });

    try {
      await startDaemon(app, { store });
    } finally {
      await server.close();
      await store.close();
    }
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

program
  .command('hash-password')
  .argument('<password>')
  .action(async (password: string) => {
    const hash = await hashPassword(password);
    process.stdout.write(`${hash}\n`);
  });

program
  .command('migrate-job-owners')
  .requiredOption('--email <email>', 'email of the user to own orphaned jobs/runs')
  .action(
    withErrorHandling(async (options: { email: string }) => {
      const store = await connectStore(requireMongoUri());
      try {
        const user = await store.findUserByEmail(options.email);
        if (!user) {
          console.error(`No user found for email: ${options.email}`);
          process.exitCode = 1;
          return;
        }

        const jobs = await store.listJobs();
        const orphanJobs = jobs.filter((job) => !job.userId);
        for (const job of orphanJobs) {
          await store.upsertJob({ ...job, userId: user.id });
        }

        const runs = await store.listRuns();
        const orphanRuns = runs.filter((run) => !run.userId);
        for (const run of orphanRuns) {
          await store.finishRun(run.id, { userId: user.id });
        }

        console.log(
          `Assigned ${orphanJobs.length} job(s) and ${orphanRuns.length} run(s) to ${user.email}`,
        );
      } finally {
        await store.close();
      }
    }),
  );

await program.parseAsync(process.argv);
