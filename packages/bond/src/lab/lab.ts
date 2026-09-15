/**
 * The Bond Lab: a deterministic simulation of several network paths under one broadcast.
 *
 * The mission asks for fifteen scenarios - Wi-Fi dies, cellular congests, one path goes lossy, the
 * battery drops - and every one of them is a story about TIME. A policy engine can be unit-tested
 * a decision at a time, but thrash, flapping and slow failover only exist across a sequence, and a
 * bonding engine's worst behaviours are all sequences. So this runs a virtual clock.
 *
 * The thing that makes this worth trusting: SIMULATED PATHS REACT TO LOAD. A path handed more than
 * it can carry does not politely report its configured numbers - its queue grows, its round trip
 * climbs, and past a point it loses packets, which is what a real bottleneck does and is exactly
 * the signal the engine uses to tell "full" from "broken". A lab that replays canned samples would
 * confirm whatever the engine already believed and prove nothing.
 *
 * What it is NOT: evidence about a real network. Nothing here has touched a radio. Section 50 of
 * the mission is unambiguous - never call simulation real - so every report this file produces is
 * stamped `simulated` and the docs say the same. It exists to make the engine's logic falsifiable,
 * not to stand in for a device test.
 */
import { classifySample, type PathThresholds, DEFAULT_THRESHOLDS } from '../path/stateMachine.js';
import { estimateCapacity, usefulCeilingFor, type CapacityEstimate } from '../path/capacity.js';
import { decide, type BondDecision, type BondTuning } from '../policy/decide.js';
import type { BondPolicy, MeteredState, NetworkPath, PathSample, PathState, PathTransport } from '../path/types.js';
import { DEFAULT_BOND_POLICY } from '../path/types.js';

/** How a simulated path behaves when nothing is wrong with it. */
export interface LinkProfile {
  /** What the link can actually carry, bits per second. */
  readonly capacityBps: number;
  /** Unloaded round trip, milliseconds. */
  readonly baseRttMs: number;
  /** Baseline variation, milliseconds. */
  readonly jitterMs: number;
  /** Loss with no congestion, 0..1. A clean link is 0. */
  readonly baseLoss: number;
  /** When true the link is down: no throughput, no replies. */
  readonly down?: boolean;
}

export interface LabPath {
  readonly handle: string;
  readonly transport: PathTransport;
  readonly label: string;
  readonly metered: MeteredState;
  readonly profile: LinkProfile;
}

/** A scheduled change to one link, applied when the clock reaches `atMs`. */
export interface LabEvent {
  readonly atMs: number;
  readonly handle: string;
  readonly change: Partial<LinkProfile>;
  /** Shown in the transcript so a reader can see what the scenario intended. */
  readonly note: string;
}

export interface LabScenario {
  readonly name: string;
  readonly paths: readonly LabPath[];
  readonly events?: readonly LabEvent[];
  readonly streamBitrateBps: number;
  readonly policy?: BondPolicy;
  readonly durationMs: number;
  /** How often the engine re-decides. Real monitors run around here. */
  readonly tickMs?: number;
  readonly batteryLevel?: number;
  readonly charging?: boolean;
  readonly thermalPressure?: boolean;
  readonly tuning?: Partial<BondTuning>;
  readonly thresholds?: PathThresholds;
}

export interface LabTick {
  readonly atMs: number;
  readonly decision: BondDecision;
  readonly states: Readonly<Record<string, PathState>>;
  /** Bits per second actually delivered to the relay this tick, summed over paths. */
  readonly deliveredBps: number;
  readonly notes: readonly string[];
}

export interface LabResult {
  readonly scenario: string;
  /** Always true. This is a simulation and it says so in its own output. */
  readonly simulated: true;
  readonly ticks: readonly LabTick[];
  /** Milliseconds during which less than 95% of the stream was getting through. */
  readonly starvedMs: number;
  /** The longest single run of starvation. This is what a viewer would see as a stall. */
  readonly longestStarveMs: number;
  /** How many times the set of carrying paths changed. High numbers mean thrash. */
  readonly reallocations: number;
  /** Health values observed, in order of first appearance. */
  readonly healthSeen: readonly BondDecision['health'][];
}

/** Deterministic noise. A lab whose results move between runs cannot be a gate. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32: small, fast, and good enough for jitter that only has to look uneven.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100_000) / 100_000;
  };
}

/**
 * What one link does with the load it was given this tick.
 *
 * Congestion is modelled as the textbook bottleneck: under capacity everything arrives at the base
 * round trip; over capacity the excess queues, delay grows with the overload ratio, and past a
 * modest overload the queue overflows and packets are lost. `atCapacity` is reported whenever the
 * link is being asked for essentially everything it has, because that single flag is how the
 * classifier separates a saturated path from a failing one.
 */
function simulateLink(profile: LinkProfile, offeredBps: number, random: () => number, at: number): PathSample {
  if (profile.down) {
    return {
      at,
      throughputBps: 0,
      rttMs: 0,
      jitterMs: 0,
      loss: 1,
      retransmitRate: 1,
      atCapacity: false,
    };
  }

  const capacity = profile.capacityBps;
  const load = capacity > 0 ? offeredBps / capacity : Infinity;
  const jitter = profile.jitterMs * (0.5 + random());

  if (load <= 0.9) {
    return {
      at,
      throughputBps: offeredBps,
      rttMs: profile.baseRttMs + jitter * 0.2,
      jitterMs: jitter,
      loss: profile.baseLoss,
      retransmitRate: profile.baseLoss,
      atCapacity: false,
    };
  }

  // Overloaded. Delay grows first (the queue), then loss (the queue overflows).
  const overload = Math.min(load, 3);
  const rtt = profile.baseRttMs * (1 + (overload - 0.9) * 2.5);
  const congestionLoss = load > 1.05 ? Math.min(0.4, (load - 1.05) * 0.5) : 0;
  return {
    at,
    throughputBps: Math.min(offeredBps, capacity),
    rttMs: rtt + jitter * 0.2,
    jitterMs: jitter * (1 + (overload - 0.9)),
    loss: Math.min(1, profile.baseLoss + congestionLoss),
    retransmitRate: Math.min(1, profile.baseLoss + congestionLoss),
    atCapacity: true,
  };
}

/**
 * Run a scenario.
 *
 * The loop is the real one in miniature: measure every path, classify it, ask the policy engine
 * what to do, apply that allocation to the links, and measure again next tick. Nothing here knows
 * anything the production engine does not, which is the property that makes the result meaningful.
 */
export function runScenario(scenario: LabScenario): LabResult {
  const tickMs = scenario.tickMs ?? 500;
  const thresholds = scenario.thresholds ?? DEFAULT_THRESHOLDS;
  const policy = scenario.policy ?? DEFAULT_BOND_POLICY;
  const random = makeRandom(0x11feed);

  const profiles = new Map<string, LinkProfile>(scenario.paths.map((p) => [p.handle, { ...p.profile }]));
  const states = new Map<string, PathState>(scenario.paths.map((p) => [p.handle, 'DISCOVERING']));
  const baselines = new Map<string, number>();
  const failures = new Map<string, number>(scenario.paths.map((p) => [p.handle, 0]));
  const transitions = new Map<string, number[]>(scenario.paths.map((p) => [p.handle, []]));
  const samples = new Map<string, PathSample>();
  const capacityEstimates = new Map<string, CapacityEstimate>();
  const ceiling = usefulCeilingFor(scenario.streamBitrateBps);

  const ticks: LabTick[] = [];
  let previous: BondDecision | undefined;
  let previousAt: number | undefined;
  let allocation = new Map<string, number>();
  let starvedMs = 0;
  let longestStarveMs = 0;
  let currentStarve = 0;
  let reallocations = 0;
  let lastCarrierSet = '';
  let hasCarried = false;
  const healthSeen: BondDecision['health'][] = [];

  for (let at = 0; at <= scenario.durationMs; at += tickMs) {
    const notes: string[] = [];
    for (const event of scenario.events ?? []) {
      if (event.atMs > at - tickMs && event.atMs <= at) {
        profiles.set(event.handle, { ...profiles.get(event.handle)!, ...event.change });
        notes.push(event.note);
      }
    }

    // 1. Measure every path under the load it is currently carrying.
    let deliveredBps = 0;
    for (const path of scenario.paths) {
      const profile = profiles.get(path.handle)!;
      const share = allocation.get(path.handle) ?? 0;
      const offered = share * scenario.streamBitrateBps;
      const sample = simulateLink(profile, offered, random, at);
      samples.set(path.handle, sample);
      deliveredBps += sample.throughputBps * (1 - sample.loss);

      /*
       * Capacity, through the same estimator the production monitor uses. The lab deliberately
       * does not have its own: an estimator that only exists in the simulator would be testing
       * itself, and this particular number is the one the whole engine reasons from.
       */
      capacityEstimates.set(
        path.handle,
        estimateCapacity({
          previous: capacityEstimates.get(path.handle),
          sample,
          offeredBps: offered,
          ceilingBps: ceiling,
        }),
      );

      if (!profile.down && (!baselines.has(path.handle) || sample.rttMs < baselines.get(path.handle)!)) {
        if (sample.rttMs > 0) baselines.set(path.handle, sample.rttMs);
      }
    }

    // 2. Classify. Flap detection needs a window, so transitions are kept with timestamps.
    for (const path of scenario.paths) {
      const sample = samples.get(path.handle)!;
      const profile = profiles.get(path.handle)!;
      const before = states.get(path.handle)!;
      const window = transitions.get(path.handle)!.filter((t) => at - t < 10_000);

      let next: PathState;
      if (profile.down) {
        next = 'FAILED';
      } else if (before === 'FAILED') {
        next = 'RECOVERING';
      } else if (before === 'DISCOVERING' || before === 'RECOVERING') {
        next = 'TESTING';
      } else if (before === 'TESTING') {
        next = 'HEALTHY';
      } else {
        next = classifySample(
          sample,
          { baselineRttMs: baselines.get(path.handle), recentTransitions: window.length },
          thresholds,
        );
      }

      if (next !== before) {
        window.push(at);
        transitions.set(path.handle, window);
        if (next === 'FAILED') failures.set(path.handle, (failures.get(path.handle) ?? 0) + 1);
      }
      states.set(path.handle, next);
    }

    // 3. Decide.
    const networkPaths: NetworkPath[] = scenario.paths.map((p) => ({
      handle: p.handle,
      transport: p.transport,
      label: p.label,
      state: states.get(p.handle)!,
      metered: p.metered,
      independence: 'observed',
      failureCount: failures.get(p.handle) ?? 0,
      estimatedCapacityBps: capacityEstimates.get(p.handle)?.bps,
      sample: samples.get(p.handle),
    }));

    const decision = decide({
      paths: networkPaths,
      policy,
      streamBitrateBps: scenario.streamBitrateBps,
      batteryLevel: scenario.batteryLevel,
      charging: scenario.charging ?? true,
      thermalPressure: scenario.thermalPressure,
      now: at,
      previous,
      previousAt,
      tuning: scenario.tuning,
    });

    // 4. Apply, and record.
    const carrierSet = decision.active
      .filter((a) => !a.standby)
      .map((a) => a.handle)
      .sort()
      .join(',');
    if (lastCarrierSet !== '' && carrierSet !== lastCarrierSet) reallocations += 1;
    lastCarrierSet = carrierSet;

    if (previous === undefined || carrierSet !== previous.active.filter((a) => !a.standby).map((a) => a.handle).sort().join(',')) {
      previousAt = at;
    }
    previous = decision;
    allocation = new Map(decision.active.map((a) => [a.handle, a.share]));

    if (!healthSeen.includes(decision.health)) healthSeen.push(decision.health);

    /*
     * Starvation is measured against what the ENCODER is producing, not against what the bond
     * decided to attempt. A bond that lowers its own target and then reports success against the
     * lowered target is the exact dishonesty section 49 forbids.
     */
    /*
     * Starvation is only counted once the bond has carried something at least once.
     *
     * A path takes two ticks to qualify - the OS offering it is not evidence it reaches the relay -
     * and during that window nothing is delivered because nothing has been scheduled yet. Counting
     * that as a stall would be measuring the warm-up rather than the broadcast; in the real product
     * GO LIVE waits for a qualified path, which is exactly what this models.
     */
    if (!hasCarried && deliveredBps > 0) hasCarried = true;
    const starved = deliveredBps < scenario.streamBitrateBps * 0.95;
    if (starved && hasCarried) {
      starvedMs += tickMs;
      currentStarve += tickMs;
      longestStarveMs = Math.max(longestStarveMs, currentStarve);
    } else {
      currentStarve = 0;
    }

    ticks.push({
      atMs: at,
      decision,
      states: Object.fromEntries(states) as Record<string, PathState>,
      deliveredBps,
      notes,
    });
  }

  return {
    scenario: scenario.name,
    simulated: true,
    ticks,
    starvedMs,
    longestStarveMs,
    reallocations,
    healthSeen,
  };
}

/** A readable transcript, for a report a person will actually look at. */
export function formatResult(result: LabResult): string {
  const lines: string[] = [
    `${result.scenario}  [SIMULATED - no radio was involved]`,
    '',
    '    time  health        mode        delivered  carrying',
  ];
  let lastSignature = '';
  for (const tick of result.ticks) {
    const carrying = tick.decision.active
      .filter((a) => !a.standby)
      .map((a) => `${a.handle} ${Math.round(a.share * 100)}%`)
      .join(', ');
    const signature = `${tick.decision.health}|${tick.decision.mode}|${carrying}`;
    const interesting = signature !== lastSignature || tick.notes.length > 0;
    if (interesting) {
      for (const note of tick.notes) lines.push(`  ${String(tick.atMs).padStart(6)}  -- ${note}`);
      lines.push(
        `  ${String(tick.atMs).padStart(6)}  ${tick.decision.health.padEnd(13)} ${tick.decision.mode.padEnd(11)} ` +
          `${(tick.deliveredBps / 1_000_000).toFixed(1).padStart(6)} Mbps  ${carrying || '(nothing)'}`,
      );
      lastSignature = signature;
    }
  }
  lines.push(
    '',
    `  starved ${result.starvedMs} ms total, longest run ${result.longestStarveMs} ms, ` +
      `${result.reallocations} reallocation(s)`,
  );
  return lines.join('\n');
}
