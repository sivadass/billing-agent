import { describe, expect, it } from 'vitest';
import { humanizeCron } from './cron-humanize';

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
