/**
 * What a network path is, and - more importantly - what it is not.
 *
 * The single most expensive mistake available in this layer is counting radios instead of routes.
 * A phone showing a Wi-Fi icon and a 5G icon does not necessarily have two usable Internet paths:
 * it has two radios, and whether those become two independently routable paths is decided by the
 * operating system, the carrier, the access point and the NAT in between. 2.4 GHz and 5 GHz on one
 * access point are one path wearing two hats. A dual-SIM handset may or may not be able to hold
 * two data sessions at once. LTE and 5G on one SIM are usually one path, negotiated by the modem.
 *
 * So this module models two different things:
 *
 *   PATH   a route to the Internet that the OS has handed us a distinct, bindable handle for, and
 *          that we have independently confirmed reaches the relay.
 *   RADIO  the hardware underneath, which is diagnostic colour and never, by itself, a path.
 *
 * `NetworkPath` therefore cannot be built out of a radio. It requires a `handle` - whatever the
 * platform's identity for a bindable network is - and it carries `independence`, which records how
 * hard we have actually checked, because "the OS gave us two handles" is a much weaker claim than
 * "packets sent on these two handles took different routes".
 */

/** The transport class underneath a path. Diagnostic and policy input, never an identity. */
export type PathTransport = 'wifi' | 'cellular' | 'ethernet' | 'usb' | 'other';

/**
 * How confident we are that this path is genuinely separate from the others.
 *
 * This exists because the product is forbidden to claim bonding it does not have. A UI that says
 * "protected by 5G" when both paths egress through the same congested tower is worse than one that
 * says nothing: the creator relaxes about a risk that is entirely still there.
 */
export type PathIndependence =
  /** The OS gave us a distinct bindable handle. That is all we know. */
  | 'declared'
  /** Distinct handle, and the relay saw our packets arrive from a different public address. */
  | 'observed'
  /** Distinct handle, same public egress address. Almost certainly the same uplink. */
  | 'shared'
  /** Not checked yet. */
  | 'unknown';

/**
 * The lifecycle of one path (mission section 14).
 *
 * `TESTING` is deliberately distinct from `DISCOVERING`: the OS telling us a network exists and
 * that network actually carrying our media to the relay are different facts, and a path that has
 * not passed the second test must never be given a share of a live broadcast.
 *
 * `SATURATED` is distinct from `DEGRADED` because the correct response differs. A degraded path is
 * unwell and should be given less. A saturated path is healthy and simply full, and taking traffic
 * away from it is exactly wrong unless something else has spare capacity to take.
 */
export type PathState =
  | 'UNAVAILABLE'
  | 'DISCOVERING'
  | 'TESTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'SATURATED'
  | 'UNSTABLE'
  | 'FAILED'
  | 'RECOVERING';

/** Whether traffic on this path costs the creator money. */
export type MeteredState = 'unmetered' | 'metered' | 'unknown';

/**
 * What the OS said about a candidate network, before we have tested anything ourselves.
 *
 * Platform discovery services - Android's ConnectivityManager, a desktop interface enumeration -
 * produce these. Nothing here is trusted as a capability: `hasInternet` is the OS's opinion, and a
 * path does not leave `TESTING` on the strength of an opinion.
 */
export interface PathCandidate {
  /** Stable within a session. The platform's own identity for a bindable network. */
  readonly handle: string;
  readonly transport: PathTransport;
  /** A short human name, for Pro mode only. Never shown in simple mode. */
  readonly label: string;
  /** The OS claims this network routes to the Internet. */
  readonly hasInternet: boolean;
  /** The OS claims it has verified that itself (Android's NET_CAPABILITY_VALIDATED). */
  readonly validated: boolean;
  readonly metered: MeteredState;
  /**
   * Radio detail, for diagnostics ONLY: Wi-Fi band, cellular generation, signal bars.
   *
   * Deliberately opaque, and deliberately not read by anything in the policy engine. Section 8 of
   * the mission is explicit that band information is diagnostic data and not automatically a bond
   * path; the way to guarantee that is to keep it out of the types the engine can see.
   */
  readonly radio?: Readonly<Record<string, string | number>>;
}

/** One live measurement of a path. Produced by the monitor, consumed by the scorer. */
export interface PathSample {
  /** Milliseconds on a monotonic clock. */
  readonly at: number;
  /** Measured goodput in bits per second. Never a link-rate guess. */
  readonly throughputBps: number;
  /** Round trip to the relay, milliseconds. */
  readonly rttMs: number;
  /** Variation in inter-arrival time, milliseconds. */
  readonly jitterMs: number;
  /** Fraction lost, 0..1. */
  readonly loss: number;
  /** Fraction of sent packets that had to be sent again, 0..1. */
  readonly retransmitRate: number;
  /**
   * True when this sample was taken while the path was being asked for everything it had.
   *
   * A path measured at 2 Mbps while carrying 2 Mbps of a 6 Mbps stream has not been shown to be a
   * 2 Mbps path. It has been shown to be AT LEAST a 2 Mbps path. Conflating those two is how a
   * bonding engine talks itself into believing that capacity vanished, and then removes a path
   * that was never in trouble.
   */
  readonly atCapacity: boolean;
}

/** Everything known about one path right now. */
export interface NetworkPath {
  readonly handle: string;
  readonly transport: PathTransport;
  readonly label: string;
  readonly state: PathState;
  readonly metered: MeteredState;
  readonly independence: PathIndependence;
  /** Most recent measurement, or undefined before the first one. */
  readonly sample?: PathSample;
  /**
   * Smoothed capacity estimate in bits per second, or undefined before we have one.
   *
   * Separate from `sample.throughputBps` because the scheduler must not chase a single noisy
   * reading, and because a path that is not being pushed reports a throughput that says nothing
   * about what it could carry if it were.
   */
  readonly estimatedCapacityBps?: number;
  /** How many times this path has failed this session. Feeds the scorer's stability term. */
  readonly failureCount: number;
  /** When it last left a healthy state, for recovery backoff. */
  readonly lastFailureAt?: number;
  readonly radio?: Readonly<Record<string, string | number>>;
}

/**
 * The product's four network modes (mission section 10), smallest commitment first.
 *
 * These are a policy INPUT, not a description of what is happening. Asking for `aggregated` on a
 * device with one usable path yields one path carrying everything, and the engine says so rather
 * than pretending. What the engine actually decided is reported separately as `BondDecision.mode`.
 */
export type BondMode =
  /** One path, the best one. Cheapest in battery and data. */
  | 'single'
  /** One path carries the stream; a second stays warm for instant failover. */
  | 'protected'
  /** The engine decides, continuously, from conditions. The default. */
  | 'adaptive'
  /** Combine paths to maximise usable upload capacity. */
  | 'aggregated';

/** What the creator has permitted. Cost and battery are the creator's call, never the engine's. */
export interface BondPolicy {
  readonly mode: BondMode;
  /** May cellular be used to protect a stream that is otherwise fine? */
  readonly useCellularForProtection: boolean;
  /** May metered paths carry a full share of an aggregated stream? Off unless asked for. */
  readonly allowAggregationOnMetered: boolean;
  /** Hard ceiling on metered bytes for one broadcast, or undefined for none. */
  readonly meteredBudgetBytes?: number;
}

/** What a creator who has never opened a settings screen gets (sections 11 and 52). */
export const DEFAULT_BOND_POLICY: BondPolicy = {
  mode: 'adaptive',
  useCellularForProtection: true,
  allowAggregationOnMetered: false,
};
