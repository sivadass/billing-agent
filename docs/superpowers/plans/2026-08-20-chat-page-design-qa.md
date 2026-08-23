# Chat Page Design QA Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all design QA audit issues on chat surfaces so the UI is WCAG AA on `--gray-10`, usable at 375px, and visually polished through P1 (P2 optional follow-up).

**Architecture:** Phased PRs (P0 blockers → P1 major → P2 minor/nit). Extract `conversationStatusLabel()` and `sanitizeMessageText()` to `apps/web/src/lib/`. Layout and bubble styles stay in `chat-page.module.scss`. No API changes.

**Tech Stack:** React 18, React Router 7, Cleanplate (`PageHeader`, `Badge`, `ConfirmDialog`, `BreadCrumb`, `Table`), Vitest, Testing Library, SCSS modules

**Spec:** `docs/superpowers/specs/2026-08-20-chat-page-design-qa-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- Do **not** change `apps/web/src/theme.css` global `--text-muted`; use `--text-subtle` in chat SCSS only
- Do **not** modify Cleanplate upstream or API routes
- Spacing: Cleanplate `--space-*` tokens (4px scale); radius: `var(--radius-xx-large)` / `var(--radius-xxx-large)` where spec says
- Status badges: tinted surface + `--text-default` foreground; ≥4.5:1 contrast at 13px
- Abandon: `PageHeader.moreMenuItems` + `ConfirmDialog` (mirror `apps/web/src/components/jobs-table.tsx`)
- Secret parsing: `parseSecretKeysFromMessages` reads **raw** message text; UI renders `sanitizeMessageText(message.text)`
- Human status labels everywhere badges appear (never raw `awaiting_secret`)
- `/chat/new` route stays registered before `/chat/:conversationId`

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/src/lib/conversation-status-label.ts` | `conversationStatusLabel(status)` → human string |
| `apps/web/src/lib/conversation-status-label.test.ts` | Label map coverage |
| `apps/web/src/lib/sanitize-message-text.ts` | Strip `[secret:…]` for display |
| `apps/web/src/lib/sanitize-message-text.test.ts` | Sanitizer coverage |
| `apps/web/src/lib/conversation-status.ts` | Existing variant map (unchanged API) |
| `apps/web/src/components/conversations-table.tsx` | Goal fallback, labels, status badge wrapper |
| `apps/web/src/components/conversations-table.module.scss` | Mobile title ellipsis (new) |
| `apps/web/src/components/chat-status-badge.tsx` | Wrapper with contrast-safe classes (new) |
| `apps/web/src/pages/chat-page.tsx` | Thread layout, header, composer, list, abandon dialog |
| `apps/web/src/pages/chat-page.module.scss` | Session column, bubbles, dock, badges, grid |
| `apps/web/src/pages/chat-page.test.tsx` | Regression tests |
| `apps/web/src/components/image-lightbox.module.scss` | Thumbnail min-height (P2) |

---

## PR 1 — P0 Blockers (ship as one PR)

### Task 1: Human status labels (lib)

**Files:**
- Create: `apps/web/src/lib/conversation-status-label.ts`
- Create: `apps/web/src/lib/conversation-status-label.test.ts`

**Interfaces:**
- Produces: `conversationStatusLabel(status: ConversationStatus): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/conversation-status-label.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { conversationStatusLabel } from './conversation-status-label';
import type { ConversationStatus } from './types';

const CASES: Array<[ConversationStatus, string]> = [
  ['active', 'In progress'],
  ['awaiting_secret', 'Needs secrets'],
  ['confirming', 'Ready to confirm'],
  ['saved', 'Saved'],
  ['expired', 'Expired'],
  ['abandoned', 'Abandoned'],
];

describe('conversationStatusLabel', () => {
  it.each(CASES)('maps %s → %s', (status, label) => {
    expect(conversationStatusLabel(status)).toBe(label);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/web -- src/lib/conversation-status-label.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/conversation-status-label.ts`:

```typescript
import type { ConversationStatus } from './types';

const LABELS: Record<ConversationStatus, string> = {
  active: 'In progress',
  awaiting_secret: 'Needs secrets',
  confirming: 'Ready to confirm',
  saved: 'Saved',
  expired: 'Expired',
  abandoned: 'Abandoned',
};

export function conversationStatusLabel(status: ConversationStatus): string {
  return LABELS[status];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @billing-agent/web -- src/lib/conversation-status-label.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/conversation-status-label.ts apps/web/src/lib/conversation-status-label.test.ts
git commit -m "feat(web): add human-readable conversation status labels"
```

---

### Task 2: Contrast-safe status badge component

**Files:**
- Create: `apps/web/src/components/chat-status-badge.tsx`
- Modify: `apps/web/src/pages/chat-page.module.scss` (append `.status-badge` rules at end)

**Interfaces:**
- Consumes: `conversationStatusLabel`, `conversationStatusVariant`, Cleanplate `Badge`
- Produces: `<ChatStatusBadge status={ConversationStatus} />`

- [ ] **Step 1: Add SCSS variants**

Append to `apps/web/src/pages/chat-page.module.scss`:

```scss
.status-badge {
  display: inline-block;
  padding: 0 var(--space-2);
  border-radius: var(--radius-small);
  font-size: 13px;
  line-height: 1.5;
  font-weight: 400;
  color: var(--text-default);

  &--in-progress {
    background-color: var(--orange-light);
  }

  &--saved {
    background-color: var(--green-light);
  }

  &--error {
    background-color: var(--red-light);
  }
}
```

- [ ] **Step 2: Create component**

Create `apps/web/src/components/chat-status-badge.tsx`:

```typescript
import { conversationStatusLabel } from '../lib/conversation-status-label';
import type { ConversationStatus } from '../lib/types';
import styles from '../pages/chat-page.module.scss';

type ChatStatusBadgeProps = {
  status: ConversationStatus;
};

function statusToneClass(status: ConversationStatus): string {
  if (status === 'saved') return styles['status-badge--saved'];
  if (status === 'expired' || status === 'abandoned') return styles['status-badge--error'];
  return styles['status-badge--in-progress'];
}

export function ChatStatusBadge({ status }: ChatStatusBadgeProps) {
  return (
    <span className={`${styles['status-badge']} ${statusToneClass(status)}`}>
      {conversationStatusLabel(status)}
    </span>
  );
}
```

Note: Importing page SCSS from a component is acceptable here to avoid duplicating badge tokens; alternatively move `.status-badge` to `chat-status-badge.module.scss` if reviewer prefers.

- [ ] **Step 3: Verify contrast manually**

Run:

```bash
python3 .cursor/skills/visual-design-qa/scripts/constrast_ratio.py "#111827" "#ffe62954"
python3 .cursor/skills/visual-design-qa/scripts/constrast_ratio.py "#111827" "#46a75825"
python3 .cursor/skills/visual-design-qa/scripts/constrast_ratio.py "#111827" "#e5484d25"
```

Expected: each ratio ≥4.5:1. If `--orange-light` fails, switch `--in-progress` background to `var(--billing-secondary-soft)`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat-status-badge.tsx apps/web/src/pages/chat-page.module.scss
git commit -m "feat(web): add contrast-safe chat status badge"
```

---

### Task 3: Bubble, muted text, focus, and scroll clearance (SCSS)

**Files:**
- Modify: `apps/web/src/pages/chat-page.module.scss`

**Interfaces:**
- Produces: updated `.session-body`, `.day-label`, `.polling-hint`, `.message-user .bubble`, `.message-assistant .bubble`, `.composer-pill:focus-within`

- [ ] **Step 1: Apply P0 SCSS changes**

In `chat-page.module.scss`:

1. `.session-body` — add `padding-bottom: calc(var(--space-4) + 4.75rem);`
2. `.day-label`, `.polling-hint` — set `color: var(--text-subtle);`
3. Replace `.bubble` shared rules; add role-specific overrides:

```scss
.bubble {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--primary-brand-lightest);
  border-radius: var(--radius-xx-large);
  color: var(--text-default);
  background-color: var(--white);
}

.message-user .bubble {
  background-color: var(--primary-brand);
  border-color: var(--primary-brand);
  color: var(--white);
  border-radius: var(--radius-xx-large) var(--radius-xx-large) var(--space-1)
    var(--radius-xx-large);
}

.message-user .bubble-text {
  color: var(--white);
}

.message-assistant .bubble {
  background-color: var(--white);
  border-color: var(--primary-brand-light);
  border-radius: var(--radius-xx-large) var(--radius-xx-large) var(--radius-xx-large)
    var(--space-1);
}
```

4. `.composer-pill:focus-within`:

```scss
.composer-pill:focus-within {
  box-shadow: 0 0 0 2px var(--white), 0 0 0 4px var(--primary-brand);
}
```

5. Verify assistant border contrast; if `#b56e6e` on `#f7f0f0` < 3:1, set `.message-assistant .bubble { border-color: var(--text-subtle); }`

- [ ] **Step 2: Run web tests (no regressions)**

Run: `npm test -w @billing-agent/web`

Expected: PASS (existing tests unchanged)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/chat-page.module.scss
git commit -m "fix(web): chat bubble contrast, muted text, focus ring, scroll clearance"
```

---

### Task 4: Wire status badge in session header

**Files:**
- Modify: `apps/web/src/pages/chat-page.tsx` (ChatThread meta row ~341–347)

**Interfaces:**
- Consumes: `ChatStatusBadge`

- [ ] **Step 1: Replace raw Badge in ChatThread**

In `ChatThread`, import `ChatStatusBadge` and replace:

```tsx
<Badge label={conversation.status} variant={conversationStatusVariant(conversation.status)} />
```

with:

```tsx
<ChatStatusBadge status={conversation.status} />
```

Remove unused `conversationStatusVariant` import from `chat-page.tsx` if no longer referenced (may still be used elsewhere — keep if needed).

- [ ] **Step 2: Update polling test expectations**

In `chat-page.test.tsx`, change:

```typescript
expect(screen.getByText('active')).toBeInTheDocument();
// ...
expect(screen.getByText('saved')).toBeInTheDocument();
```

to:

```typescript
expect(screen.getByText('In progress')).toBeInTheDocument();
// ...
expect(screen.getByText('Saved')).toBeInTheDocument();
```

- [ ] **Step 3: Run tests**

Run: `npm test -w @billing-agent/web -- src/pages/chat-page.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/chat-page.tsx apps/web/src/pages/chat-page.test.tsx
git commit -m "fix(web): use human status labels in chat session header"
```

---

### Task 5: List table goal fallback and mobile ellipsis

**Files:**
- Create: `apps/web/src/components/conversations-table.module.scss`
- Modify: `apps/web/src/components/conversations-table.tsx`

**Interfaces:**
- Consumes: `conversationStatusLabel`, `ChatStatusBadge`
- Produces: `displayGoal()`, `displaySubtitle()` used in row mapping

- [ ] **Step 1: Write failing test for untitled goal**

Append to `chat-page.test.tsx` inside `describe('Chat list')`:

```typescript
it('shows Untitled chat when goal is empty', async () => {
  vi.mocked(conversationsApi.listConversations).mockResolvedValue([
    summary({
      id: 'conv-empty',
      goal: '',
      startUrl: 'https://example.com/billing/invoices/2026/august/statement?account=092950013733',
      status: 'confirming',
    }),
  ]);

  render(
    <MemoryRouter initialEntries={['/chat']}>
      <Routes>
        <Route path="/chat" element={<ChatListPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText('Untitled chat')).toBeInTheDocument();
  expect(screen.getByText('Ready to confirm')).toBeInTheDocument();
  expect(screen.queryByText('awaiting_secret')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @billing-agent/web -- src/pages/chat-page.test.tsx -t "Untitled chat"`

Expected: FAIL — shows URL instead of "Untitled chat"

- [ ] **Step 3: Implement table helpers and badge**

In `conversations-table.tsx`:

```typescript
import { ChatStatusBadge } from './chat-status-badge';
import styles from './conversations-table.module.scss';

function displayGoal(conversation: ConversationSummary): string {
  const goal = conversation.goal?.trim();
  if (goal) return goal;
  return 'Untitled chat';
}

function displaySubtitle(conversation: ConversationSummary): string {
  return conversation.startUrl ?? conversation.id;
}
```

Update row mapping:

```typescript
goal: displayGoal(conversation),
statusLabel: conversationStatusLabel(conversation.status),
startUrl: displaySubtitle(conversation),
```

Replace desktop `Badge` customRender with `<ChatStatusBadge status={row.status} />`.

Replace mobile `meta` with `<ChatStatusBadge status={row.status} />`.

Add `className={styles.table}` on `<Table>` if Table supports `className`; otherwise wrap Table in `<div className={styles.wrapper}>`.

Create `conversations-table.module.scss`:

```scss
.wrapper :global(.cp-media-object__title),
.wrapper :global([class*='media-object'] [class*='title']) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
```

Inspect rendered mobile DOM in dev if selector misses — adjust to match Cleanplate MediaObject title class (document final selector in commit message).

- [ ] **Step 4: Run tests**

Run: `npm test -w @billing-agent/web`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/conversations-table.tsx apps/web/src/components/conversations-table.module.scss apps/web/src/pages/chat-page.test.tsx
git commit -m "fix(web): untitled chat fallback and mobile list title ellipsis"
```

---

### Task 6: P0 verification gate

- [ ] **Step 1: Run full web test suite**

Run: `npm test -w @billing-agent/web`

Expected: all PASS

- [ ] **Step 2: Manual contrast checklist**

Run constrast_ratio.py for:
- `#ffffff` on `#843c3c` (user bubble text)
- `#374151` on `#f7f0f0` (day label)
- `#111827` on each status-badge background

- [ ] **Step 3: Optional visual capture**

If Playwright available:

```bash
# terminal 1
VITE_API_BASE_URL=http://127.0.0.1:8080 npx vite --host 127.0.0.1 --port 5177
# terminal 2
QA_BASE_URL=http://127.0.0.1:5177 node .cursor/skills/visual-design-qa/audits/capture-chat.mjs
```

Compare `thread-375.png` — last message must not overlap composer.

**PR 1 complete when:** all P0 acceptance criteria in spec pass.

---

## PR 2 — P1 Major (ship as one PR)

### Task 7: Sanitize message text for display

**Files:**
- Create: `apps/web/src/lib/sanitize-message-text.ts`
- Create: `apps/web/src/lib/sanitize-message-text.test.ts`

**Interfaces:**
- Produces: `sanitizeMessageText(text: string): string`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { sanitizeMessageText } from './sanitize-message-text';

describe('sanitizeMessageText', () => {
  it('strips secret tokens', () => {
    expect(
      sanitizeMessageText('Please provide [secret:username] and [secret:password].'),
    ).toBe('Please provide and .');
  });

  it('preserves normal text', () => {
    expect(sanitizeMessageText('Hello world')).toBe('Hello world');
  });

  it('collapses extra whitespace', () => {
    expect(sanitizeMessageText('a  [secret:x]   b')).toBe('a b');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -w @billing-agent/web -- src/lib/sanitize-message-text.test.ts`

- [ ] **Step 3: Implement**

```typescript
const SECRET_PATTERN = /\[secret:[^\]]+\]/g;

export function sanitizeMessageText(text: string): string {
  return text.replace(SECRET_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sanitize-message-text.ts apps/web/src/lib/sanitize-message-text.test.ts
git commit -m "feat(web): sanitize secret markup from chat message display"
```

---

### Task 8: Session column layout and header hierarchy

**Files:**
- Modify: `apps/web/src/pages/chat-page.module.scss`
- Modify: `apps/web/src/pages/chat-page.tsx` (ChatThread JSX ~327–526)

**Interfaces:**
- Produces: `.session-column`, `.session-title`, `.session-subtitle`; restructured DOM

- [ ] **Step 1: Add layout SCSS**

```scss
.session-column {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: 48rem;
  margin-inline: auto;
}

.session-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.session-subtitle {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  max-width: none;
  width: 100%;
}

.thread,
.panel {
  max-width: none;
  margin-inline: 0;
}

.composer-pill {
  max-width: none;
  margin-inline: 0;
}

.thread {
  justify-content: flex-end;
}
```

- [ ] **Step 2: Restructure ChatThread JSX**

Wrap header, body, and dock:

```tsx
<div className={styles.session}>
  <div className={styles['session-column']}>
    <div className={styles['session-header']}>
      <PageHeader
        title={
          <span className={styles['session-title']} title={conversation.goal ?? undefined}>
            {conversation.goal?.trim() || 'Untitled chat'}
          </span>
        }
        subtitle={
          <span
            className={styles['session-subtitle']}
            title={conversation.startUrl ?? undefined}
          >
            {conversation.startUrl ?? conversationId}
          </span>
        }
        moreMenuItems={[{ label: 'Abandon', onClick: () => setAbandonOpen(true) }]}
      />
      {/* error alert + meta row unchanged except ChatStatusBadge already wired */}
    </div>
    <div className={styles['session-body']}>{/* thread + panels */}</div>
    {conversation.status === 'active' ? (
      <form className={styles['composer-dock']}>{/* composer pill */}</form>
    ) : null}
  </div>
</div>
```

Remove `primaryCta` Abandon button.

Change panel headings from `variant="h4"` to `variant="h5"`.

- [ ] **Step 3: Render sanitized message text**

Import `sanitizeMessageText` and change bubble content:

```tsx
<Typography variant="p" className={styles['bubble-text']}>
  {sanitizeMessageText(message.text)}
</Typography>
```

- [ ] **Step 4: Add test for sanitized secrets UI**

```typescript
it('does not render secret markup in message bubbles', async () => {
  vi.mocked(conversationsApi.getConversation).mockResolvedValue(
    conversation({
      status: 'awaiting_secret',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          text: 'Provide [secret:username] please.',
          createdAt: '2026-08-17T12:00:00.000Z',
        },
      ],
    }),
  );
  vi.mocked(conversationsApi.parseSecretKeysFromMessages).mockReturnValue(['username']);

  render(/* ChatPage route */);

  expect(await screen.findByText(/Provide please\./)).toBeInTheDocument();
  expect(screen.queryByText(/\[secret:username\]/)).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -w @billing-agent/web`

```bash
git add apps/web/src/pages/chat-page.tsx apps/web/src/pages/chat-page.module.scss apps/web/src/pages/chat-page.test.tsx
git commit -m "fix(web): align chat column, goal-first header, sanitized messages"
```

---

### Task 9: Abandon confirmation dialog

**Files:**
- Modify: `apps/web/src/pages/chat-page.tsx`

**Interfaces:**
- Consumes: Cleanplate `ConfirmDialog` (same props as `jobs-table.tsx`)

- [ ] **Step 1: Add state and dialog**

In `ChatThread`:

```typescript
const [abandonOpen, setAbandonOpen] = useState(false);
```

Import `ConfirmDialog` from `cleanplate`.

After session column closing tag:

```tsx
<ConfirmDialog
  isOpen={abandonOpen}
  title="Abandon chat?"
  description="This ends the session. You can start a new chat later."
  primaryButtonLabel="Abandon"
  secondaryButtonLabel="Cancel"
  variant="warning"
  onClose={() => setAbandonOpen(false)}
  onPrimaryButtonClick={() => {
    setAbandonOpen(false);
    void handleAbandon();
  }}
/>
```

Disable more menu while `isBusy` by guarding `onClick` or omitting menu when busy.

- [ ] **Step 2: Write test**

```typescript
it('confirms before abandoning', async () => {
  vi.mocked(conversationsApi.getConversation).mockResolvedValue(conversation());
  vi.mocked(conversationsApi.abandonConversation).mockResolvedValue(
    conversation({ status: 'abandoned' }),
  );

  render(
    <MemoryRouter initialEntries={['/chat/conv-1']}>
      <Routes>
        <Route path="/chat" element={<div>Chat list</div>} />
        <Route path="/chat/:conversationId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByText('Grab the contact email address');
  fireEvent.click(screen.getByRole('button', { name: /more/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: /abandon/i }));
  expect(screen.getByText('Abandon chat?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Abandon$/i }));
  expect(conversationsApi.abandonConversation).toHaveBeenCalledWith('conv-1');
});
```

Adjust selectors to match Cleanplate PageHeader more-menu button aria label after inspecting DOM.

- [ ] **Step 3: Run tests and commit**

```bash
git add apps/web/src/pages/chat-page.tsx apps/web/src/pages/chat-page.test.tsx
git commit -m "fix(web): confirm before abandoning chat session"
```

---

### Task 10: Composer auto-resize and awaiting-reply disable

**Files:**
- Modify: `apps/web/src/pages/chat-page.tsx`
- Modify: `apps/web/src/pages/chat-page.module.scss` (`.composer-input` line-height)

**Interfaces:**
- Consumes: existing `isAwaitingReply`, `messageText`, `composerInputRef`

- [ ] **Step 1: Add ref and resize helper**

In `ChatThread`:

```typescript
const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

const resizeComposer = useCallback(() => {
  const el = composerInputRef.current;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}, []);

useEffect(() => {
  resizeComposer();
}, [messageText, resizeComposer]);
```

On textarea:

```tsx
ref={composerInputRef}
onChange={(event) => {
  setMessageText(event.target.value);
  resizeComposer();
}}
disabled={isBusy || isAwaitingReply}
placeholder={isAwaitingReply ? 'Agent is working…' : 'Message'}
```

- [ ] **Step 2: Simplify polling hint**

Replace header polling block:

```tsx
{isPollingConversationStatus(conversation.status) && !isAwaitingReply ? (
  <Typography variant="small" className={styles['polling-hint']}>
    Live
  </Typography>
) : null}
```

- [ ] **Step 3: SCSS**

```scss
.composer-input {
  line-height: 1.5;
  overflow-y: auto;
}
```

- [ ] **Step 4: Update waiting-state test**

Change `chat-page.test.tsx` test "shows a working state while waiting":

```typescript
expect(await screen.findByText('Working…')).toBeInTheDocument();
expect(screen.queryByText('Agent is working…')).not.toBeInTheDocument(); // header hint removed
const textarea = screen.getByRole('textbox', { name: 'Message' });
expect(textarea).toBeDisabled();
expect(textarea).toHaveAttribute('placeholder', 'Agent is working…');
```

- [ ] **Step 5: Run tests and commit**

```bash
git add apps/web/src/pages/chat-page.tsx apps/web/src/pages/chat-page.module.scss apps/web/src/pages/chat-page.test.tsx
git commit -m "fix(web): auto-resize composer and disable input while agent works"
```

---

### Task 11: P1 verification gate

- [ ] **Step 1: Run full web tests**

Run: `npm test -w @billing-agent/web`

- [ ] **Step 2: Visual regression**

Re-capture thread/waiting/confirming/long-goal at 1440 and 375; compare to audit baselines.

**PR 2 complete when:** all P1 acceptance criteria in spec pass.

---

## PR 3 — P2 Minor + Nit (optional follow-up PR)

### Task 12: Empty list duplicate CTA

**Files:**
- Modify: `apps/web/src/pages/chat-page.tsx` (`ChatListPage` ~574–580)

- [ ] **Step 1: Remove duplicate button**

Change `FeedbackState` to omit `primaryAction`:

```tsx
<FeedbackState variant="empty" margin="t-5" title="No chats yet" />
```

- [ ] **Step 2: Update empty-state test**

```typescript
expect(screen.getAllByRole('button', { name: /new chat/i })).toHaveLength(1);
```

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(web): single New chat CTA on empty chat list"
```

---

### Task 13: Confirm grid responsive + thumbnail + breadcrumb + dock safe area + disabled send

**Files:**
- Modify: `apps/web/src/pages/chat-page.module.scss`
- Modify: `apps/web/src/pages/chat-page.tsx`
- Modify: `apps/web/src/components/image-lightbox.module.scss`

- [ ] **Step 1: Sample grid mobile stack**

```scss
.sample-row {
  grid-template-columns: minmax(4.5rem, 30%) 1fr;
}

@media (max-width: 600px) {
  .sample-row {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }
}
```

- [ ] **Step 2: Thumbnail min-height**

In `image-lightbox.module.scss`:

```scss
.thumbnail-button {
  min-height: 6rem;
}
.thumbnail {
  min-height: 6rem;
}
```

- [ ] **Step 3: BreadCrumb in ChatThread**

Import `BreadCrumb` from `cleanplate` (mirror `run-detail-page.tsx`):

```tsx
<BreadCrumb
  margin="b-2"
  items={[
    { label: 'Chat', href: '/chat' },
    { label: conversation.goal?.trim() || 'Untitled chat' },
  ]}
/>
```

- [ ] **Step 4: Dock safe area + placeholder + disabled send + radius tokens**

```scss
.composer-dock {
  padding-bottom: max(var(--space-3), env(safe-area-inset-bottom));
}
.composer-pill {
  border-radius: var(--radius-xxx-large);
}
.composer-send:disabled {
  background-color: var(--gray-300);
}
```

Placeholder when not awaiting: `Message · Enter to send`

Send button icon: use `color="gray"` when disabled or style via CSS.

- [ ] **Step 5: Optional composer `<details>` for Schedule/Notify in ChatComposer (P2-2)**

Collapse optional fields behind `<details><summary>Add schedule or notify</summary>…</details>`; change Goal to textarea — only if time permits in same PR.

- [ ] **Step 6: Run tests, commit**

```bash
git commit -m "fix(web): chat P2 polish — breadcrumb, grid, thumbnails, safe area"
```

---

## Spec coverage self-review

| Spec item | Task |
| --- | --- |
| P0-1 composer overlap | Task 3 |
| P0-2 focus ring | Task 3 |
| P0-3 badge contrast | Task 1, 2, 4, 5 |
| P0-4 muted text | Task 3 |
| P0-5 bubble contrast | Task 3 |
| P0-6 list collision | Task 5 |
| P1-1 Abandon | Task 8, 9 |
| P1-2 column align | Task 8 |
| P1-3 distinct bubbles | Task 3 |
| P1-4 bottom anchor | Task 8 |
| P1-5 auto-resize | Task 10 |
| P1-6 disable composer | Task 10 |
| P1-7 labels + sanitize | Task 1, 7, 8 |
| P1-8 header hierarchy | Task 8 |
| P2-1 … P2-9 | Task 12, 13 |

All spec requirements mapped. No placeholders.
