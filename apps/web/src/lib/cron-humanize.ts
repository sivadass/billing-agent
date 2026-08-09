function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Display helper only — forms still edit raw cron. */
export function humanizeCron(schedule: string | null | undefined): string {
  if (schedule == null || schedule.trim() === '') return 'Manual only';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return schedule;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Every day at ${formatClock(Number(hour), Number(minute))}`;
  }

  return schedule;
}
