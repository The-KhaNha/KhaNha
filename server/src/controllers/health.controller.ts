import type { RequestHandler } from 'express';
import { supabaseAdmin } from '../utils/supabase';
import { APP_VERSION, GIT_COMMIT } from '../utils/version';

const READY_TIMEOUT_MS = 1000;

/** Liveness: the process answers. Never touches the database, so an outage there does not restart healthy containers. */
export const getHealth: RequestHandler = (_req, res) => {
  res.json({ ok: true, version: APP_VERSION, commit: GIT_COMMIT });
};

type Probe = (signal: AbortSignal) => Promise<unknown>;

async function probeDatabase(signal: AbortSignal): Promise<void> {
  await supabaseAdmin
    .from('site_settings')
    .select('id')
    .abortSignal(signal)
    .single()
    .throwOnError();
}

/**
 * Readiness: the API can serve, i.e. the database answers within a second. A failure is the answer (503), not an
 * error, so it never reaches the error handler and never logs at error on every balancer probe.
 */
export function readinessHandler(probe: Probe = probeDatabase): RequestHandler {
  return async (_req, res) => {
    try {
      await probe(AbortSignal.timeout(READY_TIMEOUT_MS));
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  };
}

export const getReady = readinessHandler();
