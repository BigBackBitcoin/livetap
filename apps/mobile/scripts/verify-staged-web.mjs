#!/usr/bin/env node
/**
 * Assert that `apps/mobile/www` is a REAL build of the app, before either platform packages it.
 *
 * Both phones stage the same bundle. `build-android.sh` already proves this about the finished
 * APK — but only after Gradle has run, which needs a JDK and an Android SDK, and iOS cannot be
 * built at all without a Mac. That left the shared step, the one both platforms depend on,
 * checked on exactly one of them and only at the end.
 *
 * THE DEFECT THIS EXISTS TO PREVENT is not hypothetical and has already shipped once in this
 * product. `envMockMode()` is `import.meta.env.VITE_LIVETAP_MOCK_MODE !== 'false'`, Vite
 * constant-folds it at build time, and anything other than the literal string "false" leaves a
 * hardcoded `return true` in the bundle: simulated adapters, a simulated engine, and an app that
 * cannot put a byte on the wire however real the destination is. The desktop app shipped exactly
 * that way, and `npm run sync:ios` — a bare `cap sync ios` with no build step in front of it —
 * stages whatever happens to be sitting in `apps/web/dist`, which defaults to mock mode.
 *
 * So this runs on the staged directory, on any operating system, before the platform build:
 *
 *   node apps/mobile/scripts/verify-staged-web.mjs
 *
 * Exit 0 if the bundle is real, 1 with the reason if it is not.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WWW = resolve(here, '..', 'www');

const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

if (!existsSync(WWW)) {
  process.stdout.write(
    `FAIL  ${WWW} does not exist.\n      Run: npm run build -w @livetap/web && node apps/mobile/scripts/stage-web.mjs\n`,
  );
  process.exit(1);
}

/* 1. The application, not the marketing page. Capacitor loads index.html; the web build emits the
      app at app.html, so stage-web.mjs promotes it. A www/ whose index.html is the landing page
      is a phone that installed a brochure. */
const indexPath = join(WWW, 'index.html');
const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
check('index.html exists', index !== '');
check(
  'index.html is the application, not the marketing page',
  index.includes('id="root"') || index.includes('/assets/app-'),
  'looked for the app mount point or an app-* bundle reference',
);
check('app.html was promoted and removed', !existsSync(join(WWW, 'app.html')));

/* 2. No reference into /brand/, which stage-web.mjs deliberately does not copy. A dangling
      <link> logs a 404 into the one console an owner reads when something else is wrong. */
check(
  'no <link> points into /brand/',
  !/\<link[^>]+\/brand\//.test(index),
  'marketing imagery is not staged to the phone',
);

/* 3. THE ONE THAT MATTERS. Every constant-folded `envMockMode()` in the bundle must compare
      against the literal "false". Same technique verify-apk.mjs uses on the finished APK, applied
      one stage earlier so it protects both platforms. */
const assetsDir = join(WWW, 'assets');
const scripts = existsSync(assetsDir)
  ? readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
  : [];
check('the bundle has JavaScript assets', scripts.length > 0, `${scripts.length} .js files`);

const comparisons = [];
for (const file of scripts) {
  const source = readFileSync(join(assetsDir, file), 'utf8');
  for (const m of source.matchAll(/return"([^"]*)"!=="false"/g)) comparisons.push(m[1]);
}
check(
  'demo mode is compiled out (VITE_LIVETAP_MOCK_MODE=false reached the build)',
  comparisons.length > 0 && comparisons.every((v) => v === 'false'),
  comparisons.length === 0
    ? 'no folded mock-mode comparison found — the bundle may predate the flag, or Vite did not fold it'
    : `folded values: ${[...new Set(comparisons)].map((v) => JSON.stringify(v)).join(', ')}`,
);

/* 4. Size, as a crude but effective guard against staging an empty or half-copied tree. */
const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (total, d) => total + (d.isDirectory() ? bytes(join(dir, d.name)) : statSync(join(dir, d.name)).size),
    0,
  );
const total = bytes(WWW);
check('the staged bundle is a plausible size', total > 200 * 1024, `${(total / 1024).toFixed(0)} KB`);

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  process.stdout.write(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}\n`);
}
process.stdout.write('\n');
if (failed.length > 0) {
  process.stdout.write(
    `FAIL  ${failed.length} of ${results.length} checks failed. This bundle must not be packaged.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `PASS  ${results.length} checks. apps/mobile/www is a real build of the application and is safe to package.\n`,
);
