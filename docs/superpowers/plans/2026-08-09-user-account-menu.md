# User Account Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AppShell header Log out button with a Cleanplate avatar dropdown that shows the signed-in user’s email and a Log out action.

**Architecture:** Client-decode the existing JWT in `sessionStorage` (no signature verify) to read `email` / `sub`. A `UserAccountMenu` component owns token read, decode, fallbacks, and Cleanplate `Dropdown` + `Avatar` + meta + `MenuList`. `AppShellLayout` only passes `onLogout`.

**Tech Stack:** React 18, React Router 7, Cleanplate (`Avatar`, `Dropdown`, `MenuList`, `Typography`), Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-08-09-user-account-menu-design.md`

## Global Constraints

- Filenames: kebab-case only; React export names may be PascalCase
- No auth context, `/auth/me`, profile/settings menu items, or server logout
- Email from JWT payload only (claims `{ sub, email }`); do not verify signature in the browser
- Logout: `clearAccessToken()` then `navigate('/login', { replace: true })` (unchanged)
- Decode failure: avatar name `"User"`; meta “Unable to load email”; Log out still works
- Follow Cleanplate account-menu pattern: `placement="bottom-end"`, `offset={8}`

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/web/src/lib/decode-access-token.ts` | Base64url-decode JWT payload → `{ userId, email } \| null` |
| `apps/web/src/lib/decode-access-token.test.ts` | Unit tests for decode helper |
| `apps/web/src/components/user-account-menu.tsx` | Avatar dropdown; prop `onLogout`; owns token + decode + UI |
| `apps/web/src/components/user-account-menu.test.tsx` | Menu open, email display, logout callback, decode fallback |
| `apps/web/src/app.tsx` | Replace header Log out `Button` with `UserAccountMenu` |
| `apps/web/src/app-shell.test.tsx` | Assert account menu instead of lone Log out button |
| `apps/web/README.md` | Mention avatar account menu (if it still says plain Log out) |

---

### Task 1: JWT payload decode helper

**Files:**
- Create: `apps/web/src/lib/decode-access-token.ts`
- Create: `apps/web/src/lib/decode-access-token.test.ts`

**Interfaces:**
- Produces:
  - `export type DecodedAccessToken = { userId: string; email: string }`
  - `export function decodeAccessToken(token: string): DecodedAccessToken | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/decode-access-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAccessToken } from './decode-access-token';

function encodeSegment(value: object | string): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${encodeSegment({ alg: 'none' })}.${encodeSegment(payload)}.sig`;
}

describe('decodeAccessToken', () => {
  it('returns userId and email from a valid JWT payload', () => {
    const token = makeToken({ sub: 'user-1', email: 'you@example.com' });
    expect(decodeAccessToken(token)).toEqual({
      userId: 'user-1',
      email: 'you@example.com',
    });
  });

  it('returns null when email claim is missing', () => {
    expect(decodeAccessToken(makeToken({ sub: 'user-1' }))).toBeNull();
  });

  it('returns null when sub claim is missing', () => {
    expect(decodeAccessToken(makeToken({ email: 'you@example.com' }))).toBeNull();
  });

  it('returns null for malformed tokens', () => {
    expect(decodeAccessToken('not-a-jwt')).toBeNull();
    expect(decodeAccessToken('a.b')).toBeNull();
    expect(decodeAccessToken(`x.${encodeSegment('not-json')}.y`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/web -- src/lib/decode-access-token.test.ts`

Expected: FAIL (module not found / `decodeAccessToken` undefined)

- [ ] **Step 3: Implement decode helper**

Create `apps/web/src/lib/decode-access-token.ts`:

```ts
export type DecodedAccessToken = {
  userId: string;
  email: string;
};

function decodeBase64UrlJson(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const json = atob(base64);
  return JSON.parse(json) as unknown;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = decodeBase64UrlJson(parts[1]!);
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const userId = record.sub;
    const email = record.email;
    if (typeof userId !== 'string' || typeof email !== 'string') return null;
    if (!userId || !email) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/web -- src/lib/decode-access-token.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/decode-access-token.ts apps/web/src/lib/decode-access-token.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add client JWT payload decode helper

EOF
)"
```

---

### Task 2: `UserAccountMenu` component

**Files:**
- Create: `apps/web/src/components/user-account-menu.tsx`
- Create: `apps/web/src/components/user-account-menu.test.tsx`

**Interfaces:**
- Consumes: `decodeAccessToken`, `getAccessToken` from `../lib/*`
- Produces: `export function UserAccountMenu(props: { onLogout: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/src/components/user-account-menu.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../lib/auth-token';
import { UserAccountMenu } from './user-account-menu';

function encodeSegment(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${encodeSegment({ alg: 'none' })}.${encodeSegment(payload)}.sig`;
}

describe('UserAccountMenu', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows email and calls onLogout from the menu', () => {
    sessionStorage.setItem(
      TOKEN_STORAGE_KEY,
      makeToken({ sub: 'user-1', email: 'you@example.com' }),
    );
    const onLogout = vi.fn();
    render(<UserAccountMenu onLogout={onLogout} />);

    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByText('Signed in as')).toBeInTheDocument();
    expect(screen.getByText('you@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows fallback copy when the token cannot be decoded', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'not-a-jwt');
    render(<UserAccountMenu onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByText('Unable to load email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });
});
```

Notes for the implementer:
- Dropdown trigger must be queryable as `getByRole('button', { name: /account menu/i })`. Put `aria-label="Account menu"` on the `Avatar` (Cleanplate accepts HTML attribute rest props). Dropdown clones the trigger and adds `role` / `aria-expanded` / click handlers.
- If Cleanplate `MenuList` items are not `role="button"`, adjust the Log out query to match the real role/accessible name (e.g. `getByText(/^log out$/i)`), but keep asserting the logout callback fires.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/web -- src/components/user-account-menu.test.tsx`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement `UserAccountMenu`**

Create `apps/web/src/components/user-account-menu.tsx`:

```tsx
import { Avatar, Dropdown, MenuList, Typography } from 'cleanplate';
import { getAccessToken } from '../lib/auth-token';
import { decodeAccessToken } from '../lib/decode-access-token';

const ACCOUNT_META_STYLE: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-4) var(--space-3) var(--space-4)',
  marginBottom: 'var(--space-2)',
  borderBottom: '1px solid var(--gray-100)',
};

const LOGOUT_ITEM = [{ label: 'Log out', value: 'logout', icon: 'logout' as const }];

export type UserAccountMenuProps = {
  onLogout: () => void;
};

function AccountMenuContent({
  emailLabel,
  onLogout,
  onClose,
}: {
  emailLabel: string;
  onLogout: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div style={ACCOUNT_META_STYLE}>
        <Typography variant="small" margin="0" style={{ color: 'var(--text-muted)' }}>
          Signed in as
        </Typography>
        <Typography
          variant="small"
          margin="t-2"
          wordBreak="wrap"
          style={{ color: 'var(--text-subtle)' }}
        >
          {emailLabel}
        </Typography>
      </div>
      <MenuList
        items={LOGOUT_ITEM}
        direction="vertical"
        variant="light"
        size="small"
        margin="0"
        onMenuClick={() => {
          onLogout();
          onClose?.();
        }}
      />
    </>
  );
}

export function UserAccountMenu({ onLogout }: UserAccountMenuProps) {
  const token = getAccessToken();
  const decoded = token ? decodeAccessToken(token) : null;
  const email = decoded?.email;
  const avatarName = email ?? 'User';
  const emailLabel = email ?? 'Unable to load email';

  return (
    <Dropdown
      placement="bottom-end"
      offset={8}
      trigger={
        <Avatar
          name={avatarName}
          size="medium"
          margin="0"
          tabIndex={0}
          aria-label="Account menu"
        />
      }
      content={<AccountMenuContent emailLabel={emailLabel} onLogout={onLogout} />}
    />
  );
}
```

Import `type { CSSProperties }` from `react` (or `import type React from 'react'`) so `React.CSSProperties` typechecks — match the repo’s existing React import style.

If Avatar + Dropdown does not expose an accessible name of “Account menu”, wrap the trigger with `renderTrigger` and a focusable element that carries the label — keep the same accessible name for tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @billing-agent/web -- src/components/user-account-menu.test.tsx`

Expected: PASS. Fix role queries only if Cleanplate’s DOM differs; do not weaken assertions (email + logout still required).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/user-account-menu.tsx apps/web/src/components/user-account-menu.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add avatar user account menu

EOF
)"
```

---

### Task 3: Wire into AppShell and update shell tests

**Files:**
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app-shell.test.tsx`
- Modify: `apps/web/README.md` (only if it still documents a plain Log out button)

**Interfaces:**
- Consumes: `UserAccountMenu` from `./components/user-account-menu`
- Produces: `headerRight: <UserAccountMenu onLogout={onLogout} />`

- [ ] **Step 1: Update the failing shell expectation**

In `apps/web/src/app-shell.test.tsx`:

1. Stop mocking `getAccessToken` to the opaque string `'test-token'`. Prefer keeping the rest of the mock (`getApiBaseUrl`) and either:
   - remove `getAccessToken` from the mock so the real helper reads `sessionStorage`, **or**
   - mock `getAccessToken` to return a JWT built like Task 2 (`sub` + `email`).
2. In `beforeAll` / `beforeEach`, store a valid fake JWT under `TOKEN_STORAGE_KEY` (e.g. email `you@example.com`).
3. Replace:

```ts
expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
```

with opening the account menu and asserting email + Log out:

```ts
fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
expect(screen.getByText('you@example.com')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
```

(Adjust Log out role query to match Task 2 if needed.)

Import `fireEvent` from `@testing-library/react`.

- [ ] **Step 2: Run shell test to verify it fails**

Run: `npm test -w @billing-agent/web -- src/app-shell.test.tsx`

Expected: FAIL (still renders outline Log out button / no account menu)

- [ ] **Step 3: Wire `UserAccountMenu` into `AppShellLayout`**

In `apps/web/src/app.tsx`:

- Remove unused `Button` import if no longer needed.
- Add: `import { UserAccountMenu } from './components/user-account-menu';`
- Replace `headerRight` content:

```tsx
headerRight: <UserAccountMenu onLogout={onLogout} />,
```

Keep `onLogout` exactly as today (`clearAccessToken` + `navigate('/login', { replace: true })`).

- [ ] **Step 4: Run web tests**

Run: `npm test -w @billing-agent/web`

Expected: PASS (including shell + account menu + decode tests)

- [ ] **Step 5: Update README if needed**

If `apps/web/README.md` says the header has a Log out button, change it to note the avatar account menu (email + Log out).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app.tsx apps/web/src/app-shell.test.tsx apps/web/README.md
git commit -m "$(cat <<'EOF'
feat(web): show account menu in AppShell header

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Avatar dropdown in `headerRight` | Task 3 |
| Show current user email | Tasks 1–2 |
| Log out clears session + `/login` | Task 3 (`onLogout` unchanged) |
| Cleanplate account-menu pattern | Task 2 |
| JWT client decode, no verify | Task 1 |
| Decode failure fallbacks | Task 2 |
| No auth context / `/auth/me` / extra menu items | All tasks (omitted) |
| Unit + shell tests | Tasks 1–3 |
