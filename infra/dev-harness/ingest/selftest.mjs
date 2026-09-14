#!/usr/bin/env node
/**
 * LIVETAP dev-harness ingest - self-test.
 *
 * Proves the receiver works WITHOUT the product, so that when the product
 * fails to arrive you know the failure is the product's.
 *
 * It starts MediaMTX, pushes a synthetic H.264 + AAC stream with ffmpeg
 * (testsrc2 plus sine), and then asserts, through the same verification script
 * a human would run:
 *
 *   stage 1  the live RTMP path decodes as h264 + aac at the pushed resolution
 *            WHILE the publisher is connected
 *   stage 2  the segment MediaMTX wrote to disk decodes the same way and has a
 *            real duration and a real byte count
 *   stage 3  kill-publisher.mjs drops a real connection and the encoder sees
 *            the failure (this is the mechanism destination failure isolation
 *            is tested against)
 *
 * Every run uses a fresh randomly named path, so a passing run can never be
 * explained by a recording left behind by an earlier one.
 *
 *   node infra/dev-harness/ingest/selftest.mjs
 *   node infra/dev-harness/ingest/selftest.mjs --seconds=6 --keep
 *
 * Exit code 0 if every stage passed, 1 otherwise. This is the CI gate.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  INGEST_DIR,
  MissingBinaryError,
  asNumber,
  ingestUrl,
  listPublishers,
  listRecordings,
  loadConfig,
  parseArgs,
  run,
  sleep,
  startMediaMtx,
  waitFor,
} from './lib/harness.mjs';
import { kbps, renderSummary } from './lib/probe.mjs';
import { verifyIngest } from './lib/verify.mjs';

const USAGE = `
selftest.mjs - prove the dev ingest receiver is honest, without the product

  --seconds=<n>   length of the synthetic push (default 10)
  --keep          keep the recordings this run produced
  --skip-kill     skip stage 3 (the deliberate publisher kill)
  --help          this text
`.trim();

const EXPECT = { width: 1280, height: 720, video: 'h264', audio: 'aac', sampleRate: 48000, channels: 2 };

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

/**
 * Start the synthetic encoder.
 *
 * testsrc2 plus sine, encoded to H.264 + AAC and pushed over RTMP: the same
 * container and the same codecs the product sends to YouTube or Twitch, so a
 * pass here means the receiver can accept the real thing.
 *
 * `-re` paces the push at real time. Without it ffmpeg would deliver ten
 * seconds of video in under a second and the "while it is live" stage would
 * have nothing to look at.
 */
function startSyntheticPush(url, seconds) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${EXPECT.width}x${EXPECT.height}:rate=30`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=1000:sample_rate=${EXPECT.sampleRate}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '1500k',
    '-g',
    '60',
    '-c:a',
    'aac',
    '-ar',
    String(EXPECT.sampleRate),
    '-ac',
    String(EXPECT.channels),
    '-b:a',
    '128k',
    '-t',
    String(seconds),
    '-f',
    'flv',
    url,
  ];

  // argv array, shell: false. The URL is one element and cannot be re-split.
  const child = spawn('ffmpeg', args, { cwd: INGEST_DIR, shell: false, windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });
  child.stdout.on('data', () => {});

  const done = new Promise((resolve, reject) => {
    child.on('error', (err) =>
      reject(
        new Error(
          err.code === 'ENOENT'
            ? 'ffmpeg was not found on PATH. Install FFmpeg 7 or newer and check that ffmpeg runs from a fresh shell.'
            : err.message,
        ),
      ),
    );
    child.on('close', (code, signal) => resolve({ code, signal, stderr }));
  });

  return { child, done };
}

function reportVerification(title, result) {
  log(`  ${title}`);
  if (result.summary) {
    for (const line of renderSummary(result.summary)) log(`  ${line}`);
    if (result.api.liveRate) {
      log(`    observed  ${kbps(result.api.liveRate.bitrateBps)} kbps over ${result.api.liveRate.windowSec.toFixed(1)} s`);
    }
  }
  for (const check of result.checks) log(`    ok    ${check}`);
  if (result.pass) {
    log('    PASS');
  } else {
    for (const reason of result.reasons) log(`    FAIL  ${reason}`);
  }
  log();
}

async function main() {
  const { opts } = parseArgs(process.argv.slice(2), { booleans: ['keep', 'skip-kill', 'help'] });
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const seconds = Math.max(4, asNumber(opts.seconds, 10));
  const cfg = loadConfig();
  const runId = randomBytes(4).toString('hex');
  const mainPath = `live/selftest-${runId}`;
  const killPath = `live/selftest-kill-${runId}`;

  const failures = [];
  let server = null;

  log('');
  log('LIVETAP dev ingest self-test');
  log(`  config    ${path.relative(process.cwd(), cfg.configPath) || cfg.configPath}`);
  log(`  paths     ${mainPath}, ${killPath}`);
  log(`  push      testsrc2 ${EXPECT.width}x${EXPECT.height}@30 H.264 + sine ${EXPECT.sampleRate} Hz AAC, ${seconds}s`);
  log('');

  try {
    // -- Start the receiver -------------------------------------------------
    log('[1/5] starting MediaMTX');
    server = startMediaMtx(cfg);
    await server.ready();
    log(`      up: RTMP ${cfg.host}:${cfg.rtmpPort}, control API ${cfg.apiBase}`);
    log('');

    const ffVersion = await run('ffmpeg', ['-hide_banner', '-version'], { timeoutMs: 15000 });
    log(`[2/5] encoder: ${ffVersion.stdout.split('\n')[0].trim()}`);
    log('');

    // -- Stage 1: live ------------------------------------------------------
    log(`[3/5] pushing synthetic stream to ${mainPath} and verifying it LIVE`);
    const url = ingestUrl(cfg, mainPath);
    const push = startSyntheticPush(url, seconds);

    await waitFor(async () => (await listPublishers(cfg, mainPath)).length > 0, {
      timeoutMs: 20000,
      intervalMs: 200,
      what: 'the synthetic publisher to connect',
    });

    const liveResult = await verifyIngest(cfg, {
      path: mainPath,
      source: 'live',
      expectVideo: EXPECT.video,
      expectAudio: EXPECT.audio,
      expectResolution: `${EXPECT.width}x${EXPECT.height}`,
      minBytes: 10000,
    });
    reportVerification('live path:', liveResult);
    if (!liveResult.pass) failures.push(`live verification failed: ${liveResult.reasons.join('; ')}`);

    // Extra assertions the CLI does not make, checked here because this is the
    // stage that decides whether the harness itself can be believed.
    if (liveResult.summary) {
      const a = liveResult.summary.audio;
      if (a && a.sampleRate !== EXPECT.sampleRate) {
        failures.push(`live audio sample rate was ${a.sampleRate}, expected ${EXPECT.sampleRate}`);
      }
      if (a && a.channels !== EXPECT.channels) {
        failures.push(`live audio channel count was ${a.channels}, expected ${EXPECT.channels}`);
      }
      const v = liveResult.summary.video;
      if (v && (v.frameRate === null || v.frameRate < 20 || v.frameRate > 40)) {
        failures.push(`live frame rate was ${String(v.frameRate)}, expected roughly 30`);
      }
    }

    // -- Stage 2: recording -------------------------------------------------
    log('[4/5] waiting for the push to finish, then verifying the RECORDING');
    const pushResult = await push.done;
    if (pushResult.code !== 0) {
      failures.push(`ffmpeg exited with code ${String(pushResult.code)}: ${pushResult.stderr.trim()}`);
    }
    // MediaMTX finalises the segment when the publisher disconnects.
    await waitFor(() => listRecordings(cfg, mainPath).length > 0, {
      timeoutMs: 15000,
      intervalMs: 250,
      what: 'MediaMTX to finalise a recording segment',
    });
    await sleep(500);

    const recordResult = await verifyIngest(cfg, {
      path: mainPath,
      source: 'record',
      expectVideo: EXPECT.video,
      expectAudio: EXPECT.audio,
      expectResolution: `${EXPECT.width}x${EXPECT.height}`,
      minDurationSec: Math.max(1, seconds - 3),
      minBytes: 50000,
    });
    reportVerification(`recording: ${recordResult.probeTarget}`, recordResult);
    if (!recordResult.pass) failures.push(`recording verification failed: ${recordResult.reasons.join('; ')}`);

    // -- Stage 3: deliberate kill -------------------------------------------
    if (opts['skip-kill'] === true) {
      log('[5/5] skipped (--skip-kill)');
      log('');
    } else {
      log(`[5/5] killing a real publisher on ${killPath} via kill-publisher.mjs`);
      const killUrl = ingestUrl(cfg, killPath);
      const victim = startSyntheticPush(killUrl, 120);
      await waitFor(async () => (await listPublishers(cfg, killPath)).length > 0, {
        timeoutMs: 20000,
        intervalMs: 200,
        what: 'the victim publisher to connect',
      });

      const killer = await run('node', [path.join(INGEST_DIR, 'kill-publisher.mjs'), `--path=${killPath}`], {
        timeoutMs: 20000,
      });
      for (const line of killer.stdout.split('\n')) if (line.trim()) log(`      ${line.trim()}`);
      if (killer.code !== 0) {
        failures.push(`kill-publisher.mjs exited ${String(killer.code)}: ${killer.stderr.trim()}`);
      }

      const victimResult = await Promise.race([
        victim.done,
        sleep(15000).then(() => null),
      ]);
      if (victimResult === null) {
        victim.child.kill();
        failures.push('the killed encoder was still running 15 s after the kick; the drop did not reach it');
      } else if (victimResult.code === 0) {
        failures.push('the killed encoder exited cleanly; a mid-broadcast kick must surface as an error');
      } else {
        log(`      encoder saw the drop and exited with code ${String(victimResult.code)}, as it should`);
      }

      const survivors = await listPublishers(cfg, killPath);
      if (survivors.length !== 0) failures.push(`${survivors.length} publisher(s) survived the kick`);
      log('');
    }
  } catch (err) {
    if (err instanceof MissingBinaryError) {
      process.stderr.write(`\n${err.message}\n`);
      failures.push('MediaMTX binary missing');
    } else {
      failures.push(err.message);
    }
  } finally {
    if (server) await server.stop();
    if (opts.keep !== true) {
      for (const p of [mainPath, killPath]) {
        const dir = path.join(cfg.recordingsDir, ...p.split('/'));
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  if (failures.length === 0) {
    log('PASS  the dev ingest receiver accepted a real encoded stream, decoded it live, recorded it to disk');
    log(`      and reported ${EXPECT.video}/${EXPECT.audio} at ${EXPECT.width}x${EXPECT.height}.`);
    if (opts['skip-kill'] === true) {
      log('      The deliberate publisher kill was skipped, so stage 3 proves nothing this run.');
    } else {
      log('      It also dropped a real publisher on demand, and the encoder saw the drop.');
    }
    log('');
    return 0;
  }

  log(`FAIL  ${failures.length} problem(s):`);
  for (const f of failures) log(`      - ${f}`);
  log('');
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`\nFAIL  self-test crashed: ${err.stack ?? err.message}\n\n`);
    process.exitCode = 1;
  },
);
