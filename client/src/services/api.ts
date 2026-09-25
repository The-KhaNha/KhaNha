import type { ApiErrorDetails, ApiErrorEnvelope } from '../types/api';
import { useAuthStore } from '../features/auth/authStore';

const BASE_URL = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** For errors about one cart line: which item, and how many are left. */
  readonly details?: ApiErrorDetails;

  constructor(status: number, code: string, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the request never reached the API (network down, proxy failure). */
  get isUnreachable(): boolean {
    return this.status === 0 || this.code === 'UNREACHABLE';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the bearer token when one exists. Defaults to true. */
  auth?: boolean;
  signal?: AbortSignal;
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'UNREACHABLE', "We couldn't reach the server. Check your connection and try again.");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && auth && token) {
      useAuthStore.getState().clearSession();
    }
    if (isErrorEnvelope(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(response.status, code, message, typeof details === 'object' && details !== null ? details : undefined);
    }
    if (response.status >= 500) {
      throw new ApiError(response.status, 'UNREACHABLE', "We couldn't reach the server. Please try again in a moment.");
    }
    throw new ApiError(response.status, 'INTERNAL', 'Something went wrong.');
  }

  return payload as T;
}
