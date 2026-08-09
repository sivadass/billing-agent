import {
  Alert,
  Badge,
  Button,
  Container,
  Icon,
  PageHeader,
  Typography,
} from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { Loader } from '../components/loader';
import { ApiClientError, apiFetch } from '../lib/api-client';
import { getAccessToken, getApiBaseUrl } from '../lib/auth-token';
import { humanizeTimestamp } from '../lib/timestamp-humanize';
import styles from './status-page.module.scss';

type ProbeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; detail?: string }
  | { status: 'error'; message: string };

function probeBadge(state: ProbeState) {
  if (state.status === 'loading') return <Loader size={16} />;
  if (state.status === 'ok') return <Badge label="OK" variant="success" />;
  if (state.status === 'error') return <Badge label="Fail" variant="error" />;
  return <Badge label="Idle" variant="default" />;
}

function probeIcon(state: ProbeState): 'check_circle' | 'error' | 'progress_activity' | 'help' {
  if (state.status === 'ok') return 'check_circle';
  if (state.status === 'error') return 'error';
  if (state.status === 'loading') return 'progress_activity';
  return 'help';
}

function overallLabel(health: ProbeState, auth: ProbeState): {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'default';
  icon: 'check_circle' | 'error' | 'progress_activity' | 'monitor_heart';
} {
  if (health.status === 'loading' || auth.status === 'loading') {
    return { label: 'Checking', variant: 'warning', icon: 'progress_activity' };
  }
  if (health.status === 'ok' && auth.status === 'ok') {
    return { label: 'Healthy', variant: 'success', icon: 'check_circle' };
  }
  if (health.status === 'error' || auth.status === 'error') {
    return { label: 'Issues detected', variant: 'error', icon: 'error' };
  }
  return { label: 'Not checked', variant: 'default', icon: 'monitor_heart' };
}

export function StatusPage() {
  const [health, setHealth] = useState<ProbeState>({ status: 'idle' });
  const [auth, setAuth] = useState<ProbeState>({ status: 'idle' });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const baseUrl = getApiBaseUrl();
  const token = getAccessToken();

  const runProbes = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void runProbes();
  }, [runProbes]);

  const overall = overallLabel(health, auth);
  const isChecking = health.status === 'loading' || auth.status === 'loading';

  return (
    <div className={styles['status-page']}>
      <PageHeader
        title="Status"
        subtitle="API connectivity and authentication checks."
        primaryCta={
          <Button
            variant="solid"
            onClick={() => void runProbes()}
            isDisabled={isChecking}
            isLoading={isChecking}
          >
            Retry
          </Button>
        }
      />

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
          <Icon name={overall.icon} size="large" />
          <div>
            <Typography variant="small" margin="b-1" className={styles['detail-label']}>
              Overall
            </Typography>
            <Badge label={overall.label} variant={overall.variant} />
          </div>
        </Container>
        {isChecking ? <Loader size={20} /> : null}
      </Container>

      <Container className={styles['metrics-row']} display="flex" gap="3" margin="t-3" padding="0">
        <Container className={styles.metric} padding="4" showBorder>
          <Container display="flex" align="center" gap="2" padding="0" margin="b-3">
            <Icon name={probeIcon(health)} />
            <Typography variant="h4" margin="0">
              Health
            </Typography>
          </Container>
          <Container display="flex" align="center" gap="2" padding="0" margin="b-2">
            {probeBadge(health)}
          </Container>
          <Typography variant="small" className={styles.muted}>
            {health.status === 'ok'
              ? 'GET /health responded OK'
              : health.status === 'error'
                ? health.message
                : health.status === 'loading'
                  ? 'Probing…'
                  : 'Not checked yet'}
          </Typography>
        </Container>

        <Container className={styles.metric} padding="4" showBorder>
          <Container display="flex" align="center" gap="2" padding="0" margin="b-3">
            <Icon name={probeIcon(auth)} />
            <Typography variant="h4" margin="0">
              Auth
            </Typography>
          </Container>
          <Container display="flex" align="center" gap="2" padding="0" margin="b-2">
            {probeBadge(auth)}
          </Container>
          <Typography variant="small" className={styles.muted}>
            {auth.status === 'ok'
              ? 'JWT authorized for /jobs'
              : auth.status === 'error'
                ? auth.message
                : auth.status === 'loading'
                  ? 'Probing…'
                  : 'Not checked yet'}
          </Typography>
        </Container>
      </Container>

      {health.status === 'error' ? (
        <Alert variant="error" margin="t-3" message={health.message} />
      ) : null}
      {auth.status === 'error' ? (
        <Alert variant="error" margin="t-3" message={auth.message} />
      ) : null}

      <Container className={styles.section} padding="4" margin="t-3" showBorder>
        <Typography variant="h3" margin="b-3">
          Connection
        </Typography>
        <div className={styles['fields-grid']}>
          <div className={styles['detail-field']}>
            <Typography variant="small" className={styles['detail-label']}>
              Base URL
            </Typography>
            <Typography variant="p" margin="0" className={styles['detail-value-mono']}>
              {baseUrl}
            </Typography>
          </div>
          <div className={styles['detail-field']}>
            <Typography variant="small" className={styles['detail-label']}>
              Last checked
            </Typography>
            <Typography variant="p" margin="0" className={styles['detail-value']}>
              {checkedAt ? (
                <span title={new Date(checkedAt).toLocaleString()}>
                  {humanizeTimestamp(checkedAt)}
                </span>
              ) : (
                '—'
              )}
            </Typography>
          </div>
          <div className={styles['detail-field']}>
            <Typography variant="small" className={styles['detail-label']}>
              Session
            </Typography>
            <Typography variant="p" margin="0" className={styles['detail-value']}>
              {token ? 'JWT present' : 'Not signed in'}
            </Typography>
          </div>
        </div>
      </Container>
    </div>
  );
}
