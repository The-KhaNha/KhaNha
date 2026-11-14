import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

vi.mock('./useStores', () => ({
  useStores: () => ({ stores: [{ slug: 'only' }], isLoading: false }),
}));
const { useCartStore } = await import('../cart/cartStore');
const { MenuRedirect } = await import('./MenuRedirect');

it("/menu goes to the cart's own store, not the only active one, when the cart has lines", () => {
  const line = {
    lineKey: 'x',
    menuItemId: 'x',
    options: [],
    name: 'x',
    unitPrice: 1,
    imageUrl: null,
    quantity: 1,
  };
  useCartStore.setState({ storeSlug: 'bakery', lines: [{ ...line, maxQuantity: null }] });
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <Routes>
        <Route path="/menu" element={<MenuRedirect />} />
        <Route path="/s/bakery/menu" element={<p>bakery menu</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('bakery menu')).toBeInTheDocument();
});
