import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requiredCredentialKeys } from './adapters/credential-keys.js';
import { ConfigError } from './errors.js';
import { decryptSecret, parseMasterKey } from './secrets.js';
import type { BillingStore, JobDocument, SettingsDocument } from './store/types.js';

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

/** Resolves a job's credentials from encrypted secrets. Called lazily by the job runner. */
export async function resolveJobSecrets(
  job: JobConfig,
  store: BillingStore | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const required = requiredCredentialKeys(job.provider);
  if (required.length === 0) {
    return {};
  }
  if (!store) {
    throw new ConfigError('Missing secrets store');
  }

  const masterKey = parseMasterKey(env);
  const secrets = await store.listSecrets(job.id);
  const credentials: Record<string, string> = {};
  for (const secret of secrets) {
    credentials[secret.key] = decryptSecret(secret, masterKey);
  }

  for (const key of required) {
    if (!credentials[key]) {
      throw new ConfigError(`Missing secret "${key}" for job ${job.id}`);
    }
  }

  return credentials;
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

function parseJob(value: unknown, index: number): JobConfig {
  const job = requireObject(value, `jobs[${index}]`);
  const schedule = job.schedule;
  if (schedule !== null && typeof schedule !== 'string') {
    throw new ConfigError(`jobs[${index}].schedule must be a string or null`);
  }

  let credentialsEnv: Record<string, string> | undefined;
  if (job.credentials !== undefined) {
    const rawCredentials = requireObject(
      job.credentials,
      `jobs[${index}].credentials`,
    );
    credentialsEnv = {};
    for (const [key, envName] of Object.entries(rawCredentials)) {
      if (!key.endsWith('Env') || key.length === 3) {
        throw new ConfigError(
          `jobs[${index}].credentials.${key} must be an environment reference`,
        );
      }
      credentialsEnv[key.slice(0, -3)] = requireString(
        envName,
        `jobs[${index}].credentials.${key}`,
      );
    }
  }

  const notify = requireObject(job.notify, `jobs[${index}].notify`);
  return {
    id: requireString(job.id, `jobs[${index}].id`),
    userId: optionalOwnerString(job.userId, `jobs[${index}].userId`),
    provider: requireString(job.provider, `jobs[${index}].provider`),
    enabled: requireBoolean(job.enabled, `jobs[${index}].enabled`),
    schedule,
    ...(credentialsEnv === undefined ? {} : { credentialsEnv }),
    notify: {
      title: requireString(notify.title, `jobs[${index}].notify.title`),
    },
  };
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

  return {
    configPath,
    settings: {
      ntfy: {
        baseUrl:
          ntfy.baseUrl === undefined
            ? 'https://ntfy.sh'
            : requireString(ntfy.baseUrl, 'ntfy.baseUrl'),
        topicEnv: requireString(ntfy.topicEnv, 'ntfy.topicEnv'),
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
      watchesGeneration:
        root.watchesGeneration === undefined
          ? 0
          : requireNumber(root.watchesGeneration, 'watchesGeneration'),
    },
    jobs: root.jobs.map((job, index) => parseJob(job, index)),
  };
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${name} must be a finite number`);
  }
  return value;
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
      topic: resolveEnv(env, settings.ntfy.topicEnv, 'ntfy.topicEnv'),
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
