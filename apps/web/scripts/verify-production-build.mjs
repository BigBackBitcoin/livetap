#!/usr/bin/env node
/**
 * Assert that `apps/web/dist` is a REAL production build before it is deployed.
 *
 * Every packaged surface already has one of these — `verify-apk.mjs` for Android,
 * `verify-installer.mjs` for Windows, `verify-staged-web.mjs` for the bundle both phones stage.
 * The web deployment, which is the surface people actually visit, had none. So the one build that
 * ships to the most people was the only one nothing checked.
 *
 * THE DEFECT THIS EXISTS TO PREVENT has already shipped twice in this product in different
 * clothes. `envMockMode()` is `import.meta.env.VITE_LIVETAP_MOCK_MODE !== 'false'`, Vite
 * constant-folds it, and anything but the literal string "false" leaves a hardcoded `return true`
 * in the bundle: simulated adapters, a simulated engine, and an app that cannot put a byte on the
 * wire however real the destination is. The desktop app shipped exactly that way. And a build that
 * IS real but has no relay behind it is the same failure wearing a different hat — a browser has
 * no RTMP socket, so with no relay configured every RTMP destination is refused at GO LIVE and the
 * product does nothing it claims to.
 *
 * Deliberately NOT a check that mock mode is off everywhere. Mock mode is a first-class,
 * visibly-labelled provider set (ADR-007) and the hosted demo is honestly a demo — it says so on
 * the landing page in its own voice. This verifier is for the deployment that claims to be real.
 *
 *   node apps/web/scripts/verify-production-build.mjs
 *
 * Exit 0 if the build is a real one, 1 with the reason if it is not. Run it in the SAME shell that
 * ran the build: several checks prove an environment variable actually reached the bundle, which
 * means comparing what was set against what was compiled in.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, '..', 'dist');

const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

if (!existsSync(DIST)) {
  process.stdout.write(
    `FAIL  ${DIST} does not exist.\n      Run: npm run build -w @livetap/web\n`,
  );
  process.exit(1);
}

const read = (name) => (existsSync(join(DIST, name)) ? readFileSync(join(DIST, name), 'utf8') : '');

/* ---------------------------------------------------------------- the documents */

const landing = read('index.html');
const app = read('app.html');
check('index.html exists (the landing document)', landing !== '');
check('app.html exists (the application document)', app !== '');
check(
  '404.html exists, so an address that matches nothing gets a real 404',
  existsSync(join(DIST, '404.html')),
  'Vercel serves it with a 404 status; without it an unknown path returns 200',
);

/* ---------------------------------------- the bundle, and what the build compiled into it */

const assetsDir = join(DIST, 'assets');
const scripts = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => f.endsWith('.js')) : [];
check('the build produced JavaScript assets', scripts.length > 0, `${scripts.length} .js files`);
const source = scripts.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n');

/*
 * THE ONE THAT MATTERS MOST. Every constant-folded `envMockMode()` must compare against the
 * literal "false" — the same technique verify-apk.mjs uses on the finished APK and
 * verify-staged-web.mjs uses on the staged bundle, applied to the web deployment.
 */
const comparisons = [...source.matchAll(/return"([^"]*)"!=="false"/g)].map((m) => m[1]);
check(
  'demo mode is compiled out (VITE_LIVETAP_MOCK_MODE=false reached the build)',
  comparisons.length > 0 && comparisons.every((v) => v === 'false'),
  comparisons.length === 0
    ? 'no folded mock-mode comparison found — the bundle may predate the flag, or Vite did not fold it'
    : `folded values: ${[...new Set(comparisons)].map((v) => JSON.stringify(v)).join(', ')}`,
);

/*
 * A production landing must not tell a visitor it is a demo, and a demo landing must say so. The
 * sentences are injected at build time into two named comments; a build that left the raw markers
 * behind is a build whose honesty plugin did not run.
 */
check(
  'the landing does not claim to be a demo',
  !/This hosted build is a demo/.test(landing) && !/runs in demo mode/.test(landing),
  'the demo-honesty sentences are injected only for demo builds',
);
check(
  'the demo-honesty markers were replaced, not left in the document',
  !landing.includes('<!--lt:demo-hero-->') && !landing.includes('<!--lt:demo-browser-->'),
);

/*
 * A browser has no RTMP socket. Without a relay, web GO LIVE refuses every RTMP destination with
 * CONFIG_INVALID — correctly, and to no one's benefit. This is the check that would have caught
 * the relay being fully built, fully tested, and unreachable.
 */
const relayUrl = (process.env.VITE_LIVETAP_RELAY_URL ?? '').trim();
check(
  'a relay is configured, so the browser can publish at all',
  relayUrl !== '',
  relayUrl === ''
    ? 'VITE_LIVETAP_RELAY_URL is empty — every RTMP destination will be refused at GO LIVE'
    : relayUrl,
);
check(
  'the relay URL reached the bundle',
  relayUrl === '' || source.includes(relayUrl),
  relayUrl === '' ? 'skipped: no relay URL set' : 'the built JavaScript contains the configured relay base',
);

/* ------------------------------------------------------------------------ secrets */

/*
 * NEVER PUT CLIENT SECRETS IN FRONTEND CODE. The broker holds them server-side and the `VITE_`
 * prefix is the only thing standing between an env var and the public bundle, so this compares
 * what the environment actually holds against what was compiled — a real leak, not a guess at
 * what one might look like.
 */
const secretNames = Object.keys(process.env).filter((k) =>
  /^LIVETAP_.*(CLIENT_SECRET|APP_SECRET|_TOKEN)$/.test(k),
);
const leaked = secretNames.filter((name) => {
  const value = (process.env[name] ?? '').trim();
  // Short or placeholder values would produce false positives against minified code.
  return value.length >= 8 && (source.includes(value) || landing.includes(value) || app.includes(value));
});
check(
  'no server-side secret was compiled into the browser bundle',
  leaked.length === 0,
  leaked.length === 0
    ? `${secretNames.length} server-side secret(s) checked`
    : `LEAKED: ${leaked.join(', ')} — rotate these immediately, they are public`,
);

/*
 * The relay token is deliberately exempt from the rule above and deliberately named here.
 * `VITE_LIVETAP_RELAY_TOKEN` is compiled in ON PURPOSE — infra/relay/README.md is explicit that it
 * is a shared relay credential rather than a user secret, fine for a single-tenant self-hosted
 * relay and NOT fine for a multi-user deployment. Stating it is better than letting a deployer
 * discover it.
 */
if ((process.env.VITE_LIVETAP_RELAY_TOKEN ?? '').trim() !== '') {
  check(
    'the relay token is public by design, and you have accepted that',
    true,
    'VITE_ variables are visible to anyone who opens the page; use per-user JWTs for multi-tenant',
  );
}

/* ------------------------------------------------------------------------ report */

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  process.stdout.write(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}\n`);
}
process.stdout.write('\n');
if (failed.length > 0) {
  process.stdout.write(
    `FAIL  ${failed.length} of ${results.length} checks failed. This build must not be deployed as a production LIVETAP.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `PASS  ${results.length} checks. apps/web/dist is a real production build and can broadcast.\n`,
);
