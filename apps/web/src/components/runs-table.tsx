import { Badge, Table } from 'cleanplate';
import type { RunDocument } from '../lib/types';

type RunsTableProps = {
  runs: RunDocument[];
  onSelectRun: (run: RunDocument) => void;
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

export function RunsTable({ runs, onSelectRun }: RunsTableProps) {
  const rows: RunsTableRow[] = runs.map((run) => {
    const startedAtLabel = new Date(run.startedAt).toLocaleString();
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

  return (
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
        { id: 'startedAtLabel', title: 'Started' },
        { id: 'durationLabel', title: 'Duration' },
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
      }}
    />
  );
}
