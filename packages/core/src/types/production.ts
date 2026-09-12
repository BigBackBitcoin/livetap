import type { AspectRatio } from './destination.js';

export type VideoCodec = 'h264' | 'hevc' | 'av1';
export type EncoderPreference = 'auto' | 'software' | 'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'webcodecs';

export interface OutputFormat {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  videoKbps: number;
  audioKbps: number;
  codec: VideoCodec;
  keyframeIntervalSeconds: number;
}

/** Simple-mode quality presets resolve to OutputFormat per aspect ratio. */
export type QualityPreset = 'auto' | '720p30' | '1080p30' | '1080p60';

export interface RecordingSettings {
  enabled: boolean;
  /** Directory on desktop; on web/mobile handled by the engine (IndexedDB / share sheet). */
  directory?: string;
  container: 'mp4' | 'mkv' | 'webm';
  /** Record the program output (shared encode) — never a second encode by default. */
  source: 'program';
}

export interface EncoderSettings {
  preference: EncoderPreference;
  /** x264 style preset name for software encoding. */
  softwarePreset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
  /** Rate control mode. */
  rateControl: 'cbr' | 'vbr';
}

export interface ProductionSettings {
  /** Master canvas aspect ratio (what the creator composes in). */
  masterAspectRatio: AspectRatio;
  qualityPreset: QualityPreset;
  /** Explicit per-aspect formats (Pro). If absent, derived from qualityPreset. */
  formats?: Partial<Record<AspectRatio, OutputFormat>>;
  encoder: EncoderSettings;
  recording: RecordingSettings;
  /** Reconnect policy for destinations. */
  reconnect: ReconnectPolicy;
}

export interface ReconnectPolicy {
  enabled: boolean;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: number; // 0..1
}

export const PRODUCTION_STATES = ['IDLE', 'PREVIEW', 'STARTING', 'LIVE', 'STOPPING'] as const;
export type ProductionState = (typeof PRODUCTION_STATES)[number];

export interface ProductionSnapshot {
  state: ProductionState;
  activeMomentId: string | null;
  startedAt?: number;
  /** Live destination count vs total enabled. */
  liveCount: number;
  enabledCount: number;
  recording: boolean;
}
