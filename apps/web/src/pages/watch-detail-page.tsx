import { Alert, Badge, Button, Container, PageHeader, Table, Typography } from 'cleanplate';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader } from '../components/loader';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { PriceCheckDocument, WatchDocument } from '../lib/types';
import { getWatch, listWatchChecks, runWatchNow } from '../lib/watches-api';
import styles from './watch-detail-page.module.scss';

type CheckRow = {
  id: string;
  status: PriceCheckDocument['status'];
  statusLabel: string;
  checkedAtLabel: string;
  priceLabel: string;
  sourceLabel: string;
  errorLabel: string;
};

function statusVariant(status: PriceCheckDocument['status']): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'running') return 'warning';
  return 'error';
}

export function WatchDetailPage() {
  const navigate = useNavigate();
  const { watchId } = useParams<{ watchId: string }>();
  const [watch, setWatch] = useState<WatchDocument | null>(null);
  const [checks, setChecks] = useState<PriceCheckDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingNow, setIsCheckingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!watchId) return;
    setError(null);
    try {
      const [nextWatch, nextChecks] = await Promise.all([
        getWatch(watchId),
        listWatchChecks(watchId, { limit: 50 }),
      ]);
      setWatch(nextWatch);
      setChecks(nextChecks);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load watch');
    } finally {
      setIsLoading(false);
    }
  }, [watchId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  const checkRows: CheckRow[] = useMemo(
    () =>
      checks.map((check) => ({
        id: check.id,
        status: check.status,
        statusLabel: check.status,
        checkedAtLabel: humanizeTimestamp(check.checkedAt),
        priceLabel:
          check.price != null
            ? `${check.currency ?? ''} ${check.price}`.trim()
            : '—',
        sourceLabel: check.source ?? '—',
        errorLabel: check.error ?? '—',
      })),
    [checks],
  );

  const handleCheckNow = async () => {
    if (!watchId) return;
    setActionMessage(null);
    setIsCheckingNow(true);
    try {
      const result = await runWatchNow(watchId);
      setActionMessage(`Check started: ${result.id}`);
      await load();
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : 'Failed to trigger check',
      );
    } finally {
      setIsCheckingNow(false);
    }
  };

  return (
    <>
      <PageHeader
        title={watch ? watch.title ?? watch.id : 'Watch detail'}
        subtitle={watch?.url ?? 'Price check history and manual run actions.'}
        primaryCta={
          <Container display="flex" gap="2" padding="0" margin="0">
            <Button variant="outline" onClick={() => navigate('/watches')}>
              Back to watches
            </Button>
            {watch ? (
              <Button variant="outline" onClick={() => navigate(`/watches/${watch.id}/edit`)}>
                Edit watch
              </Button>
            ) : null}
            <Button variant="solid" isLoading={isCheckingNow} onClick={() => void handleCheckNow()}>
              Check now
            </Button>
          </Container>
        }
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {actionMessage ? <Alert variant="success" margin="t-3" message={actionMessage} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}
      {!isLoading && watch ? (
        <>
          <div className={styles['meta-grid']}>
            <div className={styles['meta-card']}>
              <Typography variant="small" className={styles['meta-label']}>
                Last price
              </Typography>
              <Typography variant="h4" margin="0">
                {watch.lastPrice != null
                  ? `${watch.lastCurrency ?? ''} ${watch.lastPrice}`.trim()
                  : '—'}
              </Typography>
            </div>
            <div className={styles['meta-card']}>
              <Typography variant="small" className={styles['meta-label']}>
                Last checked
              </Typography>
              <Typography variant="h4" margin="0">
                {watch.lastCheckedAt ? humanizeTimestamp(watch.lastCheckedAt) : 'Never'}
              </Typography>
            </div>
            <div className={styles['meta-card']}>
              <Typography variant="small" className={styles['meta-label']}>
                Enabled
              </Typography>
              <Badge
                label={watch.enabled ? 'Enabled' : 'Disabled'}
                variant={watch.enabled ? 'success' : 'warning'}
              />
            </div>
          </div>
          <Table
            columns={[
              { id: 'id', title: 'Check id' },
              {
                id: 'status',
                title: 'Status',
                customRender: (raw) => {
                  const row = raw as CheckRow;
                  return <Badge label={row.statusLabel} variant={statusVariant(row.status)} />;
                },
              },
              { id: 'checkedAtLabel', title: 'Checked' },
              { id: 'priceLabel', title: 'Price' },
              { id: 'sourceLabel', title: 'Source' },
              { id: 'errorLabel', title: 'Error' },
            ]}
            data={checkRows}
            mobileColumns={{
              title: 'statusLabel',
              subtitle: (raw) => (raw as CheckRow).checkedAtLabel,
              description: (raw) => (raw as CheckRow).priceLabel,
            }}
          />
        </>
      ) : null}
    </>
  );
}
