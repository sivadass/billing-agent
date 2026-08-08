# Task 11: TNPDCL adapter — Report

## Status
Complete. `src/adapters/tnpdcl.ts` implements the full login → captcha → scrape flow and is registered in `registerBuiltInAdapters`. Type-check (`tsc --noEmit`) and full test suite pass (28/28).

## Selector research
Fetched the live login page (`curl https://www.tnebnet.org/awp/login`) and `login_validate.js`. It's an old PrimeFaces/JSF app with stable hand-written ids, now locked as named constants at the top of `tnpdcl.ts`:
- `#userName` (name `j_username`), `#password` (name `j_password`)
- `#CaptchaID` (text input, maxlength 10), `#CaptchaImgID` (`<img>` for the screenshot)
- `input[name="submit"][type="submit"]` for the login button
- Confirmed the form's `onsubmit="encryptPassword()"` does client-side password obfuscation in-browser before POST — Playwright filling the plaintext field is sufficient since it runs like a real browser.

The **post-login bill page** could not be inspected (requires a real registered account), so scraping uses label-text regex matching over `body.innerText()` (several phrasing variants per field) instead of brittle CSS selectors, and throws `ScrapeError` naming the missing field (`amount`/`account` required; `dueDate`/`billPeriod`/`status` optional). This satisfies "best-effort selectors with clear errors" per the brief; selectors should be tightened once run against a real account.

## Flow implemented
`goto` login → fill username/password → `solveCaptchaFromLocator` on the captcha `<img>` + `ctx.captchaSolver` → fill captcha → click login → detect failure (still on login form + captcha-error text → `CaptchaError`; else `LoginError`) → optional click-through to a "View/My Bills" link if present → scrape → `maskAccount`. Retry loop (max 2 attempts) lives inside the adapter per the brief, catching only `CaptchaError`/`LoginError`.

## Commits
Not committed yet (awaiting instruction, per workspace commit policy — only commit when explicitly asked).

## Tests
- `tests/tnpdcl-mask.test.ts`: `maskAccount` (`1234567890`→`****7890`, whitespace trimming, short-id edge case) + registry registration check. No live TNPDCL login/network in CI.
- Full suite: 28/28 passing.

## Concerns / deferred
- Post-login bill-page selectors are best-effort regex, unverified against a real account — likely needs adjustment after a manual run.
- Manual verification checklist (real creds, `npm run build && node dist/cli.js run --job home-eb`, confirm ntfy message) is **deferred** — requires human with live TNPDCL credentials; not run in this session.

## Commit & final verification (2026-08-08)

- Commit SHA: `a687225e5bb0883124465389a3b75b61c9990560`
- Commit message: `feat: add TNPDCL billing adapter with Mistral captcha login`
- Files committed: `src/adapters/tnpdcl.ts`, `src/adapters/registry.ts`, `tests/tnpdcl-mask.test.ts`
- `npm test`: **28/28 passed**, 0 failed
- `npm run build` (`tsc`): **clean, no errors**
- Working tree clean after commit; no implementation changes were needed.

## Important review fixes (2026-08-08)

- Login failures are now classified only from dedicated error elements inside
  `#lin`. `classifyLoginFailure` recognizes explicit captcha-rejection phrases;
  all other still-on-login outcomes default to `LoginError`.
- `maskAccount` now fully masks trimmed account IDs of four or fewer characters
  as `****`; longer IDs retain only the final four characters.
- Regression evidence: focused TNPDCL tests passed (6/6), full `npm test`
  passed (30/30), and `npm run build` completed without TypeScript errors.
- Commit message: `fix: tighten TNPDCL login error classification and account masking`
