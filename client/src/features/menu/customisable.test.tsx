import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddControl } from '../../components/AddControl';
import { CartItem } from '../../components/CartItem';
import type { MenuItem } from '../../types/api';
import { useCartStore, type CartLine } from '../cart/cartStore';
import { AddToCartContext } from '../cart/useAddToCart';

const chai = {
  id: 'chai',
  name: 'Chai',
  price: 50,
  imageUrl: null,
  isAvailable: true,
  stockQuantity: null,
  modifierGroupIds: ['size'],
} as unknown as MenuItem;

beforeEach(() => {
  useCartStore.setState({ lines: [], limits: { maxQuantityPerItem: 10, lowStockThreshold: 5 } });
});

describe('an item with choices (P3.2)', () => {
  it("its card's Add opens the sheet instead of adding", () => {
    const add = vi.fn(() => true);
    const onCustomise = vi.fn();
    render(
      <AddToCartContext.Provider value={add}>
        <AddControl item={chai} photoRef={createRef()} onCustomise={onCustomise} />
      </AddToCartContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose options for Chai' }));
    expect(onCustomise).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });

  it('its cart line lists the options under the name', () => {
    const line: CartLine = {
      lineKey: 'chai:large,oat',
      menuItemId: 'chai',
      options: [
        { id: 'large', groupName: 'Size', name: 'Large', priceDelta: 20 },
        { id: 'oat', groupName: 'Milk', name: 'Oat milk', priceDelta: 30 },
      ],
      name: 'Chai',
      unitPrice: 100,
      imageUrl: null,
      quantity: 1,
      maxQuantity: null,
    };
    useCartStore.setState({ lines: [line] });
    render(<CartItem line={line} />);
    expect(screen.getByText('Large, Oat milk')).toBeInTheDocument();
  });
});
