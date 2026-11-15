import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './env';

// Relative to the working directory, never __dirname: that is src/ under tsx but dist/src/ once built, while the
// process always starts in server/ (dev, tests) or /app (the image), next to package.json.
function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const version = (pkg as { version?: unknown }).version;
  return typeof version === 'string' ? version : '0.0.0';
}

/** The server's released version (package.json, bumped only by the release PR). */
export const APP_VERSION = readVersion();

/** The commit the running build came from; staging builds share a version, so this tells them apart. */
export const GIT_COMMIT = env.GIT_COMMIT;
