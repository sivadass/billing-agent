import { Alert, FormControls, PageHeader } from 'cleanplate';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from '../components/loader';
import { RunsTable } from '../components/runs-table';
import { listJobs } from '../lib/jobs-api';
import { deleteRun, listRuns } from '../lib/runs-api';
import { ApiClientError } from '../lib/api-client';
import type { JobDocument, RunDocument } from '../lib/types';
import styles from './runs-page.module.scss';

type SelectOption = { label: string; value: string };

const STATUS_OPTIONS: SelectOption[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Success', value: 'success' },
  { label: 'Failed', value: 'failed' },
];

const DEFAULT_ROWS_PER_PAGE = 10;

export function RunsPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobDocument[]>([]);
  const [runs, setRuns] = useState<RunDocument[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        ...(selectedJobId !== 'all' ? { jobId: selectedJobId } : {}),
        ...(selectedStatus !== 'all'
          ? { status: selectedStatus as RunDocument['status'] }
          : {}),
      });
      setRuns(result.runs);
      setTotalItems(result.total);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load runs',
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, rowsPerPage, selectedJobId, selectedStatus]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const jobOptions: SelectOption[] = [
    { label: 'All jobs', value: 'all' },
    ...jobs.map((job) => ({ label: job.id, value: job.id })),
  ];
  const selectedJobOption =
    jobOptions.find((option) => option.value === selectedJobId) ?? jobOptions[0];
  const selectedStatusOption =
    STATUS_OPTIONS.find((option) => option.value === selectedStatus) ??
    STATUS_OPTIONS[0];

  const handleDelete = async (run: RunDocument) => {
    setActionError(null);
    try {
      await deleteRun(run.id);
      const nextTotal = totalItems - 1;
      const maxPage = Math.max(1, Math.ceil(nextTotal / rowsPerPage));
      if (currentPage > maxPage) {
        setCurrentPage(maxPage);
        return;
      }
      await loadRuns();
    } catch (err) {
      setActionError(
        err instanceof ApiClientError ? err.message : 'Failed to delete run',
      );
    }
  };

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
                setCurrentPage(1);
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
                setCurrentPage(1);
              }
            }}
            isFluid
          />
        </div>
      </div>
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {actionError ? (
        <Alert variant="error" margin="t-3" message={actionError} />
      ) : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : null}
      {!isLoading && !error ? (
        <RunsTable
          runs={runs}
          totalItems={totalItems}
          currentPage={currentPage}
          rowsPerPage={rowsPerPage}
          onPageChange={(page) => setCurrentPage(page)}
          onRowsPerPageChange={(nextRowsPerPage) => {
            setRowsPerPage(nextRowsPerPage);
            setCurrentPage(1);
          }}
          onSelectRun={(run) => navigate(`/runs/${run.id}`)}
          onDelete={handleDelete}
        />
      ) : null}
    </>
  );
}
