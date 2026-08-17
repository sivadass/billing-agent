import { createHash } from 'node:crypto';
import { ConfigError } from './errors.js';
import type { JobDocument } from './store/types.js';
import type { WorkflowStep } from './workflow/types.js';

export type SelectorOverlay = Record<string, string | string[]>;

export const WORKFLOW_OVERLAY_PROVIDER = 'workflow';

export const tnpdclOverlayKeys = [
  'username',
  'password',
  'captchaInput',
  'captchaImage',
  'loginButton',
  'loginError',
  'amount',
  'dueDate',
  'billPeriod',
  'status',
  'accountLabel',
];

const adapterAllowedKeys = new Set(tnpdclOverlayKeys);

const MAX_OVERLAY_KEYS = 16;
const MAX_OVERLAY_TEXT_LENGTH = 512;

function assertOverlayString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigError(`overlay key "${key}" must be a non-empty string`);
  }
  if (value.length > MAX_OVERLAY_TEXT_LENGTH) {
    throw new ConfigError(`overlay key "${key}" exceeds max length`);
  }
  return value;
}

export function allowedOverlayKeys(job: JobDocument): Set<string> {
  if (job.engine === 'adapter') {
    return new Set(adapterAllowedKeys);
  }

  const keys = new Set<string>();
  for (const step of job.workflow) {
    switch (step.type) {
      case 'fill':
      case 'click':
      case 'assert':
        keys.add(`step:${step.id}.selector`);
        break;
      case 'wait':
        if (step.selector) keys.add(`step:${step.id}.selector`);
        break;
      case 'solve_captcha':
        keys.add(`step:${step.id}.imageSelector`);
        keys.add(`step:${step.id}.inputSelector`);
        break;
      case 'extract':
        for (const field of step.fields) {
          keys.add(`field:${field.key}`);
        }
        break;
      default:
        break;
    }
  }
  for (const field of job.schema) {
    keys.add(`field:${field.key}`);
  }
  return keys;
}

export function validateOverlayPatch(
  raw: unknown,
  allowedKeys: Iterable<string> = tnpdclOverlayKeys,
): SelectorOverlay {
  const allowed = new Set(allowedKeys);

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('overlay patch must be an object');
  }

  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new ConfigError('overlay patch must not be empty');
  }
  if (entries.length > MAX_OVERLAY_KEYS) {
    throw new ConfigError('overlay patch exceeds max key count');
  }

  const patch: SelectorOverlay = {};
  for (const [key, value] of entries) {
    if (!allowed.has(key)) {
      throw new ConfigError(`unknown overlay key: ${key}`);
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new ConfigError(`overlay key "${key}" must not be an empty array`);
      }
      patch[key] = value.map((item) => assertOverlayString(item, key));
      continue;
    }
    patch[key] = assertOverlayString(value, key);
  }

  return patch;
}

export function applyWorkflowOverlay(
  steps: WorkflowStep[],
  overlay?: SelectorOverlay,
): WorkflowStep[] {
  if (!overlay) return steps.map((step) => ({ ...step }));
  return steps.map((step) => applyOverlayToStep(step, overlay));
}

function applyOverlayToStep(step: WorkflowStep, overlay: SelectorOverlay): WorkflowStep {
  const selectorKey = `step:${step.id}.selector`;
  const selectorOverride = overlay[selectorKey];

  switch (step.type) {
    case 'fill':
    case 'click':
    case 'assert':
      if (typeof selectorOverride === 'string') {
        return { ...step, selector: selectorOverride };
      }
      return { ...step };
    case 'wait':
      if (step.selector && typeof selectorOverride === 'string') {
        return { ...step, selector: selectorOverride };
      }
      return { ...step };
    case 'solve_captcha': {
      const imageOverride = overlay[`step:${step.id}.imageSelector`];
      const inputOverride = overlay[`step:${step.id}.inputSelector`];
      return {
        ...step,
        ...(typeof imageOverride === 'string' ? { imageSelector: imageOverride } : {}),
        ...(typeof inputOverride === 'string' ? { inputSelector: inputOverride } : {}),
      };
    }
    case 'extract':
      return {
        ...step,
        fields: step.fields.map((field) => {
          const fieldOverride = overlay[`field:${field.key}`];
          if (typeof fieldOverride === 'string') {
            return { ...field, selector: fieldOverride };
          }
          return { ...field };
        }),
      };
    default:
      return { ...step };
  }
}

export function fingerprintFailure(input: {
  code: string;
  step?: string;
  urlPath?: string;
  title?: string;
}): string {
  const payload = JSON.stringify({
    code: input.code,
    step: input.step ?? '',
    urlPath: input.urlPath ?? '',
    title: input.title ?? '',
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function mergeSelectors<T extends Record<string, string>>(
  defaults: T,
  overlay?: SelectorOverlay,
): T {
  if (!overlay) return { ...defaults };
  const merged: Record<string, string> = { ...defaults };
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value !== 'string') continue;
    if (!(key in merged)) continue;
    merged[key] = value;
  }
  return merged as T;
}

export function overlayProviderForJob(job: JobDocument): string {
  if (job.engine === 'workflow') return WORKFLOW_OVERLAY_PROVIDER;
  const adapterId = job.adapterId;
  if (!adapterId) {
    throw new ConfigError(`Job ${job.id} is missing adapterId`);
  }
  return adapterId;
}
