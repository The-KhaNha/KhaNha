import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger';
import { onShutdown, SHUTDOWN_DEADLINE_MS } from '../../src/utils/shutdown';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;
let before: Record<string, unknown[]>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  before = Object.fromEntries(SIGNALS.map((s) => [s, process.listeners(s)]));
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  vi.spyOn(logger, 'info').mockImplementation(() => undefined);
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  vi.spyOn(logger, 'flush').mockImplementation((cb?: (err?: Error) => void) => cb?.());
});

afterEach(() => {
  for (const s of SIGNALS) {
    for (const l of process.listeners(s))
      if (!before[s]?.includes(l)) process.removeListener(s, l as never);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = () => new Promise((r) => setImmediate(r));

describe('onShutdown', () => {
  it('stops once, and keeps catching repeats so a relayed second signal cannot kill it mid-stop', async () => {
    let finish = () => {};
    const stop = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    onShutdown(stop);

    process.emit('SIGTERM', 'SIGTERM');
    // A terminal's Ctrl+C and tsx's relay: still ours, not Node's default (which exits at once).
    for (const s of SIGNALS) expect(process.listenerCount(s)).toBe((before[s]?.length ?? 0) + 1);
    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGINT', 'SIGINT');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    finish();
    await settle();
    expect(logger.flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when stopping outlasts the deadline', () => {
    vi.useFakeTimers();
    onShutdown(() => new Promise<void>(() => {}));
    process.emit('SIGINT', 'SIGINT');
    vi.advanceTimersByTime(SHUTDOWN_DEADLINE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('logs a failed stop at error and exits 1', async () => {
    onShutdown(() => Promise.reject(new Error('stuck')));
    process.emit('SIGTERM', 'SIGTERM');
    await settle();
    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Shutdown failed');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
