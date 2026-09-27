import type { IncomingMessage } from 'node:http';

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
