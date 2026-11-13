import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedMenuItem } from '../../types/api';

const api = vi.hoisted(() => ({
  fetchStock: vi.fn(),
  changeStock: vi.fn(),
  fetchStockMovements: vi.fn(),
}));
vi.mock('../../services/stock', () => api);

const { StockList } = await import('./StockList');
const { ApiError } = await import('../../services/api');

const store = { id: 's1', slug: 'cafe' };
const item = (id: string, name: string, stockQuantity: number | null): ManagedMenuItem =>
  ({
    id,
    name,
    category: 'Snacks',
    description: '',
    price: 50,
    imageUrl: null,
    diet: null,
    isAvailable: stockQuantity !== 0,
    isEnabled: true,
    isPopular: false,
    sortOrder: 0,
    stockQuantity,
    archivedAt: null,
  }) as ManagedMenuItem;
const list = () => ({
  items: [
    item('a', 'Samosa', 10),
    item('b', 'Tea', 2),
    item('c', 'Coffee', 0),
    item('d', 'Water', null),
  ],
  lowStockThreshold: 3,
});
const row = (name: string) => screen.getByText(name).closest('li')!;
const countOf = (name: string) => within(row(name)).getByLabelText(new RegExp(`^${name}:`));

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchStock.mockResolvedValue(list());
});

describe('StockList', () => {
  it('shows a skeleton while loading', () => {
    api.fetchStock.mockReturnValue(new Promise(() => {}));
    render(<StockList store={store} />);
    expect(screen.getByLabelText('Loading the stock')).toBeInTheDocument();
  });

  it('says so when there are no items', async () => {
    api.fetchStock.mockResolvedValue({ items: [], lowStockThreshold: 3 });
    render(<StockList store={store} />);
    expect(await screen.findByText('No items yet')).toBeInTheDocument();
  });

  it('offers a retry when the stock fails to load', async () => {
    api.fetchStock.mockRejectedValueOnce(new ApiError(500, 'X', 'Server down'));
    render(<StockList store={store} />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Samosa')).toBeInTheDocument();
  });

  it('marks low, sold-out and uncounted items', async () => {
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    expect(within(row('Tea')).getByText(/· Running low/)).toBeInTheDocument();
    expect(within(row('Coffee')).getByText(/· Sold out/)).toBeInTheDocument();
    expect(within(row('Samosa')).queryByText(/· (Running low|Sold out)/)).not.toBeInTheDocument();
    expect(countOf('Water')).toHaveTextContent('Not counted');
    // Nothing to count up or down from, and nothing below zero.
    expect(screen.getByRole('button', { name: 'One less Water' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One more Water' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One less Coffee' })).toBeDisabled();
  });

  it("− and + change the count at once, then show the server's answer", async () => {
    let answer!: (n: number) => void;
    api.changeStock.mockReturnValue(new Promise((r) => (answer = r)));
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(screen.getByRole('button', { name: 'One less Samosa' }));
    expect(countOf('Samosa')).toHaveTextContent('9');
    expect(api.changeStock).toHaveBeenCalledWith('s1', 'a', { adjust: -1 });
    // A second tap while the first is in flight is ignored, not queued.
    expect(screen.getByRole('button', { name: 'One more Samosa' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'One less Samosa' }));
    expect(api.changeStock).toHaveBeenCalledTimes(1);
    answer(7); // someone else took two meanwhile
    await waitFor(() => expect(countOf('Samosa')).toHaveTextContent('7'));
  });

  it('a refused change rolls back and says why', async () => {
    api.changeStock.mockRejectedValue(
      new ApiError(400, 'INSUFFICIENT_STOCK', 'Only 0 Tea left: you cannot remove more than that.'),
    );
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(screen.getByRole('button', { name: 'One less Tea' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 0 Tea left');
    expect(countOf('Tea')).toHaveTextContent('2');
    // The list is reloaded, so the screen catches up with what the server has.
    expect(api.fetchStock).toHaveBeenCalledTimes(2);
  });

  it('"Mark sold out" sets the count to zero', async () => {
    api.changeStock.mockResolvedValue(0);
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(within(row('Samosa')).getByRole('button', { name: 'Mark sold out' }));
    expect(api.changeStock).toHaveBeenCalledWith('s1', 'a', { set: 0 });
    await waitFor(() => expect(countOf('Samosa')).toHaveTextContent('0'));
  });

  it('"Set" takes a whole number, and can stop counting', async () => {
    api.changeStock.mockResolvedValue(12);
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(within(row('Samosa')).getByRole('button', { name: 'Set' }));
    const input = screen.getByLabelText('New count for Samosa');
    fireEvent.change(input, { target: { value: 'ten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
    expect(api.changeStock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.changeStock).toHaveBeenCalledWith('s1', 'a', { set: 12 });
    await waitFor(() => expect(countOf('Samosa')).toHaveTextContent('12'));

    api.changeStock.mockResolvedValue(null);
    fireEvent.click(within(row('Samosa')).getByRole('button', { name: 'Set' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop counting' }));
    expect(api.changeStock).toHaveBeenLastCalledWith('s1', 'a', { untracked: true });
    await waitFor(() => expect(countOf('Samosa')).toHaveTextContent('Not counted'));
  });

  it("opens an item's history on demand", async () => {
    api.fetchStockMovements.mockResolvedValue([
      {
        id: 2,
        menuItemId: 'a',
        delta: -2,
        resultingQuantity: 10,
        reason: 'WASTE',
        actor: { id: 'u', name: 'Asha' },
        createdAt: new Date().toISOString(),
      },
    ]);
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    expect(api.fetchStockMovements).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'History of Samosa' }));
    expect(await screen.findByText('Wasted 2 → 10')).toBeInTheDocument();
    expect(screen.getByText(/Asha/)).toBeInTheDocument();
    expect(api.fetchStockMovements).toHaveBeenCalledWith('s1', 'a');
  });

  it('an open history refetches after a change, even one that leaves the count the same', async () => {
    api.fetchStockMovements.mockResolvedValue([]);
    api.changeStock.mockResolvedValue(10);
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(screen.getByRole('button', { name: 'History of Samosa' }));
    await screen.findByText('No changes by hand yet.');
    fireEvent.click(within(row('Samosa')).getByRole('button', { name: 'Set' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); // 10 again: the count does not move
    await waitFor(() => expect(api.fetchStockMovements).toHaveBeenCalledTimes(2));
  });

  it('Set waits while a write on the item is in flight, so a save is never dropped', async () => {
    api.changeStock.mockReturnValue(new Promise(() => {}));
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    fireEvent.click(within(row('Samosa')).getByRole('button', { name: 'Set' }));
    fireEvent.click(screen.getByRole('button', { name: 'One more Samosa' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop counting' })).toBeDisabled();
  });

  it("reloads after a write lands, and a refused refresh shows the server's reason", async () => {
    api.changeStock.mockResolvedValue(11);
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    api.fetchStock.mockRejectedValueOnce(
      new ApiError(403, 'FORBIDDEN', 'This store does not let staff change stock.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'One more Samosa' }));
    expect(
      await screen.findByText('This store does not let staff change stock.'),
    ).toBeInTheDocument();
    expect(api.fetchStock).toHaveBeenCalledTimes(2);
  });

  it('every control is a 44px target', async () => {
    render(<StockList store={store} />);
    await screen.findByText('Samosa');
    for (const button of within(row('Samosa')).getAllByRole('button'))
      expect(button.className).toMatch(/\bh-11\b|\bmin-h-11\b/);
  });
});
