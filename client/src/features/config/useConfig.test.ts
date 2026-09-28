import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchConfig = vi.hoisted(() => vi.fn());
vi.mock('../../services/config', () => ({ fetchConfig }));
vi.mock('../../services/api', () => ({ ApiError: class ApiError extends Error {} }));

const { useConfig } = await import('./useConfig');
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

  it('keeps the fallbacks when the API cannot be reached', async () => {
    fetchConfig.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(fetchConfig).toHaveBeenCalled());
    expect(result.current).toBe(CONFIG_FALLBACK);
  });
});
