import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import type { JobDocument } from '../lib/types';
import { JobsPage } from './jobs-page';

vi.mock('../lib/jobs-api', () => ({
  listJobs: vi.fn(),
  runJobNow: vi.fn(),
  disableJob: vi.fn(),
  updateJob: vi.fn(),
}));

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

function RunRouteStub() {
  const { runId } = useParams<{ runId: string }>();
  return <div>Run detail route: {runId}</div>;
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.listJobs).mockResolvedValue([
      canonicalJob(),
      canonicalJob({
        id: 'sivadass-in-b2c3',
        name: 'Sivadass contact',
        engine: 'workflow',
        adapterId: undefined,
        startUrl: 'https://sivadass.in/',
        notify: {
          title: 'Contact email',
          on: 'change',
          channel: { type: 'ntfy', topic: 'sites' },
        },
      }),
    ]);
    vi.mocked(jobsApi.runJobNow).mockResolvedValue({ id: 'run-123' });
    vi.mocked(jobsApi.disableJob).mockResolvedValue(canonicalJob({ enabled: false }));
    vi.mocked(jobsApi.updateJob).mockResolvedValue(canonicalJob());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows humanized schedule and navigates to run detail after Run', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/runs/:runId" element={<RunRouteStub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Every day at 9:00 AM')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /^run$/i })[0]!);

    await waitFor(() => {
      expect(jobsApi.runJobNow).toHaveBeenCalledWith('home-eb');
    });
    expect(await screen.findByText('Run detail route: run-123')).toBeInTheDocument();
  });

  it('offers no create CTA now that jobs come from chat', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Engine');
    expect(screen.queryByRole('button', { name: /new job/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/new job/i)).not.toBeInTheDocument();
  });

  it('shows an Engine column instead of Provider', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs']}>
        <Routes>
          <Route path="/jobs" element={<JobsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Engine')).toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
    expect(screen.getByText('adapter:tnpdcl')).toBeInTheDocument();
    expect(screen.getByText('workflow')).toBeInTheDocument();
  });
});
