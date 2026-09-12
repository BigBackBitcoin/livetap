/**
 * Pure parsers for what ffmpeg writes to stderr.
 *
 * Both the encoder and every sender run with `-progress pipe:2 -stats_period 1`, so stderr carries
 * two interleaved kinds of line:
 *   - machine progress blocks: `key=value` lines terminated by `progress=continue` / `progress=end`
 *   - ordinary log lines at `-loglevel error`, e.g. `rtmp://...: Broken pipe`
 *
 * The parser is line-buffered (a chunk can split a line anywhere), allocation-light, and has no
 * dependency on Electron or child_process so it can be unit-tested directly.
 */

import type { ErrorCode } from '@livetap/core';
import { classifyFailure } from '@livetap/core';

export interface ProgressSnapshot {
  /** Frames muxed so far. */
  frame?: number;
  /** Instantaneous frames per second. */
  fps?: number;
  /** Output bitrate in kbit/s. `undefined` when ffmpeg printed `N/A`. */
  bitrateKbps?: number;
  totalSizeBytes?: number;
  /** Output timestamp in milliseconds. */
  outTimeMs?: number;
  dupFrames?: number;
  dropFrames?: number;
  /** Encoding speed multiple; 1.0 means realtime. */
  speed?: number;
  /** true when this block ended with `progress=end` (the process is finishing). */
  ended: boolean;
}

export interface ParseResult {
  /** One entry per completed progress block. */
  progress: ProgressSnapshot[];
  /** Non-progress lines, trimmed, empty lines removed. */
  logs: string[];
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function num(value: string): number | undefined {
  const v = value.trim();
  if (v.length === 0 || v === 'N/A') return undefined;
  const stripped = v.replace(/(kbits\/s|bits\/s|x)$/i, '').trim();
  if (!NUMERIC.test(stripped)) return undefined;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `00:00:07.951834` → 7951.834 */
export function parseOutTime(value: string): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2})(\.\d+)?$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4]) : 0;
  return ((hours * 60 + minutes) * 60 + seconds + fraction) * 1000;
}

/**
 * Incremental stderr parser. One instance per child process.
 * `push` is safe to call with arbitrary chunk boundaries; call `flush` when the stream ends.
 */
export class FfmpegStderrParser {
  private buffer = '';
  private pending: Record<string, string> = {};

  push(chunk: string): ParseResult {
    this.buffer += chunk;
    const result: ParseResult = { progress: [], logs: [] };
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.consumeLine(line, result);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return result;
  }

  /** Emit whatever is left in the buffer as a log line. */
  flush(): ParseResult {
    const result: ParseResult = { progress: [], logs: [] };
    if (this.buffer.trim().length > 0) this.consumeLine(this.buffer.replace(/\r$/, ''), result);
    this.buffer = '';
    return result;
  }

  private consumeLine(line: string, result: ParseResult): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    // A progress line is exactly `key=value` with a key from ffmpeg's fixed vocabulary. Anything
    // else (including log lines that happen to contain `=`) is treated as a log line.
    const eq = trimmed.indexOf('=');
    if (eq > 0 && !trimmed.includes(' ')) {
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (PROGRESS_KEYS.has(key) || key.startsWith('stream_')) {
        if (key === 'progress') {
          result.progress.push(this.build(value === 'end'));
          this.pending = {};
        } else {
          this.pending[key] = value;
        }
        return;
      }
    }
    result.logs.push(trimmed);
  }

  private build(ended: boolean): ProgressSnapshot {
    const p = this.pending;
    const snapshot: ProgressSnapshot = { ended };
    const frame = p.frame !== undefined ? num(p.frame) : undefined;
    if (frame !== undefined) snapshot.frame = frame;
    const fps = p.fps !== undefined ? num(p.fps) : undefined;
    if (fps !== undefined) snapshot.fps = fps;
    const bitrate = p.bitrate !== undefined ? num(p.bitrate) : undefined;
    if (bitrate !== undefined) snapshot.bitrateKbps = bitrate;
    const size = p.total_size !== undefined ? num(p.total_size) : undefined;
    if (size !== undefined) snapshot.totalSizeBytes = size;
    const dup = p.dup_frames !== undefined ? num(p.dup_frames) : undefined;
    if (dup !== undefined) snapshot.dupFrames = dup;
    const drop = p.drop_frames !== undefined ? num(p.drop_frames) : undefined;
    if (drop !== undefined) snapshot.dropFrames = drop;
    const speed = p.speed !== undefined ? num(p.speed) : undefined;
    if (speed !== undefined) snapshot.speed = speed;

    // `out_time_us` and the misleadingly named `out_time_ms` are both microseconds in ffmpeg.
    const micros = p.out_time_us !== undefined ? num(p.out_time_us) : undefined;
    if (micros !== undefined) {
      snapshot.outTimeMs = micros / 1000;
    } else if (p.out_time !== undefined) {
      const parsed = parseOutTime(p.out_time);
      if (parsed !== undefined) snapshot.outTimeMs = parsed;
    }
    return snapshot;
  }
}

const PROGRESS_KEYS = new Set([
  'frame',
  'fps',
  'bitrate',
  'total_size',
  'out_time_us',
  'out_time_ms',
  'out_time',
  'dup_frames',
  'drop_frames',
  'speed',
  'progress',
]);

/**
 * Map an ffmpeg stderr log line to a LIVETAP ErrorCode via `classifyFailure` from packages/core.
 * Returns `null` for lines that are noise rather than a failure, so callers do not raise events for
 * deprecation warnings and the like.
 */
export function classifyStderrLine(line: string): ErrorCode | null {
  const lower = line.toLowerCase();
  if (lower.length === 0) return null;
  if (/^(\[?)(deprecated|warning)/.test(lower)) return null;
  if (lower.includes('past duration') || lower.includes('non-monotonous dts')) return null;

  // Patterns ffmpeg uses that `classifyFailure` does not know verbatim; translate to its vocabulary.
  if (lower.includes('error number -10053') || lower.includes('wsaeconnaborted')) {
    return 'INGEST_DISCONNECTED';
  }
  if (lower.includes('error number -10054') || lower.includes('wsaeconnreset')) {
    return 'INGEST_DISCONNECTED';
  }
  if (lower.includes('wsaeconnrefused') || lower.includes('error number -10061')) {
    return 'INGEST_REFUSED';
  }
  if (lower.includes('unknown host') || lower.includes('failed to resolve hostname')) {
    return 'NETWORK_OFFLINE';
  }
  if (lower.includes('netstream.publish.badname') || lower.includes('rtmp_sendpacket')) {
    return 'INGEST_INVALID_KEY';
  }
  if (lower.includes('handshake') && lower.includes('fail')) return 'INGEST_REFUSED';
  if (lower.includes('i/o error') || lower.includes('input/output error')) return 'INGEST_DISCONNECTED';

  const code = classifyFailure({ message: line });
  if (code === 'UNKNOWN') {
    // Only escalate an unrecognised line if it actually looks like a failure.
    return /\b(error|failed|cannot|could not|unable|refused|invalid)\b/i.test(line) ? 'UNKNOWN' : null;
  }
  return code;
}
