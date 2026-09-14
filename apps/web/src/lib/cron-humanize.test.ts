import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_CRON,
  buildDailyCron,
  describeSchedule,
  formatTimeInput,
  humanizeCron,
  inferSchedulePreset,
  parseDailyCron,
  parseTimeInput,
} from './cron-humanize';

describe('humanizeCron', () => {
  it('returns Manual only for null/empty', () => {
    expect(humanizeCron(null)).toBe('Manual only');
    expect(humanizeCron('')).toBe('Manual only');
    expect(humanizeCron(undefined)).toBe('Manual only');
  });

  it('humanizes daily at hour patterns', () => {
    expect(humanizeCron('0 9 * * *')).toBe('Every day at 9:00 AM');
    expect(humanizeCron('30 14 * * *')).toBe('Every day at 2:30 PM');
  });

  it('falls back to raw cron when unrecognized', () => {
    expect(humanizeCron('*/5 * * * *')).toBe('*/5 * * * *');
  });
});

describe('daily cron helpers', () => {
  it('parses and builds daily cron expressions', () => {
    expect(parseDailyCron('0 9 * * *')).toEqual({ hour: 9, minute: 0 });
    expect(parseDailyCron('30 14 * * *')).toEqual({ hour: 14, minute: 30 });
    expect(parseDailyCron('')).toBeNull();
    expect(parseDailyCron('*/5 * * * *')).toBeNull();
    expect(buildDailyCron({ hour: 9, minute: 0 })).toBe(DEFAULT_DAILY_CRON);
    expect(buildDailyCron({ hour: 14, minute: 30 })).toBe('30 14 * * *');
  });

  it('parses and formats 24-hour time inputs', () => {
    expect(parseTimeInput('09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeInput('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(parseTimeInput('25:00')).toBeNull();
    expect(formatTimeInput({ hour: 9, minute: 0 })).toBe('09:00');
    expect(formatTimeInput({ hour: 14, minute: 30 })).toBe('14:30');
  });

  it('infers simple vs advanced schedule presets', () => {
    expect(inferSchedulePreset(null)).toBe('manual');
    expect(inferSchedulePreset('')).toBe('manual');
    expect(inferSchedulePreset('0 9 * * *')).toBe('daily');
    expect(inferSchedulePreset('*/5 * * * *')).toBe('custom');
  });

  it('describes schedules in running copy', () => {
    expect(describeSchedule(null)).toBe('Runs only when triggered manually');
    expect(describeSchedule('0 9 * * *')).toBe('Runs every day at 9:00 AM');
    expect(describeSchedule('30 14 * * *')).toBe('Runs every day at 2:30 PM');
    expect(describeSchedule('*/5 * * * *')).toBe('*/5 * * * *');
  });
});
