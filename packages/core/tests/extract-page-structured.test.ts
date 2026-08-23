import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  extractFromJsonLd,
  extractFromPageHtml,
} from '../src/extract/page-structured.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsonLdHtml = readFileSync(
  path.join(dir, 'fixtures', 'product-json-ld.html'),
  'utf8',
);

const OG_HTML = `
  <html><head>
  <meta property="product:price:amount" content="8999.00" />
  <meta property="product:price:currency" content="INR" />
  <meta property="og:title" content="OG Product" />
  </head></html>
`;

describe('extractFromPageHtml', () => {
  it('prefers json-ld product offer prices', () => {
    const extracted = extractFromPageHtml(jsonLdHtml);
    assert.deepEqual(extracted, {
      price: 7605,
      currency: 'INR',
      title: 'Demo Product',
      source: 'json_ld',
    });
  });

  it('falls back to open graph price metadata', () => {
    const extracted = extractFromPageHtml(OG_HTML);
    assert.deepEqual(extracted, {
      price: 8999,
      currency: 'INR',
      title: 'OG Product',
      source: 'og',
    });
  });

  it('falls back to price selectors', () => {
    const extracted = extractFromPageHtml(
      '<html><body><span class="product-price">₹1,299.00</span></body></html>',
    );
    assert.deepEqual(extracted, {
      price: 1299,
      currency: 'INR',
      source: 'selector',
    });
  });

  it('returns null when no positive price is present', () => {
    assert.equal(
      extractFromPageHtml('<html><body><span class="price">₹0.00</span></body></html>'),
      null,
    );
    assert.equal(extractFromPageHtml('<html><body>sold out</body></html>'), null);
  });
});

describe('extractFromJsonLd', () => {
  it('reads price, currency and title from a Product offer', () => {
    assert.deepEqual(extractFromJsonLd(jsonLdHtml), {
      price: 7605,
      currency: 'INR',
      title: 'Demo Product',
      source: 'json_ld',
    });
  });

  it('ignores open graph and selector markup', () => {
    assert.equal(extractFromJsonLd(OG_HTML), null);
    assert.equal(
      extractFromJsonLd('<html><body><span class="price">₹1,299.00</span></body></html>'),
      null,
    );
  });

  it('skips non-positive and malformed offers', () => {
    const zeroPrice = `
      <script type="application/ld+json">
        {"@type":"Product","name":"Free","offers":{"price":"0.00","priceCurrency":"INR"}}
      </script>
    `;
    assert.equal(extractFromJsonLd(zeroPrice), null);
    assert.equal(
      extractFromJsonLd('<script type="application/ld+json">{ not json </script>'),
      null,
    );
  });
});
