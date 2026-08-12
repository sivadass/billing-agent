import { Alert, Badge, Button, Container, PageHeader, Table } from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/loader';
import { ApiClientError } from '../lib/api-client';
import { humanizeCron } from '../lib/cron-humanize';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import {
  deleteWatch,
  listWatchChecks,
  listWatches,
  runWatchNow,
  updateWatch,
} from '../lib/watches-api';
import type { WatchDocument } from '../lib/types';
import styles from './watches-page.module.scss';

type WatchRow = {
  id: string;
  titleLabel: string;
  url: string;
  lastPriceLabel: string;
  lastCheckedLabel: string;
  scheduleLabel: string;
  enabled: boolean;
  enabledLabel: string;
  statusLabel: string;
  watch: WatchDocument;
};

export function WatchesPage() {
  const navigate = useNavigate();
  const [watches, setWatches] = useState<WatchDocument[]>([]);
  const [statusByWatch, setStatusByWatch] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningWatchId, setRunningWatchId] = useState<string | null>(null);

  const loadWatchesData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listWatches();
      setWatches(result);
      const statuses = await Promise.all(
        result.map(async (watch) => {
          try {
            const [latest] = await listWatchChecks(watch.id, { limit: 1 });
            return [watch.id, latest?.status ?? 'never'] as const;
          } catch {
            return [watch.id, 'unknown'] as const;
          }
        }),
      );
      setStatusByWatch(Object.fromEntries(statuses));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load watches',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWatchesData();
  }, [loadWatchesData]);

  const handleCheckNow = async (watch: WatchDocument) => {
    setActionError(null);
    setRunningWatchId(watch.id);
    try {
      await runWatchNow(watch.id);
      await loadWatchesData();
    } catch (runError) {
      setActionError(
        runError instanceof ApiClientError ? runError.message : 'Failed to start check',
      );
    } finally {
      setRunningWatchId(null);
    }
  };

  const handleToggle = async (watch: WatchDocument) => {
    setActionError(null);
    try {
      await updateWatch(watch.id, { enabled: !watch.enabled });
      await loadWatchesData();
    } catch (toggleError) {
      setActionError(
        toggleError instanceof ApiClientError ? toggleError.message : 'Failed to update watch',
      );
    }
  };

  const handleDelete = async (watch: WatchDocument) => {
    setActionError(null);
    try {
      await deleteWatch(watch.id);
      await loadWatchesData();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof ApiClientError ? deleteError.message : 'Failed to delete watch',
      );
    }
  };

  const rows: WatchRow[] = watches.map((watch) => ({
    id: watch.id,
    titleLabel: watch.title ?? 'Untitled watch',
    url: watch.url,
    lastPriceLabel:
      watch.lastPrice != null
        ? `${watch.lastCurrency ?? ''} ${watch.lastPrice}`.trim()
        : '—',
    lastCheckedLabel: watch.lastCheckedAt ? humanizeTimestamp(watch.lastCheckedAt) : 'Never',
    scheduleLabel: humanizeCron(watch.schedule),
    enabled: watch.enabled,
    enabledLabel: watch.enabled ? 'Enabled' : 'Disabled',
    statusLabel: statusByWatch[watch.id] ?? 'unknown',
    watch,
  }));

  return (
    <>
      <PageHeader
        title="Price watches"
        subtitle="Track product prices and trigger manual checks."
        primaryCta={
          <Button variant="solid" onClick={() => navigate('/watches/new')}>
            New watch
          </Button>
        }
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {actionError ? <Alert variant="error" margin="t-3" message={actionError} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}
      {!isLoading && !error ? (
        <Table
          columns={[
            { id: 'titleLabel', title: 'Title' },
            { id: 'url', title: 'URL' },
            { id: 'lastPriceLabel', title: 'Last price' },
            { id: 'lastCheckedLabel', title: 'Last checked' },
            { id: 'scheduleLabel', title: 'Schedule' },
            {
              id: 'enabled',
              title: 'Enabled',
              customRender: (raw) => {
                const row = raw as WatchRow;
                return (
                  <Badge
                    label={row.enabledLabel}
                    variant={row.enabled ? 'success' : 'warning'}
                  />
                );
              },
            },
            { id: 'statusLabel', title: 'Last status' },
            {
              id: 'actions',
              title: 'Actions',
              customRender: (raw) => {
                const row = raw as WatchRow;
                return (
                  <Container display="flex" gap="2" padding="0" margin="0">
                    <Button
                      variant="solid"
                      size="small"
                      onClick={() => void handleCheckNow(row.watch)}
                      isLoading={runningWatchId === row.id}
                      isDisabled={runningWatchId === row.id}
                    >
                      Check now
                    </Button>
                    <Button
                      variant="outline"
                      size="small"
                      onClick={() => navigate(`/watches/${row.id}`)}
                    >
                      View
                    </Button>
                    <Button
                      variant="outline"
                      size="small"
                      onClick={() => navigate(`/watches/${row.id}/edit`)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="small"
                      onClick={() => void handleToggle(row.watch)}
                    >
                      {row.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="outline"
                      size="small"
                      onClick={() => void handleDelete(row.watch)}
                    >
                      Delete
                    </Button>
                  </Container>
                );
              },
            },
          ]}
          data={rows}
          mobileColumns={{
            title: 'titleLabel',
            subtitle: (raw) => (raw as WatchRow).url,
            meta: (raw) => {
              const row = raw as WatchRow;
              return <Badge label={row.enabledLabel} variant={row.enabled ? 'success' : 'warning'} />;
            },
            description: (raw) => {
              const row = raw as WatchRow;
              return `${row.lastPriceLabel} · ${row.lastCheckedLabel}`;
            },
          }}
        />
      ) : null}
    </>
  );
}
