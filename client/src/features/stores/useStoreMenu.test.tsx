import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuResponse } from '../../types/api';

const menu = {
  store: { id: 's1' },
  rules: {},
  categories: [
    {
      name: 'Drinks',
      items: [
        {
          id: 't1',
          name: 'Tea',
          price: 20,
          isAvailable: true,
          stockQuantity: null,
          modifierGroupIds: ['g1'],
        },
      ],
    },
  ],
  modifierGroups: {
    g1: {
      id: 'g1',
      name: 'Size',
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: 'o1', name: 'Big', priceDelta: 0, isAvailable: true }],
    },
  },
} as unknown as MenuResponse;

vi.mock('../../lib/useResource', () => ({
  useResource: () => ({ data: menu, isLoading: false, error: null, reload: vi.fn() }),
}));
const { useCartStore } = await import('../cart/cartStore');
const { useStoreMenu } = await import('./useStoreMenu');

const line = {
  lineKey: 't1:gone',
  menuItemId: 't1',
  name: 'Tea',
  unitPrice: 20,
  options: [{ id: 'gone', groupId: 'g1', groupName: 'Size', name: 'Old', priceDelta: 0 }],
  imageUrl: null,
  quantity: 1,
  maxQuantity: null,
};

beforeEach(() =>
  useCartStore.setState({ storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', lines: [] }),
);

describe('useStoreMenu', () => {
  it('flags a line that reaches the cart after the menu loaded (another tab)', () => {
    renderHook(() => useStoreMenu('cafe'));
    act(() => useCartStore.setState({ lines: [line] }));
    expect(useCartStore.getState().lines[0]?.optionsStale).toBe(true);
  });
});
