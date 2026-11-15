import type { Diet, ManagedMenuItem } from '../types/api';
import { request } from './api';

const base = (storeId: string, tail = '') =>
  `/stores/${encodeURIComponent(storeId)}/menu-items${tail}`;

/** The fields the editor writes (`stockQuantity` is the stock screen's). */
export interface MenuItemInput {
  name: string;
  description: string;
  price: number;
  category: string;
  diet: Diet | null;
  isPopular: boolean;
  /** A processed upload of this store to show; null removes the photo; absent keeps it. */
  imageUploadId?: string | null;
}

export const fetchManagedMenu = async (storeId: string) =>
  (await request<{ items: ManagedMenuItem[] }>(base(storeId))).items;

export const createMenuItem = async (storeId: string, input: MenuItemInput) =>
  (await request<{ item: ManagedMenuItem }>(base(storeId), { method: 'POST', body: input })).item;

export const updateMenuItem = async (
  storeId: string,
  itemId: string,
  changes: Partial<MenuItemInput> & { isAvailable?: boolean },
) =>
  (
    await request<{ item: ManagedMenuItem }>(base(storeId, `/${encodeURIComponent(itemId)}`), {
      method: 'PATCH',
      body: changes,
    })
  ).item;

export const archiveMenuItem = (storeId: string, itemId: string) =>
  request<void>(base(storeId, `/${encodeURIComponent(itemId)}`), { method: 'DELETE' });

/** Switch several items, or a whole category, on or off at once. */
export const setAvailability = (
  storeId: string,
  target: { itemIds: string[] } | { category: string },
  isAvailable: boolean,
) =>
  request<{ updated: number }>(base(storeId, '/bulk'), {
    method: 'POST',
    body: { ...target, isAvailable },
  });

/** `itemIds` is every unarchived item of the store in its new order. */
export const reorderMenu = (storeId: string, itemIds: string[]) =>
  request<void>(base(storeId, '/order'), { method: 'PUT', body: { itemIds } });
