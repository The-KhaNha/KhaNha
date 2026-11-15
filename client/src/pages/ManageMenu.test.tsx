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
const mods = vi.hoisted(() => ({
  fetchModifierGroups: vi.fn(),
  createModifierGroup: vi.fn(),
  updateModifierGroup: vi.fn(),
  archiveModifierGroup: vi.fn(),
  setItemModifierGroups: vi.fn(),
}));
vi.mock('../services/manageModifiers', () => mods);
const addOns = {
  id: 'g1',
  name: 'Add-ons',
  minSelect: 0,
  maxSelect: 1,
  options: [
    { id: 'o1', name: 'Extra cheese', priceDelta: 20, isDefault: false, isAvailable: true },
  ],
};
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
  mods.fetchModifierGroups.mockResolvedValue({ groups: [addOns], itemGroupIds: {} });
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

describe('ManageMenuTab with choices (P3.2)', () => {
  it('a retry after the choices failed updates the new item, never creates a second one', async () => {
    state.user = manager;
    api.createMenuItem.mockResolvedValue(item('n', 'Chai', 'Drinks'));
    api.updateMenuItem.mockResolvedValue(item('n', 'Chai', 'Drinks'));
    mods.setItemModifierGroups
      .mockRejectedValueOnce(new ApiError(0, 'UNKNOWN', 'Could not save the choices.'))
      .mockResolvedValue({ groupIds: ['g1'] });
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Chai' } });
    fireEvent.change(within(dialog).getByLabelText('Price (₹)'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'Drinks' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Add-ons' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Could not save the choices.')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Save changes|Add item/ }),
    );
    await waitFor(() => expect(mods.setItemModifierGroups).toHaveBeenCalledTimes(2));
    expect(api.createMenuItem).toHaveBeenCalledTimes(1);
    expect(api.updateMenuItem).toHaveBeenCalledTimes(1);
  });

  it('keeps the saved choices on screen after a failed refresh, and says so with a retry', async () => {
    mods.createModifierGroup.mockResolvedValue(addOns);
    render(<ManageMenuTab store={store} />);
    expect(await screen.findByText('Extra cheese')).toBeInTheDocument();
    mods.fetchModifierGroups.mockRejectedValue(new ApiError(0, 'UNKNOWN', 'offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Size' } });
    fireEvent.change(within(dialog).getByLabelText('Option 1', { exact: true }), {
      target: { value: 'Large' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add choice' }));
    expect(await screen.findByText('Showing the saved choices')).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.getByText('Extra cheese')).toBeInTheDocument();
  });

  it('a new item saved after its editor was closed does not reopen it', async () => {
    let finish: (value: ManagedMenuItem) => void = () => {};
    api.createMenuItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ManageMenuTab store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Chai' } });
    fireEvent.change(within(dialog).getByLabelText('Price (₹)'), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'Drinks' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    finish(item('n', 'Chai', 'Drinks'));
    await waitFor(() => expect(api.fetchManagedMenu).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
