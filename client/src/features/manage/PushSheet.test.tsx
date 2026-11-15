import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedMenuItem, ManagedStore } from '../../types/api';

const menu = vi.hoisted(() => ({ fetchManagedMenu: vi.fn() }));
const stores = vi.hoisted(() => ({ pushTemplate: vi.fn() }));
vi.mock('../../services/manageMenu', () => menu);
vi.mock('../../services/manageStores', () => stores);

const { PushSheet } = await import('./PushSheet');
const { ApiError } = await import('../../services/api');

const template = {
  id: 't1',
  name: 'Masala Chai',
  description: '',
  category: 'Hot',
  price: 140,
  diet: null,
  imageUrl: null,
  archivedAt: null,
  templateItemId: null,
} as ManagedMenuItem;
const branch = (id: string, name: string, status: ManagedStore['status'] = 'ACTIVE') =>
  ({ id, name, status }) as ManagedStore;
const branches = [
  branch('n', 'North'),
  branch('s', 'South', 'DRAFT'),
  branch('x', 'Old', 'ARCHIVED'),
];
const onClose = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  // North renamed its copy; South has none.
  menu.fetchManagedMenu.mockImplementation(async (id: string) =>
    id === 'n'
      ? [{ ...template, id: 'c1', name: 'Cutting Chai', price: 120, templateItemId: 't1' }]
      : [],
  );
});

const show = () =>
  render(<PushSheet brandId="b1" item={template} branches={branches} onClose={onClose} />);

describe('PushSheet', () => {
  it("previews each branch's change, found by lineage, and never offers a closed branch", async () => {
    show();
    const preview = await screen.findByRole('region', { name: 'What will change' });
    await waitFor(() => expect(preview).toHaveTextContent('Price at North: ₹120 → ₹140'));
    expect(preview).toHaveTextContent('South gets a new copy');
    expect(screen.queryByLabelText('Old')).toBeNull();
    expect(screen.getByLabelText('South (draft)')).toBeChecked();
  });

  it('pushes the chosen branches and fields, and says how many changed', async () => {
    stores.pushTemplate.mockResolvedValue(1);
    show();
    await screen.findByText('Price at North: ₹120 → ₹140');
    fireEvent.click(screen.getByLabelText('South (draft)'));
    fireEvent.click(screen.getByLabelText('Name'));
    expect(screen.getByText('Name at North: Cutting Chai → Masala Chai')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 branch updated.');
    expect(stores.pushTemplate).toHaveBeenCalledWith('b1', {
      itemIds: ['t1'],
      storeIds: ['n'],
      fields: ['price', 'name'],
    });
  });

  it("holds Push when nothing would change, and shows a refusal's reason", async () => {
    stores.pushTemplate.mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', 'An item or a store is not part of this brand.'),
    );
    show();
    await screen.findByText('Price at North: ₹120 → ₹140');
    // North's copy already has the template's name: pushing only the name to North changes nothing.
    fireEvent.click(screen.getByLabelText('South (draft)'));
    fireEvent.click(screen.getByLabelText('Price'));
    fireEvent.click(screen.getByLabelText('Category'));
    expect(screen.getByText(/already match/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Price'));
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not part of this brand');
  });

  it('warns that a branch older than lineage would get a second item beside its own of that name', async () => {
    menu.fetchManagedMenu.mockImplementation(async (id: string) =>
      id === 'n' ? [{ ...template, id: 'own', templateItemId: null }] : [],
    );
    show();
    expect(
      await screen.findByText('North gets a new copy beside its own “Masala Chai”'),
    ).toBeInTheDocument();
  });

  it('a branch whose menu fails to load blocks only a push that includes it', async () => {
    menu.fetchManagedMenu.mockImplementation(async (id: string) => {
      if (id === 's') throw new ApiError(500, 'X', 'down');
      return [{ ...template, id: 'c1', name: 'Cutting Chai', price: 120, templateItemId: 't1' }];
    });
    show();
    expect(await screen.findByText(/Couldn't load South/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('South (draft)'));
    expect(await screen.findByText('Price at North: ₹120 → ₹140')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled();
  });

  it('waits for the branch list, says so when it fails, and chooses every branch once it arrives', async () => {
    const { rerender } = render(
      <PushSheet brandId="b1" item={template} branches={null} onClose={onClose} />,
    );
    expect(screen.getByLabelText('Loading the branches')).toBeInTheDocument();
    const retry = vi.fn();
    rerender(
      <PushSheet
        brandId="b1"
        item={template}
        branches={null}
        branchesError={new ApiError(500, 'X', 'Brands down')}
        onRetryBranches={retry}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Brands down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
    rerender(<PushSheet brandId="b1" item={template} branches={branches} onClose={onClose} />);
    expect(screen.getByLabelText('North')).toBeChecked();
    expect(screen.getByLabelText('South (draft)')).toBeChecked();
  });

  it('Escape closes it', async () => {
    show();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    await screen.findByRole('dialog');
    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent(
      'Masala Chai',
    );
  });
});
