/**
 * Stage the real web app into the Capacitor web directory.
 *
 * The mobile app is the SAME application as `/app` on the web, not a second implementation and
 * not the marketing page. Capacitor loads `index.html` from `webDir`, and the web build emits the
 * application at `app.html` (with the marketing page at `index.html`), so this script copies the
 * build and promotes `app.html` to `index.html`.
 *
 * What is deliberately NOT copied: the marketing page, its 404, and the public-experience assets
 * it needs. A phone that has installed the app does not need the page that sells the app.
 *
 *   node scripts/stage-web.mjs          # after `npm run build -w @livetap/web`
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(here, '..');
const WEB_DIST = resolve(MOBILE, '..', 'web', 'dist');
const WWW = join(MOBILE, 'www');

/** Marketing-only files that must never reach the phone bundle. */
const SKIP = new Set(['index.html', '404.html', 'brand']);

if (!existsSync(join(WEB_DIST, 'app.html'))) {
  console.error(
    `[stage-web] ${WEB_DIST}/app.html is missing. Run "npm run build -w @livetap/web" first.`,
  );
  process.exit(1);
}

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });

let copied = 0;
for (const entry of readdirSync(WEB_DIST)) {
  if (SKIP.has(entry)) continue;
  const from = join(WEB_DIST, entry);
  const to = join(WWW, entry);
  cpSync(from, to, { recursive: true });
  copied += statSync(from).isDirectory() ? readdirSync(from).length : 1;
}

/*
 * `app.html` becomes `index.html`. Its asset URLs are absolute (`/assets/...`), which is correct
 * here: Capacitor serves the bundle from `https://localhost/` on Android and `capacitor://localhost`
 * on iOS, so an absolute path resolves inside the bundle rather than reaching the network.
 */
const app = readFileSync(join(WWW, 'app.html'), 'utf8');
writeFileSync(join(WWW, 'index.html'), app);
rmSync(join(WWW, 'app.html'));

const bytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (total, d) => total + (d.isDirectory() ? bytes(join(dir, d.name)) : statSync(join(dir, d.name)).size),
    0,
  );

console.log(
  `[stage-web] staged ${copied} entries, ${(bytes(WWW) / 1024).toFixed(0)} KB, into ${WWW} (app.html -> index.html)`,
);
