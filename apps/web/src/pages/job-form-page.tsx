import { Alert, Button, Container, FormControls, PageHeader, Spinner } from 'cleanplate';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  type CredentialEnvRow,
  CredentialsEnvEditor,
} from '../components/credentials-env-editor';
import { createJob, getJob, updateJob } from '../lib/jobs-api';
import type { JobDocument } from '../lib/types';

const PROVIDER_OPTIONS = [
  { label: 'tnpdcl', value: 'tnpdcl' },
  { label: 'dummy', value: 'dummy' },
];

export function JobFormPage() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const isEdit = Boolean(jobId);
  const [id, setId] = useState(jobId ?? '');
  const [provider, setProvider] = useState('tnpdcl');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState('');
  const [notifyTitle, setNotifyTitle] = useState('');
  const [credentialsRows, setCredentialsRows] = useState<CredentialEnvRow[]>([]);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isEdit || !jobId) return;
    setIsLoading(true);
    void getJob(jobId)
      .then((job) => {
        setId(job.id);
        setProvider(job.provider);
        setEnabled(job.enabled);
        setSchedule(job.schedule ?? '');
        setNotifyTitle(job.notify.title);
        setCredentialsRows(
          Object.entries(job.credentialsEnv).map(([key, envName]) => ({
            key,
            envName,
          })),
        );
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load job',
        );
      })
      .finally(() => setIsLoading(false));
  }, [isEdit, jobId]);

  const providerValue = useMemo(
    () => PROVIDER_OPTIONS.find((item) => item.value === provider) ?? null,
    [provider],
  );

  const buildCredentialsEnv = (): Record<string, string> => {
    const entries = credentialsRows
      .map((row) => ({
        key: row.key.trim(),
        envName: row.envName.trim(),
      }))
      .filter((row) => row.key && row.envName)
      .map((row) => [row.key, row.envName] as const);
    return Object.fromEntries(entries);
  };

  const onSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    const jobIdValue = isEdit ? (jobId ?? '') : id.trim();

    if (!jobIdValue) {
      nextErrors.id = 'Job id is required';
    }
    if (!provider.trim()) {
      nextErrors.provider = 'Provider is required';
    }
    if (!notifyTitle.trim()) {
      nextErrors.notifyTitle = 'Notify title is required';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: JobDocument = {
      id: jobIdValue,
      provider,
      enabled,
      schedule: schedule.trim() ? schedule.trim() : null,
      credentialsEnv: buildCredentialsEnv(),
      notify: { title: notifyTitle.trim() },
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEdit && jobId) {
        await updateJob(jobId, payload);
      } else {
        await createJob(payload);
      }
      navigate('/jobs');
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to save job',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const title = isEdit ? `Edit job: ${jobId}` : 'Create job';

  return (
    <>
      <PageHeader title={title} subtitle="Configure the billing job settings." />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <Spinner margin="t-3" />
      ) : (
        <Container padding="0" margin="t-3">
          <FormControls.Input
            label="Job id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            isDisabled={isEdit}
            isFluid
            error={fieldErrors.id}
          />
          <FormControls.Select
            label="Provider"
            options={PROVIDER_OPTIONS}
            value={providerValue}
            onChange={(selected) => {
              if (selected && !Array.isArray(selected)) {
                setProvider(String(selected.value));
              }
            }}
            error={fieldErrors.provider}
            isFluid
            margin="t-3"
          />
          <FormControls.Toggle
            label="Enabled"
            checked={enabled}
            onChange={(checked) => setEnabled(checked)}
            margin="t-3"
          />
          <FormControls.Input
            label="Schedule (cron)"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            placeholder="e.g. 0 9 * * * (leave blank for manual only)"
            isFluid
            margin="t-3"
          />
          <FormControls.Input
            label="Notify title"
            value={notifyTitle}
            onChange={(event) => setNotifyTitle(event.target.value)}
            isFluid
            error={fieldErrors.notifyTitle}
            margin="t-3"
          />
          <CredentialsEnvEditor
            rows={credentialsRows}
            onChange={setCredentialsRows}
          />
          <Container display="flex" gap="2" margin="t-4">
            <Button variant="solid" onClick={() => void onSubmit()} isDisabled={isSaving}>
              Save job
            </Button>
            <Button variant="outline" onClick={() => navigate('/jobs')}>
              Cancel
            </Button>
          </Container>
        </Container>
      )}
    </>
  );
}
