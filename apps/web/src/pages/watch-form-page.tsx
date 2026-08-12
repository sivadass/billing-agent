import { Alert, Button, Container, FormControls, PageHeader } from 'cleanplate';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader } from '../components/loader';
import {
  createWatch,
  getWatch,
  updateWatch,
} from '../lib/watches-api';
import type { WatchDocument } from '../lib/types';
import styles from './watch-form-page.module.scss';

export function WatchFormPage() {
  const navigate = useNavigate();
  const { watchId } = useParams<{ watchId: string }>();
  const isEdit = Boolean(watchId);
  const [id, setId] = useState(watchId ?? '');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isEdit || !watchId) return;
    setIsLoading(true);
    void getWatch(watchId)
      .then((watch) => {
        setId(watch.id);
        setUrl(watch.url);
        setTitle(watch.title ?? '');
        setEnabled(watch.enabled);
        setSchedule(watch.schedule ?? '0 9 * * *');
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load watch',
        );
      })
      .finally(() => setIsLoading(false));
  }, [isEdit, watchId]);

  const onSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    const watchIdValue = isEdit ? (watchId ?? '') : id.trim();
    if (!watchIdValue) {
      nextErrors.id = 'Watch id is required';
    }
    if (!url.trim()) {
      nextErrors.url = 'URL is required';
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: WatchDocument = {
      id: watchIdValue,
      url: url.trim(),
      title: title.trim() ? title.trim() : null,
      enabled,
      schedule: schedule.trim() ? schedule.trim() : null,
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
      createdAt: new Date().toISOString(),
    };

    setIsSaving(true);
    setError(null);
    try {
      if (isEdit && watchId) {
        await updateWatch(watchId, payload);
      } else {
        await createWatch(payload);
      }
      navigate('/watches');
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to save watch',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const pageTitle = isEdit ? `Edit watch: ${watchId}` : 'Create watch';

  return (
    <>
      <PageHeader
        title={pageTitle}
        subtitle="Configure the product URL and watch schedule."
      />
      {error ? <Alert variant="error" margin="t-3" message={error} /> : null}
      {isLoading ? (
        <div className={styles['loading-state']}>
          <Loader size={56} />
        </div>
      ) : (
        <Container padding="0" margin="t-3">
          <FormControls.Input
            label="Watch id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            isDisabled={isEdit}
            isFluid
            error={fieldErrors.id}
          />
          <FormControls.Input
            label="URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            isFluid
            error={fieldErrors.url}
            margin="t-3"
          />
          <FormControls.Input
            label="Title (optional)"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
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
            placeholder="0 9 * * *"
            isFluid
            margin="t-3"
          />
          <Container display="flex" gap="2" margin="t-4">
            <Button variant="solid" onClick={() => void onSubmit()} isDisabled={isSaving}>
              Save watch
            </Button>
            <Button variant="outline" onClick={() => navigate('/watches')}>
              Cancel
            </Button>
          </Container>
        </Container>
      )}
    </>
  );
}
