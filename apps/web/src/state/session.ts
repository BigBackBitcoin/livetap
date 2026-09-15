/**
 * The guest session, as a lifecycle with an end.
 *
 * LIVETAP has no accounts. A visitor arrives, connects somewhere, goes live, stops, and leaves —
 * and the product requirement is that leaving actually means something: the next person to open
 * this browser starts clean. Until this file existed there was no such thing as "the session".
 * There were five `livetap.*` keys that appeared during onboarding and stayed until someone found
 * "Run setup again" in Settings, which is framed as redoing onboarding rather than as forgetting
 * a person. On a shared or public machine that is the difference between a preference and a
 * privacy defect: the next visitor saw the previous visitor's destination list.
 *
 * The phases are the ones the product already has words for, so the model does not invent a
 * vocabulary nobody uses:
 *
 *     SESSION_START → ACTIVE → LIVE → ENDING → DISCONNECTED → DESTROYED
 *
 * `ENDING` is a real phase and not a formality — END starts a grace period during which the
 * broadcast is still up and can be undone, and a lifecycle that jumped straight to
 * `DISCONNECTED` would let cleanup run while bytes were still on the wire.
 *
 * THE ONE DESIGN DECISION WORTH DEFENDING: `destroySession` returns what it actually cleared and
 * what it found still present afterwards, measured by re-reading storage rather than assumed from
 * having called the clear functions. "Your session was forgotten" is a claim about someone's
 * privacy, and this codebase does not make those without checking. If a key survives — a quota
 * error, a locked store, a key some future feature writes and forgets to register — the report
 * says so and the caller can tell the truth instead of a reassuring sentence.
 */
import type { PlatformId } from '@livetap/core';
import * as persist from './persist.js';
import { forgetStreamKey } from './secrets.js';
import { forgetTokens } from './tokens.js';

export type SessionPhase =
  | 'starting'
  | 'active'
  | 'live'
  | 'ending'
  | 'disconnected'
  | 'destroyed';

/**
 * Which phase may follow which.
 *
 * `live → active` exists because a broadcast can end without the session ending: the creator
 * stops, stays on the page, and goes live again. `disconnected → active` does not exist — once a
 * session is disconnected the only way forward is destruction, so a half-torn-down session can
 * never be handed back to someone still using the page.
 */
const NEXT: Readonly<Record<SessionPhase, readonly SessionPhase[]>> = {
  starting: ['active', 'destroyed'],
  active: ['live', 'disconnected', 'destroyed'],
  live: ['ending', 'disconnected'],
  ending: ['live', 'active', 'disconnected'],
  disconnected: ['destroyed'],
  destroyed: [],
};

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  return NEXT[from].includes(to);
}

/**
 * Move the session on, or refuse.
 *
 * Refusing returns the current phase rather than throwing. A rejected transition is a programming
 * error in a caller, not a reason to take a creator's page down mid-broadcast, and the one phase
 * where a thrown error would do real harm is exactly the one an unexpected transition is most
 * likely to arrive in.
 */
export function transition(from: SessionPhase, to: SessionPhase): SessionPhase {
  return canTransition(from, to) ? to : from;
}

/** True once nothing further can happen to this session. */
export function isTerminal(phase: SessionPhase): boolean {
  return phase === 'destroyed';
}

/** True while bytes may still be reaching a destination. */
export function isOnAir(phase: SessionPhase): boolean {
  return phase === 'live' || phase === 'ending';
}

export interface DestroyInput {
  /** Destination ids whose stream keys are held in memory (or a desktop vault) for this session. */
  readonly destinationIds: readonly string[];
  /** Platforms this session signed in to. Their tokens are dropped locally. */
  readonly platforms: readonly PlatformId[];
  /** Injected in tests. Defaults to the real `localStorage` through `persist`. */
  readonly storage?: Pick<Storage, 'key' | 'removeItem' | 'length'>;
}

export interface DestroyReport {
  /** Stream keys dropped, counted rather than named — a name is half a secret. */
  readonly streamKeysForgotten: number;
  readonly platformsSignedOut: readonly PlatformId[];
  /**
   * `livetap.*` keys still readable AFTER the clear, measured not assumed.
   * Empty is the only acceptable answer; anything else must be surfaced, not swallowed.
   */
  readonly storageRemaining: readonly string[];
  /** True only when storage came back empty. The UI must not promise more than this. */
  readonly clean: boolean;
}

function livetapKeysIn(storage: Pick<Storage, 'key' | 'length'> | null): string[] {
  if (!storage) return [];
  const found: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith('livetap.')) found.push(key);
    }
  } catch {
    /* A locked store reads as empty; the caller still gets `clean: false` only if it should. */
  }
  return found;
}

function hostStorage(): Pick<Storage, 'key' | 'removeItem' | 'length'> | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * End the guest session and forget the person.
 *
 * Order matters and is not arbitrary. Secrets go first, because they are the only things here
 * whose survival actually hurts someone, and a failure part-way through should leave the least
 * damaging remainder. Persisted preferences go last, because they are the cheapest to lose and
 * the easiest to see. The sweep at the end catches anything registered by neither.
 *
 * This never throws. A cleanup that aborts half-done is worse than one that reports what it could
 * not do, because the caller can act on a report and cannot act on an exception it did not expect.
 */
export async function destroySession(input: DestroyInput): Promise<DestroyReport> {
  let streamKeysForgotten = 0;
  for (const id of input.destinationIds) {
    try {
      await forgetStreamKey(id);
      streamKeysForgotten += 1;
    } catch {
      /* A desktop vault that refuses still leaves nothing in the browser. Counted as not done. */
    }
  }

  const platformsSignedOut: PlatformId[] = [];
  for (const platform of input.platforms) {
    try {
      await forgetTokens(platform);
      platformsSignedOut.push(platform);
    } catch {
      /* Reported by omission rather than by exception. */
    }
  }

  try {
    persist.clearAll();
  } catch {
    /* Measured below regardless of what this did. */
  }

  /*
   * The sweep. `persist.clearAll()` removes the keys it knows about, and the set it knows about is
   * a list a future feature can forget to join. Anything still wearing the `livetap.` prefix is
   * removed here whether or not this module has ever heard of it.
   */
  const storage = input.storage ?? hostStorage();
  for (const key of livetapKeysIn(storage)) {
    try {
      storage?.removeItem(key);
    } catch {
      /* Falls through to the measurement below. */
    }
  }

  const storageRemaining = livetapKeysIn(storage);
  return {
    streamKeysForgotten,
    platformsSignedOut,
    storageRemaining,
    clean: storageRemaining.length === 0,
  };
}
