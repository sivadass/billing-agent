import type { AppConfig, BillingStore, runJobs as runJobsFn } from '@billing-agent/core';

/**
 * Wires the `run` CLI command's store lifecycle and job execution. Extracted
 * from `cli.ts` so it can be unit tested without triggering that module's
 * top-level `program.parseAsync(process.argv)`.
 *
 * Passes `{ store }` into `runJobs` so adapter jobs whose secrets live in
 * Mongo (`job.secretIds`) can actually resolve them via `resolveJobSecrets`
 * instead of silently running with empty credentials.
 */
export type RunJobsCommandDeps = {
  connectStore: (uri: string) => Promise<BillingStore>;
  loadConfigFromStore: (store: BillingStore) => Promise<AppConfig>;
  runJobs: typeof runJobsFn;
};

export async function executeRunJobsCommand(
  mongoUri: string,
  jobIds: 'all' | string[],
  deps: RunJobsCommandDeps,
): Promise<{ failed: number }> {
  const store = await deps.connectStore(mongoUri);
  try {
    const app = await deps.loadConfigFromStore(store);
    return await deps.runJobs(app, jobIds, { store });
  } finally {
    await store.close();
  }
}
