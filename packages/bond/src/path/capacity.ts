/**
 * How much could this path carry, given that we have only ever asked it for a little?
 *
 * This is the subtlest problem in the whole layer, and getting it wrong produces a bonding engine
 * that is confidently, uselessly pessimistic. The first version of the Bond Lab pinned each path's
 * estimate to the throughput it had actually delivered, which sounds like the honest thing to do
 * and is in fact a trap: a 25 Mbps link carrying a 6 Mbps stream delivers exactly 6 Mbps, so the
 * estimate never rises above 6, so the engine concludes the path cannot carry the stream it is at
 * that moment carrying perfectly, and declares the broadcast insufficient. Capacity you never use
 * is capacity you never discover.
 *
 * Every real congestion control solves this the same way: treat clean delivery as permission to
 * try slightly more. TCP calls it slow start, BBR calls it probing, and the underlying reasoning
 * is identical - a path that delivered everything it was given with no queue growth has told you
 * its ceiling is somewhere above what you asked for, and the only way to find out where is to ask
 * for more.
 *
 * Two rules keep the optimism honest:
 *
 *   A SATURATED PATH PINS THE ESTIMATE. The moment delay starts growing under load, we have found
 *   the ceiling and we stop guessing. That number is measured, not inferred.
 *
 *   OPTIMISM STOPS AT "ENOUGH". Growth is capped at a ceiling the caller supplies, which is the
 *   most it is USEFUL to believe rather than the most that might be true. The engine never needs
 *   to know that an idle Ethernet port could do a gigabit; it needs to know whether this path can
 *   carry this stream with margin. Capping there means the estimate is never a claim we cannot
 *   back, which matters because this number is what the UI turns into a promise.
 */
import type { PathSample } from './types.js';

export interface CapacityEstimate {
  /** Bits per second. A lower bound on what this path can carry, never a measured ceiling. */
  readonly bps: number;
  /** True once a saturation event pinned this to something we actually observed. */
  readonly measured: boolean;
}

export interface CapacityInput {
  readonly previous?: CapacityEstimate;
  readonly sample: PathSample;
  /** What this path was asked to carry when the sample was taken, bits per second. */
  readonly offeredBps: number;
  /**
   * The most it is useful to believe about this path.
   *
   * Normally the stream's bitrate with comfortable margin. Growth stops here, which is what keeps
   * an under-used path from reporting an imaginary ceiling.
   */
  readonly ceilingBps: number;
  /** How fast to probe upward on clean delivery. 1.25 converges in a handful of samples. */
  readonly growth?: number;
  /**
   * Loss above which a path is treated as having found its limit rather than earning optimism.
   *
   * Matches the degraded threshold in the state machine on purpose: the two must not disagree
   * about what "this path is losing packets" means, or the engine can demote a path while still
   * raising its capacity estimate.
   */
  readonly lossFloor?: number;
}

const DEFAULT_GROWTH = 1.25;
const DEFAULT_LOSS_FLOOR = 0.02;

export function estimateCapacity(input: CapacityInput): CapacityEstimate {
  const { sample, offeredBps, ceilingBps } = input;
  const growth = input.growth ?? DEFAULT_GROWTH;
  const previous = input.previous;

  /*
   * Total loss is a dead path, and that is believed immediately.
   *
   * Zero throughput is NOT the same thing, and conflating the two cost an afternoon: a standby
   * path delivers nothing because it was asked for nothing, and writing it off as dead meant it
   * could never be given a share, which meant it could never demonstrate otherwise. A path is only
   * failing to deliver if it was asked to deliver.
   */
  if (sample.loss >= 1) return { bps: 0, measured: true };
  if (offeredBps > 0 && sample.throughputBps <= 0) return { bps: 0, measured: true };

  /*
   * Saturation is the only thing here that produces a measurement rather than a guess. The path
   * was pushed until its queue grew, and what came out the other side is its real capacity. Note
   * that this can move the estimate DOWN, which is the whole point: a link that congests must be
   * believed immediately, because continuing to schedule against a stale optimistic number is how
   * a bond keeps feeding a path that is already drowning.
   */
  if (sample.atCapacity) {
    return { bps: sample.throughputBps, measured: true };
  }

  /*
   * Loss under load is a limit, even when the queue-delay heuristic never fired.
   *
   * Optimism is earned by CLEAN delivery. A path that is dropping packets has already told us it
   * is at or past its useful capacity, and probing it upward is both wrong and actively harmful:
   * the estimate climbs, the allocator hands it a bigger share, and more of the broadcast goes
   * down the path that is losing it.
   *
   * This was a real defect, and the way it surfaced is worth recording. A 5 Mbps cellular path at
   * 12% loss was never pushed hard enough to trip `atCapacity`, so it stayed in the branch below
   * and probed all the way to the ceiling. The policy engine then added its imaginary capacity to
   * Wi-Fi's real capacity, concluded the stream fitted comfortably, and reported `protected` while
   * the broadcast starved for twenty-five seconds - the exact dishonesty section 49 forbids, and
   * arrived at through an estimator rather than through anything in the health logic.
   */
  if (offeredBps > 0 && sample.loss > (input.lossFloor ?? DEFAULT_LOSS_FLOOR)) {
    return { bps: sample.throughputBps, measured: true };
  }

  /*
   * Clean delivery under load. The path carried everything it was given without queueing, so its
   * ceiling is above `offeredBps` - we just do not know by how much. Probe upward from whichever
   * is higher: what we already believed, or what it just proved.
   */
  if (offeredBps > 0) {
    const proven = Math.max(previous?.bps ?? 0, sample.throughputBps);
    return { bps: Math.min(ceilingBps, proven * growth), measured: false };
  }

  /*
   * Idle, carrying only probes. A probe reply says the path is alive; it says nothing about how
   * big it is, so nothing is learned and nothing is claimed. A path that has never carried load
   * starts at the ceiling as a hypothesis the first real allocation will correct in either
   * direction - which is right, because refusing to try an untested path means never discovering
   * the one that would have saved the broadcast.
   *
   * A previous estimate of zero is a write-off, and a write-off must not outlive the failure that
   * caused it. Reaching this line at all means the path is responding again - total loss returned
   * above - so it gets the same fresh hypothesis a newly discovered path gets. Without this a
   * recovered path is permanently credited with zero capacity, is therefore never given a share,
   * and therefore never gets the chance to prove otherwise: Wi-Fi comes back and the engine goes
   * on streaming over cellular for the rest of the broadcast.
   */
  if (previous && previous.bps > 0) return previous;
  return { bps: ceilingBps, measured: false };
}

/**
 * The ceiling worth believing for a given stream.
 *
 * Twice the bitrate: enough to conclude a path is comfortable on its own, and not so much that the
 * engine starts making claims about idle links it has never pushed.
 */
export function usefulCeilingFor(streamBitrateBps: number): number {
  return Math.max(streamBitrateBps * 2, 1_000_000);
}
