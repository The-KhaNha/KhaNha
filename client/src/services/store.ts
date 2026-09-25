import type { Store } from '../types/api';
import { request } from './api';

export async function fetchStore(): Promise<Store> {
  const { store } = await request<{ store: Store }>('/store', { auth: false });
  return store;
}
