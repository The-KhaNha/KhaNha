import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '../types/api';

// jsdom has neither; StoreCard's layout uses them.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);

const store: Store = {
  id: 's1',
  slug: 'cafe',
  brand: { id: 'b1', name: 'Cafe', slug: 'cafe' },
  area: null,
  address: null,
  name: 'Campus Cafe',
  tagline: 'Coffee',
  description: '',
  imageUrl: null,
  isOpen: true,
  openState: 'OPEN',
  nextChangeAt: null,
  openLabel: null,
  prepTimeMinMinutes: 10,
  prepTimeMaxMinutes: 15,
};
const state = vi.hoisted(() => ({
  error: null as null | { message: string; isUnreachable: boolean },
  retry: () => {},
}));
vi.mock('../features/stores/useStores', () => ({
  useStoreByRef: () => ({ store, isLoading: false, error: state.error, retry: state.retry }),
}));
const { HomePage } = await import('./Home');

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe('HomePage with a saved shop', () => {
  beforeEach(() => {
    state.error = null;
    state.retry = vi.fn();
  });

  it('shows the saved shop with no notice when the refresh succeeded', () => {
    renderHome();
    expect(screen.getByText('Campus Cafe')).toBeInTheDocument();
    expect(screen.queryByText('Showing saved shop details')).not.toBeInTheDocument();
  });

  it('keeps the saved shop and shows a retry notice when the refresh failed', () => {
    state.error = { message: 'offline', isUnreachable: true };
    renderHome();
    expect(screen.getByText('Campus Cafe')).toBeInTheDocument();
    expect(screen.getByText('Showing saved shop details')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
});
