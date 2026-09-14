/**
 * The point of the whole harness, asserted once: the REAL adapters from
 * packages/adapters, constructed exactly as production constructs them and
 * with no changes at all, drive this server end to end.
 *
 * If this file ever fails, either the harness has drifted from a platform's
 * response shape or an adapter has changed what it parses. Both are worth
 * knowing, and neither is visible from the adapters' own unit tests, which use
 * hand-written fakes rather than an HTTP server.
 *
 * Run from the repo root:
 *   npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts
 */

import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

import { YouTubeAdapter, TwitchAdapter, buildAuthorizeUrl, generatePkce, generateState } from '@livetap/adapters';
import { AdapterRegistry, BroadcastOrchestrator } from '@livetap/core';
import { MockEngine } from '@livetap/media';
import { exchangeCode, refreshToken, revoke } from '../../../apps/web/api/_lib/broker.ts';
import { createServer } from './fake-idp.mjs';

const CLIENT_ID = 'livetap-dev-client';
const REDIRECT_URI = 'http://127.0.0.1:53219/callback';

let server;
let base;

beforeAll(async () => {
  server = createServer({
    env: { LIVETAP_FAKE_CLIENT_IDS: CLIENT_ID, LIVETAP_FAKE_INGEST: 'rtmp://127.0.0.1:1935/live' },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A full sign-in through the real endpoints, returning the access token. */
async function connect(platform, scope) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let verifier = '';
  for (const byte of randomBytes(64)) verifier += alphabet[byte % alphabet.length];
  const challenge = base64url(createHash('sha256').update(verifier, 'utf8').digest());

  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope,
    state: 'adapters',
    platform,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    auto: 'approve',
  });
  const redirect = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' });
  const code = new URL(redirect.headers.get('location')).searchParams.get('code');

  const res = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
  });
  const tokens = await res.json();
  return tokens.access_token;
}

it('runs the real YouTubeAdapter through validate, createBroadcast, start and getStatus', async () => {
  const token = await connect('youtube', 'https://www.googleapis.com/auth/youtube.force-ssl');
  const adapter = new YouTubeAdapter({
    fetch: globalThis.fetch,
    tokenProvider: async () => token,
    apiBase: `${base}/youtube/v3`,
    sleep: async () => undefined,
  });

  const credential = { id: 'cred-1', platform: 'youtube', createdAt: Date.now() };
  const validated = await adapter.validate({ id: 'd1', platform: 'youtube', label: 'dev' }, credential);
  expect(validated.ok).toBe(true);
  expect(validated.credential.accountLabel).toBe('LIVETAP Dev Channel');
  expect(validated.credential.accountId).toMatch(/^UC/);

  const handle = await adapter.createBroadcast(
    { id: 'd1', platform: 'youtube', label: 'dev', metadata: { title: 'adapter smoke test' } },
    credential,
  );
  // This is the payoff: a real adapter got a real stream key from an API call
  // and is pointing at a local RTMP server it can actually push to.
  expect(handle.ingest.protocol).toBe('rtmp');
  expect(handle.ingest.url).toBe('rtmp://127.0.0.1:1935/live');
  expect(handle.ingest.streamKey).toMatch(/^lt-key-/);
  expect(handle.watchUrl).toContain(handle.broadcastId);

  await adapter.startBroadcast(handle, credential);
  const status = await adapter.getStatus(handle, credential);
  expect(status.live).toBe(true);
  expect(status.ingestHealth).toBe('good');

  await adapter.stopBroadcast(handle, credential);
  const stopped = await (await fetch(`${base}/_control`)).json();
  expect(stopped.broadcasts.at(-1).lifeCycleStatus).toBe('complete');
});

it('runs the real TwitchAdapter through validate, createBroadcast and getStatus', async () => {
  const token = await connect('twitch', 'channel:read:stream_key channel:manage:broadcast');
  const adapter = new TwitchAdapter({
    fetch: globalThis.fetch,
    tokenProvider: async () => token,
    apiBase: `${base}/helix`,
    clientId: CLIENT_ID,
    // The real adapter resolves the PoP from the official ingest list; point it at ours.
    ingestListUrl: `${base}/helix/ingests`,
  });

  const credential = { id: 'cred-2', platform: 'twitch', accountId: '900001', accountLabel: 'livetap_dev', createdAt: Date.now() };
  const validated = await adapter.validate({ id: 'd2', platform: 'twitch', label: 'dev' }, credential);
  expect(validated.ok).toBe(true);
  expect(validated.watchUrl).toBe('https://www.twitch.tv/livetap_dev');
  expect(validated.ingest.url).toBe('rtmp://127.0.0.1:1935/live');
  expect(validated.ingest.streamKey).toMatch(/^live_dev_/);

  const handle = await adapter.createBroadcast(
    { id: 'd2', platform: 'twitch', label: 'dev', accountId: '900001', metadata: { title: 'adapter smoke test' } },
    credential,
  );
  expect(handle.ingest.streamKey).toMatch(/^live_dev_/);

  const offline = await adapter.getStatus(handle, credential);
  expect(offline.live).toBe(false);

  await fetch(`${base}/_control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'twitchLive', live: true, viewers: 9 }),
  });
  const online = await adapter.getStatus(handle, credential);
  expect(online.live).toBe(true);
  expect(online.viewers).toBe(9);
});

it('surfaces an injected 401 as an HttpError the product can classify', async () => {
  const token = await connect('youtube', 'https://www.googleapis.com/auth/youtube.force-ssl');
  const adapter = new YouTubeAdapter({
    fetch: globalThis.fetch,
    tokenProvider: async () => token,
    apiBase: `${base}/youtube/v3`,
    sleep: async () => undefined,
  });
  await fetch(`${base}/_control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'fault', platform: 'youtube', fault: '401', count: 1 }),
  });
  await expect(
    adapter.validate({ id: 'd1', platform: 'youtube', label: 'dev' }, { id: 'c', platform: 'youtube', createdAt: 0 }),
  ).rejects.toMatchObject({ name: 'HttpError', status: 401 });
});


/* ---------------------------------------------------------------------------
 * The accounts flow, end to end, with no piece of it faked except the platform.
 *
 * Everything between the tap and the name on the card is the SAME code the product ships:
 * `generatePkce` and `buildAuthorizeUrl` from packages/adapters, `exchangeCode` from the real
 * token broker in apps/web/api, the real `YouTubeAdapter`, and a real `BroadcastOrchestrator`.
 * The only substitution is which host answers, and the harness answers the way Google does:
 * it recomputes the S256 challenge and refuses a wrong verifier, it burns a code after one use,
 * and it enforces the scope on every API call.
 *
 * The assertion that matters is the last one. Before this workstream, `validate()`'s answer was
 * dropped on the floor and a destination card could only ever say "YouTube".
 * ------------------------------------------------------------------------- */

/** The environment a LIVETAP deployment would have, pointed at the harness. */
function brokerEnv() {
  return {
    LIVETAP_YOUTUBE_CLIENT_ID: CLIENT_ID,
    LIVETAP_YOUTUBE_CLIENT_SECRET: 'livetap-dev-secret',
    LIVETAP_TWITCH_CLIENT_ID: CLIENT_ID,
    LIVETAP_TWITCH_CLIENT_SECRET: 'livetap-dev-secret',
    LIVETAP_OAUTH_BASE: base,
    NODE_ENV: 'test',
  };
}

/**
 * Everything `beginAuth` does, using the same two production functions, up to the redirect.
 * Returns what the callback would carry back plus the verifier the app is holding.
 */
async function authorizeLikeTheApp(platform, scopes) {
  const pkce = await generatePkce();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(platform, {
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes,
    state,
    codeChallenge: pkce.codeChallenge,
  });
  // Send it to the harness rather than to accounts.google.com, and approve without a click.
  const target = new URL(authorizeUrl);
  const onHarness = new URL(`${base}/authorize`);
  for (const [k, v] of target.searchParams) onHarness.searchParams.set(k, v);
  onHarness.searchParams.set('platform', platform);
  onHarness.searchParams.set('auto', 'approve');
  /*
   * The harness requires PKCE of every client, and `buildAuthorizeUrl` correctly omits it for
   * Twitch, which documents none. The product's answer to that is the device code grant, which
   * this harness does not serve, so the challenge is added here to get a Twitch TOKEN to drive
   * the adapter with. What is proven below is the ADAPTER's first-connect behaviour, not
   * Twitch's real desktop sign-in, which stays unproven until the owner's client id exists.
   */
  if (!onHarness.searchParams.has('code_challenge')) {
    onHarness.searchParams.set('code_challenge', pkce.codeChallenge);
    onHarness.searchParams.set('code_challenge_method', 'S256');
  }

  const redirect = await fetch(onHarness, { redirect: 'manual' });
  const location = new URL(redirect.headers.get('location'));
  return {
    code: location.searchParams.get('code'),
    state: location.searchParams.get('state'),
    expectedState: state,
    codeVerifier: pkce.codeVerifier,
  };
}

it('signs in the way the product does, and the destination card learns the channel name', async () => {
  const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];
  const callback = await authorizeLikeTheApp('youtube', scopes);
  // The state check is the whole security of the callback, so assert the harness echoed ours.
  expect(callback.state).toBe(callback.expectedState);

  const tokens = await exchangeCode(
    { platform: 'youtube', code: callback.code, redirectUri: REDIRECT_URI, codeVerifier: callback.codeVerifier },
    brokerEnv(),
  );
  expect(tokens.accessToken).toBeTruthy();
  expect(tokens.refreshToken).toBeTruthy();
  expect(tokens.scope).toContain(scopes[0]);

  const registry = new AdapterRegistry();
  registry.register(
    new YouTubeAdapter({
      fetch: globalThis.fetch,
      // This is exactly what `tokenProviderFor` is: a closure the adapter calls, holding the
      // only reference to the access token anywhere in the process.
      tokenProvider: async () => tokens.accessToken,
      apiBase: `${base}/youtube/v3`,
      sleep: async () => undefined,
    }),
  );

  const orchestrator = new BroadcastOrchestrator({ registry, engine: new MockEngine({ connectDelayMs: 1 }) });
  orchestrator.addDestination({
    id: 'dest-youtube',
    platform: 'youtube',
    label: 'YouTube',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
  });
  const snapshot = await orchestrator.connect('dest-youtube', {
    id: 'oauth:youtube',
    platform: 'youtube',
    scopes: tokens.scope,
  });

  expect(snapshot.state).toBe('READY');
  // The one sentence this whole workstream exists to print.
  expect(snapshot.account?.accountLabel).toBe('LIVETAP Dev Channel');
  expect(snapshot.account?.accountId).toMatch(/^UC/);
  expect(snapshot.account?.avatarUrl).toBe(`${base}/assets/avatar.svg`);
  expect(snapshot.account?.scopes).toContain(scopes[0]);
  // And the one thing that must never reach a snapshot.
  expect(JSON.stringify(snapshot)).not.toContain(tokens.accessToken);
  expect(JSON.stringify(snapshot)).not.toContain(tokens.refreshToken);
});

it('refreshes through the broker and the rotated refresh token is the one that works next', async () => {
  const callback = await authorizeLikeTheApp('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl']);
  const env = brokerEnv();
  const first = await exchangeCode(
    { platform: 'youtube', code: callback.code, redirectUri: REDIRECT_URI, codeVerifier: callback.codeVerifier },
    env,
  );

  const second = await refreshToken({ platform: 'youtube', refreshToken: first.refreshToken }, env);
  expect(second.accessToken).toBeTruthy();
  expect(second.accessToken).not.toBe(first.accessToken);
  expect(second.refreshToken).toBeTruthy();
  expect(second.refreshToken).not.toBe(first.refreshToken);

  /*
   * Why this assertion exists: Twitch device-code and Kick refresh tokens are single use. A
   * client that keeps the old one after a successful refresh works exactly once and then signs
   * the creator out for no visible reason. The harness rotates the same way, so this is the test
   * that catches it.
   */
  await expect(refreshToken({ platform: 'youtube', refreshToken: first.refreshToken }, env)).rejects.toMatchObject({
    name: 'BrokerError',
  });
  const third = await refreshToken({ platform: 'youtube', refreshToken: second.refreshToken }, env);
  expect(third.accessToken).toBeTruthy();
});

it('disconnect really revokes: the platform stops accepting the token', async () => {
  const callback = await authorizeLikeTheApp('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl']);
  const env = brokerEnv();
  const tokens = await exchangeCode(
    { platform: 'youtube', code: callback.code, redirectUri: REDIRECT_URI, codeVerifier: callback.codeVerifier },
    env,
  );
  const adapter = new YouTubeAdapter({
    fetch: globalThis.fetch,
    tokenProvider: async () => tokens.accessToken,
    apiBase: `${base}/youtube/v3`,
    sleep: async () => undefined,
  });
  const before = await adapter.validate({ id: 'd', platform: 'youtube', label: 'dev' });
  expect(before.ok).toBe(true);

  // Revoking the REFRESH token has to take the whole grant with it; revoking only the access
  // token would leave a refresh token able to mint another one, and Disconnect would be a lie.
  const result = await revoke({ platform: 'youtube', token: tokens.refreshToken }, env);
  expect(result.revoked).toBe(true);

  await expect(adapter.validate({ id: 'd', platform: 'youtube', label: 'dev' })).rejects.toMatchObject({
    name: 'HttpError',
    status: 401,
  });
});

it('refuses a tampered PKCE verifier, which is the only thing protecting a desktop sign-in', async () => {
  const callback = await authorizeLikeTheApp('youtube', ['https://www.googleapis.com/auth/youtube.force-ssl']);
  await expect(
    exchangeCode(
      {
        platform: 'youtube',
        code: callback.code,
        redirectUri: REDIRECT_URI,
        // A verifier of the right shape that simply is not the one whose challenge was sent.
        codeVerifier: 'z'.repeat(64),
      },
      brokerEnv(),
    ),
  ).rejects.toMatchObject({ name: 'BrokerError' });
});

it('the harness override is refused in production, so a real deployment cannot be pointed at it', async () => {
  const { oauthBaseOverride } = await import('../../../apps/web/api/_lib/broker.ts');
  expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: base, NODE_ENV: 'test' })).toBe(base);
  expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: base, NODE_ENV: 'production' })).toBeUndefined();
  expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'https://evil.example.com' })).toBeUndefined();
  expect(oauthBaseOverride({ LIVETAP_OAUTH_BASE: 'http://evil.example.com' })).toBeUndefined();
});

it('runs the real TwitchAdapter from a fresh sign-in with no broadcaster id to start from', async () => {
  const callback = await authorizeLikeTheApp('twitch', ['channel:read:stream_key', 'channel:manage:broadcast']);
  const tokens = await exchangeCode(
    { platform: 'twitch', code: callback.code, redirectUri: REDIRECT_URI, codeVerifier: callback.codeVerifier },
    brokerEnv(),
  );
  const adapter = new TwitchAdapter({
    fetch: globalThis.fetch,
    tokenProvider: async () => tokens.accessToken,
    apiBase: `${base}/helix`,
    clientId: CLIENT_ID,
    ingestListUrl: `${base}/helix/ingests`,
  });

  /*
   * The credential carries no accountId, which is the state of every first connect: nothing can
   * put a broadcaster id on a credential before a successful sign-in. validate() used to refuse
   * outright here, which made connecting a fresh Twitch account impossible.
   */
  const validated = await adapter.validate({ id: 'd2', platform: 'twitch', label: 'dev' }, {
    id: 'oauth:twitch',
    platform: 'twitch',
    scopes: tokens.scope,
  });
  expect(validated.ok).toBe(true);
  expect(validated.credential.accountId).toBe('900001');
  expect(validated.credential.accountLabel).toBe('LIVETAP Dev');
  expect(validated.credential.avatarUrl).toBe(`${base}/assets/avatar.svg`);
  expect(validated.ingest.streamKey).toMatch(/^live_dev_/);
});
