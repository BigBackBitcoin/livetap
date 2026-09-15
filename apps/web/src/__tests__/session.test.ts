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
function fakeStorage(initial: Record<string, string>, opts: { refuseDelete?: boolean } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
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
      platforms: ['youtube'],
      storage,
    });
    expect(report.clean).toBe(true);
    expect(report.storageRemaining).toEqual([]);
    expect(report.streamKeysForgotten).toBe(2);
    expect(report.platformsSignedOut).toEqual(['youtube']);
  });

  it('leaves keys belonging to other origins alone', async () => {
    const storage = fakeStorage({ 'livetap.intent': '"x"', 'theme.pref': 'dark' });
    await destroySession({ destinationIds: [], platforms: [], storage });
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('theme.pref');
  });

  it('sweeps a livetap key no one registered', async () => {
    // The failure this exists to catch: a future feature writes `livetap.somethingNew`
    // and forgets to add it to persist.KEYS.
    const storage = fakeStorage({ 'livetap.somethingNobodyRegistered': '1' });
    const report = await destroySession({ destinationIds: [], platforms: [], storage });
    expect(report.clean).toBe(true);
  });

  it('TELLS THE TRUTH when it could not clear everything', async () => {
    // A locked or quota-exhausted store. The wrong behaviour is reporting success.
    const storage = fakeStorage({ 'livetap.destinations': '[]' }, { refuseDelete: true });
    const report = await destroySession({ destinationIds: [], platforms: [], storage });
    expect(report.clean).toBe(false);
    expect(report.storageRemaining).toEqual(['livetap.destinations']);
  });

  it('does not throw when a secret refuses to be forgotten, and counts it as not done', async () => {
    const { forgetStreamKey } = await import('../state/secrets.js');
    vi.mocked(forgetStreamKey).mockRejectedValueOnce(new Error('vault locked'));
    const storage = fakeStorage({});
    const report = await destroySession({ destinationIds: ['d1', 'd2'], platforms: [], storage });
    expect(report.streamKeysForgotten).toBe(1);
    expect(report.clean).toBe(true);
  });
});
