/**
 * Make sure `dist/renderer/app.html` exists before packaging.
 *
 * The real renderer is built by `npm run build:renderer` (the React app from apps/web). This script
 * only fills the gap: if that build has not been run, it drops in a placeholder page that says so,
 * so the Electron shell and the whole electron-builder pipeline can still be exercised
 * independently of the web team's build.
 *
 * It never overwrites a real renderer — it only writes when the file is missing.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
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
