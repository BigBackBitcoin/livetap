export type HealthLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical' | 'unknown';

export interface EngineMetrics {
  /** Encoder output bitrate (kbps) for the primary format. */
  encodedKbps: number;
  targetKbps: number;
  /** Frames the encoder failed to produce on time (render/encode lag). */
  encoderDroppedPct: number;
  /** Frames dropped by the network sender across all outputs (max). */
  networkDroppedPct: number;
  /** Render/composite fps achieved. */
  renderFps: number;
  targetFps: number;
  cpuPct?: number;
  gpuPct?: number;
  memoryMb?: number;
  /** Estimated glass-to-ingest latency ms if known. */
  latencyMs?: number;
  /**
   * What Bond makes of the network carrying this broadcast, or undefined when nothing is being
   * published and there is therefore nothing to judge.
   *
   * PER CONNECTION, NOT PER DESTINATION, and the distinction is load-bearing. A destination is
   * unhealthy when that platform is refusing or falling behind; the CONNECTION is unhealthy when
   * the path to the relay cannot carry the stream. With one media session fanning out to many
   * destinations, those have completely different blast radii — one destination failing is
   * isolated, the connection failing takes everything with it — and a UI that showed one for the
   * other would either panic a creator or reassure them wrongly.
   */
  connectionHealth?: ConnectionHealth;
  /**
   * The bitrate Bond says the network can actually carry, kbps. Advice, not a command.
   *
   * It exists so a broadcast running out of room asks the encoder to come down rather than letting
   * the stream die, and so that request is visible instead of happening silently.
   */
  recommendedKbps?: number;
  updatedAt: number;
}

/**
 * How the network carrying a broadcast is doing.
 *
 * Declared here rather than imported from `@livetap/bond` so that core stays dependency-free and
 * the web bundle never reaches the bonding package's Node surface by accident. It is the same
 * union as `BondHealth`, and a type-level assertion in the media package fails the build if the
 * two ever drift.
 */
export type ConnectionHealth =
  /** Comfortably more capacity than the stream needs. */
  | 'excellent'
  /** Enough capacity, and a second path is standing by or helping. */
  | 'protected'
  /** Carrying the stream, but with no margin, or on a path that is unwell. */
  | 'degraded'
  /** The path cannot carry this bitrate. The encoder has to come down. */
  | 'insufficient'
  /** Nothing usable at all. */
  | 'offline';

export interface HealthAssessment {
  level: HealthLevel;
  /** Beginner-facing headline, e.g. "Stream is healthy". */
  headline: string;
  /** Beginner-facing detail with an action if needed. */
  detail: string;
  /** Pro-facing reasons (metric names + values). */
  reasons: string[];
  /** Suggested automatic adaptation, if any. */
  suggestion?: 'lowerBitrate' | 'lowerResolution' | 'lowerFps' | 'switchEncoder' | 'none';
}
