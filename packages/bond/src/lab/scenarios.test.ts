/**
 * The fifteen scenarios of mission section 39, run against the real policy engine.
 *
 * Every one of these is SIMULATED. No radio was involved, and a pass here is evidence that the
 * engine's logic is sound, never evidence that a handset behaves this way. Section 50 is explicit
 * about the difference and `LabResult.simulated` carries it into every artefact.
 *
 * What these do prove, and unit tests cannot: behaviour across time. Failover latency, thrash,
 * hysteresis and recovery only exist in a sequence.
 */
import { describe, expect, it } from 'vitest';
import { formatResult, runScenario, type LabPath, type LabResult } from './lab.js';
import { DEFAULT_BOND_POLICY, type BondPolicy } from '../path/types.js';

const MBPS = 1_000_000;
const STREAM = 6 * MBPS;

const wifi = (capacityBps: number, extra = {}): LabPath => ({
  handle: 'wifi',
  transport: 'wifi',
  label: 'Wi-Fi',
  metered: 'unmetered',
  profile: { capacityBps, baseRttMs: 20, jitterMs: 6, baseLoss: 0, ...extra },
});

const fiveG = (capacityBps: number, extra = {}): LabPath => ({
  handle: '5g',
  transport: 'cellular',
  label: 'Mobile data',
  metered: 'metered',
  profile: { capacityBps, baseRttMs: 35, jitterMs: 12, baseLoss: 0.001, ...extra },
});

const lte = (capacityBps: number, extra = {}): LabPath => ({
  handle: 'lte',
  transport: 'cellular',
  label: 'Mobile data',
  metered: 'metered',
  profile: { capacityBps, baseRttMs: 55, jitterMs: 18, baseLoss: 0.003, ...extra },
});

/** A creator who has explicitly allowed mobile data to do real work. */
const AGGRESSIVE: BondPolicy = {
  ...DEFAULT_BOND_POLICY,
  allowAggregationOnMetered: true,
};

/** The last decision of a run: where the engine settled. */
function settled(result: LabResult) {
  return result.ticks.at(-1)!.decision;
}

/** True once the engine has stopped changing its mind. */
function stableTail(result: LabResult, ms: number): boolean {
  const tail = result.ticks.filter((t) => t.atMs >= result.ticks.at(-1)!.atMs - ms);
  const shapes = new Set(tail.map((t) => t.decision.active.filter((a) => !a.standby).map((a) => a.handle).sort().join(',')));
  return shapes.size === 1;
}

describe('single path', () => {
  it('TEST 1 - Wi-Fi only: carries the stream and says nothing clever', () => {
    const result = runScenario({
      name: 'TEST 1 - Wi-Fi only',
      paths: [wifi(25 * MBPS)],
      streamBitrateBps: STREAM,
      durationMs: 20_000,
    });
    const end = settled(result);
    expect(end.mode).toBe('single');
    expect(end.health).toBe('excellent');
    expect(result.starvedMs).toBe(0);
    expect(result.reallocations).toBe(0);
  });

  it('TEST 2 - mobile data only: carries it, because the alternative is no broadcast', () => {
    const result = runScenario({
      name: 'TEST 2 - 5G only',
      paths: [fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      durationMs: 20_000,
    });
    const end = settled(result);
    expect(end.active).toHaveLength(1);
    expect(end.active[0]!.standby).toBe(false);
    expect(result.starvedMs).toBe(0);
  });
});

describe('two and three paths', () => {
  it('TEST 3 - Wi-Fi + 5G: keeps mobile data warm rather than spending it', () => {
    const result = runScenario({
      name: 'TEST 3 - Wi-Fi + 5G',
      paths: [wifi(25 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      durationMs: 20_000,
    });
    const end = settled(result);
    expect(end.mode).toBe('protected');
    expect(end.active.find((a) => a.handle === '5g')!.standby).toBe(true);
    expect(result.starvedMs).toBe(0);
  });

  it('TEST 4 - Wi-Fi + LTE, both small: divides the stream between them', () => {
    const result = runScenario({
      name: 'TEST 4 - Wi-Fi + LTE',
      paths: [wifi(5 * MBPS), lte(5 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 25_000,
    });
    const end = settled(result);
    expect(end.mode).toBe('aggregated');
    expect(end.active.filter((a) => !a.standby)).toHaveLength(2);
    expect(stableTail(result, 8000)).toBe(true);
  });

  it('TEST 5 - Wi-Fi + 5G + LTE: uses all three when no two would do', () => {
    const result = runScenario({
      name: 'TEST 5 - three paths',
      paths: [wifi(4 * MBPS), fiveG(3 * MBPS), lte(3 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 25_000,
    });
    const end = settled(result);
    expect(end.mode).toBe('aggregated');
    expect(end.active.filter((a) => !a.standby).length).toBeGreaterThanOrEqual(2);
    // Shares must add up: a scheduler that loses part of the stream is worse than one path.
    const total = end.active.filter((a) => !a.standby).reduce((s, a) => s + a.share, 0);
    expect(total).toBeCloseTo(1, 4);
  });
});

describe('a path dies', () => {
  it('TEST 6 - Wi-Fi suddenly dies: the stream survives on mobile data', () => {
    // Section 40's continuity target. The failure is instant and total; what is measured is how
    // long the viewer would have seen nothing.
    const result = runScenario({
      name: 'TEST 6 - Wi-Fi dies',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [{ atMs: 15_000, handle: 'wifi', change: { down: true }, note: 'Wi-Fi lost' }],
    });

    const end = settled(result);
    expect(end.active.some((a) => a.handle === '5g' && !a.standby)).toBe(true);
    expect(end.active.some((a) => a.handle === 'wifi')).toBe(false);
    expect(end.health).not.toBe('offline');

    // The gap is bounded by how fast the engine can notice and move, which is one tick plus one
    // reallocation. Asserting a number here is the point: "seamless" is not a claim we may make.
    expect(result.longestStarveMs).toBeLessThanOrEqual(2000);
  });

  it('TEST 7 - mobile data dies while it was helping: Wi-Fi absorbs it', () => {
    const result = runScenario({
      name: 'TEST 7 - 5G dies',
      paths: [wifi(20 * MBPS), fiveG(8 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [{ atMs: 15_000, handle: '5g', change: { down: true }, note: '5G lost' }],
    });
    const end = settled(result);
    expect(end.active.some((a) => a.handle === 'wifi' && !a.standby)).toBe(true);
    expect(end.health).not.toBe('offline');
    expect(result.longestStarveMs).toBeLessThanOrEqual(2000);
  });

  it('TEST 8 - the smallest path dies and nobody notices', () => {
    const result = runScenario({
      name: 'TEST 8 - LTE dies',
      paths: [wifi(20 * MBPS), fiveG(10 * MBPS), lte(2 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [{ atMs: 20_000, handle: 'lte', change: { down: true }, note: 'LTE lost' }],
    });
    expect(settled(result).health).not.toBe('offline');
    expect(result.longestStarveMs).toBeLessThanOrEqual(1500);
  });
});

describe('a path degrades', () => {
  it('TEST 9 - Wi-Fi becomes slow: the engine notices and moves load', () => {
    const result = runScenario({
      name: 'TEST 9 - Wi-Fi high latency',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [
        { atMs: 15_000, handle: 'wifi', change: { baseRttMs: 600, jitterMs: 40 }, note: 'Wi-Fi latency spikes' },
      ],
    });
    // Whatever it decides, it must not keep calling this excellent.
    const after = result.ticks.filter((t) => t.atMs > 17_000);
    expect(after.every((t) => t.decision.health !== 'excellent')).toBe(true);
  });

  it('TEST 10 - mobile data congests: its share shrinks rather than the stream dying', () => {
    const result = runScenario({
      name: 'TEST 10 - cellular congested',
      paths: [wifi(6 * MBPS), fiveG(8 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [
        { atMs: 15_000, handle: '5g', change: { capacityBps: 1 * MBPS }, note: '5G congests to 1 Mbps' },
      ],
    });
    const end = settled(result);
    const cell = end.active.find((a) => a.handle === '5g');
    const wifiShare = end.active.find((a) => a.handle === 'wifi')?.share ?? 0;
    if (cell && !cell.standby) expect(cell.share).toBeLessThan(wifiShare);
    expect(end.health).not.toBe('offline');
  });

  it('TEST 11 - one path goes lossy: it is demoted below a clean path of the same size', () => {
    const result = runScenario({
      name: 'TEST 11 - one lossy path',
      paths: [wifi(5 * MBPS), fiveG(5 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [{ atMs: 15_000, handle: '5g', change: { baseLoss: 0.12 }, note: '5G starts losing packets' }],
    });
    const end = settled(result);
    const cell = end.active.find((a) => a.handle === '5g');
    const wifiShare = end.active.find((a) => a.handle === 'wifi')?.share ?? 0;
    expect(cell === undefined || cell.standby || cell.share < wifiShare).toBe(true);
  });

  it('TEST 12 - everything degrades at once: it says so instead of pretending', () => {
    // The most important assertion in this file. A bond that reports EXCELLENT while the stream
    // is starving has removed the one signal the creator could have acted on.
    const result = runScenario({
      name: 'TEST 12 - all paths degrade',
      paths: [wifi(8 * MBPS), fiveG(8 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 40_000,
      events: [
        { atMs: 15_000, handle: 'wifi', change: { capacityBps: 1 * MBPS }, note: 'Wi-Fi collapses' },
        { atMs: 15_000, handle: '5g', change: { capacityBps: 1 * MBPS }, note: '5G collapses' },
      ],
    });
    const end = settled(result);
    expect(['insufficient', 'degraded']).toContain(end.health);
    expect(end.encoderCeilingBps).toBeLessThan(STREAM);
    expect(end.reason).not.toContain('comfortably');
  });

  it('TEST 13 - the primary recovers, and the engine does not rush back', () => {
    const result = runScenario({
      name: 'TEST 13 - primary recovers',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 60_000,
      events: [
        { atMs: 10_000, handle: 'wifi', change: { down: true }, note: 'Wi-Fi lost' },
        { atMs: 30_000, handle: 'wifi', change: { down: false }, note: 'Wi-Fi back' },
      ],
    });

    // It comes back into service...
    const end = settled(result);
    expect(end.active.some((a) => a.handle === 'wifi')).toBe(true);

    // ...but the whole run must not be a sequence of panics. Section 13: do not thrash.
    expect(result.reallocations).toBeLessThanOrEqual(6);
    expect(stableTail(result, 10_000)).toBe(true);
  });
});

describe('the device and the creator', () => {
  it('TEST 14 - battery gets low: the engine gets frugal', () => {
    const generous = runScenario({
      name: 'TEST 14a - charged',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 20_000,
      charging: true,
    });
    const frugal = runScenario({
      name: 'TEST 14b - nearly flat',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 20_000,
      charging: false,
      batteryLevel: 0.08,
    });
    const carrying = (r: LabResult) => settled(r).active.filter((a) => !a.standby).length;
    expect(carrying(frugal)).toBeLessThanOrEqual(carrying(generous));
    expect(settled(frugal).health).not.toBe('offline');
  });

  it('TEST 15 - metered cellular, default policy: not one byte of stream goes over it', () => {
    // Section 52. This is the default every creator gets, and the test that stops a silent bill.
    const result = runScenario({
      name: 'TEST 15 - metered, default policy',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      durationMs: 30_000,
    });
    for (const tick of result.ticks) {
      const cell = tick.decision.active.find((a) => a.handle === '5g');
      expect(cell === undefined || cell.standby).toBe(true);
      expect(cell?.share ?? 0).toBe(0);
    }
  });
});

describe('the transcript', () => {
  it('stamps every report as simulated, in the text a person reads', () => {
    // A lab report that could be mistaken for a device test is the one artefact this whole layer
    // must never produce.
    const result = runScenario({
      name: 'TEST 6 - Wi-Fi dies',
      paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
      streamBitrateBps: STREAM,
      policy: AGGRESSIVE,
      durationMs: 20_000,
      events: [{ atMs: 10_000, handle: 'wifi', change: { down: true }, note: 'Wi-Fi lost' }],
    });
    expect(result.simulated).toBe(true);
    const text = formatResult(result);
    expect(text).toContain('[SIMULATED - no radio was involved]');
    expect(text).toContain('Wi-Fi lost');
  });
});

describe('the honesty invariant', () => {
  /*
   * The strongest property in this package, asserted across every scenario rather than case by
   * case: WHILE THE STREAM IS STARVING, THE ENGINE MAY NOT CLAIM IT IS FINE.
   *
   * This is section 49 turned into something a machine can check. It is here because the way it
   * was broken was not in the health logic at all - a lossy path kept earning optimistic capacity
   * estimates, the policy engine added imaginary capacity to real capacity, and `protected` came
   * out the other end while the broadcast starved for twenty-five seconds. A test that only
   * examined `judgeHealth` would have passed throughout.
   */
  const STARVING = 0.95;

  const cases: { name: string; run: () => LabResult }[] = [
    {
      name: 'one path goes lossy',
      run: () =>
        runScenario({
          name: 'lossy',
          paths: [wifi(5 * MBPS), fiveG(5 * MBPS)],
          streamBitrateBps: STREAM,
          policy: AGGRESSIVE,
          durationMs: 45_000,
          events: [{ atMs: 20_000, handle: '5g', change: { baseLoss: 0.12 }, note: 'loss' }],
        }),
    },
    {
      name: 'everything collapses',
      run: () =>
        runScenario({
          name: 'collapse',
          paths: [wifi(8 * MBPS), fiveG(8 * MBPS)],
          streamBitrateBps: STREAM,
          policy: AGGRESSIVE,
          durationMs: 45_000,
          events: [
            { atMs: 20_000, handle: 'wifi', change: { capacityBps: 1 * MBPS }, note: 'collapse' },
            { atMs: 20_000, handle: '5g', change: { capacityBps: 1 * MBPS }, note: 'collapse' },
          ],
        }),
    },
    {
      name: 'cellular congests to a trickle',
      run: () =>
        runScenario({
          name: 'congest',
          paths: [wifi(5 * MBPS), fiveG(8 * MBPS)],
          streamBitrateBps: STREAM,
          policy: AGGRESSIVE,
          durationMs: 45_000,
          events: [{ atMs: 20_000, handle: '5g', change: { capacityBps: 0.8 * MBPS }, note: 'congest' }],
        }),
    },
    {
      name: 'wi-fi dies',
      run: () =>
        runScenario({
          name: 'death',
          paths: [wifi(20 * MBPS), fiveG(15 * MBPS)],
          streamBitrateBps: STREAM,
          policy: AGGRESSIVE,
          durationMs: 45_000,
          events: [{ atMs: 20_000, handle: 'wifi', change: { down: true }, note: 'death' }],
        }),
    },
  ];

  for (const testCase of cases) {
    it(`never reports excellent while starving: ${testCase.name}`, () => {
      const result = testCase.run();
      /*
       * SUSTAINED starvation, not a single tick, and the distinction is the whole substance of the
       * invariant.
       *
       * A tick's `deliveredBps` measures the allocation decided on the PREVIOUS tick, while its
       * `decision` is the new one. So the tick immediately after a path dies legitimately shows low
       * delivery beside a healthy verdict: the engine has already moved the stream to the surviving
       * path, and it is describing the configuration it now has rather than the one it just
       * abandoned. Failing that would be demanding it apologise for a hole it has already fixed.
       *
       * Three consecutive short ticks is different. Nothing is recovering; the engine has settled
       * into an arrangement that does not carry the stream, and calling that `excellent` or
       * `protected` is the failure section 49 is about.
       */
      const WINDOW = 3;
      for (let i = WINDOW; i < result.ticks.length; i += 1) {
        const recent = result.ticks.slice(i - WINDOW, i);
        const starvingThroughout = recent.every(
          (t) => t.deliveredBps > 0 && t.deliveredBps < STREAM * STARVING,
        );
        if (!starvingThroughout) continue;
        const tick = result.ticks[i]!;
        expect(
          ['degraded', 'insufficient', 'offline'],
          `at ${tick.atMs}ms the stream had been short for ${WINDOW} ticks ` +
            `(last ${(recent.at(-1)!.deliveredBps / 1e6).toFixed(2)} of ${STREAM / 1e6} Mbps) ` +
            `but the engine reported "${tick.decision.health}"`,
        ).toContain(tick.decision.health);
      }
    });
  }
});
