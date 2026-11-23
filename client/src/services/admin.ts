import type { AdminBrand, BrandInvite, SiteSettings } from '../types/api';
import { request } from './api';

export async function fetchSiteSettings(): Promise<SiteSettings> {
  const { settings } = await request<{ settings: SiteSettings }>('/admin/settings');
  return settings;
}

export async function updateSiteSettings(changes: Partial<SiteSettings>): Promise<SiteSettings> {
  const { settings } = await request<{ settings: SiteSettings }>('/admin/settings', {
    method: 'PATCH',
    body: changes,
  });
  return settings;
}

export async function fetchAdminBrands(): Promise<AdminBrand[]> {
  const { brands } = await request<{ brands: AdminBrand[] }>('/admin/brands');
  return brands;
}

export async function createBrand(body: { name: string; slug?: string }): Promise<AdminBrand> {
  const { brand } = await request<{ brand: AdminBrand }>('/admin/brands', {
    method: 'POST',
    body,
  });
  return brand;
}

/** The token is in this response only: show it once, never store it. */
export const createOwnerInvite = (brandId: string, email: string) =>
  request<{ invite: BrandInvite; token: string }>(
    `/admin/brands/${encodeURIComponent(brandId)}/invites`,
    { method: 'POST', body: { email } },
  );

export const revokeOwnerInvite = (brandId: string, inviteId: string) =>
  request<void>(
    `/admin/brands/${encodeURIComponent(brandId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  );
