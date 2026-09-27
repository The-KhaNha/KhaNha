import type { SiteSettings } from '../types/api';
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
