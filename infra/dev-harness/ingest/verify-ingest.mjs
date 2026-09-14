#!/usr/bin/env node
/**
 * LIVETAP dev-harness ingest - verification.
 *
 * DID A REAL STREAM ARRIVE, AND WHAT WAS IT?
 *
 * Queries the MediaMTX control API for active publishers, then runs ffprobe
 * against either the live RTMP path or the newest recorded segment, and prints
 * codec, profile, resolution, frame rate, sample rate, channels, duration and
 * bitrate, followed by a single PASS or FAIL line with the reason.
 *
 *   node infra/dev-harness/ingest/verify-ingest.mjs
 *   node infra/dev-harness/ingest/verify-ingest.mjs --source=record
 *   node infra/dev-harness/ingest/verify-ingest.mjs --expect-video=h264 \
 *       --expect-audio=aac --expect-resolution=1280x720 --min-duration=2
 *
 * Exit code 0 on PASS, 1 on FAIL. Safe to use as a CI gate.
 */

import {
  asNumber,
  asString,
  loadConfig,
  parseArgs,
  redactUrl,
} from './lib/harness.mjs';
import { kbps, renderSummary } from './lib/probe.mjs';
import { verifyIngest } from './lib/verify.mjs';

const USAGE = `
verify-ingest.mjs - prove that real encoded bytes reached the local ingest

  --path=<name>              MediaMTX path to inspect (default live/dev)
  --source=auto|live|record  what to probe. auto probes the live path when a
                             publisher is connected, otherwise the newest
                             recording. (default auto)
  --file=<path>              probe this recording instead of choosing one
  --wait=<seconds>           wait this long for a publisher to appear
  --expect-video=<codec>     fail unless the video codec matches, e.g. h264
  --expect-audio=<codec>     fail unless the audio codec matches, e.g. aac
  --expect-resolution=<WxH>  fail unless the resolution matches
  --min-duration=<seconds>   fail unless the recording is at least this long
  --min-bytes=<n>            fail unless at least this many bytes arrived
  --json                     machine readable output instead of the report
  --help                     this text
`.trim();

function render(result, cfg) {
  const out = [];
  out.push('');
  out.push('LIVETAP dev ingest verification');
  out.push(`  path        ${result.path}`);
  out.push(`  control API ${cfg.apiBase}  ${result.api.reachable ? 'reachable' : 'UNREACHABLE'}`);

  if (result.api.publishers.length === 0) {
    out.push('  publisher   none connected');
  } else {
    for (const conn of result.api.publishers) {
      out.push(
        `  publisher   ${conn.remoteAddr}  agent "${conn.userAgent}"  since ${conn.created}  ${conn.bytesReceived} bytes`,
      );
    }
  }

  if (result.api.path) {
    const tracks = result.api.path.tracks
      .map((t) => {
        const p = t.props ?? {};
        const detail = [];
        if (p.profile) detail.push(String(p.profile));
        if (p.width && p.height) detail.push(`${p.width}x${p.height}`);
        if (p.sampleRate) detail.push(`${p.sampleRate} Hz`);
        if (p.channelCount) detail.push(`${p.channelCount} ch`);
        return detail.length ? `${t.codec} (${detail.join(', ')})` : t.codec;
      })
      .join(', ');
    out.push(`  server saw  ${tracks || 'no tracks'}`);
  }

  if (result.probeTarget) {
    out.push(`  probed      ${result.probedSource}  ${redactUrl(result.probeTarget)}`);
  }
  out.push('');

  if (result.summary) {
    out.push('  ffprobe reports what actually decoded:');
    out.push(...renderSummary(result.summary));
    if (result.api.liveRate) {
      const r = result.api.liveRate;
      out.push(
        `  observed  ${kbps(r.bitrateBps)} kbps measured over ${r.windowSec.toFixed(1)} s (${r.bytesDelta} bytes)`,
      );
    }
    out.push('');
  }

  for (const check of result.checks) out.push(`  ok    ${check}`);
  if (result.checks.length) out.push('');

  if (result.pass) {
    const v = result.summary.video;
    const a = result.summary.audio;
    out.push(
      `PASS  real encoded media arrived on ${result.path}: ${v.codec} ${v.width}x${v.height} plus ${a.codec} ${a.sampleRate} Hz ${a.channels} ch, probed from the ${result.probedSource === 'live' ? 'live RTMP path' : 'recording on disk'}.`,
    );
  } else {
    out.push(`FAIL  ${result.reasons[0]}`);
    for (const extra of result.reasons.slice(1)) out.push(`      also: ${extra}`);
  }
  out.push('');
  return out.join('\n');
}

async function main() {
  const { opts } = parseArgs(process.argv.slice(2), { booleans: ['json', 'help'] });
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const cfg = loadConfig();
  const source = asString(opts.source, 'auto');
  if (!['auto', 'live', 'record'].includes(source)) {
    process.stderr.write(`--source must be auto, live or record, got "${source}"\n`);
    return 2;
  }

  const result = await verifyIngest(cfg, {
    path: asString(opts.path, cfg.defaultPath),
    source,
    file: opts.file && opts.file !== true ? String(opts.file) : undefined,
    waitForPublisherMs: asNumber(opts.wait, 0) * 1000,
    expectVideo: asString(opts['expect-video'], undefined),
    expectAudio: asString(opts['expect-audio'], undefined),
    expectResolution: asString(opts['expect-resolution'], undefined),
    minDurationSec: opts['min-duration'] === undefined ? undefined : asNumber(opts['min-duration'], 0),
    minBytes: asNumber(opts['min-bytes'], 1),
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(result, cfg)}\n`);
  }
  return result.pass ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`\nFAIL  verification could not run: ${err.message}\n\n`);
    process.exitCode = 1;
  },
);
