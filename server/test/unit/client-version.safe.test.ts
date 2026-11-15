import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readClientVersion } from '../../src/middleware/clientVersion';

const req = (value?: string | string[]) =>
  ({ headers: value === undefined ? {} : { 'x-client-version': value } }) as IncomingMessage;

describe('readClientVersion', () => {
  it('accepts a semver version with an optional prerelease', () => {
    expect(readClientVersion(req('0.1.0'))).toBe('0.1.0');
    expect(readClientVersion(req('1.2.3-dev.4'))).toBe('1.2.3-dev.4');
  });

  it('rejects missing, malformed, oversized or repeated headers', () => {
    expect(readClientVersion(req())).toBeUndefined();
    expect(readClientVersion(req('latest'))).toBeUndefined();
    expect(readClientVersion(req('1.2.3\n{"level":60}'))).toBeUndefined();
    expect(readClientVersion(req(`1.2.3-${'a'.repeat(40)}`))).toBeUndefined();
    expect(readClientVersion(req(['1.0.0', '2.0.0']))).toBeUndefined();
  });
});
