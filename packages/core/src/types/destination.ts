/**
 * Destination domain types.
 * A destination is one connected place a production can go live (YouTube channel, Twitch channel, custom RTMP...).
 */

export const DESTINATION_STATES = [
  'DISCONNECTED',
  'AUTHENTICATING',
  'READY',
  'STARTING',
  'LIVE',
  'DEGRADED',
  'RECONNECTING',
  'FAILED',
  'STOPPING',
  'ENDED',
] as const;

export type DestinationState = (typeof DESTINATION_STATES)[number];

/** Platform identifiers. `custom` is a generic RTMP/RTMPS/SRT/WHIP destination. */
export const PLATFORM_IDS = [
  'youtube',
  'twitch',
  'kick',
  'facebook',
  'instagram',
  'tiktok',
  'x',
  'linkedin',
  'custom',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

/** How a capability is provided for a platform (see docs/research/PLATFORM_CAPABILITY_MATRIX.md). */
export const CAPABILITY_CLASSES = [
  'NATIVE_API',
  'RTMP_DESTINATION',
  'OAUTH_API',
  'USER_ASSISTED',
  'PARTNER_APPROVAL_REQUIRED',
  'EXPERIMENTAL',
  'UNAVAILABLE',
] as const;

export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

export const CAPABILITY_KEYS = [
  'oauth',
  'pkce',
  'broadcastCreation',
  'streamCreation',
  'streamKey',
  'start',
  'stop',
  'metadata',
  'thumbnail',
  'chatRead',
  'chatWrite',
  'moderation',
  'analytics',
  'liveStatus',
  'scheduling',
  'vertical916',
  'rtmps',
  'srt',
  'whip',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityMatrix = Record<CapabilityKey, CapabilityClass>;

/** Classes that mean "LIVETAP can do this for the user automatically once connected". */
export const AUTOMATED_CLASSES: ReadonlySet<CapabilityClass> = new Set([
  'NATIVE_API',
  'OAUTH_API',
  'RTMP_DESTINATION',
]);

export function isAutomated(cls: CapabilityClass): boolean {
  return AUTOMATED_CLASSES.has(cls);
}

export type AspectRatio = '16:9' | '9:16' | '1:1';

export interface PlatformProfile {
  id: PlatformId;
  displayName: string;
  /** Short, honest one-liner about how connection works for this platform. */
  connectionSummary: string;
  capabilities: CapabilityMatrix;
  /** Aspect ratios the platform accepts for live ingest. */
  supportedAspectRatios: AspectRatio[];
  /** Preferred aspect ratio when the production is multi-format. */
  preferredAspectRatio: AspectRatio;
  /** Encoder recommendations (kbps). */
  recommended: {
    maxVideoKbps: number;
    minVideoKbps: number;
    audioKbps: number;
    keyframeIntervalSeconds: number;
    codecs: Array<'h264' | 'hevc' | 'av1'>;
    maxFps: number;
    maxHeight: number;
  };
  /** Whether the platform starts the broadcast automatically when data arrives. */
  autoStartsOnIngest: boolean;
  /** Eligibility / review notes surfaced to users honestly. */
  eligibilityNotes: string[];
  /** true when this profile is a mock (never masquerades as production). */
  mock?: boolean;
}

export interface IngestTarget {
  protocol: 'rtmp' | 'rtmps' | 'srt' | 'whip';
  url: string;
  /** Stream key or WHIP bearer token. Never logged. */
  streamKey?: string;
  /** For SRT. */
  passphrase?: string;
  streamId?: string;
}

export interface DestinationConfig {
  id: string;
  platform: PlatformId;
  /** Human label, e.g. channel name. */
  label: string;
  /** Account identifier on the platform (channel id, page id) — not a secret. */
  accountId?: string;
  avatarUrl?: string;
  /** Aspect ratio this destination should receive from the production. */
  aspectRatio: AspectRatio;
  /** For custom destinations the ingest is user-supplied. For OAuth platforms it is fetched by the adapter. */
  ingest?: IngestTarget;
  /** Broadcast metadata to publish when supported. */
  metadata?: BroadcastMetadata;
  /** Whether this destination is enabled for the next GO LIVE. */
  enabled: boolean;
  /** Provider is a mock (development/demo). */
  mock: boolean;
}

export interface BroadcastMetadata {
  title?: string;
  description?: string;
  category?: string;
  privacy?: 'public' | 'unlisted' | 'private';
  thumbnailDataUrl?: string;
  latency?: 'normal' | 'low' | 'ultraLow';
}

export interface DestinationHealth {
  /** Outbound bitrate as measured at the sender (kbps). */
  bitrateKbps: number;
  /** Frames dropped due to network in the last window. */
  droppedFramesPct: number;
  /** Round trip / ingest latency estimate, ms. */
  rttMs?: number;
  /** Platform-reported viewers when available. */
  viewers?: number;
  /** Platform-reported ingest health when available. */
  platformStatus?: 'good' | 'ok' | 'bad' | 'noData';
  updatedAt: number;
}

export interface DestinationSnapshot {
  config: DestinationConfig;
  state: DestinationState;
  /** Humane error explaining the current FAILED/DEGRADED/RECONNECTING state. */
  error?: HumaneError;
  health?: DestinationHealth;
  /** Public watch URL once live (if the platform provides one). */
  watchUrl?: string;
  /** Reconnect attempt counter (resets on LIVE). */
  reconnectAttempt: number;
  /** Maximum attempts the current policy allows (for "attempt 2 of 10"). */
  reconnectMaxAttempts?: number;
  /** When the next reconnect attempt fires (epoch ms) while RECONNECTING. */
  nextRetryAt?: number;
  /** Timestamp of last state change. */
  stateChangedAt: number;
  /** Platform broadcast identifiers (never secrets). */
  broadcastId?: string;
  streamId?: string;
}

/**
 * Humane error: WHAT happened, WHY, what LIVETAP IS DOING, what YOU CAN do.
 * Never surface raw protocol errors to Simple Mode users.
 */
export interface HumaneError {
  code: ErrorCode;
  what: string;
  why: string;
  doing: string;
  youCan: string;
  /** Raw technical detail for Pro Mode diagnostics. Must not contain secrets. */
  technical?: string;
  recoverable: boolean;
}

export const ERROR_CODES = [
  'AUTH_EXPIRED',
  'AUTH_REVOKED',
  'AUTH_MISSING_SCOPE',
  'AUTH_FAILED',
  'NOT_ELIGIBLE',
  'INGEST_REFUSED',
  'INGEST_DISCONNECTED',
  'INGEST_TIMEOUT',
  'INGEST_INVALID_KEY',
  'NETWORK_OFFLINE',
  'NETWORK_DEGRADED',
  'ENCODER_FAILED',
  'ENCODER_OVERLOADED',
  'CAMERA_LOST',
  'MIC_LOST',
  'SCREEN_DENIED',
  'DISK_FULL',
  'RECORDING_FAILED',
  'PLATFORM_ERROR',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'CONFIG_INVALID',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
