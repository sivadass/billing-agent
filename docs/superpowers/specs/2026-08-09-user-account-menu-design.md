# User Account Menu Design

**Date:** 2026-08-09  
**Status:** Approved for implementation planning  
**Related:** `2026-08-09-jwt-user-auth-design.md`, `apps/web`, Cleanplate `Dropdown` / `Avatar` / `MenuList`

## Problem

The AppShell header exposes a plain **Log out** button. Signed-in users cannot see which account they are using. The login API returns `{ id, email }` and the JWT carries `email`, but the shell never surfaces that identity.

## Goals

- Replace the header Log out button with an avatar-triggered dropdown
- Show the current user’s email (read-only) in the menu
- Provide a Log out action that clears the session and returns to `/login`
- Follow Cleanplate’s recommended account-menu pattern for `headerRight`

## Non-goals

- Auth context / React provider
- `/auth/me` or any new API
- Profile, settings, or other menu destinations
- Server-side logout endpoint
- Display name or avatar image (email initials only)
- Persisting a separate user object in `sessionStorage`

## Decisions

| Topic | Decision |
| --- | --- |
| Placement | AppShell `headerRight` only; replace outline Log out button |
| UI library | Cleanplate `Dropdown` + `Avatar` + `Typography` + `MenuList` |
| Component structure | Extract `UserAccountMenu`; shell passes only `onLogout` |
| Email source | Menu client-decodes JWT from existing `sessionStorage` token (no signature verify) |
| Menu contents | “Signed in as” caption + email; single action **Log out** |
| Avatar | `name={email}` initials; medium size; no image URL |
| Dropdown placement | `bottom-end`, `offset={8}` |
| Logout behavior | Unchanged: `clearAccessToken()` then `navigate('/login', { replace: true })` |
| Decode failure | Fallback avatar name `"User"`; short “Unable to load email” meta; Log out still works |

## Architecture

```text
AppShellLayout
  └─ headerRight: <UserAccountMenu onLogout={onLogout} />
       ├─ getAccessToken() + decodeAccessToken(token)
       ├─ Avatar trigger (initials from email, or “User” fallback)
       └─ Dropdown content
            ├─ meta: “Signed in as” + email (or unable-to-load fallback)
            └─ MenuList: Log out → onLogout → onClose
```

### Files

| Path | Role |
| --- | --- |
| `apps/web/src/lib/decode-access-token.ts` | Base64url-decode JWT payload; map `sub` → `userId`, `email` → `email`; return `null` if missing/invalid |
| `apps/web/src/components/user-account-menu.tsx` | Account dropdown; prop `onLogout: () => void`; owns token read + decode + fallbacks |
| `apps/web/src/app.tsx` | Wire menu into `headerRight`; keep existing `onLogout` |
| `apps/web/src/app-shell.test.tsx` | Assert avatar/menu + Log out instead of lone header button |
| Decode unit test | Cover valid payload, missing claims, malformed token |

### JWT decode (client)

- Split token on `.`; decode middle segment with base64url → JSON
- Expect claims shaped like the API signer: `{ sub: userId, email }`
- Do **not** verify the signature in the browser; authenticity remains the API’s job on each request
- Treat decode as UI convenience only

### UI details

Meta block padding/border aligns with Cleanplate account-menu guidance:

- Caption: `Typography` small, muted — “Signed in as”
- Email: `Typography` small, subtle, `wordBreak="wrap"`
- Divider under meta (`borderBottom: 1px solid var(--gray-100)`)
- `MenuList` vertical, small, light — item `{ label: "Log out", value: "logout", icon: "logout" }`
- On menu click: run `onLogout`, then `onClose?.()`

### Edge cases

- Missing or malformed JWT payload → fallback label/meta; logout still available
- Long emails wrap in the meta block
- API `401` path in `api-client` unchanged (clear token + hard redirect to login)

## Testing

- Unit: `decodeAccessToken` happy path and failure cases
- Shell: open/find account control; assert email when a test token is present; assert Log out clears session / navigates (match existing auth test style)

## Out of scope reminders

No changes to login persistence shape, JWT secret handling, or API auth middleware.
