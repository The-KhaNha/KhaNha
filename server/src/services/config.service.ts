import type { ConfigDto } from '../types/api';
import { env } from '../utils/env';
import { APP_VERSION } from '../utils/version';
import { getSettings } from './settings.service';

/**
 * What the client needs to run: limits, poll intervals, the session length and later features and payment. Derived
 * from the cached site settings, so it has no cache key or invalidation of its own: an admin's change reaches it
 * through invalidate('site_settings').
 */
export async function getConfig(): Promise<ConfigDto> {
  const settings = await getSettings();
  return {
    serverVersion: APP_VERSION,
    minClientVersion: settings.min_client_version,
    // Empty until P1.7 (feature flags); null until P5 (payments).
    features: {},
    payment: null,
    limits: { maxLinesPerOrder: settings.max_lines_per_order },
    polling: {
      orderMs: settings.order_poll_ms,
      ordersMs: settings.orders_poll_ms,
      staffBoardMs: settings.staff_board_poll_ms,
    },
    session: { idleDays: env.SESSION_IDLE_DAYS },
    clientErrors: { samplePercent: settings.client_error_sample_percent },
  };
}
