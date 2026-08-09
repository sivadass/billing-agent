import { Alert, FormControls, PageHeader, Spinner } from 'cleanplate';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RunsTable } from '../components/runs-table';
import { listJobs } from '../lib/jobs-api';
import { listRuns } from '../lib/runs-api';
import type { JobDocument, RunDocument } from '../lib/types';
import styles from './runs-page.module.scss';

type SelectOption = { label: string; value: string };

const STATUS_OPTIONS: SelectOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Success', value: 'success' },
  { label: 'Failed', value: 'failed' },
];

export function RunsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobDocument[]>([]);
  const [runs, setRuns] = useState<RunDocument[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listJobs()
      .then((items) => setJobs(items))
      .catch(() => {
        // non-fatal for runs listing; job filter just stays at "all"
      });
  }, []);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRuns({
        limit: 100,
        ...(selectedJobId !== 'all' ? { jobId: selectedJobId } : {}),
      });
      setRuns(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load runs',
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const filteredRuns = useMemo(() => {
    if (selectedStatus === 'all') return runs;
    return runs.filter((run) => run.status === selectedStatus);
  }, [runs, selectedStatus]);

  const jobOptions: SelectOption[] = [
    { label: 'All jobs', value: 'all' },
    ...jobs.map((job) => ({ label: job.id, value: job.id })),
  ];
  const selectedJobOption =
    jobOptions.find((option) => option.value === selectedJobId) ?? jobOptions[0];
  const selectedStatusOption =
    STATUS_OPTIONS.find((option) => option.value === selectedStatus) ??
    STATUS_OPTIONS[0];

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Track job executions and drill into run details."
      />
      <div className={styles.filters}>
        <div className={styles['filter-field']}>
          <FormControls.Select
            label="Job filter"
            options={jobOptions}
            value={selectedJobOption}
            onChange={(selected) => {
              if (selected && !Array.isArray(selected)) {
                setSelectedJobId(String(selected.value));
              }
            }}
            isFluid
          />
        </div>
        <div className={styles['filter-field']}>
          <FormControls.Select
            label="Status filter"
            options={STATUS_OPTIONS}
            value={selectedStatusOption}
            onChange={(selected) => {
              if (selected && !Array.isArray(selected)) {
                setSelectedStatus(String(selected.value));
              }
            }}
            isFluid
          />
        </div>
      </div>
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? <Spinner margin="t-3" /> : null}
      {!isLoading && !error ? (
        <RunsTable
          runs={filteredRuns}
          onSelectRun={(run) => navigate(`/runs/${run.id}`)}
        />
      ) : null}
    </>
  );
}
