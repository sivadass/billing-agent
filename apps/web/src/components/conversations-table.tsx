import { Table } from 'cleanplate';
import { conversationStatusLabel } from '../lib/conversation-status-label';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { ConversationSummary } from '../lib/types';
import { ChatStatusBadge } from './chat-status-badge';
import styles from './conversations-table.module.scss';

type ConversationsTableProps = {
  conversations: ConversationSummary[];
  onSelect: (conversation: ConversationSummary) => void;
};

type ConversationsTableRow = {
  id: string;
  goal: string;
  status: ConversationSummary['status'];
  statusLabel: string;
  startUrl: string;
  updatedAtLabel: string;
  conversation: ConversationSummary;
};

function displayGoal(conversation: ConversationSummary): string {
  const goal = conversation.goal?.trim();
  if (goal) return goal;
  return 'Untitled chat';
}

function displaySubtitle(conversation: ConversationSummary): string {
  return conversation.startUrl ?? conversation.id;
}

export function ConversationsTable({ conversations, onSelect }: ConversationsTableProps) {
  const rows: ConversationsTableRow[] = conversations.map((conversation) => ({
    id: conversation.id,
    goal: displayGoal(conversation),
    status: conversation.status,
    statusLabel: conversationStatusLabel(conversation.status),
    startUrl: displaySubtitle(conversation),
    updatedAtLabel: humanizeTimestamp(conversation.updatedAt),
    conversation,
  }));

  return (
    <div className={styles.wrapper}>
      <Table
        columns={[
          { id: 'goal', title: 'Goal' },
          {
            id: 'status',
            title: 'Status',
            customRender: (raw) => {
              const row = raw as ConversationsTableRow;
              return <ChatStatusBadge status={row.status} />;
            },
          },
          { id: 'startUrl', title: 'Start URL' },
          {
            id: 'updatedAtLabel',
            title: 'Updated',
            customRender: (raw) => {
              const row = raw as ConversationsTableRow;
              return (
                <span title={new Date(row.conversation.updatedAt).toLocaleString()}>
                  {row.updatedAtLabel}
                </span>
              );
            },
          },
        ]}
        data={rows}
        onRowClick={(raw) => onSelect((raw as ConversationsTableRow).conversation)}
        mobileColumns={{
          title: 'goal',
          mediaAvatar: 'goal',
          subtitle: (raw) => (raw as ConversationsTableRow).startUrl,
          meta: (raw) => {
            const row = raw as ConversationsTableRow;
            return <ChatStatusBadge status={row.status} />;
          },
          description: (raw) => (raw as ConversationsTableRow).updatedAtLabel,
        }}
      />
    </div>
  );
}
