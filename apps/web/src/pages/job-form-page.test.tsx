import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import { JobFormPage } from './job-form-page';

vi.mock('../lib/jobs-api', () => ({
  getJob: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
}));

describe('JobFormPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.createJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: { username: 'TNPDCL_USERNAME_ENV' },
      notify: { title: 'Bill alert' },
    });
    vi.mocked(jobsApi.getJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: { username: 'TNPDCL_USERNAME_ENV' },
      notify: { title: 'Bill alert' },
    });
    vi.mocked(jobsApi.updateJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      credentialsEnv: { username: 'TNPDCL_USERNAME_ENV' },
      notify: { title: 'Bill alert' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a job with credentialsEnv and null schedule when schedule is empty', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs/new']}>
        <Routes>
          <Route path="/jobs/new" element={<JobFormPage />} />
          <Route path="/jobs" element={<div>Jobs route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/job id/i), {
      target: { value: 'home-eb' },
    });
    fireEvent.change(screen.getByLabelText(/notify title/i), {
      target: { value: 'Bill alert' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add credential/i }));
    fireEvent.change(screen.getByLabelText(/credential key 1/i), {
      target: { value: 'username' },
    });
    fireEvent.change(screen.getByLabelText(/environment name 1/i), {
      target: { value: 'TNPDCL_USERNAME_ENV' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.createJob).toHaveBeenCalledWith({
        id: 'home-eb',
        provider: 'tnpdcl',
        enabled: true,
        schedule: null,
        credentialsEnv: { username: 'TNPDCL_USERNAME_ENV' },
        notify: { title: 'Bill alert' },
      });
    });
    expect(await screen.findByText('Jobs route')).toBeInTheDocument();
  });
});
