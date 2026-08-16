import { ConfigError } from '../errors.js';
import type {
  ExtractField,
  FieldType,
  JobDocument,
  JobEngine,
  NotifyChannel,
  NotifyOn,
} from './types.js';
import type { WorkflowStep } from '../workflow/types.js';

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new ConfigError(`${name} must be a string`);
  }
  return value;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ConfigError(`${name} must be a boolean`);
  }
  return value;
}

function requireJobEngine(value: unknown, name: string): JobEngine {
  if (value === 'workflow' || value === 'adapter') {
    return value;
  }
  throw new ConfigError(`${name} must be 'workflow' or 'adapter'`);
}

function requireNotifyOn(value: unknown, name: string): NotifyOn {
  if (
    value === 'always' ||
    value === 'change' ||
    value === 'drop' ||
    value === 'failure_only'
  ) {
    return value;
  }
  throw new ConfigError(`${name} must be a valid NotifyOn value`);
}

function requireFieldType(value: unknown, name: string): FieldType {
  if (
    value === 'string' ||
    value === 'number' ||
    value === 'price' ||
    value === 'date'
  ) {
    return value;
  }
  throw new ConfigError(`${name} must be a valid FieldType value`);
}

function assertNotifyChannel(value: unknown, name: string): NotifyChannel {
  const channel = requireObject(value, name);
  const type = requireString(channel.type, `${name}.type`);
  if (type === 'ntfy') {
    return {
      type: 'ntfy',
      topic: requireString(channel.topic, `${name}.topic`),
      ...(channel.baseUrl === undefined
        ? {}
        : { baseUrl: requireString(channel.baseUrl, `${name}.baseUrl`) }),
    };
  }
  if (type === 'webhook') {
    return {
      type: 'webhook',
      url: requireString(channel.url, `${name}.url`),
    };
  }
  throw new ConfigError(`${name}.type must be 'ntfy' or 'webhook'`);
}

function assertExtractField(value: unknown, name: string): ExtractField {
  const field = requireObject(value, name);
  return {
    key: requireString(field.key, `${name}.key`),
    label: requireString(field.label, `${name}.label`),
    type: requireFieldType(field.type, `${name}.type`),
  };
}

function assertWorkflowStep(value: unknown, name: string): WorkflowStep {
  const step = requireObject(value, name);
  const id = requireString(step.id, `${name}.id`);
  const type = requireString(step.type, `${name}.type`);

  switch (type) {
    case 'goto':
      return {
        id,
        type: 'goto',
        url: requireString(step.url, `${name}.url`),
      };
    case 'fill':
      const source = step.source;
      if (source !== 'secret' && source !== 'literal') {
        throw new ConfigError(`${name}.source must be 'secret' or 'literal'`);
      }
      return {
        id,
        type: 'fill',
        selector: requireString(step.selector, `${name}.selector`),
        source,
        ...(step.secretKey === undefined
          ? {}
          : { secretKey: requireString(step.secretKey, `${name}.secretKey`) }),
        ...(step.value === undefined
          ? {}
          : { value: requireString(step.value, `${name}.value`) }),
      };
    case 'click':
      return {
        id,
        type: 'click',
        selector: requireString(step.selector, `${name}.selector`),
      };
    case 'wait':
      return {
        id,
        type: 'wait',
        ...(step.selector === undefined
          ? {}
          : { selector: requireString(step.selector, `${name}.selector`) }),
        ...(step.timeoutMs === undefined
          ? {}
          : {
              timeoutMs: requireNumber(step.timeoutMs, `${name}.timeoutMs`),
            }),
      };
    case 'solve_captcha':
      return {
        id,
        type: 'solve_captcha',
        imageSelector: requireString(step.imageSelector, `${name}.imageSelector`),
        inputSelector: requireString(step.inputSelector, `${name}.inputSelector`),
      };
    case 'extract':
      if (!Array.isArray(step.fields)) {
        throw new ConfigError(`${name}.fields must be an array`);
      }
      return {
        id,
        type: 'extract',
        fields: step.fields.map((field, index) =>
          assertExtractFieldField(field, `${name}.fields[${index}]`),
        ),
      };
    case 'assert':
      if (step.exists !== true) {
        throw new ConfigError(`${name}.exists must be true`);
      }
      return {
        id,
        type: 'assert',
        selector: requireString(step.selector, `${name}.selector`),
        exists: true,
      };
    default:
      throw new ConfigError(`${name}.type is not a valid workflow step type`);
  }
}

function assertExtractFieldField(
  value: unknown,
  name: string,
): { key: string; selector?: string; strategy?: 'text' | 'price' | 'json_ld' | 'shopify_json' } {
  const field = requireObject(value, name);
  const key = requireString(field.key, `${name}.key`);
  const strategy = field.strategy;
  if (
    strategy !== undefined &&
    strategy !== 'text' &&
    strategy !== 'price' &&
    strategy !== 'json_ld' &&
    strategy !== 'shopify_json'
  ) {
    throw new ConfigError(`${name}.strategy must be a valid extract strategy`);
  }
  return {
    key,
    ...(field.selector === undefined
      ? {}
      : { selector: requireString(field.selector, `${name}.selector`) }),
    ...(strategy === undefined ? {} : { strategy }),
  };
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${name} must be a finite number`);
  }
  return value;
}

function assertLastResult(
  value: unknown,
  name: string,
): Record<string, string | number> | null {
  if (value === null) return null;
  const record = requireObject(value, name);
  const result: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      throw new ConfigError(`${name}.${key} must be a string or number`);
    }
    result[key] = entry;
  }
  return result;
}

export function assertJobDocument(raw: unknown): JobDocument {
  const job = requireObject(raw, 'job');
  const schedule = job.schedule;
  if (schedule !== null && typeof schedule !== 'string') {
    throw new ConfigError('job.schedule must be a string or null');
  }

  const engine = requireJobEngine(job.engine, 'job.engine');
  const adapterId =
    job.adapterId === undefined
      ? undefined
      : requireString(job.adapterId, 'job.adapterId');

  if (!Array.isArray(job.schema)) {
    throw new ConfigError('job.schema must be an array');
  }
  if (!Array.isArray(job.workflow)) {
    throw new ConfigError('job.workflow must be an array');
  }
  if (!Array.isArray(job.secretIds)) {
    throw new ConfigError('job.secretIds must be an array');
  }

  const notify = requireObject(job.notify, 'job.notify');

  return {
    id: requireString(job.id, 'job.id'),
    userId: requireString(job.userId, 'job.userId'),
    name: requireString(job.name, 'job.name'),
    enabled: requireBoolean(job.enabled, 'job.enabled'),
    schedule,
    startUrl: requireString(job.startUrl, 'job.startUrl'),
    engine,
    ...(adapterId === undefined ? {} : { adapterId }),
    goal: requireString(job.goal, 'job.goal'),
    schema: job.schema.map((field, index) =>
      assertExtractField(field, `job.schema[${index}]`),
    ),
    workflow: job.workflow.map((step, index) =>
      assertWorkflowStep(step, `job.workflow[${index}]`),
    ),
    secretIds: job.secretIds.map((secretId, index) =>
      requireString(secretId, `job.secretIds[${index}]`),
    ),
    notify: {
      title: requireString(notify.title, 'job.notify.title'),
      on: requireNotifyOn(notify.on, 'job.notify.on'),
      channel: assertNotifyChannel(notify.channel, 'job.notify.channel'),
    },
    lastResult: assertLastResult(job.lastResult, 'job.lastResult'),
    createdAt: requireString(job.createdAt, 'job.createdAt'),
    updatedAt: requireString(job.updatedAt, 'job.updatedAt'),
  };
}
