import type {
  ManageStoreResponse,
  ManagedStore,
  MyBrand,
  StoreScheduleResponse,
} from '../types/api';
import { request } from './api';

const store = (storeId: string, tail = '') => `/stores/${encodeURIComponent(storeId)}${tail}`;

/** The fields of a branch's profile the owner and its managers edit; `null` clears a place or the phone. */
export interface StoreProfileInput {
  name?: string;
  tagline?: string;
  description?: string;
  area?: string | null;
  addressLine?: string | null;
  contactPhone?: string | null;
}

export const fetchMyBrands = async () =>
  (await request<{ brands: MyBrand[] }>('/brands/mine')).brands;

/** Opens a DRAFT branch, a copy of the brand's template. `slug` omitted: the server makes one from the name. */
export const openBranch = async (
  brandId: string,
  input: { name: string; slug?: string; area?: string; addressLine?: string },
) =>
  (
    await request<{ store: ManagedStore }>(`/brands/${encodeURIComponent(brandId)}/stores`, {
      method: 'POST',
      body: input,
    })
  ).store;

export const fetchManagedStore = (storeId: string) =>
  request<ManageStoreResponse>(store(storeId, '/manage'));

export const fetchManagedHours = (storeId: string) =>
  request<StoreScheduleResponse>(store(storeId, '/manage/hours'));

export const updateStoreProfile = async (storeId: string, input: StoreProfileInput) =>
  (
    await request<{ store: ManagedStore }>(store(storeId, '/profile'), {
      method: 'PATCH',
      body: input,
    })
  ).store;

export const publishStore = async (storeId: string) =>
  (await request<{ store: ManagedStore }>(store(storeId, '/publish'), { method: 'POST' })).store;

export const unpublishStore = async (storeId: string) =>
  (await request<{ store: ManagedStore }>(store(storeId, '/unpublish'), { method: 'POST' })).store;
