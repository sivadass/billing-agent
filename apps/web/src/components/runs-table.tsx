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
import { useState } from 'react';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { RunDocument } from '../lib/types';
import styles from './runs-table.module.scss';

type RunsTableProps = {
  runs: RunDocument[];
  onSelectRun: (run: RunDocument) => void;
  onDelete: (run: RunDocument) => Promise<void> | void;
};

type RunsTableRow = {
  id: string;
  jobId: string;
  provider: string;
  status: RunDocument['status'];
  statusLabel: string;
  startedAtLabel: string;
  durationLabel: string;
  timingLabel: string;
  run: RunDocument;
};

function statusVariant(status: RunDocument['status']): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'running') return 'warning';
  return 'error';
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return '—';
  return `${Math.round(durationMs / 1000)}s`;
}

type RunRowMoreMenuProps = {
  row: RunsTableRow;
  onRequestDelete: (run: RunDocument) => void;
  onClose?: () => void;
  className?: string;
};

function RunRowMoreMenu({
  row,
  onRequestDelete,
  onClose,
  className,
}: RunRowMoreMenuProps) {
  const items = [
    { label: 'Delete', value: 'delete', icon: 'delete' as const },
  ];

  return (
    <MenuList
      className={className}
      direction="vertical"
      size="small"
      items={items}
      onMenuClick={(item) => {
        if (item.value === 'delete') {
          onRequestDelete(row.run);
        }
        onClose?.();
      }}
    />
  );
}

export function RunsTable({ runs, onSelectRun, onDelete }: RunsTableProps) {
  const [deleteTarget, setDeleteTarget] = useState<RunDocument | null>(null);

  const rows: RunsTableRow[] = runs.map((run) => {
    const startedAtLabel = humanizeTimestamp(run.startedAt);
    const durationLabel = formatDuration(run.durationMs);
    return {
      id: run.id,
      jobId: run.jobId,
      provider: run.provider,
      status: run.status,
      statusLabel: run.status,
      startedAtLabel,
      durationLabel,
      timingLabel: `${startedAtLabel} · ${durationLabel}`,
      run,
    };
  });

  const renderActions = (row: RunsTableRow) => (
    <Container
      className={styles.actions}
      padding="0"
      display="flex"
      align="center"
      gap="2"
      onClick={(event) => event.stopPropagation()}
    >
      <Dropdown
        placement="bottom-end"
        offset={8}
        trigger={
          <Button
            variant="icon"
            size="small"
            aria-label={`More actions for run ${row.id}`}
          >
            <Icon name="more_vert" />
          </Button>
        }
        content={
          <RunRowMoreMenu row={row} onRequestDelete={setDeleteTarget} />
        }
      />
    </Container>
  );

  return (
    <>
      <Table
        columns={[
          { id: 'id', title: 'Run id' },
          { id: 'jobId', title: 'Job' },
          { id: 'provider', title: 'Provider' },
          {
            id: 'status',
            title: 'Status',
            customRender: (raw) => {
              const row = raw as RunsTableRow;
              return (
                <Badge
                  label={row.statusLabel}
                  variant={statusVariant(row.status)}
                />
              );
            },
          },
          {
            id: 'startedAtLabel',
            title: 'Started',
            customRender: (raw) => {
              const row = raw as RunsTableRow;
              return (
                <span title={new Date(row.run.startedAt).toLocaleString()}>
                  {row.startedAtLabel}
                </span>
              );
            },
          },
          { id: 'durationLabel', title: 'Duration' },
          {
            id: 'actions',
            title: 'Actions',
            customRender: (raw) => renderActions(raw as RunsTableRow),
          },
        ]}
        data={rows}
        onRowClick={(raw) => onSelectRun((raw as RunsTableRow).run)}
        mobileColumns={{
          title: 'id',
          subtitle: (raw) => {
            const row = raw as RunsTableRow;
            return `${row.jobId} · ${row.provider}`;
          },
          meta: (raw) => {
            const row = raw as RunsTableRow;
            return (
              <Badge
                label={row.statusLabel}
                variant={statusVariant(row.status)}
              />
            );
          },
          description: (raw) => (raw as RunsTableRow).timingLabel,
          action: (raw) => renderActions(raw as RunsTableRow),
        }}
      />
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete run?"
        description={
          deleteTarget
            ? `Delete run "${deleteTarget.id}"? This cannot be undone.`
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
