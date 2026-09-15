import { describe, expect, it } from 'vitest';
import { decide, DEFAULT_TUNING, type BondDecision, type DecideInput } from './decide.js';
import { DEFAULT_BOND_POLICY, type BondPolicy, type NetworkPath, type PathState } from '../path/types.js';

const MBPS = 1_000_000;
const STREAM = 6 * MBPS;

function makePath(
  handle: string,
  capacityBps: number,
  overrides: Partial<NetworkPath> = {},
): NetworkPath {
  return {
    handle,
    transport: handle.startsWith('cell') ? 'cellular' : handle.startsWith('eth') ? 'ethernet' : 'wifi',
    label: handle.startsWith('cell') ? 'Mobile data' : handle.startsWith('eth') ? 'Ethernet' : 'Wi-Fi',
    state: 'HEALTHY' as PathState,
    metered: handle.startsWith('cell') ? 'metered' : 'unmetered',
    independence: 'observed',
    failureCount: 0,
    estimatedCapacityBps: capacityBps,
    sample: {
      at: 0,
      throughputBps: capacityBps,
      rttMs: 25,
      jitterMs: 4,
      loss: 0,
      retransmitRate: 0,
      atCapacity: false,
    },
    ...overrides,
  };
}

function input(paths: NetworkPath[], overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    paths,
    policy: DEFAULT_BOND_POLICY,
    streamBitrateBps: STREAM,
    now: 100_000,
    charging: true,
    ...overrides,
  };
}

/** Sum of shares across the paths actually carrying traffic. */
function carriedShare(decision: BondDecision): number {
  return decision.active.filter((a) => !a.standby).reduce((sum, a) => sum + a.share, 0);
}

describe('graceful fallback', () => {
  it('runs a single path normally, with no error and no fuss', () => {
    // Section 58: one path is not a degraded bond, it is a normal broadcast.
    const decision = decide(input([makePath('wifi-1', 20 * MBPS)]));
    expect(decision.mode).toBe('single');
    expect(decision.health).toBe('excellent');
    expect(decision.active).toHaveLength(1);
    expect(decision.active[0]!.share).toBe(1);
    expect(decision.reason).toBe('Wi-Fi is carrying your stream comfortably.');
  });

  it('says so plainly when there is nothing at all', () => {
    const decision = decide(input([]));
    expect(decision.health).toBe('offline');
    expect(decision.active).toEqual([]);
    expect(decision.reason).toBe('No network is reachable.');
  });

  it('will not schedule traffic onto a path that is not in service', () => {
    for (const state of ['TESTING', 'FAILED', 'RECOVERING', 'UNSTABLE'] as PathState[]) {
      const decision = decide(input([makePath('wifi-1', 20 * MBPS, { state })]));
      expect(decision.active).toEqual([]);
      expect(decision.health).toBe('offline');
    }
  });
});

describe('never hides a failure', () => {
  it('reports insufficient rather than excellent when the stream does not fit', () => {
    // Section 49. This is the single most important behaviour in the file: a bond that says
    // EXCELLENT while dropping frames has removed the only signal the creator could act on.
    const decision = decide(input([makePath('wifi-1', 2 * MBPS)]));
    expect(decision.health).toBe('insufficient');
    expect(decision.reason).toContain('cannot carry this quality');
  });

  it('asks the encoder to come down when capacity is short', () => {
    const decision = decide(input([makePath('wifi-1', 4 * MBPS)]));
    // 4 Mbps of link, 25% headroom -> 3 Mbps usable, so the ceiling must be under the 6 Mbps ask.
    expect(decision.encoderCeilingBps).toBeLessThan(STREAM);
    expect(decision.encoderCeilingBps).toBeGreaterThan(0);
  });

  it('calls a stream with no margin degraded, not excellent', () => {
    // 8 Mbps link, 25% headroom -> 6 Mbps usable for a 6 Mbps stream. It fits exactly, which is
    // not the same as being fine.
    const decision = decide(input([makePath('wifi-1', 8 * MBPS)]));
    expect(decision.health).toBe('degraded');
  });

  it('reports degraded when the carrying path is unwell, however much capacity it has', () => {
    const sick = makePath('wifi-1', 50 * MBPS, {
      state: 'DEGRADED',
      sample: { at: 0, throughputBps: 50 * MBPS, rttMs: 300, jitterMs: 10, loss: 0.03, retransmitRate: 0, atCapacity: false },
    });
    expect(decide(input([sick])).health).toBe('degraded');
  });
});

describe('cost protection', () => {
  const wifi = () => makePath('wifi-1', 20 * MBPS);
  const cell = () => makePath('cell-1', 20 * MBPS);

  it('keeps mobile data on standby rather than carrying, by default', () => {
    // Sections 26 and 52: the default must not spend the creator's data plan. Standby is the
    // difference between "do not spend my data" and "do not protect my stream".
    const decision = decide(input([wifi(), cell()]));
    const cellular = decision.active.find((a) => a.handle === 'cell-1');
    expect(cellular?.standby).toBe(true);
    expect(cellular?.share).toBe(0);
    expect(carriedShare(decision)).toBe(1);
  });

  it('lets mobile data carry a real share once the creator allows it', () => {
    const policy: BondPolicy = { ...DEFAULT_BOND_POLICY, allowAggregationOnMetered: true };
    // Force aggregation by making no single path enough on its own.
    const decision = decide(
      input([makePath('wifi-1', 5 * MBPS), makePath('cell-1', 5 * MBPS)], { policy }),
    );
    expect(decision.mode).toBe('aggregated');
    const cellular = decision.active.find((a) => a.handle === 'cell-1');
    expect(cellular?.standby).toBe(false);
    expect(cellular!.share).toBeGreaterThan(0.1);
  });

  it('uses mobile data anyway when it is the only thing left', () => {
    // A broadcast that ends is worse than a broadcast that cost a few megabytes, and the creator
    // did say cellular could protect the stream.
    const decision = decide(input([cell()]));
    expect(decision.active).toHaveLength(1);
    expect(decision.active[0]!.standby).toBe(false);
    expect(decision.health).not.toBe('offline');
  });

  it('refuses plainly when the only network is one the creator switched off', () => {
    const policy: BondPolicy = {
      ...DEFAULT_BOND_POLICY,
      useCellularForProtection: false,
      allowAggregationOnMetered: false,
    };
    const decision = decide(input([cell()], { policy }));
    expect(decision.health).toBe('insufficient');
    expect(decision.reason).toContain('switched off');
    expect(decision.active).toEqual([]);
  });
});

describe('mode selection', () => {
  it('honours an explicit single even when more paths exist', () => {
    const policy: BondPolicy = { ...DEFAULT_BOND_POLICY, mode: 'single' };
    const decision = decide(input([makePath('wifi-1', 20 * MBPS), makePath('eth-1', 20 * MBPS)], { policy }));
    expect(decision.mode).toBe('single');
    expect(decision.active).toHaveLength(1);
  });

  it('does not aggregate when one path already has comfortable margin', () => {
    // Spending battery and data to buy nothing is the most common way a bonding product makes a
    // device worse without making a stream better.
    const decision = decide(input([makePath('wifi-1', 40 * MBPS), makePath('eth-1', 40 * MBPS)]));
    expect(decision.mode).toBe('protected');
    expect(carriedShare(decision)).toBe(1);
    expect(decision.active.filter((a) => a.standby)).toHaveLength(1);
  });

  it('aggregates when no single path can carry the stream', () => {
    const decision = decide(input([makePath('wifi-1', 5 * MBPS), makePath('eth-1', 5 * MBPS)]));
    expect(decision.mode).toBe('aggregated');
    expect(decision.active.every((a) => !a.standby)).toBe(true);
    expect(carriedShare(decision)).toBeCloseTo(1, 5);
  });

  it('asking for aggregated on a one-path device gets one path, honestly labelled', () => {
    const policy: BondPolicy = { ...DEFAULT_BOND_POLICY, mode: 'aggregated' };
    const decision = decide(input([makePath('wifi-1', 20 * MBPS)], { policy }));
    expect(decision.mode).toBe('single');
  });
});

describe('allocation', () => {
  it('gives the bigger path the bigger share', () => {
    const decision = decide(input([makePath('wifi-1', 8 * MBPS), makePath('eth-1', 2 * MBPS)]));
    const wifi = decision.active.find((a) => a.handle === 'wifi-1')!;
    const eth = decision.active.find((a) => a.handle === 'eth-1')!;
    expect(wifi.share).toBeGreaterThan(eth.share);
    expect(wifi.share + eth.share).toBeCloseTo(1, 5);
  });

  it('never gives a path more than it can actually carry', () => {
    // A share that exceeds a path's capacity is a queue by another name, and the whole stream
    // ends up waiting for the smallest link.
    const small = makePath('eth-1', 1 * MBPS);
    const large = makePath('wifi-1', 7 * MBPS);
    const decision = decide(input([large, small]));
    const smallShare = decision.active.find((a) => a.handle === 'eth-1')!.share;
    const smallUsable = 1 * MBPS * (1 - DEFAULT_TUNING.headroomFraction);
    expect(smallShare * STREAM).toBeLessThanOrEqual(smallUsable + 1);
  });

  it('prefers the healthier of two equally large paths', () => {
    const clean = makePath('wifi-1', 5 * MBPS);
    const lossy = makePath('eth-1', 5 * MBPS, {
      sample: { at: 0, throughputBps: 5 * MBPS, rttMs: 25, jitterMs: 4, loss: 0.06, retransmitRate: 0, atCapacity: false },
    });
    const decision = decide(input([clean, lossy]));
    const cleanShare = decision.active.find((a) => a.handle === 'wifi-1')!.share;
    const lossyShare = decision.active.find((a) => a.handle === 'eth-1')!.share;
    expect(cleanShare).toBeGreaterThan(lossyShare);
  });
});

describe('headroom', () => {
  it('leaves capacity unscheduled rather than filling the pipe', () => {
    // Section 17. Scheduling 100% of measured capacity guarantees a queue, and a queue is latency
    // and then loss.
    const decision = decide(input([makePath('wifi-1', 20 * MBPS)]));
    expect(decision.usableCapacityBps).toBeLessThan(20 * MBPS);
    expect(decision.usableCapacityBps).toBeCloseTo(20 * MBPS * 0.75, -3);
    expect(decision.targetHeadroomBps).toBeGreaterThan(0);
  });
});

describe('hysteresis', () => {
  const two = [makePath('wifi-1', 5 * MBPS), makePath('eth-1', 5 * MBPS)];

  it('does not shrink the bond the instant conditions improve', () => {
    // Section 13. The usual reason a path looks good again is that we stopped using it a moment
    // ago, so getting leaner waits out the dwell time.
    const first = decide(input(two, { now: 0 }));
    expect(first.mode).toBe('aggregated');

    const improved = [makePath('wifi-1', 40 * MBPS), makePath('eth-1', 5 * MBPS)];
    const tooSoon = decide(
      input(improved, { now: 1000, previous: first, previousAt: 0 }),
    );
    expect(tooSoon.mode).toBe('aggregated');

    const later = decide(
      input(improved, { now: DEFAULT_TUNING.dwellMs + 1, previous: first, previousAt: 0 }),
    );
    expect(later.mode).toBe('protected');
  });

  it('reacts immediately when the stream needs more help', () => {
    // The asymmetry that makes this feel stable rather than nervous: safer is instant, leaner waits.
    const healthy = decide(input([makePath('wifi-1', 40 * MBPS), makePath('eth-1', 40 * MBPS)], { now: 0 }));
    expect(healthy.mode).toBe('protected');

    const collapsed = [makePath('wifi-1', 3 * MBPS), makePath('eth-1', 4 * MBPS)];
    const immediate = decide(
      input(collapsed, { now: 500, previous: healthy, previousAt: 0 }),
    );
    expect(immediate.mode).toBe('aggregated');
  });

  it('ignores reallocations too small to be worth a scheduler reset', () => {
    const first = decide(input(two, { now: 0 }));
    const nudged = [makePath('wifi-1', 5.1 * MBPS), makePath('eth-1', 5 * MBPS)];
    const second = decide(
      input(nudged, { now: DEFAULT_TUNING.dwellMs + 1000, previous: first, previousAt: 0 }),
    );
    expect(second.active).toEqual(first.active);
  });
});

describe('battery and thermal', () => {
  it('stops adding radios when the device is too hot', () => {
    const paths = [makePath('wifi-1', 20 * MBPS), makePath('cell-1', 20 * MBPS)];
    const hot = decide(input(paths, { thermalPressure: true, charging: false, batteryLevel: 0.8 }));
    expect(hot.mode).not.toBe('aggregated');
  });

  it('still aggregates when hot if the stream would otherwise not fit', () => {
    // Thermal pressure is a reason to be frugal, never a reason to drop the broadcast.
    const paths = [makePath('wifi-1', 4 * MBPS), makePath('eth-1', 4 * MBPS)];
    const hot = decide(input(paths, { thermalPressure: true, charging: false, batteryLevel: 0.8 }));
    expect(hot.mode).toBe('aggregated');
  });

  it('gets frugal on a nearly flat battery', () => {
    const paths = [makePath('wifi-1', 20 * MBPS), makePath('eth-1', 20 * MBPS)];
    const flat = decide(input(paths, { charging: false, batteryLevel: 0.05 }));
    expect(flat.mode).not.toBe('aggregated');
  });
});

describe('redundancy', () => {
  it('sends nothing twice on a single path', () => {
    expect(decide(input([makePath('wifi-1', 40 * MBPS)])).redundancy).toBe('none');
  });

  it('will not duplicate onto paths that are already full', () => {
    // Duplicating a keyframe onto a full path turns one protected frame into two late ones.
    const decision = decide(input([makePath('wifi-1', 4 * MBPS), makePath('eth-1', 4 * MBPS)]));
    expect(decision.redundancy).toBe('none');
  });

  it('protects keyframes when there is real room to spare', () => {
    const policy: BondPolicy = { ...DEFAULT_BOND_POLICY, mode: 'aggregated' };
    const decision = decide(
      input([makePath('wifi-1', 20 * MBPS), makePath('eth-1', 20 * MBPS)], { policy }),
    );
    expect(decision.redundancy).toBe('keyframe');
  });
});

describe('the sentence the creator reads', () => {
  it('never contains a protocol name, a path count or a percentage', () => {
    const cases: BondDecision[] = [
      decide(input([makePath('wifi-1', 40 * MBPS)])),
      decide(input([makePath('wifi-1', 40 * MBPS), makePath('eth-1', 40 * MBPS)])),
      decide(input([makePath('wifi-1', 5 * MBPS), makePath('eth-1', 5 * MBPS)])),
      decide(input([makePath('wifi-1', 2 * MBPS)])),
      decide(input([])),
    ];
    for (const decision of cases) {
      expect(decision.reason).not.toMatch(/MPTCP|QUIC|SRT|subflow|RTMP|bitrate|Mbps|%/i);
      expect(decision.reason.length).toBeLessThan(90);
      expect(decision.reason.endsWith('.')).toBe(true);
    }
  });
});
