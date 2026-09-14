import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import { JobFormPage } from './job-form-page';

vi.mock('../lib/jobs-api', () => ({
  listProviders: vi.fn(),
  getJob: vi.fn(),
  getJobSecrets: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  updateJobSecrets: vi.fn(),
}));

describe('JobFormPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.listProviders).mockResolvedValue({
      providers: [
        { id: 'tnpdcl', credentialKeys: ['username', 'password'] },
        { id: 'dummy', credentialKeys: [] },
      ],
    });
    vi.mocked(jobsApi.createJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill alert' },
    });
    vi.mocked(jobsApi.getJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill alert' },
    });
    vi.mocked(jobsApi.getJobSecrets).mockResolvedValue({
      keys: [
        { key: 'username', set: true },
        { key: 'password', set: true },
      ],
    });
    vi.mocked(jobsApi.updateJob).mockResolvedValue({
      id: 'home-eb',
      provider: 'tnpdcl',
      enabled: true,
      schedule: null,
      notify: { title: 'Bill alert' },
    });
    vi.mocked(jobsApi.updateJobSecrets).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a job with secrets and null schedule when schedule is empty', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs/new']}>
        <Routes>
          <Route path="/jobs/new" element={<JobFormPage />} />
          <Route path="/jobs" element={<div>Jobs route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/job id/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/job id/i), {
      target: { value: 'home-eb' },
    });
    fireEvent.change(screen.getByLabelText(/notify title/i), {
      target: { value: 'Bill alert' },
    });
    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: 'user1' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'pass1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.createJob).toHaveBeenCalledWith({
        id: 'home-eb',
        provider: 'tnpdcl',
        enabled: true,
        schedule: null,
        notify: { title: 'Bill alert' },
        secrets: { username: 'user1', password: 'pass1' },
      });
    });
    expect(screen.queryByRole('button', { name: /add credential/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Jobs route')).toBeInTheDocument();
  });

  it('updates job fields and only changed secrets on edit', async () => {
    render(
      <MemoryRouter initialEntries={['/jobs/home-eb']}>
        <Routes>
          <Route path="/jobs/:jobId" element={<JobFormPage />} />
          <Route path="/jobs" element={<div>Jobs route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^username$/i), {
      target: { value: 'new-user' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.updateJob).toHaveBeenCalledWith('home-eb', {
        id: 'home-eb',
        provider: 'tnpdcl',
        enabled: true,
        schedule: null,
        notify: { title: 'Bill alert' },
      });
      expect(jobsApi.updateJobSecrets).toHaveBeenCalledWith('home-eb', {
        username: 'new-user',
      });
    });
  });
});
