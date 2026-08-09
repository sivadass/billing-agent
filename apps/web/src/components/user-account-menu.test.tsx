import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    cleanup();
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

    fireEvent.click(screen.getByRole('link', { name: /log out/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows fallback copy when the token cannot be decoded', () => {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, 'not-a-jwt');
    render(<UserAccountMenu onLogout={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByText('Unable to load email')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log out/i })).toBeInTheDocument();
  });
});
