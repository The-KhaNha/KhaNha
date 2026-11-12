import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useStores', () => ({
  useStores: () => ({ stores: [{ slug: 'only' }], isLoading: false }),
}));
const { useCartStore } = await import('../cart/cartStore');
const { MenuRedirect } = await import('./MenuRedirect');

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <Routes>
        <Route path="/menu" element={<MenuRedirect />} />
        <Route path="/s/:slug/menu" element={<p>menu of the store in the URL</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => useCartStore.getState().clear());

describe('MenuRedirect', () => {
  it("goes to the cart's own store when the cart has lines", () => {
    useCartStore.setState({
      storeSlug: 'bakery',
      lines: [
        {
          menuItemId: 'x',
          name: 'x',
          unitPrice: 1,
          imageUrl: null,
          quantity: 1,
          maxQuantity: null,
        },
      ],
    });
    renderAt();
    expect(screen.getByText('menu of the store in the URL')).toBeInTheDocument();
  });
});
