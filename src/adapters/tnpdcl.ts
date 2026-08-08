import type { Page } from 'playwright';
import { solveCaptchaFromLocator } from '../captcha.js';
import { CaptchaError, LoginError, ScrapeError } from '../errors.js';
import type { AdapterContext, BillingAdapter, BillResult } from './types.js';

/**
 * Selector constants below were locked by fetching the live login page
 * (`curl https://www.tnebnet.org/awp/login`, 2026-08-08). It is an old
 * PrimeFaces/JSF app; the login form fields use stable, hand-written
 * ids/names (unlike the auto-generated `j_idNN` ids used elsewhere on the
 * page), so these selectors should stay valid unless TNPDCL redesigns the
 * login form.
 */
const LOGIN_URL = 'https://www.tnebnet.org/awp/login';

// <input id="userName" name="j_username" type="text" ... />
const USERNAME_SELECTOR = '#userName';
// <input id="password" name="j_password" type="password" ... />
const PASSWORD_SELECTOR = '#password';
// <input id="CaptchaID" name="CaptchaID" maxlength="10" ... />
const CAPTCHA_INPUT_SELECTOR = '#CaptchaID';
// <img id="CaptchaImgID" src="/awp/simpleCaptcha.png" ... />
const CAPTCHA_IMAGE_SELECTOR = '#CaptchaImgID';
// <input name="submit" type="submit" value="Login" ... />
const LOGIN_BUTTON_SELECTOR = 'input[name="submit"][type="submit"]';
// Only inspect dedicated messages inside the login form. The full page always
// contains captcha instructions, which makes body-text classification unsafe.
const LOGIN_ERROR_SELECTOR = [
  '#lin .ui-messages-error-summary',
  '#lin .ui-messages-error-detail',
  '#lin .ui-message-error-detail',
  '#lin [role="alert"]',
  '#lin .error',
  '#lin .errors',
].join(', ');
// The form (`#lin`, action="/awp/logincheck") runs `encryptPassword()` in
// its onsubmit handler, which obfuscates the plaintext password in-place
// before the real POST. We only need to `fill()` the plaintext password;
// the page's own submit handler (which Playwright triggers like a real
// browser) does the rest — no client-side crypto to replicate here.

const MAX_LOGIN_ATTEMPTS = 2;

/**
 * Clicks a locator and waits for the resulting navigation deterministically.
 * `page.waitForLoadState('domcontentloaded')` races with the click: since
 * the current document may already satisfy that load state, `Promise.all`
 * can resolve before the click's navigation even starts. Waiting for the
 * `<html>` element to detach instead only resolves once a *new* document
 * has replaced the current one (full page navigation or reload), so it
 * fires correctly whether the click leads to a different page or the same
 * page re-rendered (e.g. a login form re-posted with an error).
 */
async function clickAndWaitForNavigation(
  page: Page,
  locator: ReturnType<Page['locator']>,
  timeoutMs: number,
): Promise<void> {
  await Promise.all([
    page
      .locator('html')
      .waitFor({ state: 'detached', timeout: timeoutMs })
      .catch(() => {}),
    locator.click(),
  ]);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

/**
 * The post-login bill summary page could NOT be inspected live (it
 * requires a real, registered TNPDCL account) so there are no locked
 * selectors for it. Instead we scrape by matching label text anywhere in
 * the page body, which is more resilient to unknown/changing markup than
 * brittle CSS selectors. Each field lists a few label phrasings commonly
 * seen on TANGEDCO/TNPDCL bill pages; adjust here (only) once the real
 * page is inspected manually.
 */
const FIELD_PATTERNS: Record<string, RegExp[]> = {
  amount: [
    /bill\s*amount[^\d₹]{0,10}(₹?\s?[\d,]+(?:\.\d+)?)/i,
    /amount\s*payable[^\d₹]{0,10}(₹?\s?[\d,]+(?:\.\d+)?)/i,
    /net\s*amount[^\d₹]{0,10}(₹?\s?[\d,]+(?:\.\d+)?)/i,
  ],
  account: [
    /(?:consumer|service)\s*(?:no\.?|number|id)\s*[:\-]?\s*([A-Za-z0-9\-]{4,})/i,
  ],
  dueDate: [/due\s*date\s*[:\-]?\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/i],
  billPeriod: [/bill\s*(?:period|month)\s*[:\-]?\s*([A-Za-z0-9/\-\s]{3,20})/i],
  status: [/(?:bill\s*)?status\s*[:\-]?\s*(paid|unpaid|due|pending|overdue)/i],
};

/** `1234567890` -> `****7890`. Exported for unit testing and reuse by notify formatting. */
export function maskAccount(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 4) return '****';
  return `****${trimmed.slice(-4)}`;
}

export function classifyLoginFailure(message: string): 'captcha' | 'login' {
  const captchaRejection =
    /\bcaptcha(?:\s+(?:code|response|text|value|entry))?\s*(?:is|was|:|-)?\s*(?:invalid|incorrect|wrong|mismatch(?:ed)?)\b|\b(?:invalid|incorrect|wrong|mismatch(?:ed)?)\s+(?:for\s+)?(?:the\s+)?captcha\b/i;
  return captchaRejection.test(message.trim()) ? 'captcha' : 'login';
}

function tryExtractField(pageText: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pageText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractRequiredField(
  pageText: string,
  fieldName: string,
  patterns: RegExp[],
): string {
  const value = tryExtractField(pageText, patterns);
  if (value === undefined) {
    throw new ScrapeError(`tnpdcl: could not locate "${fieldName}" on the bill page`);
  }
  return value;
}

function normalizeAmount(raw: string): string {
  return raw.startsWith('₹') ? raw : `₹${raw}`;
}

async function navigateToBillPageIfNeeded(page: Page, ctx: AdapterContext): Promise<void> {
  try {
    const billLink = page
      .locator('a', { hasText: /view\s*bill|my\s*bills?|bill\s*details/i })
      .first();
    if ((await billLink.count()) > 0) {
      await clickAndWaitForNavigation(page, billLink, ctx.timeoutMs);
    }
  } catch (err) {
    ctx.logger.warn('tnpdcl: bill page navigation link not found, scraping current page', {
      error: String(err),
    });
  }
}

async function scrapeBill(page: Page, ctx: AdapterContext): Promise<BillResult> {
  await navigateToBillPageIfNeeded(page, ctx);

  const pageText = await page.locator('body').innerText();

  const amount = extractRequiredField(pageText, 'amount', FIELD_PATTERNS.amount);
  const accountRaw = extractRequiredField(pageText, 'account', FIELD_PATTERNS.account);

  return {
    provider: 'tnpdcl',
    amount: normalizeAmount(amount),
    dueDate: tryExtractField(pageText, FIELD_PATTERNS.dueDate),
    billPeriod: tryExtractField(pageText, FIELD_PATTERNS.billPeriod),
    status: tryExtractField(pageText, FIELD_PATTERNS.status),
    accountLabel: maskAccount(accountRaw),
  };
}

async function attemptLoginAndScrape(ctx: AdapterContext): Promise<BillResult> {
  const { page, credentials, captchaSolver } = ctx;
  const { username, password } = credentials;
  if (!username || !password) {
    throw new LoginError(
      'tnpdcl adapter requires "username" and "password" credentials',
    );
  }

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  await page.locator(USERNAME_SELECTOR).fill(username);
  await page.locator(PASSWORD_SELECTOR).fill(password);

  const captchaText = await solveCaptchaFromLocator(
    page.locator(CAPTCHA_IMAGE_SELECTOR),
    captchaSolver,
  );
  await page.locator(CAPTCHA_INPUT_SELECTOR).fill(captchaText);

  await clickAndWaitForNavigation(
    page,
    page.locator(LOGIN_BUTTON_SELECTOR),
    ctx.timeoutMs,
  );

  const stillOnLoginForm = (await page.locator(USERNAME_SELECTOR).count()) > 0;
  if (stillOnLoginForm) {
    const messages = await page.locator(LOGIN_ERROR_SELECTOR).allInnerTexts();
    if (messages.some((message) => classifyLoginFailure(message) === 'captcha')) {
      throw new CaptchaError('tnpdcl login rejected the captcha response');
    }
    throw new LoginError('tnpdcl login failed: still on login page after submit');
  }

  return scrapeBill(page, ctx);
}

export const tnpdclAdapter: BillingAdapter = {
  id: 'tnpdcl',

  async run(ctx: AdapterContext): Promise<BillResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
      try {
        return await attemptLoginAndScrape(ctx);
      } catch (err) {
        lastError = err;
        if (
          attempt === MAX_LOGIN_ATTEMPTS ||
          !(err instanceof CaptchaError || err instanceof LoginError)
        ) {
          throw err;
        }
        ctx.logger.warn('tnpdcl login/captcha retry', { attempt });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new LoginError('tnpdcl: exhausted login attempts');
  },
};
