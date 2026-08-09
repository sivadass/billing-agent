import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Container, Spinner, Typography } from 'cleanplate';
import { ApiClientError, apiFetch } from '../lib/api-client';
import { getApiBaseUrl, getApiToken } from '../lib/auth-token';
import styles from './status-page.module.scss';

type ProbeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail?: string }
  | { status: 'error'; message: string };

export function StatusPage() {
  const [health, setHealth] = useState<ProbeState>({ status: 'idle' });
  const [auth, setAuth] = useState<ProbeState>({ status: 'idle' });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const baseUrl = getApiBaseUrl();
  const token = getApiToken();

  const runProbes = useCallback(async () => {
    if (!token) return;

    setHealth({ status: 'loading' });
    setAuth({ status: 'loading' });

    try {
      const healthResponse = await apiFetch('/health');
      if (!healthResponse.ok) {
        setHealth({ status: 'error', message: `Health failed (${healthResponse.status})` });
      } else {
        setHealth({ status: 'ok', detail: 'ok' });
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Cannot reach API';
      setHealth({ status: 'error', message });
      setAuth({ status: 'error', message: 'Skipped after health failure' });
      setCheckedAt(new Date().toISOString());
      return;
    }

    try {
      const jobsResponse = await apiFetch('/jobs');
      if (jobsResponse.status === 401 || jobsResponse.status === 403) {
        setAuth({ status: 'error', message: 'Auth failed' });
      } else if (!jobsResponse.ok) {
        setAuth({ status: 'error', message: `Jobs probe failed (${jobsResponse.status})` });
      } else {
        setAuth({ status: 'ok', detail: 'authorized' });
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Cannot reach API';
      setAuth({ status: 'error', message });
    }

    setCheckedAt(new Date().toISOString());
  }, [token]);

  useEffect(() => {
    void runProbes();
  }, [runProbes]);

  if (!token) {
    return (
      <Alert
        variant="info"
        margin="b-3"
        message="Enter an API token to run connectivity checks."
      />
    );
  }

  return (
    <Container className={styles['status-page']} padding="0">
      <Typography variant="h2" margin="b-2">
        API status
      </Typography>
      <Typography variant="p" margin="b-3">
        Base URL: {baseUrl}
      </Typography>

      <Container display="flex" gap="2" margin="b-3" align="center">
        <Typography variant="span">Health</Typography>
        {health.status === 'loading' ? <Spinner size="small" /> : null}
        {health.status === 'ok' ? <Badge label="OK" variant="success" /> : null}
        {health.status === 'error' ? <Badge label="Fail" variant="error" /> : null}
      </Container>
      {health.status === 'error' ? (
        <Alert variant="error" margin="b-3" message={health.message} />
      ) : null}

      <Container display="flex" gap="2" margin="b-3" align="center">
        <Typography variant="span">Auth</Typography>
        {auth.status === 'loading' ? <Spinner size="small" /> : null}
        {auth.status === 'ok' ? <Badge label="OK" variant="success" /> : null}
        {auth.status === 'error' ? <Badge label="Fail" variant="error" /> : null}
      </Container>
      {auth.status === 'error' ? (
        <Alert variant="error" margin="b-3" message={auth.message} />
      ) : null}

      {checkedAt ? (
        <Typography variant="small" margin="b-3">
          Last checked: {checkedAt}
        </Typography>
      ) : null}

      <Button variant="outline" onClick={() => void runProbes()}>
        Retry
      </Button>
    </Container>
  );
}
