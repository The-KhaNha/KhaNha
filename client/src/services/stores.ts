import type { MenuResponse, Store, StoreScheduleResponse, StoreSummary } from '../types/api';
import { request } from './api';

const path = (ref: string, tail = '') => `/stores/${encodeURIComponent(ref)}${tail}`;

const requestStores = async () =>
  (await request<{ stores: StoreSummary[] }>('/stores', { auth: false })).stores;

export const fetchStoreByRef = async (ref: string) =>
  (await request<{ store: Store }>(path(ref), { auth: false })).store;

const requestStoreMenu = (ref: string) =>
  request<MenuResponse>(path(ref, '/menu'), { auth: false });

export const fetchStoreHours = (ref: string) =>
  request<StoreScheduleResponse>(path(ref, '/hours'), { auth: false });

// Started while the app boots (main.tsx), like prefetchMenu: handed out once, so later calls ask the server again.
const prefetched = new Map<string, Promise<unknown>>();

function take<T>(key: string, make: () => Promise<T>): Promise<T> {
  const pending = prefetched.get(key) as Promise<T> | undefined;
  prefetched.delete(key);
  return pending ?? make();
}

function prefetch(key: string, make: () => Promise<unknown>): void {
  const pending = prefetched.get(key) ?? make();
  prefetched.set(key, pending);
  pending.catch(() => {});
}

export const prefetchStores = () => prefetch('stores', requestStores);
export const prefetchStoreMenu = (ref: string) =>
  prefetch(`menu:${ref}`, () => requestStoreMenu(ref));
export const fetchStoreMenu = (ref: string) => take(`menu:${ref}`, () => requestStoreMenu(ref));
export const fetchStores = () => take('stores', requestStores);
