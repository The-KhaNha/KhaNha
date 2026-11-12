import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreSummary } from '../types/api';

const summary = (id: string, name: string, area: string | null): StoreSummary => ({
  id,
  slug: id,
  name,
  tagline: '',
  imageUrl: null,
  area,
  brand: { id: 'b', name: 'B', slug: 'b' },
  isOpen: true,
  openState: 'OPEN',
  nextChangeAt: null,
  openLabel: null,
});
const state = vi.hoisted(() => ({
  stores: null as StoreSummary[] | null,
  isLoading: false,
  error: null as null | { message: string; isUnreachable: boolean },
  retry: () => {},
  updatedAt: null as number | null,
}));
vi.mock('../features/stores/useStores', () => ({ useStores: () => state }));
const { StoreListPage } = await import('./StoreList');

const renderHome = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<StoreListPage />} />
        <Route path="/s/:slug" element={<p>Store page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('StoreListPage', () => {
  beforeEach(() => {
    state.stores = null;
    state.isLoading = false;
    state.error = null;
    state.retry = vi.fn();
    state.updatedAt = 1;
  });

  it('lists the stores grouped by area', () => {
    state.stores = [summary('a', 'Alpha', 'North'), summary('b', 'Beta', 'South')];
    renderHome();
    expect(screen.getByRole('heading', { name: 'North' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'South' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alpha/ })).toHaveAttribute('href', '/s/a');
    expect(screen.getByRole('link', { name: /Beta/ })).toHaveAttribute('href', '/s/b');
  });

  it('goes straight to the store when only one is active', () => {
    state.stores = [summary('a', 'Alpha', null)];
    renderHome();
    expect(screen.getByText('Store page')).toBeInTheDocument();
  });

  it('stays on a saved single store until a fresh answer, so the refresh is not dropped', () => {
    state.stores = [summary('a', 'Alpha', null)];
    state.updatedAt = null;
    renderHome();
    expect(screen.queryByText('Store page')).toBeNull();
    expect(screen.getByRole('link', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('offers a retry when the saved list is empty and the refresh failed', () => {
    state.stores = [];
    state.error = { message: 'offline', isUnreachable: true };
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('shows a loading state', () => {
    state.isLoading = true;
    renderHome();
    expect(screen.getByLabelText('Loading stores')).toBeInTheDocument();
  });

  it('says so when no store is open for ordering', () => {
    state.stores = [];
    renderHome();
    expect(screen.getByText('No stores are open for ordering.')).toBeInTheDocument();
  });

  it('shows the error with a retry when nothing is saved', () => {
    state.error = { message: 'offline', isUnreachable: true };
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it('keeps the saved list and offers a retry when the refresh failed', () => {
    state.stores = [summary('a', 'Alpha', 'N'), summary('b', 'Beta', 'N')];
    state.error = { message: 'offline', isUnreachable: true };
    renderHome();
    expect(screen.getByText('Showing saved stores')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alpha/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
});
