import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedStore } from '../types/api';

const api = vi.hoisted(() => ({ updateStoreProfile: vi.fn() }));
vi.mock('../services/manageStores', () => api);

const { ManageProfileTab } = await import('./ManageProfile');
const { ApiError } = await import('../services/api');

const store = {
  id: 's1',
  slug: 'north',
  name: 'North',
  status: 'DRAFT',
  isTemplate: false,
  area: 'Campus',
  address: null,
  contactPhone: null,
  tagline: 'Hot chai',
  description: '',
} as ManagedStore;
const onSaved = vi.fn();

beforeEach(() => vi.resetAllMocks());

describe('ManageProfileTab', () => {
  it('saves only what changed and reloads the store', async () => {
    api.updateStoreProfile.mockResolvedValue({ ...store, address: '1 Road' });
    render(<ManageProfileTab store={store} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: ' 1 Road ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateStoreProfile).toHaveBeenCalledWith('s1', { addressLine: '1 Road' });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it("never sends back a field someone else changed meanwhile: only the person's own edit", async () => {
    api.updateStoreProfile.mockResolvedValue({
      ...store,
      name: 'South',
      contactPhone: '9876543210',
    });
    const { rerender } = render(<ManageProfileTab store={store} onSaved={onSaved} />);
    rerender(<ManageProfileTab store={{ ...store, name: 'South' }} onSaved={onSaved} />);
    expect(screen.getByLabelText('Name')).toHaveValue('South');
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateStoreProfile).toHaveBeenCalledWith('s1', { contactPhone: '9876543210' });
  });

  it("shows the API's field error on its field", async () => {
    api.updateStoreProfile.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid phone number.', {
        field: 'contactPhone',
      }),
    );
    render(<ManageProfileTab store={store} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a valid phone number.')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("a template has no place or phone: those are each branch's own", () => {
    render(<ManageProfileTab store={{ ...store, isTemplate: true }} onSaved={onSaved} />);
    expect(screen.queryByLabelText('Address')).toBeNull();
    expect(screen.getByLabelText('Tagline')).toBeInTheDocument();
  });
});
