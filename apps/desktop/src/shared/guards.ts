/**
 * Hand-written runtime type guards for every IPC payload.
 *
 * These are the ONLY thing standing between a compromised renderer and the main process, so:
 *  - no `any`, no casts that skip checking, no schema library we would have to trust;
 *  - anything that is not a plain object is rejected (null, arrays, functions, primitives);
 *  - prototype-polluting keys are rejected outright;
 *  - strings are length-capped and, where they name a resource, charset-restricted;
 *  - numbers must be finite and inside the range the engine can actually honour.
 *
 * Every guard is pure and unit-tested, so the security surface is testable without Electron.
 */

import type { AspectRatio, IngestTarget } from '@livetap/core';
import type { EncoderSettings, OutputFormat, RecordingSettings } from '@livetap/core';
import type {
  DesktopEngineOutput,
  DesktopStartRequest,
  RecoverySnapshot,
  VaultSetRequest,
} from './ipc.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_SECRET_BYTES = 8192;
export const MAX_ID_LENGTH = 128;
export const MAX_URL_LENGTH = 2048;
export const MAX_OUTPUTS = 32;

/** True only for a plain object: not null, not an array, no prototype-polluting own keys. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return false;
  }
  return true;
}

export function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}

/**
 * Vault ids become filenames-in-a-JSON-map keys and appear in logs, so they are restricted to a
 * conservative charset. No path separators, no dots that could walk a directory, no whitespace.
 */
const VAULT_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;

export function isVaultId(value: unknown): value is string {
  return typeof value === 'string' && VAULT_ID_RE.test(value);
}

export function isVaultSetRequest(value: unknown): value is VaultSetRequest {
  if (!isRecord(value)) return false;
  if (!isVaultId(value.id)) return false;
  if (typeof value.secret !== 'string' || value.secret.length === 0) return false;
  if (Buffer.byteLength(value.secret, 'utf8') > MAX_SECRET_BYTES) return false;
  return true;
}

/**
 * Relative paths for `system.openPath`. Must stay inside userData/recordings: no absolute paths,
 * no drive letters, no UNC prefixes, no `..` segments, no NUL bytes.
 */
export function isSafeRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value, 512)) return false;
  if (value.includes('\0')) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  // Split WITHOUT collapsing runs of separators, so `a//b` is rejected for its empty segment.
  const segments = value.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === '..' || segment === '.') return false;
    if (segment.length === 0) return false;
  }
  return true;
}

/** `oauth.openExternal` accepts https: only — never file:, never custom schemes. */
export function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, MAX_URL_LENGTH)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  // An https URL with no host ("HTTPS:/malformed") parses fine but is meaningless, and would be
  // handed straight to shell.openExternal. Require a real hostname.
  return parsed.protocol === 'https:' && parsed.hostname.length > 0;
}

const PROTOCOLS: readonly IngestTarget['protocol'][] = ['rtmp', 'rtmps', 'srt', 'whip'];

export function isIngestTarget(value: unknown): value is IngestTarget {
  if (!isRecord(value)) return false;
  if (typeof value.protocol !== 'string') return false;
  if (!(PROTOCOLS as readonly string[]).includes(value.protocol)) return false;
  if (!isNonEmptyString(value.url, MAX_URL_LENGTH)) return false;
  if (value.streamKey !== undefined && !isNonEmptyString(value.streamKey, 1024)) return false;
  if (value.passphrase !== undefined && !isNonEmptyString(value.passphrase, 1024)) return false;
  if (value.streamId !== undefined && !isNonEmptyString(value.streamId, 512)) return false;
  return true;
}

const DESTINATION_ID_RE = /^[A-Za-z0-9_:-]{1,128}$/;

export function isDestinationId(value: unknown): value is string {
  return typeof value === 'string' && DESTINATION_ID_RE.test(value);
}

export function isEngineOutput(value: unknown): value is DesktopEngineOutput {
  if (!isRecord(value)) return false;
  if (!isDestinationId(value.destinationId)) return false;
  if (!isAspectRatio(value.aspectRatio)) return false;
  if (!isIngestTarget(value.ingest)) return false;
  return true;
}

const CODECS = ['h264', 'hevc', 'av1'] as const;
const FPS_VALUES = [24, 30, 60] as const;

export function isOutputFormat(value: unknown): value is OutputFormat {
  if (!isRecord(value)) return false;
  if (!isAspectRatio(value.aspectRatio)) return false;
  if (!isFiniteNumber(value.width, 128, 7680) || !Number.isInteger(value.width)) return false;
  if (!isFiniteNumber(value.height, 128, 4320) || !Number.isInteger(value.height)) return false;
  if (typeof value.fps !== 'number' || !(FPS_VALUES as readonly number[]).includes(value.fps)) return false;
  if (!isFiniteNumber(value.videoKbps, 200, 60000)) return false;
  if (!isFiniteNumber(value.audioKbps, 32, 512)) return false;
  if (typeof value.codec !== 'string' || !(CODECS as readonly string[]).includes(value.codec)) return false;
  if (!isFiniteNumber(value.keyframeIntervalSeconds, 1, 10)) return false;
  return true;
}

const PREFERENCES = ['auto', 'software', 'nvenc', 'qsv', 'amf', 'videotoolbox', 'webcodecs'] as const;
const SOFTWARE_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'] as const;
const RATE_CONTROLS = ['cbr', 'vbr'] as const;

export function isEncoderSettings(value: unknown): value is EncoderSettings {
  if (!isRecord(value)) return false;
  if (typeof value.preference !== 'string' || !(PREFERENCES as readonly string[]).includes(value.preference)) {
    return false;
  }
  if (
    typeof value.softwarePreset !== 'string' ||
    !(SOFTWARE_PRESETS as readonly string[]).includes(value.softwarePreset)
  ) {
    return false;
  }
  if (typeof value.rateControl !== 'string' || !(RATE_CONTROLS as readonly string[]).includes(value.rateControl)) {
    return false;
  }
  return true;
}

const CONTAINERS = ['mp4', 'mkv', 'webm'] as const;

export function isRecordingSettings(value: unknown): value is RecordingSettings {
  if (!isRecord(value)) return false;
  if (!isBoolean(value.enabled)) return false;
  if (typeof value.container !== 'string' || !(CONTAINERS as readonly string[]).includes(value.container)) {
    return false;
  }
  if (value.source !== 'program') return false;
  if (value.directory !== undefined && !isNonEmptyString(value.directory, 1024)) return false;
  return true;
}

function isSource(value: unknown): value is DesktopStartRequest['source'] {
  if (!isRecord(value)) return false;
  if (value.kind === 'pipe') return isNonEmptyString(value.mimeType, 256);
  if (value.kind === 'lavfi') {
    return value.durationSeconds === undefined || isFiniteNumber(value.durationSeconds, 1, 86400);
  }
  return false;
}

export function isStartRequest(value: unknown): value is DesktopStartRequest {
  if (!isRecord(value)) return false;
  if (!isSource(value.source)) return false;
  if (!isEncoderSettings(value.encoder)) return false;
  if (!isRecordingSettings(value.recording)) return false;

  if (!isRecord(value.formats)) return false;
  let formatCount = 0;
  for (const [key, format] of Object.entries(value.formats)) {
    if (!isAspectRatio(key)) return false;
    if (format === undefined) continue;
    if (!isOutputFormat(format)) return false;
    if (format.aspectRatio !== key) return false;
    formatCount += 1;
  }
  if (formatCount === 0) return false;

  if (!Array.isArray(value.outputs)) return false;
  if (value.outputs.length > MAX_OUTPUTS) return false;
  const seen = new Set<string>();
  for (const output of value.outputs) {
    if (!isEngineOutput(output)) return false;
    if (seen.has(output.destinationId)) return false;
    seen.add(output.destinationId);
    // Every output must have a format for its aspect ratio, or there is nothing to feed it.
    const formats = value.formats as Record<string, unknown>;
    if (formats[output.aspectRatio] === undefined) return false;
  }
  return true;
}

export function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.startedAt, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (!isFiniteNumber(value.updatedAt, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (!isAspectRatio(value.masterAspectRatio)) return false;
  if (!isNonEmptyString(value.qualityPreset, 64)) return false;
  if (!isBoolean(value.recording)) return false;
  if (value.momentId !== null && !isNonEmptyString(value.momentId, 128)) return false;
  if (!Array.isArray(value.destinationIds)) return false;
  if (value.destinationIds.length > MAX_OUTPUTS) return false;
  for (const id of value.destinationIds) {
    if (!isDestinationId(id)) return false;
  }
  return true;
}

/** `engine:chunk` carries an ArrayBuffer (or a view of one after structured clone). */
export function isChunkPayload(value: unknown): value is { aspectRatio: AspectRatio; data: ArrayBufferLike } {
  if (!isRecord(value)) return false;
  if (!isAspectRatio(value.aspectRatio)) return false;
  const data = value.data;
  if (data instanceof ArrayBuffer) return data.byteLength > 0 && data.byteLength <= 64 * 1024 * 1024;
  if (data instanceof Uint8Array) return data.byteLength > 0 && data.byteLength <= 64 * 1024 * 1024;
  return false;
}
