import { randomUUID } from 'node:crypto';
import { encryptSecret, parseMasterKey } from './secrets.js';
import type { BillingStore } from './store/types.js';

export async function migrateJobSecrets(input: {
  store: BillingStore;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const { store, env } = input;
  const jobs = await store.listJobs();
  let masterKey: Buffer | undefined;

  for (const job of jobs) {
    const credentialsEnv = job.credentialsEnv;
    if (!credentialsEnv || Object.keys(credentialsEnv).length === 0) {
      continue;
    }

    const existingSecrets = await store.listSecrets(job.id);
    const existingKeys = new Set(existingSecrets.map((secret) => secret.key));
    const now = new Date().toISOString();

    for (const [field, envName] of Object.entries(credentialsEnv)) {
      const value = env[envName];
      if (!value || existingKeys.has(field)) {
        continue;
      }

      if (!masterKey) {
        masterKey = parseMasterKey(env);
      }

      const encrypted = encryptSecret(value, masterKey);
      await store.upsertSecret({
        id: randomUUID(),
        userId: job.userId,
        jobId: job.id,
        key: field,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        createdAt: now,
        updatedAt: now,
      });
      existingKeys.add(field);
    }

    await store.unsetJobCredentialsEnv(job.id);
  }
}
