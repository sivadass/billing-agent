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
  Statistic,
  Typography,
} from 'cleanplate';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRun } from '../lib/runs-api';
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
};

function DetailField({ label, value, mono = false }: DetailFieldProps) {
  return (
    <div className={styles['detail-field']}>
      <Typography variant="small" className={styles['detail-label']}>
        {label}
      </Typography>
      <Typography
        variant="p"
        margin="0"
        className={mono ? styles['detail-value-mono'] : styles['detail-value']}
      >
        {value}
      </Typography>
    </div>
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
        margin="b-3"
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

      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}

      {isLoading && !run ? (
        <Container display="flex" justify="center" padding="6" margin="t-4">
          <Spinner />
        </Container>
      ) : null}

      {!isLoading && !run && !error ? (
        <FeedbackState
          variant="empty"
          margin="t-4"
          title="Run not found"
          description="This run id is missing or no longer available."
          primaryAction={{ label: 'Back to runs', onClick: () => navigate('/runs') }}
        />
      ) : null}

      {run ? (
        <>
          <Container
            className={styles['status-banner']}
            display="flex"
            align="center"
            justify="space-between"
            gap="3"
            padding="4"
            margin="t-4"
            showBorder
          >
            <Container display="flex" align="center" gap="3" padding="0" margin="0">
              <Icon name={statusIcon(run.status)} size="large" />
              <div>
                <Typography variant="small" margin="b-1" className={styles['detail-label']}>
                  Status
                </Typography>
                <Container display="flex" align="center" gap="2" padding="0" margin="0">
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

          <Container
            className={styles['metrics-row']}
            display="flex"
            gap="3"
            margin="t-3"
            padding="0"
          >
            <Container className={styles['metric']} padding="4" showBorder>
              <Statistic title="Duration" value={formatDuration(run.durationMs)} size="large" />
            </Container>
            <Container className={styles['metric']} padding="4" showBorder>
              <Statistic title="Job" value={run.jobId} size="large" />
            </Container>
            <Container className={styles['metric']} padding="4" showBorder>
              <Statistic title="Provider" value={run.provider} size="large" />
            </Container>
            <Container className={styles['metric']} padding="4" showBorder>
              <Statistic
                title="Started"
                value={new Date(run.startedAt).toLocaleString()}
                size="medium"
              />
            </Container>
          </Container>

          {run.status === 'failed' || run.errorCode || run.errorMessage ? (
            <Container className={styles['section']} padding="4" margin="t-3" showBorder>
              <Typography variant="h3" margin="b-3">
                Error
              </Typography>
              <Alert
                variant="error"
                message={run.errorMessage ?? run.errorCode ?? 'Run failed'}
                margin="b-3"
              />
              <div className={styles['fields-grid']}>
                <DetailField label="Error code" value={run.errorCode ?? '—'} mono />
                <DetailField label="Error message" value={run.errorMessage ?? '—'} />
                <DetailField label="Screenshot path" value={run.screenshotPath ?? '—'} mono />
              </div>
            </Container>
          ) : null}

          <Container className={styles['section']} padding="4" margin="t-3" showBorder>
            <Typography variant="h3" margin="b-3">
              Bill summary
            </Typography>
            {billEntries.length > 0 ? (
              <div className={styles['bill-grid']}>
                {billEntries.map(([key, value]) => (
                  <div key={key} className={styles['bill-item']}>
                    <Typography variant="small" className={styles['detail-label']}>
                      {key}
                    </Typography>
                    <Typography variant="h4" margin="0" className={styles['bill-value']}>
                      {value}
                    </Typography>
                  </div>
                ))}
              </div>
            ) : (
              <Typography variant="p" className={styles['muted']}>
                No bill summary for this run.
              </Typography>
            )}
          </Container>

          <Container className={styles['section']} padding="4" margin="t-3" showBorder>
            <Typography variant="h3" margin="b-3">
              Diagnostics
            </Typography>
            <div className={styles['fields-grid']}>
              <DetailField label="Recovery attempted" value={yesNo(run.recoveryAttempted)} />
              <DetailField label="Recovery succeeded" value={yesNo(run.recoverySucceeded)} />
              <DetailField label="Overlay activated" value={yesNo(run.overlayActivated)} />
              <DetailField label="Screenshot path" value={run.screenshotPath ?? '—'} mono />
              <DetailField label="Finished" value={run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'} />
              <DetailField label="Run id" value={run.id} mono />
            </div>
          </Container>
        </>
      ) : null}
    </div>
  );
}
