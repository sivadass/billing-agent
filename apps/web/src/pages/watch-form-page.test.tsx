import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as watchesApi from '../lib/watches-api';
import { WatchFormPage } from './watch-form-page';

vi.mock('../lib/watches-api', () => ({
  getWatch: vi.fn(),
  createWatch: vi.fn(),
  updateWatch: vi.fn(),
}));

describe('WatchFormPage', () => {
  beforeEach(() => {
    vi.mocked(watchesApi.createWatch).mockResolvedValue({
      id: 'watch-1',
      url: 'https://example.com/products/demo',
      title: 'Demo watch',
      enabled: true,
      schedule: '0 9 * * *',
      lastPrice: null,
      lastCurrency: null,
      lastSource: null,
      lastCheckedAt: null,
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a watch and navigates back to list', async () => {
    render(
      <MemoryRouter initialEntries={['/watches/new']}>
        <Routes>
          <Route path="/watches/new" element={<WatchFormPage />} />
          <Route path="/watches" element={<div>Watches route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/watch id/i), {
      target: { value: 'watch-1' },
    });
    fireEvent.change(screen.getByLabelText(/^url$/i), {
      target: { value: 'https://example.com/products/demo' },
    });
    fireEvent.change(screen.getByLabelText(/title \(optional\)/i), {
      target: { value: 'Demo watch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save watch/i }));

    await waitFor(() => {
      expect(watchesApi.createWatch).toHaveBeenCalled();
    });
    expect(await screen.findByText('Watches route')).toBeInTheDocument();
  });
});
