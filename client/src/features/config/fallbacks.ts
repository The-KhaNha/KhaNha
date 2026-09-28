import fallbacks from '../../config/fallbacks.json';
import type { Config } from '../../types/api';

/**
 * The client's one copy of the server's configuration defaults (GET /api/config) and field bounds. Used until the
 * config loads, and when it cannot. server/test/api/config.test.ts and test/unit/limits-parity.safe.test.ts fail when
 * it drifts from the API.
 */
export const CONFIG_FALLBACK: Config = { ...fallbacks, serverVersion: 'unknown' };

/** Field bounds the API enforces (server/src/schemas/limits.ts). */
export const VALIDATION = fallbacks.validation;
