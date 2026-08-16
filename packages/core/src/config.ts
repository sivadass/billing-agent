import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors.js';
import type { BillingStore, JobDocument, SettingsDocument } from './store/types.js';
import { assertJobDocument } from './store/assert-job.js';
import { decryptSecret, parseMasterKey } from './secrets.js';

export type BrowserConfig = SettingsDocument['browser'];
export type JobConfig = JobDocument;

export type ResolvedNtfy = {
  baseUrl: string;
  topic: string;
  priority: string;
};

export type MistralConfig = SettingsDocument['mistral'];

export type AppConfig = {
  configPath: string;
  ntfy: ResolvedNtfy;
  mistral: MistralConfig;
  browser: BrowserConfig;
  jobs: JobConfig[];
  jobsGeneration: number;
};

type JsonObject = Record<string, unknown>;
type SeedSettings = Omit<SettingsDocument, 'id'>;
export type SeedConfig = {
  configPath: string;
  settings: SeedSettings;
  jobs: JobConfig[];
};

function requireObject(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${name} must be an object`);
  }
  return value as JsonObject;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ConfigError(`${name} must be a boolean`);
  }
  return value;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${name} must be a finite number`);
  }
  return value;
}

/** Owner userId is optional in seed JSON; unset/empty means orphaned until `migrate-job-owners` assigns it. */
function optionalOwnerString(value: unknown, name: string): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new ConfigError(`${name} must be a string`);
  }
  return value;
}

function resolveEnv(env: NodeJS.ProcessEnv, envName: unknown, field: string): string {
  const name = requireString(envName, field);
  const value = env[name];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing environment variable: ${name}`);
  }
  return value;
}

function resolveNtfyTopic(
  ntfy: SeedSettings['ntfy'],
  env: NodeJS.ProcessEnv,
): string {
  if (ntfy.topicEnv) {
    return resolveEnv(env, ntfy.topicEnv, 'ntfy.topicEnv');
  }
  if (ntfy.defaultTopic) {
    return ntfy.defaultTopic;
  }
  const fromEnv = env.NTFY_TOPIC;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  throw new ConfigError('Missing ntfy topic: set ntfy.topicEnv, ntfy.defaultTopic, or NTFY_TOPIC');
}

/**
 * Resolves a job's secrets from encrypted Mongo documents. Called lazily by
 * the job runner, not at config load time. Never logs plaintext or
 * ciphertext; decryption happens in-memory only for the duration of the run.
 */
export async function resolveJobSecrets(
  job: JobDocument,
  store: BillingStore,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  if (job.secretIds.length === 0) {
    return {};
  }

  const key = parseMasterKey(env);
  const secretDocs = await store.listSecrets({
    userId: job.userId,
    jobId: job.id,
  });

  const secrets: Record<string, string> = {};
  for (const doc of secretDocs) {
    if (!job.secretIds.includes(doc.id)) continue;
    secrets[doc.key] = decryptSecret(doc, key);
  }
  return secrets;
}

/** Resolves the Mistral API key from the environment. Called lazily, only when a captcha actually needs solving. */
export function resolveMistralApiKey(
  mistral: MistralConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveEnv(env, mistral.apiKeyEnv, 'mistral.apiKeyEnv');
}

function parseBrowserConfig(browser: JsonObject): BrowserConfig {
  const timeoutMs = browser.timeoutMs ?? 60_000;
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new ConfigError('browser.timeoutMs must be a positive number');
  }

  const noSandbox = browser.noSandbox;
  if (noSandbox !== undefined && typeof noSandbox !== 'boolean') {
    throw new ConfigError('browser.noSandbox must be a boolean');
  }

  return {
    headless:
      browser.headless === undefined
        ? true
        : requireBoolean(browser.headless, 'browser.headless'),
    timeoutMs,
    saveErrorScreenshot:
      browser.saveErrorScreenshot === undefined
        ? true
        : requireBoolean(
            browser.saveErrorScreenshot,
            'browser.saveErrorScreenshot',
          ),
    ...(noSandbox === undefined ? {} : { noSandbox }),
  };
}

function parseLegacySeedJob(value: unknown, index: number): JobDocument {
  const job = requireObject(value, `jobs[${index}]`);
  const schedule = job.schedule;
  if (schedule !== null && typeof schedule !== 'string') {
    throw new ConfigError(`jobs[${index}].schedule must be a string or null`);
  }

  const notify = requireObject(job.notify, `jobs[${index}].notify`);
  const title = requireString(notify.title, `jobs[${index}].notify.title`);
  const id = requireString(job.id, `jobs[${index}].id`);
  const provider = requireString(job.provider, `jobs[${index}].provider`);
  const now = new Date().toISOString();

  return assertJobDocument({
    id,
    userId: optionalOwnerString(job.userId, `jobs[${index}].userId`),
    name: title,
    enabled: requireBoolean(job.enabled, `jobs[${index}].enabled`),
    schedule,
    startUrl: '',
    engine: 'adapter',
    adapterId: provider,
    goal: '',
    schema: [],
    workflow: [],
    secretIds: [],
    notify: {
      title,
      on: 'always',
      channel: { type: 'ntfy', topic: '' },
    },
    lastResult: null,
    createdAt: now,
    updatedAt: now,
  });
}

function parseNewSeedJob(value: unknown, index: number): JobDocument {
  return assertJobDocument(value);
}

function parseJob(value: unknown, index: number): JobDocument {
  const job = requireObject(value, `jobs[${index}]`);
  if (typeof job.engine === 'string') {
    return parseNewSeedJob(value, index);
  }
  if (typeof job.provider === 'string') {
    return parseLegacySeedJob(value, index);
  }
  throw new ConfigError(`jobs[${index}] must include engine or provider`);
}

export function loadSeedConfig(options?: {
  configPath?: string;
}): SeedConfig {
  const configPath = path.resolve(options?.configPath ?? 'jobs.json');

  let contents: string;
  try {
    contents = readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new ConfigError(`Unable to read config file: ${configPath}`, {
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new ConfigError(`Invalid JSON in config file: ${configPath}`, {
      cause: error,
    });
  }

  const root = requireObject(parsed, 'config');
  const ntfy = requireObject(root.ntfy, 'ntfy');
  const mistral = requireObject(root.mistral, 'mistral');
  const browser = requireObject(root.browser, 'browser');
  if (!Array.isArray(root.jobs)) {
    throw new ConfigError('jobs must be an array');
  }

  const topicEnv = ntfy.topicEnv;
  if (topicEnv !== undefined && typeof topicEnv !== 'string') {
    throw new ConfigError('ntfy.topicEnv must be a string');
  }
  const defaultTopic = ntfy.defaultTopic;
  if (defaultTopic !== undefined && typeof defaultTopic !== 'string') {
    throw new ConfigError('ntfy.defaultTopic must be a string');
  }

  return {
    configPath,
    settings: {
      ntfy: {
        baseUrl:
          ntfy.baseUrl === undefined
            ? 'https://ntfy.sh'
            : requireString(ntfy.baseUrl, 'ntfy.baseUrl'),
        ...(topicEnv === undefined ? {} : { topicEnv }),
        ...(defaultTopic === undefined ? {} : { defaultTopic }),
        priority:
          ntfy.priority === undefined
            ? 'default'
            : requireString(ntfy.priority, 'ntfy.priority'),
      },
      mistral: {
        apiKeyEnv: requireString(mistral.apiKeyEnv, 'mistral.apiKeyEnv'),
        model:
          mistral.model === undefined
            ? 'mistral-small-latest'
            : requireString(mistral.model, 'mistral.model'),
      },
      browser: parseBrowserConfig(browser),
      jobsGeneration:
        root.jobsGeneration === undefined
          ? 0
          : requireNumber(root.jobsGeneration, 'jobsGeneration'),
      ...(root.watchesGeneration === undefined
        ? {}
        : {
            watchesGeneration: requireNumber(
              root.watchesGeneration,
              'watchesGeneration',
            ),
          }),
    },
    jobs: root.jobs.map((job, index) => parseJob(job, index)),
  };
}

function toAppConfig(
  configPath: string,
  settings: SeedSettings,
  jobs: JobConfig[],
  env: NodeJS.ProcessEnv,
): AppConfig {
  return {
    configPath,
    ntfy: {
      baseUrl: settings.ntfy.baseUrl,
      topic: resolveNtfyTopic(settings.ntfy, env),
      priority: settings.ntfy.priority,
    },
    mistral: settings.mistral,
    browser: settings.browser,
    jobs,
    jobsGeneration: settings.jobsGeneration ?? 0,
  };
}

export function loadConfig(options?: {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): AppConfig {
  const parsed = loadSeedConfig({ configPath: options?.configPath });
  const env = options?.env ?? process.env;
  return toAppConfig(parsed.configPath, parsed.settings, parsed.jobs, env);
}

export async function loadConfigFromStore(
  store: BillingStore,
  options?: { env?: NodeJS.ProcessEnv },
): Promise<AppConfig> {
  const settingsDoc = await store.getSettings();
  const jobs = await store.listJobs();
  const settings: SeedSettings = {
    ntfy: settingsDoc.ntfy,
    mistral: settingsDoc.mistral,
    browser: settingsDoc.browser,
    jobsGeneration: settingsDoc.jobsGeneration,
    watchesGeneration: settingsDoc.watchesGeneration ?? 0,
  };
  return toAppConfig('mongodb://runtime', settings, jobs, options?.env ?? process.env);
}
