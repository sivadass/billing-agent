# Task 8 Report: Job runner

## Status

Implemented dependency-injected single-job and multi-job orchestration.

## Changes

- Added `runJob` with browser-managed adapter execution and captcha solver setup.
- Added default-priority success notifications and high-priority failure notifications.
- Preserved typed `AppError` failures and mapped unknown failures to `ScrapeError`.
- Added best-effort error screenshots under `tmp/`, creating the directory before capture.
- Added `runJobs` with enabled-job selection for `all`, failure aggregation, and continuation after job failures.
- Added isolated tests using fake adapters and injected browser, captcha, registry, and notification dependencies.

## Verification

- `npm test`: 21 tests passed, 0 failed.
- `npm run build`: passed.

## Concerns

- Failure notifications and screenshots are best-effort; their own failures are logged while the original job error is returned.

## Important review fixes

- Explicit unknown job IDs now throw `ConfigError` before any jobs run.
- Error screenshot filenames sanitize job IDs to `[a-zA-Z0-9_-]` before joining them under `tmp/`.
- Added regression coverage for unknown job IDs and path-safe screenshot filenames.
- `npm test -- tests/job-runner.test.ts`: 23 tests passed, 0 failed.
- `npm test`: 23 tests passed, 0 failed.
- `npm run build`: passed.
