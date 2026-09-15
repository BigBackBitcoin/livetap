#!/usr/bin/env node
/**
 * The test that decides whether a creator can connect a real account through LIVETAP itself.
 *
 * Everything in this repository that makes real social sign-in possible had been written and
 * unit-tested; nothing had ever been run together, through the product's own UI, once. This
 * launches the BUILT desktop app under Playwright, taps the YouTube row in the real Add
 * destination sheet, and then asks somebody other than the UI whether it worked.
 *
 * WHICH LINKS ARE REAL
 *
 *   window.livetap.oauth bridge     real contextBridge IPC (preload -> main)
 *   LoopbackOAuthServer             real ephemeral 127.0.0.1 listener, real state check (RFC 8252)
 *   generatePkce / buildAuthorizeUrl real; the authorize URL's query string is the product's, byte
 *                                   for byte, and is passed to the IdP unaltered
 *   the consent screen              the fake IdP's real HTML page and its real /authorize/decision
 *   apps/web/api/oauth/*.ts         the REAL Vercel handlers, bundled from source and run in a
 *                                   local https front end (infra/dev-harness/fake-idp/harness-broker.mjs)
 *   apps/web/api/_lib/broker.ts     real: same-origin check, rate limit, validation, exchange
 *   fake IdP                        real OAuth 2.0: constant-time S256 PKCE check, single-use
 *                                   60 s codes, rotating refresh tokens, real revocation
 *   tokens.ts + Electron safeStorage real vault write, real token provider, real refresh
 *   YouTubeAdapter.validate         real adapter, real HTTP, real account lookup
 *   the Destinations screen         real React, real store, no test hooks, no injected registry
 *
 * WHICH LINKS WERE REDIRECTED, AND WHY — there are four, and nothing else was touched.
 *
 *   1. THE SYSTEM BROWSER. `shell.openExternal` is replaced in the MAIN process (via Playwright's
 *      `electronApp.evaluate`) so it records the URL instead of launching a browser this headless
 *      host does not have. The renderer bridge, the IPC channel and main's own `isHttpsUrl` /
 *      `isExternallyOpenable` guards all still run; only the last call is intercepted. The
 *      harness then plays the human: it GETs the authorize URL, reads the consent page, and
 *      follows the Approve link, so the redirect lands on the loopback listener exactly as a
 *      browser's would. This is the one step a person performs, and the only one replaced.
 *   2. THE PLATFORM'S HOSTNAME. The captured authorize URL's origin and path
 *      (`https://accounts.google.com/o/oauth2/v2/auth`) are swapped for the fake IdP's
 *      `/youtube/authorize`. Every query parameter the product built is forwarded untouched.
 *      The same swap is applied to `https://www.googleapis.com/youtube/v3` by a `window.fetch`
 *      wrapper that rewrites that one prefix and nothing else — the equivalent of a hosts file,
 *      needed because `apps/web/src/state/registry.ts` gives `YouTubeAdapter` no `apiBase` seam.
 *      The broker's own upstream is redirected by the product's OWN documented switch,
 *      `LIVETAP_OAUTH_BASE`, with nothing patched at all.
 *   3. TLS ON LOOPBACK. The renderer is a `file://` document under the production CSP
 *      (`connect-src 'self' https: wss:`), which refuses plain http even to 127.0.0.1 — measured,
 *      not assumed. So the broker speaks https with a certificate this run generates, and
 *      Chromium is told to accept that ONE certificate by SPKI pin
 *      (`--ignore-certificate-errors-spki-list`). TLS validation is not disabled.
 *   4. `Sec-Fetch-Site`. Chromium sends `Sec-Fetch-Site: cross-site` from a `file://` renderer and
 *      `assertSameOrigin` in `apps/web/api/_lib/broker.ts` answers 403. That is a PRODUCT DEFECT,
 *      not a harness problem, so the run measures it first with the header intact and only then
 *      drops it, to find out what the rest of the chain does. Both results are reported.
 *
 * WHAT IS NOT PROVEN HERE: that Google accepts these exact requests. Only a real Google client id
 * can prove that. This proves LIVETAP's half, end to end, through its own UI.
 *
 * Requires nothing running beforehand: it builds the app, generates a certificate (openssl), and
 * starts the fake IdP and the broker itself. It holds `infra/dev-harness/broadcast/runlock.mjs`
 * for the whole run because it launches Electron.
 *
 * Exit 0 on PASS, 1 on FAIL. One PASS/FAIL line at the end, and nothing above it is a claim that
 * was not measured.
 *
 *   npm run e2e:oauth -w @livetap/desktop
 *   node apps/desktop/e2e/oauth.mjs --keep-build
 */
import { _electron as electron } from 'playwright';
import { acquire } from '../../../infra/dev-harness/broadcast/runlock.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const idpDir = path.join(repoRoot, 'infra', 'dev-harness', 'fake-idp');

const args = process.argv.slice(2);
const readArg = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};
const keepBuild = args.includes('--keep-build');

const IDP_PORT = Number(readArg('--idp-port') ?? 8789);
const BROKER_PORT = Number(readArg('--broker-port') ?? 8790);
const IDP_BASE = `http://127.0.0.1:${IDP_PORT}`;
const BROKER_BASE = `https://127.0.0.1:${BROKER_PORT}`;
const CLIENT_ID = 'livetap-dev-client';
const CLIENT_SECRET = 'livetap-dev-secret';
/**
 * Short enough that `REFRESH_MARGIN_MS` (60 s, apps/web/src/state/tokens.ts) is reachable inside a
 * test run, long enough that a token minted at the start of a connect is still outside the margin
 * when `validate()` uses it a second later. Both halves of the refresh proof depend on this.
 */
const TOKEN_TTL_S = 75;
const REFRESH_MARGIN_MS = 60_000;
/** The fake IdP's constant account, from its own defaults. This is the name the card must show. */
const EXPECTED_ACCOUNT = 'LIVETAP Dev Channel';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_API = 'https://www.googleapis.com/youtube/v3';

const lines = [];
const findings = [];
let failed = false;
/** Kept so a thrown error can say what was on screen rather than only which selector missed. */
let window_ = null;

function ok(message) {
  lines.push(`  ok    ${message}`);
}

function bad(message) {
  failed = true;
  lines.push(`  FAIL  ${message}`);
}

function note(message) {
  lines.push(`  note  ${message}`);
}

/** A defect worth a line in the report, ranked, with the file that owns it. */
function finding(severity, where, message) {
  findings.push({ severity, where, message });
  lines.push(`  ${severity.padEnd(8)} ${message}`);
  lines.push(`           ${where}`);
}

function step(message) {
  lines.push('');
  lines.push(message);
  process.stdout.write(`${message}\n`);
}

/* ------------------------------------------------------------------ processes and files */

const children = [];

function start(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  const out = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => out.push(String(d).trimEnd()));
  child.stderr.on('data', (d) => out.push(String(d).trimEnd()));
  children.push(child);
  return { child, out };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/* ------------------------------------------------------------------ the two control surfaces */

/** The fake IdP's own account of what it saw. This is the ground truth, not the UI. */
async function idp(pathname = '/_control', init) {
  const res = await fetch(`${IDP_BASE}${pathname}`, init);
  if (!res.ok) throw new Error(`fake IdP ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function idpControl(op) {
  return idp('/_control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(op),
  });
}

/**
 * The harness broker's journal. Talked to over TLS with verification off IN THIS PROCESS ONLY —
 * the app itself verifies the certificate against the SPKI pin.
 */
async function broker(pathname, init) {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const res = await fetch(`${BROKER_BASE}${pathname}`, init);
    return await res.json();
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
  }
}

/* ------------------------------------------------------------------ certificate */

function opensslPath() {
  for (const candidate of ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', '/usr/bin/openssl']) {
    const probe = spawnSync(candidate, ['version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('openssl is not on PATH. It generates the loopback certificate this run needs.');
}

/**
 * A throwaway certificate for 127.0.0.1, plus the SPKI hash Chromium is pinned to.
 *
 * The key never touches the repository and the directory is deleted at the end of the run. The
 * pin is what keeps this from being "TLS turned off": exactly one certificate is trusted, the one
 * generated seconds earlier by this process.
 */
function makeCertificate(dir) {
  const openssl = opensslPath();
  const cert = path.join(dir, 'harness-cert.pem');
  const key = path.join(dir, 'harness-key.pem');
  const gen = spawnSync(
    openssl,
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'],
    { encoding: 'utf8' },
  );
  if (gen.status !== 0) throw new Error(`openssl could not make a certificate: ${gen.stderr?.slice(0, 300)}`);
  /*
   * Through FILES, not pipes. On Windows, openssl writes its stdout in text mode, so DER crossing
   * a pipe comes back with every 0x0A turned into 0x0D 0x0A — a digest that is still 32 bytes long
   * and completely wrong, which presents as "the renderer cannot reach the broker" and nothing else.
   */
  const pubPem = path.join(dir, 'harness-spki.pem');
  const spkiDer = path.join(dir, 'harness-spki.der');
  spawnSync(openssl, ['x509', '-in', cert, '-pubkey', '-noout', '-out', pubPem]);
  spawnSync(openssl, ['pkey', '-pubin', '-in', pubPem, '-outform', 'der', '-out', spkiDer]);
  if (!fs.existsSync(spkiDer)) throw new Error('openssl could not export the public key');
  const spki = createHash('sha256').update(fs.readFileSync(spkiDer)).digest('base64');
  return { cert, key, spki };
}

/* ------------------------------------------------------------------ the renderer build */

/** Every JS chunk of the built renderer. Used to read constants Vite folded into the bundle. */
function rendererChunks() {
  const assets = path.join(appDir, 'dist', 'renderer', 'assets');
  if (!fs.existsSync(assets)) return [];
  return fs
    .readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(assets, f), 'utf8'));
}

/**
 * What `brokerBaseUrl()` was compiled to — which is not the same question as what the source says.
 *
 * Vite constant-folds `import.meta.env.VITE_LIVETAP_BROKER_URL`, so the shipped bundle contains
 * `function X(){return"<base>".replace(/\/+$/,"")}`. Reading it back is the only way to know what
 * an INSTALLED app would actually call. The function is found through its one unmistakable use,
 * `${X()}/api/oauth/config`, rather than by pattern-matching the body: `engine.ts` folds the relay
 * URL with the identical `.replace(/\/+$/,"")` shape and would otherwise be read instead.
 */
function foldedBrokerBase(chunks) {
  const names = new Set();
  for (const text of chunks) {
    for (const match of text.matchAll(/\$\{(\w+)\(\)\}\/api\/oauth\/config/g)) names.add(match[1]);
  }
  for (const name of names) {
    for (const text of chunks) {
      const hit = new RegExp(`function ${name}\\(\\)\\{return"([^"]*)"\\.replace`).exec(text);
      if (hit) return hit[1];
    }
  }
  return null;
}

async function buildRenderer(env = {}) {
  const result = await run(
    process.execPath,
    [path.join(appDir, 'scripts', 'build-renderer.mjs')],
    { env: { ...process.env, ...env } },
  );
  if (result.code !== 0) {
    throw new Error(`the renderer build failed (exit ${result.code}): ${result.stderr.slice(-400)}`);
  }
}

/* ------------------------------------------------------------------ the human's half */

/**
 * Do what the creator's browser would do with the authorize URL.
 *
 * The URL the product built is used as-is except for its origin and path, which are pointed at
 * the harness. The consent page is a real page and Approve is a real link on it; both are
 * fetched, so `/authorize` and `/authorize/decision` both run, and the redirect Node follows is
 * the one that lands on LIVETAP's own loopback listener.
 */
async function actAsTheBrowser(authorizeUrl) {
  const source = new URL(authorizeUrl);
  const target = new URL(`${IDP_BASE}/youtube/authorize`);
  target.search = source.search;

  const consent = await fetch(target, { redirect: 'follow' });
  const html = await consent.text();
  const approve = /href="(\/authorize\/decision\?[^"]*decision=approve)"/.exec(html);
  if (!approve) throw new Error(`the consent page had no Approve link (HTTP ${consent.status})`);
  const decision = `${IDP_BASE}${approve[1].replace(/&amp;/g, '&')}`;
  const landed = await fetch(decision, { redirect: 'follow' });
  return { consentStatus: consent.status, consentHtml: html, landedStatus: landed.status, landedUrl: landed.url };
}

/**
 * Launch the built app, waiting out anyone else's copy of it.
 *
 * `app.requestSingleInstanceLock()` in `apps/desktop/src/main/index.ts:81` means a second LIVETAP
 * quits at once, which Playwright reports as `WebSocket error: read ECONNRESET` — a sentence about
 * a socket, for a problem that is "something else on this machine is already running the app".
 * The run lock is supposed to prevent that; a leaked Electron from a killed run defeats it, and a
 * harness that reports the socket error instead of the cause is the harness slandering the product.
 */
async function launchApp(spki) {
  const launchArgs = [
    appDir,
    // Trust exactly one certificate: the one generated for this run, seconds ago.
    `--ignore-certificate-errors-spki-list=${spki}`,
    '--autoplay-policy=no-user-gesture-required',
  ];
  let last;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await electron.launch({ args: launchArgs, cwd: appDir });
    } catch (error) {
      last = error;
      note(`attempt ${attempt} to launch the app failed; another LIVETAP is probably still running. Waiting 20s.`);
      process.stdout.write('  waiting     another LIVETAP instance holds the single-instance lock\n');
      await sleep(20_000);
    }
  }
  throw new Error(
    `could not launch the built app in six attempts. Something else on this machine is running it ` +
      `(app.requestSingleInstanceLock). Last error: ${String(last).slice(0, 200)}`,
  );
}

/* ------------------------------------------------------------------ UI helpers */

async function gotoDestinations(win) {
  await win.evaluate(() => {
    location.hash = '#/app/destinations';
  });
  await win.waitForTimeout(700);
}

/** Open the add sheet and tap one platform row, the way a creator does. */
async function tapConnect(win, displayName) {
  await gotoDestinations(win);
  try {
    await win.getByRole('button', { name: /Add destination|Add your first destination/i }).first().click();
    await win.waitForTimeout(500);
    await win.locator('.lt-addrow', { hasText: displayName }).first().click();
  } catch (error) {
    const screen = firstLines(await screenText(win), 25).join(' / ');
    throw new Error(`could not reach the ${displayName} row in the add sheet (${String(error).slice(0, 120)}). On screen: ${screen}`);
  }
}

async function screenText(win) {
  return win.evaluate(() => document.body.innerText);
}

/** The first n lines of whatever the app is showing, for a failure that has to explain itself. */
function firstLines(text, n) {
  return String(text).split(/\r?\n/).slice(0, n);
}

/** Every authorize URL main was asked to open, newest last. */
async function capturedAuthorizeUrls(app) {
  return app.evaluate(() => globalThis.__harnessAuthorizeUrls ?? []);
}

/* ------------------------------------------------------------------ the run */

async function main() {
  // No-op when a holder spawned us. See runlock.mjs.
  await acquire({
    label: 'desktop oauth proof',
    onWait: (holder) => process.stdout.write(`  waiting     pid ${holder.pid} is using the app\n`),
  });

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'livetap-oauth-'));
  const snapshot = path.join(work, 'renderer-as-shipped');
  let app = null;

  try {
    /* ---------------------------------------------------------------- [1/10] */
    step('[1/10] building the desktop app exactly as it ships, and reading what it was built to call');
    const built = await run('npm', ['run', 'build', '-w', '@livetap/desktop'], { shell: process.platform === 'win32' });
    if (built.code !== 0) throw new Error(`npm run build -w @livetap/desktop failed (exit ${built.code})\n${built.stdout.slice(-800)}`);
    if (!fs.existsSync(path.join(appDir, 'dist', 'main', 'index.cjs'))) throw new Error('no built main process');
    if (!fs.existsSync(path.join(appDir, 'dist', 'renderer', 'app.html'))) throw new Error('no built renderer');
    fs.cpSync(path.join(appDir, 'dist', 'renderer'), snapshot, { recursive: true });

    const shippedMode = JSON.parse(fs.readFileSync(path.join(appDir, 'dist', 'renderer', 'build-mode.json'), 'utf8'));
    if (shippedMode.mockMode === false) ok('the shipped renderer is a REAL build: mock mode is compiled out');
    else bad(`the shipped renderer is a DEMO build (build-mode.json says mockMode=${shippedMode.mockMode})`);

    const shippedBase = foldedBrokerBase(rendererChunks());
    if (shippedBase === null) {
      bad('could not find the folded brokerBaseUrl() constant in the shipped bundle');
    } else if (shippedBase === '') {
      finding(
        'CRITICAL',
        'apps/web/src/state/mockMode.ts:48 (VITE_LIVETAP_BROKER_URL is set by no build in this repo)',
        'the shipped desktop renderer compiled brokerBaseUrl() to "", so every broker call resolves ' +
          'against file:// and cannot leave the machine. On an installed build, Connect account can ' +
          'only ever answer "no sign-in set up" and drop the creator on the paste-a-stream-key form.',
      );
      bad('the app as built cannot reach a token broker at all');
    } else {
      ok(`the shipped renderer calls the broker at ${shippedBase}`);
    }

    /* ---------------------------------------------------------------- [2/10] */
    step('[2/10] starting the fake identity provider and the broker in front of it');
    const tls = makeCertificate(work);
    const idpProc = start(process.execPath, [path.join(idpDir, 'fake-idp.mjs')], {
      env: {
        ...process.env,
        LIVETAP_FAKE_IDP_PORT: String(IDP_PORT),
        LIVETAP_FAKE_TOKEN_TTL: String(TOKEN_TTL_S),
        LIVETAP_FAKE_REQUIRE_PKCE: '1',
        LIVETAP_FAKE_ROTATE_REFRESH: '1',
        LIVETAP_FAKE_AUTO_APPROVE: '0',
      },
    });
    await waitFor('the fake IdP', async () => (await fetch(`${IDP_BASE}/healthz`)).ok, 20_000);
    const idpConfig = (await idp()).config;
    if (idpConfig.requirePkce === true) ok('the identity provider will refuse a sign-in without PKCE');
    else bad('the identity provider was not configured to require PKCE, so this run proves nothing about it');
    if (idpConfig.autoApprove === false) ok('the identity provider will render its real consent page, not skip it');

    const brokerProc = start(process.execPath, [
      path.join(idpDir, 'harness-broker.mjs'),
      `--port=${BROKER_PORT}`,
      `--cert=${tls.cert}`,
      `--key=${tls.key}`,
      `--idp=${IDP_BASE}`,
    ], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LIVETAP_MOCK_MODE: 'false',
        LIVETAP_OAUTH_BASE: IDP_BASE,
        LIVETAP_YOUTUBE_CLIENT_ID: CLIENT_ID,
        LIVETAP_YOUTUBE_CLIENT_SECRET: CLIENT_SECRET,
      },
    });
    const config = await waitFor('the broker', async () => broker('/api/oauth/config'), 40_000);
    if (config?.platforms?.youtube?.configured === true) {
      ok(`the real /api/oauth/config handler reports YouTube configured (client ${config.platforms.youtube.clientId})`);
    } else {
      bad(`the broker does not report YouTube as configured: ${JSON.stringify(config).slice(0, 200)}`);
    }
    /* ---------------------------------------------------------------- [3/10] */
    step('[3/10] rebuilding the renderer with the one variable an installed build is missing');
    await buildRenderer({ VITE_LIVETAP_BROKER_URL: BROKER_BASE });
    const harnessBase = foldedBrokerBase(rendererChunks());
    if (harnessBase === BROKER_BASE) ok(`the seam works: this build calls the broker at ${harnessBase}`);
    else bad(`the rebuilt renderer calls ${harnessBase ?? '(unreadable)'}, expected ${BROKER_BASE}`);

    /* ---------------------------------------------------------------- [4/10] */
    step('[4/10] launching the built app, and replacing the system browser and nothing else');
    app = await launchApp(tls.spki);
    const win = await app.firstWindow();
    window_ = win;
    win.setDefaultTimeout(15_000);

    const rendererErrors = [];
    const consoleLines = [];
    const mainLines = [];
    win.on('pageerror', (error) => rendererErrors.push(String(error).slice(0, 300)));
    win.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
    app.process().stdout?.on('data', (d) => mainLines.push(String(d).trimEnd()));
    app.process().stderr?.on('data', (d) => mainLines.push(String(d).trimEnd()));

    const patched = await app.evaluate(({ shell }) => {
      globalThis.__harnessAuthorizeUrls = [];
      try {
        shell.openExternal = async (url) => {
          globalThis.__harnessAuthorizeUrls.push(String(url));
          return undefined;
        };
        return typeof shell.openExternal === 'function' && shell.openExternal.toString().includes('__harnessAuthorizeUrls');
      } catch {
        return false;
      }
    });
    if (patched) ok('shell.openExternal now records the URL instead of opening a browser; the IPC and its guards are untouched');
    else bad('could not replace shell.openExternal in the main process, so nothing below was measured');

    await win.addInitScript(
      ([api, apiTarget]) => {
        /*
         * A hosts file, in one line: only this exact prefix moves, and only its origin. Installed
         * before the app boots so the reference `createRegistry` captures is this one.
         */
        const real = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : input?.url;
          if (typeof url === 'string' && url.startsWith(api)) return real(apiTarget + url.slice(api.length), init);
          return real(input, init);
        };
        /*
         * Did the creator ever get shown a stream key screen? A snapshot at the end cannot answer
         * that, because the form can open and close between two polls.
         */
        window.__harnessSawKeyForm = false;
        const look = () => {
          if (document.querySelector('.lt-keyform')) window.__harnessSawKeyForm = true;
        };
        document.addEventListener('DOMContentLoaded', () => {
          look();
          new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
        });
      },
      [GOOGLE_API, `${BROKER_BASE}/youtube/v3`],
    );

    // Arrive the way a returning creator does: onboarding already done, no destinations yet.
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1200);
    await win.evaluate(() => {
      localStorage.setItem('livetap.onboarding', 'true');
      localStorage.setItem('livetap.intent', '"talking"');
      localStorage.setItem('livetap.mode', '"simple"');
      localStorage.removeItem('livetap.destinations');
      localStorage.removeItem('livetap.realBroadcastAck');
    });
    await win.reload();
    await win.waitForTimeout(2500);

    const host = await win.evaluate(() => ({
      kind: window.livetapHost?.kind,
      oauth: typeof window.livetap?.oauth?.startLoopback === 'function',
      vault: typeof window.livetap?.vault?.set === 'function',
    }));
    if (host.kind === 'desktop' && host.oauth && host.vault) {
      ok('the renderer has the real desktop bridges: OAuth loopback and the encrypted vault');
    } else {
      bad(`the preload bridge is incomplete (host=${host.kind}, oauth=${host.oauth}, vault=${host.vault})`);
    }

    /*
     * Before anything is clicked: can this renderer reach the broker at all? A "Connect account"
     * that silently turns into a stream-key form is what an unreachable broker looks like from the
     * outside, and the difference between that being the product's fault and the harness's is one
     * fetch, here, said out loud.
     */
    const reachable = await win.evaluate(async (base) => {
      try {
        const res = await fetch(`${base}/api/oauth/config`);
        return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 160) };
      } catch (error) {
        return { ok: false, error: String(error).slice(0, 200) };
      }
    }, BROKER_BASE);
    if (reachable.ok) ok('the renderer reaches the broker over TLS on loopback, under the production CSP');
    else bad(`the renderer cannot reach the broker: ${reachable.error ?? `HTTP ${reachable.status}`}`);

    /* ---------------------------------------------------------------- [5/10] */
    step('[5/10] tapping Connect with the broker answering exactly as the deployed one would');
    await idpControl({ op: 'reset' });
    await broker('/__harness/switches', { method: 'POST', body: JSON.stringify({ sameOriginBypass: false }) });

    await tapConnect(win, 'YouTube');
    let firstUrl;
    try {
      firstUrl = await waitFor('the app to ask for a browser', async () => (await capturedAuthorizeUrls(app))[0], 25_000);
      ok('the app asked the operating system to open a sign-in page');
    } catch {
      bad('the app never asked for a browser, so no sign-in was started at all');
      lines.push('  what the app says:');
      lines.push(...(await screenText(win)).split(/\r?\n/).slice(0, 25).map((l) => `        ${l}`));
      lines.push('  the broker was asked for:');
      lines.push(...(await broker('/__harness/state')).calls.map((c) => `        ${c.method} ${c.path} -> ${c.status}`));
      lines.push('  renderer console:');
      lines.push(...consoleLines.slice(-15).map((l) => `        ${l.slice(0, 200)}`));
      await finish(app, work, snapshot);
      return;
    }

    const parsed = new URL(firstUrl);
    const checks = [
      [parsed.origin + parsed.pathname === GOOGLE_AUTHORIZE, `it is Google's real authorization endpoint (${parsed.origin}${parsed.pathname})`],
      [parsed.searchParams.get('client_id') === CLIENT_ID, 'it carries the client id the broker published'],
      [parsed.searchParams.get('response_type') === 'code', 'it asks for an authorization code'],
      [parsed.searchParams.get('code_challenge_method') === 'S256', 'it carries a PKCE S256 challenge'],
      [(parsed.searchParams.get('code_challenge') ?? '').length === 43, 'the challenge is a 43-character base64url digest'],
      [(parsed.searchParams.get('state') ?? '').length >= 32, 'it carries a high-entropy state'],
      [/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(parsed.searchParams.get('redirect_uri') ?? ''), `the redirect is an RFC 8252 loopback (${parsed.searchParams.get('redirect_uri')})`],
      [(parsed.searchParams.get('scope') ?? '').includes('youtube.force-ssl'), 'it asks for the YouTube scope and no more'],
      [parsed.searchParams.get('access_type') === 'offline', 'it asks for offline access, so a refresh token comes back'],
    ];
    for (const [pass, description] of checks) {
      if (pass) ok(`the authorize URL: ${description}`);
      else bad(`the authorize URL: NOT ${description}`);
    }

    const redirectUri = parsed.searchParams.get('redirect_uri') ?? '';
    const realState = parsed.searchParams.get('state') ?? '';

    // Before the real callback: prove the listener refuses one that did not come from this flow.
    const wrongState = await fetch(`${redirectUri}?code=lt_code_forged&state=not-the-state-this-app-made`).then((r) => r.status);
    const noState = await fetch(`${redirectUri}?code=lt_code_forged`).then((r) => r.status);
    if (wrongState === 400 && noState === 400) {
      ok('the loopback listener refused a forged callback and a callback with no state at all (HTTP 400 twice)');
    } else {
      finding('CRITICAL', 'apps/desktop/src/main/oauth.ts:139 (LoopbackOAuthServer.handle)',
        `the loopback listener accepted a callback whose state did not match (wrong state -> ${wrongState}, no state -> ${noState}). ` +
        'Any local process that can guess the port can hand LIVETAP its own authorization code.');
      bad('the loopback state check did not hold');
    }

    const browsed = await actAsTheBrowser(firstUrl);
    if (browsed.consentStatus === 200 && /Approve/.test(browsed.consentHtml)) {
      ok('the identity provider rendered a real consent screen, naming the account and the scopes');
    } else {
      bad(`the consent screen did not render (HTTP ${browsed.consentStatus})`);
    }
    if (browsed.landedUrl.startsWith(redirectUri)) ok('Approve redirected the browser onto LIVETAP\'s own loopback listener');
    else bad(`Approve landed on ${browsed.landedUrl.slice(0, 80)}, not the loopback listener`);

    await win.waitForTimeout(4000);
    const firstBroker = (await broker('/__harness/state')).calls;
    const firstToken = firstBroker.find((c) => c.path === '/api/oauth/token');
    const firstScreen = await screenText(win);
    if (firstToken?.status === 403) {
      finding(
        'CRITICAL',
        'apps/web/api/_lib/broker.ts:566 (assertSameOrigin) + apps/web/api/oauth/token.ts:26',
        'the broker refuses every request the desktop app makes. Chromium sends ' +
          '`Sec-Fetch-Site: cross-site` from the file:// renderer, and assertSameOrigin rejects ' +
          'anything that is not `same-origin` or `none`. The sign-in completes at the platform and ' +
          'then dies at the code exchange, with 403 BAD_REQUEST. The Origin half of that function is ' +
          'already documented as deliberately permissive for the desktop app; the Sec-Fetch-Site half ' +
          'was not given the same exemption.',
      );
      bad('a creator using the app as built cannot finish a sign-in: the broker answers 403');
      if (/did not finish signing you in|could not finish signing you in/i.test(firstScreen)) {
        ok('the app told the creator the truth about it rather than claiming a connection');
      } else {
        bad('the app did not say the sign-in failed, which is worse than the failure');
      }
    } else if (firstToken?.status === 200) {
      ok('the code exchange succeeded with the broker answering exactly as deployed');
    } else {
      bad(`the code exchange did not happen (broker journal: ${JSON.stringify(firstBroker)})`);
    }

    /* ---------------------------------------------------------------- [6/10] */
    step('[6/10] doing it again with that one header dropped, to find out what the rest of the chain does');
    await idpControl({ op: 'reset' });
    await broker('/__harness/switches', { method: 'POST', body: JSON.stringify({ sameOriginBypass: true }) });
    const before = (await capturedAuthorizeUrls(app)).length;

    await tapConnect(win, 'YouTube');
    const secondUrl = await waitFor('the second sign-in', async () => (await capturedAuthorizeUrls(app))[before], 20_000);
    const secondState = new URL(secondUrl).searchParams.get('state');
    if (secondState && secondState !== realState) ok('the second sign-in generated a fresh state; states are not reused');
    else bad('the second sign-in reused the first state');
    await actAsTheBrowser(secondUrl);

    const card = await win
      .waitForFunction(() => document.querySelectorAll('.lt-destlist > li').length > 0, undefined, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!card) {
      const screen = await screenText(win);
      bad('no destination was created, so the sign-in did not complete');
      lines.push('  what the app says:');
      lines.push(...screen.split(/\r?\n/).slice(0, 30).map((l) => `        ${l}`));
      await finish(app, work, snapshot);
      return;
    }
    await win.waitForTimeout(2500);

    const shown = await win.evaluate(() => ({
      account: document.querySelector('.lt-account__name')?.textContent ?? null,
      connected: /Connected/.test(document.body.innerText),
      chip: [...document.querySelectorAll('.lt-destlist [class*="chip"]')].map((n) => n.textContent).join(' | '),
      text: document.body.innerText,
      sawKeyForm: window.__harnessSawKeyForm === true,
    }));
    if (shown.account === EXPECTED_ACCOUNT) ok(`the card names the account the identity provider issued: "${shown.account}"`);
    else bad(`the card says "${shown.account}", the identity provider issued "${EXPECTED_ACCOUNT}"`);
    if (/Ready/.test(shown.text)) ok('the destination reached READY');
    else bad(`the destination did not reach READY (chips: ${shown.chip})`);
    if (!shown.sawKeyForm) ok('no stream key screen was ever shown to the creator, at any point in the run');
    else bad('the creator was shown a stream key form during a flow that was supposed to make one unnecessary');

    /* ---------------------------------------------------------------- [7/10] */
    step('[7/10] asking the identity provider what it actually saw');
    const seen = await idp();
    const codes = seen.codes ?? [];
    const used = codes.filter((c) => c.used);
    if (codes.length === 1 && used.length === 1) ok('exactly one authorization code was issued, and it was exchanged exactly once');
    else bad(`the identity provider issued ${codes.length} code(s), ${used.length} exchanged`);
    if (codes[0]?.hasPkce === true) ok('that code was bound to a PKCE challenge, and the exchange only succeeded because the verifier matched it');
    else bad('the code carried no PKCE challenge');
    if (codes[0]?.redirectUri === redirectUriOf(secondUrl)) ok('the code was bound to the loopback redirect the app actually opened');
    else bad(`the code was bound to ${codes[0]?.redirectUri}, not ${redirectUriOf(secondUrl)}`);

    const authorizeHit = (seen.requestLog ?? []).find((r) => r.path.startsWith('/youtube/authorize?'));
    if (secondState && authorizeHit && authorizeHit.path.includes(`state=${encodeURIComponent(secondState)}`)) {
      ok('the state the identity provider received is the one the main process generated for this flow');
    } else {
      bad('the identity provider did not receive the state the loopback server generated');
    }

    const grants = seen.tokens ?? [];
    if (grants.length === 1 && grants[0].refreshCount === 0 && !grants[0].revoked) {
      ok('one live grant exists, with a refresh token, and it has not been refreshed yet');
    } else {
      bad(`expected one fresh grant, the identity provider holds ${JSON.stringify(grants.map((g) => ({ refreshCount: g.refreshCount, revoked: g.revoked })))}`);
    }
    if (seen.counters?.refreshed === 0) ok('the connect used the token it was just issued: no refresh was needed to reach READY');
    else bad(`the connect refreshed ${seen.counters?.refreshed} time(s) before it could do anything`);

    const channelCalls = (seen.requestLog ?? []).filter((r) => r.path.startsWith('/youtube/v3/channels'));
    if (channelCalls.length >= 1 && channelCalls.every((r) => r.status === 200)) {
      ok(`the app called the platform's own API with the token and got the channel back (${channelCalls.length} call(s), all 200)`);
    } else {
      bad(`the account lookup did not succeed: ${JSON.stringify(channelCalls)}`);
    }

    /* ---------------------------------------------------------------- [8/10] */
    step('[8/10] proving the token can be renewed, through the app, with no new sign-in');
    /*
     * The only affordance in this product that uses a stored token again — short of GO LIVE — is
     * the recovery button on a failed destination. So a fault is injected, the connect is redone
     * so the destination lands FAILED with that button on screen, the fault is cleared, and the
     * button is pressed once the token has aged into the refresh margin. Every step is a real one.
     */
    await idpControl({ op: 'fault', platform: 'youtube', fault: '500' });
    const beforeThird = (await capturedAuthorizeUrls(app)).length;
    await tapConnect(win, 'YouTube');
    const thirdUrl = await waitFor('the third sign-in', async () => (await capturedAuthorizeUrls(app))[beforeThird], 20_000);
    await actAsTheBrowser(thirdUrl);
    const mintedAt = Date.now();

    const recovery = win.getByRole('button', { name: /Try again|Sign in again|Keep trying/ }).first();
    const failedCard = await recovery.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
    if (failedCard) ok('a platform outage put the destination in a failed state with one recovery button, not an error code');
    else bad('the destination did not offer a recovery action after the platform returned 500');

    await idpControl({ op: 'clearFaults' });

    /*
     * FIRST HALF, while the token is still OUTSIDE its renewal margin: kill it at the platform,
     * the way Google kills a Testing-status authorization on day seven and Twitch kills one on a
     * password change, and press the same button. The only thing that could save this is a
     * refresh triggered by the 401 itself.
     */
    const grantNow = ((await idp()).tokens ?? []).find((g) => !g.revoked);
    const outsideMargin = grantNow ? new Date(grantNow.expiresAt).getTime() - Date.now() > REFRESH_MARGIN_MS : false;
    if (!failedCard || !outsideMargin) {
      note('skipped the early-expiry measurement: it needs a token outside its renewal margin and a recovery control on screen');
    } else {
      await idpControl({ op: 'fault', platform: 'youtube', fault: 'expired' });
      const beforeEarly = (await idp()).counters.refreshed;
      await recovery.click();
      await win.waitForTimeout(6000);
      const afterEarly = await idp();
      if (afterEarly.counters.refreshed > beforeEarly) {
        ok('a token the platform had already killed was renewed rather than surfaced to the creator as an error');
      } else {
        finding(
          'HIGH',
          'apps/web/src/state/tokens.ts:219 (tokenProviderFor) + packages/adapters/src/real/http.ts:112 (request)',
          'an access token that dies before its stated expiry is never renewed. tokenProviderFor ' +
            'refreshes on the clock only, and nothing retries a 401 with a fresh token — although the ' +
            'doc comment on that function says "and again on the retry after the platform refuses one ' +
            'anyway". A valid refresh token sits in the vault while the creator is told to sign in again. ' +
            'This is exactly Google Testing-status behaviour, which kills the authorization every 7 days.',
        );
      }
    }

    /*
     * SECOND HALF: let the same token age into the 60 s renewal margin and press the button again.
     * This is the path the product does implement, and it has never been watched happen.
     */
    const refreshesBefore = (await idp()).counters.refreshed;
    const waitMs = TOKEN_TTL_S * 1000 - REFRESH_MARGIN_MS - (Date.now() - mintedAt) + 4000;
    if (waitMs > 0) {
      note(`waiting ${Math.round(waitMs / 1000)}s for the access token to age into its ${REFRESH_MARGIN_MS / 1000}s renewal margin`);
      await sleep(waitMs);
    }
    const stillRecoverable = await recovery.isVisible().catch(() => false);
    if (stillRecoverable) await recovery.click();
    else note('the destination had already recovered, so the renewal below was triggered by whatever call did that');
    await win.waitForTimeout(8000);

    const afterRefresh = await idp();
    if (afterRefresh.counters.refreshed > refreshesBefore) {
      ok(`the app renewed the access token by itself when it aged, with no new sign-in (${refreshesBefore} -> ${afterRefresh.counters.refreshed} refresh grants at the identity provider)`);
    } else {
      bad('the app never renewed the token; a creator would simply be signed out when it expired');
    }
    if ((afterRefresh.tokens ?? []).some((g) => g.refreshCount > 0)) {
      ok('the identity provider rotated the refresh token and the app kept the new one (the old one is already dead)');
    } else {
      bad('the refresh token was not rotated, so this run did not test the single-use case');
    }
    if (/Ready/.test(await screenText(win))) ok('the destination came back to READY on the renewed token');
    else bad('the destination did not recover after the renewal');

    /* ---------------------------------------------------------------- [9/10] */
    step('[9/10] pressing Disconnect account, and asking the identity provider whether it agrees');
    const beforeDisconnect = await idp();
    const liveGrants = (beforeDisconnect.tokens ?? []).filter((g) => !g.revoked).length;
    await gotoDestinations(win);
    const disconnectButton = win.getByRole('button', { name: 'Disconnect account' }).first();
    const canDisconnect = await disconnectButton.isVisible().catch(() => false);
    if (!canDisconnect) {
      bad('there is no Disconnect account control on a connected destination');
    } else {
      await disconnectButton.click();
      await win.waitForTimeout(400);
      await win.getByRole('button', { name: 'Sign out' }).first().click();
      await win.waitForTimeout(3000);

      const afterDisconnect = await idp();
      const revokedNow = (afterDisconnect.revokedTokenIds ?? []).length;
      const revokeCalls = (await broker('/__harness/state')).calls.filter((c) => c.path === '/api/oauth/revoke');
      const stillInVault = await win.evaluate(async () => {
        const raw = await window.livetap.vault.get('oauth:youtube');
        return typeof raw === 'string' && raw.length > 0;
      });

      if (revokeCalls.length > 0 && revokedNow > 0) {
        ok('Disconnect told the platform to forget LIVETAP, and the platform did');
      } else {
        finding(
          'CRITICAL',
          'apps/web/src/state/store.ts:788 (disconnect) — revokeTokens() in apps/web/src/state/tokens.ts:248 has no caller outside its own test',
          'Disconnect account revokes nothing and deletes nothing. The store\'s disconnect() calls the ' +
            'orchestrator and forgetStreamKey(destinationId); it never calls revokeTokens(platform), so ' +
            `the OAuth grant stays live at the platform (${liveGrants} grant(s) before, ${revokedNow} revoked after, ` +
            `${revokeCalls.length} calls to /api/oauth/revoke) and the access and refresh tokens stay in the ` +
            'device vault. The confirmation the creator reads says "LIVETAP tells YouTube to forget it, ' +
            'deletes what it kept on this device". Both halves of that sentence are false.',
        );
        bad('Disconnect account does not disconnect the account');
      }
      if (stillInVault) {
        bad('the OAuth token is still in the device vault after Disconnect');
      } else {
        ok('the token is gone from the device vault');
      }
      const cardAfter = await screenText(win);
      if (!cardAfter.includes(EXPECTED_ACCOUNT)) ok('the card stopped naming the account it is no longer connected to');
      else bad('the card still names the account after Disconnect');
    }

    /* ---------------------------------------------------------------- [10/10] */
    step('[10/10] scanning every log line, console message and pixel of text for a credential');
    const secrets = (await broker('/__harness/secrets')).secrets ?? [];
    if (secrets.length >= 4) ok(`the broker observed ${secrets.length} distinct credentials in transit; every one of them is searched for below`);
    else bad(`only ${secrets.length} credential(s) passed through the broker, which is too few for this scan to mean anything`);

    const domText = await screenText(win);
    const storage = await win.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
    const haystacks = [
      ['the renderer console', consoleLines.join('\n')],
      ['the main process stdout/stderr', mainLines.join('\n')],
      ['the identity provider console', idpProc.out.join('\n')],
      ['the broker console', brokerProc.out.join('\n')],
      ['the page text', domText],
      ['localStorage', storage],
      ['the identity provider control surface', JSON.stringify(await idp())],
    ];
    let leaks = 0;
    for (const [where, text] of haystacks) {
      const found = secrets.filter((s) => text.includes(s.value));
      if (found.length === 0) {
        ok(`no access token, refresh token, authorization code or PKCE verifier appears in ${where}`);
      } else {
        leaks += found.length;
        bad(`${found.length} credential(s) of kind ${[...new Set(found.map((f) => f.kind))].join(', ')} appear in ${where}`);
      }
    }
    if (leaks > 0) {
      finding('CRITICAL', 'see the failing line above', 'a credential reached a log, a console or the DOM.');
    }

    if (rendererErrors.length === 0) ok('no uncaught renderer errors during the whole run');
    else bad(`renderer errors: ${rendererErrors.slice(0, 3).join(' | ')}`);

    await finish(app, work, snapshot);
  } catch (error) {
    lines.push(`  FAIL  ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    await finish(app, work, snapshot);
  }
}

function redirectUriOf(authorizeUrl) {
  return new URL(authorizeUrl).searchParams.get('redirect_uri');
}

async function finish(app, work, snapshot) {
  if (app) await app.close().catch(() => undefined);
  for (const child of children) child.kill();

  if (!keepBuild && snapshot && fs.existsSync(snapshot)) {
    // Put back the renderer this repository actually ships, so the next run of any other harness
    // is not quietly testing a build that points at a development identity provider.
    fs.rmSync(path.join(appDir, 'dist', 'renderer'), { recursive: true, force: true });
    fs.cpSync(snapshot, path.join(appDir, 'dist', 'renderer'), { recursive: true });
    lines.push('');
    lines.push('  note  the renderer built with the harness broker URL was replaced with the as-shipped build');
  }
  if (work) fs.rmSync(work, { recursive: true, force: true });

  process.stdout.write(`\n${lines.join('\n')}\n\n`);
  if (findings.length > 0) {
    process.stdout.write('  findings, worst first\n');
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    for (const f of [...findings].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))) {
      process.stdout.write(`    ${f.severity}  ${f.where}\n      ${f.message}\n`);
    }
    process.stdout.write('\n');
  }
  if (failed) {
    process.stdout.write(
      'FAIL  a creator cannot connect a real account through this app as it is built today.\n' +
        '      Every line above marked FAIL was measured, not inferred.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    'PASS  the built desktop app signed a creator in through its own UI: real PKCE, real consent,\n' +
      '      real loopback callback, real code exchange, a token in the vault, the account named on\n' +
      '      the card, no stream key ever shown, renewed and revoked — and no credential anywhere\n' +
      '      a log, a console or the screen could show it.\n',
  );
}

main().catch(async (error) => {
  let screen = '(the window was already gone)';
  try {
    if (window_) screen = await window_.evaluate(() => `${location.hash}\n${document.body.innerText.slice(0, 1200)}`);
  } catch {
    /* the window died with the error; the message below is all there is */
  }
  for (const child of children) child.kill();
  process.stdout.write(`\n${lines.join('\n')}\n\n  what was on screen:\n${screen}\n`);
  process.stdout.write(`\nFAIL  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  process.exit(1);
});
