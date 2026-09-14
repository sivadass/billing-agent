import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import * as runsApi from '../lib/runs-api';
import { RunsPage } from './runs-page';

vi.mock('../lib/jobs-api', () => ({
  listJobs: vi.fn(),
}));

vi.mock('../lib/runs-api', () => ({
  listRuns: vi.fn(),
  deleteRun: vi.fn(),
}));

describe('RunsPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.listJobs).mockResolvedValue([]);
    vi.mocked(runsApi.listRuns).mockResolvedValue({
      runs: [
        {
          id: 'run-1',
          jobId: 'home-eb',
          provider: 'dummy',
          status: 'success',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
          durationMs: 1000,
          errorCode: null,
          errorMessage: null,
          screenshotPath: null,
          recoveryAttempted: false,
          recoverySucceeded: false,
          overlayActivated: false,
          billSummary: null,
        },
      ],
      total: 1,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders runs after a paginated list response', async () => {
    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('run-1')).toBeInTheDocument();
    expect(screen.getByText('home-eb')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('does not crash when the list payload omits runs', async () => {
    vi.mocked(runsApi.listRuns).mockResolvedValue({
      runs: undefined as unknown as never,
      total: 0,
    });

    render(
      <MemoryRouter>
        <RunsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument();
  });
});
