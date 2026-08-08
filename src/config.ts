import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors.js';

export type BrowserConfig = {
  headless: boolean;
  timeoutMs: number;
  saveErrorScreenshot: boolean;
  noSandbox?: boolean;
};

export type JobConfig = {
  id: string;
  provider: string;
  enabled: boolean;
  schedule: string | null;
  credentials: Record<string, string>;
  notify: { title: string };
};

export type ResolvedNtfy = {
  baseUrl: string;
  topic: string;
  priority: string;
};

export type ResolvedMistral = {
  apiKey: string;
  model: string;
};

export type AppConfig = {
  configPath: string;
  ntfy: ResolvedNtfy;
  mistral: ResolvedMistral;
  browser: BrowserConfig;
  jobs: JobConfig[];
};

type JsonObject = Record<string, unknown>;

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

function resolveEnv(env: NodeJS.ProcessEnv, envName: unknown, field: string): string {
  const name = requireString(envName, field);
  const value = env[name];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing environment variable: ${name}`);
  }
  return value;
}

function parseJob(value: unknown, index: number, env: NodeJS.ProcessEnv): JobConfig {
  const job = requireObject(value, `jobs[${index}]`);
  const schedule = job.schedule;
  if (schedule !== null && typeof schedule !== 'string') {
    throw new ConfigError(`jobs[${index}].schedule must be a string or null`);
  }

  const rawCredentials = requireObject(
    job.credentials,
    `jobs[${index}].credentials`,
  );
  const credentials: Record<string, string> = {};
  for (const [key, envName] of Object.entries(rawCredentials)) {
    if (!key.endsWith('Env') || key.length === 3) {
      throw new ConfigError(
        `jobs[${index}].credentials.${key} must be an environment reference`,
      );
    }
    credentials[key.slice(0, -3)] = resolveEnv(
      env,
      envName,
      `jobs[${index}].credentials.${key}`,
    );
  }

  const notify = requireObject(job.notify, `jobs[${index}].notify`);
  return {
    id: requireString(job.id, `jobs[${index}].id`),
    provider: requireString(job.provider, `jobs[${index}].provider`),
    enabled: requireBoolean(job.enabled, `jobs[${index}].enabled`),
    schedule,
    credentials,
    notify: {
      title: requireString(notify.title, `jobs[${index}].notify.title`),
    },
  };
}

export function loadConfig(options?: {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}): AppConfig {
  const configPath = path.resolve(options?.configPath ?? 'jobs.json');
  const env = options?.env ?? process.env;

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
    configPath,
    ntfy: {
      baseUrl:
        ntfy.baseUrl === undefined
          ? 'https://ntfy.sh'
          : requireString(ntfy.baseUrl, 'ntfy.baseUrl'),
      topic: resolveEnv(env, ntfy.topicEnv, 'ntfy.topicEnv'),
      priority:
        ntfy.priority === undefined
          ? 'default'
          : requireString(ntfy.priority, 'ntfy.priority'),
    },
    mistral: {
      apiKey: resolveEnv(env, mistral.apiKeyEnv, 'mistral.apiKeyEnv'),
      model:
        mistral.model === undefined
          ? 'mistral-small-latest'
          : requireString(mistral.model, 'mistral.model'),
    },
    browser: {
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
    },
    jobs: root.jobs.map((job, index) => parseJob(job, index, env)),
  };
}
