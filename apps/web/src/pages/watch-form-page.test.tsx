import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    vi.mocked(watchesApi.getWatch).mockResolvedValue({
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

    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Price watches' })).toHaveAttribute(
      'href',
      '/watches',
    );
    expect(within(crumb).getByText('Create watch')).toBeInTheDocument();

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

  it('shows a nested edit trail back to the watch detail', async () => {
    render(
      <MemoryRouter initialEntries={['/watches/watch-1/edit']}>
        <Routes>
          <Route path="/watches/:watchId/edit" element={<WatchFormPage />} />
          <Route path="/watches/:watchId" element={<div>Watch detail route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: 'Demo watch' });
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Price watches' })).toHaveAttribute(
      'href',
      '/watches',
    );
    expect(within(crumb).getByRole('link', { name: 'Demo watch' })).toHaveAttribute(
      'href',
      '/watches/watch-1',
    );
    expect(within(crumb).getByText('Edit')).toBeInTheDocument();
  });
});
