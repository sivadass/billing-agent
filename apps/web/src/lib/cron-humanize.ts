export const DEFAULT_DAILY_CRON = '0 9 * * *';

export type DailyTime = { hour: number; minute: number };
export type SchedulePreset = 'daily' | 'manual' | 'custom';

function formatClock(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function parseDailyCron(schedule: string | null | undefined): DailyTime | null {
  if (schedule == null || schedule.trim() === '') return null;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const hourNum = Number(hour);
    const minuteNum = Number(minute);
    if (hourNum > 23 || minuteNum > 59) return null;
    return { hour: hourNum, minute: minuteNum };
  }

  return null;
}

export function buildDailyCron(time: DailyTime): string {
  return `${time.minute} ${time.hour} * * *`;
}

export function formatTimeInput(time: DailyTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function parseTimeInput(value: string): DailyTime | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function inferSchedulePreset(schedule: string | null | undefined): SchedulePreset {
  if (schedule == null || schedule.trim() === '') return 'manual';
  if (parseDailyCron(schedule)) return 'daily';
  return 'custom';
}

/** Display helper for tables and detail views. */
export function humanizeCron(schedule: string | null | undefined): string {
  if (schedule == null || schedule.trim() === '') return 'Manual only';
  const daily = parseDailyCron(schedule);
  if (daily) return `Every day at ${formatClock(daily.hour, daily.minute)}`;
  return schedule.trim();
}

/** Running-copy helper for the job form schedule summary. */
export function describeSchedule(schedule: string | null | undefined): string {
  if (schedule == null || schedule.trim() === '') {
    return 'Runs only when triggered manually';
  }
  const human = humanizeCron(schedule);
  if (human === 'Manual only') return 'Runs only when triggered manually';
  if (human.startsWith('Every ')) {
    return `Runs ${human.charAt(0).toLowerCase()}${human.slice(1)}`;
  }
  return human;
}
