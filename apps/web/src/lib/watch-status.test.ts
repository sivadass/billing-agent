import { describe, expect, it } from 'vitest';
import { watchStatusLabel, watchStatusVariant } from './watch-status';

describe('watchStatusVariant', () => {
  it('maps known statuses to badge variants', () => {
    expect(watchStatusVariant('success')).toBe('success');
    expect(watchStatusVariant('running')).toBe('warning');
    expect(watchStatusVariant('failed')).toBe('error');
    expect(watchStatusVariant('never')).toBe('default');
    expect(watchStatusVariant('unknown')).toBe('info');
  });
});

describe('watchStatusLabel', () => {
  it('humanizes special statuses', () => {
    expect(watchStatusLabel('never')).toBe('Never checked');
    expect(watchStatusLabel('unknown')).toBe('Unknown');
    expect(watchStatusLabel('success')).toBe('success');
  });
});
