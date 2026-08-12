import { parsePriceString } from '../parse-price.js';
import type { ExtractedPrice } from '../types.js';

function readProductCandidate(json: unknown): Record<string, unknown> | null {
  if (typeof json !== 'object' || json === null) return null;
  const root = json as Record<string, unknown>;
  const product =
    typeof root.product === 'object' && root.product !== null
      ? (root.product as Record<string, unknown>)
      : root;
  return product;
}

export function shopifyProductJsonUrl(productUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(productUrl);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(/^\/products\/([^/?#]+)\/?$/);
  if (!match?.[1]) {
    return null;
  }

  return `${parsed.origin}/products/${match[1]}.json`;
}

export function extractFromShopifyJson(json: unknown): ExtractedPrice | null {
  const product = readProductCandidate(json);
  if (!product) return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const firstVariant =
    variants.find((variant) => typeof variant === 'object' && variant !== null) ?? null;
  if (!firstVariant) return null;

  const variant = firstVariant as Record<string, unknown>;
  const price = parsePriceString(String(variant.price ?? ''));
  if (price === null || price <= 0) return null;

  const currencyRaw =
    variant.price_currency ??
    variant.currency ??
    product.currency ??
    (typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>).currency
      : undefined);
  const currency =
    typeof currencyRaw === 'string' && currencyRaw.trim().length > 0
      ? currencyRaw.trim().toUpperCase()
      : 'INR';
  const title = typeof product.title === 'string' ? product.title : undefined;

  return {
    price,
    currency,
    title,
    source: 'shopify_json',
  };
}
