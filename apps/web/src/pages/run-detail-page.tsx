import {
  Alert,
  Badge,
  BreadCrumb,
  Button,
  Container,
  FeedbackState,
  Icon,
  PageHeader,
  Spinner,
  Typography,
} from 'cleanplate';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRun } from '../lib/runs-api';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import type { RunDocument } from '../lib/types';
import styles from './run-detail-page.module.scss';

function statusVariant(status: RunDocument['status']): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'running') return 'warning';
  return 'error';
}

function statusIcon(status: RunDocument['status']): 'check_circle' | 'progress_activity' | 'error' {
  if (status === 'success') return 'check_circle';
  if (status === 'running') return 'progress_activity';
  return 'error';
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return '—';
  const totalSeconds = Math.round(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

type DetailFieldProps = {
  label: string;
  value: ReactNode;
  mono?: boolean;
  emphasize?: boolean;
};

function DetailField({ label, value, mono = false, emphasize = false }: DetailFieldProps) {
  return (
    <div className={styles['detail-field']}>
      <Typography variant="small" className={styles['detail-label']}>
        {label}
      </Typography>
      <Typography
        variant={emphasize ? 'h4' : 'p'}
        margin="0"
        className={
          mono
            ? styles['detail-value-mono']
            : emphasize
              ? styles['detail-value-em']
              : styles['detail-value']
        }
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
    <Container className={styles.section} padding="5" margin="t-4" showBorder>
      <Typography variant="h4" margin="b-4" className={styles['section-title']}>
        {title}
      </Typography>
      {children}
    </Container>
  );
}

export function RunDetailPage() {
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<RunDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setError(null);
    try {
      const result = await getRun(runId);
      setRun(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load run',
      );
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    setIsLoading(true);
    void loadRun();
  }, [loadRun]);

  useEffect(() => {
    if (!runId || run?.status !== 'running') return;
    const timer = setInterval(() => {
      void loadRun();
    }, 2000);
    return () => clearInterval(timer);
  }, [loadRun, run?.status, runId]);

  const billEntries = run?.billSummary ? Object.entries(run.billSummary) : [];

  return (
    <div className={styles['run-detail']}>
      <BreadCrumb
        margin="b-2"
        items={[
          { label: 'Runs', href: '/runs' },
          { label: runId ? shortId(runId) : 'Detail' },
        ]}
      />

      <PageHeader
        title="Run detail"
        subtitle={runId ? `ID ${runId}` : 'Live run state and billing details.'}
        primaryCta={
          <Container display="flex" gap="2" padding="0" margin="0">
            <Button variant="outline" onClick={() => navigate('/runs')}>
              Back to runs
            </Button>
            {run ? (
              <Button variant="solid" onClick={() => navigate(`/jobs/${run.jobId}`)}>
                Open job
              </Button>
            ) : null}
          </Container>
        }
      />

      {error ? <Alert variant="error" margin="t-4" message={error} /> : null}

      {isLoading && !run ? (
        <Container display="flex" justify="center" padding="6" margin="t-5">
          <Spinner />
        </Container>
      ) : null}

      {!isLoading && !run && !error ? (
        <FeedbackState
          variant="empty"
          margin="t-5"
          title="Run not found"
          description="This run id is missing or no longer available."
          primaryAction={{ label: 'Back to runs', onClick: () => navigate('/runs') }}
        />
      ) : null}

      {run ? (
        <div className={styles['content-stack']}>
          <Container
            className={styles['status-banner']}
            display="flex"
            align="center"
            justify="space-between"
            gap="4"
            padding="5"
            showBorder
          >
            <Container display="flex" align="center" gap="3" padding="0" margin="0">
              <Icon name={statusIcon(run.status)} size="large" />
              <div className={styles['status-copy']}>
                <Typography variant="small" className={styles['detail-label']}>
                  Status
                </Typography>
                <Container display="flex" align="center" gap="2" padding="0" margin="t-2">
                  <Badge label={run.status} variant={statusVariant(run.status)} />
                  {run.status === 'running' ? (
                    <Typography variant="small" className={styles['polling-hint']}>
                      Auto-refreshing every 2s
                    </Typography>
                  ) : null}
                </Container>
              </div>
            </Container>
            {run.status === 'running' ? <Spinner size="small" /> : null}
          </Container>

          <Container className={styles['metrics-row']} display="flex" gap="3" padding="0">
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField label="Duration" value={formatDuration(run.durationMs)} emphasize />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField label="Job" value={run.jobId} emphasize />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField label="Provider" value={run.provider} emphasize />
            </Container>
            <Container className={styles.metric} padding="5" showBorder>
              <DetailField
                label="Started"
                value={
                  <span title={new Date(run.startedAt).toLocaleString()}>
                    {humanizeTimestamp(run.startedAt)}
                  </span>
                }
                emphasize
              />
            </Container>
          </Container>

          {run.status === 'failed' || run.errorCode || run.errorMessage ? (
            <Section title="Error">
              <Alert
                variant="error"
                message={run.errorMessage ?? run.errorCode ?? 'Run failed'}
                margin="b-4"
              />
              <div className={styles['fields-grid']}>
                <DetailField label="Error code" value={run.errorCode ?? '—'} mono />
                <DetailField label="Error message" value={run.errorMessage ?? '—'} />
                <DetailField label="Screenshot path" value={run.screenshotPath ?? '—'} mono />
              </div>
            </Section>
          ) : null}

          <Section title="Bill summary">
            {billEntries.length > 0 ? (
              <div className={styles['bill-grid']}>
                {billEntries.map(([key, value]) => (
                  <DetailField key={key} label={key} value={value} emphasize />
                ))}
              </div>
            ) : (
              <Typography variant="p" margin="0" className={styles.muted}>
                No bill summary for this run.
              </Typography>
            )}
          </Section>

          <Section title="Diagnostics">
            <div className={styles['fields-grid']}>
              <DetailField label="Recovery attempted" value={yesNo(run.recoveryAttempted)} />
              <DetailField label="Recovery succeeded" value={yesNo(run.recoverySucceeded)} />
              <DetailField label="Overlay activated" value={yesNo(run.overlayActivated)} />
              <DetailField label="Screenshot path" value={run.screenshotPath ?? '—'} mono />
              <DetailField
                label="Finished"
                value={
                  run.finishedAt ? (
                    <span title={new Date(run.finishedAt).toLocaleString()}>
                      {humanizeTimestamp(run.finishedAt)}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <DetailField label="Run id" value={run.id} mono />
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
