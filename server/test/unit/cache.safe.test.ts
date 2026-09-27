import { afterEach, describe, expect, it, vi } from 'vitest';
import { cached, invalidate } from '../../src/utils/cache';

describe('cached', () => {
  afterEach(() => {
    invalidate();
    vi.useRealTimers();
  });

  it('shares one load between concurrent callers', async () => {
    const load = vi.fn(async () => 'menu');
    const [a, b] = await Promise.all([cached('k', 1000, load), cached('k', 1000, load)]);
    expect([a, b]).toEqual(['menu', 'menu']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads once the TTL has passed', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => Date.now());
    await cached('k', 1000, load);
    vi.advanceTimersByTime(999);
    await cached('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await cached('k', 1000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never caches a failed load', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('menu');
    await expect(cached('k', 1000, load)).rejects.toThrow('db down');
    await expect(cached('k', 1000, load)).resolves.toBe('menu');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads after invalidate, per key or all', async () => {
    const load = vi.fn(async () => 'x');
    await cached('a', 1000, load);
    await cached('b', 1000, load);
    invalidate('a');
    await cached('a', 1000, load);
    await cached('b', 1000, load);
    expect(load).toHaveBeenCalledTimes(3);
    invalidate();
    await cached('b', 1000, load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
