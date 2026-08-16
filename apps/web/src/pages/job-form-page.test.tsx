import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jobsApi from '../lib/jobs-api';
import type { JobDocument } from '../lib/types';
import { JobFormPage } from './job-form-page';

vi.mock('../lib/jobs-api', () => ({
  getJob: vi.fn(),
  updateJob: vi.fn(),
  getJobSecrets: vi.fn(),
  updateJobSecrets: vi.fn(),
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
    secretIds: ['secret-1'],
    notify: {
      title: 'Bill alert',
      on: 'always',
      channel: { type: 'ntfy', topic: 'bills' },
    },
    lastResult: null,
    createdAt: '2026-08-09T08:00:00.000Z',
    updatedAt: '2026-08-09T08:00:00.000Z',
    ...overrides,
  };
}

function renderEditForm(initialEntry = '/jobs/home-eb') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/jobs/new" element={<JobFormPage />} />
        <Route path="/jobs/:jobId" element={<JobFormPage />} />
        <Route path="/jobs" element={<div>Jobs route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobFormPage', () => {
  beforeEach(() => {
    vi.mocked(jobsApi.getJob).mockResolvedValue(canonicalJob());
    vi.mocked(jobsApi.updateJob).mockResolvedValue(canonicalJob());
    vi.mocked(jobsApi.getJobSecrets).mockResolvedValue([
      { key: 'password', set: true },
      { key: 'username', set: true },
    ]);
    vi.mocked(jobsApi.updateJobSecrets).mockResolvedValue([
      { key: 'password', set: true },
      { key: 'username', set: true },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a read-only engine and no provider or credentials env fields', async () => {
    renderEditForm();

    const engine = await screen.findByLabelText(/engine/i);
    expect(engine).toHaveValue('adapter:tnpdcl');
    expect(engine).toBeDisabled();
    expect(screen.queryByLabelText(/provider/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/credentials env/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add credential/i })).not.toBeInTheDocument();
  });

  it('shows notify title, notify on, and notify channel fields', async () => {
    renderEditForm();

    expect(await screen.findByLabelText(/notify title/i)).toHaveValue('Bill alert');
    expect(screen.getByText('Notify on')).toBeInTheDocument();
    expect(screen.getByText('Notify channel')).toBeInTheDocument();
    expect(screen.getByLabelText(/ntfy topic/i)).toHaveValue('bills');
  });

  it('reports which secret keys are set without ever showing a value', async () => {
    renderEditForm();

    expect(await screen.findByText('password')).toBeInTheDocument();
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getAllByText('set')).toHaveLength(2);

    const passwordInput = screen.getByLabelText(/new value for password/i);
    expect(passwordInput).toHaveValue('');
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('writes a changed secret with PUT and saves the job', async () => {
    renderEditForm();

    fireEvent.change(await screen.findByLabelText(/new value for password/i), {
      target: { value: 'new-pass' },
    });
    fireEvent.change(screen.getByLabelText(/notify title/i), {
      target: { value: 'Renamed alert' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.updateJobSecrets).toHaveBeenCalledWith('home-eb', {
        password: 'new-pass',
      });
    });
    expect(jobsApi.updateJob).toHaveBeenCalledWith('home-eb', {
      name: 'Home EB bill',
      enabled: true,
      schedule: '0 9 * * *',
      notify: {
        title: 'Renamed alert',
        on: 'always',
        channel: { type: 'ntfy', topic: 'bills' },
      },
    });
    expect(await screen.findByText('Jobs route')).toBeInTheDocument();
  });

  it('does not call the secrets endpoint when no new value was typed', async () => {
    renderEditForm();

    fireEvent.click(await screen.findByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.updateJob).toHaveBeenCalled();
    });
    expect(jobsApi.updateJobSecrets).not.toHaveBeenCalled();
  });

  it('adds a brand new secret key', async () => {
    renderEditForm();

    fireEvent.click(await screen.findByRole('button', { name: /add secret/i }));
    fireEvent.change(screen.getByLabelText(/secret key 1/i), {
      target: { value: 'pin' },
    });
    fireEvent.change(screen.getByLabelText(/secret value 1/i), {
      target: { value: '4321' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    await waitFor(() => {
      expect(jobsApi.updateJobSecrets).toHaveBeenCalledWith('home-eb', { pin: '4321' });
    });
  });

  it('keeps the job unsaved and surfaces the error when the secret write fails', async () => {
    vi.mocked(jobsApi.updateJobSecrets).mockRejectedValue(
      new Error('Job already running'),
    );
    renderEditForm();

    fireEvent.change(await screen.findByLabelText(/new value for password/i), {
      target: { value: 'new-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save job/i }));

    expect(await screen.findByText('Job already running')).toBeInTheDocument();
    expect(jobsApi.updateJob).not.toHaveBeenCalled();
  });

  it('directs job creation to chat instead of the form', async () => {
    renderEditForm('/jobs/new');

    expect(await screen.findByText(/jobs are created from chat/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save job/i })).not.toBeInTheDocument();
    expect(jobsApi.getJob).not.toHaveBeenCalled();
  });
});
