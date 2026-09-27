// Vitest globalSetup: one server test run at a time on this machine. All runs share the local Supabase database and
// the destructive suites reseed it, which deletes every non-demo account, including a parallel run's test users
// (their requests then fail with 401). A second run therefore waits for the first instead of corrupting it.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(tmpdir(), 'food-pickup-server-tests.lock');
const WAIT_MS = 5 * 60_000;

/** A sentinel pid: the lock file exists but its pid is not (yet) readable, so treat it as held, not dead. */
const UNKNOWN_HOLDER = -1;

/** The pid holding the lock, or undefined when there is no lock or its process is gone. */
function liveHolder(): number | undefined {
  let raw: string;
  try {
    raw = readFileSync(LOCK, 'utf8');
  } catch {
    return undefined;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    // acquireRunLock opens the file ('wx') before writing the pid into it, so a waiter can read it in that gap
    // as empty or partial. That is a live, just-created lock, not a dead one: never reap it here, only on the
    // deadline below, once the lock file's pid becomes readable or the wait times out.
    return UNKNOWN_HOLDER;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch (err) {
    // ESRCH: no such process, it is dead. Any other error (e.g. EPERM: exists, but owned by another user on this
    // shared tmpdir) means the process is still alive, so the lock stays.
    return (err as NodeJS.ErrnoException).code === 'ESRCH' ? undefined : pid;
  }
}

export default async function acquireRunLock(): Promise<() => void> {
  const deadline = Date.now() + WAIT_MS;
  let announced = false;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const holder = liveHolder();
    if (holder === undefined) {
      // ponytail: a crashed run left its lock behind. Two waiters could both clear it in the same instant; that
      // needs a crash plus two simultaneous new runs, so it is not worth a stronger lock.
      try {
        unlinkSync(LOCK);
      } catch (err) {
        // ENOENT: another waiter already cleared it. Anything else is a real failure.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Another server test run (pid ${holder}) has held ${LOCK} for 5 minutes.`);
    }
    if (!announced) {
      process.stderr.write(`Waiting for another server test run (pid ${holder}) to finish…\n`);
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return () => {
    try {
      if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK);
    } catch {
      // Already gone: nothing to release.
    }
  };
}
