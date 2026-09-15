#!/usr/bin/env node
/**
 * The token broker, over TLS, in front of the fake IdP — for the desktop OAuth proof.
 *
 * `apps/desktop/e2e/oauth.mjs` needs the renderer of the BUILT desktop app to reach a broker.
 * Two facts about the built app decide the shape of this file, and both were measured rather
 * than assumed (see that file's header for the measurements):
 *
 *  1. The renderer is a `file://` document under the production CSP
 *     (`connect-src 'self' https: wss:`), so a plain-http broker on 127.0.0.1 is refused by the
 *     browser before a byte leaves. The broker therefore has to speak TLS, with a certificate
 *     the run generates and Chromium is told to accept by SPKI pin.
 *  2. There is no local broker in this repository at all. `apps/web/api/oauth/*.ts` are Vercel
 *     functions and `apps/web/scripts/preview-server.mjs` answers `/api/*` with 501 on purpose.
 *
 * So this serves the REAL handlers. `apps/web/api/oauth/{config,token,refresh,revoke}.ts` and the
 * real Vercel adapter in `apps/web/api/_lib/node.ts` are bundled from source with esbuild and
 * invoked unmodified; `LIVETAP_OAUTH_BASE` (the product's own documented harness override) points
 * their token/revoke endpoints at the fake IdP. Nothing in `apps/web` is edited or reimplemented.
 *
 * Everything that is not `/api/oauth/*` is proxied verbatim to the fake IdP, so one https origin
 * covers both the broker and the platform API the renderer calls.
 *
 * TWO DELIBERATE, DECLARED DEVIATIONS from what a production broker does, both of them switches
 * that start OFF so the run can measure the product's real behaviour first:
 *
 *   sameOriginBypass   drops `Sec-Fetch-Site` before the real handler sees it. Chromium sends
 *                      `Sec-Fetch-Site: cross-site` from a `file://` renderer, and
 *                      `assertSameOrigin` in apps/web/api/_lib/broker.ts refuses it with 403.
 *                      That is a real product defect on the desktop surface; this switch exists
 *                      only so the run can prove what the REST of the chain does once past it.
 *   corsHeaders        adds `Access-Control-Allow-*`. Measured to be unnecessary — Electron's
 *                      file: renderer is not CORS-restricted against https — and off by default.
 *                      Kept as a switch so the next person does not have to re-measure.
 *
 * It also keeps, in memory and never on stdout, every secret string that passed through it
 * (authorization code, PKCE verifier, access token, refresh token). `GET /__harness/secrets`
 * hands those to the driver so it can assert that none of them appears in a log line, a console
 * message or the DOM. That is the only way to assert absence of a value without printing it.
 *
 * DEVELOPMENT HARNESS. Binds 127.0.0.1 only, refuses to run under NODE_ENV=production, and its
 * `/__harness/*` surface would hand an access token to anyone who asked. Never deploy it.
 *
 *   node infra/dev-harness/fake-idp/harness-broker.mjs --port=8790 --cert=C --key=K --idp=http://127.0.0.1:8789
 */
import { createServer } from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(arg('port', '8790'));
const CERT = arg('cert');
const KEY = arg('key');
const IDP = arg('idp', 'http://127.0.0.1:8789').replace(/\/+$/, '');
const REPO = path.resolve(here, '..', '..', '..');

if (process.env.NODE_ENV === 'production') {
  console.error('harness-broker refuses to run with NODE_ENV=production.');
  process.exit(2);
}
if (!CERT || !KEY) {
  console.error('harness-broker needs --cert and --key.');
  process.exit(2);
}

/* ------------------------------------------------------------------ the real handlers */

/**
 * Bundle the product's own serverless functions so Node can run them.
 *
 * They are TypeScript and they import each other with `.js` specifiers that resolve to `.ts`
 * files, which Node 20 cannot do and esbuild does not do by default. The plugin below is that
 * one rule and nothing else: no transform, no shim, no substitution.
 */
async function loadHandlers() {
  const esbuild = await import(
    pathToFileURL(path.join(REPO, 'node_modules', 'esbuild', 'lib', 'main.js')).href
  );
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetap-broker-'));
  const entry = path.join(workDir, 'entry.mjs');
  const api = path.join(REPO, 'apps', 'web', 'api').replace(/\\/g, '/');
  fs.writeFileSync(
    entry,
    [
      `export { handle as config } from '${api}/oauth/config.ts';`,
      `export { handle as token } from '${api}/oauth/token.ts';`,
      `export { handle as refresh } from '${api}/oauth/refresh.ts';`,
      `export { handle as revoke } from '${api}/oauth/revoke.ts';`,
      `export { toWebRequest, sendWebResponse } from '${api}/_lib/node.ts';`,
    ].join('\n'),
    'utf8',
  );
  const out = path.join(workDir, 'handlers.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: out,
    logLevel: 'silent',
    plugins: [
      {
        name: 'ts-from-js-specifier',
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (a) => {
            if (a.kind === 'entry-point') return null;
            const candidate = path.resolve(a.resolveDir, a.path).replace(/\.js$/, '.ts');
            return fs.existsSync(candidate) ? { path: candidate } : null;
          });
        },
      },
    ],
  });
  return { mod: await import(pathToFileURL(out).href), workDir };
}

const { mod, workDir } = await loadHandlers();

/* ------------------------------------------------------------------ observable state */

const state = {
  /** Every /api/oauth/* call: method, path, status. Never a body. */
  calls: [],
  /** Raw secret strings seen in transit. Never printed by this process. */
  secrets: new Map(),
  switches: { sameOriginBypass: false, corsHeaders: false },
};

function remember(kind, value) {
  if (typeof value !== 'string' || value.length < 8) return;
  state.secrets.set(value, kind);
}

/* ------------------------------------------------------------------ plumbing */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Replay a buffered request into the real Vercel adapter, and report what came back. */
async function callRealHandler(handler, req, raw, res) {
  const headers = { ...req.headers };
  if (state.switches.sameOriginBypass) delete headers['sec-fetch-site'];
  // `toWebRequest` rebuilds the URL from `host`, which is what requestHost() pins redirectUri
  // against, so the header set is passed through otherwise untouched.
  const shim = Object.assign(Object.create(http.IncomingMessage.prototype), {
    headers,
    method: req.method,
    url: req.url,
    readable: false,
    body: raw.toString('utf8'),
  });
  const request = await mod.toWebRequest(shim);
  const response = await handler(request);
  try {
    const parsed = JSON.parse(await response.clone().text());
    remember('accessToken', parsed.accessToken);
    remember('refreshToken', parsed.refreshToken);
  } catch {
    /* not JSON, nothing to remember */
  }
  if (state.switches.corsHeaders) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  }
  await mod.sendWebResponse(res, response);
  return response.status;
}

function proxy(req, raw, res) {
  const upstream = new URL(IDP);
  const target = new URL(req.url ?? '/', IDP);
  const headers = { ...req.headers };
  // The IdP builds absolute URLs (the avatar, the discovery document) from the Host it is given.
  headers.host = upstream.host;
  const outbound = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  outbound.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`fake IdP unreachable: ${error.message}`);
  });
  if (raw.length > 0) outbound.write(raw);
  outbound.end();
}

const server = createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, (req, res) => {
  void (async () => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? '/', `https://127.0.0.1:${PORT}`);

    if (url.pathname === '/__harness/secrets') {
      // Values, not descriptions: the driver needs the exact strings to prove their absence.
      return sendJson(res, 200, { secrets: [...state.secrets].map(([value, kind]) => ({ kind, value })) });
    }
    if (url.pathname === '/__harness/state') {
      return sendJson(res, 200, { calls: state.calls, switches: state.switches, secretCount: state.secrets.size });
    }
    if (url.pathname === '/__harness/switches' && req.method === 'POST') {
      Object.assign(state.switches, JSON.parse(raw.toString('utf8') || '{}'));
      return sendJson(res, 200, { switches: state.switches });
    }

    const handler =
      url.pathname === '/api/oauth/config'
        ? mod.config
        : url.pathname === '/api/oauth/token'
          ? mod.token
          : url.pathname === '/api/oauth/refresh'
            ? mod.refresh
            : url.pathname === '/api/oauth/revoke'
              ? mod.revoke
              : null;

    if (!handler) return proxy(req, raw, res);

    try {
      const body = JSON.parse(raw.toString('utf8') || '{}');
      remember('authorizationCode', body.code);
      remember('codeVerifier', body.codeVerifier);
      remember('refreshToken', body.refreshToken);
      remember('revokedToken', body.token);
    } catch {
      /* a GET, or a body that is not JSON */
    }

    let status = 0;
    try {
      status = await callRealHandler(handler, req, raw, res);
    } catch (error) {
      status = 500;
      if (!res.headersSent) sendJson(res, 500, { error: 'HARNESS', message: String(error).slice(0, 200) });
    }
    state.calls.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, status });
    return undefined;
  })().catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: 'HARNESS' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`harness-broker listening https://127.0.0.1:${PORT} -> ${IDP}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    fs.rmSync(workDir, { recursive: true, force: true });
    process.exit(0);
  });
}
