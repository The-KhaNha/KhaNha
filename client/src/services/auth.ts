import type { AuthResponse, User } from '../types/api';
import { request } from './api';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register', { method: 'POST', body: input, auth: false });
}

export function fetchMe(): Promise<{ user: User }> {
  return request<{ user: User }>('/auth/me');
}
