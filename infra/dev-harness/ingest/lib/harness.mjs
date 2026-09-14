/**
 * LIVETAP dev-harness ingest - shared plumbing.
 *
 * Zero dependencies, node builtins only. Every child process in this harness
 * is spawned with an argv ARRAY and `shell: false`, never a command string:
 * this code runs on Windows under Git Bash and under plain node, and a shell
 * string would be re-parsed by whichever shell happened to launch it, with
 * different quoting rules each time.
 *
 * CREDENTIAL POSTURE
 * ------------------
 * This harness never accepts, stores or forwards a platform stream key. The
 * only "stream key" it knows about is the LOCAL MediaMTX path name (default
 * `live/dev`): a path on a loopback-only server with no authentication, which
 * the operator has to be told in order to use the harness at all.
 *
 * What could still carry a real credential is a MediaMTX API response.
 * MediaMTX does NOT redact `forward[].dest`, `runOnAvailable`, `source` URLs
 * or the RTMP `query` string, and in the production relay those hold the
 * user's YouTube/Twitch keys. So nothing here ever dumps an API object:
 * values are copied out field by field through an allow-list (`pickPath`,
 * `pickConn`), and `redactUrl()` strips any query string before a URL can
 * reach a log line.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INGEST_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REPO_ROOT = path.resolve(INGEST_DIR, '..', '..', '..');

/** MediaMTX release this config was written and verified against. */
export const MEDIAMTX_VERSION = 'v1.21.0';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve the harness configuration.
 *
 * Ports are overridable so a developer who already has something on 1935 or
 * 9997 is not stuck. The override is handed to MediaMTX as MTX_RTMPADDRESS /
 * MTX_APIADDRESS (MediaMTX's own env-override mechanism), so the YAML file and
 * the scripts can never disagree about where the server is listening.
 */
export function loadConfig(env = process.env) {
  const rtmpPort = Number(env.LIVETAP_DEV_INGEST_RTMP_PORT ?? 1935);
  const apiPort = Number(env.LIVETAP_DEV_INGEST_API_PORT ?? 9997);
  if (!Number.isInteger(rtmpPort) || rtmpPort < 1 || rtmpPort > 65535) {
    throw new Error(
      `LIVETAP_DEV_INGEST_RTMP_PORT is not a valid port: ${String(env.LIVETAP_DEV_INGEST_RTMP_PORT)}`,
    );
  }
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error(
      `LIVETAP_DEV_INGEST_API_PORT is not a valid port: ${String(env.LIVETAP_DEV_INGEST_API_PORT)}`,
    );
  }
  return {
    // Loopback is not configurable. This receiver has no authentication, so
    // binding it anywhere else would publish an open ingest endpoint.
    host: '127.0.0.1',
    rtmpPort,
    apiPort,
    apiBase: `http://127.0.0.1:${apiPort}`,
    configPath: path.join(INGEST_DIR, 'mediamtx.dev.yml'),
    recordingsDir: path.join(INGEST_DIR, 'recordings'),
    defaultPath: env.LIVETAP_DEV_INGEST_PATH ?? 'live/dev',
    binaryOverride: env.LIVETAP_DEV_INGEST_MEDIAMTX ?? '',
    /** WHIP ingest, for the browser surface. Off unless asked for; see startMediaMtx. */
    whip: env.LIVETAP_DEV_INGEST_WHIP === '1',
    whipPort: 8889,
  };
}

/**
 * Where to look for the MediaMTX binary.
 *
 * An explicit LIVETAP_DEV_INGEST_MEDIAMTX is the ONLY candidate when it is
 * set. Falling back to the bundled copy when an operator names a specific
 * binary would silently run a different build from the one they asked for,
 * and version skew in a media server is exactly the kind of thing that costs
 * an afternoon.
 */
export function mediamtxCandidates(cfg) {
  if (cfg.binaryOverride) return [path.resolve(cfg.binaryOverride)];
  const dir = path.join(REPO_ROOT, 'tools', 'mediamtx');
  return [path.join(dir, os.platform() === 'win32' ? 'mediamtx.exe' : 'mediamtx')];
}

export class MissingBinaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MissingBinaryError';
  }
}

function releaseAsset() {
  if (os.platform() === 'win32') return `mediamtx_${MEDIAMTX_VERSION}_windows_amd64.zip`;
  if (os.platform() === 'darwin') return `mediamtx_${MEDIAMTX_VERSION}_darwin_arm64.tar.gz`;
  return `mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz`;
}

/**
 * Find the MediaMTX binary, or fail with instructions a human can act on.
 * "Binary missing" is by far the most likely first-run failure, so the error
 * message is the entire recovery procedure rather than a stack trace.
 */
export function resolveMediaMtx(cfg = loadConfig()) {
  const candidates = mediamtxCandidates(cfg);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const target = path.join(REPO_ROOT, 'tools', 'mediamtx');
  const binName = os.platform() === 'win32' ? 'mediamtx.exe' : 'mediamtx';
  throw new MissingBinaryError(
    [
      'MediaMTX binary not found. The dev ingest cannot start without it.',
      '',
      'Looked in:',
      ...candidates.map((c) => `  ${c}`),
      '',
      `Install it (${MEDIAMTX_VERSION}, the release this config is written against):`,
      `  1. Download ${releaseAsset()} from`,
      `     https://github.com/bluenviron/mediamtx/releases/tag/${MEDIAMTX_VERSION}`,
      `  2. Extract it into  ${target}`,
      `  3. Check it:  "${path.join(target, binName)}" --version`,
      `     It must print ${MEDIAMTX_VERSION}.`,
      '',
      'tools/ is listed in the repository .gitignore, so the binary is never',
      'committed and every workstation fetches it once.',
      '',
      'If you keep it somewhere else, point the harness at it:',
      '  LIVETAP_DEV_INGEST_MEDIAMTX=/path/to/mediamtx node start-ingest.mjs',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// URLs and redaction
// ---------------------------------------------------------------------------

export function trimPath(streamPath) {
  return String(streamPath)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** The RTMP ingest URL an encoder should publish to. */
export function ingestUrl(cfg, streamPath = cfg.defaultPath) {
  return `rtmp://${cfg.host}:${cfg.rtmpPort}/${trimPath(streamPath)}`;
}

/**
 * Strip anything after `?` before a URL is logged.
 *
 * An encoder under test can append its own query string to the publish URL,
 * and in the real product that is exactly where a platform key would sit
 * (`...?key=live_123`). The local path name is not a secret and stays
 * readable; the query string is never printed by anything in this harness.
 */
export function redactUrl(value) {
  const text = String(value);
  const q = text.indexOf('?');
  return q === -1 ? text : `${text.slice(0, q)}?<redacted>`;
}

// ---------------------------------------------------------------------------
// MediaMTX control API
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ApiError';
    this.cause = cause;
  }
}

const START_HINT = 'node infra/dev-harness/ingest/start-ingest.mjs';

/**
 * One request against the MediaMTX control API.
 * node:http rather than fetch, so timeout behaviour is explicit and identical
 * on every supported node build.
 */
export function apiRequest(cfg, method, route, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: cfg.host,
        port: cfg.apiPort,
        method,
        path: route,
        headers: { accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (text.trim()) {
            try {
              json = JSON.parse(text);
            } catch {
              json = null;
            }
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timed out after ${timeoutMs} ms`));
    });
    req.on('error', (err) =>
      reject(
        new ApiError(
          `MediaMTX control API ${method} ${route} failed: ${err.message}. ` +
            `Is the dev ingest running? Start it with: ${START_HINT}`,
          err,
        ),
      ),
    );
    req.end();
  });
}

/**
 * Copy the fields of a MediaMTX path object that are safe to show.
 *
 * Deliberately an allow-list. `forward`, `runOnAvailable` and `source` URLs
 * are the fields MediaMTX does not redact, and they are the ones that carry
 * real stream keys in the production relay.
 */
export function pickPath(item) {
  const tracks = Array.isArray(item?.tracks2)
    ? item.tracks2.map((t) => ({
        codec: String(t?.codec ?? 'unknown'),
        props: t?.codecProps && typeof t.codecProps === 'object' ? { ...t.codecProps } : {},
      }))
    : [];
  return {
    name: String(item?.name ?? ''),
    ready: Boolean(item?.ready),
    readyTime: item?.readyTime ?? null,
    // `source.type` only ("rtmpConn"), never a source URL.
    sourceType: item?.source?.type ? String(item.source.type) : null,
    sourceId: item?.source?.id ? String(item.source.id) : null,
    tracks,
    bytesReceived: Number(item?.bytesReceived ?? 0),
    readers: Array.isArray(item?.readers) ? item.readers.length : 0,
  };
}

/** Same idea for an RTMP connection. `query` and `user` are never copied. */
export function pickConn(item) {
  return {
    id: String(item?.id ?? ''),
    state: String(item?.state ?? ''),
    path: String(item?.path ?? ''),
    created: item?.created ?? null,
    remoteAddr: String(item?.remoteAddr ?? ''),
    userAgent: String(item?.userAgent ?? ''),
    bytesReceived: Number(item?.bytesReceived ?? 0),
  };
}

export async function listPaths(cfg) {
  const res = await apiRequest(cfg, 'GET', '/v3/paths/list');
  if (res.status !== 200) throw new ApiError(`/v3/paths/list returned HTTP ${res.status}`);
  const items = Array.isArray(res.json?.items) ? res.json.items : [];
  return items.map(pickPath);
}

export async function listRtmpConns(cfg) {
  const res = await apiRequest(cfg, 'GET', '/v3/rtmpconns/list');
  if (res.status !== 200) throw new ApiError(`/v3/rtmpconns/list returned HTTP ${res.status}`);
  const items = Array.isArray(res.json?.items) ? res.json.items : [];
  return items.map(pickConn);
}

/** Every RTMP connection currently in the `publish` state. */
export async function listPublishers(cfg, streamPath = null) {
  const conns = await listRtmpConns(cfg);
  const wanted = streamPath === null ? null : trimPath(streamPath);
  return conns.filter((c) => c.state === 'publish' && (wanted === null || c.path === wanted));
}

export async function kickRtmpConn(cfg, id) {
  const res = await apiRequest(cfg, 'POST', `/v3/rtmpconns/kick/${encodeURIComponent(id)}`);
  return res.status;
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve once a TCP connect to host:port actually succeeds.
 *
 * "The process started" is a different claim from "the port accepts
 * connections", and only the second one lets an encoder connect. This opens a
 * real socket and closes it again.
 */
export async function waitForPort(host, port, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  for (;;) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (result, err) => {
        socket.removeAllListeners();
        socket.destroy();
        if (err) lastError = err.message;
        resolve(result);
      };
      socket.setTimeout(1000, () => done(false, new Error('connect timed out')));
      socket.once('connect', () => done(true, null));
      socket.once('error', (err) => done(false, err));
    });
    if (ok) return true;
    if (Date.now() >= deadline) {
      throw new Error(
        `${host}:${port} did not start accepting connections within ${timeoutMs} ms (last error: ${lastError})`,
      );
    }
    await sleep(intervalMs);
  }
}

/** Poll `fn` until it returns something truthy, or give up. */
export async function waitFor(fn, { timeoutMs = 15000, intervalMs = 250, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/**
 * Run a command to completion and collect its output.
 *
 * argv array, `shell: false`. On Windows CreateProcess appends `.exe`, so
 * `ffprobe` resolves through PATH without a shell; a `.cmd` shim would not,
 * which is why the ENOENT message names the executable explicitly.
 */
export function run(command, args, { timeoutMs = 30000, cwd = INGEST_DIR, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      const hint =
        err.code === 'ENOENT'
          ? `${command} was not found on PATH. Install FFmpeg 7 or newer and check that ${command} runs from a fresh shell.`
          : err.message;
      finish(reject, new Error(hint));
    });
    child.on('close', (code, signal) => finish(resolve, { code, signal, stdout, stderr }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill();
        finish(reject, new Error(`${command} did not finish within ${timeoutMs} ms`));
      }, timeoutMs);
    }
  });
}

/**
 * Launch MediaMTX with the dev ingest config.
 *
 * cwd is this directory on purpose: `recordPath` in mediamtx.dev.yml is
 * relative, so recordings can only ever land in
 * infra/dev-harness/ingest/recordings.
 */
export function startMediaMtx(cfg, { onLog = null } = {}) {
  const binary = resolveMediaMtx(cfg);
  const env = { ...process.env };
  // MediaMTX's own env-override mechanism, so the YAML and the scripts cannot
  // disagree about which ports are in use.
  env.MTX_RTMPADDRESS = `${cfg.host}:${cfg.rtmpPort}`;
  env.MTX_APIADDRESS = `${cfg.host}:${cfg.apiPort}`;
  // WHIP is off in the YAML and opted into here, through the same env-override
  // mechanism, so the two cannot disagree. It exists for the browser surface,
  // which has no way to open an RTMP socket; see the comment beside `webrtc:`
  // in mediamtx.dev.yml for why every WebRTC address is pinned to loopback.
  if (cfg.whip) env.MTX_WEBRTC = 'yes';

  fs.mkdirSync(cfg.recordingsDir, { recursive: true });

  const child = spawn(binary, [cfg.configPath], {
    cwd: INGEST_DIR,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Keep the tail of MediaMTX's own output even when nothing is forwarding it,
  // so a startup failure can be reported in the server's words rather than as
  // a bare exit code.
  const lastLines = [];
  const emit = (buf) => {
    for (const raw of buf.toString('utf8').split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const line = redactUrl(raw);
      lastLines.push(line);
      if (lastLines.length > 20) lastLines.shift();
      if (onLog) onLog(line);
    }
  };
  child.stdout.on('data', emit);
  child.stderr.on('data', emit);

  let exit = null;
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });

  return {
    binary,
    child,
    get exit() {
      return exit;
    },
    /** The tail of MediaMTX's own log, redacted. */
    get log() {
      return lastLines.slice();
    },
    /**
     * Wait until RTMP and the control API are both really answering.
     *
     * The settle delay at the end is load bearing. If another dev ingest is
     * already on these ports, this MediaMTX fails to bind and exits while the
     * ports still answer perfectly, because the OTHER process is answering
     * them. Without the pause this would report a healthy start and then die.
     */
    async ready({ timeoutMs = 20000, settleMs = 600 } = {}) {
      const started = Date.now();
      const guard = () => {
        if (!exit) return;
        const why = lastLines.filter((l) => /err|fail|address|bind|in use/i.test(l));
        throw new Error(
          [
            `MediaMTX exited early (code ${String(exit.code)}${exit.signal ? `, signal ${exit.signal}` : ''}).`,
            ...(why.length ? ['MediaMTX said:', ...why.map((l) => `  ${l}`)] : []),
            `The usual cause is a port already in use: ${cfg.host}:${cfg.rtmpPort} (RTMP) or ${cfg.host}:${cfg.apiPort} (control API).`,
            'Another dev ingest may already be running. Stop it, or move this one:',
            '  LIVETAP_DEV_INGEST_RTMP_PORT=11935 LIVETAP_DEV_INGEST_API_PORT=19997 node start-ingest.mjs',
          ].join('\n'),
        );
      };
      guard();
      await waitForPort(cfg.host, cfg.rtmpPort, { timeoutMs });
      guard();
      await waitFor(
        async () => {
          try {
            const res = await apiRequest(cfg, 'GET', '/v3/paths/list');
            return res.status === 200;
          } catch {
            guard();
            return false;
          }
        },
        {
          timeoutMs: Math.max(2000, timeoutMs - (Date.now() - started)),
          what: 'the control API',
        },
      );
      await sleep(settleMs);
      guard();
      return true;
    },
    async stop() {
      if (exit) return exit;
      child.kill();
      const deadline = Date.now() + 5000;
      while (!exit && Date.now() < deadline) await sleep(100);
      if (!exit) child.kill('SIGKILL');
      const hardDeadline = Date.now() + 2000;
      while (!exit && Date.now() < hardDeadline) await sleep(100);
      return exit;
    },
  };
}

// ---------------------------------------------------------------------------
// Recordings on disk
// ---------------------------------------------------------------------------

/** Recorded segments for a path, newest first. Zero byte files are skipped. */
export function listRecordings(cfg, streamPath = cfg.defaultPath) {
  const dir = path.join(cfg.recordingsDir, ...trimPath(streamPath).split('/'));
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size === 0) continue;
    out.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file));
  return out;
}

// ---------------------------------------------------------------------------
// Tiny argv parser
// ---------------------------------------------------------------------------

/**
 * Parse `--key=value`, `--key value` and `--flag` out of argv.
 *
 * Hand written rather than node:util.parseArgs so the harness runs without an
 * experimental-feature warning on every supported node.
 */
export function parseArgs(argv, { booleans = [] } = {}) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      opts[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (booleans.includes(body)) {
      opts[body] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[body] = next;
      i += 1;
    } else {
      opts[body] = true;
    }
  }
  return { opts, rest };
}

export function asNumber(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asString(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return String(value);
}
