import type { Store } from '../types/api';
import { request } from './api';

let prefetched: Promise<Store> | null = null;

const requestStore = async () => (await request<{ store: Store }>('/store', { auth: false })).store;

/** Starts the store request while the app boots, when the visitor lands on / (see prefetchMenu in menu.ts). */
export function prefetchStore(): void {
  prefetched ??= requestStore();
  prefetched.catch(() => {});
}

export function fetchStore(): Promise<Store> {
  const pending = prefetched;
  prefetched = null;
  return pending ?? requestStore();
}
