/**
 * LIVETAP dev-harness ingest - ffprobe wrapper.
 *
 * Turns "the UI said LIVE" into a list of facts about the bytes that arrived:
 * video codec, profile, resolution, frame rate, audio codec, sample rate,
 * channel count, duration and bitrate.
 *
 * Two probe targets, because the evidence lives in two places:
 *
 *   file  a finished recording segment on disk. Complete metadata, including
 *         container duration and overall bitrate.
 *   live  the RTMP path itself, while a publisher is connected. Proves the
 *         stream is flowing right now, but FLV over RTMP carries no duration
 *         and no overall bitrate, so those come from the control API instead.
 */

import { run, redactUrl } from './harness.mjs';

/** Shared ffprobe flags. JSON out, errors only on stderr. */
const BASE_ARGS = ['-hide_banner', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams'];

/**
 * Probe a recorded file.
 * Never shell quoted: the path goes in as one argv element, so a space or a
 * quote in a Windows path cannot change the command.
 */
export async function probeFile(file, { timeoutMs = 30000 } = {}) {
  const result = await run('ffprobe', [...BASE_ARGS, file], { timeoutMs });
  return parseProbe(result, file);
}

/**
 * Probe the live RTMP path.
 *
 * `-rtmp_live live` is not optional. Without it FFmpeg's RTMP client asks for
 * a recorded stream, the server has nothing to seek in, and the probe fails
 * with a bare "I/O error" that looks like the stream is absent when it is
 * not.
 */
export async function probeLive(url, { timeoutMs = 30000, analyzeMs = 3000 } = {}) {
  const micros = String(Math.max(1, Math.round(analyzeMs)) * 1000);
  const args = [
    ...BASE_ARGS,
    '-rtmp_live',
    'live',
    '-analyzeduration',
    micros,
    '-probesize',
    String(3 * 1000 * 1000),
    url,
  ];
  const result = await run('ffprobe', args, { timeoutMs });
  return parseProbe(result, redactUrl(url));
}

function parseProbe(result, label) {
  const text = result.stdout.trim();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const ok = result.code === 0 && streams.length > 0;
  return {
    ok,
    target: label,
    exitCode: result.code,
    // ffprobe writes diagnostics to stderr. Redacted, because the failing URL
    // is echoed back in the error text.
    error: ok ? null : redactUrl(result.stderr.trim() || `ffprobe exited with code ${String(result.code)}`),
    format: json?.format ?? null,
    streams,
  };
}

// ---------------------------------------------------------------------------
// Summarising
// ---------------------------------------------------------------------------

function ratioToNumber(text) {
  if (typeof text !== 'string' || !text.includes('/')) return null;
  const [n, d] = text.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function num(value) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reduce an ffprobe result to the handful of facts that decide whether a
 * broadcast really arrived.
 */
export function summarize(probe) {
  const video = probe.streams.find((s) => s.codec_type === 'video') ?? null;
  const audio = probe.streams.find((s) => s.codec_type === 'audio') ?? null;
  const format = probe.format ?? {};

  const frameRate = video ? (ratioToNumber(video.avg_frame_rate) ?? ratioToNumber(video.r_frame_rate)) : null;

  return {
    target: probe.target,
    container: format.format_name ?? null,
    durationSec: num(format.duration),
    sizeBytes: num(format.size),
    bitrateBps: num(format.bit_rate),
    video: video
      ? {
          codec: video.codec_name ?? null,
          profile: video.profile ?? null,
          level: num(video.level),
          width: num(video.width),
          height: num(video.height),
          pixelFormat: video.pix_fmt ?? null,
          frameRate,
          declaredFrameRate: video.r_frame_rate ?? null,
          bitrateBps: num(video.bit_rate),
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name ?? null,
          profile: audio.profile ?? null,
          sampleRate: num(audio.sample_rate),
          channels: num(audio.channels),
          channelLayout: audio.channel_layout ?? null,
          bitrateBps: num(audio.bit_rate),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function kbps(bps) {
  return bps === null || bps === undefined ? null : Math.round(bps / 1000);
}

function fmtNumber(value, digits = 3) {
  return value === null || value === undefined ? 'unknown' : value.toFixed(digits);
}

/** Human readable block. One fact per line, no prose. */
export function renderSummary(summary) {
  const lines = [];
  const v = summary.video;
  const a = summary.audio;

  if (v) {
    const parts = [
      `codec ${v.codec ?? 'unknown'}`,
      `profile ${v.profile ?? 'unknown'}`,
      `${v.width ?? '?'}x${v.height ?? '?'}`,
      `${v.frameRate === null ? 'unknown' : `${v.frameRate.toFixed(2)} fps`}`,
      `pixfmt ${v.pixelFormat ?? 'unknown'}`,
    ];
    if (kbps(v.bitrateBps) !== null) parts.push(`${kbps(v.bitrateBps)} kbps`);
    lines.push(`  video    ${parts.join('  ')}`);
  } else {
    lines.push('  video    NONE');
  }

  if (a) {
    const parts = [
      `codec ${a.codec ?? 'unknown'}`,
      `profile ${a.profile ?? 'unknown'}`,
      `${a.sampleRate ?? '?'} Hz`,
      `${a.channels ?? '?'} ch (${a.channelLayout ?? 'unknown layout'})`,
    ];
    if (kbps(a.bitrateBps) !== null) parts.push(`${kbps(a.bitrateBps)} kbps`);
    lines.push(`  audio    ${parts.join('  ')}`);
  } else {
    lines.push('  audio    NONE');
  }

  lines.push(`  container ${summary.container ?? 'unknown'}`);
  lines.push(
    `  duration ${summary.durationSec === null ? 'unknown (live stream, see observed below)' : `${fmtNumber(summary.durationSec)} s`}`,
  );
  lines.push(
    `  bitrate  ${kbps(summary.bitrateBps) === null ? 'unknown (live stream, see observed below)' : `${kbps(summary.bitrateBps)} kbps overall`}`,
  );
  if (summary.sizeBytes !== null) lines.push(`  size     ${summary.sizeBytes} bytes`);
  return lines;
}

export { kbps };
