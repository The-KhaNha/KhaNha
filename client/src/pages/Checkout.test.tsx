import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderInput } from '../types/api';

vi.mock('../lib/supabase', () => ({
  getSupabase: () => Promise.reject(new Error('not in this test')),
  mayHaveSession: () => false,
}));
vi.mock('../features/menu/useMenu', () => ({ useMenu: () => ({}) }));
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
