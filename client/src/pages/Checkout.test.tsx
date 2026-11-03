import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderInput, MenuItem, MenuResponse } from '../types/api';

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
// The real useMenu/useResource run; only the request is faked (pending unless a test answers it).
const fetchMenu = vi.hoisted(() => vi.fn<() => Promise<MenuResponse>>(() => new Promise(() => {})));
vi.mock('../services/menu', () => ({ fetchMenu }));
const createOrder = vi.hoisted(() => vi.fn<(input: CreateOrderInput) => Promise<unknown>>());
vi.mock('../services/orders', () => ({ createOrder }));

const { ApiError } = await import('../services/api');
const { useCartStore } = await import('../features/cart/cartStore');
const { useCheckoutDraftStore } = await import('../features/checkout/checkoutDraftStore');
const { CheckoutPage } = await import('./Checkout');

const renderCheckout = () =>
  render(
    <MemoryRouter>
      <CheckoutPage />
    </MemoryRouter>,
  );

describe('CheckoutPage when the key already placed a different order', () => {
  beforeEach(() => {
    sessionStorage.clear();
    createOrder.mockReset();
    useCheckoutDraftStore.getState().reset();
    useCheckoutDraftStore.getState().setField('name', 'Ravi');
    useCartStore.setState({
      lines: [
        {
          menuItemId: 'i1',
          name: 'Espresso',
          unitPrice: 90,
          imageUrl: null,
          quantity: 1,
          maxQuantity: null,
        },
        {
          menuItemId: 'i2',
          name: 'Cold Coffee',
          unitPrice: 120,
          imageUrl: null,
          quantity: 2,
          maxQuantity: null,
        },
      ],
    });
  });

  it('links to the earlier order, keeps the cart, and pays the next time under a new key', async () => {
    createOrder.mockRejectedValueOnce(
      new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Your earlier order #1016 already went through. Pay again to order what is in your cart now.',
        { orderId: 'o-1016', orderNumber: 1016 },
      ),
    );
    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));

    expect(await screen.findByText('Your earlier order went through.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View order #1016' })).toHaveAttribute(
      'href',
      '/orders/o-1016',
    );
    // Never shown as paid, and nothing the customer chose is lost.
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(2);

    createOrder.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    const [first, second] = createOrder.mock.calls.map(([input]) => input.idempotencyKey);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe('CheckoutPage when the server rejects one field', () => {
  beforeEach(() => {
    sessionStorage.clear();
    createOrder.mockReset();
    useCheckoutDraftStore.getState().reset();
    useCheckoutDraftStore.getState().setField('name', 'Ravi');
    useCheckoutDraftStore.getState().setField('phone', '98765 43210');
    useCartStore.setState({
      lines: [
        {
          menuItemId: 'i1',
          name: 'Espresso',
          unitPrice: 90,
          imageUrl: null,
          quantity: 1,
          maxQuantity: null,
        },
      ],
    });
  });

  it('shows the message on that field and focuses it, not a banner above Pay', async () => {
    createOrder.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid phone number.', {
        field: 'customerPhone',
      }),
    );
    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));

    const phone = await screen.findByRole('textbox', { name: /Phone/ });
    await waitFor(() => expect(phone).toHaveFocus());
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(screen.queryByText("Your order didn't go through.")).not.toBeInTheDocument();
  });

  it('keeps the server message through a blur and drops it once the phone is edited', async () => {
    createOrder.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid phone number.', {
        field: 'customerPhone',
      }),
    );
    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));

    const phone = await screen.findByRole('textbox', { name: /Phone/ });
    await waitFor(() => expect(phone).toHaveFocus());

    // The value is client-valid; a blur must not remove the line (the layout would shift under a press).
    fireEvent.blur(phone);
    expect(screen.getByText('Enter a valid phone number.')).toBeInTheDocument();

    fireEvent.change(phone, { target: { value: '98765 43211' } });
    expect(screen.queryByText('Enter a valid phone number.')).not.toBeInTheDocument();
  });
});

describe('CheckoutPage when a price changed before the order was placed', () => {
  const menuAt = (price: number): MenuResponse => {
    const espresso: MenuItem = {
      id: 'i1',
      category: 'Coffee',
      name: 'Espresso',
      description: '',
      price,
      imageUrl: '',
      isAvailable: true,
      isPopular: false,
      sortOrder: 1,
      stockQuantity: null,
    };
    return {
      store: {
        id: 's1',
        name: 'Cafe',
        tagline: '',
        description: '',
        imageUrl: null,
        isOpen: true,
        prepTimeMinMinutes: 5,
        prepTimeMaxMinutes: 10,
      },
      popular: [],
      categories: [{ name: 'Coffee', items: [espresso] }],
    };
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    createOrder.mockReset();
    fetchMenu.mockReset();
    useCheckoutDraftStore.getState().reset();
    useCheckoutDraftStore.getState().setField('name', 'Ravi');
    useCartStore.setState({
      lines: [
        {
          menuItemId: 'i1',
          name: 'Espresso',
          unitPrice: 90,
          imageUrl: null,
          quantity: 2,
          maxQuantity: null,
        },
      ],
    });
  });

  it('shows the server message, reloads the menu and shows the new price before the next Pay', async () => {
    fetchMenu.mockResolvedValueOnce(menuAt(90)).mockResolvedValue(menuAt(100));
    const message = 'The price of Espresso just changed to ₹100. Please review your order.';
    createOrder.mockRejectedValueOnce(new ApiError(409, 'PRICE_CHANGED', message));
    renderCheckout();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Pay ₹180/ }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /Pay ₹200/ })).toBeInTheDocument();
    expect(useCartStore.getState().lines[0]?.unitPrice).toBe(100);
  });
});
