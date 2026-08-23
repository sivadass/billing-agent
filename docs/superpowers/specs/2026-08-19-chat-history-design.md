# Chat History Design

**Date:** 2026-08-19  
**Status:** Approved for implementation planning  
**Related:** `2026-08-16-generic-site-jobs-design.md`, `2026-08-09-jobs-runs-ui-design.md`, `apps/web`, `apps/api`

## Problem

The Playwright browser is a process-local mutex. A leftover authoring session keeps the lock until the user opens that conversation and clicks **Abandon**. Chat has no history list, so the only way to find the holder is to remember the UUID URL. Starting a new chat then shows “Browser is busy with another session.” with no path back to the session that holds the browser.

## Goals

- Chat hub lists the current user’s conversations, newest first
- Operator can open a listed session and **Abandon** it (existing action) to release the browser
- New chats start from a dedicated composer, not from the list page
- List payloads stay small: no messages, drafts, or secrets

## Non-goals

- Status filters or defaulting the list to in-progress only
- Badge or link for whoever currently holds the browser lock
- **Abandon** as a table row action
- Pagination or query parameters on `GET /conversations`
- Changing the “Browser is busy with another session.” assistant copy
- Force-unlock / release-browser API that skips visiting the holding session
- Listing another user’s conversations

## Decisions

| Topic | Decision |
| --- | --- |
| Product shape | Approach 1: Jobs-mirror history list |
| List home | `/chat` — table + **New chat** CTA |
| Composer | `/chat/new` — today’s start-URL / goal / schedule / notify form |
| Session | `/chat/:conversationId` — unchanged thread; **Abandon** stays here |
| After abandon | Navigate to `/chat` (already the destination) |
| After create | Navigate to `/chat/:id` with `replace` (unchanged) |
| Table actions | None. Row click opens the session |
| List API | `GET /conversations` — summaries only, JWT + `userId` scoped |
| Sort | `updatedAt` descending (existing `listConversations` order) |
| Filters / pagination | None in v1 |
| UI kit | Cleanplate `Table` + `mobileColumns`; kebab-case filenames |

## Architecture

```text
Browser (Vite SPA)                         API
┌──────────────────────────────┐           ┌─────────────────────────────┐
│ /chat        list + New chat │  Bearer   │ GET  /conversations         │
│ /chat/new    composer        │ ────────► │ GET  /conversations/:id     │
│ /chat/:id    thread + Abandon│           │ POST /conversations         │
└──────────────────────────────┘           │ POST /conversations/:id/…   │
                                           │ store.listConversations()   │
                                           └─────────────────────────────┘
```

`BillingStore.listConversations({ userId })` already exists. This work adds the HTTP list route and the hub UI. Abandon continues to set status `abandoned` and `lock.release(conversationId)` when that conversation holds the lock.

### Files

| Path | Role |
| --- | --- |
| `apps/api/src/conversation-routes.ts` | Handle `GET /conversations` **before** `GET /conversations/:id`; map to summaries |
| `apps/api/tests/conversations.test.ts` | List newest-first, omit messages/drafts, exclude other users, route not shadowed by `:id` |
| `apps/web/src/lib/types.ts` | `ConversationSummary` type |
| `apps/web/src/lib/conversations-api.ts` | `listConversations()` |
| `apps/web/src/components/conversations-table.tsx` | Cleanplate table; row click |
| `apps/web/src/pages/chat-page.tsx` | Export list, composer, and thread; keep session/composer logic in this file |
| `apps/web/src/app.tsx` | `/chat` → list, `/chat/new` → composer, `/chat/:conversationId` → thread (`/chat/new` registered first) |
| `apps/web/src/pages/chat-page.test.tsx` | List, navigation, empty state; keep session/composer coverage |

## Routes (web)

| Path | Purpose |
| --- | --- |
| `/chat` | History table + **New chat** |
| `/chat/new` | Composer |
| `/chat/:conversationId` | Existing session |

Sidebar **Chat** stays `/chat`. `/chat/new` must be a concrete route so `new` is never parsed as a conversation id.

## Screen layout

AppShell is unchanged: left nav Jobs / Chat / Runs / Status. Chat is selected on every screen below. Header avatar stays on the right.

### `/chat` — history list

```text
┌──────────┬─────────────────────────────────────────────────────┐
│ Billing  │  Chat                              [ New chat ]     │
│ Agent    │  Reopen a session to continue or abandon it.        │
│          ├─────────────────────────────────────────────────────┤
│ Jobs     │  Goal                 Status      Start URL  Updated│
│ Chat  ●  │  Grab contact email   active      sivadass.in    2m │
│ Runs     │  Draft TNEB job       confirming  tnebnet.org    1h │
│ Status   │  Saved contact scrape saved       sivadass.in    1d │
│          │                                                     │
│          │  row click → /chat/:id   (no row actions)           │
└──────────┴─────────────────────────────────────────────────────┘
```

Empty list (successful fetch, zero rows):

```text
┌──────────┬─────────────────────────────────────────────────────┐
│ …        │  Chat                              [ New chat ]     │
│ Chat  ●  ├─────────────────────────────────────────────────────┤
│ …        │                                                     │
│          │           No chats yet                              │
│          │           [ New chat ]                              │
│          │                                                     │
└──────────┴─────────────────────────────────────────────────────┘
```

### `/chat/new` — composer

```text
┌──────────┬─────────────────────────────────────────────────────┐
│ Billing  │  New chat                                           │
│ Agent    │  Describe a site and goal; the agent proposes a job.│
│          ├─────────────────────────────────────────────────────┤
│ Jobs     │  Start URL                                          │
│ Chat  ●  │  [ https://sivadass.in/                           ] │
│ Runs     │  Goal                                               │
│ Status   │  [ Grab the contact email address                 ] │
│          │  Schedule (cron, optional)                          │
│          │  [                                                ] │
│          │  Notify title / channel                             │
│          │  [ Start chat                                     ] │
└──────────┴─────────────────────────────────────────────────────┘
```

Submit `replace`s to `/chat/:id`. No history table on this screen.

### `/chat/:id` — session (unchanged)

```text
┌──────────┬─────────────────────────────────────────────────────┐
│ Billing  │  Chat session                      [ Abandon ]      │
│ Agent    │  Grab the contact email address                     │
│          ├─────────────────────────────────────────────────────┤
│ Jobs     │  [active]  Auto-refreshing every 2s                 │
│ Chat  ●  │                                                     │
│ Runs     │  ASSISTANT  Browser is busy with another session.   │
│ Status   │                                                     │
│          │  Message  [                                   ] Send│
└──────────┴─────────────────────────────────────────────────────┘
```

**Abandon** returns to `/chat` (the list). Operator finds the holding session in that list, opens it, and abandons there.

## API

### `GET /conversations`

**Auth:** JWT required. Scope to `userId`.

**Routing:** Match `GET` pathname `=== '/conversations'` before `GET /conversations/:id`.

**Behavior:**

1. `store.listConversations({ userId })`
2. Map each document to a summary
3. Respond **200** with the array (already newest `updatedAt` first)

**Summary object:**

```json
{
  "id": "…",
  "status": "active",
  "goal": "Grab the contact email address",
  "startUrl": "https://sivadass.in/",
  "jobId": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Omit `messages`, `draftWorkflow`, `draftSchema`, `draftExtract`, `draftNotify`, `draftSchedule`, and `userId`. Detail remains `GET /conversations/:id` (redacted messages, unchanged).

Cross-user: a conversation owned by someone else is not in the list. `GET /conversations/:id` for another user’s id stays **404**.

### Unchanged

- `POST /conversations`
- `GET /conversations/:id`
- `POST /conversations/:id/messages`
- `POST /conversations/:id/secrets`
- `POST /conversations/:id/confirm`
- `POST /conversations/:id/reject`
- `POST /conversations/:id/abandon`

## UI

### List (`/chat`)

`PageHeader` title “Chat”, subtitle “Reopen a session to continue or abandon it.”, **New chat** as `primaryCta` → `/chat/new`.

Then a Cleanplate `Table`:

| Column | Source |
| --- | --- |
| Goal | `goal`; if empty, `startUrl` |
| Status | Badge using the same variants as the session page: `saved` success; `active` / `awaiting_secret` / `confirming` warning; `abandoned` / `expired` error |
| Start URL | `startUrl` |
| Updated | `humanizeTimestamp(updatedAt)` (same helper as Runs); `title` with locale datetime |

`onRowClick` → `/chat/:id`. No Run/more-menu column.

`mobileColumns`: goal as title, start URL as subtitle, status badge as meta, updated as description.

**Empty:** `FeedbackState` “No chats yet” with primary **New chat**.  
**Loading:** existing `Loader` pattern.  
**Error:** `Alert` + no table (same as Jobs).

### Composer (`/chat/new`)

Today’s composer fields and `POST /conversations` behavior. Header title “New chat”. Submit still `replace`s to `/chat/:id`. Do not list history on this screen.

### Session (`/chat/:conversationId`)

Unchanged except that **Abandon** already returns to `/chat`, which is now the history list.

## Error handling

- List fetch failure: show the error Alert; do not render an empty-state as if there were zero chats
- Empty array from a successful fetch: empty `FeedbackState`, not an error
- Auth, 401, and conversation 404 behavior unchanged
- No new browser-lock or 409 handling on the list endpoint

## Testing

**API** (`apps/api/tests/conversations.test.ts`):

- Returns only the caller’s conversations, newest `updatedAt` first
- Each item has the summary fields and does not include `messages` or draft keys
- `GET /conversations` is not handled as `GET /conversations/:id`

**Web:**

- `/chat` renders listed goals/statuses and navigates to `/chat/:id` on row click
- **New chat** navigates to `/chat/new`
- Empty list shows the empty state CTA
- Existing composer create-and-redirect and session polling/abandon tests still pass (`listConversations` mocked where the list mounts)

## Implementation notes

- Extract a shared status→badge variant helper if the list and thread would otherwise duplicate the mapping already in `chat-page.tsx`
- SCSS: kebab-case module next to the table component only if layout classes are needed; prefer Cleanplate spacing first
- README already mentions `GET /conversations`; keep that line accurate when the route lands
