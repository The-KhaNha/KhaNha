import type { IncomingMessage, ServerResponse } from 'http';
import { describe, expect, it } from 'vitest';
import { accessLevel } from '../../src/app';
import { loggedAtDebug } from '../../src/middleware/errorHandler';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rateLimited } from '../../src/utils/errors';

const call = (method: string, status: number, quiet = false) => {
  const res = { statusCode: status } as ServerResponse;
  if (quiet) loggedAtDebug.add(res);
  return accessLevel({ method } as IncomingMessage, res);
};

describe('accessLevel', () => {
  it.each([
    ['GET', 200, false, 'debug'],
    ['HEAD', 304, false, 'debug'],
    ['POST', 201, false, 'info'],
    ['PATCH', 200, false, 'info'],
    ['GET', 404, false, 'info'],
    ['POST', 429, false, 'info'],
    ['POST', 429, true, 'debug'],
    ['GET', 426, true, 'debug'],
  ] as const)('%s %i (quiet %s) is %s', (method, status, quiet, level) => {
    expect(call(method, status, quiet)).toBe(level);
  });
});

describe('server and client error details agree', () => {
  it('the client ApiErrorDetails declares every key the 429 details carry', () => {
    // The packages cannot import each other's types (rootDir), so read the client interface as text.
    const src = readFileSync(resolve(__dirname, '../../../client/src/types/api.ts'), 'utf8');
    const body = /interface ApiErrorDetails \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    for (const key of Object.keys(rateLimited('t', 'ip', 5, true).details ?? {})) {
      expect(body).toMatch(new RegExp(`\\b${key}\\??:`));
    }
  });
});
