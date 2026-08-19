import { Badge, Table } from 'cleanplate';
import { conversationStatusVariant } from '../lib/conversation-status';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { ConversationSummary } from '../lib/types';

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

export function ConversationsTable({ conversations, onSelect }: ConversationsTableProps) {
  const rows: ConversationsTableRow[] = conversations.map((conversation) => ({
    id: conversation.id,
    goal: conversation.goal?.trim() ? conversation.goal : (conversation.startUrl ?? conversation.id),
    status: conversation.status,
    statusLabel: conversation.status,
    startUrl: conversation.startUrl ?? '—',
    updatedAtLabel: humanizeTimestamp(conversation.updatedAt),
    conversation,
  }));

  return (
    <Table
      columns={[
        { id: 'goal', title: 'Goal' },
        {
          id: 'status',
          title: 'Status',
          customRender: (raw) => {
            const row = raw as ConversationsTableRow;
            return (
              <Badge
                label={row.statusLabel}
                variant={conversationStatusVariant(row.status)}
              />
            );
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
        subtitle: (raw) => (raw as ConversationsTableRow).startUrl,
        meta: (raw) => {
          const row = raw as ConversationsTableRow;
          return (
            <Badge
              label={row.statusLabel}
              variant={conversationStatusVariant(row.status)}
            />
          );
        },
        description: (raw) => (raw as ConversationsTableRow).updatedAtLabel,
      }}
    />
  );
}
