import type { MenuResponse } from '../types/api';
import { request } from './api';

export function fetchMenu(): Promise<MenuResponse> {
  return request<MenuResponse>('/menu', { auth: false });
}
