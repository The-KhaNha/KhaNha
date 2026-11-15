import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchConfig = vi.hoisted(() => vi.fn());
vi.mock('../../services/config', () => ({ fetchConfig }));
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }));

const { useConfig, withFallback } = await import('./useConfig');
const { CONFIG_FALLBACK } = await import('./fallbacks');

describe('useConfig', () => {
  afterEach(() => {
    localStorage.clear();
    fetchConfig.mockReset();
  });

  it('returns the fallbacks until the config loads, then the server’s values', async () => {
    const server = {
      ...CONFIG_FALLBACK,
      serverVersion: '0.2.0',
      polling: { orderMs: 6000, ordersMs: 9000, staffBoardMs: 5000 },
    };
    fetchConfig.mockResolvedValue(server);
    const { result } = renderHook(() => useConfig());
    expect(result.current).toBe(CONFIG_FALLBACK);
    await waitFor(() => expect(result.current.polling.orderMs).toBe(6000));
  });

  it('fills a key an older API (or an older persisted copy) does not send from the fallbacks', async () => {
    const { clientErrors: _missing, ...older } = { ...CONFIG_FALLBACK, serverVersion: '0.1.0' };
    fetchConfig.mockResolvedValue(older);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.serverVersion).toBe('0.1.0'));
    expect(result.current.clientErrors).toEqual(CONFIG_FALLBACK.clientErrors);
  });

  it('keeps the fallbacks when the API cannot be reached', async () => {
    fetchConfig.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(fetchConfig).toHaveBeenCalled());
    expect(result.current).toBe(CONFIG_FALLBACK);
  });

  it('falls back per key for a null, missing or wrongly typed field, at any depth', async () => {
    const malformed = {
      ...CONFIG_FALLBACK,
      serverVersion: '0.3.0',
      clientErrors: null,
      polling: { orderMs: 6000, ordersMs: null, staffBoardMs: 'fast' },
      session: 7,
      features: { multi_store_ui: true },
    };
    fetchConfig.mockResolvedValue(malformed);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.serverVersion).toBe('0.3.0'));
    expect(result.current.clientErrors).toEqual(CONFIG_FALLBACK.clientErrors);
    expect(result.current.polling).toEqual({ ...CONFIG_FALLBACK.polling, orderMs: 6000 });
    expect(result.current.session).toEqual(CONFIG_FALLBACK.session);
    expect(result.current.features).toEqual({ modifiers: false, multi_store_ui: true });
  });
});

describe('withFallback', () => {
  it('keeps a nullable fallback’s value and replaces a non-object body whole', () => {
    expect(withFallback(CONFIG_FALLBACK, null)).toBe(CONFIG_FALLBACK);
    expect(withFallback(CONFIG_FALLBACK, 'oops')).toBe(CONFIG_FALLBACK);
    expect(withFallback({ payment: null }, { payment: { provider: 'x' } })).toEqual({
      payment: { provider: 'x' },
    });
  });
});

describe('withFallback edge cases', () => {
  it('returns the fallback for non-object values where an object is expected', () => {
    const fb = { a: 1 };
    expect(withFallback(fb, [])).toBe(fb);
    expect(withFallback(fb, 'x')).toBe(fb);
    expect(withFallback(fb, 5)).toBe(fb);
  });

  it('takes an array field as given when the fallback is an array', () => {
    expect(withFallback({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });

  it('replaces an object where the fallback has an array', () => {
    expect(withFallback({ list: [1, 2] }, { list: { a: 1 } })).toEqual({ list: [1, 2] });
  });

  it('replaces an array where the fallback has an object', () => {
    expect(withFallback({ o: { a: 1 } }, { o: [1] })).toEqual({ o: { a: 1 } });
  });

  it('repairs nested nulls at every depth', () => {
    const fb = { a: { b: { c: 7, d: 'x' } } };
    expect(withFallback(fb, { a: { b: null } })).toEqual(fb);
    expect(withFallback(fb, { a: { b: { c: null, d: 'y' } } })).toEqual({
      a: { b: { c: 7, d: 'y' } },
    });
  });

  it('passes extra keys through, including nested ones', () => {
    expect(withFallback({ a: { b: 1 } }, { a: { b: 2, z: 3 }, extra: true })).toEqual({
      a: { b: 2, z: 3 },
      extra: true,
    });
  });

  it('keeps a legitimate falsy value of the right type', () => {
    expect(withFallback({ n: 5, s: 'x', f: true }, { n: 0, s: '', f: false })).toEqual({
      n: 0,
      s: '',
      f: false,
    });
  });

  it('does not mutate the fallback or the value', () => {
    const fb = { a: { b: 1 } };
    const value = { a: null };
    withFallback(fb, value);
    expect(fb).toEqual({ a: { b: 1 } });
    expect(value).toEqual({ a: null });
  });
});
