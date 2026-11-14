import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ApiError } from '../../services/api';
import type { MenuItemInput } from '../../services/manageMenu';
import type { ManagedMenuItem } from '../../types/api';
import { ItemEditor } from './ItemEditor';
import type { PhotoUploadState } from './usePhotoUpload';

// The upload itself is usePhotoUpload's (its own tests); here each test sets where it stands.
const photo = vi.hoisted(() => ({
  state: { status: 'idle', preview: null, uploadId: null, error: null } as PhotoUploadState,
  upload: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('./usePhotoUpload', () => ({
  usePhotoUpload: () => ({
    ...photo.state,
    upload: photo.upload,
    cancel: photo.cancel,
    retry: photo.retry,
  }),
}));
const setPhoto = (state: Partial<PhotoUploadState>) => {
  photo.state = { status: 'idle', preview: null, uploadId: null, error: null, ...state };
};

const show = (onSave = vi.fn()) => {
  const onClose = vi.fn();
  render(
    <ItemEditor
      storeId="s1"
      item={null}
      categories={['Drinks']}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose };
};

const withPhoto: ManagedMenuItem = {
  id: 'i1',
  category: 'Drinks',
  name: 'Lassi',
  description: '',
  price: 60,
  imageUrl: '/media/stores/s1/variants/abc-900.webp',
  imageSrcSet: null,
  diet: null,
  isAvailable: true,
  isPopular: false,
  sortOrder: 1,
  stockQuantity: null,
  isEnabled: true,
  archivedAt: null,
  templateItemId: null,
};

/** Opens the editor on `withPhoto`; `again()` renders it once more after setPhoto. */
function editPhoto(
  onSave: Mock<(input: MenuItemInput) => Promise<void>> = vi.fn().mockResolvedValue(undefined),
) {
  const ui = () => (
    <ItemEditor storeId="s1" item={withPhoto} categories={[]} onSave={onSave} onClose={vi.fn()} />
  );
  const { rerender } = render(ui());
  return { onSave, again: () => rerender(ui()) };
}

describe('ItemEditor photo', () => {
  beforeEach(() => setPhoto({}));

  it('a chosen photo goes up at once, and saving attaches it when ready', async () => {
    const { onSave, again } = editPhoto();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'lassi.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(photo.upload).toHaveBeenCalledWith(file);

    setPhoto({ status: 'processing', preview: 'blob:preview' });
    again();
    expect(screen.getByText('Making it ready for the menu…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    setPhoto({ status: 'ready', preview: '/media/new-900.webp', uploadId: 'u1' });
    again();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ imageUploadId: 'u1' });
  });

  it('untouched, the save leaves the photo alone', async () => {
    const { onSave } = editPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty('imageUploadId');
  });

  it('Remove takes the photo off on save', async () => {
    const { onSave } = editPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ imageUploadId: null });
  });

  it('after Remove, a new photo that fails to go up still saves the item without a photo', async () => {
    const { onSave, again } = editPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    setPhoto({ status: 'failed', preview: 'blob:failed', error: 'Offline' });
    again();
    // The form shows what a save keeps: no photo, not the one that failed.
    expect(document.querySelector('[role="dialog"] img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({ imageUploadId: null });
  });

  it('the photo cannot change while the item is being saved', async () => {
    editPhoto(vi.fn(() => new Promise<void>(() => {})));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeDisabled();
  });

  it('a failed upload says why and offers to try again', () => {
    setPhoto({
      status: 'failed',
      preview: 'blob:preview',
      error: "That photo can't be used: not a photo.",
    });
    render(
      <ItemEditor storeId="s1" item={null} categories={[]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('not a photo');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(photo.retry).toHaveBeenCalled();
  });
});

describe('ItemEditor', () => {
  beforeEach(() => setPhoto({}));

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
      <ItemEditor storeId="s1" item={null} categories={[]} onSave={onSave} onClose={onClose} />,
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

describe('the choices an item offers (P3.2)', () => {
  const group = (id: string, name: string) => ({
    id,
    name,
    minSelect: 0,
    maxSelect: 1,
    options: [],
  });

  it("saves the ticked choices in the store's order, whatever order they were ticked in", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ItemEditor
        storeId="s1"
        item={null}
        categories={[]}
        onSave={onSave}
        onClose={vi.fn()}
        modifierGroups={[group('size', 'Size'), group('milk', 'Milk'), group('add', 'Add-ons')]}
        groupIds={['add']}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Add-ons' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Size' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chai' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Hot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toEqual(['size', 'add']);
  });

  it("takes the item's choices when they arrive after it opened, unless the manager already ticked", () => {
    const props = {
      storeId: 's1',
      item: null,
      categories: [],
      onSave: vi.fn(),
      onClose: vi.fn(),
      modifierGroups: [group('size', 'Size'), group('add', 'Add-ons')],
    };
    const { rerender } = render(<ItemEditor {...props} groupIds={[]} />);
    rerender(<ItemEditor {...props} groupIds={['add']} />);
    expect(screen.getByRole('checkbox', { name: 'Add-ons' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Size' }));
    rerender(<ItemEditor {...props} groupIds={['add', 'size']} />);
    rerender(<ItemEditor {...props} groupIds={[]} />);
    expect(screen.getByRole('checkbox', { name: 'Size' })).toBeChecked();
  });

  it('shows no choices field while the store has none', () => {
    show();
    expect(screen.queryByText('Choices')).not.toBeInTheDocument();
  });
});
