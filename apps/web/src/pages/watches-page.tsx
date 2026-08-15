import { Alert, Button, PageHeader } from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/loader';
import { WatchesTable } from '../components/watches-table';
import { ApiClientError } from '../lib/api-client';
import {
  deleteWatch,
  listWatchChecks,
  listWatches,
  runWatchNow,
  updateWatch,
} from '../lib/watches-api';
import type { WatchDocument } from '../lib/types';
import styles from './watches-page.module.scss';

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
        <WatchesTable
          watches={watches}
          statusByWatch={statusByWatch}
          runningWatchId={runningWatchId}
          onCheckNow={handleCheckNow}
          onSelect={(watch) => navigate(`/watches/${watch.id}`)}
          onEdit={(watch) => navigate(`/watches/${watch.id}/edit`)}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      ) : null}
    </>
  );
}
