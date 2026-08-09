import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppShellLayout } from './app';
import { TOKEN_STORAGE_KEY } from './lib/auth-token';

vi.mock('./lib/auth-token', async () => {
  const actual = await vi.importActual<typeof import('./lib/auth-token')>('./lib/auth-token');
  return {
    ...actual,
    getAccessToken: () => 'test-token',
    getApiBaseUrl: () => 'http://127.0.0.1:8080',
  };
});

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
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'test-token');
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
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^settings$/i })).not.toBeInTheDocument();
  });
});
