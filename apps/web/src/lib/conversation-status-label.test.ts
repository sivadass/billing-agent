import { describe, expect, it } from 'vitest';
import { conversationStatusLabel } from './conversation-status-label';
import type { ConversationStatus } from './types';

const CASES: Array<[ConversationStatus, string]> = [
  ['active', 'In progress'],
  ['awaiting_secret', 'Needs secrets'],
  ['confirming', 'Ready to confirm'],
  ['saved', 'Saved'],
  ['expired', 'Expired'],
  ['abandoned', 'Abandoned'],
];

describe('conversationStatusLabel', () => {
  it.each(CASES)('maps %s → %s', (status, label) => {
    expect(conversationStatusLabel(status)).toBe(label);
  });
});
