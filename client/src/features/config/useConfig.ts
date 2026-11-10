import { useMemo } from 'react';
import { useResource } from '../../lib/useResource';
import { fetchConfig } from '../../services/config';
import type { Config } from '../../types/api';
import { CONFIG_FALLBACK } from './fallbacks';

/**
 * The server's configuration (limits, poll intervals, session length). Public and the same for everyone, so it is
 * persisted (CLAUDE.md §2c) and renders from the last copy at once; the fallbacks stand in until the first load and
 * whenever the API cannot be reached.
 */
export function useConfig(): Config {
  const { data } = useResource(fetchConfig, { key: 'config', persist: true });
  // Memoised, so the object stays the same between renders.
  return useMemo(() => (data ? withFallback(CONFIG_FALLBACK, data) : CONFIG_FALLBACK), [data]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `value` with every missing, null or wrongly typed field replaced by the fallback's, at every depth. A copy persisted
 * before a field existed, an API deployed behind this client, or a malformed response (`clientErrors: null`) would
 * otherwise hand a reader undefined and crash the app. Fields the fallback lacks (a new feature flag) pass through.
 */
export function withFallback<T>(fallback: T, value: unknown): T {
  if (value === null || value === undefined) return fallback;
  if (isPlainObject(fallback)) {
    if (!isPlainObject(value)) return fallback;
    const merged: Record<string, unknown> = { ...value };
    for (const key of Object.keys(fallback)) merged[key] = withFallback(fallback[key], value[key]);
    return merged as T;
  }
  if (Array.isArray(fallback) !== Array.isArray(value)) return fallback;
  if (fallback !== null && typeof value !== typeof fallback) return fallback;
  return value as T;
}
