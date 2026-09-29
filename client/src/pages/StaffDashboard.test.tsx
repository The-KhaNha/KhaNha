import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has none; the filter row's edge fades use it.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const boardRenders = vi.hoisted(() => ({ count: 0 }));
// Stable, as useResource's data is: a new array every render would read as a new poll.
const noOrders = vi.hoisted(() => [] as never[]);
const updatedAt = vi.hoisted(() => Date.now());
vi.mock('../features/orders/StaffBoard', () => ({
  StaffBoard: () => {
    boardRenders.count += 1;
    return null;
  },
}));
vi.mock('../features/orders/useOrders', () => ({
  useOrders: () => ({
    orders: noOrders,
    isLoading: false,
    error: null,
    retry: () => {},
    mutate: () => {},
    updatedAt,
  }),
}));
vi.mock('../features/menu/useStore', () => ({
  useStore: () => ({ store: { name: 'Campus Cafe' } }),
}));
const { StaffDashboardPage } = await import('./StaffDashboard');

describe('StaffDashboardPage clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The header's clock ticks every second; the board holds up to hundreds of cards, so a tick must not re-render it.
  it('ticks the header clock without re-rendering the board', () => {
    render(
      <MemoryRouter>
        <StaffDashboardPage />
      </MemoryRouter>,
    );
    const afterMount = boardRenders.count;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(boardRenders.count).toBe(afterMount);
  });
});
