import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BondMonitor } from './BondMonitor.js';
import type { PathSample } from '../path/types.js';

/**
 * The adapter that decides whether Bond has consumers.
 *
 * Every function in this package is pure over state somebody else keeps, which is what makes the
 * decision layer testable but also means each consumer had to write the same bookkeeping first.
 * Desktop wrote it; web and Android did not, which is the whole reason Bond sat at one consumer.
 * These tests are about the bookkeeping, because that is the part that was missing.
 */

const WIFI = { transport: 'wifi' as const, label: 'Wi-Fi' };

function sample(over: Partial<PathSample> = {}): PathSample {
  return {
    at: 1_000,
    throughputBps: 6_000_000,
    rttMs: 30,
    jitterMs: 4,
    loss: 0,
    retransmitRate: 0,
    atCapacity: false,
    ...over,
  };
}

describe('BondMonitor', () => {
  /**
   * The failure this guards is a broadcast that reads `offline` while it is visibly working.
   *
   * The state machine will not put a path into service on measurements alone — it waits for a
   * reachability result, which is right for a path being discovered and wrong for the one the
   * stream is already flowing over. A monitor that did not know the difference would hold a
   * healthy path in DISCOVERING forever.
   */
  it('treats the first sample carrying traffic as proof the path reaches the relay', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);

    expect(m.paths()[0]!.state).toBe('HEALTHY');
    expect(m.decide(6_000_000, 1_000).health).not.toBe('offline');
  });

  it('does not call a path usable before anything has got through', () => {
    const m = new BondMonitor();
    // Offered traffic, nothing delivered: nothing has been proven, and saying otherwise would put
    // the scheduler on a path that has never carried a byte.
    m.observe('whip', sample({ throughputBps: 0 }), WIFI, 6_000_000);

    expect(m.paths()[0]!.state).toBe('DISCOVERING');
    expect(m.decide(6_000_000, 1_000).health).toBe('offline');
  });

  it('degrades a path that is losing packets, and says so in the health', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);
    m.observe('whip', sample({ at: 2_000, loss: 0.2, throughputBps: 1_000_000 }), WIFI, 6_000_000);

    expect(m.paths()[0]!.state).toBe('DEGRADED');
    expect(['degraded', 'insufficient']).toContain(m.decide(6_000_000, 2_000).health);
  });

  /**
   * The baseline is the path's own best round trip, not a constant. 60 ms is excellent for
   * cellular and poor for Ethernet, so a fixed threshold calls one path full and misses the other.
   */
  it('judges saturation against the path own baseline round trip', () => {
    const m = new BondMonitor();
    m.observe('cell', sample({ rttMs: 120 }), { transport: 'cellular' }, 3_000_000);
    // Still 120ms: that is this path at rest, not this path in trouble.
    m.observe('cell', sample({ at: 2_000, rttMs: 120, atCapacity: true }), { transport: 'cellular' }, 3_000_000);

    expect(m.paths()[0]!.state).toBe('HEALTHY');
  });

  it('counts a failure when a path leaves health, so the scorer stops returning to it', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);
    expect(m.paths()[0]!.failureCount).toBe(0);

    m.lost('whip', 5_000);

    expect(m.paths()[0]!.state).toBe('FAILED');
    expect(m.paths()[0]!.failureCount).toBe(1);
    expect(m.paths()[0]!.lastFailureAt).toBe(5_000);
    expect(m.decide(6_000_000, 5_000).health).toBe('offline');
  });

  /**
   * A path that has disappeared is a fact, not a measurement. Waiting for thresholds to agree is
   * how an engine keeps scheduling onto an interface the OS has already withdrawn.
   */
  it('treats a lost path as terminal rather than waiting for bad samples', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);
    m.lost('whip', 5_000);
    // A late sample arriving after the interface went down must not resurrect it.
    m.observe('whip', sample({ at: 6_000 }), WIFI, 6_000_000);

    expect(m.paths()[0]!.state).toBe('FAILED');
  });

  it('tracks two paths independently, which is the case a phone actually has', () => {
    const m = new BondMonitor();
    m.observe('wifi', sample(), WIFI, 3_000_000);
    m.observe('cell', sample({ loss: 0.3, throughputBps: 400_000 }), { transport: 'cellular', metered: 'metered' }, 3_000_000);

    const [wifi, cell] = m.paths();
    expect(wifi!.state).toBe('HEALTHY');
    expect(cell!.state).toBe('DEGRADED');
    expect(cell!.metered).toBe('metered');
  });

  /**
   * Hysteresis is the reason this class is stateful at all. `decide` takes the previous decision
   * and when it was made; a caller that forgot to thread that through gets an engine that looks
   * correct and flaps on every noisy sample.
   */
  it('threads the previous decision through, so a bond does not change its mind every sample', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);
    const first = m.decide(6_000_000, 1_000);

    m.observe('whip', sample({ at: 1_200, throughputBps: 5_800_000 }), WIFI, 6_000_000);
    const second = m.decide(6_000_000, 1_200);

    // Within the dwell window the mode is held rather than re-derived from one wobble.
    expect(second.mode).toBe(first.mode);
  });

  it('forgets everything on reset, including the hysteresis history', () => {
    const m = new BondMonitor();
    m.observe('whip', sample(), WIFI, 6_000_000);
    m.decide(6_000_000, 1_000);

    m.reset();

    expect(m.paths()).toHaveLength(0);
    expect(m.decide(6_000_000, 2_000).health).toBe('offline');
  });
});

/**
 * THE BROWSER ENTRY MUST NOT REACH A NODE BUILTIN.
 *
 * `index.ts` exports the network layer, which uses `node:dgram`. If `browser.ts` ever reaches it —
 * directly or through something it imports — the web bundle breaks at build time, or worse, ships
 * a shim. The comment at the top of `browser.ts` promises this is enforced by a test rather than
 * by the comment, so here it is: the whole module graph, walked.
 */
describe('the browser entry', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SRC = resolve(here, '..');

  function graph(entry: string, seen = new Set<string>()): string[] {
    if (seen.has(entry) || !existsSync(entry)) return [...seen];
    seen.add(entry);
    const source = readFileSync(entry, 'utf8');
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const spec = match[1]!;
      if (!spec.startsWith('.')) continue;
      graph(resolve(dirname(entry), spec.replace(/\.js$/, '.ts')), seen);
    }
    return [...seen];
  }

  it('reaches no node: builtin anywhere in its import graph', () => {
    const files = graph(resolve(SRC, 'browser.ts'));
    expect(files.length, 'the graph walk found nothing, so this test proves nothing').toBeGreaterThan(4);

    const offenders = files.filter((f) => /from\s+'node:/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('does not reach the network layer, which is where the sockets live', () => {
    const files = graph(resolve(SRC, 'browser.ts')).map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));
    expect(files.filter((f) => f.startsWith('net/'))).toEqual([]);
  });
});
