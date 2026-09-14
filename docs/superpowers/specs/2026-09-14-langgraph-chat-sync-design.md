# LangGraph Chat Sync Design

**Date:** 2026-09-14  
**Status:** Approved for implementation planning  
**Related:** `2026-08-16-generic-site-jobs-design.md`, `2026-08-19-chat-history-design.md`, `packages/authoring`, `apps/api/src/conversation-routes.ts`, `apps/web/src/pages/chat-page.tsx`

## Problem

Chat authoring is a custom Mistral tool loop in `handleAuthoringTurn`. The API fire-and-forgets that loop; the UI learns about progress by polling `GET /conversations/:id` every 2s. That leaves three gaps:

1. **Live progress** — the thread only shows “Working…”. Tool steps (`snapshot`, `click`, `fill`) are invisible until an assistant message lands.
2. **Durable agent state** — `upsertConversation` `$set`s the whole document (last-write-wins). Playwright session and in-memory `llm_messages` die with the worker. Daemon start expires every in-progress chat that has no live Playwright session, so the operator re-spends the whole authoring turn.
3. **Human-in-the-loop** — `ask_secret` / `propose_job` are implemented as “write status and return”, not as a resumable interrupt. Secret keys are parsed in the UI from `[secret:…]` in assistant text.

LangChain.js chat wrappers alone do not fix this. The missing pieces are a durable graph, merge-safe conversation writes, and a one-way event stream.

## Goals

- Live tool-step labels in the chat thread (not token streaming)
- Survive worker restart without blindly expiring checkpointed chats
- `ask_secret` and `propose_job` as LangGraph `interrupt()` / `Command({ resume })`
- Keep `ConversationDocument` as the public API the web app already uses
- Stop last-write-wins on conversation messages
- Do not increase Mistral spend by replaying every historical snapshot tree

## Non-goals (v1)

- Token streaming of assistant text
- WebSockets
- LangGraph Cloud / LangGraph Platform
- Full LangGraph debug `streamMode` (node/state dumps)
- Serializing the Playwright browser (cookies, pages)
- Auto-invoke every checkpointed thread on daemon start
- Live-updating the `/chat` list over SSE
- Multi-browser / dropping the process-local `BrowserLock`
- Putting secret plaintext or ciphertext in checkpoints or SSE events
- Replacing `GET /conversations/:id` with graph state as the UI source of truth

## Decisions

| Topic | Decision |
|---|---|
| Approach | LangGraph in the worker + SSE sidecar; conversation doc unchanged as public API |
| Source of truth | **Hybrid:** checkpoints = agent memory/turns; `ConversationDocument` = UI/API |
| LLM context | Trimmed checkpoint window only. Never rebuild prompts from `ConversationDocument` |
| Stream | Tool events only (`snapshot`, `click`, `fill`, `wait`, `extract_candidates`, interrupt, `turn_end`) |
| Transport | SSE on `GET /conversations/:id/events`. Browser `EventSource` cannot send Bearer; web client uses `fetch` + `Authorization` and parses the stream |
| Process | Graph, Playwright, lock, and HTTP stay in the worker daemon. In-process event bus. No Redis |
| Checkpointer | Official LangGraph Mongo checkpointer on the existing Mongo client, collection `langgraph_checkpoints` |
| Secrets | Encrypted secrets collection (unchanged). Resume payload is key names only |
| Confirm | Existing job-create path. Delete checkpoint. Do not resume the graph |
| Poll | Keep 2s GET as fallback until SSE is healthy; GET is always the snapshot after `turn_end` / interrupt |
| In-flight | One `invoke` per conversation. Second `POST /messages` → 409 |

## Architecture

```text
Web (ChatThread)                         Worker daemon (one process)
┌─────────────────────────────┐          ┌──────────────────────────────────────┐
│ GET  /conversations/:id     │ snapshot │ HTTP + conversation routes           │
│ GET  /conversations/:id/    │  SSE     │  → in-process bus (conversationId)   │
│      events  (fetch+Bearer) │          │                                      │
│ POST /messages, /secrets,   │          │ LangGraph  thread_id = conv id       │
│      /reject, /confirm,     │          │  checkpointer → langgraph_checkpoints│
│      /abandon               │          │  tools → Playwright + BrowserLock    │
│                             │          │  $push / $set patches → conversations│
└─────────────────────────────┘          └──────────────────────────────────────┘
```

Two persisted records per chat:

| Store | Key | Holds |
|---|---|---|
| `conversations` (existing) | conversation id | Messages, status, drafts, screenshot paths, jobId |
| `langgraph_checkpoints` (new) | `thread_id` = conversation id | Graph cursor, trimmed `llm_messages`, interrupt payload, `last_page_url`, turn counters |

The graph publishes tool events to the bus. It does not write HTTP. SSE subscribers do not receive a11y trees, secrets, or screenshot URLs (those appear on the conversation doc and are signed on GET).

### Files (expected)

| Path | Role |
|---|---|
| `packages/authoring/src/graph.ts` (new) | StateGraph, nodes, trim, interrupt, event publish |
| `packages/authoring/src/agent.ts` | Thin `handleAuthoringTurn` → `graph.invoke` / resume; drop the while-loop |
| `packages/authoring/src/session.ts` | Unchanged Playwright session map; Ensure-browser node uses it |
| `packages/core/src/store/*` | `appendConversationMessage`, `patchConversation`; keep `upsertConversation` for create |
| `apps/api/src/conversation-routes.ts` | SSE route **before** `GET /:id`; 409 in-flight; resume Commands; sign+redact mutation responses |
| `apps/worker/src/cli.ts` | Wire checkpointer + bus; new expiry rules; do not auto-invoke |
| `apps/web/src/lib/conversations-api.ts` | `subscribeConversationEvents` via fetch SSE |
| `apps/web/src/pages/chat-page.tsx` | Subscribe, progress label, abort on unmount, poll fallback |

Filenames stay kebab-case.

## Graph

One `StateGraph` per conversation. Model: Mistral via a LangChain chat wrapper. Playwright tools stay the current set minus HITL tools.

### Checkpointed state

- `llm_messages` — system + user/assistant text + trimmed tool results
- `last_page_url` — for rehydrate after restart
- `turns_this_message` / `turns_total` — caps **20** / **40** (same as today)
- `pending_interrupt` — `null` \| `{ type: 'secret', keys, message }` \| `{ type: 'confirm', workflow, schema, extract, message }` (mirrors LangGraph’s interrupt so worker code can inspect without loading graph internals)

Not checkpointed: secret plaintext, screenshot bytes, the UI transcript.

In-flight runs: an in-memory `Map<conversationId, AbortController>`. `invoke` registers; `turn_end` / interrupt / abandon / process exit clears. A second `POST /messages` checks this map for 409. Abandon `abort()`s the controller.

### Nodes

1. **Ensure browser** — acquire `BrowserLock`; launch or reuse Playwright; if this process has no session, `goto(last_page_url ?? startUrl)`.
2. **Model** — one Mistral tool-calling completion on `llm_messages`.
3. **Act** — `snapshot`, `click`, `fill`, `wait`, `extract_candidates`. Publish `event: tool`. If snapshot uploaded a file, `$push` assistant message `{ text: 'Captured a page snapshot.', screenshotPath }` (same as today).
4. **Interrupt** — `ask_secret` / `propose_job` are **not** Playwright tools. Patch the conversation doc, then `interrupt()`. `ask_secret` still `$push`es assistant text with `[secret:key]` placeholders so the existing UI parser keeps working. v1 does not add a `requiredKeys` field on the conversation doc.
5. **Reply** — model returned text and no tools: `$push` assistant message, emit `turn_end`, finish the invoke.

Busy lock: if another conversation holds Chromium, `$push` the existing “Browser is busy with another session.” assistant message and skip `invoke`.

### HITL resume

| HTTP | Graph |
|---|---|
| `POST /:id/secrets` | Encrypt values into secrets collection; `patchConversation` status `active`; `Command({ resume: { secretsSubmitted: keys } })`. Fill tools keep reading secrets from the store. |
| `POST /:id/reject` | Status `active`; resume `{ keepGoing: true }`. |
| `POST /:id/confirm` | Existing job creation; **do not resume**; delete checkpoint. |
| `POST /:id/abandon` | Cancel invoke; close browser; `lock.release`; delete checkpoint; status `abandoned`. |

### Trim (token rule)

After each Act, `llm_messages` keeps:

- system prompt
- all user + assistant **text** (no screenshot blobs)
- tool results for the **current user message** only
- among snapshots, **only the latest** full tree; older snapshots become `{ truncated: true, note: "superseded" }`

Never rebuild this list from `ConversationDocument`.

## Persistence

### Conversation document

| Helper | Mongo | Used for |
|---|---|---|
| `upsertConversation` | full `$set` | **Create only** (`POST /conversations`) |
| `appendConversationMessage(id, message)` | `$push` `messages`, `$set` `updatedAt` | User and assistant lines, screenshot bubbles |
| `patchConversation(id, fields)` | `$set` only listed fields + `updatedAt` | `status`, `draftWorkflow`, `draftSchema`, `draftExtract`, `jobId` |

The graph never `$set`s the whole conversation.

`POST /messages`: `$push` the user message, then start the graph. If an invoke is already running for that id → **409**.

Mutation responses (`POST` messages / secrets / reject / abandon) use the same **sign + redact** path as `GET /conversations/:id`.

### Checkpoints

Official LangGraph Mongo checkpointer, same Mongo client, collection `langgraph_checkpoints`. Not returned from `GET /conversations/:id`. Deleted on confirm and abandon.

### Daemon start / expiry

Replace “no Playwright session → expire”:

| On disk | Action |
|---|---|
| Checkpoint present | Leave status. Do **not** auto-invoke (one browser). Next open/send/secrets/reject rehydrates Playwright and resumes. |
| `active` / `awaiting_secret` / `confirming` and **no** checkpoint | Set `expired`. |
| `saved` / `abandoned` / `expired` | Ignore; delete leftover checkpoint if any. |

Playwright cookies die with the process. Resume `goto(last_page_url ?? startUrl)` and snapshot again. v1 does **not** invoke on SSE connect after restart; the operator’s next send/secrets/reject rehydrates. Until then the thread may look idle while still `active` — accepted.

## HTTP and SSE

### `GET /conversations/:id/events`

- JWT + ownership, same as GET conversation.
- Register **before** `GET /conversations/:id` (that handler treats any leftover path as an id).
- `Content-Type: text/event-stream`, `Cache-Control: no-cache`, comment heartbeat every **15s**.
- Subscribe to the in-process bus. Client abort → unsubscribe.
- No event log in Mongo. Missed events → client GETs the conversation.
- 404 if missing or not owned; 401 as usual. Idle/terminal chats may connect (heartbeats only). The UI only opens the stream for `active` / `awaiting_secret` / `confirming`.

Event `data:` JSON only. No trees, no secrets, no screenshot URLs:

```text
event: tool
data: {"tool":"snapshot","conversationId":"<id>","at":"<ISO>"}

event: interrupt
data: {"kind":"secret"|"confirm","conversationId":"<id>","at":"<ISO>"}

event: turn_end
data: {"conversationId":"<id>","at":"<ISO>"}
```

`tool` is one of `snapshot` | `click` | `fill` | `wait` | `extract_candidates`. Unknown event names: clients ignore.

CORS: keep allowing `Authorization`. Do not buffer the SSE body in `applyCors`.

### Existing routes (behavior tweaks)

| Route | Change |
|---|---|
| `POST /conversations` | Create doc, background `graph.invoke`. 201 body unchanged. |
| `POST /:id/messages` | `$push` user message; 409 if not `active` **or** invoke in flight; background invoke; signed/redacted response |
| `POST /:id/secrets` | Encrypt + status `active`; `Command({ resume })` instead of a blank `handleAuthoringTurn` |
| `POST /:id/reject` | Status `active`; resume `{ keepGoing: true }` |
| `POST /:id/confirm` | Unchanged job save; delete checkpoint; no resume |
| `POST /:id/abandon` | Status `abandoned`; cancel invoke; close browser; delete checkpoint |

Background `invoke` must not fail the POST. Surface failures as an assistant message when possible; otherwise the next GET shows the last good doc.

## Chat UI

No client store. `ChatThread` still holds `ConversationDocument` in `useState`. SSE only drives a progress label and when to refetch.

On mount / `conversationId` change:

1. GET conversation.
2. If status is `active` | `awaiting_secret` | `confirming`, open events with `fetch` + Bearer + `AbortController`.
3. Abort in-flight GET and SSE when `conversationId` changes or the thread unmounts so a slow response cannot land on the wrong chat.

While the stream is healthy:

- `event: tool` → `progressTool` label on the existing Working… bubble. Do **not** append fake assistant messages.
- `event: interrupt` or `turn_end` → clear `progressTool`, GET once. Interrupt reveals secrets/confirm via `status` on the doc.

If SSE fails or drops: keep 2s GET poll until a stream connects again. After `turn_end`, skip poll until the user sends, submits secrets, or keep-going.

Composer: unchanged disable rules. 409 “invoke already running” uses the existing error Alert.

`/chat` list and `/chat/new` composer: no SSE.

Labels: `Snapshot`, `Click`, `Fill`, `Wait`, `Extract`. Do not render selectors, URLs, or secret keys from events (those fields are not on the wire).

## Errors

- Missing Mistral key: existing assistant copy; close browser; release lock; leave conversation `active` so the operator can retry after config.
- Tool throw: `{ error }` into `llm_messages`, still emit `event: tool`, let the model recover. Do not crash the turn.
- Turn caps: existing limit message, `turn_end`, stop invoke. Checkpoint kept. Next user message starts a new invoke.
- Interrupt after a failed `$push`/`$set`: log, still `interrupt()` so Playwright does not keep running without UI state.
- In-flight map is process-local. After restart it is empty; 409 cannot apply until a new invoke starts. Checkpointed interrupts resume via secrets/reject, not via a stale AbortController.
- Abandon during invoke: abort run, close browser, delete checkpoint, `$set` abandoned.

## Testing

| Layer | Assert |
|---|---|
| Store | `$push` does not wipe other messages; concurrent patch + push both stick |
| Authoring | `ask_secret` interrupts and patches `awaiting_secret`; resume after secrets; trim keeps one snapshot tree in `llm_messages` |
| Authoring | Checkpoint present → not expired on daemon expiry; no checkpoint → expired |
| Authoring | Snapshot tree is **not** in a published event body |
| API | `GET …/events` is not captured as a conversation id; owner-only; 409 in-flight `POST /messages` |
| API | POST message response includes a signed screenshot URL when GET would |
| Web | `tool` event updates the waiting label; `turn_end` triggers GET; poll if SSE fetch rejects; abort on unmount |
| Web | Existing confirm / abandon / send coverage still passes |

## Out of scope (recap)

Token streaming, WebSockets, LangGraph Cloud, serializing the browser, live chat list, multi-browser, debug stream, invoke-on-SSE-connect after restart.
