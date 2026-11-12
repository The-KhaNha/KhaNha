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

const store = { id: 's1', brand: { id: 'b1', name: 'B', slug: 'b' } };
const person = (over: Partial<User>) =>
  ({ id: 'me', role: 'CUSTOMER', memberships: [], ownedBrands: [], ...over }) as User;
const owner = person({ ownedBrands: [store.brand] });
const manager = person({
  memberships: [{ storeId: 's1', storeSlug: 's', storeName: 'S', role: 'MANAGER' }],
});
const team = {
  members: [
    {
      id: 'm1',
      userId: 'me',
      name: 'Me Manager',
      email: 'me@x.test',
      role: 'MANAGER',
      joinedAt: '',
    },
    {
      id: 'm2',
      userId: 'u2',
      name: 'Other Manager',
      email: 'o@x.test',
      role: 'MANAGER',
      joinedAt: '',
    },
    { id: 'm3', userId: 'u3', name: 'Sam Staff', email: 's@x.test', role: 'STAFF', joinedAt: '' },
  ],
  invites: [
    {
      id: 'i1',
      email: 'mgr@x.test',
      role: 'MANAGER',
      expiresAt: '2026-12-01T00:00:00Z',
      createdAt: '',
    },
    {
      id: 'i2',
      email: 'stf@x.test',
      role: 'STAFF',
      expiresAt: '2026-12-01T00:00:00Z',
      createdAt: '',
    },
  ],
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
});
