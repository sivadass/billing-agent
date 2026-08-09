import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../lib/auth-token';
import { ProtectedRoute } from './protected-route';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('redirects to /login when logged out', () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/jobs" element={<div>Jobs hub</div>} />
          </Route>
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Jobs hub')).not.toBeInTheDocument();
  });

  it('renders children when a JWT is present', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-token');
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/jobs" element={<div>Jobs hub</div>} />
          </Route>
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Jobs hub')).toBeInTheDocument();
  });
});
