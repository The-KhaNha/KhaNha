import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../types/api';
import { StoreCard } from './StoreCard';
import { OpenPill } from './OpenPill';

const store: Store = {
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
  openState: 'OPEN',
  nextChangeAt: null,
  openLabel: null,
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

describe('StoreCard compact', () => {
  const renderCompact = (priority = false, overrides: Partial<Store> = {}) =>
    render(
      <MemoryRouter>
        <StoreCard
          variant="compact"
          store={{ ...store, area: 'North Gate', ...overrides }}
          priority={priority}
        />
      </MemoryRouter>,
    );

  it('is one link to the store page with its name, area and open state', () => {
    renderCompact(false, { openLabel: 'Closes at 9:00 PM' });
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/s/cafe');
    expect(link).toHaveTextContent('Campus Cafe');
    expect(link).toHaveTextContent('North Gate');
    expect(link).toHaveTextContent('Closes at 9:00 PM');
  });

  it('loads the photo lazily, or eagerly with high priority for the first card', () => {
    const { container, unmount } = renderCompact();
    const lazy = container.querySelector('img')!;
    expect(lazy.getAttribute('loading')).toBe('lazy');
    expect(lazy.getAttribute('fetchpriority')).toBeNull();
    unmount();
    const first = renderCompact(true).container.querySelector('img')!;
    expect(first.getAttribute('loading')).toBe('eager');
    expect(first.getAttribute('fetchpriority')).toBe('high');
    expect(first.getAttribute('srcset')).toContain('cafe-cover-400.jpg 400w');
  });
});

describe('OpenPill', () => {
  it.each([
    ['OPEN', null, 'Open'],
    ['CLOSING_SOON', null, 'Closing soon'],
    ['CLOSED', null, 'Closed'],
    ['PAUSED', null, 'Paused'],
    ['UNAVAILABLE', null, 'Unavailable'],
    ['OPEN', 'Closes at 9:00 PM', 'Closes at 9:00 PM'],
    ['CLOSED', 'Opens tomorrow at 8:00 AM', 'Opens tomorrow at 8:00 AM'],
    ['CLOSED', 'Closed for Diwali', 'Closed for Diwali'],
    ['PAUSED', 'Paused · back at 3:40 PM', 'Paused · back at 3:40 PM'],
  ] as const)('%s with %s reads "%s"', (state, label, text) => {
    render(<OpenPill state={state} label={label} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
