import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const manage = vi.hoisted(() => ({ fetchStoreSettings: vi.fn(), updateStoreSettings: vi.fn() }));
vi.mock('../services/manage', () => manage);
vi.mock('../features/stock/StockList', () => ({ StockList: () => <p>stock list</p> }));

const { ManageStockTab } = await import('./ManageStock');
const { ApiError } = await import('../services/api');

const settings = {
  maxQuantityPerItem: 10,
  lowStockThreshold: 5,
  staffOrderListLimit: 100,
  lastOrderMinutesBeforeClose: 0,
  staffCanEditStock: true,
};
const store = { id: 's1', slug: 'cafe' };

beforeEach(() => {
  vi.resetAllMocks();
  manage.fetchStoreSettings.mockResolvedValue(settings);
});

describe('ManageStockTab', () => {
  it('shows a skeleton while the staff setting loads', () => {
    manage.fetchStoreSettings.mockReturnValue(new Promise(() => {}));
    render(<ManageStockTab store={store} />);
    expect(screen.getByLabelText('Loading the staff setting')).toBeInTheDocument();
  });

  it('says so when the setting fails to load, and retries', async () => {
    manage.fetchStoreSettings.mockRejectedValueOnce(new ApiError(500, 'X', 'Server down'));
    render(<ManageStockTab store={store} />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    expect(screen.getByText('stock list')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(
      await screen.findByRole('switch', { name: 'Staff can change stock' }),
    ).toBeInTheDocument();
  });

  it('flips at once and rolls back with the reason when refused', async () => {
    manage.updateStoreSettings.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Not yours.'));
    render(<ManageStockTab store={store} />);
    const toggle = await screen.findByRole('switch', { name: 'Staff can change stock' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByText('Not yours.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Staff can change stock' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
