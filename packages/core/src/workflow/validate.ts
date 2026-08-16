import { assertPublicHttpUrl, PublicUrlError } from '../assert-public-url.js';
import { ConfigError } from '../errors.js';
import type {
  ExtractFieldSpec,
  ExtractStrategy,
  WorkflowStep,
  WorkflowStepType,
} from './types.js';

const STEP_TYPES: WorkflowStepType[] = [
  'goto',
  'fill',
  'click',
  'wait',
  'solve_captcha',
  'extract',
  'assert',
];

const EXTRACT_STRATEGIES: ExtractStrategy[] = [
  'text',
  'price',
  'json_ld',
  'shopify_json',
];

/** Guards against a `wait` step parking a scheduled run for hours. */
const MAX_WAIT_MS = 300_000;

function fail(where: string, message: string): never {
  throw new ConfigError(`${where}: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'step must be an object');
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: string[],
  where: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(where, `unknown propert${unknown.length === 1 ? 'y' : 'ies'} ${unknown.map((key) => `"${key}"`).join(', ')}`);
  }
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where, `"${key}" must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  if (record[key] === undefined) return undefined;
  return requireNonEmptyString(record, key, where);
}

function validateGotoUrl(url: string, where: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(where, '"url" must be an absolute URL');
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    try {
      assertPublicHttpUrl(url);
    } catch (error) {
      const reason = error instanceof PublicUrlError ? error.message : 'invalid url';
      fail(where, `"url" is not allowed (${reason})`);
    }
    return url;
  }

  // `file:` is only reachable for fixture-backed login tests; the interpreter
  // re-checks the canonical path against the repo fixtures directory at run
  // time, when the filesystem (and any symlink) can actually be inspected.
  if (parsed.protocol === 'file:') return url;

  fail(where, `"url" protocol "${parsed.protocol}" is not allowed`);
}

function validateExtractField(value: unknown, where: string): ExtractFieldSpec {
  const record = asRecord(value, where);
  rejectUnknownKeys(record, ['key', 'selector', 'strategy'], where);

  const key = requireNonEmptyString(record, 'key', where);
  const selector = optionalNonEmptyString(record, 'selector', where);

  let strategy: ExtractStrategy | undefined;
  if (record.strategy !== undefined) {
    const raw = record.strategy;
    if (typeof raw !== 'string' || !EXTRACT_STRATEGIES.includes(raw as ExtractStrategy)) {
      fail(where, `"strategy" must be one of ${EXTRACT_STRATEGIES.join(', ')}`);
    }
    strategy = raw as ExtractStrategy;
  }

  // Text extraction is selector-driven; the page-level strategies (price
  // cascade, JSON-LD, Shopify JSON) may run without one.
  if ((strategy ?? 'text') === 'text' && selector === undefined) {
    fail(where, '"selector" is required for the "text" strategy');
  }

  return {
    key,
    ...(selector === undefined ? {} : { selector }),
    ...(strategy === undefined ? {} : { strategy }),
  };
}

function validateStep(value: unknown, index: number): WorkflowStep {
  const where = `workflow[${index}]`;
  const record = asRecord(value, where);
  const id = requireNonEmptyString(record, 'id', where).trim();

  const rawType = record.type;
  if (typeof rawType !== 'string' || !STEP_TYPES.includes(rawType as WorkflowStepType)) {
    fail(where, `"type" must be one of ${STEP_TYPES.join(', ')}`);
  }
  const type = rawType as WorkflowStepType;
  const stepWhere = `${where} (${type} "${id}")`;

  switch (type) {
    case 'goto': {
      rejectUnknownKeys(record, ['id', 'type', 'url'], stepWhere);
      const url = validateGotoUrl(
        requireNonEmptyString(record, 'url', stepWhere),
        stepWhere,
      );
      return { id, type, url };
    }

    case 'fill': {
      rejectUnknownKeys(
        record,
        ['id', 'type', 'selector', 'source', 'secretKey', 'value'],
        stepWhere,
      );
      const selector = requireNonEmptyString(record, 'selector', stepWhere);
      const source = record.source;
      if (source !== 'secret' && source !== 'literal') {
        fail(stepWhere, '"source" must be "secret" or "literal"');
      }
      if (source === 'secret') {
        if (record.value !== undefined) {
          fail(stepWhere, '"value" is not allowed when source is "secret"');
        }
        const secretKey = requireNonEmptyString(record, 'secretKey', stepWhere);
        return { id, type, selector, source, secretKey };
      }
      if (record.secretKey !== undefined) {
        fail(stepWhere, '"secretKey" is not allowed when source is "literal"');
      }
      if (typeof record.value !== 'string') {
        fail(stepWhere, '"value" must be a string when source is "literal"');
      }
      return { id, type, selector, source, value: record.value };
    }

    case 'click': {
      rejectUnknownKeys(record, ['id', 'type', 'selector'], stepWhere);
      return {
        id,
        type,
        selector: requireNonEmptyString(record, 'selector', stepWhere),
      };
    }

    case 'wait': {
      rejectUnknownKeys(record, ['id', 'type', 'selector', 'timeoutMs'], stepWhere);
      const selector = optionalNonEmptyString(record, 'selector', stepWhere);
      let timeoutMs: number | undefined;
      if (record.timeoutMs !== undefined) {
        const raw = record.timeoutMs;
        if (
          typeof raw !== 'number' ||
          !Number.isInteger(raw) ||
          raw <= 0 ||
          raw > MAX_WAIT_MS
        ) {
          fail(
            stepWhere,
            `"timeoutMs" must be an integer between 1 and ${MAX_WAIT_MS}`,
          );
        }
        timeoutMs = raw;
      }
      if (selector === undefined && timeoutMs === undefined) {
        fail(stepWhere, 'requires "selector", "timeoutMs", or both');
      }
      return {
        id,
        type,
        ...(selector === undefined ? {} : { selector }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      };
    }

    case 'solve_captcha': {
      rejectUnknownKeys(
        record,
        ['id', 'type', 'imageSelector', 'inputSelector'],
        stepWhere,
      );
      return {
        id,
        type,
        imageSelector: requireNonEmptyString(record, 'imageSelector', stepWhere),
        inputSelector: requireNonEmptyString(record, 'inputSelector', stepWhere),
      };
    }

    case 'extract': {
      rejectUnknownKeys(record, ['id', 'type', 'fields'], stepWhere);
      const rawFields = record.fields;
      if (!Array.isArray(rawFields) || rawFields.length === 0) {
        fail(stepWhere, '"fields" must be a non-empty array');
      }
      const fields = rawFields.map((field, fieldIndex) =>
        validateExtractField(field, `${stepWhere} fields[${fieldIndex}]`),
      );
      const keys = new Set<string>();
      for (const field of fields) {
        if (keys.has(field.key)) {
          fail(stepWhere, `duplicate extract field key "${field.key}"`);
        }
        keys.add(field.key);
      }
      return { id, type, fields };
    }

    case 'assert': {
      rejectUnknownKeys(record, ['id', 'type', 'selector', 'exists'], stepWhere);
      const selector = requireNonEmptyString(record, 'selector', stepWhere);
      if (record.exists !== true) {
        fail(stepWhere, '"exists" must be true');
      }
      return { id, type, selector, exists: true };
    }
  }
}

/**
 * Validates untrusted workflow JSON (job document, chat authoring, API payload)
 * and returns a fresh, normalized copy containing only known keys — the shape
 * the interpreter is allowed to execute. Throws `ConfigError` (never
 * recoverable) on anything malformed. No step can carry code: there is no
 * `script`/`eval` step type and unknown properties are rejected outright.
 */
export function validateWorkflow(steps: unknown): WorkflowStep[] {
  if (!Array.isArray(steps)) {
    throw new ConfigError('workflow must be an array of steps');
  }

  const validated = steps.map((step, index) => validateStep(step, index));

  const ids = new Set<string>();
  for (const step of validated) {
    if (ids.has(step.id)) {
      throw new ConfigError(`workflow step ids must be unique: "${step.id}"`);
    }
    ids.add(step.id);
  }

  return validated;
}
