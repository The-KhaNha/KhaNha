import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        slug: 'cafe',
        brand: { id: 'b1', name: 'Cafe', slug: 'cafe' },
        area: null,
        address: null,
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

  // Enter in a field submits the form even while the button is off, so the handler has to refuse it too.
  const submitForm = () => {
    const form = document.querySelector('form');
    if (!form) throw new Error('no form on the page');
    fireEvent.submit(form);
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

  it('keeps Pay off and offers a retry when the reprice reload fails, then shows the new price', async () => {
    fetchMenu
      .mockResolvedValueOnce(menuAt(90))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'))
      .mockResolvedValue(menuAt(100));
    createOrder.mockRejectedValueOnce(
      new ApiError(409, 'PRICE_CHANGED', 'The price of Espresso just changed to ₹100.'),
    );
    renderCheckout();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Pay ₹180/ }));

    expect(
      await screen.findByText(/can't take payment until the new price loads/),
    ).toBeInTheDocument();
    // The stale amount is not on offer, and pressing Pay again does nothing.
    expect(screen.queryByRole('button', { name: /Pay ₹/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Updating price…' })).toBeDisabled();
    expect(createOrder).toHaveBeenCalledTimes(1);

    // The retry sits in the error card that is scrolled into view, not in a card of its own below it (off screen at
    // 360 px).
    const errorCard = screen.getByText("Your order didn't go through.").closest('[tabindex="-1"]');
    expect(errorCard).not.toBeNull();
    // As a keyboard user does: focus Try Again, then press it. The button is gone while the reload runs, so focus must
    // move back to the card, not fall to the page.
    const tryAgain = within(errorCard as HTMLElement).getByRole('button', { name: 'Try Again' });
    tryAgain.focus();
    fireEvent.click(tryAgain);
    expect(errorCard).toHaveFocus();
    expect(await screen.findByRole('button', { name: /Pay ₹200/ })).toBeEnabled();
    expect(
      screen.queryByText(/can't take payment until the new price loads/),
    ).not.toBeInTheDocument();
    expect(useCartStore.getState().lines[0]?.unitPrice).toBe(100);
  });

  it('keeps Pay off while the reprice reload is in flight, without blaming the connection', async () => {
    let landMenu: (menu: MenuResponse) => void = () => {};
    fetchMenu.mockResolvedValueOnce(menuAt(90)).mockReturnValueOnce(
      new Promise<MenuResponse>((resolve) => {
        landMenu = resolve;
      }),
    );
    createOrder.mockRejectedValueOnce(
      new ApiError(409, 'PRICE_CHANGED', 'The price of Espresso just changed to ₹100.'),
    );
    renderCheckout();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: /Pay ₹180/ }));

    const updating = await screen.findByRole('button', { name: 'Updating price…' });
    expect(updating).toBeDisabled();
    // The reload is a network call: Pay shows it is loading, not just greyed out.
    expect(updating).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('The price of Espresso just changed to ₹100.')).toBeInTheDocument();
    expect(screen.queryByText(/can't take payment/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    submitForm();
    expect(createOrder).toHaveBeenCalledTimes(1);

    landMenu(menuAt(100));
    expect(await screen.findByRole('button', { name: /Pay ₹200/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Pay ₹200/ })).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText(/can't take payment/)).not.toBeInTheDocument();
    expect(useCartStore.getState().lines[0]?.unitPrice).toBe(100);
  });

  it('brings the card and its retry back when Try Again fails too, and still takes the new price once it lands', async () => {
    const stillOffNotice = /can't take payment until the new price loads/;
    fetchMenu
      .mockResolvedValueOnce(menuAt(90))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Still offline.'))
      .mockResolvedValue(menuAt(100));
    createOrder.mockRejectedValueOnce(
      new ApiError(409, 'PRICE_CHANGED', 'The price of Espresso just changed to ₹100.'),
    );
    // jsdom has no layout: record the scroll calls instead.
    const scrollIntoView = vi.fn();
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderCheckout();
      await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
      fireEvent.click(await screen.findByRole('button', { name: /Pay ₹180/ }));
      expect(await screen.findByText(stillOffNotice)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      scrollIntoView.mockClear();
      await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(3));
      const retryAgain = await screen.findByRole('button', { name: 'Try Again' });
      // The second failure brings the card back into view: the customer may have scrolled away while it retried.
      expect(scrollIntoView).toHaveBeenCalled();
      expect(screen.getByText(stillOffNotice)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Pay ₹/ })).not.toBeInTheDocument();
      const updating = screen.getByRole('button', { name: 'Updating price…' });
      expect(updating).toBeDisabled();
      // Failed, not loading: no spinner while the retry waits for the customer.
      expect(updating).not.toHaveAttribute('aria-busy');
      submitForm();
      expect(createOrder).toHaveBeenCalledTimes(1);

      fireEvent.click(retryAgain);
      expect(await screen.findByRole('button', { name: /Pay ₹200/ })).toBeEnabled();
      expect(screen.queryByText(stillOffNotice)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
      expect(useCartStore.getState().lines[0]?.unitPrice).toBe(100);
      expect(createOrder).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
    }
  });

  it('gives any other refusal no retry of its own, even when the menu is not loaded: Pay is the retry', async () => {
    // The menu failed on arrival and nothing is cached: that error must not leak onto this card.
    fetchMenu.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));
    createOrder.mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.'),
    );
    renderCheckout();
    await waitFor(() => expect(fetchMenu).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Pay ₹180/ }));

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByText("Your order didn't go through.")).toBeInTheDocument();
    expect(screen.queryByText(/can't take payment/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(fetchMenu).toHaveBeenCalledTimes(1);

    createOrder.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /Pay ₹180/ }));
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
  });
});
