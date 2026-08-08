# TNPDCL No Pending Bills Design

**Date:** 2026-08-08  
**Status:** Approved for implementation planning  
**Related:** `2026-08-08-billing-agent-design.md`, `src/adapters/tnpdcl.ts`

## Problem

After a successful TNPDCL login, the group-pay page (`/awp/grouppay`) may show **no payable bills**. Today `scrapeBill` still tries to extract a bill amount from page text and typically throws `ScrapeError`, which the job runner treats as failure and notifies via ntfy.

When both the Bill Payments and Disconnected Services tables show `No records found.`, the run should succeed quietly: no success notification.

## Goals

- Detect the empty-bills state from the live PrimeFaces markup on group pay
- Return a successful `BillResult` without sending success ntfy
- Keep failure notifications unchanged
- Leave Advance Payments / “Pay Advance” / `Rs.Nil` rows out of the pending-bill decision

## Non-goals

- Paying bills or selecting rows on the portal
- Scraping or aggregating multiple pending bill rows into one notify payload (beyond fixing empty detection)
- Treating Advance Payments as dues
- Changing captcha / login retry behavior

## Decisions

| Topic | Decision |
| --- | --- |
| Empty detection | Both Bill Payments **and** Disconnected Services tables empty |
| Advance Payments | Ignored for pending-bill detection |
| User preference on notify | Success with **no** ntfy when nothing is due |
| Skip-notify signal | Explicit optional `notify?: boolean` on `BillResult` (omit or `true` = send; `false` = skip) |
| Empty result amount | `₹0` |
| Empty result status | `no pending bills` |

## Detection

Stable table bodies on the group-pay form (confirmed from live HTML, 2026-08-08):

| Section | Table root | Data tbody |
| --- | --- | --- |
| Bill Payments | `#form:selectedbill` | `#form:selectedbill_data` |
| Disconnected Services Payments | `#form:selectedbillr` | `#form:selectedbillr_data` |

A table counts as empty when its data tbody contains a `.ui-datatable-empty-message` row whose text includes `No records found` (case-insensitive trim).

**No pending bills** iff **both** tables are empty.

Prefer these ids over auto-generated `j_idt*` fieldset ids. Escape colons in CSS selectors (`#form\\:selectedbill_data`).

If either table is missing from the DOM after navigation, do **not** treat that as empty; fall through to the existing scrape path (or fail with `ScrapeError` as today if required fields are absent).

## Data flow

```text
login OK
  → navigate to bill/group-pay page if needed
  → if both bill tables empty:
        return BillResult { provider, amount: '₹0', status: 'no pending bills',
                            accountLabel, notify: false }
  → else:
        existing field scrape → BillResult (notify omitted / true)
  → job-runner:
        if result.notify === false: log success, skip sendNtfy
        else: send success ntfy as today
```

## `BillResult` change

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

Dummy and other adapters unchanged (omit `notify`).

## TNPDCL empty result shape

```ts
{
  provider: 'tnpdcl',
  amount: '₹0',
  status: 'no pending bills',
  accountLabel: '****1234', // example; see below
  notify: false,
}
```

**accountLabel:** Prefer a resilient locator over brittle `j_idt*` ids for Advance Payments: a `fieldset` whose legend matches `/Advance Payments/i`, then the first non-empty data row’s first cell text (consumer no.). Mask with existing `maskAccount`. If no such cell exists, use `'****'`.
## Job runner

After a successful adapter `run`:

- If `result.notify === false`, skip `sendNtfy` for the success path
- Still log `job success` (include `notifySkipped: true` in log context)
- Still return `{ ok: true, result }`
- Failure path: always attempt failure ntfy (unchanged)

## Error handling

| Situation | Behavior |
| --- | --- |
| Both tables empty | Success, `notify: false` |
| One/both tables have data rows | Existing scrape + success notify |
| Login / captcha failure | Existing errors + failure notify |
| Tables present with bills but amount scrape fails | `ScrapeError` + failure notify |

## Testing

1. **Unit (pure helpers preferred):** `isEmptyBillTable`-style check / “both empty” predicate against fixture HTML snippets (both empty; one empty one not; missing tbody).
2. **Adapter:** With a saved group-pay HTML fixture (or Playwright `setContent`), empty both tables → `notify: false`, `amount: '₹0'`, `status: 'no pending bills'`.
3. **Job-runner:** Fake adapter returning `notify: false` → `sendNtfy` not called; result still `{ ok: true }`. Existing success-notify test remains green when `notify` is omitted.

## Out of scope follow-ups

- Richer multi-bill scrape when Bill Payments has rows
- Optional “all clear” notify mode via job config
