# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chat hub history list so an operator can reopen a leftover session and Abandon it to release the browser.

**Architecture:** `GET /conversations` returns user-scoped summaries (no messages or drafts). `/chat` renders that list; `/chat/new` is the existing composer; `/chat/:id` is the existing thread with Abandon unchanged.

**Tech Stack:** Node `node:test` + `tsx` (API), React 18, React Router 7, Cleanplate `Table` / `PageHeader` / `FeedbackState`, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-19-chat-history-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- `GET /conversations` is JWT + `userId` scoped; another user’s conversation is omitted from the list and still 404 on detail
- Summaries omit `messages`, draft fields, and `userId`
- Sort: `updatedAt` descending (existing `listConversations` order)
- No list filters, pagination, lock-holder badge, list Abandon, or busy-message copy changes
- `/chat/new` registered **before** `/chat/:conversationId`
- Table: Cleanplate `mobileColumns` required; no row action column; row click opens the session
- Prefer Cleanplate spacing; add an SCSS module only if layout classes are needed
- Abandon stays on the session page and already navigates to `/chat`

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/conversation-routes.ts` | `GET /conversations` → summary array, matched before `:id` |
| `apps/api/tests/conversations.test.ts` | List newest-first, omit messages/drafts, exclude other users |
| `apps/web/src/lib/types.ts` | `ConversationSummary` |
| `apps/web/src/lib/conversations-api.ts` | `listConversations()` |
| `apps/web/src/lib/conversation-status.ts` | Shared status → badge variant |
| `apps/web/src/lib/conversation-status.test.ts` | Variant mapping |
| `apps/web/src/components/conversations-table.tsx` | History table; row click |
| `apps/web/src/pages/chat-page.tsx` | Export `ChatListPage`, `ChatComposer`, `ChatPage` (thread) |
| `apps/web/src/app.tsx` | Wire `/chat`, `/chat/new`, `/chat/:conversationId` |
| `apps/web/src/pages/chat-page.test.tsx` | List, empty, New chat, existing composer/session |
| `apps/web/README.md` | Document Chat routes |

---

### Task 1: `GET /conversations` summaries

**Files:**
- Modify: `apps/api/src/conversation-routes.ts`
- Test: `apps/api/tests/conversations.test.ts`

**Interfaces:**
- Consumes: `BillingStore.listConversations({ userId })` (already implemented, newest `updatedAt` first)
- Produces: `GET /conversations` → `200` JSON array of
  `{ id, status, goal, startUrl, jobId, createdAt, updatedAt }`

- [ ] **Step 1: Write the failing tests**

Append this `describe` to `apps/api/tests/conversations.test.ts` (reuse `setupServer`, `createUser`, `login`, `confirmingConversation`):

```ts
describe('GET /conversations', () => {
  it('returns the caller summaries newest-first and omits messages and drafts', async () => {
    const { handle, store, user, token } = await setupServer();
    const older = confirmingConversation(user.id, {
      id: 'conv-older',
      status: 'saved',
      jobId: 'job-1',
      goal: 'Older goal',
      messages: [{ id: 'm1', role: 'assistant', text: 'done', createdAt: '2026-08-01T00:00:00.000Z' }],
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const newer = confirmingConversation(user.id, {
      id: 'conv-newer',
      status: 'active',
      goal: 'Newer goal',
      messages: [{ id: 'm2', role: 'user', text: 'hello', createdAt: '2026-08-02T00:00:00.000Z' }],
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    await store.upsertConversation(older);
    await store.upsertConversation(newer);

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    assert.equal(body.length, 2);
    assert.equal(body[0]?.id, 'conv-newer');
    assert.equal(body[1]?.id, 'conv-older');
    assert.deepEqual(body[0], {
      id: 'conv-newer',
      status: 'active',
      goal: 'Newer goal',
      startUrl: 'https://sivadass.in/',
      jobId: null,
      createdAt: newer.createdAt,
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    assert.equal(body[0]?.messages, undefined);
    assert.equal('draftWorkflow' in body[0]!, false);
    assert.equal('draftSchema' in body[0]!, false);
    assert.equal('draftExtract' in body[0]!, false);
    assert.equal('draftNotify' in body[0]!, false);
    assert.equal('draftSchedule' in body[0]!, false);
    assert.equal('userId' in body[0]!, false);
  });

  it('excludes another user conversation from the list', async () => {
    const { handle, store, user, token } = await setupServer();
    await store.upsertConversation(
      confirmingConversation(user.id, { id: 'mine', goal: 'Mine' }),
    );
    const other = await createUser(store, 'other@example.com', 'other-password');
    await store.upsertConversation(
      confirmingConversation(other.id, { id: 'theirs', goal: 'Theirs' }),
    );

    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<{ id: string }>;
    assert.deepEqual(
      body.map((row) => row.id),
      ['mine'],
    );
  });

  it('does not treat GET /conversations as GET /conversations/:id', async () => {
    const { handle, token } = await setupServer();
    const response = await fetch(`http://127.0.0.1:${handle.port}/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/api`

Expected: FAIL — `GET /conversations` is not a list (404 or unhandled), or the body is not a summary array.

- [ ] **Step 3: Implement the list route**

In `apps/api/src/conversation-routes.ts`, add a mapper and handler next to `toConversationResponse`:

```ts
type ConversationSummaryResponse = {
  id: string;
  status: ConversationDocument['status'];
  goal: string | null;
  startUrl: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toConversationSummary(
  conversation: ConversationDocument,
): ConversationSummaryResponse {
  return {
    id: conversation.id,
    status: conversation.status,
    goal: conversation.goal,
    startUrl: conversation.startUrl,
    jobId: conversation.jobId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

async function handleListConversations(
  res: ServerResponse,
  ctx: ConversationRouteContext,
  userId: string,
): Promise<void> {
  const conversations = await ctx.store.listConversations({ userId });
  sendJson(res, 200, conversations.map(toConversationSummary));
}
```

In `handleConversationRoutes`, handle the list **before** create and `:id`:

```ts
  if (method === 'GET' && pathname === '/conversations') {
    await handleListConversations(res, ctx, userId);
    return true;
  }

  if (method === 'POST' && pathname === '/conversations') {
    await handleCreateConversation(req, res, ctx, userId);
    return true;
  }
```

Leave `GET /conversations/:id` and all `POST /conversations/:id/…` handlers unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/api`

Expected: PASS (existing conversation tests plus the new `GET /conversations` describe).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/conversation-routes.ts apps/api/tests/conversations.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add GET /conversations summary list

EOF
)"
```

---

### Task 2: Shared conversation status badge helper

**Files:**
- Create: `apps/web/src/lib/conversation-status.ts`
- Create: `apps/web/src/lib/conversation-status.test.ts`
- Modify: `apps/web/src/pages/chat-page.tsx` (replace local `statusVariant`)

**Interfaces:**
- Produces: `export function conversationStatusVariant(status: ConversationStatus): 'success' | 'warning' | 'error' | 'default'`
- Consumes later: `ConversationsTable` and `ChatThread` both call this

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/conversation-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { conversationStatusVariant } from './conversation-status';

describe('conversationStatusVariant', () => {
  it('maps saved to success', () => {
    expect(conversationStatusVariant('saved')).toBe('success');
  });

  it('maps in-progress statuses to warning', () => {
    expect(conversationStatusVariant('active')).toBe('warning');
    expect(conversationStatusVariant('awaiting_secret')).toBe('warning');
    expect(conversationStatusVariant('confirming')).toBe('warning');
  });

  it('maps abandoned and expired to error', () => {
    expect(conversationStatusVariant('abandoned')).toBe('error');
    expect(conversationStatusVariant('expired')).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/web -- src/lib/conversation-status.test.ts`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper and switch the thread to it**

Create `apps/web/src/lib/conversation-status.ts`:

```ts
import type { ConversationStatus } from './types';

export function conversationStatusVariant(
  status: ConversationStatus,
): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'saved') return 'success';
  if (status === 'active' || status === 'confirming' || status === 'awaiting_secret') {
    return 'warning';
  }
  if (status === 'expired' || status === 'abandoned') return 'error';
  return 'default';
}
```

In `apps/web/src/pages/chat-page.tsx`:

- Import `conversationStatusVariant` from `../lib/conversation-status`
- Delete the local `statusVariant` function
- In `ChatThread`, call `conversationStatusVariant(conversation.status)` where `statusVariant` was used

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/web -- src/lib/conversation-status.test.ts src/pages/chat-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/conversation-status.ts apps/web/src/lib/conversation-status.test.ts apps/web/src/pages/chat-page.tsx
git commit -m "$(cat <<'EOF'
feat(web): share conversation status badge variants

EOF
)"
```

---

### Task 3: Chat list hub, composer route, and table

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/conversations-api.ts`
- Create: `apps/web/src/components/conversations-table.tsx`
- Modify: `apps/web/src/pages/chat-page.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/pages/chat-page.test.tsx`
- Modify: `apps/web/README.md`

**Interfaces:**
- Consumes: `GET /conversations` summaries from Task 1; `conversationStatusVariant` from Task 2
- Produces:
  - `export type ConversationSummary = { id: string; status: ConversationStatus; goal: string | null; startUrl: string | null; jobId: string | null; createdAt: string; updatedAt: string }`
  - `export async function listConversations(): Promise<ConversationSummary[]>`
  - `export function ConversationsTable(props: { conversations: ConversationSummary[]; onSelect: (conversation: ConversationSummary) => void }): JSX.Element`
  - `export function ChatListPage(): JSX.Element`
  - `export function ChatComposer(): JSX.Element` (existing composer, now exported)
  - Routes: `/chat` → `ChatListPage`, `/chat/new` → `ChatComposer`, `/chat/:conversationId` → `ChatPage`

- [ ] **Step 1: Write the failing list/composer tests**

In `apps/web/src/pages/chat-page.test.tsx`:

1. Add `listConversations: vi.fn()` to the `vi.mock('../lib/conversations-api')` factory.
2. Change the composer describe to render `ChatComposer` at `/chat/new` (import `ChatComposer` from `./chat-page`).
3. Add list tests. Keep existing polling/confirm tests on `ChatPage` at `/chat/:conversationId`.

Composer test after the move:

```tsx
describe('ChatPage composer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the canonical sivadass example', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/new']}>
        <Routes>
          <Route path="/chat/new" element={<ChatComposer />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('https://sivadass.in/')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Grab the contact email address').length).toBeGreaterThan(0);
  });
});
```

Add list tests (import `ChatComposer`, `ChatListPage`, and `ConversationSummary`):

```tsx
import type { ConversationSummary } from '../lib/types';
import { ChatComposer, ChatListPage, ChatPage } from './chat-page';

function summary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  const now = '2026-08-17T12:00:00.000Z';
  return {
    id: 'conv-1',
    status: 'active',
    goal: 'Grab the contact email address',
    startUrl: 'https://sivadass.in/',
    jobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
```

Then add this describe (keep existing polling/confirm describes using `ChatPage`):

```tsx
describe('Chat list', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists conversations and navigates to a session on row click', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([
      summary(),
      summary({
        id: 'conv-2',
        status: 'saved',
        goal: 'Draft TNEB job',
        startUrl: 'https://www.tnebnet.org/awp/login',
      }),
    ]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/:conversationId" element={<div>Session conv-1</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Grab the contact email address')).toBeInTheDocument();
    expect(screen.getByText('Draft TNEB job')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Grab the contact email address'));
    expect(await screen.findByText('Session conv-1')).toBeInTheDocument();
  });

  it('navigates to the composer from New chat', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([summary()]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/new" element={<div>Composer route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /new chat/i }));
    expect(await screen.findByText('Composer route')).toBeInTheDocument();
  });

  it('shows an empty state when there are no chats', async () => {
    vi.mocked(conversationsApi.listConversations).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/new" element={<div>Composer route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('No chats yet')).toBeInTheDocument();
    const newChatButtons = screen.getAllByRole('button', { name: /new chat/i });
    fireEvent.click(newChatButtons[0]!);
    expect(await screen.findByText('Composer route')).toBeInTheDocument();
  });
});
```

Empty list has both the header **New chat** and the empty-state CTA; `getAllByRole` avoids a duplicate-name error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/web -- src/pages/chat-page.test.tsx`

Expected: FAIL — `listConversations` / `ChatListPage` / `ChatComposer` export missing, or `/chat` still renders the composer.

- [ ] **Step 3: Implement types, client, table, pages, and routes**

**`apps/web/src/lib/types.ts`** — add after `ConversationStatus`:

```ts
export type ConversationSummary = {
  id: string;
  status: ConversationStatus;
  goal: string | null;
  startUrl: string | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

**`apps/web/src/lib/conversations-api.ts`** — import `ConversationSummary` and add:

```ts
export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await apiFetch('/conversations');
  await throwForNonOk(response);
  return parseJson<ConversationSummary[]>(response);
}
```

**`apps/web/src/components/conversations-table.tsx`:**

```tsx
import { Badge, Table } from 'cleanplate';
import { conversationStatusVariant } from '../lib/conversation-status';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { ConversationSummary } from '../lib/types';

type ConversationsTableProps = {
  conversations: ConversationSummary[];
  onSelect: (conversation: ConversationSummary) => void;
};

type ConversationsTableRow = {
  id: string;
  goal: string;
  status: ConversationSummary['status'];
  statusLabel: string;
  startUrl: string;
  updatedAtLabel: string;
  conversation: ConversationSummary;
};

export function ConversationsTable({ conversations, onSelect }: ConversationsTableProps) {
  const rows: ConversationsTableRow[] = conversations.map((conversation) => ({
    id: conversation.id,
    goal: conversation.goal?.trim() ? conversation.goal : (conversation.startUrl ?? conversation.id),
    status: conversation.status,
    statusLabel: conversation.status,
    startUrl: conversation.startUrl ?? '—',
    updatedAtLabel: humanizeTimestamp(conversation.updatedAt),
    conversation,
  }));

  return (
    <Table
      columns={[
        { id: 'goal', title: 'Goal' },
        {
          id: 'status',
          title: 'Status',
          customRender: (raw) => {
            const row = raw as ConversationsTableRow;
            return (
              <Badge
                label={row.statusLabel}
                variant={conversationStatusVariant(row.status)}
              />
            );
          },
        },
        { id: 'startUrl', title: 'Start URL' },
        {
          id: 'updatedAtLabel',
          title: 'Updated',
          customRender: (raw) => {
            const row = raw as ConversationsTableRow;
            return (
              <span title={new Date(row.conversation.updatedAt).toLocaleString()}>
                {row.updatedAtLabel}
              </span>
            );
          },
        },
      ]}
      data={rows}
      onRowClick={(raw) => onSelect((raw as ConversationsTableRow).conversation)}
      mobileColumns={{
        title: 'goal',
        subtitle: (raw) => (raw as ConversationsTableRow).startUrl,
        meta: (raw) => {
          const row = raw as ConversationsTableRow;
          return (
            <Badge
              label={row.statusLabel}
              variant={conversationStatusVariant(row.status)}
            />
          );
        },
        description: (raw) => (raw as ConversationsTableRow).updatedAtLabel,
      }}
    />
  );
}
```

No SCSS module unless Cleanplate spacing is insufficient.

**`apps/web/src/pages/chat-page.tsx`:**

- Import `Button` (already imported), `listConversations`, `ConversationsTable`, `ConversationSummary`
- Change `function ChatComposer()` to `export function ChatComposer()`
- Change composer `PageHeader` title from `"Chat"` to `"New chat"`; keep the existing subtitle
- Add `ChatListPage` (Jobs-page loading/error pattern; reuse `styles['loading-state']`):

```tsx
export function ChatListPage() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listConversations()
      .then((items) => {
        if (!cancelled) setConversations(items);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load chats');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle="Reopen a session to continue or abandon it."
        primaryCta={
          <Button variant="solid" onClick={() => navigate('/chat/new')}>
            New chat
          </Button>
        }
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}
      {!isLoading && !error && conversations.length === 0 ? (
        <FeedbackState
          variant="empty"
          margin="t-5"
          title="No chats yet"
          primaryAction={{ label: 'New chat', onClick: () => navigate('/chat/new') }}
        />
      ) : null}
      {!isLoading && !error && conversations.length > 0 ? (
        <ConversationsTable
          conversations={conversations}
          onSelect={(conversation) => navigate(`/chat/${conversation.id}`)}
        />
      ) : null}
    </>
  );
}
```

- Change `ChatPage` so it is **only** the thread (list and composer are their own route elements):

```tsx
export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  if (!conversationId) return <ChatListPage />;
  return <ChatThread conversationId={conversationId} />;
}
```

Keep the `if (!conversationId)` fallback so a mis-wired `/chat` still shows the list, not the composer.

**`apps/web/src/app.tsx`** — import `ChatComposer` and `ChatListPage`; register `/chat/new` **before** the param route:

```tsx
            <Route path="/chat" element={<ChatListPage />} />
            <Route path="/chat/new" element={<ChatComposer />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
```

**`apps/web/README.md`** — in “App hubs and routes”, add:

```md
- `/chat` - conversation history; row opens a session
- `/chat/new` - start a new authoring chat
- `/chat/:conversationId` - chat session (Abandon releases the browser if this session holds it)
```

Update the `/jobs/new` bullet if it still says “points at chat” — leave `/jobs/new` as-is unless that sentence is now wrong; Chat is the authoring path, so no change required beyond adding the three `/chat` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/web`

Expected: PASS, including list, empty state, composer on `/chat/new`, and existing session polling/confirm tests.

If row click does not fire from `getByText` on the goal, click the table row container (`closest('tr')` or the Cleanplate row role) — do not add a row action button.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/conversations-api.ts apps/web/src/components/conversations-table.tsx apps/web/src/pages/chat-page.tsx apps/web/src/app.tsx apps/web/src/pages/chat-page.test.tsx apps/web/README.md
git commit -m "$(cat <<'EOF'
feat(web): add chat history list hub

EOF
)"
```

---

## Self-review

| Spec requirement | Task |
| --- | --- |
| `GET /conversations` summaries, newest first, user scoped | Task 1 |
| Omit messages/drafts/`userId` | Task 1 |
| List route not shadowed by `:id` | Task 1 |
| Shared status badge variants | Task 2 |
| `/chat` table + New chat | Task 3 |
| `/chat/new` composer | Task 3 |
| `/chat/:id` thread + Abandon unchanged | Task 3 (no abandon changes) |
| `mobileColumns` | Task 3 table |
| Empty / loading / error | Task 3 list page |
| README Chat routes | Task 3 |
| No filters, lock badge, list Abandon, busy copy | Honored (not in any task) |
