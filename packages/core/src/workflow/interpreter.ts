import type { Page } from 'playwright';
import type { CaptchaSolver } from '../captcha.js';
import {
  AppError,
  CaptchaError,
  ConfigError,
  LoginError,
  ScrapeError,
  TimeoutError,
  type ErrorCode,
} from '../errors.js';
import type { Logger } from '../logger.js';
import type { ExtractField } from '../store/types.js';
import {
  defaultExtractStrategies,
  resolveExtractStrategy,
  type ExtractStrategyRegistry,
} from './extract-strategies.js';
import { resolveWorkflowGotoUrl } from './goto-url.js';
import type { WorkflowStep } from './types.js';
import { validateWorkflow } from './validate.js';

export type RunWorkflowInput = {
  page: Page;
  steps: WorkflowStep[];
  secrets: Record<string, string>;
  captchaSolver: CaptchaSolver;
  timeoutMs: number;
  /** When given, every schema key must end up in the result or the run fails. */
  schema?: ExtractField[];
  logger?: Logger;
  /** Fills the `price` / `json_ld` / `shopify_json` seam; core only ships `text`. */
  extractStrategies?: ExtractStrategyRegistry;
};

/**
 * Secret values shorter than this are not redacted: they collide with ordinary
 * words in error text (turning messages into noise) and are not credentials
 * worth protecting.
 */
const MIN_REDACTED_LENGTH = 3;

const REDACTED = '***';

function collectSecretValues(secrets: Record<string, string>): string[] {
  return Object.values(secrets)
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH,
    )
    .sort((a, b) => b.length - a.length);
}

function redact(text: string, secretValues: string[]): string {
  let out = text;
  for (const value of secretValues) {
    out = out.split(value).join(REDACTED);
  }
  return out;
}

function errorForCode(code: ErrorCode, message: string): AppError {
  switch (code) {
    case 'ConfigError':
      return new ConfigError(message);
    case 'CaptchaError':
      return new CaptchaError(message);
    case 'LoginError':
      return new LoginError(message);
    case 'NotifyError':
    case 'ScrapeError':
      return new ScrapeError(message);
    case 'TimeoutError':
      return new TimeoutError(message);
  }
}

/** Which error a step's unexpected (Playwright) failure maps to. */
function defaultErrorCode(step: WorkflowStep): ErrorCode {
  switch (step.type) {
    case 'wait':
      return 'TimeoutError';
    case 'fill':
      return step.source === 'secret' ? 'LoginError' : 'ScrapeError';
    default:
      return 'ScrapeError';
  }
}

/**
 * Rewrites a step failure so no secret plaintext can reach a log line, a run
 * document, or a notification. `cause` is only preserved when the original text
 * carried no secret — otherwise the redacted message is all a caller gets.
 */
function toStepError(
  step: WorkflowStep,
  cause: unknown,
  secretValues: string[],
): AppError {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const redacted = redact(raw, secretValues);
  const leaked = redacted !== raw;

  if (cause instanceof AppError) {
    return leaked ? errorForCode(cause.code, redacted) : cause;
  }

  const message = `workflow step "${step.id}" (${step.type}) failed: ${redacted}`;
  const code = defaultErrorCode(step);
  return leaked
    ? errorForCode(code, message)
    : errorForCodeWithCause(code, message, cause);
}

function errorForCodeWithCause(
  code: ErrorCode,
  message: string,
  cause: unknown,
): AppError {
  const error = errorForCode(code, message);
  error.cause = cause;
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WorkflowState = {
  /** A secret was filled or a captcha solved, so failures are login failures. */
  authAttempted: boolean;
  /** Once a field has been extracted, later assert failures are scrape failures. */
  extracted: boolean;
};

/**
 * Executes validated workflow steps against an open Playwright page and returns
 * the extracted `result` record.
 *
 * The interpreter is intentionally boring: a fixed set of step types driven by
 * plain locator calls. There is no `eval`, no `page.evaluate`, and no generated
 * JavaScript, so a job document can never smuggle code into the browser. The
 * only LLM access is the injected `captchaSolver`; nothing here imports Mistral.
 */
export async function runWorkflow(
  input: RunWorkflowInput,
): Promise<Record<string, unknown>> {
  // Re-validate even when the caller passed typed steps: the steps normally
  // come from Mongo, so this is the boundary that guarantees the interpreter
  // only ever executes known step shapes.
  const steps = validateWorkflow(input.steps);
  const secretValues = collectSecretValues(input.secrets);
  const strategies: ExtractStrategyRegistry = {
    ...defaultExtractStrategies,
    ...input.extractStrategies,
  };
  const result: Record<string, unknown> = {};
  const state: WorkflowState = { authAttempted: false, extracted: false };

  for (const step of steps) {
    input.logger?.info('workflow step', { stepId: step.id, type: step.type });
    try {
      await runStep(step, input, strategies, result, state);
    } catch (cause) {
      throw toStepError(step, cause, secretValues);
    }
  }

  assertSchemaSatisfied(input.schema, result);
  return result;
}

async function runStep(
  step: WorkflowStep,
  input: RunWorkflowInput,
  strategies: ExtractStrategyRegistry,
  result: Record<string, unknown>,
  state: WorkflowState,
): Promise<void> {
  const { page, timeoutMs } = input;

  switch (step.type) {
    case 'goto': {
      const url = resolveWorkflowGotoUrl(step.url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;
    }

    case 'fill': {
      const value = resolveFillValue(step, input.secrets);
      if (step.source === 'secret') state.authAttempted = true;
      await page.locator(step.selector).first().fill(value, { timeout: timeoutMs });
      return;
    }

    case 'click': {
      await page.locator(step.selector).first().click({ timeout: timeoutMs });
      return;
    }

    case 'wait': {
      if (step.selector) {
        await page
          .locator(step.selector)
          .first()
          .waitFor({ state: 'visible', timeout: step.timeoutMs ?? timeoutMs });
        return;
      }
      await sleep(step.timeoutMs ?? timeoutMs);
      return;
    }

    case 'solve_captcha': {
      state.authAttempted = true;
      const image = await page
        .locator(step.imageSelector)
        .first()
        .screenshot({ type: 'png', timeout: timeoutMs });
      const answer = (
        await input.captchaSolver.solveFromImageBase64(
          Buffer.from(image).toString('base64'),
        )
      ).trim();
      if (answer === '') {
        throw new CaptchaError(
          `workflow step "${step.id}": captcha solver returned an empty answer`,
        );
      }
      await page
        .locator(step.inputSelector)
        .first()
        .fill(answer, { timeout: timeoutMs });
      return;
    }

    case 'extract': {
      for (const field of step.fields) {
        const strategy = field.strategy ?? 'text';
        const handler = resolveExtractStrategy(
          strategies,
          strategy,
          step.id,
          field.key,
        );
        const value = await handler({ page, field, stepId: step.id, timeoutMs });
        const normalized = typeof value === 'string' ? value.trim() : value;
        if (normalized === undefined || normalized === null || normalized === '') {
          throw new ScrapeError(
            `workflow step "${step.id}": no value extracted for field "${field.key}" using strategy "${strategy}"`,
          );
        }
        result[field.key] = normalized;
      }
      state.extracted = true;
      return;
    }

    case 'assert': {
      const locator = page.locator(step.selector).first();
      try {
        await locator.waitFor({ state: 'attached', timeout: timeoutMs });
      } catch {
        throw assertionError(step, state);
      }
      if ((await page.locator(step.selector).count()) === 0) {
        throw assertionError(step, state);
      }
      return;
    }
  }
}

function resolveFillValue(
  step: Extract<WorkflowStep, { type: 'fill' }>,
  secrets: Record<string, string>,
): string {
  if (step.source === 'literal') return step.value ?? '';
  const key = step.secretKey ?? '';
  const value = secrets[key];
  if (typeof value !== 'string' || value === '') {
    // Names the key, never the value.
    throw new LoginError(
      `workflow step "${step.id}": secret "${key}" is not set for this job`,
    );
  }
  return value;
}

/**
 * A missing element right after a credentialed step means the login did not
 * land (`LoginError`, which recovery treats as a login problem); once anything
 * has been extracted the page is authenticated and a missing element is a
 * scrape problem instead.
 */
function assertionError(
  step: Extract<WorkflowStep, { type: 'assert' }>,
  state: WorkflowState,
): AppError {
  const message = `workflow step "${step.id}": expected selector "${step.selector}" to match at least one element`;
  return state.authAttempted && !state.extracted
    ? new LoginError(message)
    : new ScrapeError(message);
}

function assertSchemaSatisfied(
  schema: ExtractField[] | undefined,
  result: Record<string, unknown>,
): void {
  if (!schema || schema.length === 0) return;
  const missing = schema
    .filter((field) => {
      const value = result[field.key];
      return value === undefined || value === null || value === '';
    })
    .map((field) => field.key);
  if (missing.length > 0) {
    throw new ScrapeError(
      `workflow did not extract required field(s): ${missing.join(', ')}`,
    );
  }
}
