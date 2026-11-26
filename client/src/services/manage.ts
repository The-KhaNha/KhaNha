import type { Invite, Member, StoreRole, StoreSettings } from '../types/api';
import { request } from './api';

const base = (storeId: string, tail = '') => `/stores/${encodeURIComponent(storeId)}${tail}`;

export const fetchStoreSettings = async (storeId: string) =>
  (await request<{ settings: StoreSettings }>(base(storeId, '/settings'))).settings;

export const updateStoreSettings = async (storeId: string, changes: Partial<StoreSettings>) =>
  (
    await request<{ settings: StoreSettings }>(base(storeId, '/settings'), {
      method: 'PATCH',
      body: changes,
    })
  ).settings;

export const fetchTeam = (storeId: string) =>
  request<{ members: Member[]; invites: Invite[] }>(base(storeId, '/members'));

/** The `token` is in this answer only: the caller shows it once and keeps it in memory. */
export const createInvite = (storeId: string, input: { email: string; role: StoreRole }) =>
  request<{ invite: Invite; token: string }>(base(storeId, '/invites'), {
    method: 'POST',
    body: input,
  });

export const revokeInvite = (storeId: string, inviteId: string) =>
  request<void>(base(storeId, `/invites/${encodeURIComponent(inviteId)}`), { method: 'DELETE' });

export const removeMember = (storeId: string, membershipId: string) =>
  request<void>(base(storeId, `/members/${encodeURIComponent(membershipId)}`), {
    method: 'DELETE',
  });

/** The signed-in member leaves the store: their own membership, so no id to pass. */
export const leaveStore = (storeId: string) =>
  request<void>(base(storeId, '/membership'), { method: 'DELETE' });

export const acceptInvite = async (token: string) =>
  (
    await request<{
      membership: {
        id: string;
        role: StoreRole;
        store: { id: string; slug: string; name: string };
      };
    }>('/me/invites/accept', { method: 'POST', body: { token } })
  ).membership;

/** Accepts an owner invite (P7.4a): the signed-in account becomes the brand's owner. Every refusal is a 404. */
export const acceptOwnerInvite = async (token: string) =>
  (
    await request<{ brand: { id: string; name: string; slug: string } }>(
      '/me/brand-invites/accept',
      { method: 'POST', body: { token } },
    )
  ).brand;
