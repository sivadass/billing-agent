import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractPrice, PriceExtractError } from '../src/extract/extract-price.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const shopifyFixture = JSON.parse(
  readFileSync(path.join(dir, 'fixtures', 'shopify-product.json'), 'utf8'),
);
const jsonLdHtml = readFileSync(
  path.join(dir, 'fixtures', 'product-json-ld.html'),
  'utf8',
);

describe('extractPrice', () => {
  it('uses shopify json when a product endpoint succeeds', async () => {
    const extracted = await extractPrice({
      url: 'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole',
      fetchJson: async () =>
        ({
          ok: true,
          json: async () => shopifyFixture,
        }) as unknown as Response,
      loadPageHtml: async () => {
        throw new Error('should not load page html when shopify succeeds');
      },
    });
    assert.equal(extracted.source, 'shopify_json');
    assert.equal(extracted.price, 8450);
  });

  it('falls back to page json-ld when shopify extraction fails', async () => {
    const extracted = await extractPrice({
      url: 'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole',
      fetchJson: async () =>
        ({
          ok: true,
          json: async () => ({ product: { title: 'Broken', variants: [{ price: '0' }] } }),
        }) as unknown as Response,
      loadPageHtml: async () => jsonLdHtml,
    });
    assert.equal(extracted.source, 'json_ld');
    assert.equal(extracted.price, 7605);
  });

  it('throws when extraction fails and mistral key is missing', async () => {
    await assert.rejects(
      extractPrice({
        url: 'https://example.com/products/demo',
        loadPageHtml: async () => '<html><body>no usable price here</body></html>',
      }),
      (error: unknown) =>
        error instanceof PriceExtractError &&
        /mistral api key/i.test(error.message),
    );
  });

  it('rejects private and non-http urls before any fetch', async () => {
    for (const url of ['http://127.0.0.1/products/demo', 'file:///etc/passwd']) {
      await assert.rejects(
        extractPrice({
          url,
          fetchJson: async () => {
            throw new Error('should not fetch a non-public url');
          },
          loadPageHtml: async () => {
            throw new Error('should not load a non-public url');
          },
        }),
        (error: unknown) => error instanceof Error,
        url,
      );
    }
  });
});
