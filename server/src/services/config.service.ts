import type { ConfigDto } from '../types/api';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { APP_VERSION } from '../utils/version';
import { evaluateFlag, getFlags } from './flags.service';
import { getSettings } from './settings.service';

// Every app start fetches the config, so an unreadable flags table would log on each one: once per outage instead.
let flagsUnreadable = false;

/**
 * Every client-visible flag, as it evaluates for nobody in particular: an untargeted flag is its `enabled`, a targeted
 * one is false (it needs the caller, which the planned `/api/me/config` will supply). Fails closed: if the flags
 * cannot be read the client gets no features, never a 500 on the config every app start needs.
 */
async function clientFeatures(): Promise<Record<string, boolean>> {
  try {
    const flags = [...(await getFlags()).values()].filter((flag) => flag.clientVisible);
    flagsUnreadable = false;
    return Object.fromEntries(flags.map((flag) => [flag.key, evaluateFlag(flag, {})]));
  } catch (err) {
    if (!flagsUnreadable) logger.warn({ err }, 'Feature flags unreadable, no features');
    flagsUnreadable = true;
    return {};
  }
}

/**
 * What the client needs to run: limits, poll intervals, the session length, the error-reporting sample, the
 * client-visible flags and later payment. Derived
 * from the cached site settings, so it has no cache key or invalidation of its own: an admin's change reaches it
 * through invalidate('site_settings'), and a flag flip through invalidate('feature_flags').
 */
export async function getConfig(): Promise<ConfigDto> {
  const [settings, features] = await Promise.all([getSettings(), clientFeatures()]);
  return {
    serverVersion: APP_VERSION,
    minClientVersion: settings.min_client_version,
    features,
    // null until P5 (payments).
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
