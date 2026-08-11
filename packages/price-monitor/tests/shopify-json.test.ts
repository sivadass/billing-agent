import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  extractFromShopifyJson,
  shopifyProductJsonUrl,
} from '../src/extractors/shopify-json.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(dir, 'fixtures', 'shopify-product.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('shopifyProductJsonUrl', () => {
  it('builds the .json endpoint for product urls', () => {
    const endpoint = shopifyProductJsonUrl(
      'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole',
    );
    assert.equal(
      endpoint,
      'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole.json',
    );
  });

  it('returns null for non-product urls', () => {
    assert.equal(shopifyProductJsonUrl('https://craftandglory.in/collections/shoes'), null);
  });
});

describe('extractFromShopifyJson', () => {
  it('extracts selling price/title/source from product payload', () => {
    const extracted = extractFromShopifyJson(fixture);
    assert.deepEqual(extracted, {
      price: 8450,
      currency: 'INR',
      title: 'Old Skool Retro Leather Sneakers (Vintage Brown With White Sole)',
      source: 'shopify_json',
    });
  });

  it('returns null for non-positive price values', () => {
    const extracted = extractFromShopifyJson({
      product: { title: 'Broken', variants: [{ price: '0', price_currency: 'INR' }] },
    });
    assert.equal(extracted, null);
  });
});
