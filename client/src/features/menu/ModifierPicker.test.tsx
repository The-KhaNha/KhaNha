import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem, ModifierGroup } from '../../types/api';
import { useCartStore } from '../cart/cartStore';
import { AddToCartContext } from '../cart/useAddToCart';
import { ItemDetailSheet } from './ItemDetailSheet';

const item = {
  id: 'chai',
  category: 'Hot',
  name: 'Chai',
  description: 'Masala chai',
  price: 50,
  imageUrl: null,
  isAvailable: true,
  stockQuantity: null,
  modifierGroupIds: ['size', 'add'],
} as unknown as MenuItem;
const opt = (id: string, priceDelta: number, extra: object = {}) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  priceDelta,
  isDefault: false,
  isAvailable: true,
  ...extra,
});
const groups: Record<string, ModifierGroup> = {
  size: {
    id: 'size',
    name: 'Size',
    minSelect: 1,
    maxSelect: 1,
    options: [opt('small', 0), opt('large', 20)],
  },
  add: {
    id: 'add',
    name: 'Add-ons',
    minSelect: 0,
    maxSelect: 2,
    options: [
      opt('honey', 10),
      opt('ginger', 5, { isAvailable: false }),
      opt('cream', 15),
      opt('mint', 5),
    ],
  },
};

function renderSheet(add = vi.fn(() => true)) {
  render(
    <AddToCartContext.Provider value={add}>
      <ItemDetailSheet item={item} groups={groups} onClose={() => {}} />
    </AddToCartContext.Provider>,
  );
  return add;
}
const addButton = () => screen.getByRole('button', { name: /add to cart/i });

beforeEach(() => {
  useCartStore.setState({ lines: [], limits: { maxQuantityPerItem: 10, lowStockThreshold: 5 } });
});

describe('ModifierPicker in the item sheet', () => {
  it('a one-choice group is radios, a many-choice one checkboxes; a sold-out option is off', () => {
    renderSheet();
    expect(screen.getByRole('radio', { name: /large/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /honey/i })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /ginger/i })).toBeDisabled();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });

  it('refuses to add with a required choice open, and says which', () => {
    const add = renderSheet();
    fireEvent.click(addButton());
    expect(add).not.toHaveBeenCalled();
    expect(screen.getByText('Choose one')).toBeInTheDocument();
  });

  it('prices the line live and adds it with its options', () => {
    const add = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: /large/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /honey/i }));
    expect(addButton()).toHaveTextContent('₹80');
    fireEvent.click(addButton());
    expect(add).toHaveBeenCalledWith(item, 1, [
      { id: 'large', groupName: 'Size', name: 'Large', priceDelta: 20 },
      { id: 'honey', groupName: 'Add-ons', name: 'Honey', priceDelta: 10 },
    ]);
  });

  it('starts the first item it opens with at its defaults', () => {
    const add = vi.fn(() => true);
    const withDefault = {
      ...groups,
      size: { ...groups.size!, options: [opt('small', 0, { isDefault: true }), opt('large', 20)] },
    };
    render(
      <AddToCartContext.Provider value={add}>
        <ItemDetailSheet item={item} groups={withDefault} onClose={() => {}} />
      </AddToCartContext.Provider>,
    );
    expect(screen.getByRole('radio', { name: /small/i })).toBeChecked();
    fireEvent.click(addButton());
    expect(add).toHaveBeenCalledWith(item, 1, [
      { id: 'small', groupName: 'Size', name: 'Small', priceDelta: 0 },
    ]);
  });

  it('a choice that sells out while the sheet is open frees its place', () => {
    const add = vi.fn(() => true);
    const ui = (g: Record<string, ModifierGroup>) => (
      <AddToCartContext.Provider value={add}>
        <ItemDetailSheet item={item} groups={g} onClose={() => {}} />
      </AddToCartContext.Provider>
    );
    const { rerender } = render(ui(groups));
    fireEvent.click(screen.getByRole('checkbox', { name: /honey/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /cream/i }));
    const creamOut = {
      ...groups,
      add: {
        ...groups.add!,
        options: groups.add!.options.map((o) =>
          o.id === 'cream' ? { ...o, isAvailable: false } : o,
        ),
      },
    };
    rerender(ui(creamOut));
    expect(screen.getByRole('checkbox', { name: /cream/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /mint/i })).toBeEnabled();
  });

  it('switches the rest off once a group is at its maximum', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: /honey/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /cream/i }));
    expect(screen.getByRole('checkbox', { name: /mint/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /honey/i })).toBeEnabled();
  });
});
