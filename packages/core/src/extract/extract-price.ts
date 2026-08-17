import { assertPublicHttpUrl } from '../assert-public-url.js';
import { extractWithLlm } from './llm.js';
import { extractFromPageHtml } from './page-structured.js';
import { extractFromShopifyJson, shopifyProductJsonUrl } from './shopify-json.js';
import type { ExtractedPrice } from './types.js';

const DEFAULT_MISTRAL_MODEL = 'mistral-small-latest';
const MAX_LLM_TEXT_LENGTH = 12_000;

export class PriceExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceExtractError';
  }
}

function compactHtmlForLlm(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LLM_TEXT_LENGTH);
}

/**
 * Price extraction pipeline: Shopify product JSON → page structured
 * markup → optional Mistral fallback. The LLM leg only runs when the caller
 * passes a key, and scheduled workflow runs never do — the interpreter's
 * `price` strategy uses the deterministic cascade in `workflow-strategies.ts`
 * instead, so a replay can't spend tokens.
 */
export async function extractPrice(input: {
  url: string;
  fetchJson?: typeof fetch;
  loadPageHtml: (url: string) => Promise<string>;
  mistralApiKey?: string;
  mistralModel?: string;
}): Promise<ExtractedPrice> {
  const parsed = assertPublicHttpUrl(input.url);
  const fetchJson = input.fetchJson ?? fetch;

  const shopifyJsonUrl = shopifyProductJsonUrl(parsed.toString());
  if (shopifyJsonUrl) {
    try {
      const response = await fetchJson(shopifyJsonUrl);
      if (response.ok) {
        const payload = await response.json();
        const shopifyPrice = extractFromShopifyJson(payload);
        if (shopifyPrice && shopifyPrice.price > 0) {
          return shopifyPrice;
        }
      }
    } catch {
      // Continue to page-level extraction on Shopify fetch failures.
    }
  }

  let html: string;
  try {
    html = await input.loadPageHtml(parsed.toString());
  } catch (error) {
    throw new PriceExtractError(
      `Unable to load page HTML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const structured = extractFromPageHtml(html);
  if (structured) {
    if (structured.price <= 0) {
      throw new PriceExtractError('Extracted price must be positive');
    }
    return structured;
  }

  if (!input.mistralApiKey) {
    throw new PriceExtractError('Unable to extract price and Mistral API key is missing');
  }

  const llmPrice = await extractWithLlm({
    text: compactHtmlForLlm(html),
    mistralApiKey: input.mistralApiKey,
    model: input.mistralModel ?? DEFAULT_MISTRAL_MODEL,
  });
  if (llmPrice && llmPrice.price > 0) {
    return llmPrice;
  }

  throw new PriceExtractError('Unable to extract price from page');
}
