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

import { YouTubeAdapter, TwitchAdapter } from '@livetap/adapters';
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
