import {
  Alert,
  Button,
  FormControls,
  PageHeader,
  Typography,
} from 'cleanplate';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader } from '../components/loader';
import { ScheduleFields } from '../components/schedule-fields';
import {
  createJob,
  getJob,
  getJobSecrets,
  listProviders,
  updateJob,
  updateJobSecrets,
} from '../lib/jobs-api';
import { DEFAULT_DAILY_CRON } from '../lib/cron-humanize';
import type { JobDocument } from '../lib/types';
import styles from './job-form-page.module.scss';

type ProviderInfo = { id: string; credentialKeys: string[] };

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Disabled', value: 'disabled' },
];

function labelForCredentialKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function JobFormPage() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const isEdit = Boolean(jobId);
  const [id, setId] = useState(jobId ?? '');
  const [provider, setProvider] = useState('tnpdcl');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState(isEdit ? '' : DEFAULT_DAILY_CRON);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretSet, setSecretSet] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    const load = isEdit && jobId
      ? Promise.all([listProviders(), getJob(jobId), getJobSecrets(jobId)])
      : listProviders().then((result) => [result] as const);

    void load
      .then((result) => {
        if (isEdit && jobId) {
          const [providerResult, job, secrets] = result as [
            { providers: ProviderInfo[] },
            JobDocument,
            { keys: Array<{ key: string; set: boolean }> },
          ];
          setProviders(providerResult.providers);
          setId(job.id);
          setProvider(job.provider);
          setEnabled(job.enabled);
          setSchedule(job.schedule ?? '');
          setNotifyTitle(job.notify.title);
          setSecretValues({});
          setSecretSet(
            Object.fromEntries(secrets.keys.map(({ key, set }) => [key, set])),
          );
          return;
        }

        const providerResult = result[0] as { providers: ProviderInfo[] };
        setProviders(providerResult.providers);
        setProvider(providerResult.providers[0]?.id ?? 'tnpdcl');
        setSecretValues({});
        setSecretSet({});
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load job',
        );
      })
      .finally(() => setIsLoading(false));
  }, [isEdit, jobId]);

  const credentialKeys = useMemo(() => {
    return providers.find((item) => item.id === provider)?.credentialKeys ?? [];
  }, [providers, provider]);

  const providerOptions = useMemo(
    () => providers.map((item) => ({ label: item.id, value: item.id })),
    [providers],
  );

  const providerValue = useMemo(
    () => providerOptions.find((item) => item.value === provider) ?? null,
    [provider, providerOptions],
  );

  const statusValue = enabled ? STATUS_OPTIONS[0] : STATUS_OPTIONS[1];

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

    if (!isEdit) {
      for (const key of credentialKeys) {
        if (!secretValues[key]?.trim()) {
          nextErrors[`secret-${key}`] = `${labelForCredentialKey(key)} is required`;
        }
      }
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const jobPayload: JobDocument = {
      id: jobIdValue,
      provider,
      enabled,
      schedule: schedule.trim() ? schedule.trim() : null,
      notify: { title: notifyTitle.trim() },
    };

    const secretPatch = Object.fromEntries(
      Object.entries(secretValues).filter(([, value]) => value.trim()),
    );

    setIsSaving(true);
    setError(null);
    try {
      if (isEdit && jobId) {
        await updateJob(jobId, jobPayload);
        if (Object.keys(secretPatch).length > 0) {
          await updateJobSecrets(jobId, secretPatch);
        }
      } else {
        await createJob({
          ...jobPayload,
          secrets: Object.fromEntries(
            credentialKeys.map((key) => [key, secretValues[key]?.trim() ?? '']),
          ),
        });
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
    <div className={styles['job-form']}>
      <PageHeader
        className={styles['page-header']}
        title={title}
        subtitle="Configure the billing job settings."
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : (
        <div className={styles.form}>
          <section className={styles.section} aria-labelledby="job-configuration-heading">
            <Typography
              id="job-configuration-heading"
              variant="h2"
              className={styles['section-title']}
            >
              Job configuration
            </Typography>
            <div className={styles['fields-grid']}>
              <FormControls.Input
                label="Job ID"
                value={id}
                onChange={(event) => setId(event.target.value)}
                isDisabled={isEdit}
                isFluid
                error={fieldErrors.id}
                margin="0"
              />
              <FormControls.Select
                label="Provider"
                options={providerOptions}
                value={providerValue}
                onChange={(selected) => {
                  if (selected && !Array.isArray(selected)) {
                    setProvider(String(selected.value));
                    if (!isEdit) {
                      setSecretValues({});
                    }
                  }
                }}
                isDisabled={isEdit}
                error={fieldErrors.provider}
                searchable={false}
                clearable={false}
                isFluid
                margin="0"
              />
              <FormControls.Select
                label="Status"
                options={STATUS_OPTIONS}
                value={statusValue}
                onChange={(selected) => {
                  if (selected && !Array.isArray(selected)) {
                    setEnabled(selected.value === 'active');
                  }
                }}
                searchable={false}
                clearable={false}
                isFluid
                margin="0"
              />
            </div>
            <ScheduleFields value={schedule} onChange={setSchedule} />
          </section>

          <section className={styles.section} aria-labelledby="notifications-heading">
            <Typography
              id="notifications-heading"
              variant="h2"
              className={styles['section-title']}
            >
              Notifications
            </Typography>
            <FormControls.Input
              label="Notify title"
              value={notifyTitle}
              onChange={(event) => setNotifyTitle(event.target.value)}
              isFluid
              error={fieldErrors.notifyTitle}
              margin="0"
            />
          </section>

          {credentialKeys.length > 0 ? (
            <section className={styles.section} aria-labelledby="credentials-heading">
              <Typography
                id="credentials-heading"
                variant="h2"
                className={styles['section-title']}
              >
                Provider credentials
              </Typography>
              <div className={styles['fields-grid']}>
                {credentialKeys.map((key) => (
                  <FormControls.Input
                    key={key}
                    label={labelForCredentialKey(key)}
                    type={key === 'password' ? 'password' : 'text'}
                    value={secretValues[key] ?? ''}
                    onChange={(event) =>
                      setSecretValues((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    placeholder={
                      isEdit && secretSet[key]
                        ? 'Leave blank to keep (currently set)'
                        : undefined
                    }
                    isFluid
                    error={fieldErrors[`secret-${key}`]}
                    margin="0"
                  />
                ))}
              </div>
            </section>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => navigate('/jobs')}>
              Cancel
            </Button>
            <Button variant="solid" onClick={() => void onSubmit()} isDisabled={isSaving}>
              {isEdit ? 'Save job' : 'Create job'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
