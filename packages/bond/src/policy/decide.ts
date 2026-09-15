/**
 * The decision: which paths carry this broadcast, and how much each one takes.
 *
 * This is the brain, and it is a pure function on purpose. Everything interesting a bonding engine
 * does is a judgement call made under changing conditions, and judgement calls that live inside an
 * I/O loop can only be tested by reproducing the conditions - which for "5G degrades while Wi-Fi
 * saturates and the battery drops below 30%" means owning a radio lab. Here it means writing down
 * the numbers. The Bond Lab drives exactly this function; so does the real engine.
 *
 * Four commitments are encoded here, in descending order of how much damage breaking them does.
 *
 * 1. NEVER HIDE A FAILURE (section 49). If the paths cannot carry the stream, the decision says
 *    `insufficient` and names it. A bonding layer that reports EXCELLENT while dropping frames has
 *    taken away the one signal a creator could have acted on.
 *
 * 2. NEVER SPEND THE CREATOR'S MONEY WITHOUT PERMISSION (sections 26 and 52). A metered path is
 *    not given a full share unless the creator turned that on. The default is off, and the default
 *    is what almost everyone will run.
 *
 * 3. DO NOT THRASH (section 13). Reallocation is not free: every change risks reordering at the
 *    relay and costs a scheduler reset. So the engine reacts FAST to trouble and SLOWLY to
 *    improvement, which is the asymmetry that makes a live system feel stable rather than nervous.
 *
 * 4. LEAVE HEADROOM (section 17). Scheduling 100% of measured capacity guarantees a queue, and a
 *    queue is latency and then loss. The target is deliberately conservative.
 */
import type { BondPolicy, NetworkPath } from '../path/types.js';
import { isUsable } from '../path/stateMachine.js';
import { DEFAULT_WEIGHTS, scorePath, type ScoreWeights } from '../scoring/score.js';

/** How much of the stream is duplicated across paths to survive a loss (sections 21 and 22). */
export type RedundancyLevel =
  /** Send everything once. */
  | 'none'
  /**
   * Duplicate the packets carrying a keyframe, and audio.
   *
   * A lost keyframe is seconds of visible damage because everything after it references it, while
   * a lost inter-frame is one flawed frame nobody notices. Audio is duplicated with it because a
   * silence is more noticeable than a smeared frame.
   */
  | 'keyframe'
  /** Duplicate everything. Expensive and only correct when a path is expected to die. */
  | 'full';

/** What the creator is told, in one word (section 33). */
export type BondHealth =
  /** Comfortably more capacity than the stream needs, on a path that is behaving. */
  | 'excellent'
  /** Enough capacity, and a second path is standing by or helping. */
  | 'protected'
  /** Carrying the stream, but with no margin, or on a path that is unwell. */
  | 'degraded'
  /** The paths cannot carry this bitrate. The encoder has to come down. */
  | 'insufficient'
  /** Nothing usable at all. */
  | 'offline';

export interface PathAllocation {
  readonly handle: string;
  /** Fraction of the stream this path carries, 0..1. Shares across active paths sum to 1. */
  readonly share: number;
  /**
   * True when this path is held open but carrying only probes.
   *
   * This is what `protected` mode means in practice: a second path that is warm, measured and
   * ready, costing a trickle of data rather than a share of the broadcast. Failing over to a cold
   * path costs a handshake at the worst possible moment.
   */
  readonly standby: boolean;
}

export interface BondDecision {
  /** What the engine actually chose, which can differ from what the policy asked for. */
  readonly mode: BondPolicy['mode'];
  readonly active: readonly PathAllocation[];
  readonly redundancy: RedundancyLevel;
  /** Bits per second deliberately left unscheduled. */
  readonly targetHeadroomBps: number;
  /** What the active paths can carry together, after headroom. */
  readonly usableCapacityBps: number;
  readonly health: BondHealth;
  /**
   * What the encoder should not exceed, bits per second (section 48).
   *
   * Advice, not a command: the media layer owns the encoder. It exists so a bond that is running
   * out of room asks for a lower bitrate instead of letting the stream die, and so the request
   * moves in steps rather than tracking every wobble.
   */
  readonly encoderCeilingBps: number;
  /** One sentence a person could read. Never jargon (section 34). */
  readonly reason: string;
}

export interface DecideInput {
  readonly paths: readonly NetworkPath[];
  readonly policy: BondPolicy;
  /** What the encoder is producing right now. */
  readonly streamBitrateBps: number;
  readonly batteryLevel?: number;
  readonly charging?: boolean;
  /** True when the device is thermally throttling and an extra radio is a bad idea. */
  readonly thermalPressure?: boolean;
  /** Monotonic milliseconds. Hysteresis needs a clock, and it is passed in so tests own it. */
  readonly now: number;
  /** The last decision, for hysteresis. Omitted on the first call. */
  readonly previous?: BondDecision;
  /** When `previous` was made. */
  readonly previousAt?: number;
  readonly weights?: ScoreWeights;
  readonly tuning?: Partial<BondTuning>;
}

export interface BondTuning {
  /** Fraction of measured capacity left unscheduled. */
  readonly headroomFraction: number;
  /** A single path must beat the stream by this much before the engine will run on it alone. */
  readonly comfortableMultiple: number;
  /** Do not drop a path or shrink a mode within this many milliseconds of the last change. */
  readonly dwellMs: number;
  /** Ignore reallocations smaller than this, as a share. */
  readonly deadBand: number;
  /** Encoder ceiling steps, so the bitrate moves in stairs rather than tracking noise. */
  readonly encoderStepBps: number;
}

export const DEFAULT_TUNING: BondTuning = {
  headroomFraction: 0.25,
  comfortableMultiple: 1.6,
  dwellMs: 8000,
  deadBand: 0.08,
  encoderStepBps: 500_000,
};

/**
 * Decide.
 *
 * Reads as a sequence of narrowing questions: what can we legally use, what can it carry, does the
 * stream fit, and only then how to divide it up.
 */
export function decide(input: DecideInput): BondDecision {
  const tuning = { ...DEFAULT_TUNING, ...input.tuning };
  const weights = input.weights ?? DEFAULT_WEIGHTS;
  const context = {
    streamBitrateBps: input.streamBitrateBps,
    batteryLevel: input.batteryLevel,
    charging: input.charging,
    allowMetered: input.policy.allowAggregationOnMetered,
  };

  const scored = input.paths
    .filter((p) => isUsable(p.state))
    .map((path) => ({ path, score: scorePath(path, context, weights) }))
    .filter((entry) => entry.score.score > 0)
    .sort((a, b) => b.score.score - a.score.score);

  if (scored.length === 0) {
    return {
      mode: 'single',
      active: [],
      redundancy: 'none',
      targetHeadroomBps: 0,
      usableCapacityBps: 0,
      health: 'offline',
      encoderCeilingBps: input.streamBitrateBps,
      reason: 'No network is reachable.',
    };
  }

  /*
   * What each path may carry, given the creator's policy.
   *
   * A metered path with aggregation switched off is not excluded - excluding it would throw away
   * the failover that makes cellular worth having - it is capped at a standby trickle. That is the
   * difference between "do not spend my data" and "do not protect my stream".
   */
  const permitted = scored.map((entry) => {
    const metered = entry.path.metered === 'metered';
    const mayCarry =
      !metered ||
      input.policy.allowAggregationOnMetered ||
      // Cellular may still take the whole stream when it is the only thing left: a broadcast that
      // ends is worse than a broadcast that cost a few megabytes, and the creator said cellular
      // could protect the stream.
      (input.policy.useCellularForProtection && scored.length === 1);
    return { ...entry, mayCarry };
  });

  const carriers = permitted.filter((p) => p.mayCarry);

  /*
   * Paths that may not carry a share, but may be held warm.
   *
   * This is the whole point of the metered rule. A cellular path the creator has not licensed to
   * spend data on is still worth keeping open, measured and ready: failing over to a cold path
   * costs a handshake at the exact moment the stream cannot afford one. Dropping these entirely -
   * which is what the first version of this did - turned "do not spend my data" into "do not
   * protect my stream", which is not what anybody asked for.
   */
  const spares = permitted.filter((p) => !p.mayCarry && input.policy.useCellularForProtection);
  const headroomOf = (bps: number): number => bps * tuning.headroomFraction;
  const usableOf = (path: NetworkPath): number => {
    const capacity = path.estimatedCapacityBps ?? path.sample?.throughputBps ?? 0;
    return Math.max(0, capacity * (1 - tuning.headroomFraction));
  };

  if (carriers.length === 0) {
    // Everything we can see costs money and the creator said no. That is a legitimate answer and
    // it has to be said plainly rather than silently spending or silently failing.
    return {
      mode: 'single',
      active: [],
      redundancy: 'none',
      targetHeadroomBps: 0,
      usableCapacityBps: 0,
      health: 'insufficient',
      encoderCeilingBps: input.streamBitrateBps,
      reason: 'Only mobile data is available, and it is switched off for streaming.',
    };
  }

  const best = carriers[0]!;
  const bestUsable = usableOf(best.path);
  const need = input.streamBitrateBps;

  /*
   * Which mode. The policy is a ceiling on ambition, not an instruction: asking for `aggregated`
   * on a device with one path gets one path, and asking for `single` is honoured even when more
   * paths exist, because the creator said so.
   */
  const wanted = input.policy.mode;
  const comfortableAlone = bestUsable >= need * tuning.comfortableMultiple && best.path.state === 'HEALTHY';
  /** Anything that could stand behind the primary: a second carrier, or a warm metered spare. */
  const canProtect = carriers.length > 1 || spares.length > 0;
  /** Can the load genuinely be divided, or is there only one path allowed to do work? */
  const canAggregate = carriers.length > 1;

  let mode: BondPolicy['mode'];
  if (wanted === 'single') {
    mode = 'single';
  } else if (wanted === 'aggregated') {
    mode = canAggregate ? 'aggregated' : canProtect ? 'protected' : 'single';
  } else if (wanted === 'protected') {
    mode = canProtect ? 'protected' : 'single';
  } else {
    /*
     * Adaptive. The cheapest arrangement that is honestly good enough wins, and "good enough" is
     * measured against the stream rather than against the link. Aggregating when one path already
     * has comfortable margin spends battery and data to buy nothing.
     */
    if (bestUsable < need && canAggregate) mode = 'aggregated';
    else if (comfortableAlone && !thermallyConstrained(input)) mode = canProtect ? 'protected' : 'single';
    else if (canAggregate) mode = 'aggregated';
    else if (canProtect) mode = 'protected';
    else mode = 'single';
  }

  // Thermal pressure and a low battery both argue for fewer radios, and neither may override an
  // explicit request or a stream that would otherwise not fit.
  if (thermallyConstrained(input) && mode === 'aggregated' && bestUsable >= need && wanted === 'adaptive') {
    mode = canProtect ? 'protected' : 'single';
  }

  const active = allocate(
    mode,
    carriers.map((c) => ({ path: c.path, score: c.score.score })),
    spares.map((s) => ({ path: s.path, score: s.score.score })),
    usableOf,
    need,
  );
  const byHandle = new Map(permitted.map((p) => [p.path.handle, p.path]));
  const activeCapacity = active
    .filter((a) => !a.standby)
    .reduce((sum, a) => sum + usableOf(byHandle.get(a.handle)!), 0);

  const stable = applyHysteresis(active, input, tuning, mode);

  const health = judgeHealth({
    need,
    activeCapacity,
    mode: stable.mode,
    bestState: best.path.state,
    standbyCount: stable.active.filter((a) => a.standby).length,
  });

  return {
    mode: stable.mode,
    active: stable.active,
    redundancy: chooseRedundancy(health, stable, activeCapacity, need),
    targetHeadroomBps: headroomOf(activeCapacity / (1 - tuning.headroomFraction)),
    usableCapacityBps: activeCapacity,
    health,
    encoderCeilingBps: encoderCeiling(activeCapacity, need, input.previous, tuning),
    reason: explain(health, stable.mode, carriers.length, best.path),
  };
}

function thermallyConstrained(input: DecideInput): boolean {
  if (input.thermalPressure) return true;
  return !input.charging && (input.batteryLevel ?? 1) < 0.15;
}

/**
 * Divide the stream between paths.
 *
 * Shares are proportional to usable capacity weighted by score, so a path that is big but flaky
 * gets less than its size alone would suggest. No path is ever given more than its own usable
 * capacity, because a share that exceeds what a path can carry is a queue by another name.
 */
function allocate(
  mode: BondPolicy['mode'],
  carriers: readonly { path: NetworkPath; score: number }[],
  spares: readonly { path: NetworkPath; score: number }[],
  usableOf: (p: NetworkPath) => number,
  need: number,
): PathAllocation[] {
  if (carriers.length === 0) return [];
  const primary = carriers[0]!;

  if (mode === 'single') {
    return [{ handle: primary.path.handle, share: 1, standby: false }];
  }

  if (mode === 'protected') {
    /*
     * One carrier, one warm spare. The spare is the next-best path that may carry, or failing
     * that the best path the creator allowed us to keep warm but not to spend on - which is
     * usually the cellular one, and is exactly the case this mode exists for.
     */
    const spare = carriers[1] ?? spares[0];
    const result: PathAllocation[] = [{ handle: primary.path.handle, share: 1, standby: false }];
    if (spare) result.push({ handle: spare.path.handle, share: 0, standby: true });
    return result;
  }

  // Aggregated.
  const weighted = carriers.map((c) => ({
    handle: c.path.handle,
    capacity: usableOf(c.path),
    weight: usableOf(c.path) * Math.max(c.score, 0.01),
  }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) return [{ handle: primary.path.handle, share: 1, standby: false }];

  const raw = weighted.map((w) => ({ handle: w.handle, capacity: w.capacity, share: w.weight / totalWeight }));

  /*
   * Cap each share at what the path can actually carry, then give the remainder to whoever still
   * has room. Without this, a high-scoring but small path is handed a share it cannot deliver and
   * the whole stream waits for it.
   */
  const capped = raw.map((r) => ({
    ...r,
    share: need > 0 ? Math.min(r.share, r.capacity / need) : r.share,
  }));
  const assigned = capped.reduce((sum, c) => sum + c.share, 0);
  const shortfall = 1 - assigned;

  if (shortfall > 0.001) {
    const room = capped.map((c) => (need > 0 ? Math.max(0, c.capacity / need - c.share) : 0));
    const totalRoom = room.reduce((sum, r) => sum + r, 0);
    if (totalRoom > 0) {
      for (let i = 0; i < capped.length; i += 1) {
        capped[i] = { ...capped[i]!, share: capped[i]!.share + shortfall * (room[i]! / totalRoom) };
      }
    }
  }

  const total = capped.reduce((sum, c) => sum + c.share, 0);
  return capped
    .filter((c) => c.share > 0.001)
    .map((c) => ({ handle: c.handle, share: total > 0 ? c.share / total : 0, standby: false }));
}

/**
 * Resist change that is not worth making.
 *
 * Asymmetric on purpose. Anything that makes the stream safer - adding a path, moving load off a
 * path in trouble - happens immediately. Anything that makes it leaner - dropping a path, shrinking
 * the mode - waits out the dwell time, because the usual reason a path looks good again is that we
 * stopped using it a moment ago.
 */
function applyHysteresis(
  next: PathAllocation[],
  input: DecideInput,
  tuning: BondTuning,
  mode: BondPolicy['mode'],
): { active: readonly PathAllocation[]; mode: BondPolicy['mode'] } {
  const previous = input.previous;
  if (!previous || input.previousAt === undefined) return { active: next, mode };

  const sinceChange = input.now - input.previousAt;
  const wasWider = previous.active.filter((a) => !a.standby).length > next.filter((a) => !a.standby).length;
  const shrinking = wasWider || rank(mode) < rank(previous.mode);

  if (shrinking && sinceChange < tuning.dwellMs) {
    // Too soon to get leaner. Keep what is already working.
    return { active: previous.active, mode: previous.mode };
  }

  // Same shape, trivially different numbers: leave it alone rather than resetting the scheduler.
  const sameSet =
    previous.active.length === next.length &&
    previous.active.every((a) => next.some((n) => n.handle === a.handle && n.standby === a.standby));
  if (sameSet && mode === previous.mode) {
    const moved = next.reduce((max, n) => {
      const before = previous.active.find((a) => a.handle === n.handle);
      return Math.max(max, Math.abs((before?.share ?? 0) - n.share));
    }, 0);
    if (moved < tuning.deadBand) return { active: previous.active, mode: previous.mode };
  }

  return { active: next, mode };
}

function rank(mode: BondPolicy['mode']): number {
  return mode === 'single' ? 0 : mode === 'protected' ? 1 : mode === 'adaptive' ? 2 : 3;
}

function judgeHealth(args: {
  need: number;
  activeCapacity: number;
  mode: BondPolicy['mode'];
  bestState: NetworkPath['state'];
  standbyCount: number;
}): BondHealth {
  if (args.activeCapacity <= 0) return 'offline';
  if (args.activeCapacity < args.need) return 'insufficient';

  const margin = args.activeCapacity / args.need;
  if (args.bestState === 'DEGRADED' || args.bestState === 'UNSTABLE') return 'degraded';
  if (margin < 1.15) return 'degraded';
  if (args.standbyCount > 0 || args.mode === 'aggregated') return 'protected';
  return 'excellent';
}

/**
 * How much to duplicate.
 *
 * Only ever spends bandwidth it has. Duplicating a keyframe onto a path that is already full turns
 * one protected frame into two late ones, which is why this reads the measured margin rather than
 * the mode.
 */
function chooseRedundancy(
  health: BondHealth,
  stable: { active: readonly PathAllocation[]; mode: BondPolicy['mode'] },
  activeCapacity: number,
  need: number,
): RedundancyLevel {
  const carrying = stable.active.filter((a) => !a.standby).length;
  if (carrying < 2) return 'none';
  const margin = need > 0 ? activeCapacity / need : 0;
  if (health === 'insufficient' || margin < 1.2) return 'none';
  if (health === 'degraded' && margin >= 1.4) return 'keyframe';
  if (margin >= 2.2) return 'keyframe';
  return 'none';
}

/**
 * What to tell the encoder.
 *
 * Steps, and only downward quickly. Coming back up waits for real margin, because an encoder that
 * chases capacity produces a visibly pumping picture - which is a worse artefact than simply
 * running a little below the maximum.
 */
function encoderCeiling(
  activeCapacity: number,
  need: number,
  previous: BondDecision | undefined,
  tuning: BondTuning,
): number {
  const step = tuning.encoderStepBps;
  const room = Math.max(step, Math.floor(activeCapacity / step) * step);
  if (activeCapacity >= need) {
    const previousCeiling = previous?.encoderCeilingBps ?? need;
    if (previousCeiling >= need) return Math.max(need, previousCeiling);
    // Recovering: come back one step at a time, and only with real margin behind it.
    return activeCapacity > previousCeiling * 1.3 ? Math.min(need, previousCeiling + step) : previousCeiling;
  }
  return Math.max(step, Math.min(room, activeCapacity));
}

/** One sentence, in the creator's language. No path counts, no protocol names (section 34). */
function explain(
  health: BondHealth,
  mode: BondPolicy['mode'],
  carrierCount: number,
  best: NetworkPath,
): string {
  switch (health) {
    case 'offline':
      return 'No network is reachable.';
    case 'insufficient':
      return 'Your connection cannot carry this quality. LIVETAP is lowering it.';
    case 'degraded':
      return carrierCount > 1
        ? 'Your connection is struggling. LIVETAP is spreading the stream to protect it.'
        : 'Your connection is struggling.';
    case 'protected':
      return mode === 'aggregated'
        ? `${best.label} and ${carrierCount - 1} more are carrying your stream.`
        : `${best.label} is carrying your stream, with a backup ready.`;
    case 'excellent':
    default:
      return `${best.label} is carrying your stream comfortably.`;
  }
}
