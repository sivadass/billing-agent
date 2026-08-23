import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { withBrowser } from '../src/browser.ts';
import type { CaptchaSolver } from '../src/captcha.ts';
import { ScrapeError } from '../src/errors.ts';
import { createPriceExtractStrategies } from '../src/extract/workflow-strategies.ts';
import { runWorkflow } from '../src/workflow/interpreter.ts';
import { validateWorkflow } from '../src/workflow/validate.ts';

const TIMEOUT_MS = 20000;
const dir = path.dirname(fileURLToPath(import.meta.url));
const shopifyPayload = JSON.parse(
  readFileSync(path.join(dir, 'fixtures', 'shopify-product.json'), 'utf8'),
);
const jsonLdHtml = readFileSync(
  path.join(dir, 'fixtures', 'product-json-ld.html'),
  'utf8',
);

const PRODUCT_URL =
  'https://craftandglory.in/products/old-skool-retro-leather-sneakers-vintage-brown-with-white-sole';

const stubSolver: CaptchaSolver = {
  solveFromImageBase64: async () => 'A1B2C',
};

function fixtureUrl(name: string): string {
  return pathToFileURL(path.resolve('fixtures', name)).href;
}

type RunOverrides = Partial<Parameters<typeof runWorkflow>[0]>;

/** Runs steps in a real browser against a repo `fixtures/` page. */
async function runInBrowser(
  steps: unknown,
  overrides: RunOverrides = {},
): Promise<Record<string, unknown>> {
  return withBrowser(
    { headless: true, timeoutMs: TIMEOUT_MS, saveErrorScreenshot: false },
    (page) =>
      runWorkflow({
        page,
        steps: validateWorkflow(steps),
        secrets: {},
        captchaSolver: stubSolver,
        timeoutMs: TIMEOUT_MS,
        ...overrides,
      }),
  );
}

/**
 * A page whose URL is a live Shopify product but whose content is served from
 * a fixture, so the Shopify leg of the cascade is exercised without a browser
 * or a network call.
 */
function stubPage(url: string, html: string): Page {
  return { url: () => url, content: async () => html } as unknown as Page;
}

async function runOnStubPage(
  page: Page,
  steps: unknown,
  overrides: RunOverrides = {},
): Promise<Record<string, unknown>> {
  return runWorkflow({
    page,
    steps: validateWorkflow(steps),
    secrets: {},
    captchaSolver: stubSolver,
    timeoutMs: 1000,
    ...overrides,
  });
}

function extractStep(fields: Array<Record<string, unknown>>) {
  return { id: 'extract-price', type: 'extract', fields };
}

/** The exact extract step `migrate-generic-jobs` writes for a migrated watch. */
const MIGRATED_WATCH_FIELDS = [
  { key: 'price', strategy: 'shopify_json' },
  { key: 'currency', strategy: 'shopify_json' },
  { key: 'price', strategy: 'price' },
];

describe('workflow extract strategies — real page (fixtures, no network)', () => {
  it('extracts price and currency with the "price" cascade from json-ld', async () => {
    const result = await runInBrowser([
      { id: 'goto-product', type: 'goto', url: fixtureUrl('product-json-ld.html') },
      extractStep([
        { key: 'price', strategy: 'price' },
        { key: 'currency', strategy: 'price' },
        { key: 'title', strategy: 'price' },
      ]),
    ]);

    assert.deepEqual(result, { price: 7605, currency: 'INR', title: 'Demo Product' });
  });

  it('falls through the cascade to open graph metadata', async () => {
    const result = await runInBrowser([
      { id: 'goto-product', type: 'goto', url: fixtureUrl('product-og-price.html') },
      extractStep([
        { key: 'price', strategy: 'price' },
        { key: 'currency', strategy: 'price' },
      ]),
    ]);

    assert.deepEqual(result, { price: 8999, currency: 'INR' });
  });

  it('extracts json-ld fields with the "json_ld" strategy', async () => {
    const result = await runInBrowser([
      { id: 'goto-product', type: 'goto', url: fixtureUrl('product-json-ld.html') },
      extractStep([
        { key: 'price', strategy: 'json_ld' },
        { key: 'title', strategy: 'json_ld' },
      ]),
    ]);

    assert.deepEqual(result, { price: 7605, title: 'Demo Product' });
  });

  it('walks repeated keys in order: json_ld misses, the price cascade lands', async () => {
    const result = await runInBrowser([
      { id: 'goto-product', type: 'goto', url: fixtureUrl('product-og-price.html') },
      extractStep([
        { key: 'price', strategy: 'json_ld' },
        { key: 'price', strategy: 'price' },
      ]),
    ]);

    assert.deepEqual(result, { price: 8999 });
  });

  it('fails closed when the requested strategy finds nothing', async () => {
    await assert.rejects(
      runInBrowser([
        { id: 'goto-product', type: 'goto', url: fixtureUrl('product-og-price.html') },
        extractStep([{ key: 'price', strategy: 'json_ld' }]),
      ]),
      (error: unknown) =>
        error instanceof ScrapeError && /price/.test(error.message),
    );
  });

  it('treats a non-positive price as no price at all', async () => {
    for (const strategy of ['price', 'json_ld']) {
      await assert.rejects(
        runInBrowser([
          { id: 'goto-product', type: 'goto', url: fixtureUrl('product-no-price.html') },
          extractStep([{ key: 'price', strategy }]),
        ]),
        (error: unknown) =>
          error instanceof ScrapeError && /price/.test(error.message),
        strategy,
      );
    }
  });

  it('satisfies a watch schema from the deterministic cascade', async () => {
    const result = await runInBrowser(
      [
        { id: 'goto-product', type: 'goto', url: fixtureUrl('product-json-ld.html') },
        extractStep([
          { key: 'price', strategy: 'price' },
          { key: 'currency', strategy: 'price' },
        ]),
      ],
      {
        schema: [
          { key: 'price', label: 'Price', type: 'price' },
          { key: 'currency', label: 'Currency', type: 'string' },
        ],
      },
    );

    assert.equal(result.price, 7605);
    assert.equal(result.currency, 'INR');
  });
});

describe('workflow extract strategies — migrated watch shape', () => {
  it('prefers shopify json and stops the cascade once the key is resolved', async () => {
    let calls = 0;
    const result = await runOnStubPage(
      stubPage(PRODUCT_URL, jsonLdHtml),
      [extractStep(MIGRATED_WATCH_FIELDS)],
      {
        extractStrategies: createPriceExtractStrategies({
          fetchJson: async () => {
            calls += 1;
            return { ok: true, json: async () => shopifyPayload } as unknown as Response;
          },
        }),
      },
    );

    // 8450 is the Shopify payload; the page's JSON-LD says 7605, so this also
    // proves the later `price` candidate never overwrote the first hit.
    assert.deepEqual(result, { price: 8450, currency: 'INR' });
    assert.equal(calls, 1, 'the product json is fetched once for the whole step');
  });

  it('falls back to the price cascade when shopify json is unavailable', async () => {
    const result = await runOnStubPage(
      stubPage(PRODUCT_URL, jsonLdHtml),
      [
        extractStep([
          { key: 'price', strategy: 'shopify_json' },
          { key: 'currency', strategy: 'shopify_json' },
          { key: 'price', strategy: 'price' },
          { key: 'currency', strategy: 'price' },
        ]),
      ],
      {
        extractStrategies: createPriceExtractStrategies({
          fetchJson: async () => ({ ok: false }) as unknown as Response,
        }),
      },
    );

    assert.deepEqual(result, { price: 7605, currency: 'INR' });
  });

  it('names the unresolved key when every candidate for it misses', async () => {
    await assert.rejects(
      runOnStubPage(stubPage(PRODUCT_URL, jsonLdHtml), [extractStep(MIGRATED_WATCH_FIELDS)], {
        extractStrategies: createPriceExtractStrategies({
          fetchJson: async () => ({ ok: false }) as unknown as Response,
        }),
      }),
      (error: unknown) =>
        error instanceof ScrapeError &&
        /currency/.test(error.message) &&
        /shopify_json/.test(error.message),
    );
  });
});

describe('workflow extract strategies — no LLM in scheduled replay', () => {
  it('never calls Mistral, even with a key in the environment', async (t) => {
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input instanceof Request ? input.url : input));
      throw new Error('network is not available to scheduled extract');
    }) as typeof fetch;
    process.env.MISTRAL_API_KEY = 'sk-test-must-not-be-used';
    t.after(() => {
      globalThis.fetch = realFetch;
      delete process.env.MISTRAL_API_KEY;
    });

    const captured = await runOnStubPage(
      stubPage(PRODUCT_URL, '<html><body>price unavailable</body></html>'),
      [extractStep(MIGRATED_WATCH_FIELDS)],
    ).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(captured instanceof ScrapeError, `expected ScrapeError, got ${captured}`);
    assert.ok(
      !requested.some((url) => /mistral/i.test(url)),
      `scheduled extract called an LLM: ${requested.join(', ')}`,
    );
    assert.deepEqual(requested, [`${PRODUCT_URL}.json`]);
  });
});
