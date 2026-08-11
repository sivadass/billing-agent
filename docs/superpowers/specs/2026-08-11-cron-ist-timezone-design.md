# Cron IST Timezone Design

**Date:** 2026-08-11  
**Status:** Approved for implementation planning  
**Related:** `apps/worker/src/scheduler.ts`, `node-cron`

## Problem

Daemon cron jobs are scheduled with `node-cron` without a `timezone` option, so expressions are evaluated in the host process local timezone. On UTC hosts (e.g. Coolify), a schedule like `0 9 * * *` runs at 09:00 UTC, not 09:00 India Standard Time.

## Goals

- Interpret all daemon cron schedules in India Standard Time (`Asia/Kolkata`)
- Keep the change confined to the worker scheduler
- Make the timezone visible in schedule logs
- Cover the behavior with a unit test

## Non-goals

- Configurable timezone via env, Mongo settings, or per-job field
- Changing `humanizeCron` / web UI to show an IST label
- Setting `process.env.TZ` for the whole worker process
- Affecting manual / one-off job runs

## Decisions

| Topic | Decision |
| --- | --- |
| Configuration | Hardcoded `Asia/Kolkata` (no settings escape hatch) |
| Mechanism | Pass `{ timezone: 'Asia/Kolkata' }` as the third argument to `cron.schedule` |
| Scope | All enabled jobs with a non-null `schedule` in `startDaemon` |
| Logging | Include `timezone: 'Asia/Kolkata'` on the existing `scheduled job` info log |
| UI | Unchanged |

## Architecture

```text
startDaemon
  └─ scheduleJobs(app)
       └─ node-cron.schedule(expression, callback, { timezone: 'Asia/Kolkata' })
```

### Files

| Path | Role |
| --- | --- |
| `apps/worker/src/scheduler.ts` | Pass timezone options; widen `CronScheduler.schedule` type |
| `apps/worker/tests/scheduler.test.ts` | Assert `schedule` is called with `{ timezone: 'Asia/Kolkata' }` |

## Behavior

- Cron fields (minute, hour, day, month, weekday) are evaluated against `Asia/Kolkata` wall clock.
- Host timezone (UTC or otherwise) does not change when jobs fire.
- Scheduler reload on `jobsGeneration` change re-registers tasks with the same timezone.

## Testing

- Add a case where a job has a non-null schedule and the mock `cron.schedule` records options.
- Assert options equal `{ timezone: 'Asia/Kolkata' }`.
- Existing “skips jobs without a schedule” test remains unchanged.

## Success criteria

- Scheduled jobs fire at IST wall times on a UTC host.
- Tests pass for scheduler timezone wiring.
- No settings / UI / env changes required to get IST behavior.
