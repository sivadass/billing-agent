import { Badge, Button, ConfirmDialog, Container, Table } from 'cleanplate';
import { useMemo, useState } from 'react';
import { humanizeCron } from '../lib/cron-humanize';
import type { JobDocument } from '../lib/types';
import styles from './jobs-table.module.scss';

type JobsTableProps = {
  jobs: JobDocument[];
  runningJobId?: string | null;
  onRun: (job: JobDocument) => Promise<void> | void;
  onEdit: (job: JobDocument) => void;
  onDisable: (job: JobDocument) => Promise<void> | void;
  onEnable: (job: JobDocument) => Promise<void> | void;
};

type JobsTableRow = {
  id: string;
  provider: string;
  enabled: boolean;
  enabledLabel: string;
  scheduleLabel: string;
  notifyTitle: string;
  job: JobDocument;
};

export function JobsTable({
  jobs,
  runningJobId,
  onRun,
  onEdit,
  onDisable,
  onEnable,
}: JobsTableProps) {
  const [disableTarget, setDisableTarget] = useState<JobDocument | null>(null);

  const rows = useMemo<JobsTableRow[]>(
    () =>
      jobs.map((job) => ({
        id: job.id,
        provider: job.provider,
        enabled: job.enabled,
        enabledLabel: job.enabled ? 'Enabled' : 'Disabled',
        scheduleLabel: humanizeCron(job.schedule),
        notifyTitle: job.notify.title,
        job,
      })),
    [jobs],
  );

  const renderActions = (row: JobsTableRow) => (
    <Container className={styles.actions} padding="0">
      <Button
        variant="outline"
        onClick={() => void onRun(row.job)}
        isDisabled={!row.enabled || runningJobId === row.id}
      >
        Run
      </Button>
      <Button variant="outline" onClick={() => onEdit(row.job)}>
        Edit
      </Button>
      {row.enabled ? (
        <Button variant="outline" onClick={() => setDisableTarget(row.job)}>
          Disable
        </Button>
      ) : (
        <Button variant="outline" onClick={() => void onEnable(row.job)}>
          Enable
        </Button>
      )}
    </Container>
  );

  return (
    <>
      <Table
        columns={[
          { id: 'id', title: 'ID' },
          { id: 'provider', title: 'Provider' },
          {
            id: 'enabled',
            title: 'Enabled',
            customRender: (raw) => {
              const row = raw as JobsTableRow;
              return (
                <Badge
                  label={row.enabledLabel}
                  variant={row.enabled ? 'success' : 'warning'}
                />
              );
            },
          },
          { id: 'scheduleLabel', title: 'Schedule' },
          { id: 'notifyTitle', title: 'Notify title' },
          {
            id: 'actions',
            title: 'Actions',
            customRender: (raw) => renderActions(raw as JobsTableRow),
          },
        ]}
        data={rows}
        mobileColumns={{
          title: 'id',
          subtitle: (raw) => {
            const row = raw as JobsTableRow;
            return `${row.provider} · ${row.scheduleLabel}`;
          },
          meta: (raw) => {
            const row = raw as JobsTableRow;
            return (
              <Badge
                label={row.enabledLabel}
                variant={row.enabled ? 'success' : 'warning'}
              />
            );
          },
          description: 'notifyTitle',
          action: (raw) => renderActions(raw as JobsTableRow),
        }}
      />
      <ConfirmDialog
        isOpen={Boolean(disableTarget)}
        title="Disable job?"
        description={
          disableTarget
            ? `Disable job "${disableTarget.id}"? Disabled jobs stay visible and can be re-enabled.`
            : ''
        }
        primaryButtonLabel="Disable"
        secondaryButtonLabel="Cancel"
        variant="warning"
        onClose={() => setDisableTarget(null)}
        onPrimaryButtonClick={() => {
          if (disableTarget) {
            void onDisable(disableTarget);
          }
          setDisableTarget(null);
        }}
      />
    </>
  );
}
