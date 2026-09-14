import type { ConversationStatus } from './types';

const LABELS: Record<ConversationStatus, string> = {
  active: 'In progress',
  awaiting_secret: 'Needs secrets',
  confirming: 'Ready to confirm',
  saved: 'Saved',
  expired: 'Expired',
  abandoned: 'Abandoned',
};

export function conversationStatusLabel(status: ConversationStatus): string {
  return LABELS[status];
}
