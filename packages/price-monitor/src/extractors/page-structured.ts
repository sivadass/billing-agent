import { parsePriceString } from '../parse-price.js';
import type { ExtractedPrice } from '../types.js';

function extractMetaTags(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const keyMatch = tag.match(/\b(?:property|name)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']*)["']/i);
    if (!keyMatch?.[1] || contentMatch?.[1] === undefined) continue;
    map[keyMatch[1].toLowerCase()] = contentMatch[1];
  }
  return map;
}

function toJsonLdCandidates(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object['@graph'])) {
      return [
        object,
        ...object['@graph'].filter(
          (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
        ),
      ];
    }
    return [object];
  }
  return [];
}

function extractFromJsonLd(html: string): ExtractedPrice | null {
  const blocks = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ) ?? [];

  for (const block of blocks) {
    const bodyMatch = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const body = bodyMatch?.[1]?.trim();
    if (!body) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }

    const candidates = toJsonLdCandidates(parsed);
    for (const item of candidates) {
      const typeValue = item['@type'];
      const typeMatches = Array.isArray(typeValue)
        ? typeValue.some((type) => String(type).toLowerCase() === 'product')
        : String(typeValue ?? '').toLowerCase() === 'product';
      if (!typeMatches) continue;

      const offers = item.offers;
      const offer = Array.isArray(offers)
        ? offers.find((entry) => typeof entry === 'object' && entry !== null)
        : offers;
      if (typeof offer !== 'object' || offer === null) continue;

      const record = offer as Record<string, unknown>;
      const price = parsePriceString(String(record.price ?? record.lowPrice ?? ''));
      if (price === null || price <= 0) continue;

      const currencyRaw = record.priceCurrency;
      if (typeof currencyRaw !== 'string' || currencyRaw.trim().length === 0) continue;
      const title = typeof item.name === 'string' ? item.name : undefined;

      return {
        price,
        currency: currencyRaw.trim().toUpperCase(),
        title,
        source: 'json_ld',
      };
    }
  }

  return null;
}

function extractFromOg(html: string): ExtractedPrice | null {
  const meta = extractMetaTags(html);
  const amount =
    meta['product:price:amount'] ??
    meta['og:price:amount'] ??
    meta['price:amount'] ??
    null;
  if (!amount) return null;
  const price = parsePriceString(amount);
  if (price === null || price <= 0) return null;

  const currencyRaw =
    meta['product:price:currency'] ??
    meta['og:price:currency'] ??
    meta['price:currency'] ??
    null;
  if (!currencyRaw) return null;

  return {
    price,
    currency: currencyRaw.toUpperCase(),
    title: meta['og:title'],
    source: 'og',
  };
}

function extractFromSelectors(html: string): ExtractedPrice | null {
  const directMeta = html.match(
    /<meta[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  const itemPropText = html.match(/itemprop=["']price["'][^>]*>([^<]+)</i)?.[1];
  const classPriceText = html.match(
    /<(?:span|div|p)[^>]*(?:class|id)=["'][^"']*price[^"']*["'][^>]*>([^<]+)</i,
  )?.[1];

  const priceText = directMeta ?? itemPropText ?? classPriceText ?? null;
  if (!priceText) return null;
  const price = parsePriceString(priceText);
  if (price === null || price <= 0) return null;

  const currencyMeta = html.match(
    /<meta[^>]*itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  )?.[1];
  const tokenCurrency = priceText.match(/\b([A-Z]{3})\b/)?.[1];
  const inferredCurrency =
    currencyMeta ??
    tokenCurrency ??
    (/[₹]|rs\.?/i.test(priceText) ? 'INR' : null);
  if (!inferredCurrency) return null;

  return {
    price,
    currency: inferredCurrency.toUpperCase(),
    source: 'selector',
  };
}

export function extractFromPageHtml(html: string): ExtractedPrice | null {
  return extractFromJsonLd(html) ?? extractFromOg(html) ?? extractFromSelectors(html);
}
