import { describe, expect, it } from 'vitest';
import { estimateCapacity, usefulCeilingFor, type CapacityEstimate } from './capacity.js';
import type { PathSample } from './types.js';

const MBPS = 1_000_000;
const CEILING = usefulCeilingFor(6 * MBPS);

function sample(overrides: Partial<PathSample> = {}): PathSample {
  return {
    at: 0,
    throughputBps: 6 * MBPS,
    rttMs: 25,
    jitterMs: 5,
    loss: 0,
    retransmitRate: 0,
    atCapacity: false,
    ...overrides,
  };
}

describe('estimateCapacity', () => {
  it('starts an untested path at the ceiling, as a hypothesis', () => {
    // Refusing to try an untested path means never discovering the one that would have saved the
    // broadcast. The first real allocation corrects this in either direction.
    const result = estimateCapacity({
      sample: sample({ throughputBps: 0 }),
      offeredBps: 0,
      ceilingBps: CEILING,
    });
    expect(result.bps).toBe(CEILING);
    expect(result.measured).toBe(false);
  });

  it('does not write off a standby path for delivering nothing', () => {
    // The bug this test exists for: a path carrying no traffic delivers 0 bps, and treating that
    // as death meant it could never be given a share, so it could never prove otherwise. Every
    // protected-mode spare in the product is in exactly this state.
    const previous: CapacityEstimate = { bps: 9 * MBPS, measured: false };
    const idle = estimateCapacity({
      previous,
      sample: sample({ throughputBps: 0 }),
      offeredBps: 0,
      ceilingBps: CEILING,
    });
    expect(idle.bps).toBe(9 * MBPS);
  });

  it('writes off a path that delivered nothing when it was asked to deliver', () => {
    const result = estimateCapacity({
      previous: { bps: 9 * MBPS, measured: false },
      sample: sample({ throughputBps: 0 }),
      offeredBps: 6 * MBPS,
      ceilingBps: CEILING,
    });
    expect(result.bps).toBe(0);
    expect(result.measured).toBe(true);
  });

  it('gives a recovered path a fresh hypothesis instead of its write-off', () => {
    /*
     * A write-off must not outlive the failure that caused it. Without this, a path that comes
     * back is permanently credited with zero capacity, so it is never given a share, so it never
     * gets to prove otherwise - Wi-Fi returns and the broadcast stays on cellular for good.
     * Reaching the idle branch at all means the path is answering again.
     */
    const written_off: CapacityEstimate = { bps: 0, measured: true };
    const recovered = estimateCapacity({
      previous: written_off,
      sample: sample({ throughputBps: 0, loss: 0 }),
      offeredBps: 0,
      ceilingBps: CEILING,
    });
    expect(recovered.bps).toBe(CEILING);
    expect(recovered.measured).toBe(false);
  });

  it('believes total loss immediately, loaded or not', () => {
    const result = estimateCapacity({
      previous: { bps: 20 * MBPS, measured: true },
      sample: sample({ loss: 1, throughputBps: 0 }),
      offeredBps: 0,
      ceilingBps: CEILING,
    });
    expect(result.bps).toBe(0);
  });

  it('probes upward while a loaded path delivers cleanly', () => {
    // Capacity you never use is capacity you never discover. A path that carried everything it was
    // given without queueing has told us its ceiling is somewhere above what we asked for.
    let estimate = estimateCapacity({
      sample: sample({ throughputBps: 4 * MBPS }),
      offeredBps: 4 * MBPS,
      ceilingBps: CEILING,
    });
    const first = estimate.bps;
    expect(first).toBeGreaterThan(4 * MBPS);

    estimate = estimateCapacity({
      previous: estimate,
      sample: sample({ throughputBps: 4 * MBPS }),
      offeredBps: 4 * MBPS,
      ceilingBps: CEILING,
    });
    expect(estimate.bps).toBeGreaterThan(first);
    expect(estimate.measured).toBe(false);
  });

  it('stops being optimistic at the ceiling', () => {
    // The engine never needs to know an idle Ethernet port could do a gigabit. Capping at what is
    // useful keeps the estimate from becoming a claim we cannot back.
    let estimate: CapacityEstimate = { bps: CEILING * 0.95, measured: false };
    for (let i = 0; i < 20; i += 1) {
      estimate = estimateCapacity({
        previous: estimate,
        sample: sample({ throughputBps: 6 * MBPS }),
        offeredBps: 6 * MBPS,
        ceilingBps: CEILING,
      });
    }
    expect(estimate.bps).toBe(CEILING);
  });

  it('pins the estimate to what was measured the moment a path saturates', () => {
    const result = estimateCapacity({
      previous: { bps: 20 * MBPS, measured: false },
      sample: sample({ throughputBps: 5 * MBPS, atCapacity: true }),
      offeredBps: 8 * MBPS,
      ceilingBps: CEILING,
    });
    expect(result.bps).toBe(5 * MBPS);
    expect(result.measured).toBe(true);
  });

  it('lets a saturation measurement move the estimate DOWN', () => {
    // A link that congests has to be believed straight away. Continuing to schedule against a
    // stale optimistic number is how a bond keeps feeding a path that is already drowning.
    const optimistic: CapacityEstimate = { bps: 12 * MBPS, measured: false };
    const congested = estimateCapacity({
      previous: optimistic,
      sample: sample({ throughputBps: 1 * MBPS, atCapacity: true, loss: 0.2 }),
      offeredBps: 6 * MBPS,
      ceilingBps: CEILING,
    });
    expect(congested.bps).toBe(1 * MBPS);
  });
});

describe('usefulCeilingFor', () => {
  it('is twice the stream, so a single path can be judged comfortable', () => {
    expect(usefulCeilingFor(6 * MBPS)).toBe(12 * MBPS);
  });

  it('never collapses to nothing for a tiny stream', () => {
    expect(usefulCeilingFor(100)).toBeGreaterThanOrEqual(1_000_000);
  });
});
