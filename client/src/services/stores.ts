import type {
  MenuResponse,
  ScheduleException,
  Store,
  StoreHours,
  StoreScheduleResponse,
  StoreSummary,
} from '../types/api';
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

/** What POST .../schedule-exceptions takes; `CLOSED` carries no times. */
export interface NewException {
  startsOn: string;
  endsOn: string;
  kind: ScheduleException['kind'];
  opensAt?: string;
  closesAt?: string;
  label: string;
}

/** Replaces the whole week; the server refuses overlaps with a 400 VALIDATION_ERROR message. */
export const saveStoreHours = (storeId: string, hours: StoreHours[]) =>
  request<StoreScheduleResponse>(path(storeId, '/hours'), { method: 'PUT', body: { hours } });

export const createScheduleException = async (storeId: string, body: NewException) =>
  (
    await request<{ exception: ScheduleException }>(path(storeId, '/schedule-exceptions'), {
      method: 'POST',
      body,
    })
  ).exception;

export const deleteScheduleException = (storeId: string, exceptionId: string) =>
  request<void>(path(storeId, `/schedule-exceptions/${encodeURIComponent(exceptionId)}`), {
    method: 'DELETE',
  });

// Started while the app boots (main.tsx): handed out once, so later calls ask the server again.
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

/** The landing page's public data, started before the first render (main.tsx). A malformed path prefetches nothing. */
export function prefetchForPath(pathname: string): void {
  const landedMenu = /^\/s\/([^/]+)\/menu$/.exec(pathname);
  if (landedMenu) {
    let ref: string;
    try {
      ref = decodeURIComponent(landedMenu[1]!);
    } catch {
      return; // `/s/%/menu`: the router shows its own answer
    }
    prefetchStoreMenu(ref);
  } else if (pathname === '/') prefetchStores();
}

export const prefetchStores = () => prefetch('stores', requestStores);
export const prefetchStoreMenu = (ref: string) =>
  prefetch(`menu:${ref}`, () => requestStoreMenu(ref));
export const fetchStoreMenu = (ref: string) => take(`menu:${ref}`, () => requestStoreMenu(ref));
export const fetchStores = () => take('stores', requestStores);
