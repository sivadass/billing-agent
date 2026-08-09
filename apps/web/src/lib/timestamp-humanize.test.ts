import { describe, expect, it } from 'vitest';
import { humanizeTimestamp } from './timestamp-humanize';

describe('humanizeTimestamp', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');

  it('returns dash for empty values', () => {
    expect(humanizeTimestamp(null, now)).toBe('—');
    expect(humanizeTimestamp(undefined, now)).toBe('—');
    expect(humanizeTimestamp('', now)).toBe('—');
  });

  it('returns Just now for recent timestamps', () => {
    expect(humanizeTimestamp('2026-08-09T11:59:30.000Z', now)).toBe('Just now');
  });

  it('returns minutes ago', () => {
    expect(humanizeTimestamp('2026-08-09T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(humanizeTimestamp('2026-08-09T11:59:00.000Z', now)).toBe('1 minute ago');
  });

  it('returns hours ago', () => {
    expect(humanizeTimestamp('2026-08-09T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(humanizeTimestamp('2026-08-09T11:00:00.000Z', now)).toBe('1 hour ago');
  });

  it('returns yesterday and days ago', () => {
    expect(humanizeTimestamp('2026-08-08T12:00:00.000Z', now)).toBe('Yesterday');
    expect(humanizeTimestamp('2026-08-06T12:00:00.000Z', now)).toBe('3 days ago');
  });

  it('falls back to locale date for older timestamps', () => {
    const label = humanizeTimestamp('2026-07-01T12:00:00.000Z', now);
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/Jul|July|7/);
  });
});
