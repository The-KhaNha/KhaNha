import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedMenuItem, User } from '../types/api';

const api = vi.hoisted(() => ({
  fetchManagedMenu: vi.fn(),
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  archiveMenuItem: vi.fn(),
  setAvailability: vi.fn(),
  reorderMenu: vi.fn(),
}));
vi.mock('../services/manageMenu', () => api);
const state = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../features/auth/authStore', () => ({
  useAuthStore: (select: (s: typeof state) => unknown) => select(state),
}));

const { ManageMenuTab } = await import('./ManageMenu');
const { ApiError } = await import('../services/api');

const store = { id: 's1', slug: 'cafe', brand: { id: 'b1', name: 'B', slug: 'b' } };
const manager = {
  role: 'CUSTOMER',
  ownedBrands: [],
  memberships: [{ storeId: 's1', storeSlug: 'cafe', storeName: 'S', role: 'MANAGER' }],
} as unknown as User;
const item = (id: string, name: string, category: string, extra = {}): ManagedMenuItem =>
  ({
    id,
    name,
    category,
    description: '',
    price: 50,
    imageUrl: null,
    diet: null,
    isAvailable: true,
    isEnabled: true,
    isPopular: false,
    sortOrder: 0,
    stockQuantity: null,
    archivedAt: null,
    ...extra,
  }) as ManagedMenuItem;
const list = () => [
  item('a', 'Tea', 'Drinks'),
  item('b', 'Coffee', 'Drinks'),
  item('c', 'Samosa', 'Snacks'),
];

beforeEach(() => {
  vi.resetAllMocks();
  state.user = manager;
  api.fetchManagedMenu.mockResolvedValue(list());
});

describe('ManageMenuTab', () => {
  it('shows a skeleton while loading', () => {
    api.fetchManagedMenu.mockReturnValue(new Promise(() => {}));
    render(<ManageMenuTab store={store} />);
    expect(screen.getByLabelText('Loading the menu')).toBeInTheDocument();
  });

  it('says so when the menu is empty', async () => {
    api.fetchManagedMenu.mockResolvedValue([]);
    render(<ManageMenuTab store={store} />);
    expect(await screen.findByText('No items yet')).toBeInTheDocument();
  });

  it('offers a retry when the menu fails to load', async () => {
    api.fetchManagedMenu.mockRejectedValueOnce(new ApiError(500, 'X', 'Server down'));
    render(<ManageMenuTab store={store} />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(await screen.findByText('Tea')).toBeInTheDocument();
  });

  it('flips a switch at once and rolls it back when the server refuses', async () => {
    api.updateMenuItem.mockRejectedValue(new ApiError(500, 'X', 'Could not save'));
    render(<ManageMenuTab store={store} />);
    const sw = await screen.findByRole('switch', { name: 'Tea on the menu' });
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByText('Could not save')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Tea on the menu' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(api.updateMenuItem).toHaveBeenCalledWith('s1', 'a', { isAvailable: false });
  });

  it('tells the shell after a write, so the go-live checklist follows the menu', async () => {
    api.updateMenuItem.mockResolvedValue(item('a', 'Tea', 'Drinks', { isEnabled: false }));
    const onChanged = vi.fn();
    render(<ManageMenuTab store={store} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Tea on the menu' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('sends no second request while a switch write is pending', async () => {
    let done: (v?: unknown) => void = () => {};
    api.updateMenuItem.mockReturnValue(new Promise((r) => (done = r)));
    render(<ManageMenuTab store={store} />);
    const sw = await screen.findByRole('switch', { name: 'Tea on the menu' });
    fireEvent.click(sw);
    fireEvent.click(sw);
    expect(sw).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Tea down' })).toBeDisabled();
    expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(sw).toBeEnabled());
  });

  it('flips a category sold out at once and rolls back on error', async () => {
    api.setAvailability.mockRejectedValue(new ApiError(500, 'X', 'Could not save'));
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Drinks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sold out: this category' }));
    expect(screen.getByRole('switch', { name: 'Tea on the menu' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Coffee on the menu' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(await screen.findByText('Could not save')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Tea on the menu' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('marks an enabled item with no stock as sold out', async () => {
    api.fetchManagedMenu.mockResolvedValue([
      item('a', 'Tea', 'Drinks', { isAvailable: false, stockQuantity: 0 }),
    ]);
    render(<ManageMenuTab store={store} />);
    expect(await screen.findByText(/Sold out/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tea on the menu' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('disables the move buttons at the edges of a category', async () => {
    render(<ManageMenuTab store={store} />);
    expect(await screen.findByRole('button', { name: 'Move Tea up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Tea down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Coffee down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Samosa up' })).toBeDisabled();
  });

  it('sends the whole reordered list', async () => {
    api.reorderMenu.mockResolvedValue(undefined);
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move Tea down' }));
    await waitFor(() => expect(api.reorderMenu).toHaveBeenCalledWith('s1', ['b', 'a', 'c']));
  });

  it('marks a whole category sold out', async () => {
    api.setAvailability.mockResolvedValue({ updated: 2 });
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Drinks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sold out: this category' }));
    await waitFor(() =>
      expect(api.setAvailability).toHaveBeenCalledWith('s1', { category: 'Drinks' }, false),
    );
  });

  it('filters by search', async () => {
    render(<ManageMenuTab store={store} />);
    await screen.findByText('Tea');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'sam' } });
    expect(screen.queryByText('Tea')).toBeNull();
    expect(screen.getByText('Samosa')).toBeInTheDocument();
  });

  it('adds an item through the editor and reloads the list', async () => {
    api.createMenuItem.mockResolvedValue(item('d', 'Chai', 'Drinks'));
    // The reload never answers: the new item must already be on screen.
    api.fetchManagedMenu.mockResolvedValueOnce(list()).mockReturnValue(new Promise(() => {}));
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chai' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Category', { selector: 'input' }), {
      target: { value: 'Drinks' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(api.createMenuItem).toHaveBeenCalled());
    expect(api.createMenuItem.mock.calls[0]![1]).toMatchObject({
      name: 'Chai',
      price: 30,
      category: 'Drinks',
    });
    // Shown from the create's response, before the reload answers.
    expect(await screen.findByText('Chai')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchManagedMenu).toHaveBeenCalledTimes(2));
  });

  it('is not offered to an admin', () => {
    state.user = { role: 'ADMIN', ownedBrands: [], memberships: [] } as unknown as User;
    render(<ManageMenuTab store={store} />);
    expect(screen.getByText(/Only the store's manager or owner/)).toBeInTheDocument();
    expect(api.fetchManagedMenu).not.toHaveBeenCalled();
  });
});
