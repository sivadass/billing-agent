import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as watchesApi from '../lib/watches-api';
import { WatchesPage } from './watches-page';

vi.mock('../lib/watches-api', () => ({
  listWatches: vi.fn(),
  listWatchChecks: vi.fn(),
  runWatchNow: vi.fn(),
  updateWatch: vi.fn(),
  deleteWatch: vi.fn(),
}));

describe('WatchesPage', () => {
  beforeEach(() => {
    vi.mocked(watchesApi.listWatches).mockResolvedValue([
      {
        id: 'watch-1',
        url: 'https://example.com/products/demo',
        title: 'Demo watch',
        enabled: true,
        schedule: '0 9 * * *',
        lastPrice: 120,
        lastCurrency: 'INR',
        lastSource: 'shopify_json',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(watchesApi.listWatchChecks).mockResolvedValue([
      {
        id: 'check-1',
        watchId: 'watch-1',
        status: 'success',
        price: 120,
        currency: 'INR',
        source: 'shopify_json',
        previousPrice: null,
        dropped: false,
        error: null,
        checkedAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(watchesApi.runWatchNow).mockResolvedValue({ id: 'check-2' });
    vi.mocked(watchesApi.updateWatch).mockResolvedValue({
      id: 'watch-1',
      url: 'https://example.com/products/demo',
      title: 'Demo watch',
      enabled: false,
      schedule: '0 9 * * *',
      lastPrice: 120,
      lastCurrency: 'INR',
      lastSource: 'shopify_json',
      lastCheckedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    vi.mocked(watchesApi.deleteWatch).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders watches and triggers check-now', async () => {
    render(
      <MemoryRouter initialEntries={['/watches']}>
        <Routes>
          <Route path="/watches" element={<WatchesPage />} />
          <Route path="/watches/new" element={<div>Create watch</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Demo watch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /check now/i }));

    await waitFor(() => {
      expect(watchesApi.runWatchNow).toHaveBeenCalledWith('watch-1');
    });
  });
});
