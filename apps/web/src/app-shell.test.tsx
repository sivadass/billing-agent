import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShellLayout } from './app';
import { TOKEN_STORAGE_KEY } from './lib/auth-token';

vi.mock('./lib/auth-token', async () => {
  const actual = await vi.importActual<typeof import('./lib/auth-token')>('./lib/auth-token');
  return {
    ...actual,
    getApiBaseUrl: () => 'http://127.0.0.1:8080',
  };
});

function encodeSegment(value: object): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${encodeSegment({ alg: 'none' })}.${encodeSegment(payload)}.sig`;
}

describe('App shell routes', () => {
  beforeAll(() => {
    class IntersectionObserverMock {
      disconnect() {}
      observe() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  });

  beforeEach(() => {
    sessionStorage.setItem(
      TOKEN_STORAGE_KEY,
      makeToken({ sub: 'user-1', email: 'you@example.com' }),
    );
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('renders Jobs hub at /jobs without Settings', () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route element={<AppShellLayout />}>
            <Route path="/jobs" element={<div>Jobs hub heading</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Jobs hub heading')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByText('you@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log out/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^settings$/i })).not.toBeInTheDocument();
  });
});
