import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { ItemEditor } from './ItemEditor';

const show = (onSave = vi.fn()) => {
  const onClose = vi.fn();
  render(<ItemEditor item={null} categories={['Drinks']} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
};

describe('ItemEditor', () => {
  it('shows a server field error on its field and stays open', async () => {
    const { onClose } = show(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, 'VALIDATION_ERROR', 'Name is too short', { field: 'name' }),
        ),
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(await screen.findByText('Name is too short')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears a field error once that field is edited', async () => {
    show(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, 'VALIDATION_ERROR', 'Name is too short', { field: 'name' }),
        ),
    );
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await screen.findByText('Name is too short');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tea' } });
    expect(screen.queryByText('Name is too short')).not.toBeInTheDocument();
  });

  it('does not close after unmounting when a pending save resolves', async () => {
    let resolve!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onClose = vi.fn();
    const { unmount } = render(
      <ItemEditor item={null} categories={[]} onSave={onSave} onClose={onClose} />,
    );
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    unmount();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses a non-whole price without calling the API', () => {
    const { onSave } = show();
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByText('Enter the price in whole rupees.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes on Escape and moves focus inside', async () => {
    const { onClose } = show();
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps every control at 44px or more', () => {
    show();
    for (const name of ['Not marked', 'Veg', 'Egg', 'Non-veg'])
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('h-11');
  });
});
