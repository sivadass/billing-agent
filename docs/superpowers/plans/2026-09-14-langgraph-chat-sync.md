# LangGraph Chat Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory authoring while-loop with a LangGraph runtime that checkpoints turns, interrupts for secrets/confirm, streams tool events over SSE, and keeps `ConversationDocument` as the web API.

**Architecture:** Hybrid C. LangGraph (same worker process as the HTTP API) owns trimmed LLM memory and interrupts in `langgraph_checkpoints`. The conversation doc stays the snapshot the UI already GETs. An in-process event bus feeds `GET /conversations/:id/events`. Conversation writes use `$push` / field `$set` only. Playwright and `BrowserLock` stay process-local.

**Tech Stack:** `@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint-mongodb`, existing `@mistralai/mistralai` behind `completeWithTools`, Node `http` SSE, MongoDB 6, React 18 + Vitest, `node:test` + `tsx` on server packages.

**Spec:** `docs/superpowers/specs/2026-09-14-langgraph-chat-sync-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- Conversation doc remains the public API (`GET /conversations/:id`, existing status machine, screenshots)
- Model reads **only** the trimmed checkpoint window; never rebuild `llm_messages` from `conversation.messages`
- SSE events: tool name + interrupt kind + ids + ISO timestamp only — no trees, secrets, or screenshot URLs
- Secrets stay in the encrypted secrets collection; checkpoints never store plaintext or ciphertext
- One in-flight `invoke` per conversation; second `POST /messages` → 409
- Tool-event stream only (no token streaming, WebSockets, LangGraph Cloud, debug `streamMode`)
- Register `GET /conversations/:id/events` **before** `GET /conversations/:id`
- Browser `EventSource` cannot send Bearer; web client uses `fetch` + `Authorization`
- `upsertConversation` is create-only after Task 1
- Confirm deletes the checkpoint and does not resume; abandon cancels, closes browser, deletes checkpoint
- Daemon start does not auto-invoke checkpointed threads
- Existing `completeWithTools` injection stays so authoring tests never call real Mistral HTTP

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/core/src/store/types.ts` | `ConversationPatch`; `appendConversationMessage`; `patchConversation` on `BillingStore` |
| `packages/core/src/store/mongo.ts` | `$push` / field `$set` implementations; `connectStoreWithClient` |
| `packages/core/tests/conversation-patches.test.ts` | Memory-equivalent semantics via a tiny map store (or mongo collection mock) |
| `packages/authoring/src/events.ts` | In-process bus + `ConversationStreamEvent` types |
| `packages/authoring/src/runs.ts` | `Map<conversationId, AbortController>` |
| `packages/authoring/src/trim.ts` | `trimLlmMessages` |
| `packages/authoring/src/graph.ts` | StateGraph compile, nodes, interrupt, event publish |
| `packages/authoring/src/runtime.ts` | `AuthoringRuntime` facade (`invoke` / `resume` / `cancel` / checkpoints) |
| `packages/authoring/src/agent.ts` | Thin wrappers; new expiry rules |
| `packages/authoring/tests/*.test.ts` | Trim, events, runs, graph HITL, expiry |
| `apps/api/src/server.ts` | Optional `authoring?: AuthoringRuntime` |
| `apps/api/src/conversation-routes.ts` | SSE, 409 in-flight, resume, sign+redact mutations |
| `apps/api/tests/conversations.test.ts` | SSE routing, 409, authz |
| `apps/worker/src/cli.ts` | Mongo checkpointer + runtime; new expiry |
| `apps/web/src/lib/conversations-api.ts` | `subscribeConversationEvents` |
| `apps/web/src/pages/chat-page.tsx` | Progress label, abort, poll fallback |
| `apps/web/src/pages/chat-page.test.tsx` | SSE label / turn_end / poll-on-error |

Do not split `chat-page.tsx` in this plan.

---

### Task 1: Merge-safe conversation writes

**Files:**
- Modify: `packages/core/src/store/types.ts`
- Modify: `packages/core/src/store/mongo.ts` (`Update` type, conversation methods, add `connectStoreWithClient`)
- Create: `packages/core/tests/conversation-patches.test.ts`
- Modify memory stores so the repo typechecks:
  - `packages/authoring/tests/agent.test.ts`
  - `apps/api/tests/conversations.test.ts`
  - `apps/api/tests/api.test.ts`
  - `packages/core/tests/migrate-generic-jobs.test.ts`

**Interfaces:**
- Consumes: existing `ConversationDocument`, `ConversationMessage`, `upsertConversation` / `getConversation`
- Produces:

```ts
export type ConversationPatch = {
  status?: ConversationStatus;
  draftWorkflow?: ConversationDocument['draftWorkflow'];
  draftSchema?: ConversationDocument['draftSchema'];
  draftExtract?: ConversationDocument['draftExtract'];
  jobId?: string | null;
};

// on BillingStore:
appendConversationMessage(
  id: string,
  message: ConversationMessage,
): Promise<ConversationDocument | null>;

patchConversation(
  id: string,
  fields: ConversationPatch,
): Promise<ConversationDocument | null>;

// new export from mongo.ts:
connectStoreWithClient(uri: string): Promise<{
  store: BillingStore;
  client: import('mongodb').MongoClient;
}>;
```

Missing conversation → both methods return `null`. `updatedAt` is set to `new Date().toISOString()` on every successful write.

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/conversation-patches.test.ts`. Call the methods on `BillingStore` through a tiny `Map` store defined in this file. Before Step 3 the file will not typecheck (`appendConversationMessage` missing on `BillingStore`).

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  BillingStore,
  ConversationDocument,
  ConversationMessage,
} from '../src/store/types.ts';

function baseConversation(): ConversationDocument {
  const now = '2026-09-14T00:00:00.000Z';
  return {
    id: 'conv-1',
    userId: 'user-1',
    status: 'active',
    jobId: null,
    startUrl: 'https://sivadass.in/',
    goal: 'Grab the contact email address',
    messages: [
      { id: 'm1', role: 'assistant', text: 'Working on it…', createdAt: now },
    ],
    draftWorkflow: null,
    draftSchema: null,
    draftExtract: null,
    draftNotify: null,
    draftSchedule: null,
    createdAt: now,
    updatedAt: now,
  };
}

class PatchMemoryStore {
  conversations = new Map<string, ConversationDocument>();
  async upsertConversation(conversation: ConversationDocument) {
    this.conversations.set(conversation.id, conversation);
  }
  async getConversation(id: string) {
    return this.conversations.get(id) ?? null;
  }
  async appendConversationMessage(id: string, message: ConversationMessage) {
    return (this as unknown as BillingStore).appendConversationMessage(id, message);
  }
  async patchConversation(id: string, fields: { status?: ConversationDocument['status'] }) {
    return (this as unknown as BillingStore).patchConversation(id, fields);
  }
}

describe('conversation patches', () => {
  it('appendConversationMessage keeps existing messages', async () => {
    const store = new PatchMemoryStore();
    await store.upsertConversation(baseConversation());
    const incoming: ConversationMessage = {
      id: 'm2',
      role: 'user',
      text: 'continue',
      createdAt: '2026-09-14T00:01:00.000Z',
    };
    const updated = await store.appendConversationMessage('conv-1', incoming);
    assert.equal(updated?.messages.length, 2);
    assert.equal(updated?.messages[0]?.id, 'm1');
    assert.equal(updated?.messages[1]?.id, 'm2');
    assert.equal((await store.getConversation('conv-1'))?.messages.length, 2);
  });

  it('patchConversation does not drop messages', async () => {
    const store = new PatchMemoryStore();
    await store.upsertConversation(baseConversation());
    const updated = await store.patchConversation('conv-1', { status: 'awaiting_secret' });
    assert.equal(updated?.status, 'awaiting_secret');
    assert.equal(updated?.messages.length, 1);
    assert.equal(updated?.messages[0]?.id, 'm1');
  });

  it('returns null when the conversation is missing', async () => {
    const store = new PatchMemoryStore();
    assert.equal(
      await store.appendConversationMessage('missing', {
        id: 'm',
        role: 'user',
        text: 'x',
        createdAt: '2026-09-14T00:00:00.000Z',
      }),
      null,
    );
    assert.equal(await store.patchConversation('missing', { status: 'abandoned' }), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/sivadass/Development/personal/billing-agent && npx tsx --test packages/core/tests/conversation-patches.test.ts`

Expected: FAIL (`appendConversationMessage is not implemented` or TS/import error).

- [ ] **Step 3: Write minimal implementation**

On `BillingStore` in `packages/core/src/store/types.ts`, add `ConversationPatch` and the two methods next to `upsertConversation`.

In `packages/core/src/store/mongo.ts`:

1. Extend `Update<T>` with `$push?: { messages?: ConversationMessage }`.
2. Implement:

```ts
async appendConversationMessage(id, message) {
  const updatedAt = nowIso();
  const existing = await collections.conversations.findOne({ id });
  if (!existing) return null;
  await collections.conversations.updateOne(
    { id },
    { $push: { messages: message }, $set: { updatedAt } },
  );
  return collections.conversations.findOne({ id });
},
async patchConversation(id, fields) {
  const existing = await collections.conversations.findOne({ id });
  if (!existing) return null;
  const updatedAt = nowIso();
  await collections.conversations.updateOne(
    { id },
    { $set: { ...fields, updatedAt } },
  );
  return collections.conversations.findOne({ id });
},
```

3. Add:

```ts
export async function connectStoreWithClient(uri: string): Promise<{
  store: BillingStore;
  client: MongoClient;
}> {
  const client = new MongoClient(uri);
  await client.connect();
  const { store } = await buildStoreFromClient(client);
  return { store, client };
}
```

Leave `connectStore` unchanged (it still closes via `store.close()`).

Copy `append`/`patch` Map semantics into every `BillingStore` fake listed in Files (same as the test store). `upsertConversation` behavior stays a full replace (create path only going forward).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test packages/core/tests/conversation-patches.test.ts`

Expected: PASS.

Also run: `npx tsx --test packages/authoring/tests/agent.test.ts apps/api/tests/conversations.test.ts packages/core/tests/migrate-generic-jobs.test.ts`

Expected: PASS (fakes compile and existing tests still use `upsertConversation`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/types.ts packages/core/src/store/mongo.ts \
  packages/core/tests/conversation-patches.test.ts \
  packages/authoring/tests/agent.test.ts \
  apps/api/tests/conversations.test.ts apps/api/tests/api.test.ts \
  packages/core/tests/migrate-generic-jobs.test.ts
git commit -m "$(cat <<'EOF'
feat: add merge-safe conversation message and field patches

EOF
)"
```

---

### Task 2: Event bus and in-flight run map

**Files:**
- Create: `packages/authoring/src/events.ts`
- Create: `packages/authoring/src/runs.ts`
- Create: `packages/authoring/tests/events.test.ts`
- Create: `packages/authoring/tests/runs.test.ts`
- Modify: `packages/authoring/src/index.ts` (re-export)

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:

```ts
// events.ts
export const CONVERSATION_TOOLS = [
  'snapshot',
  'click',
  'fill',
  'wait',
  'extract_candidates',
] as const;
export type ConversationToolName = (typeof CONVERSATION_TOOLS)[number];

export type ConversationStreamEvent =
  | {
      type: 'tool';
      tool: ConversationToolName;
      conversationId: string;
      at: string;
    }
  | {
      type: 'interrupt';
      kind: 'secret' | 'confirm';
      conversationId: string;
      at: string;
    }
  | { type: 'turn_end'; conversationId: string; at: string };

export function createConversationEventBus(): {
  publish(conversationId: string, event: ConversationStreamEvent): void;
  subscribe(
    conversationId: string,
    listener: (event: ConversationStreamEvent) => void,
  ): () => void;
};

// runs.ts
export function createAuthoringRunMap(): {
  isRunning(conversationId: string): boolean;
  begin(conversationId: string): AbortSignal;
  end(conversationId: string): void;
  abort(conversationId: string): void;
};
```

`publish` must not throw if nobody is subscribed. `begin` while already running throws `Error` with message `Authoring already running`. `abort` aborts the controller and `end`s. `subscribe` returns an unsubscribe function.

- [ ] **Step 1: Write the failing tests**

`packages/authoring/tests/events.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConversationEventBus } from '../src/events.ts';

describe('conversation event bus', () => {
  it('delivers only to the matching conversation id', () => {
    const bus = createConversationEventBus();
    const seen: string[] = [];
    bus.subscribe('conv-1', (event) => {
      if (event.type === 'tool') seen.push(event.tool);
    });
    bus.publish('conv-2', {
      type: 'tool',
      tool: 'click',
      conversationId: 'conv-2',
      at: '2026-09-14T00:00:00.000Z',
    });
    bus.publish('conv-1', {
      type: 'tool',
      tool: 'snapshot',
      conversationId: 'conv-1',
      at: '2026-09-14T00:00:00.000Z',
    });
    assert.deepEqual(seen, ['snapshot']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = createConversationEventBus();
    let count = 0;
    const stop = bus.subscribe('conv-1', () => {
      count += 1;
    });
    stop();
    bus.publish('conv-1', {
      type: 'turn_end',
      conversationId: 'conv-1',
      at: '2026-09-14T00:00:00.000Z',
    });
    assert.equal(count, 0);
  });
});
```

`packages/authoring/tests/runs.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAuthoringRunMap } from '../src/runs.ts';

describe('authoring run map', () => {
  it('tracks a single in-flight invoke and rejects a second begin', () => {
    const runs = createAuthoringRunMap();
    const signal = runs.begin('conv-1');
    assert.equal(signal.aborted, false);
    assert.equal(runs.isRunning('conv-1'), true);
    assert.throws(() => runs.begin('conv-1'), /Authoring already running/);
    runs.end('conv-1');
    assert.equal(runs.isRunning('conv-1'), false);
  });

  it('abort marks the signal aborted and clears running', () => {
    const runs = createAuthoringRunMap();
    const signal = runs.begin('conv-1');
    runs.abort('conv-1');
    assert.equal(signal.aborted, true);
    assert.equal(runs.isRunning('conv-1'), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test packages/authoring/tests/events.test.ts packages/authoring/tests/runs.test.ts`

Expected: FAIL (cannot find module).

- [ ] **Step 3: Write minimal implementation**

`events.ts`: `EventEmitter` or `Map<string, Set<listener>>`. Do not put a11y trees or secrets on the event type.

`runs.ts`:

```ts
export function createAuthoringRunMap() {
  const controllers = new Map<string, AbortController>();
  return {
    isRunning(conversationId: string) {
      return controllers.has(conversationId);
    },
    begin(conversationId: string) {
      if (controllers.has(conversationId)) {
        throw new Error('Authoring already running');
      }
      const controller = new AbortController();
      controllers.set(conversationId, controller);
      return controller.signal;
    },
    end(conversationId: string) {
      controllers.delete(conversationId);
    },
    abort(conversationId: string) {
      controllers.get(conversationId)?.abort();
      controllers.delete(conversationId);
    },
  };
}
```

Export types and factories from `packages/authoring/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test packages/authoring/tests/events.test.ts packages/authoring/tests/runs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/authoring/src/events.ts packages/authoring/src/runs.ts \
  packages/authoring/src/index.ts \
  packages/authoring/tests/events.test.ts packages/authoring/tests/runs.test.ts
git commit -m "$(cat <<'EOF'
feat: add authoring event bus and in-flight run map

EOF
)"
```

---

### Task 3: Trim LLM messages

**Files:**
- Create: `packages/authoring/src/trim.ts`
- Create: `packages/authoring/tests/trim.test.ts`
- Modify: `packages/authoring/src/index.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export function trimLlmMessages(messages: LlmMessage[]): LlmMessage[];
```

Rules (verbatim from the spec):

- Keep the first `system` message
- Keep all `user` and `assistant` **text** messages
- Keep `tool` / assistant-`toolCalls` rows that belong to the **current user message** only (after the last `role: 'user'`)
- Among `tool` rows named `snapshot` in that window, keep the **last** full `content`; earlier snapshots become `content: JSON.stringify({ truncated: true, note: 'superseded' })`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trimLlmMessages, type LlmMessage } from '../src/trim.ts';

describe('trimLlmMessages', () => {
  it('keeps only the latest snapshot tree in the current user turn', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'You are a web automation agent.' },
      { role: 'user', content: 'Start URL: https://a.example\nGoal: x' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'snapshot', arguments: '{}' }] },
      { role: 'tool', content: '{"tree":"OLD"}', toolCallId: '1', name: 'snapshot' },
      { role: 'user', content: 'keep going' },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'snapshot', arguments: '{}' }] },
      { role: 'tool', content: '{"tree":"FIRST"}', toolCallId: '2', name: 'snapshot' },
      { role: 'assistant', content: '', toolCalls: [{ id: '3', name: 'snapshot', arguments: '{}' }] },
      { role: 'tool', content: '{"tree":"LATEST"}', toolCallId: '3', name: 'snapshot' },
    ];
    const trimmed = trimLlmMessages(messages);
    const snapshots = trimmed.filter((m) => m.role === 'tool' && m.name === 'snapshot');
    assert.equal(snapshots.length, 2);
    assert.deepEqual(JSON.parse(snapshots[0]!.content), { truncated: true, note: 'superseded' });
    assert.equal(snapshots[1]!.content, '{"tree":"LATEST"}');
    assert.equal(
      trimmed.some((m) => m.role === 'tool' && m.content.includes('OLD')),
      false,
    );
    assert.ok(trimmed.some((m) => m.role === 'user' && m.content === 'Start URL: https://a.example\nGoal: x'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/authoring/tests/trim.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Implement `trimLlmMessages` in `packages/authoring/src/trim.ts` per the rules above. Do not import Playwright or the store.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test packages/authoring/tests/trim.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/authoring/src/trim.ts packages/authoring/tests/trim.test.ts packages/authoring/src/index.ts
git commit -m "$(cat <<'EOF'
feat: trim authoring LLM windows to one live snapshot

EOF
)"
```

---

### Task 4: LangGraph authoring runtime

**Files:**
- Modify: `packages/authoring/package.json` (add deps)
- Create: `packages/authoring/src/graph.ts`
- Create: `packages/authoring/src/runtime.ts`
- Modify: `packages/authoring/src/agent.ts` (replace while-loop; new expiry)
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/authoring/tests/agent.test.ts` (existing HITL + expiry cases; add resume + checkpoint-expiry)

**Interfaces:**
- Consumes: `appendConversationMessage`, `patchConversation` (Task 1); `createConversationEventBus`, `createAuthoringRunMap`, `ConversationStreamEvent` (Task 2); `trimLlmMessages`, `LlmMessage` (Task 3); existing `AuthoringDeps`, `executeTool` / session helpers in `agent.ts`
- Produces:

```ts
export type AuthoringResumeValue =
  | { secretsSubmitted: string[] }
  | { keepGoing: true };

export type AuthoringCheckpointPort = {
  has(conversationId: string): Promise<boolean>;
  delete(conversationId: string): Promise<void>;
};

export type AuthoringRuntime = {
  events: ReturnType<typeof createConversationEventBus>;
  isRunning(conversationId: string): boolean;
  invoke(conversationId: string): Promise<void>;
  resume(conversationId: string, value: AuthoringResumeValue): Promise<void>;
  cancel(conversationId: string): Promise<void>;
  hasCheckpoint(conversationId: string): Promise<boolean>;
  deleteCheckpoint(conversationId: string): Promise<void>;
};

export function createAuthoringRuntime(input: {
  store: BillingStore;
  lock: BrowserLock;
  env: NodeJS.ProcessEnv;
  mistral: SettingsDocument['mistral'];
  browser: SettingsDocument['browser'];
  checkpointer: import('@langchain/langgraph').BaseCheckpointSaver;
  checkpoints: AuthoringCheckpointPort;
  deps?: Partial<AuthoringDeps>;
}): AuthoringRuntime;

export async function expireStaleAuthoringSessions(
  store: BillingStore,
  checkpoints: AuthoringCheckpointPort,
): Promise<number>;
```

`handleAuthoringTurn` remains exported and must call `runtime.invoke` **or** stay as a test helper that builds a runtime with `MemorySaver`. Existing tests call `handleAuthoringTurn` — keep that signature working by constructing a per-call `MemorySaver` runtime inside `handleAuthoringTurn` **only when** no shared runtime is passed. Prefer adding an optional last argument:

```ts
export async function handleAuthoringTurn(
  input: { /* existing fields */ },
  runtime?: AuthoringRuntime,
): Promise<void>;
```

If `runtime` is omitted, create an ephemeral `createAuthoringRuntime` with `new MemorySaver()` and an in-memory `AuthoringCheckpointPort` (`Set`). Tests keep calling `handleAuthoringTurn(input)` as today.

**Graph behavior (must match spec):**

1. If `conversation.status !== 'active'` and this is `invoke` (not resume), return.
2. Ensure browser / lock; on busy lock, `$push` “Browser is busy with another session.” and return.
3. Seed `llm_messages` on **first** checkpoint only: system prompt + `Start URL: …\nGoal: …`. On later invokes (checkpoint exists), append the latest **user** message text from the conversation doc **as a single new `user` LlmMessage** — do not copy earlier assistant/user rows from the doc.
4. Model node uses `deps.completeWithTools` (not ChatMistralAI) so CI never hits the network.
5. `ask_secret`: `$push` assistant text with `[secret:key]` placeholders, `patchConversation({ status: 'awaiting_secret' })`, publish `{ type: 'interrupt', kind: 'secret' }`, then `interrupt()`.
6. `propose_job`: validate workflow/schema/extract as today, `$push` assistant text, `patchConversation({ status: 'confirming', draftWorkflow, draftSchema, draftExtract })`, publish `{ type: 'interrupt', kind: 'confirm' }`, then `interrupt()`.
7. Playwright tools: publish `{ type: 'tool', tool }`, `executeTool`, `trimLlmMessages` after each tool, `$push` screenshot assistant message when `screenshotPath` is set, store `last_page_url` from `session.page.url()` when available.
8. Plain-text model reply: `$push` assistant message, publish `turn_end`.
9. Caps 20 / 40: existing `LIMIT_MESSAGE`, `turn_end`.
10. Catch LangGraph interrupt and treat it as success (do not rethrow from `invoke`/`resume`).
11. `begin` at start, `end` in `finally`. If `signal.aborted`, stop.
12. Missing Mistral key: existing assistant copy, close session, `lock.release`, leave status `active`.
13. `cancel`: `runs.abort`, `closeAuthoringSession`, `lock.release`, `checkpoints.delete`.

**Expiry:**

| Condition | Action |
| --- | --- |
| `checkpoints.has(id)` | leave status |
| status in `active` \| `awaiting_secret` \| `confirming` and no checkpoint | `patchConversation({ status: 'expired' })` |
| status in `saved` \| `abandoned` \| `expired` | `checkpoints.delete(id)` if present |

Do **not** use `getAuthoringSession` as the liveness probe.

- [ ] **Step 1: Add dependencies and write failing tests**

From repo root:

```bash
npm install -w @billing-agent/authoring @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint
```

Do **not** add `@langchain/langgraph-checkpoint-mongodb` until Task 6 (worker). Tests use `MemorySaver` from `@langchain/langgraph`.

Extend `packages/authoring/tests/agent.test.ts`:

1. Keep the existing `ask_secret` / `propose_job` / snapshot / no-fetch tests — they must still pass against `handleAuthoringTurn`.
2. **Replace** `expireStaleAuthoringSessions` tests:

```ts
describe('expireStaleAuthoringSessions', () => {
  it('does not expire a conversation that has a checkpoint', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation({ status: 'confirming' });
    await store.upsertConversation(conversation);
    const checkpoints = {
      ids: new Set([conversation.id]),
      async has(id: string) {
        return this.ids.has(id);
      },
      async delete(id: string) {
        this.ids.delete(id);
      },
    };
    const count = await expireStaleAuthoringSessions(store, checkpoints);
    assert.equal(count, 0);
    assert.equal((await store.getConversation(conversation.id))?.status, 'confirming');
  });

  it('expires in-progress conversations with no checkpoint', async () => {
    const store = new AuthoringMemoryStore();
    const conversation = activeConversation({ status: 'confirming' });
    await store.upsertConversation(conversation);
    const checkpoints = {
      async has() {
        return false;
      },
      async delete() {},
    };
    const count = await expireStaleAuthoringSessions(store, checkpoints);
    assert.equal(count, 1);
    assert.equal((await store.getConversation(conversation.id))?.status, 'expired');
  });
});
```

3. Add resume test: after `ask_secret`, `createAuthoringRuntime` + `runtime.resume(id, { secretsSubmitted: ['username', 'password'] })` with `completeWithTools` returning `{ content: 'Thanks, continuing.' }`. Assert status is `active` and a new assistant message exists. Secrets need not be in the store for this test if `fill` is not called.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test packages/authoring/tests/agent.test.ts`

Expected: FAIL on expiry signature / resume / or `ask_secret` if the loop was not replaced yet. If you write tests first while the old loop still exists, the old `ask_secret` test still passes and **expiry tests fail** (arity / old session behavior). That is the fail you want before rewriting.

- [ ] **Step 3: Write minimal implementation**

Install done in Step 1. Implement `graph.ts` as a `StateGraph` with nodes `ensure_browser`, `model`, `act`, `interrupt_hitl`, `reply`. Use `interrupt()` from `@langchain/langgraph` in `interrupt_hitl`. After each Act, replace state `llm_messages` with `trimLlmMessages(...)`.

`runtime.ts` wires `MemorySaver` or the injected `checkpointer`, run map, bus, and `compile`s the graph once.

Move Playwright `executeTool` / `defaultLaunchSession` / `appendMessage` internals as needed. **All conversation writes go through `store.appendConversationMessage` / `store.patchConversation`.** Delete full-document `persistConversation` `$set`s.

Publish events with `at: new Date().toISOString()` and `conversationId`.

`expireStaleAuthoringSessions(store, checkpoints)` as specified.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test packages/authoring/tests/**/*.test.ts`

Expected: PASS (including old HITL, snapshot upload, no real fetch, new expiry, resume).

- [ ] **Step 5: Commit**

```bash
git add packages/authoring package-lock.json
git commit -m "$(cat <<'EOF'
feat: run chat authoring as a LangGraph with interrupts

EOF
)"
```

---

### Task 5: API SSE, 409, signed mutations, resume

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes.ts` (pass `authoring` on context)
- Modify: `apps/api/src/conversation-routes.ts`
- Modify: `apps/api/tests/conversations.test.ts`

**Interfaces:**
- Consumes: `AuthoringRuntime`, `ConversationStreamEvent` (Task 2 / 4)
- Produces:

```ts
// StartServerInput / RouteContext
authoring?: AuthoringRuntime;
// keep onAuthorConversation for existing tests; if authoring is set, use it
```

Route: `GET /conversations/:id/events` **before** the generic GET.

SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Heartbeat: write `: ping\n\n` every 15s. Format:

```ts
function writeSse(res: ServerResponse, event: ConversationStreamEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

`req` `close` / `aborted` → unsubscribe and `clearInterval`.

`POST /messages`: after ownership + `status === 'active'`, if `ctx.authoring?.isRunning(conversationId)` → `409` `{ error: 'Authoring already running' }`. `$push` via `appendConversationMessage`. Respond with `toConversationResponse` + `signConversationScreenshots` + redact (extract a `toSignedConversation(ctx, conversation)` used by GET and mutations). Then `void ctx.authoring?.invoke(id)` or existing `onAuthorConversation`.

`POST /secrets`: after encrypt + `patchConversation({ status: 'active' })`, `void ctx.authoring?.resume(id, { secretsSubmitted: Object.keys(values) })`. Response signed.

`POST /reject`: `patchConversation({ status: 'active' })`, `void ctx.authoring?.resume(id, { keepGoing: true })`. Response signed.

`POST /confirm`: after job save, `await ctx.authoring?.deleteCheckpoint(conversationId)` (and `ctx.lock?.release` as today). No resume.

`POST /abandon`: `await ctx.authoring?.cancel(conversationId)`, then `patchConversation({ status: 'abandoned' })`. If `authoring` is absent, keep today’s `upsert`/`lock.release`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/conversations.test.ts` (reuse `setupServer`, `login`, JWT). Extend `setupServer` to accept `authoring`.

```ts
describe('GET /conversations/:id/events', () => {
  it('is not treated as a conversation id', async () => {
    const { handle, token, store, user } = await setupServer();
    const conversation = confirmingConversation(user.id, { id: 'conv-events', status: 'active' });
    await store.upsertConversation(conversation);
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/conv-events/events`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    response.body?.cancel();
  });

  it('returns 404 for another user', async () => {
    const { handle, store, user } = await setupServer();
    const conversation = confirmingConversation(user.id, { id: 'conv-private', status: 'active' });
    await store.upsertConversation(conversation);
    const other = await createUser(store, 'other@example.com', 'other-password');
    const otherToken = await login(handle.port, 'other@example.com', 'other-password');
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/conv-private/events`,
      { headers: { authorization: `Bearer ${otherToken}` } },
    );
    assert.equal(response.status, 404);
  });
});

describe('POST /conversations/:id/messages in-flight', () => {
  it('returns 409 when authoring is already running', async () => {
    const authoring = {
      events: createConversationEventBus(),
      isRunning: () => true,
      invoke: async () => {},
      resume: async () => {},
      cancel: async () => {},
      hasCheckpoint: async () => false,
      deleteCheckpoint: async () => {},
    };
    const { handle, token, store, user } = await setupServer({ authoring });
    const conversation = confirmingConversation(user.id, { id: 'conv-busy', status: 'active' });
    await store.upsertConversation(conversation);
    const response = await fetch(
      `http://127.0.0.1:${handle.port}/conversations/conv-busy/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello' }),
      },
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, 'Authoring already running');
  });
});
```

Reuse existing helpers in this file: `confirmingConversation`, `createUser(store, email, password)`, `login(port, email, password)`, `setupServer`.

Add a test that `POST /messages` response includes `screenshotUrl` when the stored message has a conversation screenshot key **and** env has signing configured — only if `apps/api/tests` already stubs signing; otherwise assert GET and POST message payloads share the same `toSignedConversation` by checking `screenshotPath` is preserved and `screenshotUrl` is either both present or both absent. Minimum: POST response `messages` length includes the new user line **and** prior assistant screenshot message is still present (proves `$push` not full replace).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test apps/api/tests/conversations.test.ts`

Expected: FAIL (`/events` returns 404 JSON “Conversation not found”).

- [ ] **Step 3: Write minimal implementation**

Wire `authoring` through `startServer` → `handleRoute` → `handleConversationRoutes`.

In `handleConversationRoutes`, **before** the generic GET:

```ts
const eventsId = parseConversationSubresourceId(pathname, '/events');
if (eventsId && method === 'GET') {
  await handleConversationEvents(req, res, ctx, userId, eventsId);
  return true;
}
```

Implement `handleConversationEvents` as specified. Heartbeat `15_000`. If `ctx.authoring` is missing, still open the stream (heartbeats only) so the 200 test passes.

Switch mutation handlers to `appendConversationMessage` / `patchConversation` and `toSignedConversation`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test apps/api/tests/conversations.test.ts apps/api/tests/api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes.ts \
  apps/api/src/conversation-routes.ts apps/api/tests/conversations.test.ts
git commit -m "$(cat <<'EOF'
feat: stream conversation tool events and stop clobbering chats

EOF
)"
```

---

### Task 6: Worker Mongo checkpointer and expiry

**Files:**
- Modify: `packages/authoring/package.json` (add `@langchain/langgraph-checkpoint-mongodb`)
- Modify: `apps/worker/src/cli.ts`
- Create: `packages/authoring/src/mongo-checkpoints.ts`
- Create: `packages/authoring/tests/mongo-checkpoints.test.ts` (unit-test the port wrapper with a fake saver — do not require a live Mongo)

**Interfaces:**
- Consumes: `connectStoreWithClient`, `createAuthoringRuntime`, `expireStaleAuthoringSessions(store, checkpoints)`
- Produces: daemon `authoring` runtime passed into `startServer({ authoring })`

```ts
// mongo-checkpoints.ts
export function createMongoCheckpointPort(input: {
  saver: { getTuple(config: { configurable: { thread_id: string } }): Promise<unknown> };
  deleteThread(threadId: string): Promise<void>;
}): AuthoringCheckpointPort;
```

`has` is `Boolean(await saver.getTuple({ configurable: { thread_id } }))`. If `MongoDBSaver` uses a different get API, wrap **that** API — do not invent a second collection format. Collection name: `langgraph_checkpoints`.

`onAuthorConversation` in `cli.ts` becomes `authoring.invoke(conversationId)` (load mistral/browser from `loadConfigFromStore` **before** `createAuthoringRuntime` and rebuild runtime on settings change **or** pass getters into runtime — pick getters on `createAuthoringRuntime` if settings can change without process restart: `getMistral: () => latest.mistral`. If you add getters, keep Task 4’s object-of-values working by accepting either constants or thunks. Simplest v1: create the runtime **inside** each invoke using current settings, sharing `events`, `runs`, `checkpointer`, `checkpoints` via a closure. That matches today’s `loadConfigFromStore` per turn.

Daemon start:

```ts
const { store, client } = await connectStoreWithClient(requireMongoUri());
const saver = new MongoDBSaver({
  client,
  checkpointCollectionName: 'langgraph_checkpoints',
});
const checkpoints = createMongoCheckpointPort({
  saver,
  deleteThread: (threadId) => saver.deleteThread(threadId),
});
await expireStaleAuthoringSessions(store, checkpoints);
const events = createConversationEventBus();
const runs = createAuthoringRunMap();
// authoring runtime shares events/runs/saver
const server = await startServer({
  /* existing */
  authoring: /* runtime */,
});
```

Do **not** loop checkpoints and `invoke`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMongoCheckpointPort } from '../src/mongo-checkpoints.ts';

describe('createMongoCheckpointPort', () => {
  it('has() is true only when getTuple returns a value', async () => {
    const tuples = new Map<string, object>([['conv-1', { id: 'ckpt' }]]);
    const port = createMongoCheckpointPort({
      saver: {
        async getTuple(config) {
          return tuples.get(config.configurable.thread_id) ?? null;
        },
      },
      async deleteThread(threadId) {
        tuples.delete(threadId);
      },
    });
    assert.equal(await port.has('conv-1'), true);
    assert.equal(await port.has('conv-2'), false);
    await port.delete('conv-1');
    assert.equal(await port.has('conv-1'), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/authoring/tests/mongo-checkpoints.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Implement `createMongoCheckpointPort`. Wire `apps/worker/src/cli.ts` daemon as above. Keep `handleAuthoringTurn` import only if the runtime uses it internally.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test packages/authoring/tests/mongo-checkpoints.test.ts packages/authoring/tests/agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/authoring/src/mongo-checkpoints.ts \
  packages/authoring/tests/mongo-checkpoints.test.ts \
  packages/authoring/package.json package-lock.json \
  apps/worker/src/cli.ts
git commit -m "$(cat <<'EOF'
feat: checkpoint authoring turns in Mongo on daemon start

EOF
)"
```

---

### Task 7: Web thread SSE and poll fallback

**Files:**
- Modify: `apps/web/src/lib/conversations-api.ts`
- Create: `apps/web/src/lib/conversations-api.test.ts` (or append if the untracked test file already exists)
- Modify: `apps/web/src/pages/chat-page.tsx`
- Modify: `apps/web/src/pages/chat-page.test.tsx`

**Interfaces:**
- Consumes: SSE `event` / `data` format from Task 5; `ConversationStreamEvent` shape (duplicate the type on the web — do not import `@billing-agent/authoring` into Vite)
- Produces:

```ts
export type ConversationToolName =
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'wait'
  | 'extract_candidates';

export type ConversationStreamEvent =
  | { type: 'tool'; tool: ConversationToolName; conversationId: string; at: string }
  | { type: 'interrupt'; kind: 'secret' | 'confirm'; conversationId: string; at: string }
  | { type: 'turn_end'; conversationId: string; at: string };

export function subscribeConversationEvents(
  conversationId: string,
  onEvent: (event: ConversationStreamEvent) => void,
  signal: AbortSignal,
): Promise<void>;
```

Parser: read `response.body` as text stream, split on `\n\n`, parse `event:` and `data:` lines, `JSON.parse` data, ignore unknown `event` names and `: comment` heartbeats. Use `apiFetch` so Bearer and 401 logout apply.

`ChatThread`:

- `progressTool: ConversationToolName | null`
- On mount / `conversationId` change: GET; if polling status, `AbortController` + `subscribeConversationEvents`. Abort GET and SSE on change/unmount.
- `tool` → set `progressTool`. Waiting bubble text: `Snapshot…` / `Click…` / `Fill…` / `Wait…` / `Extract…` (map `extract_candidates` → `Extract`). Do not append messages from events.
- `interrupt` | `turn_end` → `progressTool = null`, GET once.
- Subscribe throw/reject → keep 2s GET poll (existing). While subscribe is open, you may still poll until the first event; after first event, clear the interval. After `turn_end`, do not poll until the user sends / secrets / keep-going (status still polling for secrets/confirm — reconnect SSE, no 2s GET unless SSE dies).
- Waiting bubble: existing `isAwaitingReply` **or** `progressTool !== null`.

- [ ] **Step 1: Write the failing tests**

Mock `subscribeConversationEvents` in `chat-page.test.tsx` **by default** as `vi.fn().mockRejectedValue(new Error('sse off'))` so existing poll tests keep using GET.

New tests:

```ts
it('shows Snapshot… when a tool event arrives', async () => {
  let send: ((event: conversationsApi.ConversationStreamEvent) => void) | undefined;
  vi.mocked(conversationsApi.subscribeConversationEvents).mockImplementation(
    async (_id, onEvent) => {
      send = onEvent;
      await new Promise(() => {});
    },
  );
  vi.mocked(conversationsApi.getConversation).mockResolvedValue(conversation());
  render(/* MemoryRouter /chat/conv-1 */);
  await flushAsync();
  await act(async () => {
    send?.({
      type: 'tool',
      tool: 'snapshot',
      conversationId: 'conv-1',
      at: '2026-09-14T00:00:00.000Z',
    });
  });
  expect(screen.getByText('Snapshot…')).toBeInTheDocument();
});

it('refetches on turn_end', async () => {
  let send: ((event: conversationsApi.ConversationStreamEvent) => void) | undefined;
  vi.mocked(conversationsApi.subscribeConversationEvents).mockImplementation(
    async (_id, onEvent) => {
      send = onEvent;
      await new Promise(() => {});
    },
  );
  vi.mocked(conversationsApi.getConversation)
    .mockResolvedValueOnce(conversation())
    .mockResolvedValueOnce(
      conversation({
        messages: [
          { id: 'm2', role: 'assistant', text: 'Done.', createdAt: '2026-09-14T00:01:00.000Z' },
        ],
      }),
    );
  render(/* … */);
  await flushAsync();
  await act(async () => {
    send?.({ type: 'turn_end', conversationId: 'conv-1', at: '2026-09-14T00:01:00.000Z' });
  });
  await flushAsync();
  expect(conversationsApi.getConversation).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Done.')).toBeInTheDocument();
});
```

Parser unit test in `conversations-api.test.ts`: given a mocked `apiFetch` that returns a `Response` with a `ReadableStream` of `event: tool\ndata: {"tool":"click","conversationId":"c","at":"t"}\n\n`, `onEvent` receives that object. A `: ping\n\n` chunk does not call `onEvent`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @billing-agent/web -- src/pages/chat-page.test.tsx src/lib/conversations-api.test.ts`

Expected: FAIL (`subscribeConversationEvents` not exported / label missing).

- [ ] **Step 3: Write minimal implementation**

Implement `subscribeConversationEvents` with `apiFetch(\`/conversations/${id}/events\`)`. Implement ChatThread subscription + labels. Do not add a global store.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @billing-agent/web`

Expected: PASS (including existing poll / confirm / list tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/conversations-api.ts apps/web/src/lib/conversations-api.test.ts \
  apps/web/src/pages/chat-page.tsx apps/web/src/pages/chat-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: show live authoring tool progress on the chat thread

EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| `$push` / field `$set`; `upsertConversation` create-only | 1 |
| In-process bus; SSE payloads without trees/secrets | 2, 5 |
| In-flight AbortController map; 409 | 2, 5 |
| Trim: one snapshot, current user turn only | 3 |
| StateGraph, `interrupt`, `Command` resume, `completeWithTools` | 4 |
| `[secret:key]` placeholders; no `requiredKeys` field | 4 |
| Expiry by checkpoint, not Playwright RAM | 4, 6 |
| Confirm deletes checkpoint, no resume | 5 |
| Abandon cancel + delete checkpoint | 4, 5 |
| SSE before `GET :id`; fetch + Bearer | 5, 7 |
| Sign+redact mutation responses | 5 |
| Mongo `langgraph_checkpoints`; no auto-invoke | 6 |
| UI labels, poll fallback, abort on unmount | 7 |
| No token stream / WS / Cloud / debug stream | Global — no task adds them |

## Notes for the implementer

- LangGraph’s `MemorySaver` / `interrupt` / `Command` / `MongoDBSaver` import paths can move between minors. Use the exports from the installed version; do not change the **ports** (`AuthoringRuntime`, `AuthoringCheckpointPort`, `ConversationStreamEvent`).
- If `MongoDBSaver.deleteThread` is named differently, adapt `createMongoCheckpointPort` only.
- Do not import `@billing-agent/authoring` from `apps/web`.
