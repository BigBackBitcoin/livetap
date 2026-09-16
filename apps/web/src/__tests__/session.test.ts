/**
 * The guest session's contract.
 *
 * Two things are worth testing here and they are not the same thing. The phase machine is a
 * correctness question: can a session go somewhere it should not. The destroy is a privacy
 * question: after it runs, is anything left — and does the report tell the truth when something
 * is. The second one is tested with a storage that refuses to delete, because a cleanup that
 * cannot verify itself is exactly the cleanup that ships a reassuring sentence over a leak.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  canTransition,
  destroySession,
  isOnAir,
  isTerminal,
  transition,
  type SessionPhase,
} from '../state/session.js';

vi.mock('../state/secrets.js', () => ({
  forgetStreamKey: vi.fn(async () => undefined),
}));
vi.mock('../state/tokens.js', () => ({
  forgetTokens: vi.fn(async () => undefined),
}));
vi.mock('../state/persist.js', () => ({ clearAll: vi.fn(() => undefined) }));

/** A localStorage stand-in whose contents the test controls. */
function fakeStorage(
  initial: Record<string, string>,
  opts: { refuseDelete?: boolean; refuseRead?: boolean } = {},
) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      // A partitioned origin or a browser with site data blocked throws here, not on removeItem.
      if (opts.refuseRead) throw new DOMException('denied', 'SecurityError');
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      if (!opts.refuseDelete) map.delete(k);
    },
  };
}

describe('session phases', () => {
  it('walks the intended path', () => {
    const path: SessionPhase[] = ['starting', 'active', 'live', 'ending', 'disconnected', 'destroyed'];
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransition(path[i - 1] as SessionPhase, path[i] as SessionPhase), `${path[i - 1]} -> ${path[i]}`).toBe(true);
    }
  });

  it('lets a broadcast end without ending the session', () => {
    // Stop, stay on the page, go live again. This is the common case, not an edge case.
    expect(canTransition('ending', 'active')).toBe(true);
    expect(canTransition('active', 'live')).toBe(true);
  });

  it('never hands a disconnected session back to someone still using the page', () => {
    expect(canTransition('disconnected', 'active')).toBe(false);
    expect(canTransition('disconnected', 'live')).toBe(false);
    expect(canTransition('disconnected', 'destroyed')).toBe(true);
  });

  it('cannot clean up while bytes may still be on the wire', () => {
    // live -> destroyed would run cleanup mid-broadcast.
    expect(canTransition('live', 'destroyed')).toBe(false);
    expect(canTransition('ending', 'destroyed')).toBe(false);
    expect(isOnAir('live')).toBe(true);
    expect(isOnAir('ending')).toBe(true);
    expect(isOnAir('active')).toBe(false);
  });

  it('is a dead end once destroyed', () => {
    expect(isTerminal('destroyed')).toBe(true);
    for (const to of ['starting', 'active', 'live', 'ending', 'disconnected'] as SessionPhase[]) {
      expect(canTransition('destroyed', to), `destroyed -> ${to}`).toBe(false);
    }
  });

  it('refuses an illegal transition by standing still rather than throwing', () => {
    // A thrown error here would take a creator's page down mid-broadcast.
    expect(transition('live', 'destroyed')).toBe('live');
    expect(transition('active', 'live')).toBe('live');
  });
});

describe('destroying a guest session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports clean only when storage actually came back empty', async () => {
    const storage = fakeStorage({
      'livetap.destinations': '[]',
      'livetap.intent': '"talking"',
      'unrelated.key': 'kept',
    });
    const report = await destroySession({
      destinationIds: ['d1', 'd2'],
      connections: [{ connectionId: 'd1', platform: 'youtube' }],
      storage,
    });
    expect(report.clean).toBe(true);
    expect(report.storageRemaining).toEqual([]);
    expect(report.streamKeysForgotten).toBe(2);
    expect(report.platformsSignedOut).toEqual(['youtube']);
  });

  it('leaves keys belonging to other origins alone', async () => {
    const storage = fakeStorage({ 'livetap.intent': '"x"', 'theme.pref': 'dark' });
    await destroySession({ destinationIds: [], connections: [], storage });
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('theme.pref');
  });

  it('sweeps a livetap key no one registered', async () => {
    // The failure this exists to catch: a future feature writes `livetap.somethingNew`
    // and forgets to add it to persist.KEYS.
    const storage = fakeStorage({ 'livetap.somethingNobodyRegistered': '1' });
    const report = await destroySession({ destinationIds: [], connections: [], storage });
    expect(report.clean).toBe(true);
  });

  it('TELLS THE TRUTH when it could not clear everything', async () => {
    // A locked or quota-exhausted store. The wrong behaviour is reporting success.
    const storage = fakeStorage({ 'livetap.destinations': '[]' }, { refuseDelete: true });
    const report = await destroySession({ destinationIds: [], connections: [], storage });
    expect(report.clean).toBe(false);
    expect(report.storageRemaining).toEqual(['livetap.destinations']);
  });

  it('NEVER reports clean when it could not read storage at all', async () => {
    /*
     * The defect this exists to prevent: enumeration throwing was caught and returned as an empty
     * array, so "could not look" was indistinguishable from "nothing there" and a locked store
     * reported `clean: true`. Absence of evidence returned as evidence of absence, in the one
     * function whose entire job is not to do that.
     */
    const storage = fakeStorage({ 'livetap.destinations': '[]' }, { refuseRead: true });
    const report = await destroySession({ destinationIds: [], connections: [], storage });
    expect(report.storageReadable).toBe(false);
    expect(report.clean).toBe(false);
    // Empty, but it means "unknown" — which is why `clean` must not be derived from it alone.
    expect(report.storageRemaining).toEqual([]);
  });

  it('reports readable and clean when there is genuinely no storage to write to', async () => {
    // Private mode with localStorage absent is not a failure to observe; there is nothing there.
    const report = await destroySession({ destinationIds: [], connections: [], storage: undefined });
    expect(report.storageReadable).toBe(true);
  });

  it('does not throw when a secret refuses to be forgotten, and counts it as not done', async () => {
    const { forgetStreamKey } = await import('../state/secrets.js');
    vi.mocked(forgetStreamKey).mockRejectedValueOnce(new Error('vault locked'));
    const storage = fakeStorage({});
    const report = await destroySession({ destinationIds: ['d1', 'd2'], connections: [], storage });
    expect(report.streamKeysForgotten).toBe(1);
    expect(report.clean).toBe(true);
  });
});

describe('phase derivation', () => {
  const base = { goLive: 'idle', endingAt: null, destinationCount: 0, ended: false };

  it('is starting before anything is set up, active once something is', async () => {
    const { derivePhase } = await import('../state/session.js');
    expect(derivePhase(base)).toBe('starting');
    expect(derivePhase({ ...base, destinationCount: 1 })).toBe('active');
  });

  it('treats the countdown and the start as active, not live', async () => {
    const { derivePhase } = await import('../state/session.js');
    // Nothing reaches a platform before the countdown ends; calling it live would be a lie.
    expect(derivePhase({ ...base, goLive: 'countdown', destinationCount: 1 })).toBe('active');
    expect(derivePhase({ ...base, goLive: 'starting', destinationCount: 1 })).toBe('active');
  });

  it('is live, then ending the moment the grace period starts', async () => {
    const { derivePhase } = await import('../state/session.js');
    expect(derivePhase({ ...base, goLive: 'live', destinationCount: 1 })).toBe('live');
    expect(derivePhase({ ...base, goLive: 'live', endingAt: 1234, destinationCount: 1 })).toBe('ending');
  });

  it('counts stopping as still on air, because the engine is still tearing down', async () => {
    const { derivePhase, isOnAir } = await import('../state/session.js');
    const phase = derivePhase({ ...base, goLive: 'stopping', destinationCount: 1 });
    expect(phase).toBe('ending');
    expect(isOnAir(phase)).toBe(true);
  });

  it('reports destroyed only from the one fact that is actually stored', async () => {
    const { derivePhase } = await import('../state/session.js');
    // Even mid-broadcast state cannot fake destroyed, and `ended` cannot be un-set by it.
    expect(derivePhase({ ...base, ended: true })).toBe('destroyed');
    expect(derivePhase({ goLive: 'live', endingAt: null, destinationCount: 3, ended: true })).toBe('destroyed');
  });
});
