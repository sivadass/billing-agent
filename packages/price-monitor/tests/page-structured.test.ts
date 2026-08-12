import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractFromPageHtml } from '../src/extractors/page-structured.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));

describe('extractFromPageHtml', () => {
  it('prefers json-ld product offer prices', () => {
    const html = readFileSync(path.join(dir, 'fixtures', 'product-json-ld.html'), 'utf8');
    const extracted = extractFromPageHtml(html);
    assert.deepEqual(extracted, {
      price: 7605,
      currency: 'INR',
      title: 'Demo Product',
      source: 'json_ld',
    });
  });

  it('falls back to open graph price metadata', () => {
    const extracted = extractFromPageHtml(`
      <html><head>
      <meta property="product:price:amount" content="8999.00" />
      <meta property="product:price:currency" content="INR" />
      <meta property="og:title" content="OG Product" />
      </head></html>
    `);
    assert.deepEqual(extracted, {
      price: 8999,
      currency: 'INR',
      title: 'OG Product',
      source: 'og',
    });
  });
});
