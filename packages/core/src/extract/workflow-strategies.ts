import type { Page } from 'playwright';
import { assertPublicHttpUrl } from '../assert-public-url.js';
import type {
  ExtractedValue,
  ExtractStrategyHandler,
} from '../workflow/extract-strategies.js';
import { extractFromJsonLd, extractFromPageHtml } from './page-structured.js';
import { extractFromShopifyJson, shopifyProductJsonUrl } from './shopify-json.js';
import type { ExtractedPrice } from './types.js';

/** The part of an extracted price a workflow field is asking for. */
export type PriceField = 'price' | 'currency' | 'title';

export type PriceExtractStrategies = {
  price: ExtractStrategyHandler;
  json_ld: ExtractStrategyHandler;
  shopify_json: ExtractStrategyHandler;
};

/**
 * A price extractor produces price, currency and title together, but a workflow
 * field asks for one value under a key an operator chose. The key name decides
 * which part it gets: anything containing `currency` or `title` maps to that
 * component, everything else (`price`, `amount`, `total`, …) to the amount.
 */
export function priceFieldForKey(key: string): PriceField {
  const normalized = key.toLowerCase();
  if (normalized.includes('currency')) return 'currency';
  if (normalized.includes('title')) return 'title';
  return 'price';
}

/**
 * A non-positive amount is not a price (see the watch gates: `price <= 0` is a
 * failed extract), so the whole reading is discarded rather than reported —
 * which lets the next candidate for the same key try instead.
 */
function valueForField(
  extracted: ExtractedPrice | null,
  key: string,
): ExtractedValue {
  if (!extracted || extracted.price <= 0) return undefined;
  switch (priceFieldForKey(key)) {
    case 'currency':
      return extracted.currency;
    case 'title':
      return extracted.title;
    case 'price':
      return extracted.price;
  }
}

/** The `<product>.json` endpoint for a Shopify product page, when it is safe to fetch. */
function productJsonEndpoint(pageUrl: string): string | null {
  const endpoint = shopifyProductJsonUrl(pageUrl);
  if (!endpoint) return null;
  try {
    assertPublicHttpUrl(endpoint);
  } catch {
    return null;
  }
  return endpoint;
}

/**
 * A missing, broken, or non-Shopify endpoint is a miss, never a failure: the
 * interpreter's cascade is what decides a field has no value.
 */
async function readShopifyProduct(
  endpoint: string,
  fetchJson: typeof fetch,
): Promise<ExtractedPrice | null> {
  try {
    const response = await fetchJson(endpoint);
    if (!response.ok) return null;
    return extractFromShopifyJson(await response.json());
  } catch {
    return null;
  }
}

/**
 * Builds the deterministic `price` / `json_ld` / `shopify_json` handlers the
 * workflow interpreter registers by default.
 *
 * Everything here reads the page through Playwright's own APIs (`url()`,
 * `content()`) — no `page.evaluate`, no generated JavaScript — and the only
 * network call is the public Shopify product JSON endpoint. There is no LLM
 * fallback: a scheduled replay must never spend tokens, so a strategy that
 * cannot find its value returns `undefined` and the interpreter fails the field
 * closed. `extractPrice` keeps the Mistral fallback for standalone price
 * leg for interactive use.
 */
export function createPriceExtractStrategies(
  options: { fetchJson?: typeof fetch } = {},
): PriceExtractStrategies {
  // Keyed by page so the entries die with the run, and by endpoint so a
  // navigation to another product is not served the previous page's payload.
  // One extract step usually asks Shopify for several fields (price, currency);
  // this keeps that to a single request.
  const shopifyByPage = new WeakMap<
    Page,
    Map<string, Promise<ExtractedPrice | null>>
  >();

  function shopifyPrice(page: Page): Promise<ExtractedPrice | null> {
    const endpoint = productJsonEndpoint(page.url());
    if (!endpoint) return Promise.resolve(null);

    let cached = shopifyByPage.get(page);
    if (!cached) {
      cached = new Map();
      shopifyByPage.set(page, cached);
    }
    const pending = cached.get(endpoint);
    if (pending) return pending;

    const request = readShopifyProduct(endpoint, options.fetchJson ?? fetch);
    cached.set(endpoint, request);
    return request;
  }

  const shopify_json: ExtractStrategyHandler = async ({ page, field }) =>
    valueForField(await shopifyPrice(page), field.key);

  const json_ld: ExtractStrategyHandler = async ({ page, field }) =>
    valueForField(extractFromJsonLd(await page.content()), field.key);

  /** The watch cascade: Shopify product JSON → JSON-LD → Open Graph → price selectors. */
  const price: ExtractStrategyHandler = async ({ page, field }) => {
    const sources: Array<() => Promise<ExtractedPrice | null>> = [
      () => shopifyPrice(page),
      async () => extractFromPageHtml(await page.content()),
    ];

    for (const source of sources) {
      const value = valueForField(await source(), field.key);
      if (value !== undefined && value !== '') return value;
    }
    return undefined;
  };

  return { price, json_ld, shopify_json };
}

/** The strategies the interpreter registers for every workflow run. */
export const priceExtractStrategies: PriceExtractStrategies =
  createPriceExtractStrategies();
