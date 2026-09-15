/**
 * The lifecycle of one network path, as a pure transition function.
 *
 * Every interesting failure in a bonding engine is a timing failure, and timing failures are
 * unreproducible if the logic lives inside the thing doing the I/O. So the rules live here, take
 * an event and return a state, and touch nothing. The Bond Lab drives this with scripted events;
 * the real monitor drives it with measured ones; both get identical behaviour, which is the only
 * way a simulated test result says anything about the real product.
 *
 * Three distinctions this machine exists to keep straight, because collapsing any of them produces
 * a bonding engine that makes things worse:
 *
 *   DEGRADED is not SATURATED. A degraded path is unwell: it is losing packets or its round trip
 *   has grown for reasons outside our control, and it should be given less traffic. A saturated
 *   path is perfectly healthy and simply full, because WE filled it. Taking traffic off a
 *   saturated path is how an engine spirals: it removes load, the path looks fine, it adds load,
 *   the path saturates, repeat. A saturated path is a signal to stop ADDING, not to start removing.
 *
 *   UNSTABLE is not FAILED. A failed path is gone. An unstable path keeps coming back, and the
 *   damage it does is the churn itself - every transition costs a reschedule and risks reordering.
 *   An unstable path is demoted and left alone, not retried harder.
 *
 *   TESTING is not HEALTHY. The OS saying a network has Internet is an opinion. Carrying our media
 *   to our relay is a fact. Nothing gets a share of a live broadcast on an opinion.
 */
import type { PathSample, PathState } from './types.js';

/** Everything that can happen to a path. */
export type PathEvent =
  /** The OS is now offering this network. */
  | { readonly kind: 'appeared' }
  /** The OS has withdrawn it, or the interface went down. */
  | { readonly kind: 'disappeared' }
  /** A reachability probe to the relay started. */
  | { readonly kind: 'probeStarted' }
  /** A probe reached the relay and came back. */
  | { readonly kind: 'probeSucceeded' }
  /** A probe did not come back within its deadline. */
  | { readonly kind: 'probeFailed' }
  /** A fresh measurement of a path that is carrying traffic. */
  | { readonly kind: 'measured'; readonly sample: PathSample };

/**
 * When a path stops being good enough.
 *
 * Every number here is tunable and none of them is claimed to be right: the mission is explicit
 * that the formula should be benchmarked rather than hardcoded, and these are starting points
 * chosen to be defensible rather than tuned. They are deliberately generous, because the cost of
 * wrongly demoting a good path (a reschedule, a reorder, possibly a visible hitch) is higher than
 * the cost of leaving a slightly-poor path in place for one more probe interval.
 */
export interface PathThresholds {
  /** Loss above this is degradation, not noise. */
  readonly degradedLoss: number;
  /** Round trip above this is degradation even with no loss. */
  readonly degradedRttMs: number;
  /** Jitter above this makes a path unstable rather than merely slow. */
  readonly unstableJitterMs: number;
  /** Retransmit rate above this is degradation. */
  readonly degradedRetransmitRate: number;
  /**
   * How much a round trip has to grow over a path's own baseline before "full" is the better
   * explanation than "broken". Bufferbloat is the signature of saturation: the queue in front of
   * the bottleneck grows, delay grows with it, and loss stays near zero.
   */
  readonly saturationRttMultiple: number;
  /** Transitions within the flap window before a path is called unstable. */
  readonly flapCount: number;
}

export const DEFAULT_THRESHOLDS: PathThresholds = {
  degradedLoss: 0.02,
  degradedRttMs: 250,
  unstableJitterMs: 120,
  degradedRetransmitRate: 0.08,
  saturationRttMultiple: 2.5,
  flapCount: 4,
};

/** What the machine needs to know that a single event does not carry. */
export interface PathContext {
  /**
   * The lowest round trip this path has shown, in milliseconds.
   *
   * Saturation can only be judged against a path's own baseline. 60 ms is excellent for cellular
   * and poor for wired Ethernet, so a fixed threshold would call one path full and miss the other
   * entirely.
   */
  readonly baselineRttMs?: number;
  /** State changes inside the recent window, for flap detection. */
  readonly recentTransitions: number;
}

/**
 * Classify a measurement of a path that is carrying traffic.
 *
 * Order matters and is the whole point. Loss and retransmission are checked before saturation,
 * because a path that is both full AND lossy is in trouble rather than merely busy. Saturation is
 * only ever concluded when delay has grown and loss has NOT, which is what separates "we filled
 * the pipe" from "the pipe broke".
 */
export function classifySample(
  sample: PathSample,
  context: PathContext,
  thresholds: PathThresholds = DEFAULT_THRESHOLDS,
): PathState {
  if (context.recentTransitions >= thresholds.flapCount) return 'UNSTABLE';
  if (sample.jitterMs > thresholds.unstableJitterMs) return 'UNSTABLE';
  if (sample.loss > thresholds.degradedLoss) return 'DEGRADED';
  if (sample.retransmitRate > thresholds.degradedRetransmitRate) return 'DEGRADED';

  const baseline = context.baselineRttMs;
  if (
    sample.atCapacity &&
    baseline !== undefined &&
    baseline > 0 &&
    sample.rttMs >= baseline * thresholds.saturationRttMultiple
  ) {
    return 'SATURATED';
  }

  if (sample.rttMs > thresholds.degradedRttMs) return 'DEGRADED';
  return 'HEALTHY';
}

/** True once a path is carrying, or is fit to carry, part of a live broadcast. */
export function isUsable(state: PathState): boolean {
  return state === 'HEALTHY' || state === 'DEGRADED' || state === 'SATURATED';
}

/** True while a path is on its way in and must not be given traffic yet. */
export function isPending(state: PathState): boolean {
  return state === 'DISCOVERING' || state === 'TESTING' || state === 'RECOVERING';
}

/**
 * The transition itself.
 *
 * `disappeared` is handled before everything else and from every state, because a network that the
 * OS has withdrawn is gone whatever we believed a millisecond ago, and a machine that can be
 * talked out of noticing that is a machine that keeps scheduling traffic onto a dead radio.
 */
export function nextPathState(
  current: PathState,
  event: PathEvent,
  context: PathContext = { recentTransitions: 0 },
  thresholds: PathThresholds = DEFAULT_THRESHOLDS,
): PathState {
  if (event.kind === 'disappeared') return 'FAILED';

  switch (current) {
    case 'UNAVAILABLE':
      return event.kind === 'appeared' ? 'DISCOVERING' : 'UNAVAILABLE';

    case 'DISCOVERING':
      if (event.kind === 'probeStarted') return 'TESTING';
      // A probe result without a start is still a result worth believing.
      if (event.kind === 'probeSucceeded') return 'HEALTHY';
      if (event.kind === 'probeFailed') return 'FAILED';
      return 'DISCOVERING';

    case 'TESTING':
      if (event.kind === 'probeSucceeded') return 'HEALTHY';
      if (event.kind === 'probeFailed') return 'FAILED';
      return 'TESTING';

    case 'HEALTHY':
    case 'DEGRADED':
    case 'SATURATED':
    case 'UNSTABLE':
      if (event.kind === 'probeFailed') return 'FAILED';
      if (event.kind === 'measured') return classifySample(event.sample, context, thresholds);
      // A path already in service does not go back to TESTING because a probe was re-sent.
      if (event.kind === 'probeSucceeded') return current === 'UNSTABLE' ? 'UNSTABLE' : current;
      return current;

    case 'FAILED':
      // Only the OS offering the network again starts recovery. A probe cannot be sent down a
      // network we no longer hold, so a probe result here is stale and is ignored on purpose.
      return event.kind === 'appeared' ? 'RECOVERING' : 'FAILED';

    case 'RECOVERING':
      if (event.kind === 'probeStarted') return 'TESTING';
      if (event.kind === 'probeSucceeded') return 'HEALTHY';
      if (event.kind === 'probeFailed') return 'FAILED';
      return 'RECOVERING';

    default: {
      // Exhaustiveness: a new PathState that nobody taught this machine about is a compile error
      // rather than a path that silently sticks in whatever it was.
      const unreachable: never = current;
      return unreachable;
    }
  }
}
