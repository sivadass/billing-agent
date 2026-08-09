import { Alert, Button, PageHeader, Spinner } from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JobsTable } from '../components/jobs-table';
import { ApiClientError } from '../lib/api-client';
import { disableJob, listJobs, runJobNow, updateJob } from '../lib/jobs-api';
import type { JobDocument } from '../lib/types';

export function JobsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listJobs();
      setJobs(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleRun = async (job: JobDocument) => {
    setActionError(null);
    setRunningJobId(job.id);
    try {
      const run = await runJobNow(job.id);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setActionError(
        err instanceof ApiClientError ? err.message : 'Failed to trigger run',
      );
    } finally {
      setRunningJobId(null);
    }
  };

  const handleDisable = async (job: JobDocument) => {
    setActionError(null);
    try {
      await disableJob(job.id);
      await loadJobs();
    } catch (err) {
      setActionError(
        err instanceof ApiClientError ? err.message : 'Failed to disable job',
      );
    }
  };

  const handleEnable = async (job: JobDocument) => {
    setActionError(null);
    try {
      await updateJob(job.id, { enabled: true });
      await loadJobs();
    } catch (err) {
      setActionError(
        err instanceof ApiClientError ? err.message : 'Failed to enable job',
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="Manage billing jobs, schedules, and manual runs."
        primaryCta={
          <Button variant="solid" onClick={() => navigate('/jobs/new')}>
            New job
          </Button>
        }
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {actionError ? (
        <Alert variant="error" margin="t-3" message={actionError} />
      ) : null}
      {isLoading ? <Spinner margin="t-3" /> : null}
      {!isLoading && !error ? (
        <JobsTable
          jobs={jobs}
          runningJobId={runningJobId}
          onRun={handleRun}
          onEdit={(job) => navigate(`/jobs/${job.id}`)}
          onDisable={handleDisable}
          onEnable={handleEnable}
        />
      ) : null}
    </>
  );
}
