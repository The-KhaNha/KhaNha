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
  return data ?? CONFIG_FALLBACK;
}
