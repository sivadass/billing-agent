import { Alert, Badge, Button, Container, PageHeader, Spinner, Typography } from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRun } from '../lib/runs-api';
import type { RunDocument } from '../lib/types';

function statusVariant(status: RunDocument['status']): 'success' | 'warning' | 'error' {
  if (status === 'success') return 'success';
  if (status === 'running') return 'warning';
  return 'error';
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return '—';
  return `${Math.round(durationMs / 1000)}s`;
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

  return (
    <>
      <PageHeader
        title={`Run ${runId ?? ''}`}
        subtitle="Live run state and billing details."
      />
      <Container display="flex" gap="2" margin="t-3">
        <Button variant="outline" onClick={() => navigate('/runs')}>
          Back to runs
        </Button>
        {run ? (
          <Button variant="outline" onClick={() => navigate(`/jobs/${run.jobId}`)}>
            Open job
          </Button>
        ) : null}
      </Container>
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? <Spinner margin="t-3" /> : null}
      {run ? (
        <Container padding="0" margin="t-3">
          <Container display="flex" gap="2" align="center" margin="b-2" padding="0">
            <Typography variant="p">Status: {run.status}</Typography>
            <Badge label={run.status} variant={statusVariant(run.status)} />
          </Container>
          <Typography variant="p" margin="b-2">
            Job: {run.jobId}
          </Typography>
          <Typography variant="p" margin="b-2">
            Provider: {run.provider}
          </Typography>
          <Typography variant="p" margin="b-2">
            Started: {new Date(run.startedAt).toLocaleString()}
          </Typography>
          <Typography variant="p" margin="b-2">
            Duration: {formatDuration(run.durationMs)}
          </Typography>
          <Typography variant="p" margin="b-2">
            Error code: {run.errorCode ?? '—'}
          </Typography>
          <Typography variant="p" margin="b-2">
            Error message: {run.errorMessage ?? '—'}
          </Typography>
          <Typography variant="p" margin="b-2">
            Screenshot path: {run.screenshotPath ?? '—'}
          </Typography>
          <Typography variant="p" margin="b-2">
            Recovery attempted: {run.recoveryAttempted ? 'yes' : 'no'}
          </Typography>
          <Typography variant="p" margin="b-2">
            Recovery succeeded: {run.recoverySucceeded ? 'yes' : 'no'}
          </Typography>
          <Typography variant="p" margin="b-2">
            Overlay activated: {run.overlayActivated ? 'yes' : 'no'}
          </Typography>
          <Typography variant="h3" margin="t-4">
            Bill summary
          </Typography>
          {run.billSummary ? (
            Object.entries(run.billSummary).map(([key, value]) => (
              <Typography key={key} variant="p" margin="b-2">
                {key}: {value}
              </Typography>
            ))
          ) : (
            <Typography variant="p" margin="b-2">
              —
            </Typography>
          )}
        </Container>
      ) : null}
    </>
  );
}
