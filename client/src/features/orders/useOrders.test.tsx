import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }));
const fetchOrders = vi.fn(async () => [] as unknown[]);
const fetchStoreOrders = vi.fn(async (_storeId: string) => [] as unknown[]);
vi.mock('../../services/orders', () => ({
  fetchOrders: () => fetchOrders(),
  fetchStoreOrders: (storeId: string) => fetchStoreOrders(storeId),
}));
const polling = { staffBoardMs: 100, ordersMs: 5000 };
vi.mock('../config/useConfig', () => ({ useConfig: () => ({ polling }) }));

const { useOrders } = await import('./useOrders');

// Fake timers: runs timers and microtasks inside act, so no test waits on the wall clock.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** What a phone does when the tab goes to the background or comes back: the flag, then the event. */
function setTabVisible(visible: boolean): void {
  const state = visible ? 'visible' : 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !visible });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the staff board poll', () => {
  afterEach(() => {
    // Restore jsdom's own getters.
    delete (document as { hidden?: boolean }).hidden;
    delete (document as { visibilityState?: string }).visibilityState;
    fetchOrders.mockClear();
    fetchStoreOrders.mockClear();
    vi.useRealTimers();
  });

  it('polls at the staff interval, stops while the tab is hidden and fetches at once when it is visible again', async () => {
    vi.useFakeTimers();
    renderHook(() => useOrders({ audience: 'staff', storeId: 'store-1' }));
    await advance(0);
    expect(fetchStoreOrders).toHaveBeenCalledTimes(1);

    await advance(100);
    expect(fetchStoreOrders).toHaveBeenCalledTimes(2); // polling, at staffBoardMs rather than ordersMs

    act(() => setTabVisible(false));
    await advance(1000); // ten poll intervals in the background
    expect(fetchStoreOrders).toHaveBeenCalledTimes(2);

    act(() => setTabVisible(true));
    await advance(0);
    expect(fetchStoreOrders).toHaveBeenCalledTimes(3); // back in the foreground: no waiting for the next tick
    await advance(100);
    expect(fetchStoreOrders).toHaveBeenCalledTimes(4); // and polling again
  });

  it('a board polls nothing until its store is known', async () => {
    vi.useFakeTimers();
    renderHook(() => useOrders({ audience: 'staff' }));
    await advance(1000);
    // Neither the board nor, by mistake, the caller's own orders.
    expect(fetchStoreOrders).not.toHaveBeenCalled();
    expect(fetchOrders).not.toHaveBeenCalled();
  });
});
