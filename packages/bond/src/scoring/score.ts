/**
 * How good is this path, for THIS stream, right now.
 *
 * The mission is explicit that the formula should be benchmarked and tuned rather than declared,
 * so this file gives the shape and a defensible starting point, keeps every weight in one tunable
 * object, and returns the full breakdown alongside the number. The breakdown is not decoration:
 * a bonding engine that cannot say why it demoted a path is a bonding engine nobody can debug, and
 * Pro mode shows this straight through.
 *
 * The one idea that matters most here: throughput is scored against what the STREAM needs, never
 * in the abstract. A 5 Mbps path is excellent for a 3 Mbps broadcast and useless on its own for a
 * 12 Mbps one, and a scorer that returns the same number in both cases has thrown away the only
 * context that makes the number actionable. Section 16 of the mission says this in so many words,
 * and it is why `ScoreContext` requires the stream's bitrate.
 */
import type { MeteredState, NetworkPath } from '../path/types.js';
import { isUsable } from '../path/stateMachine.js';

/** Relative importance of each term. They do not have to sum to 1; the result is normalised. */
export interface ScoreWeights {
  readonly throughput: number;
  readonly latency: number;
  readonly jitter: number;
  readonly loss: number;
  readonly stability: number;
  readonly cost: number;
  readonly battery: number;
}

/**
 * Starting weights, chosen to be defensible rather than tuned.
 *
 * Loss is weighted hardest because it is the term a viewer actually sees: a lossy path produces
 * artefacts and stalls, while a slow-but-clean path just produces a slightly later stream that
 * nobody notices. Throughput is next because a path that cannot carry its share is not a path.
 * Latency is deliberately modest: this is a broadcast, not a phone call, and a relay with a
 * reorder buffer converts latency into a small fixed delay rather than into damage.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  throughput: 0.3,
  latency: 0.1,
  jitter: 0.1,
  loss: 0.25,
  stability: 0.15,
  cost: 0.05,
  battery: 0.05,
};

export interface ScoreContext {
  /** What the encoder is producing, bits per second. The yardstick for every capacity judgement. */
  readonly streamBitrateBps: number;
  /** 0..1, or undefined where the platform does not say. */
  readonly batteryLevel?: number;
  readonly charging?: boolean;
  /** Has the creator allowed metered paths to do real work? */
  readonly allowMetered: boolean;
}

/** The number, and every term that produced it. */
export interface PathScore {
  readonly handle: string;
  /** 0..1. Higher is better. Zero means unusable, not merely poor. */
  readonly score: number;
  readonly terms: Readonly<Record<keyof ScoreWeights, number>>;
  /** One short sentence, for Pro mode and for the session log. */
  readonly reason: string;
}

/** Map a value where lower is better onto 0..1, reaching 0 asymptotically. */
function decay(value: number, halfPoint: number): number {
  if (value <= 0) return 1;
  return halfPoint / (halfPoint + value);
}

function costTerm(metered: MeteredState, allowMetered: boolean): number {
  if (metered === 'unmetered') return 1;
  if (metered === 'unknown') return 0.6;
  return allowMetered ? 0.4 : 0.05;
}

/**
 * What using this path costs in battery, as a rough class rather than a measurement.
 *
 * No platform hands out a per-interface power draw, so this is a deliberate approximation: a
 * cellular modem transmitting sustained uplink is the expensive case, Wi-Fi is cheaper, and a
 * cable costs effectively nothing. Charging removes the concern entirely. This is honest about
 * being a heuristic, which is why it is one small term and not a gate.
 */
function batteryTerm(path: NetworkPath, context: ScoreContext): number {
  if (context.charging) return 1;

  /*
   * Scarcity amplifies the PENALTY, never the base.
   *
   * The first version of this scaled the base value, which quietly penalised a wired path for the
   * laptop being unplugged: Ethernet costs no radio power at 5% battery or at 95%, and a scorer
   * that says otherwise will eventually demote the best path a desktop has for no reason at all.
   * Expressing the term as "how expensive is this radio, times how much that matters right now"
   * makes a free path free by construction.
   */
  const cost = path.transport === 'cellular' ? 0.6 : path.transport === 'wifi' ? 0.25 : 0;
  if (cost === 0) return 1;

  const level = context.batteryLevel;
  const scarcity = level === undefined ? 1 : level < 0.3 ? 2 : level < 0.7 ? 1.25 : 1;
  return Math.max(0, Math.min(1, 1 - cost * scarcity));
}

/**
 * Score one path.
 *
 * A path that is not usable scores exactly zero and says why. That is deliberate rather than a
 * small number: the allocator multiplies by score, and a near-zero share of a live broadcast sent
 * down a dead path is strictly worse than no share at all, because the packets that went there
 * have to be recovered from somewhere.
 */
export function scorePath(
  path: NetworkPath,
  context: ScoreContext,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PathScore {
  const zero = {
    throughput: 0,
    latency: 0,
    jitter: 0,
    loss: 0,
    stability: 0,
    cost: 0,
    battery: 0,
  } as const;

  if (!isUsable(path.state)) {
    return { handle: path.handle, score: 0, terms: zero, reason: `not carrying traffic (${path.state})` };
  }

  const sample = path.sample;
  if (!sample) {
    // Usable but never measured. Scoring it against an imagined sample would invent a capability.
    return { handle: path.handle, score: 0, terms: zero, reason: 'no measurement yet' };
  }

  const capacity = path.estimatedCapacityBps ?? sample.throughputBps;
  /*
   * Capacity is scored as a fraction of the whole stream, capped at 1. A path that could carry the
   * entire broadcast on its own gets full marks and no more: being able to carry it twice over is
   * not twice as useful, and rewarding it would bias every allocation toward one fat path even
   * when spreading the load is what protects the stream.
   */
  const throughput = context.streamBitrateBps > 0 ? Math.min(1, capacity / context.streamBitrateBps) : 1;

  const terms = {
    throughput,
    latency: decay(sample.rttMs, 120),
    jitter: decay(sample.jitterMs, 40),
    // Loss is scored steeply: 2% is already unpleasant and 10% is unusable, so the half point is
    // set low enough that the difference between those two is most of the term's range.
    loss: decay(sample.loss * 100, 1.5),
    stability: decay(path.failureCount, 2),
    cost: costTerm(path.metered, context.allowMetered),
    battery: batteryTerm(path, context),
  } as const;

  const total = Object.entries(weights).reduce(
    (sum, [key, weight]) => sum + weight * terms[key as keyof ScoreWeights],
    0,
  );
  const weightSum = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const score = weightSum > 0 ? total / weightSum : 0;

  return { handle: path.handle, score, terms, reason: worstTerm(terms) };
}

/** Name the term dragging a path down, so a demotion can be explained in one phrase. */
function worstTerm(terms: Readonly<Record<keyof ScoreWeights, number>>): string {
  const entries = Object.entries(terms) as [keyof ScoreWeights, number][];
  const [name, value] = entries.reduce((worst, entry) => (entry[1] < worst[1] ? entry : worst));
  if (value > 0.8) return 'healthy';
  const english: Record<keyof ScoreWeights, string> = {
    throughput: 'not enough capacity',
    latency: 'slow round trip',
    jitter: 'uneven delivery',
    loss: 'losing packets',
    stability: 'has failed before',
    cost: 'costs data',
    battery: 'costs battery',
  };
  return english[name];
}

/** Score every path, best first. Ties keep their input order, so the result is deterministic. */
export function rankPaths(
  paths: readonly NetworkPath[],
  context: ScoreContext,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PathScore[] {
  return paths
    .map((path) => scorePath(path, context, weights))
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score.score - a.score.score || a.index - b.index)
    .map((entry) => entry.score);
}
