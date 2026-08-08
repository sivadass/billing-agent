# TNPDCL No Pending Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When TNPDCL group-pay shows empty Bill Payments and Disconnected Services tables, return success with `notify: false` so the job runner skips ntfy.

**Architecture:** Extend `BillResult` with optional `notify`. Add pure HTML helpers in `tnpdcl.ts` to detect empty PrimeFaces datatables and resolve a masked account label from Advance Payments. `scrapeBill` short-circuits on both-empty; `job-runner` skips success ntfy when `notify === false`.

**Tech Stack:** Node.js 20+, TypeScript ESM, Playwright, `node:test` via `tsx --test`

**Spec:** `docs/superpowers/specs/2026-08-08-tnpdcl-no-pending-bills-design.md`

## Global Constraints

- Filenames: kebab-case only (workspace rule)
- Empty detection: both `#form:selectedbill_data` and `#form:selectedbillr_data` show `No records found`
- Advance Payments ignored for dues; only used optionally for `accountLabel`
- Skip-notify via `BillResult.notify === false` only (no magic status strings in the runner)
- No live TNPDCL tests in CI; use HTML fixtures / string helpers
- Do not expand scope to multi-bill scrape or “all clear” notify config

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/adapters/types.ts` | Add optional `notify?: boolean` to `BillResult` |
| `src/job-runner.ts` | Skip success `sendNtfy` when `result.notify === false` |
| `src/adapters/tnpdcl.ts` | Empty-table helpers + short-circuit in `scrapeBill` |
| `fixtures/tnpdcl-grouppay-empty.html` | Minimal empty-bills HTML for helper / optional adapter tests |
| `fixtures/tnpdcl-grouppay-one-bill.html` | Counterpart with one Bill Payments row (helpers) |
| `tests/job-runner.test.ts` | Assert skip-notify path |
| `tests/tnpdcl-empty-bills.test.ts` | Unit tests for empty detection + account label helpers |

---

### Task 1: `BillResult.notify` + job-runner skip

**Files:**
- Modify: `src/adapters/types.ts`
- Modify: `src/job-runner.ts`
- Modify: `tests/job-runner.test.ts`

**Interfaces:**
- Consumes: existing `BillResult`, `runJob`
- Produces: `BillResult.notify?: boolean`; runner skips success ntfy iff `result.notify === false`

- [ ] **Step 1: Write the failing test**

Add to `tests/job-runner.test.ts` inside `describe('runJob', ...)`:

```ts
  it('skips success notification when result.notify is false', async () => {
    const notifications: Array<Record<string, unknown>> = [];
    const quietResult: BillResult = {
      provider: 'fake',
      amount: '₹0',
      status: 'no pending bills',
      accountLabel: '****1234',
      notify: false,
    };
    const adapter: BillingAdapter = {
      id: 'fake',
      async run() {
        return quietResult;
      },
    };

    const result = await runJob(app, job, {
      withBrowser: async (_config, callback) => callback({} as Page),
      sendNtfy: async (options) => {
        notifications.push(options);
      },
      createMistralCaptchaSolver: () => ({
        solveFromImageBase64: async () => 'captcha',
      }),
      getAdapter: () => adapter,
      env: testEnv,
    });

    assert.deepEqual(result, { ok: true, result: quietResult });
    assert.deepEqual(notifications, []);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/job-runner.test.ts`

Expected: FAIL — success ntfy still sent (notifications length 1) or TypeScript error that `notify` is not on `BillResult`.

- [ ] **Step 3: Add `notify` to `BillResult`**

In `src/adapters/types.ts`, update the type:

```ts
export type BillResult = {
  provider: string;
  amount: string;
  dueDate?: string;
  billPeriod?: string;
  status?: string;
  accountLabel: string;
  rawNotes?: string;
  /** When false, job-runner skips success ntfy. Default: notify. */
  notify?: boolean;
};
```

- [ ] **Step 4: Skip success ntfy in `runJob`**

In `src/job-runner.ts`, replace the unconditional success `sendNtfy` block with:

```ts
    if (result.notify !== false) {
      await runnerDeps.sendNtfy({
        baseUrl: app.ntfy.baseUrl,
        topic: app.ntfy.topic,
        title: job.notify.title,
        body: formatSuccessBody(result),
        priority: app.ntfy.priority,
      });
    }

    logger.info('job success', {
      durationMs: Date.now() - startedAt,
      ...(result.notify === false ? { notifySkipped: true } : {}),
    });
```

(Keep the existing `return { ok: true, result };` after the log.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/job-runner.test.ts`

Expected: PASS (including the existing success-notify test that omits `notify`).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/types.ts src/job-runner.ts tests/job-runner.test.ts
git commit -m "$(cat <<'EOF'
feat: skip success ntfy when BillResult.notify is false

EOF
)"
```

---

### Task 2: Pure empty-table helpers + fixtures

**Files:**
- Create: `fixtures/tnpdcl-grouppay-empty.html`
- Create: `fixtures/tnpdcl-grouppay-one-bill.html`
- Modify: `src/adapters/tnpdcl.ts` (export helpers)
- Create: `tests/tnpdcl-empty-bills.test.ts`

**Interfaces:**
- Consumes: none from Task 1 beyond shared `maskAccount`
- Produces:
  - `export const BILL_PAYMENTS_TBODY_ID = 'form:selectedbill_data'`
  - `export const DISCONNECTED_TBODY_ID = 'form:selectedbillr_data'`
  - `export function isNoRecordsEmptyMessage(text: string): boolean`
  - `export function dataTableIsEmptyInHtml(html: string, tbodyId: string): boolean | null`
  - `export function hasNoPendingBillsInHtml(html: string): boolean`
  - `export function firstAdvanceConsumerNoFromHtml(html: string): string | undefined`

Semantics (`dataTableIsEmptyInHtml`):
- `null` if the tbody `id="{tbodyId}"` is absent from `html`
- `true` if that tbody’s markup contains a `ui-datatable-empty-message` and `No records found` (case-insensitive)
- `false` otherwise (tbody present with data rows or without the empty message)

`hasNoPendingBillsInHtml`:
- `true` only when both bill tbodies resolve to `true`
- `false` if either is `null` or `false`

`firstAdvanceConsumerNoFromHtml`:
- Find a fieldset whose legend text matches `/Advance Payments/i`
- Within it, take the first `tr` that is not `.ui-datatable-empty-message`, first `td` / `.ui-dt-c` text
- Return trimmed consumer number or `undefined`

- [ ] **Step 1: Create empty fixture**

Create `fixtures/tnpdcl-grouppay-empty.html` with the minimal structure needed by the helpers (both empty tbodies + Advance Payments with one consumer `0921410333`):

```html
<!DOCTYPE html>
<html>
  <body>
    <form id="form">
      <fieldset>
        <legend class="ui-fieldset-legend">Bill Payments</legend>
        <div id="form:selectedbill" class="ui-datatable">
          <table>
            <tbody id="form:selectedbill_data">
              <tr class="ui-widget-content ui-datatable-empty-message">
                <td><div class="ui-dt-c">No records found.</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset>
        <legend class="ui-fieldset-legend">Disconnected Services Payments</legend>
        <div id="form:selectedbillr" class="ui-datatable">
          <table>
            <tbody id="form:selectedbillr_data">
              <tr class="ui-widget-content ui-datatable-empty-message">
                <td><div class="ui-dt-c">No records found.</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset>
        <legend class="ui-fieldset-legend">Advance Payments/Others</legend>
        <div class="ui-datatable">
          <table>
            <tbody>
              <tr data-ri="0" class="ui-widget-content ui-datatable-even" role="row">
                <td role="gridcell"><div class="ui-dt-c">0921410333</div></td>
                <td role="gridcell"><div class="ui-dt-c">USHA</div></td>
                <td role="gridcell"><div class="ui-dt-c">Rs.Nil</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
    </form>
  </body>
</html>
```

- [ ] **Step 2: Create one-bill fixture**

Create `fixtures/tnpdcl-grouppay-one-bill.html` — same as empty, but Bill Payments tbody has a data row and Disconnected stays empty:

```html
<!DOCTYPE html>
<html>
  <body>
    <form id="form">
      <fieldset>
        <legend class="ui-fieldset-legend">Bill Payments</legend>
        <div id="form:selectedbill" class="ui-datatable">
          <table>
            <tbody id="form:selectedbill_data">
              <tr data-ri="0" class="ui-widget-content ui-datatable-even" role="row">
                <td role="gridcell"><div class="ui-dt-c">0921410333</div></td>
                <td role="gridcell"><div class="ui-dt-c">USHA</div></td>
                <td role="gridcell"><div class="ui-dt-c">Rs.150.00</div></td>
                <td role="gridcell"><div class="ui-dt-c">15/08/2026</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset>
        <legend class="ui-fieldset-legend">Disconnected Services Payments</legend>
        <div id="form:selectedbillr" class="ui-datatable">
          <table>
            <tbody id="form:selectedbillr_data">
              <tr class="ui-widget-content ui-datatable-empty-message">
                <td><div class="ui-dt-c">No records found.</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
    </form>
  </body>
</html>
```

- [ ] **Step 3: Write the failing helper tests**

Create `tests/tnpdcl-empty-bills.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  BILL_PAYMENTS_TBODY_ID,
  DISCONNECTED_TBODY_ID,
  dataTableIsEmptyInHtml,
  firstAdvanceConsumerNoFromHtml,
  hasNoPendingBillsInHtml,
  isNoRecordsEmptyMessage,
  maskAccount,
} from '../src/adapters/tnpdcl.ts';

const emptyHtml = readFileSync(
  resolve('fixtures/tnpdcl-grouppay-empty.html'),
  'utf8',
);
const oneBillHtml = readFileSync(
  resolve('fixtures/tnpdcl-grouppay-one-bill.html'),
  'utf8',
);

describe('isNoRecordsEmptyMessage', () => {
  it('matches No records found text', () => {
    assert.equal(isNoRecordsEmptyMessage('No records found.'), true);
    assert.equal(isNoRecordsEmptyMessage('  no records found  '), true);
    assert.equal(isNoRecordsEmptyMessage('Rs.150.00'), false);
  });
});

describe('dataTableIsEmptyInHtml', () => {
  it('returns true for empty bill payments tbody', () => {
    assert.equal(
      dataTableIsEmptyInHtml(emptyHtml, BILL_PAYMENTS_TBODY_ID),
      true,
    );
    assert.equal(
      dataTableIsEmptyInHtml(emptyHtml, DISCONNECTED_TBODY_ID),
      true,
    );
  });

  it('returns false when bill payments has a data row', () => {
    assert.equal(
      dataTableIsEmptyInHtml(oneBillHtml, BILL_PAYMENTS_TBODY_ID),
      false,
    );
    assert.equal(
      dataTableIsEmptyInHtml(oneBillHtml, DISCONNECTED_TBODY_ID),
      true,
    );
  });

  it('returns null when tbody id is missing', () => {
    assert.equal(
      dataTableIsEmptyInHtml('<html><body></body></html>', BILL_PAYMENTS_TBODY_ID),
      null,
    );
  });
});

describe('hasNoPendingBillsInHtml', () => {
  it('is true only when both tables are empty', () => {
    assert.equal(hasNoPendingBillsInHtml(emptyHtml), true);
    assert.equal(hasNoPendingBillsInHtml(oneBillHtml), false);
    assert.equal(hasNoPendingBillsInHtml('<html></html>'), false);
  });
});

describe('firstAdvanceConsumerNoFromHtml', () => {
  it('reads the first Advance Payments consumer number', () => {
    assert.equal(firstAdvanceConsumerNoFromHtml(emptyHtml), '0921410333');
    assert.equal(
      maskAccount(firstAdvanceConsumerNoFromHtml(emptyHtml)!),
      '****0333',
    );
  });

  it('returns undefined when Advance Payments is absent', () => {
    assert.equal(firstAdvanceConsumerNoFromHtml(oneBillHtml), undefined);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- tests/tnpdcl-empty-bills.test.ts`

Expected: FAIL — helpers not exported / not defined.

- [ ] **Step 5: Implement helpers in `src/adapters/tnpdcl.ts`**

Add near the top (after imports / constants), and export:

```ts
export const BILL_PAYMENTS_TBODY_ID = 'form:selectedbill_data';
export const DISCONNECTED_TBODY_ID = 'form:selectedbillr_data';

export function isNoRecordsEmptyMessage(text: string): boolean {
  return /no\s+records\s+found/i.test(text.trim());
}

/**
 * Extract inner HTML of `<tbody id="{tbodyId}">...</tbody>`.
 * Returns null if the opening tag is not found.
 */
function extractTbodyInnerHtml(html: string, tbodyId: string): string | null {
  const open = new RegExp(
    `<tbody\\b[^>]*\\bid=["']${tbodyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i',
  );
  const openMatch = open.exec(html);
  if (!openMatch || openMatch.index === undefined) return null;
  const start = openMatch.index + openMatch[0].length;
  const close = html.slice(start).search(/<\/tbody>/i);
  if (close < 0) return null;
  return html.slice(start, start + close);
}

export function dataTableIsEmptyInHtml(
  html: string,
  tbodyId: string,
): boolean | null {
  const inner = extractTbodyInnerHtml(html, tbodyId);
  if (inner === null) return null;
  const hasEmptyClass = /ui-datatable-empty-message/i.test(inner);
  const hasNoRecords = isNoRecordsEmptyMessage(
    inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
  );
  return hasEmptyClass && hasNoRecords;
}

export function hasNoPendingBillsInHtml(html: string): boolean {
  const bills = dataTableIsEmptyInHtml(html, BILL_PAYMENTS_TBODY_ID);
  const disconnected = dataTableIsEmptyInHtml(html, DISCONNECTED_TBODY_ID);
  return bills === true && disconnected === true;
}

export function firstAdvanceConsumerNoFromHtml(html: string): string | undefined {
  const fieldsetRe =
    /<fieldset\b[^>]*>[\s\S]*?<legend\b[^>]*>[\s\S]*?Advance Payments[\s\S]*?<\/legend>([\s\S]*?)<\/fieldset>/i;
  const fieldsetMatch = fieldsetRe.exec(html);
  if (!fieldsetMatch?.[1]) return undefined;
  const body = fieldsetMatch[1];
  const rowRe =
    /<tr\b(?![^>]*ui-datatable-empty-message)[^>]*>([\s\S]*?)<\/tr>/i;
  const rowMatch = rowRe.exec(body);
  if (!rowMatch?.[1]) return undefined;
  const cellMatch = /<div class="ui-dt-c">\s*([^<]+?)\s*<\/div>/i.exec(
    rowMatch[1],
  );
  const value = cellMatch?.[1]?.trim();
  return value || undefined;
}
```

Adjust regex escaping if needed so ids with colons match literally (`form:selectedbill_data`).

- [ ] **Step 6: Run helper tests to verify they pass**

Run: `npm test -- tests/tnpdcl-empty-bills.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add fixtures/tnpdcl-grouppay-empty.html fixtures/tnpdcl-grouppay-one-bill.html src/adapters/tnpdcl.ts tests/tnpdcl-empty-bills.test.ts
git commit -m "$(cat <<'EOF'
feat: detect empty TNPDCL bill tables from HTML

EOF
)"
```

---

### Task 3: Wire empty detection into `scrapeBill`

**Files:**
- Modify: `src/adapters/tnpdcl.ts` (`scrapeBill` and optionally thin page wrappers)
- Modify: `tests/tnpdcl-empty-bills.test.ts` (optional page-level test using `page.setContent`)

**Interfaces:**
- Consumes: `hasNoPendingBillsInHtml`, `firstAdvanceConsumerNoFromHtml`, `maskAccount`
- Produces: `scrapeBill` returns quiet `BillResult` when both tables empty

Quiet result shape:

```ts
{
  provider: 'tnpdcl',
  amount: '₹0',
  status: 'no pending bills',
  accountLabel: maskAccount(consumer) // or '****'
  notify: false,
}
```

- [ ] **Step 1: Write a failing page integration test**

Append to `tests/tnpdcl-empty-bills.test.ts`:

```ts
import { withBrowser } from '../src/browser.ts';
import { createLogger } from '../src/logger.ts';

// Export scrapeBillForTest OR test via a small exported helper used by scrapeBill.
// Prefer exporting async function buildBillResultFromPageHtml(html: string): BillResult | null
// that returns the quiet result or null if not empty — keeps Playwright optional.

describe('buildNoPendingBillResultFromHtml', () => {
  it('returns quiet BillResult for empty fixture', async () => {
    const { buildNoPendingBillResultFromHtml } = await import(
      '../src/adapters/tnpdcl.ts'
    );
    const result = buildNoPendingBillResultFromHtml(emptyHtml);
    assert.deepEqual(result, {
      provider: 'tnpdcl',
      amount: '₹0',
      status: 'no pending bills',
      accountLabel: '****0333',
      notify: false,
    });
  });

  it('returns null when a bill row exists', async () => {
    const { buildNoPendingBillResultFromHtml } = await import(
      '../src/adapters/tnpdcl.ts'
    );
    assert.equal(buildNoPendingBillResultFromHtml(oneBillHtml), null);
  });
});
```

Prefer a **static import** at the top of the file instead of dynamic import once the export exists; use dynamic import only in the failing-first draft if needed for the plan’s TDD order. Implementer should use:

```ts
import {
  // ...existing
  buildNoPendingBillResultFromHtml,
} from '../src/adapters/tnpdcl.ts';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/tnpdcl-empty-bills.test.ts`

Expected: FAIL — `buildNoPendingBillResultFromHtml` missing.

- [ ] **Step 3: Implement `buildNoPendingBillResultFromHtml` and call it from `scrapeBill`**

In `src/adapters/tnpdcl.ts`:

```ts
import type { BillResult } from './types.js';

export function buildNoPendingBillResultFromHtml(html: string): BillResult | null {
  if (!hasNoPendingBillsInHtml(html)) return null;
  const consumer = firstAdvanceConsumerNoFromHtml(html);
  return {
    provider: 'tnpdcl',
    amount: '₹0',
    status: 'no pending bills',
    accountLabel: consumer ? maskAccount(consumer) : '****',
    notify: false,
  };
}
```

Update `scrapeBill`:

```ts
async function scrapeBill(page: Page, ctx: AdapterContext): Promise<BillResult> {
  await navigateToBillPageIfNeeded(page, ctx);

  const html = await page.content();
  const noPending = buildNoPendingBillResultFromHtml(html);
  if (noPending) {
    ctx.logger.info('tnpdcl: no pending bills');
    return noPending;
  }

  const pageText = await page.locator('body').innerText();
  // ... existing extractRequiredField path unchanged
}
```

Also widen `navigateToBillPageIfNeeded` link matcher so post-login home can reach group pay via the bill-details image link when needed:

```ts
const billLink = page
  .locator('a', { hasText: /view\s*bill|my\s*bills?|bill\s*details/i })
  .or(page.locator('a[href*="grouppay"]'))
  .first();
```

(Only if the current page is not already group pay; existing “if count > 0 click” is fine.)

- [ ] **Step 4: Run all related tests**

Run: `npm test -- tests/tnpdcl-empty-bills.test.ts tests/tnpdcl-mask.test.ts tests/job-runner.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adapters/tnpdcl.ts tests/tnpdcl-empty-bills.test.ts
git commit -m "$(cat <<'EOF'
feat: return quiet BillResult when TNPDCL has no pending bills

EOF
)"
```

---

### Task 4: Spec status + README note (light)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-tnpdcl-no-pending-bills-design.md` (status already Approved — confirm)
- Modify: `README.md` only if it documents TNPDCL scrape behavior; add one sentence that empty bill tables skip ntfy

- [ ] **Step 1: Check README for TNPDCL section**

If README describes success notifications, add:

```markdown
When TNPDCL Bill Payments and Disconnected Services both show "No records found", the job succeeds without sending a success notification.
```

If README has no TNPDCL scrape section, skip code changes and only verify the spec status line is `Approved for implementation planning`.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 3: Commit if README changed**

```bash
git add README.md docs/superpowers/specs/2026-08-08-tnpdcl-no-pending-bills-design.md
git commit -m "$(cat <<'EOF'
docs: note TNPDCL no-pending-bills skips success ntfy

EOF
)"
```

If nothing changed, skip the commit.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Both bill tables empty ⇒ no pending | Task 2–3 |
| Advance Payments ignored for dues | Task 2–3 |
| Success, no ntfy | Task 1 + 3 (`notify: false`) |
| `BillResult.notify?: boolean` | Task 1 |
| Amount `₹0`, status `no pending bills` | Task 3 |
| accountLabel from Advance / `****` | Task 2–3 |
| Missing tbody ≠ empty | Task 2 (`null` / `hasNoPendingBillsInHtml` false) |
| Job-runner skip + log `notifySkipped` | Task 1 |
| Failure ntfy unchanged | Task 1 (no changes to catch path) |
| Unit + runner tests | Tasks 1–3 |

No TBD/placeholder steps remain after self-review.
