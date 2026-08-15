import {
  Alert,
  Badge,
  BreadCrumb,
  Button,
  Container,
  FeedbackState,
  PageHeader,
  Typography,
} from 'cleanplate';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader } from '../components/loader';
import { WatchChecksTable } from '../components/watch-checks-table';
import { ApiClientError } from '../lib/api-client';
import { humanizeCron } from '../lib/cron-humanize';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import { watchStatusLabel, watchStatusVariant } from '../lib/watch-status';
import type { PriceCheckDocument, WatchDocument } from '../lib/types';
import { getWatch, listWatchChecks, runWatchNow } from '../lib/watches-api';
import styles from './watch-detail-page.module.scss';

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

type DetailFieldProps = {
  label: string;
  value: ReactNode;
  emphasize?: boolean;
};

function DetailField({ label, value, emphasize = false }: DetailFieldProps) {
  return (
    <div className={styles['detail-field']}>
      <Typography variant="small" className={styles['detail-label']}>
        {label}
      </Typography>
      <Typography
        variant={emphasize ? 'h4' : 'p'}
        margin="0"
        className={emphasize ? styles['detail-value-em'] : undefined}
      >
        {value}
      </Typography>
    </div>
  );
}

type SectionProps = {
  title: string;
  children: ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <Container className={styles.section} padding="5" margin="0" showBorder>
      <Typography variant="h4" margin="b-4" className={styles['section-title']}>
        {title}
      </Typography>
      {children}
    </Container>
  );
}

export function WatchDetailPage() {
  const navigate = useNavigate();
  const { watchId } = useParams<{ watchId: string }>();
  const [watch, setWatch] = useState<WatchDocument | null>(null);
  const [checks, setChecks] = useState<PriceCheckDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingNow, setIsCheckingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load watch',
      );
      setWatch(null);
      setChecks([]);
    } finally {
      setIsLoading(false);
    }
  }, [watchId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  const handleCheckNow = async () => {
    if (!watchId) return;
    setActionError(null);
    setActionMessage(null);
    setIsCheckingNow(true);
    try {
      const result = await runWatchNow(watchId);
      setActionMessage(`Check started: ${shortId(result.id)}`);
      await load();
    } catch (runError) {
      setActionError(
        runError instanceof ApiClientError
          ? runError.message
          : 'Failed to trigger check',
      );
    } finally {
      setIsCheckingNow(false);
    }
  };

  const latestStatus = checks[0]?.status ?? 'never';

  return (
    <div className={styles['watch-detail']}>
      <BreadCrumb
        margin="b-2"
        items={[
          { label: 'Price watches', href: '/watches' },
          { label: watch ? watch.title ?? shortId(watch.id) : 'Detail' },
        ]}
      />

      <PageHeader
        title={watch ? watch.title ?? watch.id : 'Watch detail'}
        subtitle={
          watch?.url ?? 'Price check history and manual run actions.'
        }
        primaryCta={
          <Container display="flex" gap="2" padding="0" margin="0">
            <Button variant="outline" onClick={() => navigate('/watches')}>
              Back to watches
            </Button>
            {watch ? (
              <Button
                variant="outline"
                onClick={() => navigate(`/watches/${watch.id}/edit`)}
              >
                Edit watch
              </Button>
            ) : null}
            <Button
              variant="solid"
              isLoading={isCheckingNow}
              isDisabled={!watch || isCheckingNow}
              onClick={() => void handleCheckNow()}
            >
              Check now
            </Button>
          </Container>
        }
      />

      {error ? <Alert variant="error" margin="t-4" message={error} /> : null}
      {actionError ? <Alert variant="error" margin="t-4" message={actionError} /> : null}
      {actionMessage ? (
        <Alert variant="success" margin="t-4" message={actionMessage} />
      ) : null}

      {isLoading && !watch ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}

      {!isLoading && !watch && !error ? (
        <FeedbackState
          variant="empty"
          margin="t-5"
          title="Watch not found"
          description="This watch id is missing or no longer available."
          primaryAction={{
            label: 'Back to watches',
            onClick: () => navigate('/watches'),
          }}
        />
      ) : null}

      {watch ? (
        <div className={styles['content-stack']}>
          <Container className={styles['metrics-row']} display="flex" gap="3" padding="0">
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Last price"
                value={
                  watch.lastPrice != null
                    ? `${watch.lastCurrency ?? ''} ${watch.lastPrice}`.trim()
                    : '—'
                }
                emphasize
              />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Last checked"
                value={
                  watch.lastCheckedAt
                    ? humanizeTimestamp(watch.lastCheckedAt)
                    : 'Never'
                }
                emphasize
              />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Schedule"
                value={humanizeCron(watch.schedule)}
                emphasize
              />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Enabled"
                value={
                  <Badge
                    label={watch.enabled ? 'Enabled' : 'Disabled'}
                    variant={watch.enabled ? 'success' : 'warning'}
                  />
                }
              />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Last status"
                value={
                  <Badge
                    label={watchStatusLabel(latestStatus)}
                    variant={watchStatusVariant(latestStatus)}
                  />
                }
              />
            </Container>
          </Container>

          <Section title="Product URL">
            <Typography variant="p" margin="0" className={styles['url-value']}>
              <a href={watch.url} target="_blank" rel="noreferrer">
                {watch.url}
              </a>
            </Typography>
          </Section>

          <Section title="Price check history">
            {checks.length > 0 ? (
              <WatchChecksTable checks={checks} />
            ) : (
              <Typography variant="p" margin="0" className={styles.muted}>
                No price checks yet. Run a manual check to start tracking.
              </Typography>
            )}
          </Section>
        </div>
      ) : null}
    </div>
  );
}
