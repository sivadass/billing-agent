/** Display helper for ISO timestamps → relative English (e.g. "5 minutes ago"). */
export function humanizeTimestamp(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (value == null || value === '') return '—';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleString();
  }

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
