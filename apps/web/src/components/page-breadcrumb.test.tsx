import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PageBreadcrumb } from './page-breadcrumb';

describe('PageBreadcrumb', () => {
  it('renders the trail and navigates parent crumbs in-app', () => {
    render(
      <MemoryRouter initialEntries={['/jobs/new']}>
        <Routes>
          <Route
            path="/jobs/new"
            element={
              <PageBreadcrumb
                items={[
                  { label: 'Jobs', href: '/jobs' },
                  { label: 'Create job' },
                ]}
              />
            }
          />
          <Route path="/jobs" element={<div>Jobs index</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByText('Create job')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Jobs' }));
    expect(screen.getByText('Jobs index')).toBeInTheDocument();
  });
});
