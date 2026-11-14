import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { ModifierGroupEditor } from './ModifierGroupEditor';

const size = {
  id: 'g1',
  name: 'Size',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'o1', name: 'Small', priceDelta: -20, isDefault: true, isAvailable: true },
    { id: 'o2', name: 'Large', priceDelta: 20, isDefault: false, isAvailable: true },
  ],
};

describe('ModifierGroupEditor', () => {
  it('saves the whole group: kept options by id, a new one without, deltas as whole rupees', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <ModifierGroupEditor group={size} onSave={onSave} onArchive={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Medium' } });
    fireEvent.change(screen.getAllByLabelText('₹ change')[1]!, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({
      name: 'Size',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'o2', name: 'Large', priceDelta: 20, isDefault: false, isAvailable: true },
        { name: 'Medium', priceDelta: 10, isDefault: false, isAvailable: true },
      ],
    });
  });

  it('refuses a price change that is not whole rupees before sending', () => {
    const onSave = vi.fn();
    render(<ModifierGroupEditor group={null} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('₹ change'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add choice' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('whole rupees');
  });

  it("shows the server's refusal on its field, and stays open", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'Fewer options are available than required.', {
        field: 'minSelect',
      }),
    );
    render(<ModifierGroupEditor group={size} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Fewer options are available than required.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Choose at least')).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes (archives) an existing group; a new one has no such button', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { unmount } = render(
      <ModifierGroupEditor group={size} onSave={vi.fn()} onArchive={onArchive} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove this choice' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onArchive).toHaveBeenCalledOnce();
    unmount();
    render(<ModifierGroupEditor group={null} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove this choice' })).not.toBeInTheDocument();
  });
});
