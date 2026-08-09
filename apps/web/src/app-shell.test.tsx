import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './app';

vi.mock('./lib/auth-token', async () => {
  const actual = await vi.importActual<typeof import('./lib/auth-token')>('./lib/auth-token');
  return {
    ...actual,
    getApiToken: () => 'test-token',
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
  });

  it('renders Jobs hub at /jobs', () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /jobs/i })).toBeInTheDocument();
  });
});
