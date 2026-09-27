// Exercises the lock-liveness logic in test/setup/run-lock.ts without touching the real lock file (which the
// running suite itself holds): 'node:fs' and process.kill are mocked, so no file on disk is read or written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import acquireRunLock from '../setup/run-lock';

const fs = vi.hoisted(() => ({
  openSync: vi.fn(),
  readFileSync: vi.fn(),
  closeSync: vi.fn(),
  writeSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock('node:fs', () => fs);

function eexist(): never {
  throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
}
function enoent(): never {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}
function killError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

describe('acquireRunLock', () => {
  let kill: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fs.openSync.mockReset();
    fs.readFileSync.mockReset();
    fs.closeSync.mockReset();
    fs.writeSync.mockReset();
    fs.unlinkSync.mockReset();
    kill = vi.spyOn(process, 'kill');
  });

  afterEach(() => {
    kill.mockRestore();
    vi.useRealTimers();
  });

  it('acquires immediately when no lock file exists', async () => {
    fs.openSync.mockImplementationOnce(() => 1);
    const release = await acquireRunLock();
    expect(fs.writeSync).toHaveBeenCalledWith(1, String(process.pid));
    expect(typeof release).toBe('function');
  });

  it('ESRCH: a dead holder is reaped and the lock is reclaimed', async () => {
    fs.openSync.mockImplementationOnce(eexist).mockImplementationOnce(() => 2);
    fs.readFileSync.mockReturnValueOnce('1234');
    kill.mockImplementationOnce(() => killError('ESRCH'));

    await acquireRunLock();

    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fs.openSync).toHaveBeenCalledTimes(2);
  });

  it('ENOENT on unlink (another waiter already reaped it) is tolerated, not thrown', async () => {
    fs.openSync.mockImplementationOnce(eexist).mockImplementationOnce(() => 3);
    fs.readFileSync.mockReturnValueOnce('1234');
    kill.mockImplementationOnce(() => killError('ESRCH'));
    fs.unlinkSync.mockImplementationOnce(enoent);

    await expect(acquireRunLock()).resolves.toBeInstanceOf(Function);
    expect(fs.openSync).toHaveBeenCalledTimes(2);
  });

  it('EPERM: a live holder blocks, and the wait eventually times out naming its pid', async () => {
    vi.useFakeTimers();
    fs.openSync.mockImplementation(eexist);
    fs.readFileSync.mockReturnValue('5678');
    kill.mockImplementation(() => killError('EPERM'));

    const pending = acquireRunLock();
    const assertion = expect(pending).rejects.toThrow(/pid 5678.*5 minutes/s);
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    await assertion;
  });

  it('an empty pid in the lock file is treated as held, not dead: it is never reaped', async () => {
    vi.useFakeTimers();
    fs.openSync.mockImplementation(eexist);
    fs.readFileSync.mockReturnValue('');

    const pending = acquireRunLock();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fs.unlinkSync).not.toHaveBeenCalled();

    const assertion = expect(pending).rejects.toThrow(/5 minutes/);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await assertion;
  });

  it('release removes the lock only when it still holds our own pid', async () => {
    fs.openSync.mockImplementationOnce(() => 1);
    const release = await acquireRunLock();

    fs.readFileSync.mockReturnValueOnce(String(process.pid));
    release();
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);

    fs.unlinkSync.mockClear();
    fs.readFileSync.mockReturnValueOnce('999999');
    release();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});
