# Web API Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@billing-agent/web` as a Vite React Cleanplate SPA with Bearer token gate + status page, and add allowlist CORS on the embedded API so Netlify (and local Vite) can call it cross-origin.

**Architecture:** Browser talks directly to `VITE_API_BASE_URL` with Bearer auth. Token resolves as `sessionStorage` override → `VITE_API_TOKEN` → TokenGate. API applies CORS only when `Origin` is listed in `CORS_ORIGINS`. Status page probes `/health` and `/jobs`.

**Tech Stack:** Vite, React 18, TypeScript, Cleanplate, SCSS modules, Vitest + Testing Library; Node `http` API (`@billing-agent/api`) + `node:test`

**Spec:** `docs/superpowers/specs/2026-08-09-web-api-shell-design.md`

## Global Constraints

- Filenames: kebab-case only (workspace rule); React component **export names** may be PascalCase
- No Vite proxy / Netlify `/api` rewrite; direct `VITE_API_BASE_URL` only
- No React Router; single view
- No jobs CRUD / runs table UI
- Prefer Cleanplate props for spacing (`margin`/`padding`/`gap` suffix-only); SCSS modules for app-specific layout; no hard-coded colors when CSS variables exist
- Never log or render the full API token
- `CORS_ORIGINS` empty/absent → no CORS headers and no OPTIONS short-circuit (preserve current API behavior)
- `VITE_API_BASE_URL` is an absolute origin with no trailing slash

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/cors.ts` | Parse `CORS_ORIGINS`; apply headers; decide OPTIONS short-circuit |
| `apps/api/src/server.ts` | Accept `corsOrigins`; wrap request handler |
| `apps/api/tests/api.test.ts` | CORS allow / deny / preflight tests |
| `apps/worker/src/cli.ts` | Pass parsed `CORS_ORIGINS` into `startServer` |
| `.env.example` | Document `CORS_ORIGINS` |
| `apps/web/package.json` | `@billing-agent/web` scripts and deps |
| `apps/web/vite.config.ts` | Vite + React + Vitest |
| `apps/web/tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | TS project refs for Vite |
| `apps/web/index.html` | Mount + Material Symbols |
| `apps/web/netlify.toml` | Build, publish `dist`, SPA fallback |
| `apps/web/.env.example` | `VITE_API_BASE_URL`, `VITE_API_TOKEN` |
| `apps/web/src/main.tsx` | Bootstrap + Cleanplate CSS |
| `apps/web/src/app.tsx` | Root composition |
| `apps/web/src/app.module.scss` | App shell layout |
| `apps/web/src/vite-env.d.ts` | `ImportMetaEnv` typings |
| `apps/web/src/lib/auth-token.ts` | Token resolve / set / clear |
| `apps/web/src/lib/auth-token.test.ts` | Token resolution tests |
| `apps/web/src/lib/api-client.ts` | `fetch` wrapper + Bearer |
| `apps/web/src/lib/api-client.test.ts` | Header / error mapping tests |
| `apps/web/src/components/token-gate.tsx` | Token form UI |
| `apps/web/src/components/token-gate.module.scss` | TokenGate layout |
| `apps/web/src/components/status-page.tsx` | Health + auth probes UI |
| `apps/web/src/components/status-page.module.scss` | Status layout |
| `apps/web/README.md` | Replace stub with local + Netlify docs |
| `package.json` (root) | `build` / `test` / `dev:web` |
| `README.md` (root) | Web UI + CORS section |

---

### Task 1: API CORS allowlist

**Files:**
- Create: `apps/api/src/cors.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/tests/api.test.ts`
- Modify: `apps/worker/src/cli.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `startServer({ port, token, store })`
- Produces:
  - `parseCorsOrigins(raw?: string): string[]`
  - `applyCors(req, res, corsOrigins): { handled: boolean }` — sets CORS headers when `Origin` is allowlisted; if `method === OPTIONS` and `corsOrigins.length > 0`, ends with `204` and `handled: true`
  - `StartServerInput.corsOrigins?: string[]`

- [ ] **Step 1: Write the failing CORS tests**

Append to `apps/api/tests/api.test.ts` (reuse `MemoryStore` + `handles`):

```ts
describe('api CORS', () => {
  it('echoes Access-Control-Allow-Origin for an allowlisted Origin', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['http://localhost:5173'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(
      response.headers.get('access-control-allow-headers'),
      'Authorization, Content-Type',
    );
  });

  it('does not set CORS headers for a non-allowlisted Origin', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['http://localhost:5173'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('answers OPTIONS preflight with 204 before auth when CORS is configured', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
      corsOrigins: ['https://app.netlify.app'],
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.netlify.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.netlify.app');
    assert.match(
      response.headers.get('access-control-allow-methods') ?? '',
      /GET/,
    );
  });

  it('does not short-circuit OPTIONS when corsOrigins is empty', async () => {
    const handle = await startServer({
      port: 0,
      token: 'secret-token',
      store: new MemoryStore(),
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/jobs`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @billing-agent/api`

Expected: FAIL — `corsOrigins` not accepted / headers missing / OPTIONS still `401` when configured

- [ ] **Step 3: Implement `cors.ts` and wire `server.ts`**

Create `apps/api/src/cors.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  corsOrigins: string[],
): { handled: boolean } {
  const originHeader = req.headers.origin;
  const origin = typeof originHeader === 'string' ? originHeader : undefined;

  if (origin && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS',
    );
    res.setHeader('Vary', 'Origin');
  }

  if ((req.method ?? 'GET') === 'OPTIONS' && corsOrigins.length > 0) {
    res.statusCode = 204;
    res.end();
    return { handled: true };
  }

  return { handled: false };
}
```

Update `apps/api/src/server.ts`:

```ts
import { createServer } from 'node:http';
import type { BillingStore } from '@billing-agent/core';
import { applyCors } from './cors.js';
import { handleRoute } from './routes.js';

export type StartServerInput = {
  port: number;
  token: string;
  store: BillingStore;
  corsOrigins?: string[];
};

export type ApiServerHandle = {
  port: number;
  close(): Promise<void>;
};

export async function startServer(input: StartServerInput): Promise<ApiServerHandle> {
  const corsOrigins = input.corsOrigins ?? [];

  const server = createServer((req, res) => {
    const { handled } = applyCors(req, res, corsOrigins);
    if (handled) return;

    void handleRoute(req, res, { token: input.token, store: input.store }).catch(
      (error: unknown) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '0.0.0.0', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine listening port');
  }

  return {
    port: address.port,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
```

In `apps/worker/src/cli.ts`, import `parseCorsOrigins` from `@billing-agent/api` — **export it** from `apps/api/src/index.ts`:

```ts
export { startServer, type ApiServerHandle, type StartServerInput } from './server.js';
export { parseCorsOrigins, applyCors } from './cors.js';
```

Wire daemon `startServer` call:

```ts
import { parseCorsOrigins, startServer } from '@billing-agent/api';
// ...
const server = await startServer({
  port: resolveHttpPort(),
  token: requireApiToken(),
  store,
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
});
```

Append to `.env.example`:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.netlify.app
```

- [ ] **Step 4: Run API tests**

Run: `npm test -w @billing-agent/api`

Expected: PASS (existing + new CORS cases)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cors.ts apps/api/src/server.ts apps/api/src/index.ts \
  apps/api/tests/api.test.ts apps/worker/src/cli.ts .env.example
git commit -m "$(cat <<'EOF'
feat(api): add CORS_ORIGINS allowlist for browser clients

Enable Netlify and local Vite origins to call the embedded API with
Bearer auth, including OPTIONS preflight before auth.
EOF
)"
```

---

### Task 2: Scaffold `@billing-agent/web`

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.app.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/app.module.scss`
- Create: `apps/web/.env.example`
- Create: `apps/web/netlify.toml`
- Modify: `package.json` (root)
- Delete or replace stub-only content in `apps/web/README.md` (full docs in Task 5; leave a one-line placeholder OK)

**Interfaces:**
- Consumes: npm workspaces `apps/*`
- Produces: runnable Vite app; `npm run build -w @billing-agent/web` writes `apps/web/dist`

- [ ] **Step 1: Create package manifests and Vite config**

`apps/web/package.json`:

```json
{
  "name": "@billing-agent/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "cleanplate": "^0.3.36",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^26.1.0",
    "sass": "^1.85.0",
    "typescript": "^5.8.0",
    "vite": "^6.2.0",
    "vitest": "^3.2.0"
  }
}
```

`apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

`apps/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`apps/web/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

`apps/web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Billing Agent</title>
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'cleanplate/dist/index.css';
import { App } from './app';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/app.tsx` (temporary scaffold — replaced in Task 4):

```tsx
import { Container, Typography } from 'cleanplate';
import styles from './app.module.scss';

export function App() {
  return (
    <Container className={styles['app-root']} padding="4">
      <Typography variant="h1" margin="b-2">
        Billing Agent
      </Typography>
      <Typography variant="p">Web shell scaffold</Typography>
    </Container>
  );
}
```

`apps/web/src/app.module.scss`:

```scss
.app-root {
  min-height: 100vh;
}
```

`apps/web/.env.example`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8080
VITE_API_TOKEN=
```

`apps/web/netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Update root `package.json` scripts:

```json
"build": "npm run build -w @billing-agent/core && npm run build -w @billing-agent/api && npm run build -w @billing-agent/worker && npm run build -w @billing-agent/web",
"test": "npm run test -w @billing-agent/core && npm run test -w @billing-agent/api && npm run test -w @billing-agent/worker && npm run test -w @billing-agent/web",
"dev:web": "npm run dev -w @billing-agent/web"
```

- [ ] **Step 2: Install and verify build**

Run:

```bash
npm install
npm run build -w @billing-agent/web
```

Expected: exits 0; `apps/web/dist/index.html` exists

If Cleanplate peer/React resolution fails, fix versions to satisfy Cleanplate’s `peerDependencies` without upgrading the whole monorepo Node engine.

- [ ] **Step 3: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(web): scaffold Vite React Cleanplate workspace

Add @billing-agent/web with SCSS modules, Vitest, Netlify config,
and root build/test/dev:web wiring.
EOF
)"
```

---

### Task 3: Auth token + API client

**Files:**
- Create: `apps/web/src/lib/auth-token.ts`
- Create: `apps/web/src/lib/auth-token.test.ts`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/api-client.test.ts`

**Interfaces:**
- Consumes: `import.meta.env.VITE_API_BASE_URL`, `VITE_API_TOKEN`; `sessionStorage`
- Produces:
  - `TOKEN_STORAGE_KEY = 'billing-agent.api-token'`
  - `getApiToken(): string | null`
  - `setApiTokenOverride(token: string): void`
  - `clearApiTokenOverride(): void`
  - `getApiBaseUrl(): string` — throws if missing/empty
  - `apiFetch(path: string, init?: RequestInit): Promise<Response>` — joins base + path; attaches Bearer when token present
  - `ApiClientError` with `kind: 'network' | 'http'` and optional `status`

- [ ] **Step 1: Write failing auth-token tests**

`apps/web/src/lib/auth-token.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOKEN_STORAGE_KEY,
  clearApiTokenOverride,
  getApiToken,
  setApiTokenOverride,
} from './auth-token';

describe('auth-token', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it('returns session override over env token', () => {
    setApiTokenOverride('override-token');
    expect(getApiToken()).toBe('override-token');
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe('override-token');
  });

  it('falls back to VITE_API_TOKEN when no override', () => {
    expect(getApiToken()).toBe('env-token');
  });

  it('returns null when neither override nor env is set', () => {
    vi.stubEnv('VITE_API_TOKEN', '');
    expect(getApiToken()).toBeNull();
  });

  it('clearApiTokenOverride restores env fallback', () => {
    setApiTokenOverride('override-token');
    clearApiTokenOverride();
    expect(getApiToken()).toBe('env-token');
  });
});
```

- [ ] **Step 2: Run auth tests — expect fail**

Run: `npm test -w @billing-agent/web -- src/lib/auth-token.test.ts`

Expected: FAIL — module missing

- [ ] **Step 3: Implement `auth-token.ts`**

```ts
export const TOKEN_STORAGE_KEY = 'billing-agent.api-token';

export function getApiToken(): string | null {
  const override = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (override && override.trim()) return override.trim();

  const envToken = import.meta.env.VITE_API_TOKEN;
  if (typeof envToken === 'string' && envToken.trim()) return envToken.trim();

  return null;
}

export function setApiTokenOverride(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

export function clearApiTokenOverride(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (typeof base !== 'string' || !base.trim()) {
    throw new Error('VITE_API_BASE_URL is required');
  }
  return base.replace(/\/+$/, '');
}
```

- [ ] **Step 4: Run auth tests — expect pass**

Run: `npm test -w @billing-agent/web -- src/lib/auth-token.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing api-client tests**

`apps/web/src/lib/api-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import { TOKEN_STORAGE_KEY } from './auth-token';

describe('apiFetch', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8080');
    vi.stubEnv('VITE_API_TOKEN', 'env-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('sends Authorization Bearer from resolved token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/jobs');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/jobs',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer env-token');
  });

  it('prefers session override for Bearer token', async () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'override-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer override-token');
  });

  it('omits Authorization when no token is available', async () => {
    vi.stubEnv('VITE_API_TOKEN', '');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/health');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBeNull();
  });
});
```

- [ ] **Step 6: Run api-client tests — expect fail**

Run: `npm test -w @billing-agent/web -- src/lib/api-client.test.ts`

Expected: FAIL — module missing

- [ ] **Step 7: Implement `api-client.ts`**

```ts
import { getApiBaseUrl, getApiToken } from './auth-token';

export class ApiClientError extends Error {
  readonly kind: 'network' | 'http';
  readonly status?: number;

  constructor(message: string, kind: 'network' | 'http', status?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = status;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;

  const headers = new Headers(init.headers);
  const token = getApiToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    return await fetch(url, { ...init, headers });
  } catch {
    throw new ApiClientError('Cannot reach API', 'network');
  }
}
```

- [ ] **Step 8: Run web lib tests**

Run: `npm test -w @billing-agent/web`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib
git commit -m "$(cat <<'EOF'
feat(web): add token resolution and API fetch client

Resolve Bearer token from session override or Vite env and attach it
to cross-origin API requests.
EOF
)"
```

---

### Task 4: TokenGate + StatusPage UI

**Files:**
- Create: `apps/web/src/components/token-gate.tsx`
- Create: `apps/web/src/components/token-gate.module.scss`
- Create: `apps/web/src/components/status-page.tsx`
- Create: `apps/web/src/components/status-page.module.scss`
- Create: `apps/web/src/components/token-gate.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.module.scss`

**Interfaces:**
- Consumes: `getApiToken`, `setApiTokenOverride`, `clearApiTokenOverride`, `getApiBaseUrl`, `apiFetch`, `ApiClientError`
- Produces: `TokenGate` (form + clear), `StatusPage` (health + `/jobs` probe), `App` composing them

- [ ] **Step 1: Write failing TokenGate test**

`apps/web/src/components/token-gate.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenGate } from './token-gate';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('TokenGate', () => {
  it('submits token override and calls onTokenChange', () => {
    const onTokenChange = vi.fn();
    render(<TokenGate onTokenChange={onTokenChange} />);

    fireEvent.change(screen.getByLabelText(/api token/i), {
      target: { value: ' pasted-token ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));

    expect(sessionStorage.getItem('billing-agent.api-token')).toBe('pasted-token');
    expect(onTokenChange).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -w @billing-agent/web -- src/components/token-gate.test.tsx`

Expected: FAIL — component missing

- [ ] **Step 3: Implement TokenGate**

`apps/web/src/components/token-gate.tsx`:

```tsx
import { useState } from 'react';
import { Button, Container, FormControls, Typography } from 'cleanplate';
import {
  clearApiTokenOverride,
  getApiToken,
  setApiTokenOverride,
} from '../lib/auth-token';
import styles from './token-gate.module.scss';

export type TokenGateProps = {
  onTokenChange: () => void;
};

export function TokenGate({ onTokenChange }: TokenGateProps) {
  const [value, setValue] = useState('');
  const hasToken = Boolean(getApiToken());

  return (
    <Container className={styles['token-gate']} padding="4" margin="b-4">
      <Typography variant="h3" margin="b-2">
        API token
      </Typography>
      <Typography variant="p" margin="b-3">
        Uses VITE_API_TOKEN when set. Optionally override for this browser session.
      </Typography>
      <FormControls.Input
        label="API token"
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        isFluid
      />
      <Container display="flex" gap="2" margin="t-3">
        <Button
          variant="solid"
          onClick={() => {
            if (!value.trim()) return;
            setApiTokenOverride(value);
            setValue('');
            onTokenChange();
          }}
        >
          Save token
        </Button>
        {hasToken ? (
          <Button
            variant="outline"
            onClick={() => {
              clearApiTokenOverride();
              onTokenChange();
            }}
          >
            Clear override
          </Button>
        ) : null}
      </Container>
    </Container>
  );
}
```

`apps/web/src/components/token-gate.module.scss`:

```scss
.token-gate {
  max-width: 32rem;
}
```

Cleanplate `FormControls.Input` accepts `type="password"` (see `node_modules/cleanplate/docs/FormControls.md`).

- [ ] **Step 4: Run TokenGate test — expect pass**

Run: `npm test -w @billing-agent/web -- src/components/token-gate.test.tsx`

Expected: PASS

- [ ] **Step 5: Implement StatusPage + App**

`apps/web/src/components/status-page.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Container, Spinner, Typography } from 'cleanplate';
import { ApiClientError, apiFetch } from '../lib/api-client';
import { getApiBaseUrl, getApiToken } from '../lib/auth-token';
import styles from './status-page.module.scss';

type ProbeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail?: string }
  | { status: 'error'; message: string };

export function StatusPage() {
  const [health, setHealth] = useState<ProbeState>({ status: 'idle' });
  const [auth, setAuth] = useState<ProbeState>({ status: 'idle' });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const baseUrl = getApiBaseUrl();
  const token = getApiToken();

  const runProbes = useCallback(async () => {
    if (!token) return;

    setHealth({ status: 'loading' });
    setAuth({ status: 'loading' });

    try {
      const healthResponse = await apiFetch('/health');
      if (!healthResponse.ok) {
        setHealth({ status: 'error', message: `Health failed (${healthResponse.status})` });
      } else {
        setHealth({ status: 'ok', detail: 'ok' });
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Cannot reach API';
      setHealth({ status: 'error', message });
      setAuth({ status: 'error', message: 'Skipped after health failure' });
      setCheckedAt(new Date().toISOString());
      return;
    }

    try {
      const jobsResponse = await apiFetch('/jobs');
      if (jobsResponse.status === 401 || jobsResponse.status === 403) {
        setAuth({ status: 'error', message: 'Auth failed' });
      } else if (!jobsResponse.ok) {
        setAuth({ status: 'error', message: `Jobs probe failed (${jobsResponse.status})` });
      } else {
        setAuth({ status: 'ok', detail: 'authorized' });
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Cannot reach API';
      setAuth({ status: 'error', message });
    }

    setCheckedAt(new Date().toISOString());
  }, [token]);

  useEffect(() => {
    void runProbes();
  }, [runProbes]);

  if (!token) {
    return (
      <Alert
        variant="info"
        margin="b-3"
        message="Enter an API token to run connectivity checks."
      />
    );
  }

  return (
    <Container className={styles['status-page']} padding="0">
      <Typography variant="h2" margin="b-2">
        API status
      </Typography>
      <Typography variant="p" margin="b-3">
        Base URL: {baseUrl}
      </Typography>

      <Container display="flex" gap="2" margin="b-3" align="center">
        <Typography variant="span">Health</Typography>
        {health.status === 'loading' ? <Spinner size="small" /> : null}
        {health.status === 'ok' ? <Badge label="OK" variant="success" /> : null}
        {health.status === 'error' ? <Badge label="Fail" variant="error" /> : null}
      </Container>
      {health.status === 'error' ? (
        <Alert variant="error" margin="b-3" message={health.message} />
      ) : null}

      <Container display="flex" gap="2" margin="b-3" align="center">
        <Typography variant="span">Auth</Typography>
        {auth.status === 'loading' ? <Spinner size="small" /> : null}
        {auth.status === 'ok' ? <Badge label="OK" variant="success" /> : null}
        {auth.status === 'error' ? <Badge label="Fail" variant="error" /> : null}
      </Container>
      {auth.status === 'error' ? (
        <Alert variant="error" margin="b-3" message={auth.message} />
      ) : null}

      {checkedAt ? (
        <Typography variant="small" margin="b-3">
          Last checked: {checkedAt}
        </Typography>
      ) : null}

      <Button variant="outline" onClick={() => void runProbes()}>
        Retry
      </Button>
    </Container>
  );
}
```

`apps/web/src/components/status-page.module.scss`:

```scss
.status-page {
  max-width: 40rem;
}
```

Replace `apps/web/src/app.tsx`:

```tsx
import { useState } from 'react';
import { Container, Typography } from 'cleanplate';
import { StatusPage } from './components/status-page';
import { TokenGate } from './components/token-gate';
import styles from './app.module.scss';

export function App() {
  const [tokenEpoch, setTokenEpoch] = useState(0);

  return (
    <Container className={styles['app-root']} padding="4">
      <Typography variant="h1" margin="b-3">
        Billing Agent
      </Typography>
      <TokenGate onTokenChange={() => setTokenEpoch((value) => value + 1)} />
      <StatusPage key={tokenEpoch} />
    </Container>
  );
}
```

Use Cleanplate `Alert` via the `message` prop (not children) — see `node_modules/cleanplate/docs/Alert.md`.

- [ ] **Step 6: Typecheck + test + build**

Run:

```bash
npm test -w @billing-agent/web
npm run build -w @billing-agent/web
```

Expected: PASS / exit 0

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): add token gate and API status page

Probe /health and /jobs with Cleanplate UI and session token override.
EOF
)"
```

---

### Task 5: Docs and root README

**Files:**
- Modify: `apps/web/README.md`
- Modify: `README.md`
- Modify: `.env.example` (confirm `CORS_ORIGINS` present from Task 1)

**Interfaces:**
- Consumes: finished web package + CORS env
- Produces: operator docs for local Vite and Netlify

- [ ] **Step 1: Replace `apps/web/README.md`**

```markdown
# @billing-agent/web

React (Vite) UI for the billing-agent HTTP API. Uses Cleanplate + SCSS modules.

## Local development

1. Run the worker daemon (API on `HTTP_PORT`, default `8080`) with CORS:

```bash
# in repo root .env
CORS_ORIGINS=http://localhost:5173
```

2. Configure the web app:

```bash
cp apps/web/.env.example apps/web/.env
# set VITE_API_BASE_URL=http://127.0.0.1:8080
# optional: VITE_API_TOKEN=<same as API_TOKEN>
```

3. Start Vite:

```bash
npm run dev:web
```

Open the printed local URL. Without `VITE_API_TOKEN`, use the TokenGate form (session override).

## Netlify

- Base directory: `apps/web`
- Build: `npm run build` → publish `dist`
- Env: `VITE_API_BASE_URL` (required), `VITE_API_TOKEN` (optional)
- On the API host, set `CORS_ORIGINS` to include the Netlify site origin (and preview origins if needed)

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production bundle
- `npm test` — Vitest
```

- [ ] **Step 2: Update root `README.md`**

Replace the `## apps/web` stub section with:

```markdown
## Web UI (`apps/web`)

Vite + React + Cleanplate SPA hosted on Netlify. Talks to the worker API via `VITE_API_BASE_URL` and Bearer token (`VITE_API_TOKEN` or session override).

```bash
npm run dev:web
```

On the API host, allow browser origins:

```bash
CORS_ORIGINS=http://localhost:5173,https://your-app.netlify.app
```

See `apps/web/README.md` for Netlify settings.
```

Also add `CORS_ORIGINS` to the Coolify / env tables if present in the same README.

- [ ] **Step 3: Commit**

```bash
git add apps/web/README.md README.md .env.example
git commit -m "$(cat <<'EOF'
docs: document web UI local and Netlify setup

Describe CORS_ORIGINS, Vite env vars, and Netlify base directory.
EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Vite React TS Cleanplate SCSS scaffold | 2 |
| Bearer env + sessionStorage override | 3, 4 |
| Status page `/health` + `/jobs` | 4 |
| Direct `VITE_API_BASE_URL` (no proxy) | 2–4 |
| API `CORS_ORIGINS` allowlist + OPTIONS | 1 |
| Netlify `netlify.toml` + SPA fallback | 2, 5 |
| Root `build` / `test` / `dev:web` | 2 |
| API CORS tests | 1 |
| Web token + client tests | 3, 4 |
| Docs | 5 |
| No jobs CRUD / router / BFF | honored (non-goals) |
