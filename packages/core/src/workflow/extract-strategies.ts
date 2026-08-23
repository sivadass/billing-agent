import type { Page } from 'playwright';
import { ScrapeError } from '../errors.js';
import { priceExtractStrategies } from '../extract/workflow-strategies.js';
import type { ExtractFieldSpec, ExtractStrategy } from './types.js';

export type ExtractedValue = string | number | null | undefined;

export type ExtractStrategyInput = {
  page: Page;
  field: ExtractFieldSpec;
  stepId: string;
  timeoutMs: number;
};

/**
 * A strategy resolves one extract field from an already-loaded page. Returning
 * `undefined` / `null` / `''` means "not found" — the interpreter turns that
 * into a `ScrapeError` naming the field, so handlers never have to.
 *
 * Handlers must stay deterministic: no LLM calls, no `page.evaluate`. Callers
 * may still override a strategy (tests inject stubs, authoring may narrow one),
 * which is why the registry stays open.
 */
export type ExtractStrategyHandler = (
  input: ExtractStrategyInput,
) => Promise<ExtractedValue>;

export type ExtractStrategyRegistry = Partial<
  Record<ExtractStrategy, ExtractStrategyHandler>
>;

/**
 * `innerText` is rendering-aware, so it is empty for content the page hides
 * (collapsed menus, `display: none` blocks). Falling back to `textContent`
 * keeps those fields extractable while still preferring the rendered text.
 */
export const textExtractStrategy: ExtractStrategyHandler = async ({
  page,
  field,
  timeoutMs,
}) => {
  if (!field.selector) return undefined;
  const locator = page.locator(field.selector).first();
  try {
    await locator.waitFor({ state: 'attached', timeout: timeoutMs });
  } catch {
    return undefined;
  }

  const rendered = (await locator.innerText().catch(() => '')).trim();
  if (rendered !== '') return rendered;
  return (await locator.textContent().catch(() => null))?.trim() ?? undefined;
};

/**
 * Every canonical strategy, so a validated workflow always has a handler for
 * what it asks for: `text` here, and the deterministic price cascade from the
 * extract modules. Anything unregistered fails closed in
 * `resolveExtractStrategy`.
 */
export const defaultExtractStrategies: ExtractStrategyRegistry = Object.freeze({
  text: textExtractStrategy,
  ...priceExtractStrategies,
});

export function resolveExtractStrategy(
  registry: ExtractStrategyRegistry,
  strategy: ExtractStrategy,
  stepId: string,
  fieldKey: string,
): ExtractStrategyHandler {
  const handler = registry[strategy];
  if (!handler) {
    throw new ScrapeError(
      `workflow step "${stepId}": extract strategy "${strategy}" is not available for field "${fieldKey}"`,
    );
  }
  return handler;
}
