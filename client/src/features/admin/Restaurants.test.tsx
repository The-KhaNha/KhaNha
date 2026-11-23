import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminBrand } from '../../types/api';

const svc = vi.hoisted(() => ({
  fetchAdminBrands: vi.fn(),
  createBrand: vi.fn(),
  createOwnerInvite: vi.fn(),
  revokeOwnerInvite: vi.fn(),
}));
vi.mock('../../services/admin', () => svc);
const { Restaurants } = await import('./Restaurants');
const { ApiError } = await import('../../services/api');

const brand = (over: Partial<AdminBrand>): AdminBrand => ({
  id: 'b1',
  name: 'Chai Point',
  slug: 'chai-point',
  createdAt: '2026-11-01T00:00:00Z',
  branchCount: 2,
  owner: null,
  invite: null,
  ...over,
});
const invite = { id: 'i1', email: 'o@x.test', expiresAt: '2099-12-01T00:00:00Z', createdAt: '' };
const url = (token: string) => `${window.location.origin}/join/owner#${token}`;

function fill(name: string, email: string) {
  fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Owner email'), { target: { value: email } });
}

beforeEach(() => {
  vi.resetAllMocks();
  svc.fetchAdminBrands.mockResolvedValue([]);
});

describe('Restaurants', () => {
  it('shows loading, then the empty state', async () => {
    render(<Restaurants />);
    expect(screen.getByLabelText('Loading restaurants')).toBeInTheDocument();
    expect(await screen.findByText('No restaurants yet')).toBeInTheDocument();
  });

  it('shows an error with a retry that reloads', async () => {
    svc.fetchAdminBrands.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'Boom'));
    render(<Restaurants />);
    fireEvent.click(await screen.findByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('No restaurants yet')).toBeInTheDocument();
    expect(svc.fetchAdminBrands).toHaveBeenCalledTimes(2);
  });

  it('lists each state of a brand', async () => {
    svc.fetchAdminBrands.mockResolvedValue([
      brand({ id: 'a', name: 'Owned', owner: { id: 'u', name: 'Olive', email: 'olive@x.test' } }),
      brand({ id: 'b', name: 'Invited', invite }),
      brand({ id: 'c', name: 'Bare', branchCount: 1 }),
    ]);
    render(<Restaurants />);
    expect(await screen.findByText(/Olive \(olive@x.test\)/)).toBeInTheDocument();
    expect(screen.getByText(/Invite open for o@x.test, expires/)).toBeInTheDocument();
    expect(screen.getByText('No owner')).toBeInTheDocument();
    expect(screen.getByText('1 branch')).toBeInTheDocument();
  });

  it('says an invite past its time has expired', async () => {
    svc.fetchAdminBrands.mockResolvedValue([
      brand({ id: 'b', invite: { ...invite, expiresAt: '2000-01-01T00:00:00Z' } }),
    ]);
    render(<Restaurants />);
    expect(await screen.findByText(/Invite open for o@x.test, expired/)).toBeInTheDocument();
  });

  it('creates a brand, shows the owner link once and reloads', async () => {
    svc.createBrand.mockResolvedValue(brand({}));
    svc.createOwnerInvite.mockResolvedValue({ invite, token: 'tok123' });
    render(<Restaurants />);
    await screen.findByText('No restaurants yet');
    fill('Chai Point', 'o@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    expect(await screen.findByText(url('tok123'))).toBeInTheDocument();
    expect(svc.createBrand).toHaveBeenCalledWith({ name: 'Chai Point' });
    expect(svc.createOwnerInvite).toHaveBeenCalledWith('b1', 'o@x.test');
    await waitFor(() => expect(svc.fetchAdminBrands).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(url('tok123'))).toBeNull();
  });

  it('keeps the brand when the invite fails and never creates a second one', async () => {
    svc.createBrand.mockResolvedValue(brand({}));
    svc.createOwnerInvite.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_ERROR', 'That email belongs to an admin.', { field: 'email' }),
    );
    svc.fetchAdminBrands.mockResolvedValueOnce([]).mockResolvedValue([brand({})]);
    render(<Restaurants />);
    await screen.findByText('No restaurants yet');
    fill('Chai Point', 'o@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That email belongs to an admin.');
    fireEvent.click(await screen.findByRole('button', { name: 'Invite owner' }));
    expect(svc.createBrand).toHaveBeenCalledTimes(1);

    // Recovery: the row's own form (the last "Owner email", after the create form) sends a second invite.
    svc.createOwnerInvite.mockResolvedValueOnce({ invite, token: 'tok456' });
    fireEvent.change(screen.getAllByLabelText('Owner email').at(-1)!, {
      target: { value: 'fixed@x.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText(url('tok456'))).toBeInTheDocument();
    expect(svc.createOwnerInvite).toHaveBeenLastCalledWith('b1', 'fixed@x.test');
    expect(svc.createBrand).toHaveBeenCalledTimes(1);
  });

  it('shows a taken slug on the name field', async () => {
    svc.createBrand.mockRejectedValue(
      new ApiError(409, 'SLUG_TAKEN', 'Another restaurant already uses that web address.', {
        field: 'slug',
      }),
    );
    render(<Restaurants />);
    await screen.findByText('No restaurants yet');
    fill('Chai Point', 'o@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    expect(await screen.findByText(/already uses that web address/)).toBeInTheDocument();
    expect(svc.createOwnerInvite).not.toHaveBeenCalled();
  });

  it('refuses a bad email before any call', async () => {
    render(<Restaurants />);
    await screen.findByText('No restaurants yet');
    fill('Chai Point', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    await waitFor(() => expect(screen.getByLabelText('Owner email')).toBeInvalid());
    expect(svc.createBrand).not.toHaveBeenCalled();
  });

  it('invites an owner from a brand with none', async () => {
    svc.fetchAdminBrands.mockResolvedValue([brand({})]);
    svc.createOwnerInvite.mockResolvedValue({ invite, token: 'abc' });
    render(<Restaurants />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite owner' }));
    fireEvent.change(screen.getAllByLabelText('Owner email')[1]!, {
      target: { value: 'o@x.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText(url('abc'))).toBeInTheDocument();
    await waitFor(() => expect(svc.fetchAdminBrands).toHaveBeenCalledTimes(2));
  });

  it('revokes only after confirming, then reloads', async () => {
    svc.fetchAdminBrands.mockResolvedValue([brand({ invite })]);
    svc.revokeOwnerInvite.mockResolvedValue(undefined);
    render(<Restaurants />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke invite for o@x.test' }));
    expect(svc.revokeOwnerInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(svc.revokeOwnerInvite).toHaveBeenCalledWith('b1', 'i1'));
    await waitFor(() => expect(svc.fetchAdminBrands).toHaveBeenCalledTimes(2));
  });

  it('New link issues a fresh link for the open invite email and reloads', async () => {
    svc.fetchAdminBrands.mockResolvedValue([brand({ invite })]);
    svc.createOwnerInvite.mockResolvedValue({ invite, token: 'fresh' });
    render(<Restaurants />);
    fireEvent.click(await screen.findByRole('button', { name: 'New link' }));
    expect(await screen.findByText(url('fresh'))).toBeInTheDocument();
    expect(svc.createOwnerInvite).toHaveBeenCalledWith('b1', 'o@x.test');
    await waitFor(() => expect(svc.fetchAdminBrands).toHaveBeenCalledTimes(2));
  });

  it('locks every invite action while one is in flight, so a one-time link is never replaced', async () => {
    svc.fetchAdminBrands.mockResolvedValue([
      brand({ id: 'a', name: 'A', invite }),
      brand({ id: 'b', name: 'B', invite: { ...invite, id: 'i2', email: 'p@x.test' } }),
    ]);
    let resolve!: (v: unknown) => void;
    svc.createOwnerInvite.mockReturnValueOnce(new Promise((res) => (resolve = res)));
    render(<Restaurants />);
    const buttons = await screen.findAllByRole('button', { name: 'New link' });
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(buttons[1]).toBeDisabled());
    fireEvent.click(buttons[1]!);
    expect(svc.createOwnerInvite).toHaveBeenCalledTimes(1);
    resolve({ invite, token: 'first' });
    expect(await screen.findByText(url('first'))).toBeInTheDocument();
    // The link stays locked until the admin is done with it.
    expect(screen.getAllByRole('button', { name: 'New link' })[1]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create and get link' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getAllByRole('button', { name: 'New link' })[1]).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create and get link' })).toBeEnabled();
  });
});
