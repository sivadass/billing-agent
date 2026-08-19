import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunDocument } from '../lib/types';
import { RunsTable } from './runs-table';

type TableMobileColumns = {
  title?: string;
  mediaAvatar?: string;
};

let lastMobileColumns: TableMobileColumns | undefined;

vi.mock('cleanplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cleanplate')>();
  return {
    ...actual,
    Table: (props: { mobileColumns?: TableMobileColumns }) => {
      lastMobileColumns = props.mobileColumns;
      return <div data-testid="table-stub" />;
    },
  };
});

function run(overrides: Partial<RunDocument> = {}): RunDocument {
  return {
    id: 'run-123',
    jobId: 'home-eb',
    engine: 'adapter',
    adapterId: 'tnpdcl',
    status: 'success',
    startedAt: '2026-08-09T08:00:00.000Z',
    finishedAt: '2026-08-09T08:00:05.000Z',
    durationMs: 5000,
    errorCode: null,
    errorMessage: null,
    screenshotPath: null,
    recoveryAttempted: false,
    recoverySucceeded: false,
    overlayActivated: false,
    result: null,
    ...overrides,
  };
}

describe('RunsTable', () => {
  it('passes the title field as mediaAvatar for mobile initials', () => {
    render(<RunsTable runs={[run()]} onSelectRun={() => undefined} />);

    expect(lastMobileColumns?.title).toBe('id');
    expect(lastMobileColumns?.mediaAvatar).toBe('id');
  });
});
