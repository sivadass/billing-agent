import {
  Alert,
  Button,
  Container,
  FeedbackState,
  FormControls,
  PageHeader,
} from 'cleanplate';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  JobSecretsPanel,
  type NewSecretRow,
} from '../components/job-secrets-panel';
import { Loader } from '../components/loader';
import { engineLabel } from '../lib/engine-label';
import { getJob, getJobSecrets, updateJob, updateJobSecrets } from '../lib/jobs-api';
import type {
  JobDocument,
  JobSecretKey,
  NotifyChannel,
  NotifyOn,
} from '../lib/types';
import styles from './job-form-page.module.scss';

const NOTIFY_ON_OPTIONS: Array<{ label: string; value: NotifyOn }> = [
  { label: 'Always', value: 'always' },
  { label: 'On change', value: 'change' },
  { label: 'On price drop', value: 'drop' },
  { label: 'Failures only', value: 'failure_only' },
];

const CHANNEL_OPTIONS: Array<{ label: string; value: NotifyChannel['type'] }> = [
  { label: 'ntfy', value: 'ntfy' },
  { label: 'Webhook', value: 'webhook' },
];

export function JobFormPage() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();

  const [job, setJob] = useState<JobDocument | null>(null);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState('');
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyOn, setNotifyOn] = useState<NotifyOn>('always');
  const [channelType, setChannelType] = useState<NotifyChannel['type']>('ntfy');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secretKeys, setSecretKeys] = useState<JobSecretKey[]>([]);
  const [secretsError, setSecretsError] = useState<string | null>(null);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [newSecretRows, setNewSecretRows] = useState<NewSecretRow[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(jobId));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!jobId) return;
    setIsLoading(true);
    void getJob(jobId)
      .then((loaded) => {
        setJob(loaded);
        setName(loaded.name);
        setEnabled(loaded.enabled);
        setSchedule(loaded.schedule ?? '');
        setNotifyTitle(loaded.notify.title);
        setNotifyOn(loaded.notify.on);
        setChannelType(loaded.notify.channel.type);
        if (loaded.notify.channel.type === 'ntfy') {
          setNtfyTopic(loaded.notify.channel.topic);
        } else {
          setWebhookUrl(loaded.notify.channel.url);
        }
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load job',
        );
      })
      .finally(() => setIsLoading(false));
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    void getJobSecrets(jobId)
      .then((keys) => setSecretKeys(keys))
      .catch((loadError) => {
        setSecretsError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load secret keys',
        );
      });
  }, [jobId]);

  const notifyOnValue = useMemo(
    () => NOTIFY_ON_OPTIONS.find((option) => option.value === notifyOn) ?? null,
    [notifyOn],
  );
  const channelValue = useMemo(
    () => CHANNEL_OPTIONS.find((option) => option.value === channelType) ?? null,
    [channelType],
  );

  const collectSecretValues = (): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(replacements)) {
      if (value) values[key] = value;
    }
    for (const row of newSecretRows) {
      const key = row.key.trim();
      if (key && row.value) values[key] = row.value;
    }
    return values;
  };

  const onSubmit = async () => {
    if (!jobId) return;

    const nextErrors: Record<string, string> = {};
    if (!name.trim()) {
      nextErrors.name = 'Name is required';
    }
    if (!notifyTitle.trim()) {
      nextErrors.notifyTitle = 'Notify title is required';
    }
    if (channelType === 'webhook' && !webhookUrl.trim()) {
      nextErrors.webhookUrl = 'Webhook URL is required';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const channel: NotifyChannel =
      channelType === 'webhook'
        ? { type: 'webhook', url: webhookUrl.trim() }
        : { type: 'ntfy', topic: ntfyTopic.trim() };

    setIsSaving(true);
    setError(null);
    try {
      // Secrets first: a rejected write (e.g. a run in flight) must not leave
      // the job half-saved.
      const secretValues = collectSecretValues();
      if (Object.keys(secretValues).length > 0) {
        setSecretKeys(await updateJobSecrets(jobId, secretValues));
        setReplacements({});
        setNewSecretRows([]);
      }
      await updateJob(jobId, {
        name: name.trim(),
        enabled,
        schedule: schedule.trim() ? schedule.trim() : null,
        notify: { title: notifyTitle.trim(), on: notifyOn, channel },
      });
      navigate('/jobs');
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to save job',
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!jobId) {
    return (
      <>
        <PageHeader title="Create job" />
        <FeedbackState
          variant="empty"
          margin="t-5"
          title="Jobs are created from Chat"
          description="Describe the site and the goal in a chat session, then confirm the proposed job."
          primaryAction={{ label: 'Open Chat', onClick: () => navigate('/chat') }}
          secondaryAction={{ label: 'Back to jobs', onClick: () => navigate('/jobs') }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit job: ${jobId}`}
        subtitle="Schedule, notifications, and stored secrets."
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : (
        <Container padding="0" margin="t-3">
          <FormControls.Input label="Job id" value={jobId} isDisabled isFluid />
          <FormControls.Input
            label="Engine"
            value={job ? engineLabel(job) : ''}
            isDisabled
            isFluid
            margin="t-3"
          />
          <FormControls.Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            isFluid
            error={fieldErrors.name}
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
          <FormControls.Select
            label="Notify on"
            options={NOTIFY_ON_OPTIONS}
            value={notifyOnValue}
            onChange={(selected) => {
              if (selected && !Array.isArray(selected)) {
                setNotifyOn(selected.value as NotifyOn);
              }
            }}
            isFluid
            margin="t-3"
          />
          <FormControls.Select
            label="Notify channel"
            options={CHANNEL_OPTIONS}
            value={channelValue}
            onChange={(selected) => {
              if (selected && !Array.isArray(selected)) {
                setChannelType(selected.value as NotifyChannel['type']);
              }
            }}
            isFluid
            margin="t-3"
          />
          {channelType === 'ntfy' ? (
            <FormControls.Input
              label="ntfy topic"
              value={ntfyTopic}
              onChange={(event) => setNtfyTopic(event.target.value)}
              placeholder="Leave blank to use the global default topic"
              isFluid
              margin="t-3"
            />
          ) : (
            <FormControls.Input
              label="Webhook URL"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              isFluid
              error={fieldErrors.webhookUrl}
              margin="t-3"
            />
          )}
          <JobSecretsPanel
            keys={secretKeys}
            replacements={replacements}
            onReplacementChange={(key, value) =>
              setReplacements((current) => ({ ...current, [key]: value }))
            }
            newRows={newSecretRows}
            onNewRowsChange={setNewSecretRows}
            error={secretsError}
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
