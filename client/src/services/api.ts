import type { ApiErrorDetails, ApiErrorEnvelope } from '../types/api';
import { useAuthStore } from '../features/auth/authStore';
import { APP_VERSION } from '../lib/appVersion';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

const BASE_URL = '/api';
/** Longest wait for a response (headers and body) before the request counts as unreachable. */
export const REQUEST_TIMEOUT_MS = 15_000;

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
  // supabase-js hands out the current access token, refreshing it first when it has expired.
  const token = auth ? (await supabase.auth.getSession()).data.session?.access_token : undefined;

  // Same origin (Vite proxy, nginx), so the custom header costs no CORS preflight.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client-Version': APP_VERSION,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  // A stalled connection must end in the unreachable state, never an endless skeleton. The timer covers the body
  // read too. The caller's own abort still rethrows as an AbortError. (No AbortSignal.any: older iOS Safari lacks it.)
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);

  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    payload = await response.json().catch(() => null);
    if (controller.signal.aborted) throw controller.signal.reason;
  } catch (err) {
    if (signal?.aborted) throw err;
    // debug only: a polling screen that goes offline would otherwise log every few seconds.
    logger.debug('API unreachable', { method, path, timedOut: controller.signal.aborted });
    throw new ApiError(
      0,
      'UNREACHABLE',
      "We couldn't reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }

  if (!response.ok) {
    // requestId matches the server's log line for this request. A 4xx is expected, so only 5xx is an error.
    const context = {
      method,
      path,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    };
    if (response.status >= 500) logger.error('API request failed', context);
    else logger.debug('API request rejected', context);
    if (response.status === 401 && auth && token) {
      useAuthStore.getState().clearSession();
    }
    if (isErrorEnvelope(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(
        response.status,
        code,
        message,
        typeof details === 'object' && details !== null ? details : undefined,
      );
    }
    if (response.status >= 500) {
      throw new ApiError(
        response.status,
        'UNREACHABLE',
        "We couldn't reach the server. Please try again in a moment.",
      );
    }
    throw new ApiError(response.status, 'INTERNAL', 'Something went wrong.');
  }

  return payload as T;
}
