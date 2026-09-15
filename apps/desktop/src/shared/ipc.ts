/**
 * The complete IPC contract between the LIVETAP renderer and the Electron main process.
 *
 * Rules enforced by design here:
 *  - every channel is an explicit named constant; the preload exposes ONE function per channel
 *    (no generic `invoke(channel, ...)` escape hatch that the renderer could aim anywhere);
 *  - every payload type has a hand-written type guard in `./guards.ts` that main runs before
 *    touching the value. Guards never use `any` and reject non-objects, arrays where an object is
 *    expected, prototype-polluting keys, and out-of-range numbers;
 *  - nothing that crosses this boundary carries a secret except `vault:set`, whose value is
 *    immediately encrypted by `safeStorage` and never echoed back in logs or events.
 */

import type { AspectRatio, ErrorCode, IngestTarget } from '@livetap/core';
import type { EncoderSettings, OutputFormat, RecordingSettings } from '@livetap/core';
import type { EngineCapabilities, EngineMetrics } from '@livetap/core';

/** Channel names. `livetap:` prefixed so they can never collide with Electron internals. */
export const CH = {
  engineCapabilities: 'livetap:engine:capabilities',
  engineStart: 'livetap:engine:start',
  engineAddOutput: 'livetap:engine:addOutput',
  engineRemoveOutput: 'livetap:engine:removeOutput',
  engineStop: 'livetap:engine:stop',
  engineStartRecording: 'livetap:engine:startRecording',
  engineStopRecording: 'livetap:engine:stopRecording',
  /** Renderer → main: one MediaRecorder chunk (ArrayBuffer). Fire-and-forget, high frequency. */
  engineChunk: 'livetap:engine:chunk',
  /** Renderer → main: the renderer's media stream ended; flush the encoder. */
  engineEndOfStream: 'livetap:engine:endOfStream',
  /** Main → renderer: engine events (metrics, output up/down, recording, engineError). */
  engineEvent: 'livetap:engine:event',

  vaultSet: 'livetap:vault:set',
  vaultGet: 'livetap:vault:get',
  vaultDelete: 'livetap:vault:delete',
  vaultList: 'livetap:vault:list',

  oauthStartLoopback: 'livetap:oauth:startLoopback',
  oauthWaitForCallback: 'livetap:oauth:waitForCallback',
  oauthOpenExternal: 'livetap:oauth:openExternal',
  /** Main → renderer: a `livetap://` deep link arrived (second-instance or protocol open). */
  oauthDeepLink: 'livetap:oauth:deepLink',

  systemInfo: 'livetap:system:info',
  systemChooseDirectory: 'livetap:system:chooseDirectory',
  systemOpenPath: 'livetap:system:openPath',

  recoveryGet: 'livetap:recovery:get',
  recoveryClear: 'livetap:recovery:clear',
  /** Renderer → main: the live-session snapshot to persist (no secrets). */
  recoveryUpdate: 'livetap:recovery:update',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];

/* ------------------------------------------------------------------ engine */

export interface DesktopEngineOutput {
  destinationId: string;
  aspectRatio: AspectRatio;
  ingest: IngestTarget;
  /**
   * Send this destination through LIVETAP Bond instead of straight out as RTMP.
   *
   * Optional, and absent means exactly today's behaviour: one `ffmpeg -c copy` child per
   * destination, pushing RTMP from this machine. When set, the same TS bytes go to a Bond session
   * and the relay performs the RTMP - which is what lets one uplink serve several destinations, and
   * what multipath needs in order to exist at all.
   *
   * Per destination rather than per broadcast on purpose: a Bond destination and a direct one can
   * run side by side in the same broadcast, which makes them directly comparable and means turning
   * Bond on can never be all-or-nothing.
   */
  viaBond?: boolean;
}

/**
 * What the renderer hands main to go live.
 *
 * `source` describes where the encoder gets its input:
 *  - `pipe`  — the renderer pushes MediaRecorder chunks over `engine:chunk` (production path);
 *  - `lavfi` — main synthesises a test pattern (used by scripts/verify-engine.ts and diagnostics;
 *              the renderer never asks for it in normal operation, but it is a legal request so the
 *              engine can be exercised headlessly).
 */
export interface DesktopStartRequest {
  source: { kind: 'pipe'; mimeType: string } | { kind: 'lavfi'; durationSeconds?: number };
  /** Formats keyed by aspect ratio. One encoder process is started per defined entry. */
  formats: Partial<Record<AspectRatio, OutputFormat>>;
  outputs: DesktopEngineOutput[];
  encoder: EncoderSettings;
  recording: RecordingSettings;
}

export type DesktopEngineEvent =
  | { type: 'metrics'; payload: EngineMetrics }
  | { type: 'outputUp'; destinationId: string }
  | { type: 'outputDegraded'; destinationId: string; technical?: string }
  | { type: 'outputRecovered'; destinationId: string }
  | { type: 'outputLost'; destinationId: string; code: ErrorCode; technical?: string }
  | { type: 'outputStopped'; destinationId: string }
  | { type: 'engineError'; code: ErrorCode; technical?: string }
  | { type: 'recording'; state: 'started' | 'stopped' | 'failed'; path?: string; code?: ErrorCode };

export interface EngineChunkMessage {
  /** Which format/encoder this chunk belongs to. */
  aspectRatio: AspectRatio;
  /** Raw MediaRecorder bytes. Transferred as an ArrayBuffer, never a string. */
  data: ArrayBuffer;
}

/* ------------------------------------------------------------------- vault */

export interface VaultSetRequest {
  /** Opaque caller-chosen id, e.g. `oauth:youtube:UC123` or `ingest:dest-7`. Restricted charset. */
  id: string;
  /** The secret. Encrypted with safeStorage before it ever reaches disk. */
  secret: string;
}

export interface VaultResult {
  ok: boolean;
  /** Present only for `vault:get`. */
  secret?: string;
  /** Machine-readable reason when `ok` is false. */
  reason?: 'ENCRYPTION_UNAVAILABLE' | 'NOT_FOUND' | 'INVALID_ID' | 'IO_ERROR' | 'TOO_LARGE';
}

/* ------------------------------------------------------------------- oauth */

export interface LoopbackInfo {
  /** e.g. `http://127.0.0.1:53871/callback` — hand this to the provider as redirect_uri. */
  redirectUri: string;
  port: number;
  /** Random value the main process expects back as `state`; the renderer must forward it. */
  state: string;
}

/* ------------------------------------------------------------------ system */

export interface SystemInfo {
  platform: NodeJS.Platform;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  /** Absolute path of the sandboxed recordings directory (inside userData). */
  recordingsDir: string;
}

/* ---------------------------------------------------------------- recovery */

/** Crash-recovery snapshot. Deliberately contains NO ingest URLs, keys, or tokens. */
export interface RecoverySnapshot {
  startedAt: number;
  updatedAt: number;
  /** Destination ids that were live, so the renderer can re-offer them by id. */
  destinationIds: string[];
  masterAspectRatio: AspectRatio;
  qualityPreset: string;
  recording: boolean;
  momentId: string | null;
}

/* --------------------------------------------------------- renderer facade */

/** The exact shape `window.livetap` has. Mirrored by the preload implementation. */
export interface LivetapApi {
  engine: {
    capabilities(): Promise<EngineCapabilities>;
    start(req: DesktopStartRequest): Promise<{ ok: boolean; errors?: string[] }>;
    addOutput(output: DesktopEngineOutput): Promise<{ ok: boolean; errors?: string[] }>;
    removeOutput(destinationId: string): Promise<{ ok: boolean }>;
    stop(): Promise<{ ok: boolean }>;
    startRecording(settings: RecordingSettings): Promise<{ ok: boolean; path?: string; errors?: string[] }>;
    stopRecording(): Promise<{ ok: boolean; path?: string }>;
    /** Push one encoded chunk from the renderer's MediaRecorder into the main-process muxer. */
    pushChunk(aspectRatio: AspectRatio, data: ArrayBuffer): void;
    endOfStream(aspectRatio: AspectRatio): void;
    onEvent(cb: (event: DesktopEngineEvent) => void): () => void;
  };
  vault: {
    set(id: string, secret: string): Promise<VaultResult>;
    get(id: string): Promise<VaultResult>;
    delete(id: string): Promise<VaultResult>;
    list(): Promise<string[]>;
  };
  oauth: {
    startLoopback(options?: { host?: 'localhost' | '127.0.0.1' }): Promise<LoopbackInfo>;
    waitForCallback(): Promise<string>;
    openExternal(url: string): Promise<{ ok: boolean }>;
    onDeepLink(cb: (url: string) => void): () => void;
  };
  system: {
    info(): Promise<SystemInfo>;
    chooseDirectory(): Promise<{ path?: string }>;
    openPath(relativePath: string): Promise<{ ok: boolean }>;
  };
  recovery: {
    get(): Promise<RecoverySnapshot | null>;
    clear(): Promise<{ ok: boolean }>;
    update(snapshot: RecoverySnapshot): void;
  };
}
