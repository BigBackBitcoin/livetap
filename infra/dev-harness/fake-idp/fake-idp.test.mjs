/**
 * Tests for the LIVETAP fake identity provider.
 *
 * Everything here goes over REAL HTTP against a server bound to port 0. There
 * is no in-process shortcut and no mocked transport: the point of this harness
 * is that the product's own code can talk to it, so the tests talk to it the
 * same way the product does.
 *
 * The PKCE pair is generated with the SAME algorithm packages/adapters uses
 * (SHA-256 of the verifier, base64url, sent as S256), so a green test here is
 * evidence about the product's implementation and not just about this file.
 *
 * Run from the repo root:
 *   npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

import { createServer, verifyPkce, isAllowedRedirectUri, describeSecret } from './fake-idp.mjs';

const REDIRECT_URI = 'http://127.0.0.1:53219/callback';
const CLIENT_ID = 'livetap-dev-client';

const TEST_ENV = {
  LIVETAP_FAKE_CLIENT_IDS: CLIENT_ID,
  LIVETAP_FAKE_CLIENT_SECRET: 'livetap-dev-secret',
  LIVETAP_FAKE_INGEST: 'rtmp://127.0.0.1:1935/live',
  LIVETAP_FAKE_TOKEN_TTL: '3600',
};

let server;
let base;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Same construction as packages/adapters/src/oauth/pkce.ts. */
function pkcePair() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = randomBytes(64);
  let verifier = '';
  for (const byte of bytes) verifier += alphabet[byte % alphabet.length];
  return { verifier, challenge: base64url(createHash('sha256').update(verifier, 'utf8').digest()) };
}

async function listen(env = TEST_ENV) {
  const instance = createServer({ env });
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  return { instance, url: `http://127.0.0.1:${instance.address().port}` };
}

/** Drive /authorize plus the consent decision without following the 302. */
async function authorize({ challenge, state = 'st-1', scope = 'https://www.googleapis.com/auth/youtube.force-ssl', decision = 'approve', redirectUri = REDIRECT_URI, platform = 'youtube' }) {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    platform,
    auto: decision,
  });
  if (challenge) {
    query.set('code_challenge', challenge);
    query.set('code_challenge_method', 'S256');
  }
  const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  return res;
}

function codeFrom(res) {
  const location = res.headers.get('location');
  expect(location, 'authorize should redirect').toBeTruthy();
  return new URL(location).searchParams.get('code');
}

async function postToken(params) {
  return fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(async () => {
  const started = await listen();
  server = started.instance;
  base = started.url;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('authorization code + PKCE', () => {
  it('issues a token set when the verifier matches the challenge', async () => {
    const { verifier, challenge } = pkcePair();
    const redirect = await authorize({ challenge });
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get('location'));
    expect(location.searchParams.get('state')).toBe('st-1');

    const res = await postToken({
      grant_type: 'authorization_code',
      code: location.searchParams.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: 'livetap-dev-secret',
      code_verifier: verifier,
    });
    expect(res.status).toBe(200);
    const tokens = await res.json();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(3600);
    expect(typeof tokens.access_token).toBe('string');
    expect(typeof tokens.refresh_token).toBe('string');
    expect(tokens.scope).toBe('https://www.googleapis.com/auth/youtube.force-ssl');
  });

  it('rejects a wrong code_verifier with invalid_grant and issues nothing', async () => {
    const { challenge } = pkcePair();
    const other = pkcePair();
    const code = codeFrom(await authorize({ challenge }));

    const res = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: other.verifier,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toMatch(/code_verifier/);

    const control = await (await fetch(`${base}/_control`)).json();
    expect(control.tokens).toHaveLength(0);
  });

  it('refuses a code_challenge_method that is not S256', async () => {
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
      state: 'st-2',
      code_challenge: 'plain-challenge-value-that-is-long-enough-000',
      code_challenge_method: 'plain',
    });
    const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location'));
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('st-2');
  });

  it('returns access_denied on the deny path', async () => {
    const { challenge } = pkcePair();
    const res = await authorize({ challenge, decision: 'deny' });
    const location = new URL(res.headers.get('location'));
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('refuses an unknown client_id without redirecting anywhere', async () => {
    const { challenge } = pkcePair();
    const query = new URLSearchParams({
      client_id: 'not-a-client',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'x',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const res = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('single-use codes', () => {
  it('rejects a replayed code and revokes what it minted', async () => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    const params = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    };

    const first = await postToken(params);
    expect(first.status).toBe(200);
    const tokens = await first.json();

    const second = await postToken(params);
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe('invalid_grant');

    // RFC 6749 section 4.1.2: the replay revoked the original tokens too.
    const api = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(api.status).toBe(401);
  });
});

describe('refresh and revoke', () => {
  async function connect(platform = 'youtube', scope = 'https://www.googleapis.com/auth/youtube.force-ssl') {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge, scope, platform }));
    const res = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('exchanges a refresh_token for a new access token and rotates the refresh token', async () => {
    const first = await connect();
    const res = await postToken({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: CLIENT_ID,
      client_secret: 'livetap-dev-secret',
    });
    expect(res.status).toBe(200);
    const next = await res.json();
    expect(next.access_token).not.toBe(first.access_token);
    expect(next.refresh_token).not.toBe(first.refresh_token);

    // The old access token is gone, the new one works.
    const stale = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${first.access_token}` },
    });
    expect(stale.status).toBe(401);
    const fresh = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${next.access_token}` },
    });
    expect(fresh.status).toBe(200);
  });

  it('rejects an unsupported grant_type', async () => {
    const res = await postToken({ grant_type: 'client_credentials', client_id: CLIENT_ID });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_grant_type');
  });

  it('rejects an unknown client with invalid_client', async () => {
    const res = await postToken({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('revoke invalidates the pair and subsequent API calls return 401', async () => {
    const tokens = await connect();
    const before = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(before.status).toBe(200);

    const revoked = await fetch(`${base}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.access_token }).toString(),
    });
    expect(revoked.status).toBe(200);

    const after = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(after.status).toBe(401);

    const refreshAfter = await postToken({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
    });
    expect(refreshAfter.status).toBe(400);
    expect((await refreshAfter.json()).error).toBe('invalid_grant');
  });

  it('expires access tokens on the configured schedule', async () => {
    await new Promise((resolve) => server.close(resolve));
    const started = await listen({ ...TEST_ENV, LIVETAP_FAKE_SHORT_TOKENS: '1' });
    server = started.instance;
    base = started.url;

    const tokens = await connect();
    expect(tokens.expires_in).toBe(5);
    const control = await (await fetch(`${base}/_control`)).json();
    expect(control.config.tokenTtlSeconds).toBe(5);
  });
});

describe('platform-shaped APIs', () => {
  async function youtubeToken() {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    const res = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    return (await res.json()).access_token;
  }

  async function twitchToken() {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(
      await authorize({ challenge, platform: 'twitch', scope: 'channel:read:stream_key channel:manage:broadcast' }),
    );
    const res = await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    return (await res.json()).access_token;
  }

  it('serves the YouTube channels envelope the adapter parses', async () => {
    const token = await youtubeToken();
    const body = await (
      await fetch(`${base}/youtube/v3/channels?part=id,snippet&mine=true`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(body.items[0].id).toMatch(/^UC/);
    expect(typeof body.items[0].snippet.title).toBe('string');
    expect(body.items[0].snippet.thumbnails.default.url).toMatch(/^http/);
  });

  it('hands out a local RTMP ingest address and a stream key, and gates transition on stream health', async () => {
    const token = await youtubeToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const broadcast = await (
      await fetch(`${base}/youtube/v3/liveBroadcasts?part=id,snippet,status`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ snippet: { title: 'harness test' }, status: { privacyStatus: 'private' } }),
      })
    ).json();
    expect(broadcast.id).toBeTruthy();
    expect(broadcast.status.lifeCycleStatus).toBe('created');

    const stream = await (
      await fetch(`${base}/youtube/v3/liveStreams?part=id,cdn`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ snippet: { title: 'harness stream' } }),
      })
    ).json();
    const info = stream.cdn.ingestionInfo;
    expect(info.ingestionAddress).toBe('rtmp://127.0.0.1:1935/live');
    expect(info.streamName).toMatch(/^lt-key-/);
    // No fake rtmps address: the adapter prefers it, and a local RTMP server cannot serve it.
    expect(info.rtmpsIngestionAddress).toBeUndefined();

    const beforeBind = await fetch(
      `${base}/youtube/v3/liveBroadcasts/transition?id=${broadcast.id}&part=id,status&broadcastStatus=live`,
      { method: 'POST', headers },
    );
    expect(beforeBind.status).toBe(403);
    expect((await beforeBind.json()).error.errors[0].reason).toBe('errorStreamInactive');

    const bound = await (
      await fetch(
        `${base}/youtube/v3/liveBroadcasts/bind?id=${broadcast.id}&part=id,contentDetails&streamId=${stream.id}`,
        { method: 'POST', headers },
      )
    ).json();
    expect(bound.contentDetails.boundStreamId).toBe(stream.id);

    const status = await (
      await fetch(`${base}/youtube/v3/liveStreams?part=status&id=${stream.id}`, { headers })
    ).json();
    expect(status.items[0].status.streamStatus).toBe('active');
    expect(status.items[0].status.healthStatus.status).toBe('good');

    const live = await (
      await fetch(
        `${base}/youtube/v3/liveBroadcasts/transition?id=${broadcast.id}&part=id,status&broadcastStatus=live`,
        { method: 'POST', headers },
      )
    ).json();
    expect(live.status.lifeCycleStatus).toBe('live');

    const listed = await (
      await fetch(`${base}/youtube/v3/liveBroadcasts?part=snippet&id=${broadcast.id}`, { headers })
    ).json();
    expect(listed.items[0].snippet.liveChatId).toBe(`lt.chat.${broadcast.id}`);
  });

  it('serves Twitch helix envelopes with the data array the adapter parses', async () => {
    const token = await twitchToken();
    const headers = { Authorization: `Bearer ${token}`, 'Client-Id': CLIENT_ID };

    const users = await (await fetch(`${base}/helix/users`, { headers })).json();
    expect(users.data[0].login).toBe('livetap_dev');
    const userId = users.data[0].id;

    const key = await (
      await fetch(`${base}/helix/streams/key?broadcaster_id=${userId}`, { headers })
    ).json();
    expect(key.data[0].stream_key).toMatch(/^live_dev_/);

    const ingests = await (await fetch(`${base}/helix/ingests`)).json();
    expect(ingests.ingests[0].url_template).toBe('rtmp://127.0.0.1:1935/live/{stream_key}');
    expect(ingests.ingests[0].url_template_secure).toBeUndefined();

    const offline = await (await fetch(`${base}/helix/streams?user_id=${userId}`, { headers })).json();
    expect(offline.data).toEqual([]);

    await fetch(`${base}/_control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'twitchLive', live: true, viewers: 42 }),
    });
    const online = await (await fetch(`${base}/helix/streams?user_id=${userId}`, { headers })).json();
    expect(online.data[0].type).toBe('live');
    expect(online.data[0].viewer_count).toBe(42);
  });

  it('requires the Client-Id header on helix, the way Twitch does', async () => {
    const token = await twitchToken();
    const res = await fetch(`${base}/helix/users`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toMatch(/Client-Id/);
  });

  it('isolates platforms: a YouTube token cannot call helix', async () => {
    const token = await youtubeToken();
    const res = await fetch(`${base}/helix/users`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': CLIENT_ID },
    });
    expect(res.status).toBe(401);
  });
});

describe('fault injection', () => {
  it('makes the next YouTube call 401 while Twitch keeps working', async () => {
    const { verifier, challenge } = pkcePair();
    const ytCode = codeFrom(await authorize({ challenge }));
    const yt = await (
      await postToken({
        grant_type: 'authorization_code',
        code: ytCode,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      })
    ).json();

    const twitchPkce = pkcePair();
    const twCode = codeFrom(
      await authorize({
        challenge: twitchPkce.challenge,
        platform: 'twitch',
        scope: 'channel:read:stream_key channel:manage:broadcast',
      }),
    );
    const tw = await (
      await postToken({
        grant_type: 'authorization_code',
        code: twCode,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: twitchPkce.verifier,
      })
    ).json();

    const injected = await fetch(`${base}/_control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'fault', platform: 'youtube', fault: '401', count: 1 }),
    });
    expect(injected.status).toBe(200);

    const ytHeaders = { Authorization: `Bearer ${yt.access_token}` };
    const failed = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, { headers: ytHeaders });
    expect(failed.status).toBe(401);

    // Failure isolation: Twitch is untouched by a YouTube fault.
    const twitchOk = await fetch(`${base}/helix/users`, {
      headers: { Authorization: `Bearer ${tw.access_token}`, 'Client-Id': CLIENT_ID },
    });
    expect(twitchOk.status).toBe(200);

    // One-shot: the next YouTube call succeeds again.
    const recovered = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, { headers: ytHeaders });
    expect(recovered.status).toBe(200);
  });

  it('supports a per-request query switch for 500', async () => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    const tokens = await (
      await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      })
    ).json();
    const res = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true&_fault=500`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error.errors[0].reason).toBe('backendError');
  });

  it('expires a platform token on demand and lets refresh recover it', async () => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    const tokens = await (
      await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      })
    ).json();

    await fetch(`${base}/_control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'fault', platform: 'youtube', fault: 'expired' }),
    });
    const expired = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(expired.status).toBe(401);

    const refreshed = await (
      await postToken({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: CLIENT_ID,
      })
    ).json();
    const ok = await fetch(`${base}/youtube/v3/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${refreshed.access_token}` },
    });
    expect(ok.status).toBe(200);
  });
});

describe('control surface', () => {
  it('reports state without ever returning a full access token', async () => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    const tokens = await (
      await postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      })
    ).json();

    // Google's revoke endpoint takes the token in the query string, which is
    // exactly the case the request journal has to redact.
    await fetch(`${base}/revoke?token=${encodeURIComponent(tokens.access_token)}`);

    const raw = await (await fetch(`${base}/_control`)).text();
    expect(raw).not.toContain(tokens.access_token);
    expect(raw).not.toContain(tokens.refresh_token);

    const snapshot = JSON.parse(raw);
    expect(snapshot.tokens).toHaveLength(1);
    expect(snapshot.tokens[0].accessToken).toEqual({
      prefix: tokens.access_token.slice(0, 8),
      length: tokens.access_token.length,
    });
    expect(snapshot.counters.issued).toBe(1);
    expect(snapshot.requestLog.some((entry) => entry.path === '/revoke?token=****')).toBe(true);
  });

  it('resets everything on demand', async () => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize({ challenge }));
    await postToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    const res = await fetch(`${base}/_control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'reset' }),
    });
    expect(res.status).toBe(200);
    const after = await (await fetch(`${base}/_control`)).json();
    expect(after.tokens).toHaveLength(0);
    expect(after.counters.issued).toBe(0);
  });
});

describe('pure helpers', () => {
  it('verifies PKCE in both the base64url and the hex encodings the repo supports', () => {
    const verifier = 'a'.repeat(64);
    const digest = createHash('sha256').update(verifier, 'utf8').digest();
    expect(verifyPkce(verifier, base64url(digest), 'S256').ok).toBe(true);
    expect(verifyPkce(verifier, digest.toString('hex'), 'S256').ok).toBe(true);
    expect(verifyPkce('b'.repeat(64), base64url(digest), 'S256').ok).toBe(false);
    expect(verifyPkce('short', base64url(digest), 'S256').ok).toBe(false);
    expect(verifyPkce(verifier, base64url(digest), 'plain').ok).toBe(false);
  });

  it('pins the redirect_uri policy to loopback, https and livetap://', () => {
    expect(isAllowedRedirectUri('http://127.0.0.1:5123/callback')).toBe(true);
    expect(isAllowedRedirectUri('livetap://auth/callback')).toBe(true);
    expect(isAllowedRedirectUri('https://livetap.example/oauth')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.example/callback')).toBe(false);
    expect(isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
  });

  it('describes a secret as a prefix and a length only', () => {
    expect(describeSecret('abcdefghijklmnop')).toEqual({ prefix: 'abcdefgh', length: 16 });
    expect(describeSecret('')).toBeNull();
  });
});
