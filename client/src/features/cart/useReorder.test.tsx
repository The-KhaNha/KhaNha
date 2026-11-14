import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuResponse, Order } from '../../types/api';

const fetchStoreMenu = vi.hoisted(() => vi.fn());
vi.mock('../../services/stores', () => ({ fetchStoreMenu }));
const { useCartStore } = await import('./cartStore');
const { useReorder } = await import('./useReorder');

const bun = {
  id: 'b1',
  name: 'Bun',
  price: 30,
  imageUrl: null,
  isAvailable: true,
  stockQuantity: null,
};
const menu = { categories: [{ name: 'Bakes', items: [bun] }] } as unknown as MenuResponse;
const order = {
  id: 'o1',
  store: { id: 's2', name: 'Bakery', slug: 'bakery' },
  items: [{ menuItemId: 'b1', name: 'Bun', quantity: 2 }],
} as Order;
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

beforeEach(() => {
  fetchStoreMenu.mockReset().mockResolvedValue(menu);
  useCartStore.setState({
    storeId: 's1',
    storeSlug: 'cafe',
    storeName: 'Cafe',
    lines: [
      {
        lineKey: 'c1',
        menuItemId: 'c1',
        options: [],
        name: 'Tea',
        unitPrice: 20,
        imageUrl: null,
        quantity: 1,
        maxQuantity: null,
      },
    ],
  });
});

describe('useReorder with another store in the cart', () => {
  it('asks first and changes nothing on Keep', () => {
    const { result } = renderHook(() => useReorder(), { wrapper });
    act(() => result.current.reorder(order));
    expect(result.current.replace?.toName).toBe('Bakery');
    act(() => result.current.replace?.onKeep());
    expect(result.current.replace).toBeNull();
    expect(fetchStoreMenu).not.toHaveBeenCalled();
    expect(useCartStore.getState().storeId).toBe('s1');
  });

  it("replaces the cart with the order's store menu and items after Replace", async () => {
    const { result } = renderHook(() => useReorder(), { wrapper });
    act(() => result.current.reorder(order));
    await act(async () => result.current.replace?.onReplace());
    expect(fetchStoreMenu).toHaveBeenCalledWith('bakery');
    expect(useCartStore.getState()).toMatchObject({ storeId: 's2', storeSlug: 'bakery' });
    expect(useCartStore.getState().lines.map((l) => [l.menuItemId, l.quantity])).toEqual([
      ['b1', 2],
    ]);
  });

  it('keeps the old cart when the new menu cannot be loaded', async () => {
    fetchStoreMenu.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useReorder(), { wrapper });
    act(() => result.current.reorder(order));
    await act(async () => result.current.replace?.onReplace());
    expect(useCartStore.getState()).toMatchObject({ storeId: 's1' });
    expect(useCartStore.getState().lines).toHaveLength(1);
  });
});
