import type { ConversationStatus } from './types';

export function conversationStatusVariant(
  status: ConversationStatus,
): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'saved') return 'success';
  if (status === 'active' || status === 'confirming' || status === 'awaiting_secret') {
    return 'warning';
  }
  if (status === 'expired' || status === 'abandoned') return 'error';
  return 'default';
}
