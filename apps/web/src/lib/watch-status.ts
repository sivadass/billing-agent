export type WatchCheckStatus = 'success' | 'failed' | 'running' | 'never' | 'unknown';

export function watchStatusVariant(
  status: string,
): 'success' | 'warning' | 'error' | 'default' | 'info' {
  if (status === 'success') return 'success';
  if (status === 'running') return 'warning';
  if (status === 'failed') return 'error';
  if (status === 'never') return 'default';
  if (status === 'unknown') return 'info';
  return 'default';
}

export function watchStatusLabel(status: string): string {
  if (status === 'never') return 'Never checked';
  if (status === 'unknown') return 'Unknown';
  return status;
}
