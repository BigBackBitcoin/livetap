/**
 * One broadcast proof at a time, on one machine.
 *
 * The proof harness is not reentrant and cannot be made reentrant cheaply, because it owns three
 * things that are singletons on a host: TCP 1935 and 9997 for the receiver, a fixed set of stream
 * paths under `live/`, and an Electron user-data directory belonging to the built app. Two runs
 * overlapping do not produce two results, they produce two wrong ones — and the failures lie about
 * their cause, which is the expensive part:
 *
 *   an existing receiver was reused          the second run adopts the first run's server
 *   FAIL  fetch failed                       ...and then the first run stops it, mid-broadcast
 *   FAIL  electron.launch: ECONNRESET        two apps racing for one user-data directory
 *
 * None of those name the real problem, and all three read as a broken product. This is how the
 * harness stopped being able to slander the thing it exists to measure.
 *
 * Waiting rather than refusing is deliberate. The caller is almost always a person or an agent who
 * wants the answer, not a scheduler that can retry later, and a run that queues for four minutes
 * and then reports the truth is worth more than one that exits immediately with advice.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_PATH = path.join(os.tmpdir(), 'livetap-broadcast-proof.lock');

/** Env marker so a child spawned by a holder does not deadlock waiting for its own parent. */
export const HELD_ENV = 'LIVETAP_HARNESS_LOCK_HELD';

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 tests for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else, which still counts as alive.
    return error?.code === 'EPERM';
  }
}

function readHolder() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Take the lock, waiting for whoever has it.
 *
 * @param {{ label?: string, timeoutMs?: number, staleMs?: number, onWait?: (holder: object) => void }} options
 * @returns {Promise<() => void>} release, safe to call more than once
 */
export async function acquire(options = {}) {
  const { label = 'broadcast proof', timeoutMs = 20 * 60_000, staleMs = 30 * 60_000, onWait } = options;

  if (process.env[HELD_ENV] === '1') return () => undefined;

  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    try {
      const handle = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(handle, JSON.stringify({ pid: process.pid, label, startedAt: Date.now() }));
      fs.closeSync(handle);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;

      const holder = readHolder();
      const dead = !holder || !alive(holder.pid);
      const stale = holder?.startedAt ? Date.now() - holder.startedAt > staleMs : true;
      if (dead || stale) {
        // A run that was killed leaves its lock behind. Clearing it is the only way the next run
        // is not blocked by a process that no longer exists.
        try {
          fs.unlinkSync(LOCK_PATH);
        } catch {
          /* Someone else got there first; loop and try to take it. */
        }
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Another ${holder.label ?? 'harness'} run (pid ${holder.pid}) has held the broadcast ` +
            `receiver for ${Math.round((Date.now() - holder.startedAt) / 1000)} s. This run waited ` +
            `${Math.round(timeoutMs / 60_000)} minutes and gave up rather than produce a result that ` +
            `would be about both runs at once. Delete ${LOCK_PATH} if that process is gone.`,
        );
      }

      if (!announced && onWait) {
        announced = true;
        onWait(holder);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const holder = readHolder();
      if (holder?.pid === process.pid) fs.unlinkSync(LOCK_PATH);
    } catch {
      /* Nothing useful to do while exiting. */
    }
  };

  process.once('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      release();
      process.exit(1);
    });
  }

  return release;
}
