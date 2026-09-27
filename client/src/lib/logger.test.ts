import { describe, expect, it } from 'vitest';
import { resolveLevel } from './logger';

describe('resolveLevel', () => {
  it('uses VITE_LOG_LEVEL when it names a level', () => {
    expect(resolveLevel('error', true)).toBe('error');
    expect(resolveLevel('silent', false)).toBe('silent');
  });

  it('falls back to debug in dev and warn in builds', () => {
    expect(resolveLevel(undefined, true)).toBe('debug');
    expect(resolveLevel(undefined, false)).toBe('warn');
    expect(resolveLevel('verbose', false)).toBe('warn');
  });
});
