import type { ModifierGroup } from '../types/api';
import { request } from './api';

const base = (storeId: string, tail = '') =>
  `/stores/${encodeURIComponent(storeId)}/modifier-groups${tail}`;

/** A group as the editor saves it: the whole group, its options in order (an option with an id is updated). */
export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: {
    id?: string;
    name: string;
    /** Whole rupees, may be negative. */
    priceDelta: number;
    isDefault: boolean;
    isAvailable: boolean;
  }[];
}

/** The store's live groups, and each item's group ids in order (GET …/modifier-groups). */
export interface StoreModifiers {
  groups: ModifierGroup[];
  itemGroupIds: Record<string, string[]>;
}

export const fetchModifierGroups = (storeId: string) => request<StoreModifiers>(base(storeId));

export const createModifierGroup = async (storeId: string, input: ModifierGroupInput) =>
  (await request<{ group: ModifierGroup }>(base(storeId), { method: 'POST', body: input })).group;

export const updateModifierGroup = async (
  storeId: string,
  groupId: string,
  input: ModifierGroupInput,
) =>
  (
    await request<{ group: ModifierGroup }>(base(storeId, `/${encodeURIComponent(groupId)}`), {
      method: 'PATCH',
      body: input,
    })
  ).group;

export const archiveModifierGroup = (storeId: string, groupId: string) =>
  request<void>(base(storeId, `/${encodeURIComponent(groupId)}`), { method: 'DELETE' });

export const setItemModifierGroups = (storeId: string, itemId: string, groupIds: string[]) =>
  request<{ groupIds: string[] }>(
    `/stores/${encodeURIComponent(storeId)}/menu-items/${encodeURIComponent(itemId)}/modifier-groups`,
    { method: 'PUT', body: { groupIds } },
  );
