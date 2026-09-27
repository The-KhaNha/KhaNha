// Vitest globalSetup: one server test run at a time on this machine. All runs share the local Supabase database and
// the destructive suites reseed it, which deletes every non-demo account, including a parallel run's test users
// (their requests then fail with 401). A second run therefore waits for the first instead of corrupting it.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK = join(tmpdir(), 'food-pickup-server-tests.lock');
const WAIT_MS = 5 * 60_000;

/** The pid holding the lock, or undefined when there is no lock or its process is gone. */
function liveHolder(): number | undefined {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
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
      unlinkSync(LOCK);
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
