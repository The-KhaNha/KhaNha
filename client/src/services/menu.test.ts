import { afterEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ request }));

const { fetchMenu, prefetchMenu } = await import('./menu');

describe('prefetchMenu', () => {
  afterEach(() => request.mockReset());

  it('hands its in-flight response to the next fetchMenu, once', async () => {
    request.mockResolvedValue({ categories: [] });
    prefetchMenu();
    expect(request).toHaveBeenCalledTimes(1);
    await fetchMenu();
    expect(request).toHaveBeenCalledTimes(1);
    await fetchMenu();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never leaves an unhandled rejection when the prefetch fails before anyone asks', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    prefetchMenu();
    await expect(fetchMenu()).rejects.toThrow('offline');
  });
});
