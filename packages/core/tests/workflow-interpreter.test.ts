import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { withBrowser } from '../src/browser.ts';
import type { CaptchaSolver } from '../src/captcha.ts';
import {
  CaptchaError,
  ConfigError,
  LoginError,
  ScrapeError,
  TimeoutError,
} from '../src/errors.ts';
import { runWorkflow } from '../src/workflow/interpreter.ts';
import { validateWorkflow } from '../src/workflow/validate.ts';

const TIMEOUT_MS = 20000;
const FIXTURE_PATH = resolve('fixtures/login-extract.html');
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;
const PASSWORD = 'pl4in-text-passw0rd';

const stubSolver: CaptchaSolver = {
  solveFromImageBase64: async () => 'A1B2C',
};

type RunOverrides = Partial<Parameters<typeof runWorkflow>[0]>;

/** Runs steps through `validateWorkflow` first so tests exercise the real path. */
async function run(
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

/** Collects every string an operator could plausibly see for a thrown error. */
function errorSurface(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    parts.push(String(current));
    if (current instanceof Error) {
      parts.push(current.message, current.stack ?? '');
      parts.push(
        JSON.stringify(current, Object.getOwnPropertyNames(current)) ?? '',
      );
      current = current.cause;
    } else {
      break;
    }
  }
  return parts.join('\n');
}

function gotoFixture(id = 'goto-fixture') {
  return { id, type: 'goto', url: FIXTURE_URL };
}

describe('validateWorkflow', () => {
  it('accepts the canonical sivadass.in workflow and returns a detached copy', () => {
    const input = [
      { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'extract-email',
        type: 'extract',
        fields: [
          { key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' },
        ],
      },
    ];

    const steps = validateWorkflow(structuredClone(input));

    assert.deepEqual(steps, input);
    assert.notEqual(steps[0], input[0]);
  });

  it('accepts every step type', () => {
    const steps = validateWorkflow([
      { id: 's1', type: 'goto', url: 'https://sivadass.in/' },
      { id: 's2', type: 'fill', selector: '#u', source: 'literal', value: 'x' },
      {
        id: 's3',
        type: 'fill',
        selector: '#p',
        source: 'secret',
        secretKey: 'password',
      },
      { id: 's4', type: 'click', selector: '#go' },
      { id: 's5', type: 'wait', selector: '#panel' },
      { id: 's6', type: 'wait', timeoutMs: 50 },
      {
        id: 's7',
        type: 'solve_captcha',
        imageSelector: '#captcha-image',
        inputSelector: '#captcha',
      },
      { id: 's8', type: 'extract', fields: [{ key: 'price', strategy: 'price' }] },
      { id: 's9', type: 'assert', selector: '#panel', exists: true },
    ]);

    assert.equal(steps.length, 9);
  });

  it('rejects malformed step containers', () => {
    for (const bad of [null, undefined, 'steps', {}, [null], ['goto'], [[]]]) {
      assert.throws(() => validateWorkflow(bad), ConfigError, String(bad));
    }
  });

  it('rejects missing, blank, and duplicate step ids', () => {
    assert.throws(
      () => validateWorkflow([{ type: 'click', selector: '#a' }]),
      ConfigError,
    );
    assert.throws(
      () => validateWorkflow([{ id: '  ', type: 'click', selector: '#a' }]),
      ConfigError,
    );
    assert.throws(
      () =>
        validateWorkflow([
          { id: 'dup', type: 'click', selector: '#a' },
          { id: 'dup', type: 'click', selector: '#b' },
        ]),
      ConfigError,
    );
  });

  it('rejects unknown step types and unknown properties', () => {
    assert.throws(
      () => validateWorkflow([{ id: 's1', type: 'screenshot' }]),
      ConfigError,
    );
    assert.throws(
      () =>
        validateWorkflow([
          { id: 's1', type: 'click', selector: '#a', script: 'alert(1)' },
        ]),
      ConfigError,
    );
  });

  it('rejects malformed goto urls', () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://localhost:3000/',
      'https://user:pw@example.com/',
      'https://metadata.internal/',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'not a url',
      '',
    ]) {
      assert.throws(
        () => validateWorkflow([{ id: 'g', type: 'goto', url }]),
        ConfigError,
        url,
      );
    }
  });

  it('rejects malformed fill steps', () => {
    const bad = [
      { id: 'f', type: 'fill', source: 'literal', value: 'x' },
      { id: 'f', type: 'fill', selector: '#u', source: 'env', value: 'x' },
      { id: 'f', type: 'fill', selector: '#u', source: 'literal' },
      { id: 'f', type: 'fill', selector: '#u', source: 'secret' },
      {
        id: 'f',
        type: 'fill',
        selector: '#u',
        source: 'secret',
        secretKey: '',
      },
      {
        id: 'f',
        type: 'fill',
        selector: '#u',
        source: 'secret',
        secretKey: 'password',
        value: 'literal-too',
      },
      {
        id: 'f',
        type: 'fill',
        selector: '#u',
        source: 'literal',
        value: 'x',
        secretKey: 'password',
      },
    ];
    for (const step of bad) {
      assert.throws(() => validateWorkflow([step]), ConfigError, JSON.stringify(step));
    }
  });

  it('rejects malformed wait steps', () => {
    for (const step of [
      { id: 'w', type: 'wait' },
      { id: 'w', type: 'wait', timeoutMs: 0 },
      { id: 'w', type: 'wait', timeoutMs: -5 },
      { id: 'w', type: 'wait', timeoutMs: 1.5 },
      { id: 'w', type: 'wait', timeoutMs: 10_000_000 },
      { id: 'w', type: 'wait', selector: '' },
    ]) {
      assert.throws(() => validateWorkflow([step]), ConfigError, JSON.stringify(step));
    }
  });

  it('rejects malformed extract steps', () => {
    for (const step of [
      { id: 'e', type: 'extract' },
      { id: 'e', type: 'extract', fields: [] },
      { id: 'e', type: 'extract', fields: [{ selector: '#a' }] },
      { id: 'e', type: 'extract', fields: [{ key: 'a', strategy: 'llm' }] },
      { id: 'e', type: 'extract', fields: [{ key: 'a', strategy: 'text' }] },
      { id: 'e', type: 'extract', fields: [{ key: 'a' }] },
      {
        id: 'e',
        type: 'extract',
        fields: [
          { key: 'a', selector: '#a' },
          { key: 'a', selector: '#b' },
        ],
      },
    ]) {
      assert.throws(() => validateWorkflow([step]), ConfigError, JSON.stringify(step));
    }
  });

  it('rejects malformed solve_captcha and assert steps', () => {
    for (const step of [
      { id: 'c', type: 'solve_captcha', imageSelector: '#i' },
      { id: 'c', type: 'solve_captcha', inputSelector: '#c' },
      { id: 'a', type: 'assert', selector: '#p' },
      { id: 'a', type: 'assert', selector: '#p', exists: false },
      { id: 'a', type: 'assert', exists: true },
    ]) {
      assert.throws(() => validateWorkflow([step]), ConfigError, JSON.stringify(step));
    }
  });
});

describe('runWorkflow — live smoke (network: https://sivadass.in/)', () => {
  it('extracts the contact email from the canonical test site', async () => {
    const result = await run([
      { id: 'goto-home', type: 'goto', url: 'https://sivadass.in/' },
      {
        id: 'extract-email',
        type: 'extract',
        fields: [
          { key: 'email', selector: 'a[href^="mailto:"]', strategy: 'text' },
        ],
      },
    ]);

    assert.equal(
      String(result.email).trim().toLowerCase(),
      'contact@sivadass.in',
    );
  });
});

describe('runWorkflow — goto url restrictions', () => {
  it('loads a file: url inside the repo fixtures directory', async () => {
    const result = await run([
      gotoFixture(),
      {
        id: 'extract-email',
        type: 'extract',
        fields: [
          { key: 'email', selector: '[data-testid="account-email"]', strategy: 'text' },
        ],
      },
    ]);

    assert.equal(result.email, 'Contact@Example.COM');
  });

  it('rejects file: urls outside the fixtures directory', async () => {
    await assert.rejects(
      run([
        {
          id: 'g',
          type: 'goto',
          url: pathToFileURL(resolve('package.json')).href,
        },
      ]),
      (error: unknown) =>
        error instanceof ConfigError && /fixtures/i.test(error.message),
    );
  });

  it('rejects path traversal out of the fixtures directory', async () => {
    await assert.rejects(
      run([
        {
          id: 'g',
          type: 'goto',
          url: `${pathToFileURL(resolve('fixtures')).href}/../package.json`,
        },
      ]),
      (error: unknown) => error instanceof ConfigError,
    );
  });

  it('rejects a symlink inside fixtures that escapes the fixtures directory', async (t) => {
    const linkPath = resolve('fixtures/escape-link.html');
    symlinkSync(resolve('package.json'), linkPath);
    t.after(() => {
      unlinkSync(linkPath);
    });

    await assert.rejects(
      run([{ id: 'g', type: 'goto', url: pathToFileURL(linkPath).href }]),
      (error: unknown) => error instanceof ConfigError,
    );
  });
});

describe('runWorkflow — login path (local fixture only)', () => {
  it('fills literal and secret values, solves the captcha, clicks, waits, asserts and extracts', async () => {
    const seen: string[] = [];
    const solver: CaptchaSolver = {
      solveFromImageBase64: async (base64Png) => {
        seen.push(base64Png);
        return 'A1B2C';
      },
    };

    const steps = validateWorkflow([
      gotoFixture(),
      {
        id: 'fill-username',
        type: 'fill',
        selector: '#username',
        source: 'literal',
        value: 'demo-user',
      },
      {
        id: 'fill-password',
        type: 'fill',
        selector: '#password',
        source: 'secret',
        secretKey: 'password',
      },
      {
        id: 'solve-captcha',
        type: 'solve_captcha',
        imageSelector: '#captcha-image',
        inputSelector: '#captcha',
      },
      { id: 'open-account', type: 'click', selector: '#account-toggle' },
      { id: 'wait-panel', type: 'wait', selector: '#account-panel' },
      { id: 'assert-panel', type: 'assert', selector: '#account-panel', exists: true },
      {
        id: 'extract-account',
        type: 'extract',
        fields: [
          { key: 'email', selector: '[data-testid="account-email"]', strategy: 'text' },
          { key: 'balance', selector: '[data-testid="account-balance"]' },
        ],
      },
    ]);

    const { result, values } = await withBrowser(
      { headless: true, timeoutMs: TIMEOUT_MS, saveErrorScreenshot: false },
      async (page) => {
        const workflowResult = await runWorkflow({
          page,
          steps,
          secrets: { password: PASSWORD },
          captchaSolver: solver,
          timeoutMs: TIMEOUT_MS,
        });
        return {
          result: workflowResult,
          values: {
            username: await page.inputValue('#username'),
            password: await page.inputValue('#password'),
            captcha: await page.inputValue('#captcha'),
          },
        };
      },
    );

    assert.equal(values.username, 'demo-user');
    assert.equal(values.password, PASSWORD);
    assert.equal(values.captcha, 'A1B2C');
    assert.equal(result.email, 'Contact@Example.COM');
    assert.equal(result.balance, '₹1,234.50');

    assert.equal(seen.length, 1);
    const png = Buffer.from(seen[0], 'base64');
    assert.ok(png.byteLength > 0);
    assert.deepEqual(
      [...png.subarray(0, 4)],
      [0x89, 0x50, 0x4e, 0x47],
      'solver receives PNG screenshot bytes',
    );
  });

  it('throws LoginError without the secret when the secret is not provided', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          {
            id: 'fill-password',
            type: 'fill',
            selector: '#password',
            source: 'secret',
            secretKey: 'password',
          },
        ],
        { secrets: {} },
      ),
      (error: unknown) => {
        assert.ok(error instanceof LoginError, 'expected LoginError');
        assert.match(error.message, /password/);
        return true;
      },
    );
  });

  it('never leaks the secret plaintext when a step fails after the fill', async () => {
    const captured = await run(
      [
        gotoFixture(),
        {
          id: 'fill-password',
          type: 'fill',
          selector: '#password',
          source: 'secret',
          secretKey: 'password',
        },
        { id: 'click-missing', type: 'click', selector: '#no-such-button' },
      ],
      { secrets: { password: PASSWORD }, timeoutMs: 1500 },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(captured, 'workflow should have failed');
    const surface = errorSurface(captured);
    assert.ok(!surface.includes(PASSWORD), 'secret leaked into error surface');
  });

  it('redacts the secret out of an underlying error message', async () => {
    const captured = await run(
      [
        gotoFixture(),
        {
          id: 'fill-password',
          type: 'fill',
          selector: '#password',
          source: 'secret',
          secretKey: 'password',
        },
        {
          id: 'extract-price',
          type: 'extract',
          fields: [{ key: 'price', strategy: 'price' }],
        },
      ],
      {
        secrets: { password: PASSWORD },
        extractStrategies: {
          price: async () => {
            throw new Error(`upstream rejected credentials ${PASSWORD}`);
          },
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(captured instanceof Error, 'workflow should have failed');
    assert.match(captured.message, /upstream rejected credentials \*\*\*/);
    const surface = errorSurface(captured);
    assert.ok(!surface.includes(PASSWORD), 'secret leaked into error surface');
  });

  it('never leaks the secret plaintext into logs', async () => {
    const lines: string[] = [];
    const logger = {
      info: (message: string, extra?: Record<string, unknown>) =>
        lines.push(`${message} ${JSON.stringify(extra ?? {})}`),
      warn: (message: string, extra?: Record<string, unknown>) =>
        lines.push(`${message} ${JSON.stringify(extra ?? {})}`),
      error: (message: string, extra?: Record<string, unknown>) =>
        lines.push(`${message} ${JSON.stringify(extra ?? {})}`),
    };

    await run(
      [
        gotoFixture(),
        {
          id: 'fill-password',
          type: 'fill',
          selector: '#password',
          source: 'secret',
          secretKey: 'password',
        },
      ],
      { secrets: { password: PASSWORD }, logger },
    );

    assert.ok(lines.length > 0, 'expected step logging');
    assert.ok(
      !lines.join('\n').includes(PASSWORD),
      'secret leaked into logs',
    );
  });

  it('surfaces captcha solver failures as CaptchaError', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          {
            id: 'solve-captcha',
            type: 'solve_captcha',
            imageSelector: '#captcha-image',
            inputSelector: '#captcha',
          },
        ],
        {
          captchaSolver: {
            solveFromImageBase64: async () => {
              throw new CaptchaError('empty captcha response');
            },
          },
        },
      ),
      CaptchaError,
    );
  });
});

describe('runWorkflow — wait semantics', () => {
  it('waits for a timeout when no selector is given', async () => {
    const startedAt = Date.now();
    await run([gotoFixture(), { id: 'pause', type: 'wait', timeoutMs: 250 }]);
    assert.ok(
      Date.now() - startedAt >= 250,
      'wait step should block for timeoutMs',
    );
  });

  it('throws TimeoutError when the selector never becomes visible', async () => {
    await assert.rejects(
      run([
        gotoFixture(),
        { id: 'wait-hidden', type: 'wait', selector: '#never-visible', timeoutMs: 600 },
      ]),
      TimeoutError,
    );
  });
});

describe('runWorkflow — assert semantics', () => {
  it('throws ScrapeError for a failed assert with no credentialed step', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          { id: 'assert-missing', type: 'assert', selector: '#no-such-node', exists: true },
        ],
        { timeoutMs: 1500 },
      ),
      ScrapeError,
    );
  });

  it('throws LoginError for a failed assert after a secret fill', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          {
            id: 'fill-password',
            type: 'fill',
            selector: '#password',
            source: 'secret',
            secretKey: 'password',
          },
          { id: 'assert-dashboard', type: 'assert', selector: '#dashboard', exists: true },
        ],
        { secrets: { password: PASSWORD }, timeoutMs: 1500 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof LoginError, 'expected LoginError');
        assert.ok(!errorSurface(error).includes(PASSWORD));
        return true;
      },
    );
  });
});

describe('runWorkflow — extract failures and strategy seam', () => {
  it('throws ScrapeError when a field selector matches nothing', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          {
            id: 'extract-missing',
            type: 'extract',
            fields: [{ key: 'email', selector: '#no-such-node', strategy: 'text' }],
          },
        ],
        { timeoutMs: 1500 },
      ),
      (error: unknown) =>
        error instanceof ScrapeError && /email/.test(error.message),
    );
  });

  it('throws ScrapeError when the extracted text is empty', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          { id: 'open-account', type: 'click', selector: '#account-toggle' },
          {
            id: 'extract-empty',
            type: 'extract',
            fields: [
              { key: 'blank', selector: '[data-testid="empty-field"]', strategy: 'text' },
            ],
          },
        ],
        { timeoutMs: 1500 },
      ),
      ScrapeError,
    );
  });

  it('throws ScrapeError when a strategy has no registered handler', async () => {
    await assert.rejects(
      run([
        gotoFixture(),
        {
          id: 'extract-price',
          type: 'extract',
          fields: [{ key: 'price', strategy: 'price' }],
        },
      ]),
      (error: unknown) =>
        error instanceof ScrapeError && /price/.test(error.message),
    );
  });

  it('uses an injected strategy handler for price / json_ld / shopify_json', async () => {
    const calls: string[] = [];
    const result = await run(
      [
        gotoFixture(),
        {
          id: 'extract-price',
          type: 'extract',
          fields: [
            { key: 'price', strategy: 'price' },
            { key: 'sku', selector: '#account', strategy: 'json_ld' },
          ],
        },
      ],
      {
        extractStrategies: {
          price: async ({ field }) => {
            calls.push(field.key);
            return 1234.5;
          },
          json_ld: async ({ field }) => {
            calls.push(field.key);
            return 'sku-42';
          },
        },
      },
    );

    assert.deepEqual(calls, ['price', 'sku']);
    assert.equal(result.price, 1234.5);
    assert.equal(result.sku, 'sku-42');
  });

  it('throws ScrapeError when a required schema key was never extracted', async () => {
    await assert.rejects(
      run(
        [
          gotoFixture(),
          { id: 'open-account', type: 'click', selector: '#account-toggle' },
          {
            id: 'extract-email',
            type: 'extract',
            fields: [
              { key: 'email', selector: '[data-testid="account-email"]', strategy: 'text' },
            ],
          },
        ],
        {
          schema: [
            { key: 'email', label: 'Email', type: 'string' },
            { key: 'amount', label: 'Amount', type: 'price' },
          ],
        },
      ),
      (error: unknown) =>
        error instanceof ScrapeError && /amount/.test(error.message),
    );
  });
});

describe('workflow module boundaries', () => {
  const sources = [
    'packages/core/src/workflow/interpreter.ts',
    'packages/core/src/workflow/validate.ts',
    'packages/core/src/workflow/extract-strategies.ts',
    'packages/core/src/workflow/goto-url.ts',
    'packages/core/src/workflow/types.ts',
  ].map((file) => ({ file, text: readFileSync(resolve(file), 'utf8') }));

  function importSpecifiers(text: string): string[] {
    return [
      ...text.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1]);
  }

  it('never imports Mistral, price-monitor, or app code', () => {
    for (const { file, text } of sources) {
      for (const specifier of importSpecifiers(text)) {
        assert.ok(
          !/mistral/i.test(specifier),
          `${file} must not import Mistral (${specifier})`,
        );
        assert.ok(
          !/price-monitor|apps\/|authoring/.test(specifier),
          `${file} must not import ${specifier}`,
        );
      }
    }
  });

  it('never evaluates JavaScript in the page', () => {
    for (const { file, text } of sources) {
      assert.ok(!/\beval\(/.test(text), `${file} must not call eval`);
      assert.ok(!/new Function\(/.test(text), `${file} must not build functions`);
      assert.ok(
        !/\.(evaluate|evaluateHandle|addScriptTag)\(/.test(text),
        `${file} must not inject page scripts`,
      );
    }
  });
});
