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
import { engineLabel } from '../lib/engine-label';
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
  engine: string;
  enabled: boolean;
  enabledLabel: string;
  scheduleLabel: string;
  notifyTitle: string;
  job: JobDocument;
};

type JobRowMoreMenuProps = {
  row: JobsTableRow;
  onEdit: (job: JobDocument) => void;
  onEnable: (job: JobDocument) => Promise<void> | void;
  onRequestDisable: (job: JobDocument) => void;
  onClose?: () => void;
  className?: string;
};

function JobRowMoreMenu({
  row,
  onEdit,
  onEnable,
  onRequestDisable,
  onClose,
  className,
}: JobRowMoreMenuProps) {
  const items = [
    { label: 'Edit', value: 'edit', icon: 'edit' as const },
    row.enabled
      ? { label: 'Disable', value: 'disable', icon: 'cancel' as const }
      : { label: 'Enable', value: 'enable', icon: 'check_circle' as const },
  ];

  return (
    <MenuList
      className={className}
      direction="vertical"
      size="small"
      items={items}
      onMenuClick={(item) => {
        if (item.value === 'edit') {
          onEdit(row.job);
        } else if (item.value === 'disable') {
          onRequestDisable(row.job);
        } else if (item.value === 'enable') {
          void onEnable(row.job);
        }
        onClose?.();
      }}
    />
  );
}

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
        engine: engineLabel(job),
        enabled: job.enabled,
        enabledLabel: job.enabled ? 'Enabled' : 'Disabled',
        scheduleLabel: humanizeCron(job.schedule),
        notifyTitle: job.notify.title,
        job,
      })),
    [jobs],
  );

  const renderActions = (row: JobsTableRow) => (
    <Container className={styles.actions} padding="0" display="flex" align="center" gap="2">
      <Button
        variant="solid"
        size="small"
        onClick={() => void onRun(row.job)}
        isDisabled={!row.enabled || runningJobId === row.id}
        isLoading={runningJobId === row.id}
      >
        Run
      </Button>
      <Dropdown
        placement="bottom-end"
        offset={8}
        trigger={
          <Button
            variant="icon"
            size="small"
            aria-label={`More actions for ${row.id}`}
          >
            <Icon name="more_vert" />
          </Button>
        }
        content={
          <JobRowMoreMenu
            row={row}
            onEdit={onEdit}
            onEnable={onEnable}
            onRequestDisable={setDisableTarget}
          />
        }
      />
    </Container>
  );

  return (
    <>
      <Table
        columns={[
          { id: 'id', title: 'ID' },
          { id: 'engine', title: 'Engine' },
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
          mediaAvatar: 'id',
          subtitle: (raw) => {
            const row = raw as JobsTableRow;
            return `${row.engine} · ${row.scheduleLabel}`;
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
