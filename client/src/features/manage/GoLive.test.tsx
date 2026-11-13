import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedStore, PublishMissing } from '../../types/api';

const api = vi.hoisted(() => ({ publishStore: vi.fn(), unpublishStore: vi.fn() }));
vi.mock('../../services/manageStores', () => api);

const { GoLive } = await import('./GoLive');
const { ApiError } = await import('../../services/api');

const store = (status: ManagedStore['status']) =>
  ({ id: 's1', slug: 'north', name: 'North', status, isTemplate: false }) as ManagedStore;
const onChanged = vi.fn();
const show = (status: ManagedStore['status'], missing: PublishMissing[] = []) =>
  render(
    <MemoryRouter>
      <GoLive store={store(status)} missing={missing} onChanged={onChanged} />
    </MemoryRouter>,
  );

beforeEach(() => vi.resetAllMocks());

describe('GoLive', () => {
  it('lists each check, linked to the tab that fixes it, and holds Publish until all pass', () => {
    show('DRAFT', ['address', 'menu']);
    const card = screen.getByRole('region', { name: 'Go live' });
    expect(within(card).getByRole('link', { name: /An address: still needed/ })).toHaveAttribute(
      'href',
      '/manage/north/profile',
    );
    expect(within(card).getByRole('link', { name: /Opening hours: done/ })).toHaveAttribute(
      'href',
      '/manage/north/hours',
    );
    expect(within(card).getByRole('link', { name: /order: still needed/ })).toHaveAttribute(
      'href',
      '/manage/north/menu',
    );
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('publishes a ready branch and reloads what shows it', async () => {
    api.publishStore.mockResolvedValue(store('ACTIVE'));
    show('DRAFT');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.publishStore).toHaveBeenCalledWith('s1');
  });

  it("shows the server's STORE_NOT_READY and reloads the checklist", async () => {
    api.publishStore.mockRejectedValue(
      new ApiError(409, 'STORE_NOT_READY', 'Add opening hours before publishing.'),
    );
    show('DRAFT');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add opening hours before publishing.',
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('a live branch unpublishes only after a confirm that says new orders stop', async () => {
    api.unpublishStore.mockResolvedValue(store('DRAFT'));
    show('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(api.unpublishStore).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('new orders stop');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(api.unpublishStore).toHaveBeenCalledWith('s1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows nothing for a suspended or closed branch (only an operator moves it)', () => {
    const { container } = show('SUSPENDED');
    expect(container).toBeEmptyDOMElement();
  });
});
