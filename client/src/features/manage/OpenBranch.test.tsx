import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ openBranch: vi.fn() }));
vi.mock('../../services/manageStores', () => api);

const { OpenBranch } = await import('./OpenBranch');
const { ApiError } = await import('../../services/api');

const onOpened = vi.fn();
const show = () => render(<OpenBranch brandId="b1" onOpened={onOpened} onCancel={() => {}} />);
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => vi.resetAllMocks());

describe('OpenBranch', () => {
  it('sends the trimmed fields, leaving blank optional ones to the server, and hands back the new store', async () => {
    api.openBranch.mockResolvedValue({ id: 's9', slug: 'north-gate' });
    show();
    type('Branch name', '  North Gate ');
    type('Area', '   ');
    fireEvent.click(screen.getByRole('button', { name: 'Open the branch' }));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith({ id: 's9', slug: 'north-gate' }));
    expect(api.openBranch).toHaveBeenCalledWith('b1', {
      name: 'North Gate',
      slug: undefined,
      area: undefined,
      addressLine: undefined,
    });
  });

  it('a name too short is caught before sending', () => {
    show();
    type('Branch name', 'N');
    fireEvent.click(screen.getByRole('button', { name: 'Open the branch' }));
    expect(screen.getByText(/at least 2 characters/)).toBeInTheDocument();
    expect(api.openBranch).not.toHaveBeenCalled();
  });

  it('a taken web address shows on its field, and typing there clears it', async () => {
    api.openBranch.mockRejectedValue(
      new ApiError(409, 'SLUG_TAKEN', 'That web address is taken.', { field: 'slug' }),
    );
    show();
    type('Branch name', 'North Gate');
    type('Web address', 'north');
    fireEvent.click(screen.getByRole('button', { name: 'Open the branch' }));
    expect(await screen.findByText('That web address is taken.')).toBeInTheDocument();
    expect(screen.getByLabelText('Web address')).toHaveAttribute('aria-invalid', 'true');
    type('Web address', 'north-2');
    expect(screen.queryByText('That web address is taken.')).toBeNull();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('a refusal without a field shows under the form', async () => {
    api.openBranch.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Brand not found.'));
    show();
    type('Branch name', 'North Gate');
    fireEvent.click(screen.getByRole('button', { name: 'Open the branch' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Brand not found.');
  });
});
