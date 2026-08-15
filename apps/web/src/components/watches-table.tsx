import {
  Badge,
  Button,
  ConfirmDialog,
  Container,
  Dropdown,
  Icon,
  MenuList,
  Table,
} from 'cleanplate';
import { useMemo, useState } from 'react';
import { humanizeCron } from '../lib/cron-humanize';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import { watchStatusLabel, watchStatusVariant } from '../lib/watch-status';
import type { WatchDocument } from '../lib/types';
import styles from './watches-table.module.scss';

type WatchesTableProps = {
  watches: WatchDocument[];
  statusByWatch: Record<string, string>;
  runningWatchId?: string | null;
  onCheckNow: (watch: WatchDocument) => Promise<void> | void;
  onSelect: (watch: WatchDocument) => void;
  onEdit: (watch: WatchDocument) => void;
  onToggle: (watch: WatchDocument) => Promise<void> | void;
  onDelete: (watch: WatchDocument) => Promise<void> | void;
};

type WatchesTableRow = {
  id: string;
  titleLabel: string;
  url: string;
  lastPriceLabel: string;
  lastCheckedLabel: string;
  scheduleLabel: string;
  enabled: boolean;
  enabledLabel: string;
  status: string;
  statusLabel: string;
  watch: WatchDocument;
};

type WatchRowMoreMenuProps = {
  row: WatchesTableRow;
  onEdit: (watch: WatchDocument) => void;
  onToggle: (watch: WatchDocument) => Promise<void> | void;
  onRequestDelete: (watch: WatchDocument) => void;
  onClose?: () => void;
  className?: string;
};

function truncateUrl(url: string, maxLength = 48): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength - 1)}…`;
}

function WatchRowMoreMenu({
  row,
  onEdit,
  onToggle,
  onRequestDelete,
  onClose,
  className,
}: WatchRowMoreMenuProps) {
  const items = [
    { label: 'Edit', value: 'edit', icon: 'edit' as const },
    row.enabled
      ? { label: 'Disable', value: 'disable', icon: 'cancel' as const }
      : { label: 'Enable', value: 'enable', icon: 'check_circle' as const },
    { label: 'Delete', value: 'delete', icon: 'delete' as const },
  ];

  return (
    <MenuList
      className={className}
      direction="vertical"
      size="small"
      items={items}
      onMenuClick={(item) => {
        if (item.value === 'edit') {
          onEdit(row.watch);
        } else if (item.value === 'disable' || item.value === 'enable') {
          void onToggle(row.watch);
        } else if (item.value === 'delete') {
          onRequestDelete(row.watch);
        }
        onClose?.();
      }}
    />
  );
}

export function WatchesTable({
  watches,
  statusByWatch,
  runningWatchId,
  onCheckNow,
  onSelect,
  onEdit,
  onToggle,
  onDelete,
}: WatchesTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<WatchDocument | null>(null);

  const rows = useMemo<WatchesTableRow[]>(
    () =>
      watches.map((watch) => {
        const status = statusByWatch[watch.id] ?? 'unknown';
        return {
          id: watch.id,
          titleLabel: watch.title ?? 'Untitled watch',
          url: watch.url,
          lastPriceLabel:
            watch.lastPrice != null
              ? `${watch.lastCurrency ?? ''} ${watch.lastPrice}`.trim()
              : '—',
          lastCheckedLabel: watch.lastCheckedAt
            ? humanizeTimestamp(watch.lastCheckedAt)
            : 'Never',
          scheduleLabel: humanizeCron(watch.schedule),
          enabled: watch.enabled,
          enabledLabel: watch.enabled ? 'Enabled' : 'Disabled',
          status,
          statusLabel: watchStatusLabel(status),
          watch,
        };
      }),
    [watches, statusByWatch],
  );

  const renderActions = (row: WatchesTableRow) => (
    <Container
      className={styles.actions}
      padding="0"
      display="flex"
      align="center"
      gap="2"
    >
      <Button
        variant="solid"
        size="small"
        onClick={() => void onCheckNow(row.watch)}
        isDisabled={runningWatchId === row.id}
        isLoading={runningWatchId === row.id}
      >
        Check now
      </Button>
      <Dropdown
        placement="bottom-end"
        offset={8}
        trigger={
          <Button
            variant="icon"
            size="small"
            aria-label={`More actions for ${row.titleLabel}`}
          >
            <Icon name="more_vert" />
          </Button>
        }
        content={
          <WatchRowMoreMenu
            row={row}
            onEdit={onEdit}
            onToggle={onToggle}
            onRequestDelete={setDeleteTarget}
          />
        }
      />
    </Container>
  );

  return (
    <>
      <Table
        columns={[
          { id: 'titleLabel', title: 'Title', widthPercentage: '14%' },
          {
            id: 'url',
            title: 'URL',
            widthPercentage: '22%',
            customRender: (raw) => {
              const row = raw as WatchesTableRow;
              return (
                <span className={styles['url-cell']} title={row.url}>
                  {truncateUrl(row.url)}
                </span>
              );
            },
          },
          { id: 'lastPriceLabel', title: 'Last price', widthPercentage: '10%' },
          { id: 'lastCheckedLabel', title: 'Last checked', widthPercentage: '12%' },
          { id: 'scheduleLabel', title: 'Schedule', widthPercentage: '14%' },
          {
            id: 'enabled',
            title: 'Enabled',
            customRender: (raw) => {
              const row = raw as WatchesTableRow;
              return (
                <Badge
                  label={row.enabledLabel}
                  variant={row.enabled ? 'success' : 'warning'}
                />
              );
            },
          },
          {
            id: 'status',
            title: 'Last status',
            customRender: (raw) => {
              const row = raw as WatchesTableRow;
              return (
                <Badge
                  label={row.statusLabel}
                  variant={watchStatusVariant(row.status)}
                />
              );
            },
          },
          {
            id: 'actions',
            title: 'Actions',
            textAlign: 'right',
            widthPercentage: '14%',
            customRender: (raw) => renderActions(raw as WatchesTableRow),
          },
        ]}
        data={rows}
        onRowClick={(raw) => onSelect((raw as WatchesTableRow).watch)}
        mobileColumns={{
          title: 'titleLabel',
          subtitle: (raw) => truncateUrl((raw as WatchesTableRow).url, 40),
          mediaAvatar: 'titleLabel',
          meta: (raw) => {
            const row = raw as WatchesTableRow;
            return (
              <Badge
                label={row.statusLabel}
                variant={watchStatusVariant(row.status)}
              />
            );
          },
          description: (raw) => {
            const row = raw as WatchesTableRow;
            return `${row.lastPriceLabel} · ${row.lastCheckedLabel} · ${row.scheduleLabel}`;
          },
          action: (raw) => renderActions(raw as WatchesTableRow),
        }}
      />
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete watch?"
        description={
          deleteTarget
            ? `Delete watch "${deleteTarget.title ?? deleteTarget.id}"? This cannot be undone.`
            : ''
        }
        primaryButtonLabel="Delete"
        secondaryButtonLabel="Cancel"
        variant="destructive"
        onClose={() => setDeleteTarget(null)}
        onPrimaryButtonClick={() => {
          if (deleteTarget) {
            void onDelete(deleteTarget);
          }
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
