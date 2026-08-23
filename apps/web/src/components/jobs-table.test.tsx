import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JobDocument } from '../lib/types';
import { JobsTable } from './jobs-table';

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

function canonicalJob(overrides: Partial<JobDocument> = {}): JobDocument {
  return {
    id: 'home-eb',
    name: 'Home EB bill',
    enabled: true,
    schedule: '0 9 * * *',
    startUrl: 'https://www.tnebnet.org/awp/login',
    engine: 'adapter',
    adapterId: 'tnpdcl',
    goal: 'Read the latest bill',
    schema: [],
    workflow: [],
    secretIds: [],
    notify: {
      title: 'Bill reminder',
      on: 'always',
      channel: { type: 'ntfy', topic: 'bills' },
    },
    lastResult: null,
    createdAt: '2026-08-09T08:00:00.000Z',
    updatedAt: '2026-08-09T08:00:00.000Z',
    ...overrides,
  };
}

describe('JobsTable', () => {
  it('passes the title field as mediaAvatar for mobile initials', () => {
    render(
      <JobsTable
        jobs={[canonicalJob()]}
        onRun={() => undefined}
        onEdit={() => undefined}
        onDisable={() => undefined}
        onEnable={() => undefined}
      />,
    );

    expect(lastMobileColumns?.title).toBe('id');
    expect(lastMobileColumns?.mediaAvatar).toBe('id');
  });
});
