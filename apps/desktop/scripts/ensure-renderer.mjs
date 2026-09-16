/**
 * The `prepackage` step: make sure everything electron-builder needs is on disk before it runs.
 *
 * Two things, in this order.
 *
 * 1. FFMPEG. `tools/acquire-ffmpeg.mjs` puts a real ffmpeg + ffprobe into
 *    `resources/ffmpeg/<platform>/`, which `extraResources` copies into the installer. Without them
 *    the packaged app resolves `source: 'unavailable'` and reports UNAVAILABLE forever: an
 *    installer that cannot broadcast. This is a HARD failure — better no installer than a silent
 *    one that cannot stream.
 *
 *    It is invoked from here rather than from a second npm script because `prepackage` is the hook
 *    `package`, `package:win` and `package:mac` already run, so wiring it here means every
 *    packaging path picks it up and none can forget. Set LIVETAP_SKIP_FFMPEG=1 to package the
 *    shell alone when deliberately exercising the electron-builder pipeline and nothing else.
 *
 * 2. THE RENDERER: make sure `dist/renderer/app.html` exists.
 *
 * The real renderer is built by `npm run build:renderer` (the React app from apps/web). This script
 * only fills the gap: if that build has not been run, it drops in a placeholder page that says so,
 * so the Electron shell and the whole electron-builder pipeline can still be exercised
 * independently of the web team's build.
 *
 * It never overwrites a real renderer — it only writes when the file is missing.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describeIdentity, identify } from './renderer-identity.mjs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');

/* ------------------------------------------------------- 0. a Node that can do this */

/*
 * electron-builder 26 needs Node >= 20.19, and fails 90 seconds in with a stack trace about
 * `require() of ES Module @noble/hashes/blake2.js` when it does not have one. That message names
 * a dependency nobody here has heard of, says nothing about Node, and - because it arrives after
 * the renderer and FFmpeg steps have already succeeded - leaves a stale installer sitting in
 * release/ that looks like the one you just built. It is not: it is the one from last time, and
 * its SHA-256 matches the last build's exactly, which is the single most convincing way to be
 * wrong about what you are shipping.
 *
 * This host's system Node is 20.11 and `tools/node22/` holds a portable 22. Refuse early and say
 * which command to use.
 */
const MIN_NODE = [20, 19];
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  const lines = [
    `[prepackage] Node ${process.versions.node} cannot run electron-builder 26 (needs >= ${MIN_NODE.join(".")}).`,
    "            It would fail deep inside the blockmap step and leave the PREVIOUS installer",
    "            in release/, looking newly built.",
    "",
    "            On this host:",
    '              PATH="$PWD/tools/node22/node:$PATH" npm run package:win -w @livetap/desktop',
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ 1. FFmpeg */

if (process.env.LIVETAP_SKIP_FFMPEG === '1') {
  process.stdout.write(
    'LIVETAP_SKIP_FFMPEG=1 - packaging WITHOUT ffmpeg. The resulting app cannot broadcast.\n',
  );
} else {
  const acquire = path.join(repoRoot, 'tools', 'acquire-ffmpeg.mjs');
  const result = spawnSync(process.execPath, [acquire], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    process.stderr.write(
      'prepackage: ffmpeg is not in place, so the packaged app could not broadcast. ' +
        'The message above names exactly what is missing and where to put it. ' +
        'Re-run `node tools/acquire-ffmpeg.mjs`, or set LIVETAP_SKIP_FFMPEG=1 to package the ' +
        'shell on purpose.\n',
    );
    process.exit(result.status ?? 1);
  }
}

/* ---------------------------------------------------------------- 2. renderer */

const target = path.join(appDir, 'dist', 'renderer', 'app.html');
const placeholder = path.join(appDir, 'packaging', 'renderer-placeholder.html');

if (existsSync(target)) {
  process.stdout.write(`renderer present: ${target}\n`);

  /*
   * EXISTS IS NOT THE SAME QUESTION AS WHICH.
   *
   * This used to stop at `existsSync`, so `package:win` shipped whatever renderer happened to be
   * on disk — from any commit, of any age — and the verifier's staleness checks still passed,
   * because the `.asar` genuinely matched `dist/renderer`. They agreed with each other about
   * something stale. One such artifact read 32/33 while carrying pre-commit code, and the only
   * reason it was caught is that the identity check existed downstream.
   *
   * Refusing HERE rather than only at verify buys three things. It fails in two seconds instead
   * of after six minutes and 230 MB, which is exactly the point at which somebody stops checking.
   * It closes the path where `verify-installer` is never run at all, since `package:win` would
   * otherwise produce a shippable file with no gate between the build and the disk. And it is the
   * same rule in both places, so the two cannot drift apart the way A and B did.
   *
   * It is a refusal, never a rebuild: a rebuild hidden inside packaging is a second place the
   * renderer can be built, and an implicit step makes "which build is this" harder to answer —
   * which is the question this check exists to make answerable.
   */
  const modePath = path.join(appDir, 'dist', 'renderer', 'build-mode.json');
  const mode = existsSync(modePath) ? JSON.parse(readFileSync(modePath, 'utf8')) : {};
  const identity = identify(mode, { unversioned: process.argv.includes('--unversioned') });
  if (!identity.ok) {
    process.stderr.write(
      `\nrenderer CANNOT BE IDENTIFIED: ${identity.detail}\n` +
        'Run: npm run build -w @livetap/desktop\n' +
        'Packaging refused rather than producing an artifact nobody can trace to a commit.\n',
    );
    process.exit(1);
  }
  process.stdout.write(`renderer identity: ${describeIdentity(identity)}\n`);
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(placeholder, target);
  process.stdout.write(
    `renderer MISSING - wrote placeholder to ${target}\n` +
      'Run `npm run build:renderer -w @livetap/desktop` to package the real UI.\n',
  );
}
