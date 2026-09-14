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
import { validateWorkflow } from '../workflow/validate.js';

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

function requireNonemptyString(value: unknown, name: string): string {
  const valueStr = requireString(value, name);
  if (valueStr.length === 0) {
    throw new ConfigError(`${name} must be a non-empty string`);
  }
  return valueStr;
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
      url: requireNonemptyString(channel.url, `${name}.url`),
    };
  }
  throw new ConfigError(`${name}.type must be 'ntfy' or 'webhook'`);
}

function assertExtractField(value: unknown, name: string): ExtractField {
  const field = requireObject(value, name);
  return {
    key: requireNonemptyString(field.key, `${name}.key`),
    label: requireNonemptyString(field.label, `${name}.label`),
    type: requireFieldType(field.type, `${name}.type`),
  };
}

/**
 * Workflow steps are validated by the very function the interpreter runs, so a
 * job can never be written (API, seed config, migration) in a shape the runner
 * would refuse to replay. `engine: 'adapter'` jobs keep an empty `workflow`.
 */
function assertWorkflow(value: unknown, engine: JobEngine): WorkflowStep[] {
  if (!Array.isArray(value)) {
    throw new ConfigError('job.workflow must be an array');
  }
  const workflow = validateWorkflow(value);
  if (engine === 'workflow' && !workflow.some((step) => step.type === 'extract')) {
    throw new ConfigError(
      'job.workflow must contain at least one extract step for a workflow job',
    );
  }
  return workflow;
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
      : requireNonemptyString(job.adapterId, 'job.adapterId');

  if (!Array.isArray(job.schema)) {
    throw new ConfigError('job.schema must be an array');
  }
  const workflow = assertWorkflow(job.workflow, engine);
  if (!Array.isArray(job.secretIds)) {
    throw new ConfigError('job.secretIds must be an array');
  }

  const notify = requireObject(job.notify, 'job.notify');

  return {
    id: requireNonemptyString(job.id, 'job.id'),
    userId: requireString(job.userId, 'job.userId'),
    name: requireNonemptyString(job.name, 'job.name'),
    enabled: requireBoolean(job.enabled, 'job.enabled'),
    schedule,
    startUrl: requireString(job.startUrl, 'job.startUrl'),
    engine,
    ...(adapterId === undefined ? {} : { adapterId }),
    goal: requireString(job.goal, 'job.goal'),
    schema: job.schema.map((field, index) =>
      assertExtractField(field, `job.schema[${index}]`),
    ),
    workflow,
    secretIds: job.secretIds.map((secretId, index) =>
      requireNonemptyString(secretId, `job.secretIds[${index}]`),
    ),
    notify: {
      title: requireNonemptyString(notify.title, 'job.notify.title'),
      on: requireNotifyOn(notify.on, 'job.notify.on'),
      channel: assertNotifyChannel(notify.channel, 'job.notify.channel'),
    },
    lastResult: assertLastResult(job.lastResult, 'job.lastResult'),
    createdAt: requireNonemptyString(job.createdAt, 'job.createdAt'),
    updatedAt: requireNonemptyString(job.updatedAt, 'job.updatedAt'),
  };
}
