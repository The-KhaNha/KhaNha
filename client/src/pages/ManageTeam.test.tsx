import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/api';

const svc = vi.hoisted(() => ({
  fetchTeam: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('../services/manage', () => svc);
const { ManageTeamTab } = await import('./ManageTeam');
const { useAuthStore } = await import('../features/auth/authStore');

const store = { id: 's1', brand: { id: 'b1', name: 'B', slug: 'b' } };
const person = (over: Partial<User>) =>
  ({ id: 'me', role: 'CUSTOMER', memberships: [], ownedBrands: [], ...over }) as User;
const owner = person({ ownedBrands: [store.brand] });
const manager = person({
  memberships: [{ storeId: 's1', storeSlug: 's', storeName: 'S', role: 'MANAGER' }],
});
const member = (id: string, userId: string, name: string, role: string) =>
  ({ id, userId, name, email: `${id}@x.test`, role, joinedAt: '' }) as const;
const invite = (id: string, email: string, role: string) =>
  ({ id, email, role, expiresAt: '2026-12-01T00:00:00Z', createdAt: '' }) as const;
const team = {
  members: [
    member('m1', 'me', 'Me Manager', 'MANAGER'),
    member('m2', 'u2', 'Other Manager', 'MANAGER'),
    member('m3', 'u3', 'Sam Staff', 'STAFF'),
  ],
  invites: [invite('i1', 'mgr@x.test', 'MANAGER'), invite('i2', 'stf@x.test', 'STAFF')],
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  svc.fetchTeam.mockResolvedValue(team);
});

describe('ManageTeamTab', () => {
  it('offers a manager no Manager role and no remove or revoke on other managers', async () => {
    render(<ManageTeamTab store={store} user={manager} />);
    await screen.findByText('Sam Staff');
    expect(screen.queryByRole('option', { name: 'Manager' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Me Manager' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Other Manager' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Sam Staff' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke invite for mgr@/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Revoke invite for stf@/ })).toBeInTheDocument();
  });

  it('shows the owner the Manager option and the join link once, never storing the token', async () => {
    svc.createInvite.mockResolvedValue({ invite: team.invites[0], token: 'secret-token' });
    render(<ManageTeamTab store={store} user={owner} />);
    await screen.findByText('Sam Staff');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.test' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(svc.createInvite).toHaveBeenCalledWith('s1', { email: 'new@x.test', role: 'MANAGER' });
    expect(
      await screen.findByText(`${window.location.origin}/join#secret-token`),
    ).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-token');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(/secret-token/)).toBeNull();
  });

  it('asks before removing, then reloads the team', async () => {
    svc.removeMember.mockResolvedValue(undefined);
    render(<ManageTeamTab store={store} user={owner} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sam Staff' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(svc.removeMember).toHaveBeenCalledWith('s1', 'm3');
    await vi.waitFor(() => expect(svc.fetchTeam).toHaveBeenCalledTimes(2));
  });

  it('re-reads the account after a manager removes themselves', async () => {
    const hydrate = vi.spyOn(useAuthStore.getState(), 'hydrate').mockResolvedValue();
    svc.removeMember.mockResolvedValue(undefined);
    render(<ManageTeamTab store={store} user={manager} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Me Manager' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
  });
});
