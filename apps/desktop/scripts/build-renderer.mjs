/**
 * Build the web application as the desktop renderer.
 *
 * This exists for one line of configuration that a bare `vite build` cannot carry portably:
 * VITE_LIVETAP_MOCK_MODE=false.
 *
 * `envMockMode()` treats anything other than the literal string "false" as demo mode, and Vite
 * constant-folds the value at build time, so a renderer built without it ships a hardcoded
 * "everything is simulated": mock adapters, a mock engine, and a desktop app that cannot put a
 * byte on the wire however real the destination is. That is the opposite of what the desktop
 * build is for. The web deployment stays in demo mode because it is a demo; the installed
 * application is the product.
 *
 * Set LIVETAP_DESKTOP_DEMO=1 to build a demo renderer on purpose, which is what the smoke test
 * wants when it only needs a window to open.
 *
 * A node wrapper rather than an npm script prefix because `VAR=value cmd` is shell syntax that
 * Windows cmd does not understand, and adding cross-env for one variable is a dependency this
 * repo does not need.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const web = resolve(root, 'apps', 'web');
const demo = process.env.LIVETAP_DESKTOP_DEMO === '1';

/*
 * Vite's own entry, not `npx vite`. On Windows the npx shim is a .cmd wrapper, and when this
 * script itself runs underneath `npm run build` that wrapper reports a failure even after Vite
 * has exited 0 and written the bundle. Spawning node on the real entry removes the shim, and with
 * it a build that printed success and then failed.
 */
const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(vite)) {
  console.error(`[renderer] vite not found at ${vite}. Run npm install at the repo root.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [vite, 'build', '--base', './', '--outDir', '../desktop/dist/renderer', '--emptyOutDir'],
  {
    cwd: web,
    stdio: 'inherit',
    env: { ...process.env, VITE_LIVETAP_MOCK_MODE: demo ? 'true' : 'false' },
  },
);

if (result.error) {
  console.error('[renderer] could not start vite:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[renderer] vite exited ${result.status}`);
  process.exit(result.status ?? 1);
}
console.log(`[renderer] built with mock mode ${demo ? 'ON (demo build)' : 'OFF (real build)'}`);
