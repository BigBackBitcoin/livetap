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
  updatedAt: number;
}

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
