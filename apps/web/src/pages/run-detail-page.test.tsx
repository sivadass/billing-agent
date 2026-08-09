import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runsApi from '../lib/runs-api';
import { RunDetailPage } from './run-detail-page';

vi.mock('../lib/runs-api', () => ({
  getRun: vi.fn(),
  listRuns: vi.fn(),
}));

describe('RunDetailPage polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(runsApi.getRun)
      .mockResolvedValueOnce({
        id: 'r1',
        jobId: 'home-eb',
        provider: 'dummy',
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
        billSummary: null,
      })
      .mockResolvedValueOnce({
        id: 'r1',
        jobId: 'home-eb',
        provider: 'dummy',
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
        billSummary: { total: '10' },
      });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops polling once status is success', async () => {
    const flushAsync = async () => {
      await act(async () => {
        await Promise.resolve();
      });
    };

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
    expect(screen.getByText(/Status: running/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2200);
      await Promise.resolve();
    });

    await flushAsync();
    expect(runsApi.getRun).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Status: success/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(runsApi.getRun).toHaveBeenCalledTimes(2);
  });
});
