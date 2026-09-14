import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageLightbox } from './image-lightbox';

const SRC = 'https://b2.example/signed.png';

describe('ImageLightbox', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('renders a thumbnail and keeps the full-size viewer closed', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);

    const button = screen.getByRole('button', { name: /view page snapshot full size/i });
    const thumbnail = button.querySelector('img');
    expect(thumbnail).toHaveAttribute('src', SRC);
    expect(thumbnail).toHaveAttribute('alt', '');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a full-size dialog in a portal when the thumbnail is clicked', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);

    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    const dialog = screen.getByRole('dialog', { name: 'Page snapshot' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByRole('img', { name: 'Page snapshot' })).toHaveAttribute('src', SRC);
  });

  it('moves focus to the close button and locks body scroll while open', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes when Escape is pressed', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes when the overlay is clicked', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    fireEvent.click(screen.getByRole('dialog', { name: 'Page snapshot' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the close button is clicked', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open when the full-size image is clicked', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    fireEvent.click(screen.getByRole('button', { name: /view page snapshot full size/i }));

    fireEvent.click(screen.getByRole('img', { name: 'Page snapshot' }));

    expect(screen.getByRole('dialog', { name: 'Page snapshot' })).toBeInTheDocument();
  });

  it('returns focus to the thumbnail trigger after closing', () => {
    render(<ImageLightbox src={SRC} alt="Page snapshot" />);
    const trigger = screen.getByRole('button', { name: /view page snapshot full size/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(trigger).toHaveFocus();
  });
});
