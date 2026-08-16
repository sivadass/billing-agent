import type { Page } from 'playwright';
import { ScrapeError } from '../errors.js';
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
 * Handlers must stay deterministic: no LLM calls, no `page.evaluate`. This is
 * the seam the extract modules plug the price cascade into; core keeps owning
 * the registry so the interpreter never imports the price-monitor package.
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

/** Strategies core implements on its own. `price` / `json_ld` / `shopify_json` are supplied by the extract modules. */
export const defaultExtractStrategies: ExtractStrategyRegistry = Object.freeze({
  text: textExtractStrategy,
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
