import { conversationStatusLabel } from '../lib/conversation-status-label';
import type { ConversationStatus } from '../lib/types';
import styles from '../pages/chat-page.module.scss';

type ChatStatusBadgeProps = {
  status: ConversationStatus;
};

function statusToneClass(status: ConversationStatus): string {
  if (status === 'saved') return styles['status-badge--saved'];
  if (status === 'expired' || status === 'abandoned') return styles['status-badge--error'];
  return styles['status-badge--in-progress'];
}

export function ChatStatusBadge({ status }: ChatStatusBadgeProps) {
  return (
    <span className={`${styles['status-badge']} ${statusToneClass(status)}`}>
      {conversationStatusLabel(status)}
    </span>
  );
}
