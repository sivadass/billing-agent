import { Button, FormControls, Typography } from 'cleanplate';
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_DAILY_CRON,
  buildDailyCron,
  describeSchedule,
  formatTimeInput,
  inferSchedulePreset,
  parseDailyCron,
  parseTimeInput,
  type SchedulePreset,
} from '../lib/cron-humanize';
import styles from './schedule-fields.module.scss';

type ScheduleFieldsProps = {
  value: string;
  onChange: (cron: string) => void;
};

const FREQUENCY_OPTIONS: Array<{ label: string; value: SchedulePreset }> = [
  { label: 'Daily', value: 'daily' },
  { label: 'Manual', value: 'manual' },
  { label: 'Custom', value: 'custom' },
];

const DEFAULT_DAILY_TIME = { hour: 9, minute: 0 };

export function ScheduleFields({ value, onChange }: ScheduleFieldsProps) {
  const preset = inferSchedulePreset(value);
  const [advancedOpen, setAdvancedOpen] = useState(preset === 'custom');

  useEffect(() => {
    if (preset === 'custom') {
      setAdvancedOpen(true);
    }
  }, [preset]);

  const frequencyOptions = useMemo(
    () =>
      FREQUENCY_OPTIONS.filter(
        (option) => option.value !== 'custom' || preset === 'custom',
      ),
    [preset],
  );

  const frequencyValue =
    frequencyOptions.find((option) => option.value === preset) ?? frequencyOptions[0];

  const dailyTime = parseDailyCron(value) ?? DEFAULT_DAILY_TIME;
  const showTime = preset === 'daily';
  const showCron = advancedOpen || preset === 'custom';

  const applyPreset = (next: SchedulePreset) => {
    if (next === 'manual') {
      onChange('');
      return;
    }
    if (next === 'daily') {
      onChange(buildDailyCron(parseDailyCron(value) ?? DEFAULT_DAILY_TIME));
      return;
    }
    setAdvancedOpen(true);
    onChange(value.trim() ? value : DEFAULT_DAILY_CRON);
  };

  return (
    <div className={styles.schedule}>
      <div className={showTime ? styles['schedule-row'] : undefined}>
        <FormControls.Select
          label="Schedule"
          options={frequencyOptions}
          value={frequencyValue}
          onChange={(selected) => {
            if (selected && !Array.isArray(selected)) {
              applyPreset(selected.value as SchedulePreset);
            }
          }}
          searchable={false}
          clearable={false}
          isFluid
          margin="0"
          dataTestId="schedule-frequency"
        />
        {showTime ? (
          <FormControls.Input
            label="Time"
            type="time"
            value={formatTimeInput(dailyTime)}
            onChange={(event) => {
              const next = parseTimeInput(event.target.value);
              if (next) onChange(buildDailyCron(next));
            }}
            isFluid
            margin="0"
          />
        ) : null}
      </div>
      <Typography variant="small" className={styles.summary} margin="t-2">
        {describeSchedule(value)}
      </Typography>
      <div className={styles['advanced-toggle']}>
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            const nextOpen = !advancedOpen;
            setAdvancedOpen(nextOpen);
            if (nextOpen && !value.trim()) {
              onChange(DEFAULT_DAILY_CRON);
            }
          }}
        >
          Advanced cron
        </Button>
      </div>
      {showCron ? (
        <FormControls.Input
          label="Cron expression"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0 9 * * *"
          isFluid
          margin="t-3"
        />
      ) : null}
    </div>
  );
}
