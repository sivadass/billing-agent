import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function renderForm(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/new" element={<JobFormPage />} />
        <Route path="/jobs/:jobId" element={<JobFormPage />} />
        <Route path="/jobs" element={<div>Jobs route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillRequiredCreateFields() {
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
}

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
      schedule: '0 9 * * *',
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

  it('groups the create form and defaults to a daily 9:00 AM schedule', async () => {
    renderForm('/jobs/new');

    await waitFor(() => {
      expect(screen.getByLabelText(/job id/i)).toBeInTheDocument();
    });

    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Jobs' })).toHaveAttribute(
      'href',
      '/jobs',
    );
    expect(within(crumb).getByText('Create job')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Job configuration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Provider credentials' })).toBeInTheDocument();
    expect(screen.getByText('Runs every day at 9:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create job/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    fillRequiredCreateFields();
    fireEvent.click(screen.getByRole('button', { name: /create job/i }));

    await waitFor(() => {
      expect(jobsApi.createJob).toHaveBeenCalledWith({
        id: 'home-eb',
        provider: 'tnpdcl',
        enabled: true,
        schedule: '0 9 * * *',
        notify: { title: 'Bill alert' },
        secrets: { username: 'user1', password: 'pass1' },
      });
    });
    expect(screen.queryByRole('button', { name: /add credential/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Jobs route')).toBeInTheDocument();
  });

  it('creates a manual job when schedule is set to Manual', async () => {
    renderForm('/jobs/new');

    await waitFor(() => {
      expect(screen.getByLabelText(/job id/i)).toBeInTheDocument();
    });

    fillRequiredCreateFields();
    fireEvent.click(screen.getByTestId('schedule-frequency-trigger'));
    fireEvent.click(screen.getByTestId('schedule-frequency-option-manual'));
    fireEvent.click(screen.getByRole('button', { name: /create job/i }));

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
  });

  it('updates job fields and only changed secrets on edit', async () => {
    renderForm('/jobs/home-eb');

    await waitFor(() => {
      expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    });

    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Jobs' })).toHaveAttribute(
      'href',
      '/jobs',
    );
    expect(within(crumb).getByText('home-eb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save job/i })).toBeInTheDocument();
    expect(screen.getByText('Runs only when triggered manually')).toBeInTheDocument();

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
