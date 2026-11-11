import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuResponse } from '../types/api';

// jsdom has neither; the menu's category chips observe layout.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);

const menu: MenuResponse = {
  store: {
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
    prepTimeMinMinutes: 10,
    prepTimeMaxMinutes: 15,
  },
  popular: [],
  categories: [],
};
const state = vi.hoisted(() => ({
  error: null as null | { message: string; isUnreachable: boolean },
  retry: () => {},
}));
vi.mock('../features/menu/useMenu', () => ({
  useMenu: () => ({ menu, isLoading: false, error: state.error, retry: state.retry }),
}));
const { MenuPage } = await import('./Menu');

const renderMenu = () =>
  render(
    <MemoryRouter>
      <MenuPage />
    </MemoryRouter>,
  );

describe('MenuPage with a saved menu', () => {
  beforeEach(() => {
    state.error = null;
    state.retry = vi.fn();
  });

  it('shows the saved menu with no notice when the refresh succeeded', () => {
    renderMenu();
    expect(screen.getByRole('heading', { name: 'Campus Cafe' })).toBeInTheDocument();
    // An empty menu (this one has no items) is an EmptyState, never a blank page under the cover.
    expect(screen.getByText('Nothing on the menu right now.')).toBeInTheDocument();
    expect(screen.queryByText('Showing your saved menu')).not.toBeInTheDocument();
  });

  it('keeps the saved menu and shows a retry notice when the refresh failed', () => {
    state.error = { message: 'offline', isUnreachable: true };
    renderMenu();
    expect(screen.getByRole('heading', { name: 'Campus Cafe' })).toBeInTheDocument();
    expect(screen.getByText('Showing your saved menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
});
