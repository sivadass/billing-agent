#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { registerBuiltInAdapters } from './adapters/registry.js';
import { loadConfig } from './config.js';
import { runJobs } from './job-runner.js';

registerBuiltInAdapters();

const program = new Command();

program.name('billing-agent').description('Cron-friendly billing notifier');

program
  .command('run')
  .option('--config <path>', 'path to jobs.json', 'jobs.json')
  .option('--job <id>', 'run a single job id')
  .option('--all', 'run all enabled jobs')
  .action(async (options: { config: string; job?: string; all?: boolean }) => {
    if (!options.job && !options.all) {
      console.error('Specify --job <id> or --all');
      process.exitCode = 2;
      return;
    }

    const app = loadConfig({ configPath: options.config });
    const jobIds = options.all ? 'all' : [options.job as string];
    const { failed } = await runJobs(app, jobIds);
    process.exitCode = failed > 0 ? 1 : 0;
  });

await program.parseAsync(process.argv);
