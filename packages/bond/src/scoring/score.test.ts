import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, rankPaths, scorePath, type ScoreContext } from './score.js';
import type { NetworkPath, PathSample } from '../path/types.js';

function path(overrides: Partial<NetworkPath> = {}): NetworkPath {
  const sample: PathSample = {
    at: 1000,
    throughputBps: 12_000_000,
    rttMs: 20,
    jitterMs: 3,
    loss: 0,
    retransmitRate: 0,
    atCapacity: false,
    ...(overrides.sample ?? {}),
  };
  return {
    handle: 'wifi-1',
    transport: 'wifi',
    label: 'Wi-Fi',
    state: 'HEALTHY',
    metered: 'unmetered',
    independence: 'observed',
    failureCount: 0,
    estimatedCapacityBps: 12_000_000,
    ...overrides,
    sample,
  };
}

const context: ScoreContext = { streamBitrateBps: 6_000_000, allowMetered: false, charging: true };

describe('scorePath', () => {
  it('gives a clean, fast, free path close to full marks', () => {
    const result = scorePath(path(), context);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.reason).toBe('healthy');
  });

  it('scores a path against what the stream needs, not in the abstract', () => {
    // The same 5 Mbps path: plenty for a 3 Mbps stream, only half of a 10 Mbps one. A scorer that
    // returned the same number for both has discarded the context that makes it actionable.
    const fiveMbit = path({ estimatedCapacityBps: 5_000_000 });

    const forSmall = scorePath(fiveMbit, { ...context, streamBitrateBps: 3_000_000 });
    const forLarge = scorePath(fiveMbit, { ...context, streamBitrateBps: 10_000_000 });

    expect(forSmall.terms.throughput).toBe(1);
    expect(forLarge.terms.throughput).toBeCloseTo(0.5, 5);
    expect(forSmall.score).toBeGreaterThan(forLarge.score);
  });

  it('does not reward a path for being able to carry the stream twice over', () => {
    // Otherwise every allocation biases toward one fat path, even when spreading the load is the
    // thing protecting the broadcast.
    const enough = scorePath(path({ estimatedCapacityBps: 6_000_000 }), context);
    const enormous = scorePath(path({ estimatedCapacityBps: 60_000_000 }), context);
    expect(enough.terms.throughput).toBe(1);
    expect(enormous.terms.throughput).toBe(1);
  });

  it('scores an unusable path exactly zero, never merely low', () => {
    // The allocator multiplies by score. A sliver of a live broadcast sent down a dead path is
    // worse than nothing, because those packets then have to be recovered from somewhere else.
    for (const state of ['FAILED', 'TESTING', 'UNSTABLE', 'RECOVERING'] as const) {
      const result = scorePath(path({ state }), context);
      expect(result.score).toBe(0);
      expect(result.reason).toContain(state);
    }
  });

  it('refuses to score a path it has never measured', () => {
    // Scoring an unmeasured path against an imagined sample is how a bond invents a capability.
    const unmeasured = { ...path(), sample: undefined } as NetworkPath;
    const result = scorePath(unmeasured, context);
    expect(result.score).toBe(0);
    expect(result.reason).toBe('no measurement yet');
  });

  it('punishes loss harder than slowness', () => {
    // A lossy path produces artefacts a viewer sees. A slow clean path produces a stream that
    // arrives slightly later and that nobody notices.
    const lossy = scorePath(path({ sample: { loss: 0.05 } as PathSample }), context);
    const slow = scorePath(path({ sample: { rttMs: 200 } as PathSample }), context);
    expect(lossy.score).toBeLessThan(slow.score);
    expect(lossy.reason).toBe('losing packets');
  });

  it('remembers that a path has failed before', () => {
    const fresh = scorePath(path(), context);
    const burned = scorePath(path({ failureCount: 3 }), context);
    expect(burned.score).toBeLessThan(fresh.score);
    expect(burned.terms.stability).toBeLessThan(fresh.terms.stability);
  });

  it('holds a metered path back until the creator has allowed it', () => {
    const cellular = path({ handle: 'cell-1', transport: 'cellular', metered: 'metered' });
    const forbidden = scorePath(cellular, { ...context, allowMetered: false });
    const permitted = scorePath(cellular, { ...context, allowMetered: true });
    expect(permitted.score).toBeGreaterThan(forbidden.score);
    expect(forbidden.terms.cost).toBeLessThan(0.1);
  });

  it('stops caring about battery while the device is charging', () => {
    const cellular = path({ transport: 'cellular' });
    const onBattery = scorePath(cellular, { ...context, charging: false, batteryLevel: 0.2 });
    const plugged = scorePath(cellular, { ...context, charging: true, batteryLevel: 0.2 });
    expect(plugged.terms.battery).toBe(1);
    expect(onBattery.terms.battery).toBeLessThan(1);
  });

  it('treats a cheap wired path as costing nothing in battery', () => {
    const wired = path({ transport: 'ethernet' });
    const result = scorePath(wired, { ...context, charging: false, batteryLevel: 0.5 });
    expect(result.terms.battery).toBe(1);
  });

  it('names the term that is dragging a path down', () => {
    expect(scorePath(path({ sample: { jitterMs: 300 } as PathSample }), context).reason).toBe(
      'uneven delivery',
    );
    expect(
      scorePath(path({ estimatedCapacityBps: 300_000 }), context).reason,
    ).toBe('not enough capacity');
  });

  it('normalises whatever weights it is given', () => {
    // The mission says tune these. Doubling every weight must not change the ranking or the range.
    const doubled = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, v * 2]),
    ) as unknown as typeof DEFAULT_WEIGHTS;
    expect(scorePath(path(), context, doubled).score).toBeCloseTo(
      scorePath(path(), context).score,
      10,
    );
  });
});

describe('rankPaths', () => {
  it('puts the best path first and is deterministic on ties', () => {
    const wifi = path({ handle: 'wifi-1' });
    const twin = path({ handle: 'wifi-2' });
    const poor = path({ handle: 'cell-1', transport: 'cellular', metered: 'metered', sample: { loss: 0.08 } as PathSample });

    const ranked = rankPaths([poor, wifi, twin], context);
    expect(ranked.map((r) => r.handle)).toEqual(['wifi-1', 'wifi-2', 'cell-1']);

    // Same inputs, same order, every time: an allocator that reshuffles equal paths thrashes.
    expect(rankPaths([poor, wifi, twin], context).map((r) => r.handle)).toEqual([
      'wifi-1',
      'wifi-2',
      'cell-1',
    ]);
  });
});
