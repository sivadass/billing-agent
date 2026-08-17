import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import { ScrapeError } from '../src/errors.ts';
import {
  createPriceExtractStrategies,
  priceExtractStrategies,
  priceFieldForKey,
} from '../src/extract/workflow-strategies.ts';
import {
  defaultExtractStrategies,
  resolveExtractStrategy,
  type ExtractStrategyHandler,
} from '../src/workflow/extract-strategies.ts';
import type { ExtractStrategy } from '../src/workflow/types.ts';

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
const PRODUCT_JSON_URL = `${PRODUCT_URL}.json`;

const OG_HTML = `
  <html><head>
  <meta property="product:price:amount" content="8999.00" />
  <meta property="product:price:currency" content="INR" />
  <meta property="og:title" content="OG Product" />
  </head></html>
`;

/**
 * The strategies only ever read `url()` and `content()` off the page, so a
 * plain object stands in for a browser here and keeps these tests hermetic.
 */
function stubPage(url: string, html = '<html><body>nothing</body></html>'): Page {
  return {
    url: () => url,
    content: async () => html,
  } as unknown as Page;
}

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as unknown as Response;
}

function run(
  handler: ExtractStrategyHandler,
  page: Page,
  key: string,
): Promise<string | number | null | undefined> {
  return handler({ page, field: { key }, stepId: 'extract-price', timeoutMs: 1000 });
}

describe('priceFieldForKey', () => {
  it('maps a field key onto the part of the extracted price it asks for', () => {
    assert.equal(priceFieldForKey('price'), 'price');
    assert.equal(priceFieldForKey('amount'), 'price');
    assert.equal(priceFieldForKey('currency'), 'currency');
    assert.equal(priceFieldForKey('priceCurrency'), 'currency');
    assert.equal(priceFieldForKey('title'), 'title');
    assert.equal(priceFieldForKey('productTitle'), 'title');
  });
});

describe('shopify_json strategy', () => {
  it('returns price, currency and title from the product json endpoint', async () => {
    const requested: string[] = [];
    const { shopify_json } = createPriceExtractStrategies({
      fetchJson: async (input) => {
        requested.push(String(input));
        return jsonResponse(shopifyPayload);
      },
    });

    assert.equal(await run(shopify_json, stubPage(PRODUCT_URL), 'price'), 8450);
    assert.equal(await run(shopify_json, stubPage(PRODUCT_URL), 'currency'), 'INR');
    assert.equal(
      await run(shopify_json, stubPage(PRODUCT_URL), 'title'),
      'Old Skool Retro Leather Sneakers (Vintage Brown With White Sole)',
    );
    assert.deepEqual(new Set(requested), new Set([PRODUCT_JSON_URL]));
  });

  it('fetches the product json once per page even for several fields', async () => {
    let calls = 0;
    const { shopify_json } = createPriceExtractStrategies({
      fetchJson: async () => {
        calls += 1;
        return jsonResponse(shopifyPayload);
      },
    });

    const page = stubPage(PRODUCT_URL);
    assert.equal(await run(shopify_json, page, 'price'), 8450);
    assert.equal(await run(shopify_json, page, 'currency'), 'INR');
    assert.equal(calls, 1);

    assert.equal(await run(shopify_json, stubPage(PRODUCT_URL), 'price'), 8450);
    assert.equal(calls, 2, 'a different page must not reuse the cached payload');
  });

  it('misses (never throws) when the endpoint is unusable', async () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ['non-ok response', async () => jsonResponse({}, false)],
      ['transport failure', async () => {
        throw new Error('socket hang up');
      }],
      ['unparseable payload', async () =>
        ({
          ok: true,
          json: async () => {
            throw new SyntaxError('unexpected token');
          },
        }) as unknown as Response],
      ['non-positive price', async () =>
        jsonResponse({ product: { title: 'Broken', variants: [{ price: '0' }] } })],
    ];

    for (const [label, fetchJson] of cases) {
      const { shopify_json } = createPriceExtractStrategies({ fetchJson });
      assert.equal(
        await run(shopify_json, stubPage(PRODUCT_URL), 'price'),
        undefined,
        label,
      );
    }
  });

  it('does not fetch for non-product, private, or non-http page urls', async () => {
    const { shopify_json } = createPriceExtractStrategies({
      fetchJson: async () => {
        throw new Error('should not fetch');
      },
    });

    for (const url of [
      'https://craftandglory.in/collections/shoes',
      'http://127.0.0.1/products/demo',
      'http://localhost:3000/products/demo',
      pathToFileURL(path.resolve('fixtures/login-extract.html')).href,
    ]) {
      assert.equal(await run(shopify_json, stubPage(url), 'price'), undefined, url);
    }
  });
});

describe('json_ld strategy', () => {
  it('reads the schema.org product offer off the loaded page', async () => {
    const page = stubPage(PRODUCT_URL, jsonLdHtml);
    assert.equal(await run(priceExtractStrategies.json_ld, page, 'price'), 7605);
    assert.equal(await run(priceExtractStrategies.json_ld, page, 'currency'), 'INR');
    assert.equal(
      await run(priceExtractStrategies.json_ld, page, 'title'),
      'Demo Product',
    );
  });

  it('misses on open graph or selector-only markup', async () => {
    assert.equal(
      await run(priceExtractStrategies.json_ld, stubPage(PRODUCT_URL, OG_HTML), 'price'),
      undefined,
    );
    assert.equal(
      await run(
        priceExtractStrategies.json_ld,
        stubPage(PRODUCT_URL, '<span class="price">₹1,299</span>'),
        'price',
      ),
      undefined,
    );
  });

  it('never fetches anything', async () => {
    const { json_ld } = createPriceExtractStrategies({
      fetchJson: async () => {
        throw new Error('json_ld must not fetch');
      },
    });
    assert.equal(await run(json_ld, stubPage(PRODUCT_URL, jsonLdHtml), 'price'), 7605);
  });
});

describe('price strategy (deterministic cascade)', () => {
  it('prefers shopify json over the page markup', async () => {
    const { price } = createPriceExtractStrategies({
      fetchJson: async () => jsonResponse(shopifyPayload),
    });
    assert.equal(await run(price, stubPage(PRODUCT_URL, jsonLdHtml), 'price'), 8450);
  });

  it('falls back to json-ld, then open graph, then price selectors', async () => {
    const { price } = createPriceExtractStrategies({
      fetchJson: async () => jsonResponse({}, false),
    });

    assert.equal(await run(price, stubPage(PRODUCT_URL, jsonLdHtml), 'price'), 7605);
    assert.equal(await run(price, stubPage(PRODUCT_URL, OG_HTML), 'price'), 8999);
    assert.equal(await run(price, stubPage(PRODUCT_URL, OG_HTML), 'currency'), 'INR');
    assert.equal(
      await run(
        price,
        stubPage(PRODUCT_URL, '<span class="product-price">₹1,299.00</span>'),
        'price',
      ),
      1299,
    );
  });

  it('misses when the page only offers a non-positive price', async () => {
    const { price } = createPriceExtractStrategies({
      fetchJson: async () => jsonResponse({}, false),
    });

    for (const html of [
      '<span class="price">₹0.00</span>',
      '<span class="price">₹-49.00</span>',
      `<script type="application/ld+json">
        {"@type":"Product","name":"Free","offers":{"price":"0","priceCurrency":"INR"}}
      </script>`,
    ]) {
      assert.equal(await run(price, stubPage(PRODUCT_URL, html), 'price'), undefined, html);
    }
  });
});

describe('extract strategy registry', () => {
  it('registers every canonical strategy by default', () => {
    const canonical: ExtractStrategy[] = ['text', 'price', 'json_ld', 'shopify_json'];
    for (const strategy of canonical) {
      assert.equal(
        typeof defaultExtractStrategies[strategy],
        'function',
        `strategy "${strategy}" must be registered`,
      );
    }
  });

  it('fails closed for a strategy with no handler', () => {
    assert.throws(
      () => resolveExtractStrategy({}, 'price', 'extract-price', 'price'),
      (error: unknown) =>
        error instanceof ScrapeError && /price/.test(error.message),
    );
  });
});

describe('deterministic strategy boundaries', () => {
  const ROOTS = [
    'packages/core/src/workflow/extract-strategies.ts',
    'packages/core/src/extract/workflow-strategies.ts',
  ];

  /** Import specifiers of every runtime (non `import type`) import. */
  function runtimeImports(text: string): string[] {
    const withoutTypeImports = text.replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '');
    return [
      ...withoutTypeImports.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
  }

  /** Every source file the roots pull in at run time, transitively. */
  function importClosure(roots: string[]): { files: string[]; packages: string[] } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = roots.map((root) => path.resolve(root));

    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (files.has(file)) continue;
      files.add(file);
      for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('.')) {
          packages.add(specifier);
          continue;
        }
        queue.push(
          path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')),
        );
      }
    }
    return { files: [...files], packages: [...packages] };
  }

  it('never reaches the LLM extractor or Mistral at run time', () => {
    const { files, packages } = importClosure(ROOTS);

    for (const file of files) {
      assert.ok(
        !/llm/i.test(path.basename(file)),
        `scheduled extract must not load ${file}`,
      );
      assert.ok(
        !/mistral\.ai|@mistralai|mistralApiKey/i.test(readFileSync(file, 'utf8')),
        `${file} must not talk to Mistral`,
      );
    }
    for (const specifier of packages) {
      assert.ok(
        !/mistral/i.test(specifier),
        `scheduled extract must not import ${specifier}`,
      );
      assert.ok(
        !/price-monitor|apps\//.test(specifier),
        `core must not import ${specifier}`,
      );
    }
  });

  it('never evaluates JavaScript in the page', () => {
    for (const file of importClosure(ROOTS).files) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/\beval\(/.test(text), `${file} must not call eval`);
      assert.ok(!/new Function\(/.test(text), `${file} must not build functions`);
      assert.ok(
        !/\.(evaluate|evaluateHandle|addScriptTag)\(/.test(text),
        `${file} must not inject page scripts`,
      );
    }
  });
});
