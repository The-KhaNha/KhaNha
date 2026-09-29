import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUuid } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the context is secure', () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (plain http on a LAN)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const a = randomUuid();
    expect(a).toMatch(UUID_V4);
    expect(randomUuid()).not.toBe(a);
  });
});
