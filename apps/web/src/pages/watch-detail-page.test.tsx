import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as watchesApi from '../lib/watches-api';
import { WatchDetailPage } from './watch-detail-page';

vi.mock('../lib/watches-api', () => ({
  getWatch: vi.fn(),
  listWatchChecks: vi.fn(),
  runWatchNow: vi.fn(),
}));

describe('WatchDetailPage', () => {
  beforeEach(() => {
    vi.mocked(watchesApi.getWatch).mockResolvedValue({
      id: 'watch-1',
      url: 'https://example.com/products/demo',
      title: 'Demo watch',
      enabled: true,
      schedule: '0 9 * * *',
      lastPrice: 100,
      lastCurrency: 'INR',
      lastSource: 'shopify_json',
      lastCheckedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    vi.mocked(watchesApi.listWatchChecks).mockResolvedValue([
      {
        id: 'check-1',
        watchId: 'watch-1',
        status: 'success',
        price: 100,
        currency: 'INR',
        source: 'shopify_json',
        previousPrice: null,
        dropped: false,
        error: null,
        checkedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(watchesApi.runWatchNow).mockResolvedValue({ id: 'check-2' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads watch details and triggers check-now', async () => {
    render(
      <MemoryRouter initialEntries={['/watches/watch-1']}>
        <Routes>
          <Route path="/watches/:watchId" element={<WatchDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Demo watch' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /check now/i }));
    await waitFor(() => {
      expect(watchesApi.runWatchNow).toHaveBeenCalledWith('watch-1');
    });
  });
});
