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
