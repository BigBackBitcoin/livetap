#!/usr/bin/env node
/**
 * The one test that decides whether LIVETAP is real.
 *
 * It launches the BUILT desktop app under Playwright with Chromium's fake capture device, drives
 * the actual product UI (no test hooks, no injected engine, no store surgery), adds one Custom RTMP
 * destination per output shape pointing at the local MediaMTX receiver, taps GO LIVE, and then asks
 * the receiver what arrived. Every link in the chain is the production one:
 *
 *   navigator.mediaDevices.getUserMedia   real API, synthetic photons
 *   FormatRenderer                        real canvases, one per aspect ratio
 *   MediaRecorder                         real Chromium encoder
 *   window.livetap.engine.pushChunk       real contextBridge IPC
 *   FfmpegEngine                          real ffmpeg child processes
 *   MediaMTX                              real RTMP handshake, real recording
 *   ffprobe                               real decode of what landed on disk
 *
 * Requires: a built desktop app (`npm run build -w @livetap/desktop`) and a running receiver
 * (`node infra/dev-harness/ingest/start-ingest.mjs`). Both are checked before anything is claimed.
 *
 * Exit code 0 on PASS, 1 on FAIL. One PASS/FAIL line at the end, and nothing above it is a claim
 * that was not measured.
 *
 *   node apps/desktop/e2e/broadcast.mjs
 *   node apps/desktop/e2e/broadcast.mjs --seconds=12 --keep-ingest
 */
import { _electron as electron } from 'playwright';
import {
  addCustomDestination,
  dismissTour,
  goLive,
  pressEnd,
} from '../../../infra/dev-harness/broadcast/studio-controls.mjs';
import { acquire } from '../../../infra/dev-harness/broadcast/runlock.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const ingestDir = path.join(repoRoot, 'infra', 'dev-harness', 'ingest');

const args = process.argv.slice(2);
const seconds = Number(readArg('--seconds') ?? 12);
const apiBase = process.env.LIVETAP_DEV_INGEST_API ?? 'http://127.0.0.1:9997';
const rtmpBase = process.env.LIVETAP_DEV_INGEST_RTMP ?? 'rtmp://127.0.0.1:1935';

/**
 * One destination per shape the product offers, because a shape nobody has watched arrive is a
 * shape the product only claims.
 *
 * `expect` is the resolution the SERVER must parse out of the stream's own SPS. That is the whole
 * point: 9:16 has to be a composition built at 1080x1920, not a 16:9 picture in a narrow box, and
 * 1:1 has to be built at 1080x1080, not a wide picture with the sides cut off by CSS. Nothing but
 * the dimensions on the wire can tell those apart, which is why they are asserted here rather than
 * in a screenshot.
 *
 * Three simultaneous encoders is also the heaviest thing this product ever asks of a machine, so
 * this run is the honest answer to "can one laptop do it" as well.
 */
const ALL_TARGETS = [
  { key: 'wide', pathName: 'live/wide', aspect: '16:9', label: 'Local wide', expect: '1920x1080' },
  { key: 'tall', pathName: 'live/tall', aspect: '9:16', label: 'Local vertical', expect: '1080x1920' },
  { key: 'square', pathName: 'live/square', aspect: '1:1', label: 'Local square', expect: '1080x1080' },
];

/**
 * `--only=wide` narrows the run to one destination. Failure isolation needs two, so that step is
 * skipped; the point of the flag is bisecting a failure and measuring what one format costs on a
 * machine, which on a GPU-less host is the difference between 30 fps and not.
 */
const only = readArg('--only');
const TARGETS = only ? ALL_TARGETS.filter((t) => t.key === only) : ALL_TARGETS;

function readArg(name) {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

const lines = [];
let failed = false;
/** Kept so a thrown error can say what was actually on screen instead of only which selector missed. */
let window_ = null;

function ok(message) {
  lines.push(`  ok    ${message}`);
}

function bad(message) {
  failed = true;
  lines.push(`  FAIL  ${message}`);
}

function step(message) {
  lines.push('');
  lines.push(message);
  process.stdout.write(`${message}\n`);
}

async function api(pathname) {
  const res = await fetch(`${apiBase}${pathname}`);
  if (!res.ok) throw new Error(`control API ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

/** Publishers currently connected to one path, straight from MediaMTX. */
async function publishers(pathName) {
  const list = await api('/v3/rtmpconns/list');
  return (list.items ?? []).filter((c) => c.path === pathName && c.state === 'publish');
}

async function bytesOn(pathName) {
  const conns = await publishers(pathName);
  return conns.reduce((total, c) => total + (c.bytesReceived ?? 0), 0);
}

/**
 * The video track dimensions the SERVER parsed out of the SPS on the wire.
 *
 * This is the authority for "what shape is being broadcast", not ffprobe: ffprobe reading a few
 * seconds of a live FLV often reports 0x0 because it stops before it has decoded a parameter set,
 * while MediaMTX has already parsed the real one to accept the stream at all.
 */
async function videoTrackOn(pathName) {
  const item = await api(`/v3/paths/get/${encodeURIComponent(pathName)}`);
  for (const track of item.tracks2 ?? []) {
    const props = track.codecProps ?? {};
    if (props.width && props.height) return { codec: String(track.codec ?? ''), size: `${props.width}x${props.height}` };
  }
  return null;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (error) => resolve({ code: null, stdout, stderr: stderr + error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  // No-op when the completion gate spawned us; it already holds it. See runlock.mjs.
  await acquire({
    label: 'studio broadcast driver',
    onWait: (holder) => process.stdout.write(`  waiting     pid ${holder.pid} is using the receiver and the app
`),
  });
  if (!fs.existsSync(path.join(appDir, 'dist', 'main', 'index.cjs'))) {
    throw new Error('No built main process. Run: npm run build -w @livetap/desktop');
  }
  if (!fs.existsSync(path.join(appDir, 'dist', 'renderer', 'app.html'))) {
    throw new Error('No built renderer. Run: npm run build -w @livetap/desktop');
  }
  try {
    await api('/v3/paths/list');
  } catch {
    throw new Error(`No receiver at ${apiBase}. Run: node infra/dev-harness/ingest/start-ingest.mjs`);
  }

  step('[1/8] launching the built desktop app with a fake capture device');
  const app = await electron.launch({
    args: [
      appDir,
      // The REAL getUserMedia path, with a synthetic source. This VM has no camera; every line of
      // permission handling, track lifecycle and constraint negotiation still runs for real.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    cwd: appDir,
  });
  const win = await app.firstWindow();
  window_ = win;
  // Fail fast: a selector that never appears is a product problem to report, not a reason to sit
  // for thirty seconds per click.
  win.setDefaultTimeout(10_000);
  const rendererErrors = [];
  const consoleLines = [];
  win.on('pageerror', (error) => rendererErrors.push(String(error).slice(0, 200)));
  win.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text().slice(0, 240)}`));
  const mainLines = [];
  app.process().stdout?.on('data', (d) => mainLines.push(String(d).trimEnd()));
  app.process().stderr?.on('data', (d) => mainLines.push(String(d).trimEnd()));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // Skip onboarding the way a returning creator does: it has already been completed once.
  await win.evaluate(() => {
    localStorage.setItem('livetap.onboarding', 'true');
    localStorage.setItem('livetap.intent', '"talking"');
    localStorage.setItem('livetap.mode', '"simple"');
    localStorage.removeItem('livetap.destinations');
    /*
     * And the acknowledgement, so EVERY run crosses the real-broadcast confirmation rather than
     * only the first one ever performed on this machine. `confirmRealBroadcast` persists this,
     * which meant the gate quietly stopped exercising its most safety-critical interstitial the
     * moment it had passed once.
     */
    localStorage.removeItem('livetap.realBroadcastAck');
  });
  await win.reload();
  await win.waitForTimeout(2500);

  const host = await win.evaluate(() => ({
    bridge: typeof window.livetap?.engine?.pushChunk === 'function',
    kind: window.livetapHost?.kind,
  }));
  if (host.bridge && host.kind === 'desktop') ok('the renderer can reach the main-process engine bridge');
  else bad(`the preload bridge is missing (host=${host.kind}, pushChunk=${host.bridge})`);

  step(`[2/8] adding ${TARGETS.length} Custom RTMP destinations through the real UI, one per shape`);
  await dismissTour(win);
  for (const target of TARGETS) {
    // Split exactly the way every platform splits it, and the way the harness README documents:
    // the server address ends at the application, and the last path segment is the "stream key".
    await addCustomDestination(win, {
      label: target.label,
      url: `${rtmpBase}/live`,
      streamKey: target.key,
      aspect: target.aspect,
    });
  }
  const added = await win.evaluate(() => document.querySelectorAll('.lt-destlist > li').length);
  if (added === TARGETS.length) ok(`every destination was created in the app (${added} rows)`);
  else bad(`expected ${TARGETS.length} destinations, the app shows ${added}`);

  step('[3/8] tapping GO LIVE');
  await win.evaluate(() => {
    location.hash = '#/app';
  });
  await win.waitForTimeout(1500);
  const tap = await goLive(win);
  if (tap.confirmed) ok(`the app asked before touching real accounts, and named ${tap.destinations} of them`);
  // The countdown runs in the button itself; nothing reaches a server until it ends.
  await win.waitForTimeout(5000);

  const deadline = Date.now() + 25_000;
  let live = [];
  while (Date.now() < deadline) {
    live = await Promise.all(TARGETS.map((t) => bytesOn(t.pathName)));
    if (live.every((bytes) => bytes > 0)) break;
    await win.waitForTimeout(1000);
  }
  for (const [index, target] of TARGETS.entries()) {
    if (live[index] > 0) ok(`${target.pathName} has a real RTMP publisher (${live[index]} bytes so far)`);
    else bad(`${target.pathName} has no publisher: nothing is being broadcast`);
  }
  if (failed) {
    // A broadcast that did not happen needs its reason on the page, not a bare assertion.
    const screen = await win.evaluate(() => document.body.innerText.slice(0, 1600));
    lines.push('  what the app says:');
    lines.push(...screen.split(/\r?\n/).map((l) => `        ${l}`));
    lines.push('  renderer console:');
    lines.push(...consoleLines.slice(-25).map((l) => `        ${l}`));
    lines.push('  main process:');
    lines.push(...mainLines.slice(-25).map((l) => `        ${l}`));
    await finish(app);
    return;
  }

  step('[4/8] asking ffprobe what is on the wire RIGHT NOW');
  for (const target of TARGETS) {
    const result = await run(process.execPath, [
      path.join(ingestDir, 'verify-ingest.mjs'),
      `--path=${target.pathName}`,
      '--source=live',
      '--expect-video=h264',
      '--expect-audio=aac',
    ]);
    lines.push(...result.stdout.trimEnd().split(/\r?\n/).map((l) => `      ${l}`));
    if (result.code === 0) ok(`${target.pathName} is carrying live H.264 video and AAC audio`);
    else bad(`${target.pathName} did not decode as expected while live (verify-ingest exit ${result.code})`);

    const track = await videoTrackOn(target.pathName);
    if (track?.size === target.expect) ok(`the server parsed ${target.pathName} as ${track.codec} ${track.size} from the stream itself`);
    else bad(`the server sees ${target.pathName} as ${track?.size ?? 'no video track'}, expected ${target.expect}`);
  }

  step(`[5/8] broadcasting for ${seconds}s, then proving failure isolation and reconnect`);
  await win.waitForTimeout(Math.round((seconds * 1000) / 2));
  if (TARGETS.length < 2) lines.push('  note  one destination only, so failure isolation was not exercised in this run');
  if (TARGETS.length >= 2) {
    const wideBefore = await bytesOn(TARGETS[0].pathName);
    const killed = await run(process.execPath, [path.join(ingestDir, 'kill-publisher.mjs'), `--path=${TARGETS[1].pathName}`]);
    lines.push(...killed.stdout.trimEnd().split(/\r?\n/).map((l) => `        ${l}`));
    await win.waitForTimeout(4000);
    const wideAfter = await bytesOn(TARGETS[0].pathName);
    if (wideAfter > wideBefore) ok(`the surviving destination kept climbing through the failure (${wideBefore} -> ${wideAfter} bytes)`);
    else bad(`the surviving destination stalled when the other one was killed (${wideBefore} -> ${wideAfter} bytes)`);

    const stillLive = await win.evaluate(() => document.body.innerText.includes('Live'));
    if (stillLive) ok('the app still reports a live broadcast after one destination was dropped');
    else bad('the app stopped reporting a live broadcast when one destination was dropped');

    /*
     * The other half of the promise, and the half nobody had ever watched happen.
     *
     * Every run before this one asserted that the SURVIVOR kept climbing and then went straight to
     * END, so "the failed destination reconnects independently" — the sentence on the front of the
     * product — rested entirely on a unit test of the backoff arithmetic. The path it actually has
     * to travel is long and crosses three processes: the sender dies, FfmpegEngine turns the exit
     * into `outputLost` and posts it over IPC, BroadcastOrchestrator moves the destination to
     * RECONNECTING and schedules a retry ~1 s out, `attemptReconnect` calls `addOutput` back
     * across IPC, and main spawns a fresh `-c copy` sender onto a socket the server closed on
     * purpose. Any link in that could be missing and every previous run would still have passed.
     *
     * MediaMTX counts bytes per CONNECTION, so the returning publisher starts from zero rather
     * than resuming the old total. Presence is therefore not enough — a connection that opens and
     * stalls looks identical at one sample — so this waits for a publisher, then waits for that
     * publisher's own counter to move.
     */
    /*
     * 40 s, and the elapsed time is reported whether it passes or fails.
     *
     * The reconnect is a backoff (1 s, then doubling) plus however long the new sender needs to
     * see a keyframe, so its duration is a real number that varies with the machine. A bare
     * pass/fail against a fixed deadline turns a slow host into a product defect, and says
     * nothing on the runs that pass. On a contended machine this went red once and green twice,
     * which is exactly the shape of a threshold set too close to the truth.
     */
    const droppedAt = Date.now();
    const reconnectDeadline = droppedAt + 40_000;
    let republished = 0;
    let cameBackAfterMs = 0;
    while (Date.now() < reconnectDeadline) {
      await win.waitForTimeout(500);
      const back = await publishers(TARGETS[1].pathName);
      if (back.length > 0) {
        cameBackAfterMs = Date.now() - droppedAt;
        republished = await bytesOn(TARGETS[1].pathName);
        break;
      }
    }

    if (republished === 0 && (await publishers(TARGETS[1].pathName)).length === 0) {
      bad(`${TARGETS[1].pathName} never came back: no publisher reconnected within 40 s of the drop`);
    } else {
      ok(`${TARGETS[1].pathName} republished on its own ${(cameBackAfterMs / 1000).toFixed(1)}s after the drop`);
      await win.waitForTimeout(3000);
      const climbing = await bytesOn(TARGETS[1].pathName);
      if (climbing > republished) {
        ok(`the reconnected destination is carrying real bytes again (${republished} -> ${climbing})`);
      } else {
        bad(`${TARGETS[1].pathName} reconnected but sent nothing (${republished} -> ${climbing} bytes)`);
      }

      const track = await videoTrackOn(TARGETS[1].pathName);
      if (track?.size === TARGETS[1].expect) {
        ok(`the reconnected stream is still ${track.codec} ${track.size}, the shape it was before`);
      } else {
        bad(`the reconnected stream is ${track?.size ?? 'not carrying video'}, expected ${TARGETS[1].expect}`);
      }

      /*
       * And the UI has to agree. A destination that is genuinely back on the wire while the app
       * still shows it reconnecting is the same class of lie as a LIVE badge with no bytes, just
       * pointing the other way, and it is the one the creator acts on: they end a broadcast that
       * was working because the screen told them it was not.
       */
      const settled = await win
        .waitForFunction(
          () => !/Reconnecting|Trying again/i.test(document.body.innerText),
          undefined,
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (settled) ok('the app stopped showing the destination as reconnecting once it was back');
      else bad('the destination is publishing again but the app still shows it reconnecting');
    }
  }

  await win.waitForTimeout(Math.round((seconds * 1000) / 2));

  step('[6/8] pressing END and waiting out the grace period');
  // Not `.lt-golive`: Studio unmounts the whole go-live section while live, on purpose, so that
  // the only control able to stop a broadcast is the one that survives a route change.
  await pressEnd(win);
  await win.waitForTimeout(9000);
  const remaining = await Promise.all(TARGETS.map((t) => publishers(t.pathName)));
  const publisherCount = remaining.reduce((n, list) => n + list.length, 0);
  if (publisherCount === 0) ok('every publisher is gone from the receiver after END');
  else bad(`${publisherCount} publisher(s) are still connected after END`);

  step('[7/8] asking ffprobe what MediaMTX wrote to disk');
  for (const target of TARGETS) {
    const result = await run(process.execPath, [
      path.join(ingestDir, 'verify-ingest.mjs'),
      `--path=${target.pathName}`,
      '--source=record',
      '--expect-video=h264',
      '--expect-audio=aac',
      `--expect-resolution=${target.expect}`,
    ]);
    lines.push(...result.stdout.trimEnd().split(/\r?\n/).map((l) => `      ${l}`));
    // No duration assertion here on purpose: MediaMTX rolls segments on its own schedule, so
    // the newest file can legitimately be a fraction of a second of tail. The broadcast's real
    // length was already proven on the wire in step 4. What a recording must never be is the
    // wrong codec or the wrong shape.
    if (result.code === 0) ok(`${target.pathName} recorded real H.264 + AAC at ${target.expect}`);
    else bad(`${target.pathName} did not verify (verify-ingest exit ${result.code})`);
  }

  step('[8/8] checking the renderer stayed healthy');
  if (rendererErrors.length === 0) ok('no uncaught renderer errors during the broadcast');
  else bad(`renderer errors: ${rendererErrors.join(' | ')}`);

  await finish(app);
}

async function finish(app) {
  await app.close().catch(() => undefined);
  process.stdout.write(`\n${lines.join('\n')}\n\n`);
  if (failed) {
    process.stdout.write('FAIL  the desktop app did not prove a real broadcast end to end.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    'PASS  the desktop app captured, composed one picture per aspect ratio, encoded, and published\n' +
      '      two real RTMP streams that MediaMTX accepted, recorded and ffprobe decoded as H.264 + AAC.\n',
  );
}

main().catch(async (error) => {
  let screen = '(the window was already gone)';
  try {
    if (window_) screen = await window_.evaluate(() => `${location.hash}\n${document.body.innerText.slice(0, 1200)}`);
  } catch {
    /* the window died with the error; the message below is all there is */
  }
  process.stdout.write(`\n${lines.join('\n')}\n\n  what was on screen:\n${screen}\n`);
  process.stdout.write(`\nFAIL  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  // Playwright keeps the Electron process alive on an unhandled path; leaving it running would
  // hold an RTMP publisher open and poison the next run's evidence.
  process.exit(1);
});
