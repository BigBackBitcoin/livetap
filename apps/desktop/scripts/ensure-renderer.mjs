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
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');

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
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(placeholder, target);
  process.stdout.write(
    `renderer MISSING - wrote placeholder to ${target}\n` +
      'Run `npm run build:renderer -w @livetap/desktop` to package the real UI.\n',
  );
}
