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

describe('useReorder with options (P3.2)', () => {
  const chai = { ...bun, id: 'chai', name: 'Chai', price: 50, modifierGroupIds: ['size', 'milk'] };
  const opt = (id: string, priceDelta: number, isDefault = false) => ({
    id,
    name: id,
    priceDelta,
    isDefault,
    isAvailable: true,
  });
  const optionsMenu = (sizeDefault: boolean) =>
    ({
      categories: [{ name: 'Hot', items: [chai] }],
      modifierGroups: {
        size: {
          id: 'size',
          name: 'Size',
          minSelect: 1,
          maxSelect: 1,
          options: [opt('small', 0, sizeDefault), opt('large', 20)],
        },
        milk: { id: 'milk', name: 'Milk', minSelect: 0, maxSelect: 1, options: [opt('soy', 15)] },
      },
    }) as unknown as MenuResponse;
  const reorderOf = (modifiers: { optionId: string | null; optionName: string }[]) =>
    ({
      id: 'o2',
      store: { id: 's2', name: 'Bakery', slug: 'bakery' },
      items: [
        {
          menuItemId: 'chai',
          name: 'Chai',
          quantity: 1,
          modifiers: modifiers.map((m) => ({ ...m, groupName: 'x', priceDelta: 0 })),
        },
      ],
    }) as Order;

  beforeEach(() => {
    useCartStore.setState({ storeId: null, storeSlug: null, storeName: null, lines: [] });
  });

  it('re-adds the options the menu still has, and drops a gone one', async () => {
    fetchStoreMenu.mockResolvedValue(optionsMenu(false));
    const { result } = renderHook(() => useReorder(), { wrapper });
    await act(async () =>
      result.current.reorder(
        reorderOf([
          { optionId: 'large', optionName: 'Large' },
          { optionId: null, optionName: 'Oat' },
        ]),
      ),
    );
    await act(async () => {});
    const [line] = useCartStore.getState().lines;
    expect(line?.options.map((o) => o.id)).toEqual(['large']);
    expect(line?.unitPrice).toBe(70);
  });

  it('fills a required group the old line lacks from its default, or skips the line without one', async () => {
    fetchStoreMenu.mockResolvedValue(optionsMenu(true));
    const { result } = renderHook(() => useReorder(), { wrapper });
    await act(async () => result.current.reorder(reorderOf([])));
    await act(async () => {});
    expect(useCartStore.getState().lines[0]?.options.map((o) => o.id)).toEqual(['small']);

    useCartStore.setState({ storeId: null, storeSlug: null, storeName: null, lines: [] });
    fetchStoreMenu.mockResolvedValue(optionsMenu(false));
    await act(async () => result.current.reorder(reorderOf([])));
    await act(async () => {});
    expect(useCartStore.getState().lines).toEqual([]);
  });
});
