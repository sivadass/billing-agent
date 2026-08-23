import { describe, expect, it } from 'vitest';
import { sanitizeMessageText } from './sanitize-message-text';

describe('sanitizeMessageText', () => {
  it('strips secret tokens', () => {
    expect(
      sanitizeMessageText('Please provide [secret:username] and [secret:password].'),
    ).toBe('Please provide and .');
  });

  it('preserves normal text', () => {
    expect(sanitizeMessageText('Hello world')).toBe('Hello world');
  });

  it('collapses extra whitespace', () => {
    expect(sanitizeMessageText('a  [secret:x]   b')).toBe('a b');
  });
});
