import { describe, expect, it } from 'vitest';
import { conversationStatusVariant } from './conversation-status';

describe('conversationStatusVariant', () => {
  it('maps saved to success', () => {
    expect(conversationStatusVariant('saved')).toBe('success');
  });

  it('maps in-progress statuses to warning', () => {
    expect(conversationStatusVariant('active')).toBe('warning');
    expect(conversationStatusVariant('awaiting_secret')).toBe('warning');
    expect(conversationStatusVariant('confirming')).toBe('warning');
  });

  it('maps abandoned and expired to error', () => {
    expect(conversationStatusVariant('abandoned')).toBe('error');
    expect(conversationStatusVariant('expired')).toBe('error');
  });
});
