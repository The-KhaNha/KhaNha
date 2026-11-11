import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreCard } from './StoreCard';

const store = {
  id: 's1',
  slug: 'cafe',
  brand: { id: 'b1', name: 'Cafe', slug: 'cafe' },
  area: null,
  address: null,
  name: 'Campus Cafe',
  tagline: 'Coffee',
  description: 'Quick bites.',
  imageUrl: '/images/cafe-cover.jpg',
  isOpen: true,
  prepTimeMinMinutes: 10,
  prepTimeMaxMinutes: 15,
};

describe('StoreCard cover', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks for the cover first (the page’s largest paint), without a React warning', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MemoryRouter>
        <StoreCard store={store} />
      </MemoryRouter>,
    );
    const img = screen.getByAltText('Campus Cafe storefront');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('srcset')).toContain('cafe-cover-400.jpg 400w');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
