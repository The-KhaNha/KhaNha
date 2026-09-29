import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import { getSettings } from '../services/settings.service';
import { clientOutdated } from '../utils/errors';
import { compareSemver } from '../utils/semver';

// Short and plain only, so a forged header cannot inject content into the access log.
const CLIENT_VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const MAX_LENGTH = 32;

/** The client's `X-Client-Version`, or undefined when it is missing or malformed. */
export function readClientVersion(req: IncomingMessage): string | undefined {
  const value = req.headers['x-client-version'];
  if (typeof value !== 'string' || value.length > MAX_LENGTH || !CLIENT_VERSION.test(value)) {
    return undefined;
  }
  return value;
}

// The deployed V0 client sends no header; it is 0.1.0.
const LEGACY_CLIENT_VERSION = '0.1.0';

/**
 * 426 CLIENT_OUTDATED for a client older than site_settings.min_client_version. Settings come through the read
 * cache, so this costs no database round trip per request. Probes, config and webhooks are exempt by being mounted
 * before it (routes/index.ts).
 */
export const clientVersionGate: RequestHandler = async (req, _res, next) => {
  const version = readClientVersion(req) ?? LEGACY_CLIENT_VERSION;
  const { min_client_version: minimum } = await getSettings();
  if (compareSemver(version, minimum) < 0) throw clientOutdated();
  next();
};
