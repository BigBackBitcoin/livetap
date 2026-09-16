#!/usr/bin/env node
/**
 * LIVETAP CORE relay — session API.
 *
 * A deliberately tiny, zero-dependency HTTP service (node:http only) that the
 * LIVETAP web app calls to open and close a relay session.
 *
 *   POST   /sessions      -> creates a MediaMTX path, returns { sessionId, whipUrl }
 *   DELETE /sessions/:id  -> removes the path
 *   GET    /healthz       -> liveness (no auth)
 *
 * WHY THIS SERVICE EXISTS AT ALL
 * ------------------------------
 * The browser must never hold the user's platform stream keys. The web app
 * sends its destination list here once; this service writes it into MediaMTX
 * and hands back only a WHIP URL. Keys stay server-side for the whole
 * broadcast. See docs/architecture/RELAY_ARCHITECTURE.md.
 *
 * SECURITY INVARIANTS (each one is load-bearing — do not relax casually)
 * ---------------------------------------------------------------------
 * 1. Stream keys are NEVER logged. `redactIngest()` is the only way a
 *    destination may reach a log line. There is no debug flag that disables it.
 * 2. `validateIngest()` admits only an ALLOW-LIST of characters in URLs and
 *    stream keys, and validates the RAW value (never a trimmed copy). This is
 *    not cosmetic: MediaMTX executes `runOnAvailable` through `sh -c`, so an
 *    unfiltered quote, backslash or semicolon in a stream key is a candidate
 *    for remote code execution on the relay.
 * 3. `buildHookCommand()` POSIX-quotes every interpolated value with
 *    `shQuote()`, so the command's STRUCTURE does not depend on caller input
 *    even if (2) is ever relaxed. Both layers are required; neither is enough.
 * 4. Destinations on private/loopback/link-local hosts are refused unless
 *    LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS=1, because the relay opens the
 *    outbound connection and would otherwise be an SSRF pivot into the compose
 *    network (mediamtx:9997 holds every user's keys) and cloud metadata.
 * 5. Bearer auth is compared in constant time to blunt timing oracles.
 * 6. The MediaMTX Control API credential is separate from the publisher
 *    credential, so a leaked browser token cannot reconfigure the relay.
 *
 * The validation rules are a deliberate, self-contained REIMPLEMENTATION of
 * packages/core/src/validation/ingest.ts. infra/ must stay installable and
 * runnable without the TypeScript workspace, so it does not import from it.
 * packages/core remains the source of truth; session-api.test.mjs pins the
 * behaviour so the two cannot drift silently.
 */

import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function loadConfig(env = process.env) {
  const required = (name) => {
    const v = env[name];
    if (!v || !v.trim()) throw new Error(`${name} is required`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8080),
    // Bearer token the web app presents. Same secret the browser uses for the
    // WHIP publish, so one relay credential covers the whole session.
    publishPassword: required('MTX_PUBLISH_PASSWORD'),
    // Credential for MediaMTX's Control API. Distinct from the above.
    apiUser: env.MTX_API_USER ?? 'relayapi',
    apiPassword: required('MTX_API_PASSWORD'),
    // Credential the transcode hook uses to read the stream back over RTSP.
    hookUser: env.MTX_HOOK_USER ?? 'relayhook',
    hookPassword: required('MTX_HOOK_PASSWORD'),
    publishUser: env.MTX_PUBLISH_USER ?? 'livetap',
    // Control API base. Private compose network; never public.
    apiUrl: env.MTX_API_URL ?? 'http://mediamtx:9997',
    // What the browser should be told to publish to.
    publicHost: required('LIVETAP_RELAY_PUBLIC_HOST'),
    publicWhipPort: env.LIVETAP_RELAY_PUBLIC_WHIP_PORT ?? '18889',
    publicWhipScheme: env.LIVETAP_RELAY_PUBLIC_WHIP_SCHEME ?? 'http',
    // What a PHONE should be told to publish to. A browser has no RTMP socket and must use WHIP;
    // an Android handset has the opposite problem — its native encoder speaks RTMP and not WHIP.
    // MediaMTX already accepts both on the same path, and `runOnAvailable` fires whichever way the
    // stream arrives, so one session serves either publisher with no second code path in the hook.
    // This is what lets a phone reach more than one destination at all: the device encodes once,
    // publishes once, and the relay fans out, instead of the handset trying to run N RTMP sockets.
    publicRtmpPort: env.LIVETAP_RELAY_PUBLIC_RTMP_PORT ?? '19350',
    // 9:16 re-encode is off unless explicitly enabled: it costs real CPU
    // (~30% of a core per session at 1080x1920, measured — see
    // docs/qa/RELAY_VERIFICATION.md T9) and must be a deliberate choice.
    verticalTranscode: env.LIVETAP_ENABLE_VERTICAL_TRANSCODE === '1',
    // SEC-R3: opt-in escape hatch for a relay deliberately forwarding to its
    // own LAN. Off by default; see isPrivateDestinationHost().
    allowPrivateDestinations: env.LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS === '1',
    audioBitrate: env.LIVETAP_RELAY_AUDIO_BITRATE ?? '128k',
    verticalVideoBitrate: env.LIVETAP_RELAY_VERTICAL_BITRATE ?? '3000k',
  };
}

// ---------------------------------------------------------------------------
// Validation — reimplementation of packages/core/src/validation/ingest.ts
// ---------------------------------------------------------------------------

const RTMP_RE = /^rtmps?:\/\/[^\s/]+(\/[^\s]*)?$/i;
const SRT_RE = /^srt:\/\/[^\s/]+:\d{1,5}(\?[^\s]*)?$/i;
const WHIP_RE = /^https:\/\/[^\s]+$/i;
/**
 * ALLOW-LIST, not a deny-list.
 *
 * SEC-R1 (2026-09, security review): the previous rule was a deny-list,
 * `/[\s"'`$;|&<>]/`, and it let a backslash through. A stream key ending in
 * `\` lands immediately before the closing double quote of the tee argument in
 * the generated hook command, escapes it, and desynchronises the quoting of the
 * whole `sh -c` string — proven with `sh -n`, which reports
 * "unexpected EOF while looking for matching `"'" and refuses to run the hook.
 * No command injection was reachable with today's command layout (the only
 * text that fell outside quotes was our own literal fifo options), but the sole
 * thing standing between that bug and RCE was the accident of that layout.
 *
 * Two independent fixes, both load-bearing:
 *   1. this allow-list, which admits only characters that appear in real RTMP
 *      URLs and stream keys, and
 *   2. `shQuote()` in buildHookCommand, which POSIX-quotes every interpolated
 *      value so the command's structure no longer depends on the input at all.
 *
 * Keep both. Either one alone is one bug away from remote code execution on the
 * relay host.
 */
// Everything a real RTMP/RTMPS/SRT/WHIP URL needs and nothing else. `?`, `=`
// and `&` are here because SRT carries streamid/passphrase as query parameters.
const URL_ALLOWED_RE = /^[A-Za-z0-9._~:/?#=&%@+-]+$/;
// Stream keys are appended to the URL, so `&`, `?` and `#` are excluded: they
// would let a key grow a query parameter or truncate the URL at a fragment.
const KEY_ALLOWED_RE = /^[A-Za-z0-9._~:/=%@+-]+$/;
/**
 * Characters that may never appear in either field, in any position: a superset
 * of the shell's metacharacters plus the glob characters, so the value stays
 * inert even in a future code path that forgets to quote it.
 */
const UNSAFE_RE = /[\s"'`$;|<>\\(){}^*[\]]/;

const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1']);

/**
 * Reject a value that is not a plain string, or that carries leading/trailing
 * whitespace.
 *
 * SEC-R2: the old code validated `(ingest.url ?? '').trim()` but
 * `composeRtmpPublishUrl` used the RAW `ingest.url`, so `"rtmp://host/app "`
 * passed the "no whitespace" rule and still reached FFmpeg with the space
 * attached — exactly the separator librtmp uses to start parsing
 * `tcUrl=`/`playpath=`/`conn=` options. Validate what we will actually use.
 */
function checkString(value, what, errors) {
  if (typeof value !== 'string') {
    errors.push(`${what} must be text.`);
    return null;
  }
  if (value !== value.trim()) {
    errors.push(`${what} must not start or end with whitespace.`);
    return null;
  }
  if (value.length > 2048) {
    errors.push(`${what} is too long.`);
    return null;
  }
  return value;
}

export function validateIngest(ingest) {
  const errors = [];
  if (!ingest || typeof ingest !== 'object') return { ok: false, errors: ['No stream settings provided.'] };
  // NOTE: the raw value, never a trimmed copy — see checkString().
  const url = ingest.url === undefined ? '' : checkString(ingest.url, 'Stream URL', errors);
  if (url === null) return { ok: false, errors };
  if (!url) errors.push('Stream URL is required.');
  if (url && (UNSAFE_RE.test(url) || !URL_ALLOWED_RE.test(url))) {
    errors.push('Stream URL contains characters that are not allowed.');
  }
  switch (ingest.protocol) {
    case 'rtmp':
    case 'rtmps': {
      if (url && !RTMP_RE.test(url)) errors.push('Stream URL must start with rtmp:// or rtmps://.');
      if (ingest.protocol === 'rtmps' && url && !/^rtmps:\/\//i.test(url)) {
        errors.push('RTMPS destinations must use rtmps://.');
      }
      if (ingest.streamKey === undefined || ingest.streamKey === null || ingest.streamKey === '') {
        errors.push('Stream key is required.');
        break;
      }
      const key = checkString(ingest.streamKey, 'Stream key', errors);
      if (key === null) break;
      if (!key) errors.push('Stream key is required.');
      if (key && (UNSAFE_RE.test(key) || !KEY_ALLOWED_RE.test(key))) {
        errors.push('Stream key contains characters that are not allowed.');
      }
      break;
    }
    case 'srt':
      if (url && !SRT_RE.test(url)) errors.push('SRT URL must look like srt://host:port.');
      break;
    case 'whip':
      if (url && !WHIP_RE.test(url)) errors.push('WHIP endpoint must be an https:// URL.');
      break;
    default:
      errors.push('Unknown protocol.');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Hosts the relay refuses to forward to unless explicitly told otherwise.
 *
 * SEC-R3: the relay is a server that opens an outbound TCP connection to a host
 * the *caller* chose. Without this it is a general-purpose SSRF pivot into the
 * compose network (`mediamtx:9997`, whose Control API holds every user's stream
 * keys), into the host's loopback, and into cloud metadata at 169.254.169.254.
 * Set LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS=1 only on a relay that is
 * deliberately forwarding to something on its own LAN.
 */
const PRIVATE_HOST_RE =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

export function isPrivateDestinationHost(host) {
  if (typeof host !== 'string' || host === '') return true;
  // A bare hostname with no dot is a container/service name on a private network.
  const bare = host.replace(/:\d+$/, '').toLowerCase();
  if (!bare.includes('.') && !bare.includes(':')) return true;
  return PRIVATE_HOST_RE.test(bare);
}

/** Host[:port] portion of an already-validated rtmp/rtmps/srt/https URL. */
export function destinationHost(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)$|^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)[/?#]/i.exec(String(url));
  const authority = m ? (m[1] ?? m[2] ?? '') : '';
  // Strip userinfo if any survived validation.
  const at = authority.lastIndexOf('@');
  return at === -1 ? authority : authority.slice(at + 1);
}

/** Redact secrets from a destination before it is allowed anywhere near a log. */
export function redactIngest(ingest) {
  return {
    protocol: ingest.protocol,
    url: ingest.url,
    streamKey: ingest.streamKey ? '••••' + ingest.streamKey.slice(-4) : undefined,
    aspectRatio: ingest.aspectRatio,
  };
}

/**
 * Compose the publish URL FFmpeg receives for an RTMP/RTMPS destination.
 * Mirrors core's composeRtmpPublishUrl: base + '/' + key, no double slash.
 */
export function composeRtmpPublishUrl(ingest) {
  if (ingest.protocol !== 'rtmp' && ingest.protocol !== 'rtmps') return ingest.url;
  const base = ingest.url.replace(/\/+$/, '');
  return ingest.streamKey ? `${base}/${ingest.streamKey}` : base;
}

/**
 * Validate a whole request body. Returns { ok, errors, destinations }.
 * Errors are indexed so the web app can point at the offending card, and they
 * never quote the value back (a validation message must not echo a secret).
 */
export function validateRequest(body, cfg) {
  const errors = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Request body must be a JSON object.'] };
  const destinations = body.destinations;
  if (!Array.isArray(destinations) || destinations.length === 0) {
    return { ok: false, errors: ['At least one destination is required.'] };
  }
  if (destinations.length > 10) {
    return { ok: false, errors: ['At most 10 destinations per session.'] };
  }
  destinations.forEach((d, i) => {
    const res = validateIngest(d);
    res.errors.forEach((e) => errors.push(`destinations[${i}]: ${e}`));
    const aspect = d.aspectRatio ?? '16:9';
    if (!ASPECT_RATIOS.has(aspect)) {
      errors.push(`destinations[${i}]: aspectRatio must be one of 16:9, 9:16, 1:1.`);
    }
    if (aspect === '9:16' && !cfg.verticalTranscode) {
      // Honest failure rather than silently sending a 16:9 frame to a vertical
      // platform. ADR-007 / the LIVETAP "never masquerade" rule.
      errors.push(
        `destinations[${i}]: this relay is not configured for 9:16 re-encoding. ` +
          'Set LIVETAP_ENABLE_VERTICAL_TRANSCODE=1 on the relay to enable it.',
      );
    }
    if (res.ok && !cfg.allowPrivateDestinations && isPrivateDestinationHost(destinationHost(d.url))) {
      // Never echo the host back: it is caller input and the message reaches a log.
      errors.push(
        `destinations[${i}]: this relay refuses to forward to a private, loopback or ` +
          'link-local address. Set LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS=1 if that is intended.',
      );
    }
    if (d.protocol === 'srt' || d.protocol === 'whip') {
      errors.push(
        `destinations[${i}]: the relay forwards to RTMP/RTMPS only. ` +
          'SRT and WHIP destinations are handled by the desktop engine (ADR-012).',
      );
    }
  });
  return { ok: errors.length === 0, errors, destinations };
}

// ---------------------------------------------------------------------------
// Hook command construction
// ---------------------------------------------------------------------------

/**
 * Build the `runOnAvailable` command for a session.
 *
 * DESIGN NOTE — why a hook and not MediaMTX's native `forward`:
 * WHIP delivers Opus audio. MediaMTX's `forward` is strictly pass-through: its
 * RTMP writer only emits an Opus track if the destination advertises Enhanced
 * RTMP Opus support in `fourCcList`, and there is no transcode path anywhere in
 * it. YouTube/Twitch/TikTok are legacy-RTMP AAC (ADR-012), so a native forward
 * would deliver a stream they cannot decode. The hook re-encodes audio only
 * (`-c:v copy -c:a aac`), which measured ~12-15% of one core at 720p30 versus
 * ~3% for pass-through — cheap, and correct. Full evidence: T5-T8 in
 * docs/qa/RELAY_VERIFICATION.md.
 *
 * One single FFmpeg process serves every destination:
 *   - output group 1: video copied, audio Opus->AAC, `tee` to all 16:9 / 1:1
 *   - output group 2 (only if 9:16 destinations exist): cropped + scaled
 *     re-encode, `tee` to the vertical destinations
 * A single process means MediaMTX's SIGINT on stream-end cleans up everything,
 * and one slow destination cannot stall the others (`onfail=ignore`).
 *
 * RECONNECT: `onfail=ignore` alone keeps a dead destination from killing the
 * process, but it drops that destination for the REST of the broadcast. The
 * fifo options below are what actually reconnect it — verified on this host in
 * MEDIA_ENGINE_EVALUATION.md 9.6, where a destination that was dead at start
 * recovered on its own with no encoder restart and no effect on healthy
 * outputs. `drop_pkts_on_overflow` is the backpressure guard required by
 * ADR-005: a stalled destination must drop packets, never stall the ingest.
 *
 * If EVERY destination is dead, FFmpeg exits with "Output file does not
 * contain any stream" (9.7a). `runOnAvailableRestart: true` restarts it, so
 * the session recovers when any destination comes back.
 */

/** Per-output reconnect + backpressure. Verified: MEDIA_ENGINE_EVALUATION 9.6. */
const FIFO_OPTIONS =
  'attempt_recovery=1:recovery_wait_time=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size=120';
/**
 * POSIX single-quote one shell word.
 *
 * SEC-R1: the hook command is executed by MediaMTX through `sh -c`, so every
 * interpolated value must be quoted in a way whose result cannot depend on the
 * value. Single quotes are literal in `sh` for every byte except `'` itself,
 * which is closed, escaped and reopened. The allow-list in validateIngest()
 * already rejects quotes and backslashes; this makes the command's STRUCTURE
 * independent of the input regardless, so a future relaxation of the
 * allow-list cannot turn into command injection.
 */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function buildHookCommand(sessionId, destinations, cfg) {
  // `$RTSP_PORT` / `$MTX_PATH` are MediaMTX's own environment variables and must
  // stay expandable, so this one value is double-quoted rather than shQuote'd.
  // Everything inside it is operator configuration, never caller input.
  const rtspUrl =
    `"rtsp://${cfg.hookUser}:${cfg.hookPassword}@127.0.0.1:$RTSP_PORT/$MTX_PATH"`;

  const teeTarget = (d) => `[f=flv:onfail=ignore]${composeRtmpPublishUrl(d)}`;

  const flat = destinations.filter((d) => (d.aspectRatio ?? '16:9') !== '9:16');
  const vertical = destinations.filter((d) => d.aspectRatio === '9:16');

  const parts = [
    'ffmpeg',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'warning',
    // `+genpts` plus `-max_interleave_delta 0` suppress the non-monotonic DTS
    // churn that a WebRTC source otherwise produces when video is copied.
    '-fflags', '+genpts',
    '-rtsp_transport', 'tcp',
    '-i', rtspUrl,
  ];

  if (flat.length > 0) {
    parts.push(
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', cfg.audioBitrate,
      '-ar', '48000',
      '-ac', '2',
      '-max_interleave_delta', '0',
      '-f', 'tee',
      '-use_fifo', '1',
      '-fifo_options', shQuote(FIFO_OPTIONS),
      shQuote(flat.map(teeTarget).join('|')),
    );
  }

  if (vertical.length > 0) {
    parts.push(
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-filter:v', 'crop=ih*9/16:ih,scale=1080:1920',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'high',
      '-b:v', cfg.verticalVideoBitrate,
      '-maxrate', cfg.verticalVideoBitrate,
      '-bufsize', '6000k',
      '-g', '60',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', cfg.audioBitrate,
      '-ar', '48000',
      '-ac', '2',
      '-max_interleave_delta', '0',
      '-f', 'tee',
      '-use_fifo', '1',
      '-fifo_options', shQuote(FIFO_OPTIONS),
      shQuote(vertical.map(teeTarget).join('|')),
    );
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// MediaMTX Control API client
// ---------------------------------------------------------------------------

export function createMtxClient(cfg, fetchImpl = fetch) {
  const authHeader =
    'Basic ' + Buffer.from(`${cfg.apiUser}:${cfg.apiPassword}`).toString('base64');

  async function call(method, path, body) {
    const res = await fetchImpl(`${cfg.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: authHeader,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      // The response body can echo the path config, which contains stream
      // keys. Surface the status only.
      const err = new Error(`MediaMTX API ${method} ${path} failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  return {
    addPath: (name, conf) => call('POST', `/v3/config/paths/add/${name}`, conf),
    // NOTE: delete really is the HTTP DELETE verb on a `.../delete/...` path.
    // A POST there returns 404. Verified against v1.21.0.
    deletePath: (name) => call('DELETE', `/v3/config/paths/delete/${name}`),
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isAuthorized(req, cfg) {
  const header = req.headers?.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice('Bearer '.length), cfg.publishPassword);
}

/** Session ids are opaque and URL-safe; they become a MediaMTX path segment. */
export function newSessionId() {
  return randomUUID().replace(/-/g, '');
}

export const SESSION_ID_RE = /^[a-zA-Z0-9]{8,64}$/;

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(cfg, mtx = createMtxClient(cfg), log = console) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true });
    }

    if (!isAuthorized(req, cfg)) {
      // Never say WHY it failed.
      return json(res, 401, { error: 'Unauthorized.' });
    }

    try {
      if (req.method === 'POST' && url.pathname === '/sessions') {
        const body = await readJsonBody(req);
        const check = validateRequest(body, cfg);
        if (!check.ok) return json(res, 400, { error: 'Invalid destinations.', details: check.errors });

        const sessionId = newSessionId();
        const pathName = `live/${sessionId}`;
        const hook = buildHookCommand(sessionId, check.destinations, cfg);

        await mtx.addPath(pathName, {
          runOnAvailable: hook,
          runOnAvailableRestart: true,
          // Native forward is deliberately empty — see buildHookCommand().
          forward: [],
        });

        // Redacted logging only.
        log.info?.(
          `session ${sessionId} created with ${check.destinations.length} destination(s): ` +
            JSON.stringify(check.destinations.map(redactIngest)),
        );

        return json(res, 201, {
          sessionId,
          whipUrl: `${cfg.publicWhipScheme}://${cfg.publicHost}:${cfg.publicWhipPort}/live/${sessionId}/whip`,
          // For native publishers (Android). Credentials are NOT embedded as userinfo here: this
          // URL is handled by a phone, logged by encoders, and shown in diagnostics, and a
          // password inside a URL survives all three. The client applies `rtmpAuthorization`
          // through its encoder's own auth, exactly as the browser does for WHIP.
          rtmpUrl: `rtmp://${cfg.publicHost}:${cfg.publicRtmpPort}/live/${sessionId}`,
          rtmpAuthorization: `${cfg.publishUser}:${cfg.publishPassword}`,
          // The browser sends this as `Authorization: Bearer <user>:<pass>` on
          // the WHIP POST. MediaMTX splits on the first colon — a bare password
          // is rejected with 401. Verified, RELAY_VERIFICATION.md T6.
          whipAuthorization: `${cfg.publishUser}:${cfg.publishPassword}`,
        });
      }

      const del = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (req.method === 'DELETE' && del) {
        const sessionId = del[1];
        if (!SESSION_ID_RE.test(sessionId)) {
          return json(res, 400, { error: 'Invalid session id.' });
        }
        try {
          await mtx.deletePath(`live/${sessionId}`);
        } catch (e) {
          if (e.status === 404) return json(res, 404, { error: 'No such session.' });
          throw e;
        }
        log.info?.(`session ${sessionId} deleted`);
        return json(res, 204, {});
      }

      return json(res, 404, { error: 'Not found.' });
    } catch (err) {
      // err.message is ours by construction and carries no secret.
      log.error?.(`request failed: ${err.message}`);
      return json(res, 500, { error: 'Relay error.' });
    }
  });
}

// Only start listening when run directly, so tests can import the module.
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.endsWith('relay-session.mjs')) {
  const cfg = loadConfig();
  createServer(cfg).listen(cfg.port, () => {
    console.info(`livetap relay session-api listening on :${cfg.port}`);
    console.info(`  MediaMTX API   : ${cfg.apiUrl}`);
    console.info(`  public WHIP host: ${cfg.publicHost}:${cfg.publicWhipPort}`);
    console.info(`  9:16 re-encode : ${cfg.verticalTranscode ? 'enabled' : 'disabled'}`);
  });
}
