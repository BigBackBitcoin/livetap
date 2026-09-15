#!/usr/bin/env node
/**
 * LIVETAP completion gate - the whole chain as one command.
 *
 * The owner's alpha gate is a sentence: install it, connect a camera, tap GO
 * LIVE, break one destination, watch the others stay live, tap END. This
 * script is that sentence turned into an exit code, for the part of it that
 * can be proven on a machine with no camera, no GPU and no platform account.
 *
 * It runs the chain in the order a failure should be attributed:
 *
 *   stage 1  the RECEIVER is honest          infra/dev-harness/ingest/selftest.mjs
 *            A synthetic H.264 + AAC push arrives, decodes live, records to
 *            disk and survives a deliberate publisher kill. Run first so that
 *            when the product does not arrive, the receiver is already ruled
 *            out and the fault is the product's.
 *
 *   stage 2  the RECEIVER is running         MediaMTX on 127.0.0.1:1935
 *            Started here and stopped here, unless one was already up.
 *
 *   stage 3  the PRODUCT is real             apps/desktop/e2e/broadcast.mjs
 *            The built Electron app under Playwright with Chromium's fake
 *            capture device: real getUserMedia, real canvases, real
 *            MediaRecorder, real contextBridge IPC, real ffmpeg, two real RTMP
 *            publishers at two different shapes, a real mid-broadcast TCP
 *            reset on one of them, and ffprobe on what MediaMTX wrote.
 *
 *   stage 4  STOP is not conditional on a screen staying mounted
 *            END, then navigate away before the grace period expires, and the
 *            publishers must still be gone. A stop that a route change can
 *            cancel is a broadcast the creator cannot end.
 *
 * WHY STAGE 3 SHELLS OUT rather than driving the UI itself: there must be
 * exactly one set of studio selectors in this repo. Two would eventually
 * disagree about what the product looks like, and the day they disagree is the
 * day the evidence stops being evidence. The driver lives with the app it
 * drives; this script owns the chain, the receiver's lifetime and the verdict.
 *
 *   node infra/dev-harness/broadcast/verify-desktop-broadcast.mjs
 *   node infra/dev-harness/broadcast/verify-desktop-broadcast.mjs --quick
 *   node infra/dev-harness/broadcast/verify-desktop-broadcast.mjs --seconds=20 --keep
 *
 * Exit 0 only when every stage passed. Exit 1 on any failure, and on any
 * missing piece, with the missing piece named and the command that supplies it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MissingBinaryError,
  asNumber,
  listPublishers,
  loadConfig,
  parseArgs,
  resolveMediaMtx,
  sleep,
  startMediaMtx,
} from '../ingest/lib/harness.mjs';
import { goLive, pressEnd } from './studio-controls.mjs';

const BROADCAST_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO_ROOT = path.resolve(BROADCAST_DIR, '..', '..', '..');
const INGEST_DIR = path.join(REPO_ROOT, 'infra', 'dev-harness', 'ingest');
const DESKTOP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');

const USAGE = `
verify-desktop-broadcast.mjs - the LIVETAP alpha completion gate, as one command

  --seconds=<n>       how long to hold the broadcast open (default 12)
  --quick             skip stage 1, the receiver self-test
  --skip-grace        skip stage 4, the navigate-away-during-END regression
  --keep              leave MediaMTX running afterwards
  --help              this text

Requires, and checks for, before it claims anything:
  ffmpeg + ffprobe on PATH, MediaMTX under tools/mediamtx/, playwright,
  an unpacked Electron binary, a built desktop app
  (npm run build -w @livetap/desktop), and the studio driver at
  apps/desktop/e2e/broadcast.mjs.
`.trim();

const { opts } = parseArgs(process.argv.slice(2), { booleans: ['quick', 'keep', 'skip-grace', 'help'] });
if (opts.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const seconds = asNumber(opts.seconds, 12);
const cfg = loadConfig();

function log(line = '') {
  process.stdout.write(`${line}\n`);
}

const results = [];

function record(stage, status, detail) {
  results.push({ stage, status, detail });
}

/**
 * A missing piece is not the same failure as a broken one, and saying which is
 * the whole job of this script while several workstreams are still landing
 * code. `MISSING` always names the exact path or binary and the command that
 * supplies it, so nobody has to read this file to find out what to install or
 * build.
 */
class MissingPiece extends Error {
  constructor(what, fix) {
    super(what);
    this.name = 'MissingPiece';
    this.what = what;
    this.fix = fix;
  }
}

function run(command, args, { cwd = REPO_ROOT, timeoutMs = 600000, echo = false } = {}) {
  return new Promise((resolve) => {
    // argv array, shell: false. This harness runs under Git Bash, PowerShell
    // and plain node, and a command string would be re-parsed differently by
    // each of them.
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
      if (echo) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (echo) process.stdout.write(d);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(error.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The PASS/FAIL sentence a harness script ends on, without its detail lines. */
function lastVerdict(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => /^(PASS|FAIL)\b/.test(l.trim()));
  return line ? line.trim() : '';
}

function indent(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => `      ${l}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Preflight: every piece this chain needs, checked before a single claim
// ---------------------------------------------------------------------------

async function onPath(binary) {
  const result = await run(binary, ['-version'], { timeoutMs: 15000 });
  return result.code === 0;
}

async function preflight() {
  log('[preflight] the pieces this chain needs');

  for (const binary of ['ffmpeg', 'ffprobe']) {
    if (!(await onPath(binary))) {
      throw new MissingPiece(`${binary} is not on PATH`, 'install FFmpeg 7 or newer and put ffmpeg and ffprobe on PATH');
    }
    log(`  ok    ${binary} is on PATH`);
  }

  try {
    const binary = resolveMediaMtx(cfg);
    log(`  ok    MediaMTX at ${path.relative(REPO_ROOT, binary)}`);
  } catch (error) {
    if (error instanceof MissingBinaryError) {
      throw new MissingPiece(
        'the MediaMTX binary is missing',
        'download MediaMTX and extract it into tools/mediamtx/ (infra/dev-harness/ingest/README.md has the exact steps)',
      );
    }
    throw error;
  }

  try {
    await import('playwright');
    log('  ok    playwright is installed');
  } catch {
    throw new MissingPiece('playwright is not installed, so the desktop app cannot be driven', 'npm install');
  }

  // Electron ships its binary as a post-install download, and an empty dist/
  // beside a blank path.txt is the shape that failure takes. Catching it here
  // turns a twenty second Playwright timeout into one line.
  const electronPathFile = path.join(REPO_ROOT, 'node_modules', 'electron', 'path.txt');
  const electronDist = path.join(REPO_ROOT, 'node_modules', 'electron', 'dist');
  const electronName = fs.existsSync(electronPathFile) ? fs.readFileSync(electronPathFile, 'utf8').trim() : '';
  if (!electronName || !fs.existsSync(path.join(electronDist, electronName))) {
    throw new MissingPiece('the Electron binary is not unpacked in node_modules/electron/dist', 'npm rebuild electron');
  }
  log(`  ok    the Electron binary is unpacked (${electronName})`);

  for (const rel of [path.join('dist', 'main', 'index.cjs'), path.join('dist', 'renderer', 'app.html')]) {
    if (!fs.existsSync(path.join(DESKTOP_DIR, rel))) {
      throw new MissingPiece(
        `the desktop app is not built: apps/desktop/${rel.split(path.sep).join('/')} is missing`,
        'npm run build -w @livetap/desktop',
      );
    }
  }
  log('  ok    the desktop app is built (main + renderer)');

  const driver = path.join(DESKTOP_DIR, 'e2e', 'broadcast.mjs');
  if (!fs.existsSync(driver)) {
    throw new MissingPiece(
      'the studio driver apps/desktop/e2e/broadcast.mjs is missing, so nothing here can drive the real UI',
      'that file belongs with the desktop app; without it the product half of this chain cannot run at all',
    );
  }
  log('  ok    the studio driver apps/desktop/e2e/broadcast.mjs is present');
  return driver;
}

// ---------------------------------------------------------------------------
// Stage 1: the receiver is honest, before the product is blamed
// ---------------------------------------------------------------------------

async function stageSelftest() {
  log('');
  log('[1/4] proving the receiver is honest, with no product involved');
  const result = await run(process.execPath, [path.join(INGEST_DIR, 'selftest.mjs'), '--seconds=6'], {
    timeoutMs: 180000,
  });
  const verdict = lastVerdict(result.stdout);
  if (result.code === 0) {
    record('receiver self-test', 'PASS', verdict);
    log(`  ok    ${verdict}`);
    return true;
  }
  record('receiver self-test', 'FAIL', verdict || `selftest.mjs exited ${String(result.code)}`);
  log(indent(result.stdout));
  log(indent(result.stderr));
  log('  FAIL  the receiver itself did not pass. Nothing below this line would have meant anything.');
  return false;
}

// ---------------------------------------------------------------------------
// Stage 3: the product, driven through its own UI
// ---------------------------------------------------------------------------

async function stageBroadcast(driver) {
  log('');
  log('[3/4] driving the built desktop app to a real broadcast');
  log('      (apps/desktop/e2e/broadcast.mjs, its output follows verbatim)');
  log('');
  const result = await run(process.execPath, [driver, `--seconds=${seconds}`], {
    cwd: DESKTOP_DIR,
    timeoutMs: 420000,
    echo: true,
  });
  const verdict = lastVerdict(result.stdout) || `the driver exited ${String(result.code)} without a verdict line`;
  if (result.code === 0) {
    record('real broadcast, two shapes, failure isolation, END', 'PASS', verdict);
    return true;
  }
  record('real broadcast, two shapes, failure isolation, END', 'FAIL', verdict);
  if (result.stderr.trim()) log(indent(result.stderr));
  return false;
}

// ---------------------------------------------------------------------------
// Stage 4: END must not depend on a screen staying mounted
// ---------------------------------------------------------------------------

/**
 * Press END, then leave the studio before the grace period is over.
 *
 * This is here because the obvious way to write a grace period is a timer in
 * the screen's own effect, and unmounting the screen then cancels the stop
 * while the app goes on calling itself live. "Press END and click away" is
 * exactly what a creator does before closing a laptop, so a stop a route
 * change can cancel is a broadcast that never ends.
 *
 * It drives the studio through `studio-controls.mjs`, which is the same module the studio driver
 * uses: these two scripts press the same two controls, and the last time they each owned a private
 * copy of the selectors both went on clicking a button that the product had correctly removed.
 *
 * It has to create its own destination rather than reuse the ones stage 3
 * left behind: stream keys are deliberately not persisted (see the restore
 * block in the web app's store), so a destination restored from a previous
 * session comes back needing its key and cannot go live. The few selectors
 * everything else about the studio is that driver's business, not this script's.
 */
async function stageGracePeriod() {
  log('');
  log('[4/4] pressing END and leaving the studio before the grace period expires');
  const { _electron: electron } = await import('playwright');
  const rtmpBase = `rtmp://${cfg.host}:${cfg.rtmpPort}`;

  const app = await electron.launch({
    args: [
      DESKTOP_DIR,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
    cwd: DESKTOP_DIR,
  });
  try {
    const win = await app.firstWindow();
    win.setDefaultTimeout(15000);
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(2000);

    // Worth saying out loud on every run: the destinations stage 3 created are
    // still listed, and still cannot go live, because their keys were not kept.
    const restored = await win.evaluate(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem('livetap.destinations') ?? 'null');
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    });
    if (restored > 0) {
      log(`  note  ${restored} destination(s) from the last session came back needing their key again`);
    }

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

    await win.evaluate(() => {
      location.hash = '#/app/destinations';
    });
    await win.waitForTimeout(800);
    await win
      .getByRole('button', { name: /Add destination|Add your first destination/i })
      .first()
      .click();
    await win.waitForTimeout(400);
    await win.locator('.lt-addrow', { hasText: 'Custom RTMP' }).first().click();
    await win.waitForTimeout(400);
    await win.getByLabel('Name for this destination').fill('Grace period');
    await win.getByLabel('Server address').fill(`${rtmpBase}/live`);
    await win.getByLabel('Stream key').fill('grace');
    await win.getByRole('button', { name: 'Save this destination' }).click();
    await win.waitForTimeout(1200);
    log('  ok    one Custom RTMP destination created for this stage');

    await win.evaluate(() => {
      location.hash = '#/app';
    });
    await win.waitForTimeout(1500);
    const tap = await goLive(win);
    if (tap.confirmed) log(`  ok    the app asked before touching real accounts (${tap.destinations})`);

    // The countdown runs inside the button, and only then do publishers appear.
    const liveBy = Date.now() + 40000;
    let count = 0;
    while (Date.now() < liveBy) {
      count = (await listPublishers(cfg)).length;
      if (count > 0) break;
      await win.waitForTimeout(1000);
    }
    if (count === 0) {
      record('END survives leaving the studio', 'FAIL', 'the app never reached a live publisher in this run');
      log('  FAIL  no publisher ever connected, so there was no broadcast to end');
      return false;
    }
    log(`  ok    ${count} publisher(s) connected`);

    await win.waitForTimeout(3000);
    await pressEnd(win);
    // Leave immediately. This is the move that used to cancel the stop.
    await win.evaluate(() => {
      location.hash = '#/app/destinations';
    });
    log('  ...   END pressed, studio left, waiting 12 s for the publishers to go');

    const goneBy = Date.now() + 12000;
    let remaining = count;
    while (Date.now() < goneBy) {
      remaining = (await listPublishers(cfg)).length;
      if (remaining === 0) break;
      await sleep(500);
    }
    if (remaining === 0) {
      record('END survives leaving the studio', 'PASS', 'every publisher was gone within 12 s of END');
      log('  ok    every publisher is gone, even though the studio was unmounted mid-grace');
      return true;
    }
    record(
      'END survives leaving the studio',
      'FAIL',
      `${remaining} publisher(s) were still connected 12 s after END; leaving the studio cancelled the stop`,
    );
    log(`  FAIL  ${remaining} publisher(s) are still broadcasting 12 s after END`);
    return false;
  } finally {
    await app.close().catch(() => undefined);
    // A publisher this stage failed to stop would poison the next run's
    // evidence, so it is dropped here rather than left for someone to find.
    const stragglers = await listPublishers(cfg).catch(() => []);
    for (const publisher of stragglers) {
      await run(process.execPath, [path.join(INGEST_DIR, 'kill-publisher.mjs'), '--any-path', `--id=${publisher.id}`], {
        timeoutMs: 20000,
      });
    }
  }
}

// ---------------------------------------------------------------------------

async function receiverIsUp() {
  try {
    const res = await fetch(`${cfg.apiBase}/v3/paths/list`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  log('LIVETAP alpha completion gate');
  log(`  repo        ${REPO_ROOT}`);
  log(`  receiver    rtmp://${cfg.host}:${cfg.rtmpPort}   control API ${cfg.apiBase}`);
  log('');

  const driver = await preflight();

  if (opts.quick) {
    record('receiver self-test', 'SKIPPED', '--quick was passed');
    log('');
    log('[1/4] skipped: --quick');
  } else if (!(await stageSelftest())) {
    return finish();
  }

  log('');
  log('[2/4] starting the receiver');
  let server = null;
  if (await receiverIsUp()) {
    log('  ok    a receiver is already listening; using it, and leaving it running afterwards');
    record('receiver running', 'PASS', 'an existing receiver was reused');
  } else {
    server = startMediaMtx(cfg);
    await server.ready();
    log(`  ok    MediaMTX is accepting RTMP on ${cfg.host}:${cfg.rtmpPort}`);
    record('receiver running', 'PASS', 'MediaMTX was started by this script');
  }

  try {
    const broadcastOk = await stageBroadcast(driver);
    if (opts['skip-grace']) {
      record('END survives leaving the studio', 'SKIPPED', '--skip-grace was passed');
    } else if (!broadcastOk) {
      record(
        'END survives leaving the studio',
        'SKIPPED',
        'the broadcast stage failed, so there was no live broadcast to end',
      );
    } else {
      await stageGracePeriod();
    }
  } finally {
    if (server && !opts.keep) {
      await server.stop();
      log('');
      log('  receiver stopped. Recordings are kept under infra/dev-harness/ingest/recordings/.');
    }
  }

  finish();
}

function finish() {
  const failed = results.filter((r) => r.status === 'FAIL');
  const width = Math.max(...results.map((r) => r.stage.length), 10);
  log('');
  log('  ---------------------------------------------------------------------------');
  for (const r of results) {
    log(`  ${r.status.padEnd(9)}${r.stage.padEnd(width + 2)}${r.detail}`);
  }
  log('  ---------------------------------------------------------------------------');
  log('');

  if (failed.length > 0) {
    log(`FAIL  ${failed.length} of ${results.length} stages did not pass. LIVETAP is not proven real on this host.`);
    process.exitCode = 1;
    return;
  }
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  log('PASS  the built desktop app captured through the real getUserMedia path, composed one picture');
  log('      per aspect ratio, encoded with Chromium and ffmpeg, and published two real RTMP streams');
  log('      that a real server accepted and ffprobe decoded. One destination was dropped at the TCP');
  log('      level mid-broadcast and the other kept climbing. END stopped everything.');
  if (skipped.length > 0) {
    log('');
    log(`      ${skipped.length} stage(s) were skipped and prove nothing: ${skipped.map((s) => s.stage).join(', ')}.`);
  }
}

main().catch((error) => {
  log('');
  if (error instanceof MissingPiece) {
    log(`MISSING  ${error.what}`);
    log(`         fix: ${error.fix}`);
    log('');
    log('FAIL  the chain could not run, so nothing about LIVETAP was proven or disproven here.');
  } else {
    log(`FAIL  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  process.exit(1);
});
