import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canEditSettings } from '../features/manage/manageRules';
import { ApiError } from '../services/api';
import type { User } from '../types/api';

const svc = vi.hoisted(() => ({ fetchStoreSettings: vi.fn(), updateStoreSettings: vi.fn() }));
vi.mock('../services/manage', () => svc);
const { ManageSettingsTab } = await import('./ManageSettings');

const saved = {
  maxQuantityPerItem: 10,
  lowStockThreshold: 5,
  staffOrderListLimit: 100,
  lastOrderMinutesBeforeClose: 0,
};
const field = (name: RegExp) => screen.getByLabelText(name);

beforeEach(() => {
  vi.resetAllMocks();
  svc.fetchStoreSettings.mockResolvedValue(saved);
});

describe('ManageSettingsTab', () => {
  it('sends only the changed field and confirms the save', async () => {
    svc.updateStoreSettings.mockResolvedValue({ ...saved, lowStockThreshold: 8 });
    render(<ManageSettingsTab storeId="s1" />);
    const input = await screen.findByLabelText(/Low-stock/);
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(svc.updateStoreSettings).toHaveBeenCalledWith('s1', { lowStockThreshold: 8 });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it("shows the API's own bounds message when it refuses a value", async () => {
    svc.updateStoreSettings.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'maxQuantityPerItem must be at most 50'),
    );
    render(<ManageSettingsTab storeId="s1" />);
    const input = await screen.findByLabelText(/Most of one item/);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 50');
    fireEvent.change(input, { target: { value: '40' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps Save off for a non-number and offers a retry when the load fails', async () => {
    svc.fetchStoreSettings.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    render(<ManageSettingsTab storeId="s1" />);
    fireEvent.click(await screen.findByRole('button', { name: /try again|retry/i }));
    fireEvent.change(await screen.findByLabelText(/Stop orders/), { target: { value: 'x' } });
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(field(/Stop orders/)).toBeInTheDocument();
  });
});

describe('canEditSettings', () => {
  const store = { id: 's1', brand: { id: 'b1', name: 'B', slug: 'b' } };
  const base = { role: 'CUSTOMER', memberships: [], ownedBrands: [] } as unknown as User;
  it('is for the owner and a manager, never an admin or staff', () => {
    expect(canEditSettings({ ...base, ownedBrands: [store.brand] }, store)).toBe(true);
    const member = (role: 'MANAGER' | 'STAFF') =>
      ({ ...base, memberships: [{ storeId: 's1', storeSlug: 's', storeName: 'S', role }] }) as User;
    expect(canEditSettings(member('MANAGER'), store)).toBe(true);
    expect(canEditSettings(member('STAFF'), store)).toBe(false);
    expect(canEditSettings({ ...base, role: 'ADMIN' }, store)).toBe(false);
  });
});
