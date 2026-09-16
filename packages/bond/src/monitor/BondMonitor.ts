/**
 * BondMonitor — the stateful adapter that lets a surface actually USE Bond.
 *
 * WHY THIS DID NOT EXIST, and why Bond had one consumer. Everything in this package is a pure
 * function over state somebody else is keeping: `classifySample` needs a baseline RTT and a flap
 * count, `estimateCapacity` needs the previous estimate, `decide` needs the previous decision and
 * when it was made. That is correct design — it is what makes the decision layer testable across
 * simulated time — but it means the first thing every consumer has to write is the same two
 * hundred lines of bookkeeping. The desktop engine wrote them. Web and Android did not, so Bond
 * was a package with tests and no consumers on two of the three surfaces.
 *
 * This is that bookkeeping, written once:
 *
 *     monitor.observe('whip', sample, { transport: 'wifi', label: 'Network' })
 *     const decision = monitor.decide(encoderBitrateBps)
 *     decision.health            // 'excellent' | 'protected' | 'degraded' | 'insufficient' | 'offline'
 *     decision.encoderCeilingBps // what the encoder should not exceed
 *
 * BROWSER-SAFE ON PURPOSE. Nothing here imports `node:dgram` or anything else platform-bound; it
 * reaches only the decision layer. That is what allows a browser to take part at all — a browser
 * cannot bind a socket to an interface, so it can never run Bond's wire protocol, but it can
 * absolutely be measured and decided about. Import it from `@livetap/bond/browser`, which is the
 * entry that carries no Node surface.
 *
 * ONE PATH IS A LEGITIMATE BOND. A browser has exactly one route to the relay and always will.
 * Running it through the same model as a phone holding Wi-Fi and cellular is the point rather than
 * an accident: the health a creator reads, the moment a broadcast is called degraded, and the
 * bitrate the encoder is advised to come down to are then decided in ONE place with ONE set of
 * thresholds, instead of each surface inventing its own constants and disagreeing about what
 * "unhealthy" means.
 */
import {
  DEFAULT_BOND_POLICY,
  type BondPolicy,
  type MeteredState,
  type NetworkPath,
  type PathIndependence,
  type PathSample,
  type PathState,
  type PathTransport,
} from '../path/types.js';
import {
  DEFAULT_THRESHOLDS,
  isPending,
  nextPathState,
  type PathThresholds,
} from '../path/stateMachine.js';
import { estimateCapacity, type CapacityEstimate } from '../path/capacity.js';
import { decide, type BondDecision, type BondTuning } from '../policy/decide.js';
import type { ScoreWeights } from '../scoring/score.js';

/** What a surface knows about a path beyond its measurements. All optional but `transport`. */
export interface PathIdentity {
  readonly transport: PathTransport;
  readonly label?: string;
  readonly metered?: MeteredState;
  readonly independence?: PathIndependence;
  readonly radio?: Readonly<Record<string, string | number>>;
}

export interface BondMonitorOptions {
  readonly policy?: BondPolicy;
  readonly thresholds?: PathThresholds;
  readonly tuning?: Partial<BondTuning>;
  readonly weights?: ScoreWeights;
  /**
   * How long a state change counts toward flap detection.
   *
   * `classifySample` refuses to trust a path that keeps changing its mind, but "recent" is the
   * caller's unit to define because it depends on the sampling interval.
   */
  readonly flapWindowMs?: number;
}

/** Everything this monitor remembers about one path between samples. */
interface PathRecord {
  path: NetworkPath;
  capacity?: CapacityEstimate;
  baselineRttMs?: number;
  /** Timestamps of recent state changes, trimmed to the flap window. */
  transitions: number[];
  /** What this path was asked to carry when the last sample was taken. */
  offeredBps: number;
}

const DEFAULT_FLAP_WINDOW_MS = 30_000;

export class BondMonitor {
  private readonly options: BondMonitorOptions;
  private readonly records = new Map<string, PathRecord>();
  private previous?: BondDecision;
  private previousAt?: number;

  constructor(options: BondMonitorOptions = {}) {
    this.options = options;
  }

  /**
   * Record a measurement, advancing this path's state machine and capacity estimate.
   *
   * `offeredBps` is what the path was actually being asked to carry when the sample was taken, and
   * getting it wrong is the classic way to break a bonding engine: a path measured at 2 Mbps while
   * carrying 2 Mbps of a 6 Mbps stream has been shown to be AT LEAST a 2 Mbps path, not a 2 Mbps
   * path. `PathSample.atCapacity` is what keeps those apart, so pass it honestly.
   */
  observe(handle: string, sample: PathSample, identity: PathIdentity, offeredBps = 0): void {
    const record = this.records.get(handle) ?? this.create(handle, identity, sample.at);
    record.offeredBps = offeredBps;

    // The baseline is this path's own best round trip. Saturation cannot be judged against a fixed
    // number: 60 ms is excellent for cellular and poor for Ethernet.
    record.baselineRttMs =
      record.baselineRttMs === undefined ? sample.rttMs : Math.min(record.baselineRttMs, sample.rttMs);

    this.trimTransitions(record, sample.at);
    const context = {
      ...(record.baselineRttMs === undefined ? {} : { baselineRttMs: record.baselineRttMs }),
      recentTransitions: record.transitions.length,
    };
    const thresholds = this.options.thresholds ?? DEFAULT_THRESHOLDS;
    /*
     * FOR A MEDIA PATH, CARRYING TRAFFIC IS THE PROBE.
     *
     * The state machine will not put a path into service on measurements alone: it waits for
     * `probeSucceeded`, because a path the OS is offering has not been shown to reach the relay.
     * That is right for a path being discovered and wrong for the one the stream is already
     * flowing over — bytes arriving at the relay are a stronger proof of reachability than any
     * probe, and a monitor that ignored it would hold a working path in DISCOVERING forever and
     * report `offline` during a healthy broadcast.
     *
     * So the first sample with throughput on a pending path is the reachability result, and every
     * sample after that is a measurement. A pending path with NO throughput has still proven
     * nothing and stays pending, which is the honest reading of "we have not got through yet".
     */
    let state = record.path.state;
    if (isPending(state)) {
      if (sample.throughputBps <= 0) return;
      state = nextPathState(state, { kind: 'probeSucceeded' }, context, thresholds);
      this.transition(record, state, sample.at);
    }
    state = nextPathState(state, { kind: 'measured', sample }, context, thresholds);

    /*
     * The ceiling is what it is useful to BELIEVE about this path, not a link rate. Without one, a
     * path carrying a fraction of the stream reports an imaginary capacity and the policy engine
     * schedules traffic onto a path that was never shown to hold it.
     */
    const ceilingBps = Math.max(offeredBps * 2, sample.throughputBps * 2, 1);
    const capacity = estimateCapacity({
      ...(record.capacity ? { previous: record.capacity } : {}),
      sample,
      offeredBps,
      ceilingBps,
    });
    record.capacity = capacity;

    this.transition(record, state, sample.at);
    record.path = {
      ...record.path,
      state,
      sample,
      estimatedCapacityBps: capacity.bps,
      ...(identity.label ? { label: identity.label } : {}),
    };
  }

  /**
   * A path that is gone — an interface that disappeared, a socket that will not reopen.
   *
   * Distinct from a bad sample on purpose. A path measuring badly is a path the engine may still
   * choose to use; a path that has disappeared is not a decision, it is a fact, and the state
   * machine treats it as terminal rather than waiting for thresholds to agree.
   */
  lost(handle: string, at: number): void {
    const record = this.records.get(handle);
    if (!record) return;
    this.transition(record, nextPathState(record.path.state, { kind: 'disappeared' }, undefined), at);
    record.path = { ...record.path, state: 'FAILED' };
  }

  /** Forget a path entirely. Used when a broadcast ends, not when a path merely fails. */
  forget(handle: string): void {
    this.records.delete(handle);
  }

  /** Every path this monitor is tracking, in insertion order. */
  paths(): readonly NetworkPath[] {
    return Array.from(this.records.values(), (r) => r.path);
  }

  /**
   * What Bond thinks should happen right now.
   *
   * Hysteresis is why this is stateful: `decide` is given the previous decision and when it was
   * made, so a bond does not drop a path or change mode on a single noisy sample. A caller that
   * forgot to thread that through would get a correct-looking engine that flaps.
   */
  decide(
    streamBitrateBps: number,
    now: number,
    environment: { batteryLevel?: number; charging?: boolean; thermalPressure?: boolean } = {},
  ): BondDecision {
    const result = decide({
      paths: this.paths(),
      policy: this.options.policy ?? DEFAULT_BOND_POLICY,
      streamBitrateBps,
      now,
      ...(this.previous ? { previous: this.previous, previousAt: this.previousAt ?? now } : {}),
      ...(this.options.weights ? { weights: this.options.weights } : {}),
      ...(this.options.tuning ? { tuning: this.options.tuning } : {}),
      ...environment,
    });
    this.previous = result;
    this.previousAt = now;
    return result;
  }

  /** Drop everything, including the hysteresis history. Call between broadcasts, not during one. */
  reset(): void {
    this.records.clear();
    this.previous = undefined;
    this.previousAt = undefined;
  }

  private create(handle: string, identity: PathIdentity, at: number): PathRecord {
    const record: PathRecord = {
      path: {
        handle,
        transport: identity.transport,
        label: identity.label ?? handle,
        // DISCOVERING, not USABLE. A path that has just appeared has not been measured, and
        // starting it as healthy is how an engine schedules onto a path it knows nothing about.
        state: nextPathState('UNAVAILABLE', { kind: 'appeared' }),
        metered: identity.metered ?? 'unknown',
        independence: identity.independence ?? 'unknown',
        failureCount: 0,
        ...(identity.radio ? { radio: identity.radio } : {}),
      },
      transitions: [],
      offeredBps: 0,
    };
    void at;
    this.records.set(handle, record);
    return record;
  }

  private transition(record: PathRecord, next: PathState, at: number): void {
    if (next === record.path.state) return;
    record.transitions.push(at);
    // A path leaving health is a failure for scoring purposes, and the scorer's stability term is
    // the only thing that stops the engine returning to a path that has already let it down twice.
    if (next === 'FAILED' || next === 'UNSTABLE') {
      record.path = { ...record.path, failureCount: record.path.failureCount + 1, lastFailureAt: at };
    }
  }

  private trimTransitions(record: PathRecord, now: number): void {
    const window = this.options.flapWindowMs ?? DEFAULT_FLAP_WINDOW_MS;
    record.transitions = record.transitions.filter((t) => now - t <= window);
  }
}
