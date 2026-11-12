import type { Store } from '../types/api';
import { request } from './api';

export const fetchStore = async () =>
  (await request<{ store: Store }>('/store', { auth: false })).store;
