import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetchForPath } from './stores';

describe('prefetchForPath', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores a malformed store ref instead of throwing before the app mounts', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(() => prefetchForPath('/s/%/menu')).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
