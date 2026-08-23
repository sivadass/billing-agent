# Chat Page Design QA Fixes

**Date:** 2026-08-20  
**Status:** Approved for implementation planning  
**Source audit:** `.cursor/skills/visual-design-qa/audits/chat-page-2026-08-20/design-qa-report.md`  
**Related:** `2026-08-19-chat-history-design.md`, `apps/web/src/pages/chat-page.tsx`

## Problem

A visual design QA pass on the chat surfaces (`/chat`, `/chat/new`, `/chat/:id`) found **6 blockers**, **8 major**, **6 minor**, and **3 nit** issues. The shell (48rem column, day separators, pill composer) is sound, but the implementation fails accessibility on the warm `--gray-10` page tint, clips content on mobile, and presents weak hierarchy (generic title, prominent Abandon, machine-readable status strings).

This spec turns the audit into an implementable, testable plan. No API or backend changes.

## Goals

- Fix all **blocker** and **major** audit items so chat is WCAG AA on `--gray-10` and usable at 375px
- Preserve the existing chat product shape (list → composer → thread) and Cleanplate component usage
- Keep changes scoped to web chat files unless a tiny shared helper improves consistency
- Add regression tests where behavior is user-visible (status labels, message sanitization, composer disabled state)

## Non-goals

- AppShell chrome (sidebar, header logo duplication, account avatar)
- Cleanplate library changes or new Badge variants upstream
- Table row hover/active polish (audit skipped)
- Lightbox animation or real snapshot fixture QA
- New-chat form redesign beyond audit minor items (collapse optional fields is P2)
- Pagination, filters, or chat history API changes

## Implementation approaches

| Approach | Summary | Trade-offs |
| --- | --- | --- |
| **A — Single PR, file-local** | All SCSS + TSX edits in existing chat files | Fastest review surface; `chat-page.tsx` grows slightly |
| **B — Extract presentation helpers** | Add `conversation-status-label.ts`, `sanitize-message-text.ts`, optional `use-auto-resize-textarea.ts`; SCSS stays in module | Clearer tests; one extra lib file and one hook file |
| **C — Phased PRs by severity** | P0 blockers → P1 major → P2 minor/nit | Safer rollout; more merge overhead |

**Recommendation:** **C for delivery**, **B for structure** within each phase. Extract status labels and message sanitization to `apps/web/src/lib/` (same pattern as `conversation-status.ts`). Keep layout SCSS in `chat-page.module.scss`. Ship P0 as one PR, P1 as one PR, P2 optional follow-up.

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | All audit items; implementation phased P0 → P1 → P2 |
| Status display | Human labels via new `conversationStatusLabel()`; keep `conversationStatusVariant()` for Badge color family |
| Badge contrast | Use **tinted surface + dark text**, not white-on-orange/green, via local `.status-badge` SCSS overrides on chat surfaces |
| Muted text on `--gray-10` | Chat-specific: `--text-subtle` for day labels and polling hint; do **not** change global `--text-muted` in `theme.css` |
| Abandon | `PageHeader.moreMenuItems` + `ConfirmDialog` (same pattern as `jobs-table.tsx` disable flow) |
| Session title | Goal as `PageHeader.title` (2-line clamp); start URL as subtitle (ellipsis, `title` attr for full URL) |
| Thread column | Single `.session-column` wrapper: `max-width: 48rem; margin-inline: auto; width: 100%` around header meta, thread, panels, dock |
| User bubbles | Brand fill `#843c3c`, white text, tail radius on bottom-right |
| Assistant bubbles | White fill, `1px solid var(--primary-brand-light)` border (verify ≥3:1 vs `--gray-10`; fallback `var(--text-subtle)` border) |
| Composer dock clearance | `.session-body { padding-bottom: calc(var(--space-4) + 4.75rem); }` while dock remains sibling outside scroll body |
| Focus ring | `.composer-pill:focus-within { box-shadow: 0 0 0 2px var(--white), 0 0 0 4px var(--primary-brand); }`; textarea keeps `outline: none` |
| Waiting state UX | Disable composer when `isAwaitingReply`; placeholder `Agent is working…`; remove header polling hint when bubble shows Working (keep badge + “Live”) |
| Secret markup in UI | Strip `[secret:key]` from rendered message text; parsing unchanged |
| List empty state | Remove `FeedbackState.primaryAction`; keep header **New chat** only |
| Back navigation | `BreadCrumb` above session header: Chat → truncated goal/id (mirror `run-detail-page.tsx`) |
| Border radius tokens | Replace raw `1.25rem` / `1.5rem` with `var(--radius-xx-large)` / `var(--radius-xxx-large)` |
| Disabled send | `:disabled` → `background: var(--gray-300);` icon `color="gray"` or CSS override to `--text-muted` |

## Architecture

```text
apps/web/src/
├── lib/
│   ├── conversation-status.ts          # existing variant map
│   ├── conversation-status-label.ts    # NEW human labels
│   ├── sanitize-message-text.ts        # NEW strip [secret:…] for display
│   └── conversation-status-label.test.ts
├── components/
│   ├── conversations-table.tsx         # goal fallback, statusLabel, mobile dedupe
│   └── image-lightbox.module.scss      # thumbnail min-height
├── pages/
│   ├── chat-page.tsx                   # header, thread, composer, list, confirm abandon
│   ├── chat-page.module.scss           # layout, bubbles, badges, grid, dock
│   └── chat-page.test.tsx              # extended assertions
└── theme.css                           # unchanged (chat uses --text-subtle locally)
```

No new routes. No store/API changes.

## Phase P0 — Blockers (must ship together)

### P0-1 — Composer overlaps last message (375px)

**Audit ref:** Blocker 1  
**Root cause:** Fixed-height `.session` flex column; `.composer-dock` is outside `.session-body` scrollport; thread end has no bottom inset.

**Requirements:**

- Last message bubble and its timestamp must be fully visible above the composer pill at **375×900** with a thread containing ≥4 messages (see audit fixture).
- Minimum clearance between last bubble bottom and pill top: **16px** (`var(--space-4)`).

**Implementation:**

```scss
// chat-page.module.scss
.session-body {
  padding-bottom: calc(var(--space-4) + 4.75rem); // pill ~74px + gap
}
```

Re-verify after any dock height change. Do not move dock inside scroll body (would scroll away).

**Acceptance:** Playwright or manual capture at 375px shows no overlap; `threadEndRef.scrollIntoView` still reaches true bottom.

---

### P0-2 — Composer keyboard focus invisible

**Audit ref:** Blocker 2  

**Requirements:**

- Tab to message textarea shows visible focus indicator meeting WCAG 2.4.7.
- Ring uses brand token; does not clip at pill edges.

**Implementation:**

```scss
.composer-pill:focus-within {
  box-shadow: 0 0 0 2px var(--white), 0 0 0 4px var(--primary-brand);
}
.composer-input {
  outline: none; // pill carries ring
}
```

**Acceptance:** Focus snapshot shows 4px brand ring; no default browser outline on textarea.

---

### P0-3 — Status badge contrast

**Audit ref:** Blocker 3  

**Measured failures:** white on `#f76b15` = 2.97:1; white on `#46a758` = 3.03:1 at 13px.

**Requirements:**

- All conversation status badges in chat list and session header: **≥4.5:1** text contrast.
- Semantic color still distinguishable (in-progress vs saved vs error).

**Implementation:**

Add module classes instead of relying on default Badge warning/success fills:

```scss
.status-badge {
  // base: 13px inherited from Badge
  &--in-progress {
    color: var(--text-default);
    background: var(--orange-light); // verify ≥4.5:1; if not, use --billing-secondary-soft
  }
  &--saved {
    color: var(--text-default);
    background: var(--green-light);
  }
  &--error {
    color: var(--text-default);
    background: var(--red-light);
  }
}
```

Map statuses in TSX:

| Status | Label (see P1-7) | Class |
| --- | --- | --- |
| `active`, `confirming`, `awaiting_secret` | human label | `--in-progress` |
| `saved` | Saved | `--saved` |
| `expired`, `abandoned` | human label | `--error` |

Pass `className` to `<Badge>` via Cleanplate `className` prop on a wrapper or custom label span if Badge cannot be styled — prefer wrapper `span` + Typography `small` if Badge API blocks background override.

**Acceptance:** `constrast_ratio.py` on computed fg/bg ≥4.5:1 for each variant.

---

### P0-4 — Muted copy on `--gray-10`

**Audit ref:** Blocker 4  

**Requirements:**

- `.day-label`, `.polling-hint`: use color with **≥4.5:1** on `#f7f0f0`.

**Implementation:**

```scss
.day-label,
.polling-hint {
  color: var(--text-subtle); // #374151 → 9.17:1
}
```

Shorten polling copy in P2 nit; P0 only fixes color.

**Acceptance:** Contrast ≥4.5:1 for day separator and “Live · updates every 2s” text.

---

### P0-5 — Bubble non-text contrast

**Audit ref:** Blocker 5  

**Requirements:**

- Message bubble boundary or fill vs page background: **≥3:1** (WCAG 1.4.11).
- User message text on user bubble: **≥4.5:1**.

**Implementation:**

```scss
.message-user .bubble {
  background-color: var(--primary-brand);
  border-color: var(--primary-brand);
  color: var(--white);
  border-radius: var(--radius-xx-large) var(--radius-xx-large) var(--space-1) var(--radius-xx-large);
}
.message-user .bubble-text {
  color: var(--white);
}
.message-assistant .bubble {
  background-color: var(--white);
  border-color: var(--primary-brand-light);
  border-radius: var(--radius-xx-large) var(--radius-xx-large) var(--radius-xx-large) var(--space-1);
}
```

Run contrast script on `#b56e6e` vs `#f7f0f0`. If <3:1, use `border-color: var(--text-subtle)`.

Screenshot thumbnails inside user bubbles: ensure lightbox button border still visible.

**Acceptance:** Border/fill contrast ≥3:1; user text ≥7.8:1 (white on `#843c3c`).

---

### P0-6 — List mobile title/badge collision

**Audit ref:** Blocker 6  

**Requirements:**

- At 375px, long URL goals must not paint over status badge.
- Empty goal shows **Untitled chat**, not raw URL as title.
- When goal is empty, subtitle remains start URL (single source — no duplicate URL in title and subtitle).

**Implementation:**

In `conversations-table.tsx`:

```typescript
function displayGoal(conversation: ConversationSummary): string {
  const goal = conversation.goal?.trim();
  if (goal) return goal;
  return 'Untitled chat';
}

function displaySubtitle(conversation: ConversationSummary): string {
  return conversation.startUrl ?? conversation.id;
}
```

For mobile `meta` badge: ensure Table `mobileColumns` receives title/subtitle that differ when goal empty.

If Cleanplate Table does not truncate title: add `conversations-table.module.scss` with `:global` hook on mobile card title if documented, **or** pass `customRender` for title column on mobile if API supports it. Minimum fix: shorten title string server-side is insufficient — need CSS `text-overflow: ellipsis` on the title slot. Inspect Cleanplate Table mobile DOM class (`cp-table__…`) and add scoped override.

**Acceptance:** Audit row 3 at 375px: badge fully visible; title ellipsized; no URL-as-title when goal empty.

---

## Phase P1 — Major (polish + UX)

### P1-1 — Abandon placement and confirmation

**Audit ref:** Major 1  

**Requirements:**

- Abandon is not `primaryCta` on mobile or desktop.
- Destructive action requires confirmation.
- Confirm copy: title “Abandon chat?”, description mentions browser lock release if applicable, primary “Abandon”, secondary “Cancel”.

**Implementation:**

```tsx
<PageHeader
  title={…}
  subtitle={…}
  moreMenuItems={[{ label: 'Abandon', onClick: () => setAbandonOpen(true) }]}
/>
<ConfirmDialog
  isOpen={abandonOpen}
  title="Abandon chat?"
  description="This ends the session. You can start a new chat later."
  primaryButtonLabel="Abandon"
  secondaryButtonLabel="Cancel"
  variant="warning"
  onClose={() => setAbandonOpen(false)}
  onPrimaryButtonClick={() => void handleAbandon()}
/>
```

Disable menu item while `isBusy`.

**Acceptance:** 375px screenshot shows no full-width Abandon button; confirm dialog appears before navigate away.

---

### P1-2 — Align header with thread column

**Audit ref:** Major 2  

**Requirements:**

- PageHeader, meta row, thread, panels, composer pill share the same horizontal center and max width (48rem).

**Implementation:**

```tsx
<div className={styles.session}>
  <div className={styles['session-column']}>
    <div className={styles['session-header']}>…</div>
    <div className={styles['session-body']}>…</div>
  </div>
  {composer dock — inside column footer OR column wraps dock too}
</div>
```

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
.meta {
  max-width: none; // inherits column width
  width: 100%;
}
.thread,
.panel,
.composer-pill {
  max-width: none;
  margin-inline: 0;
}
```

Move `.composer-dock` inside `.session-column` so pill aligns with thread.

**Acceptance:** At 1440px, header text left edge equals thread bubble left edge (±0px).

---

### P1-3 — Distinct user/assistant bubbles

**Audit ref:** Major 3  

Covered by P0-5 tail radii and fills. Verify assistant waiting bubble uses same assistant styles.

---

### P1-4 — Bottom-anchor thread messages

**Audit ref:** Major 4  

**Requirements:**

- Short threads (waiting, confirming with one message) sit above panels/composer, not top-aligned with large gap.

**Implementation:**

```scss
.thread {
  justify-content: flex-end;
}
```

Panels remain after `.thread` in `.session-body` flex column (not inside `.thread`), so order is: thread (grow, bottom-aligned content) → panel → scroll padding.

**Acceptance:** Waiting state at 1440px: “Working…” bubble within ~200px of confirm panel / composer, not at y≈316 with 470px gap.

---

### P1-5 — Auto-growing composer

**Audit ref:** Major 5  

**Requirements:**

- Typing 3+ lines increases textarea height up to `8rem`, then scrolls internally.
- `Shift+Enter` inserts newline without clipping.
- Single-line empty state remains ~40–50px tall.

**Implementation:**

Extract hook or inline handler:

```typescript
const resizeComposer = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
};
// call on mount, onChange, when messageText cleared
```

```scss
.composer-input {
  line-height: 1.5;
  overflow-y: auto;
}
```

**Acceptance:** Multiline screenshot shows ≥72px textarea height for 3 lines; max-height caps at 128px.

---

### P1-6 — Disable composer while agent working

**Audit ref:** Major 6  

**Requirements:**

- When `isAwaitingReply` (includes polling wait with last message role `user` or empty thread): textarea disabled, send disabled.
- Placeholder: `Agent is working…` when disabled for awaiting reply; `Message` otherwise.

**Implementation:**

```tsx
disabled={isBusy || isAwaitingReply}
placeholder={isAwaitingReply ? 'Agent is working…' : 'Message'}
```

Remove duplicate header hint when `isAwaitingReply`:

```tsx
{isPolling && !isAwaitingReply ? (
  <Typography …>Live</Typography>
) : null}
```

Keep “Working…” bubble OR header hint, not both — spec: **keep bubble**, drop header “Agent is working…”.

**Acceptance:** Test: empty messages + active status → textarea disabled; test: user message last → disabled until assistant replies.

---

### P1-7 — Human status labels + secret markup

**Audit ref:** Major 7  

**New file:** `apps/web/src/lib/conversation-status-label.ts`

```typescript
const LABELS: Record<ConversationStatus, string> = {
  active: 'In progress',
  awaiting_secret: 'Needs secrets',
  confirming: 'Ready to confirm',
  saved: 'Saved',
  expired: 'Expired',
  abandoned: 'Abandoned',
};
export function conversationStatusLabel(status: ConversationStatus): string {
  return LABELS[status] ?? status;
}
```

Use in `ChatThread`, `ConversationsTable` (`statusLabel` field).

**New file:** `apps/web/src/lib/sanitize-message-text.ts`

```typescript
const SECRET_PATTERN = /\[secret:[^\]]+\]/g;
export function sanitizeMessageText(text: string): string {
  return text.replace(SECRET_PATTERN, '').replace(/\s{2,}/g, ' ').trim();
}
```

Render `{sanitizeMessageText(message.text)}` in bubble; keep `parseSecretKeysFromMessages` on raw text.

**Acceptance:** Tests for all status keys; test message with `[secret:username]` renders without bracket markup.

---

### P1-8 — Session header hierarchy

**Audit ref:** Major 8  

**Requirements:**

- Title = goal (fallback: “Untitled chat” or truncated id — prefer goal → startUrl host → id).
- Subtitle = full start URL with ellipsis single line; `title` attribute for hover.
- Panel headings (`Secrets required`, `Confirm proposed job`) use `variant="h5"` or `h6`, not default `h4` (30px).

**Implementation:**

```tsx
<PageHeader
  title={
    <span className={styles['session-title']} title={conversation.goal ?? undefined}>
      {conversation.goal?.trim() || 'Untitled chat'}
    </span>
  }
  subtitle={
    <span className={styles['session-subtitle']} title={conversation.startUrl ?? undefined}>
      {conversation.startUrl ?? conversationId}
    </span>
  }
  …
/>
```

```scss
.session-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.session-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
```

**Acceptance:** `long-goal-375.png` scenario: title clamped to 2 lines; subtitle ellipsized; panel title ≤20px on mobile.

---

## Phase P2 — Minor + Nit (follow-up)

| ID | Audit | Requirement |
| --- | --- | --- |
| P2-1 | Minor 1 | `FeedbackState` without `primaryAction` when list empty |
| P2-2 | Minor 2 | Collapse Schedule + Notify into `<details open={false}>`; Goal → textarea (optional stretch) |
| P2-3 | Minor 3 | `.sample-row { grid-template-columns: minmax(4.5rem, 30%) 1fr; }` + mobile stack `@media (max-width: 600px)` |
| P2-4 | Minor 4 | `.thumbnail-button { min-height: 6rem; }`, `.thumbnail { min-height: 6rem; object-fit: cover; }` |
| P2-5 | Minor 5 | `BreadCrumb` items: `{ label: 'Chat', href: '/chat' }`, `{ label: shortGoal }` |
| P2-6 | Minor 6 | `.composer-dock { padding-bottom: max(var(--space-3), env(safe-area-inset-bottom)); }`; placeholder hint “Message · Enter to send” |
| P2-7 | Nit | Radius tokens for bubble/pill |
| P2-8 | Nit | Polling hint text: “Live” only |
| P2-9 | Nit | Disabled send: gray fill + muted icon |

## Screen layout (after P0+P1)

### Session thread (desktop)

```text
┌──────────┬────────────────────────────────────────────────────────┐
│ Chat  ●  │  Chat › Grab contact email                             │
│          │  Grab contact email          [⋯ Abandon in menu]       │
│          │  https://sivadass.in/…                                 │
│          │  [In progress]  Live                                   │
│          ├────────────────────────────────────────────────────────┤
│          │              ─── August 20, 2026 ───                   │
│          │                        ┌──────────────────┐            │
│          │                        │ user bubble (brand)         │
│          │  ┌──────────────────┐  └──────────────────┘            │
│          │  │ assistant (white)│                                   │
│          │  └──────────────────┘                                   │
│          │  ┌ Confirm proposed job ─────────────┐                  │
│          │  │ email    hello@…                  │                  │
│          │  │ [Confirm job] [Keep going]        │                  │
│          │  └───────────────────────────────────┘                  │
│          │  ┌────────────────────────────────────── [↑] ┐        │
│          │  │ Message…                              send   │        │
│          │  └──────────────────────────────────────────────┘        │
└──────────┴────────────────────────────────────────────────────────┘
        ↑ 48rem column — header, meta, thread, panel, dock aligned
```

## Testing

### Unit tests (`apps/web/src/`)

| File | Cases |
| --- | --- |
| `conversation-status-label.test.ts` | Every `ConversationStatus` maps to expected string |
| `sanitize-message-text.test.ts` | Strips `[secret:x]`; preserves normal text; multiple tokens |
| `chat-page.test.tsx` | Status label visible (not `awaiting_secret` raw); sanitized message; composer disabled when awaiting; abandon confirm dialog; empty list single CTA |

### Manual / visual regression

Re-run audit capture script against local dev server for states: `thread`, `waiting`, `confirming`, `secrets`, `list`, `long-goal` at 1440 / 768 / 375.

Compare to `.cursor/skills/visual-design-qa/audits/chat-page-2026-08-20/` baseline screenshots.

### Contrast verification

Run `.cursor/skills/visual-design-qa/scripts/constrast_ratio.py` on:

- User bubble text/bg
- Assistant border/bg vs page
- Status badge fg/bg (each variant)
- Day label / polling hint on `#f7f0f0`

## File checklist

| File | P0 | P1 | P2 |
| --- | --- | --- | --- |
| `chat-page.module.scss` | ✓ | ✓ | ✓ |
| `chat-page.tsx` | ✓ | ✓ | ✓ |
| `chat-page.test.tsx` | partial | ✓ | partial |
| `conversations-table.tsx` | ✓ | ✓ | — |
| `conversation-status-label.ts` | — | ✓ | — |
| `sanitize-message-text.ts` | — | ✓ | — |
| `image-lightbox.module.scss` | — | — | ✓ |
| `theme.css` | — | — | — |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Cleanplate Badge resists custom backgrounds | Use wrapped `span` + module class if `className` insufficient |
| Table mobile title CSS hook unknown | Inspect DOM in Storybook/dev; document selector in spec PR |
| `justify-content: flex-end` on thread breaks day separators | Day separators stay in flow; only messages pack downward |
| Auto-resize jank on font load | Reset height on `messageText === ''` |

## Success criteria

- **P0 complete:** All 6 blocker acceptance checks pass; zero WCAG AA failures on chat surfaces cited in audit.
- **P1 complete:** All 8 major items addressed; session screenshots match layout diagram; no raw snake_case status or secret markup in UI.
- **P2 complete:** Minor/nit table satisfied; optional for “design sign-off” but recommended before external demo.

## Open questions

None — audit provides measured values; approaches and decisions above resolve ambiguity. If Cleanplate Table mobile styling is not overridable without upstream change, escalate to a one-line `customRender` fork in `conversations-table.tsx` (still in scope).
