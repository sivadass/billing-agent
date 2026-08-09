import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import { JobsPage } from './jobs-page';

vi.mock('../lib/jobs-api', () => ({
  listJobs: vi.fn(),
  runJobNow: vi.fn(),
  disableJob: vi.fn(),
  updateJob: vi.fn(),
}));

function RunRouteStub() {
  const { runId } = useParams<{ runId: string }>();
  return <div>Run detail route: {runId}</div>;
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.listJobs).mockResolvedValue([
      {
        id: 'home-eb',
        provider: 'dummy',
        enabled: true,
        schedule: '0 9 * * *',
        credentialsEnv: {},
        notify: { title: 'Bill reminder' },
      },
    ]);
    vi.mocked(jobsApi.runJobNow).mockResolvedValue({ id: 'run-123' });
    vi.mocked(jobsApi.disableJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'dummy',
      enabled: false,
      schedule: '0 9 * * *',
      credentialsEnv: {},
      notify: { title: 'Bill reminder' },
    });
    vi.mocked(jobsApi.updateJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'dummy',
      enabled: true,
      schedule: '0 9 * * *',
      credentialsEnv: {},
      notify: { title: 'Bill reminder' },
    });
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

    expect(await screen.findByText('Every day at 9:00 AM')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /run/i }));

    await waitFor(() => {
      expect(jobsApi.runJobNow).toHaveBeenCalledWith('home-eb');
    });
    expect(await screen.findByText('Run detail route: run-123')).toBeInTheDocument();
  });
});
