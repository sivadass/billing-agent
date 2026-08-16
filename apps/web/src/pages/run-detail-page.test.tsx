import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runsApi from '../lib/runs-api';
import type { RunDocument } from '../lib/types';
import { RunDetailPage } from './run-detail-page';

vi.mock('../lib/runs-api', () => ({
  getRun: vi.fn(),
  listRuns: vi.fn(),
}));

function canonicalRun(overrides: Partial<RunDocument> = {}): RunDocument {
  return {
    id: 'r1',
    jobId: 'home-eb',
    engine: 'adapter',
    adapterId: 'dummy',
    status: 'running',
    startedAt: '2026-08-09T08:00:00.000Z',
    finishedAt: null,
    durationMs: null,
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

const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('RunDetailPage polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(runsApi.getRun)
      .mockResolvedValueOnce(canonicalRun())
      .mockResolvedValueOnce(
        canonicalRun({
          status: 'success',
          finishedAt: '2026-08-09T08:00:05.000Z',
          durationMs: 5000,
          result: { amount: 1234.5 },
        }),
      );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops polling once status is success', async () => {
    render(
      <MemoryRouter initialEntries={['/runs/r1']}>
        <Routes>
          <Route path="/runs/:runId" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await flushAsync();
    await flushAsync();
    expect(runsApi.getRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText('running')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });

    await flushAsync();
    expect(runsApi.getRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText('success')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(runsApi.getRun).toHaveBeenCalledTimes(2);
  });
});

describe('RunDetailPage result', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders every result key and value and the engine', async () => {
    vi.mocked(runsApi.getRun).mockResolvedValue(
      canonicalRun({
        status: 'success',
        finishedAt: '2026-08-09T08:00:05.000Z',
        durationMs: 5000,
        adapterId: 'tnpdcl',
        result: { amount: 1234.5, dueDate: '2026-09-01' },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/runs/r1']}>
        <Routes>
          <Route path="/runs/:runId" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Result')).toBeInTheDocument();
    expect(screen.getByText('amount')).toBeInTheDocument();
    expect(screen.getByText('1234.5')).toBeInTheDocument();
    expect(screen.getByText('dueDate')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
    expect(screen.getByText('adapter:tnpdcl')).toBeInTheDocument();
    expect(screen.queryByText('Bill summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
  });

  it('shows an empty state when the run has no result', async () => {
    vi.mocked(runsApi.getRun).mockResolvedValue(
      canonicalRun({ status: 'success', finishedAt: '2026-08-09T08:00:05.000Z', durationMs: 5000 }),
    );

    render(
      <MemoryRouter initialEntries={['/runs/r1']}>
        <Routes>
          <Route path="/runs/:runId" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('No result for this run.')).toBeInTheDocument();
  });
});
