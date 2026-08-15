import { Badge, Table } from 'cleanplate';
import { useMemo } from 'react';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import { watchStatusLabel, watchStatusVariant } from '../lib/watch-status';
import type { PriceCheckDocument } from '../lib/types';

type WatchChecksTableProps = {
  checks: PriceCheckDocument[];
};

type CheckRow = {
  id: string;
  status: PriceCheckDocument['status'];
  statusLabel: string;
  checkedAtLabel: string;
  priceLabel: string;
  sourceLabel: string;
  errorLabel: string;
  check: PriceCheckDocument;
};

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function WatchChecksTable({ checks }: WatchChecksTableProps) {
  const rows = useMemo<CheckRow[]>(
    () =>
      checks.map((check) => ({
        id: check.id,
        status: check.status,
        statusLabel: watchStatusLabel(check.status),
        checkedAtLabel: humanizeTimestamp(check.checkedAt),
        priceLabel:
          check.price != null
            ? `${check.currency ?? ''} ${check.price}`.trim()
            : '—',
        sourceLabel: check.source ?? '—',
        errorLabel: check.error ?? '—',
        check,
      })),
    [checks],
  );

  return (
    <Table
      columns={[
        {
          id: 'id',
          title: 'Check id',
          customRender: (raw) => {
            const row = raw as CheckRow;
            return (
              <span title={row.id}>{shortId(row.id)}</span>
            );
          },
        },
        {
          id: 'status',
          title: 'Status',
          customRender: (raw) => {
            const row = raw as CheckRow;
            return (
              <Badge
                label={row.statusLabel}
                variant={watchStatusVariant(row.status)}
              />
            );
          },
        },
        {
          id: 'checkedAtLabel',
          title: 'Checked',
          customRender: (raw) => {
            const row = raw as CheckRow;
            return (
              <span title={new Date(row.check.checkedAt).toLocaleString()}>
                {row.checkedAtLabel}
              </span>
            );
          },
        },
        { id: 'priceLabel', title: 'Price' },
        { id: 'sourceLabel', title: 'Source' },
        {
          id: 'errorLabel',
          title: 'Error',
          customRender: (raw) => {
            const row = raw as CheckRow;
            if (row.errorLabel === '—') return '—';
            return (
              <span title={row.errorLabel}>{row.errorLabel}</span>
            );
          },
        },
      ]}
      data={rows}
      mobileColumns={{
        title: 'statusLabel',
        subtitle: (raw) => (raw as CheckRow).checkedAtLabel,
        mediaAvatar: 'id',
        mediaAvatarCodeText: (raw) => shortId((raw as CheckRow).id),
        meta: (raw) => {
          const row = raw as CheckRow;
          return (
            <Badge
              label={row.statusLabel}
              variant={watchStatusVariant(row.status)}
            />
          );
        },
        description: (raw) => {
          const row = raw as CheckRow;
          const parts = [row.priceLabel, row.sourceLabel];
          if (row.errorLabel !== '—') {
            parts.push(row.errorLabel);
          }
          return parts.join(' · ');
        },
        descriptionLineClamp: 3,
      }}
    />
  );
}
