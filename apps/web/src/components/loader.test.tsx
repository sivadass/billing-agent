import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Loader } from './loader';

const ASPECT = 33 / 32;

describe('Loader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders with width from size and height preserving 32:33 aspect ratio', () => {
    const size = 64;
    render(<Loader size={size} />);
    const svg = screen.getByRole('img', { name: /loading/i });

    expect(svg).toHaveAttribute('width', String(size));
    expect(svg).toHaveAttribute('height', String(size * ASPECT));
    expect(svg).toHaveAttribute('viewBox', '0 0 32 33');
  });

  it('applies className to the svg', () => {
    render(<Loader size={48} className="my-loader" />);

    expect(screen.getByRole('img', { name: /loading/i })).toHaveClass('my-loader');
  });
});
