import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MenuItem } from '../../types/api';
import { AddToCartProvider } from './AddToCart';
import { useCartStore } from './cartStore';
import { useAddToCart } from './useAddToCart';

const item = {
  id: 'b1',
  name: 'Bun',
  price: 30,
  imageUrl: null,
  isAvailable: true,
} as unknown as MenuItem;
const bakery = { id: 's2', slug: 'bakery', name: 'Bakery' };
const cafeLine = {
  menuItemId: 'c1',
  name: 'Tea',
  unitPrice: 20,
  imageUrl: null,
  quantity: 1,
  maxQuantity: null,
};

function AddButton() {
  const addToCart = useAddToCart();
  return <button onClick={() => addToCart(item)}>Add</button>;
}

const renderMenu = () =>
  render(
    <AddToCartProvider store={bakery} rules={undefined}>
      <AddButton />
    </AddToCartProvider>,
  );

beforeEach(() => {
  useCartStore.setState({ storeId: 's1', storeSlug: 'cafe', storeName: 'Cafe', lines: [cafeLine] });
});

describe('adding from another store', () => {
  it('asks first, and Keep leaves the cart as it was', () => {
    renderMenu();
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my cart' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useCartStore.getState().lines.map((l) => l.menuItemId)).toEqual(['c1']);
  });

  it('Replace starts a cart at the new store with the item', () => {
    renderMenu();
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByRole('button', { name: 'Replace with Bakery' }));
    expect(useCartStore.getState()).toMatchObject({ storeId: 's2', storeName: 'Bakery' });
    expect(useCartStore.getState().lines.map((l) => l.menuItemId)).toEqual(['b1']);
  });
});
