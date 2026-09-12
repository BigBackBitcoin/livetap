import { describe, expect, it } from 'vitest';
import { classifyFailure, type ChatMessage, type DestinationConfig, type IngestTarget } from '@livetap/core';
import { KickAdapter } from './KickAdapter.js';
import { HttpError } from './http.js';
import { createFakeFetch, type FakeRoute } from '../testing/fakeFetch.js';

const API = 'https://api.kick.test';
const credential = {
  id: 'cred-kick',
  platform: 'kick',
  accountId: '777',
  accountLabel: 'adastreams',
};
const ingest: IngestTarget = {
  protocol: 'rtmp',
  url: 'rtmp://ingest.kick.test/live',
  streamKey: 'sk_live_abc',
};

function config(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    id: 'dest-kick',
    platform: 'kick',
    label: 'adastreams',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
    ingest,
    metadata: { title: 'Late night build', category: '42' },
    ...overrides,
  };
}

function adapterWith(routes: FakeRoute[], trustChannelStreamKey = false) {
  const fake = createFakeFetch(routes);
  const adapter = new KickAdapter({
    fetch: fake.fetch,
    tokenProvider: async () => 'kick-access-token',
    apiBase: API,
    trustChannelStreamKey,
  });
  return { adapter, fake };
}

describe('KickAdapter capabilities', () => {
  it('does not implement or claim chat read, because Kick chat is webhook-only', () => {
    const { adapter } = adapterWith([]);
    expect(adapter.supports('chatRead')).toBe(false);
    expect('subscribeChat' in adapter).toBe(false);
    expect(adapter.supports('chatWrite')).toBe(true);
    expect(adapter.supports('moderation')).toBe(true);
    expect(adapter.supports('metadata')).toBe(true);
    expect(adapter.supports('analytics')).toBe(false);
    expect(adapter.supports('broadcastCreation')).toBe(false);
    expect(adapter.profile.autoStartsOnIngest).toBe(true);
  });
});

describe('KickAdapter validate', () => {
  it('reads the channel and keeps the user-pasted ingest', async () => {
    const { adapter, fake } = adapterWith([
      {
        match: '/public/v1/channels',
        body: { data: [{ broadcaster_user_id: 777, slug: 'adastreams', stream: { is_live: false } }] },
      },
    ]);
    const result = await adapter.validate(config(), credential);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ingest).toEqual(ingest);
      expect(result.watchUrl).toBe('https://kick.com/adastreams');
      expect(result.credential?.accountId).toBe('777');
    }
    expect(fake.calls[0]?.url).toBe(`${API}/public/v1/channels`);
    expect(fake.calls[0]?.headers['Authorization']).toBe('Bearer kick-access-token');
  });

  it('requires a pasted stream key because Kick has no documented key endpoint', async () => {
    const { adapter } = adapterWith([
      { match: '/public/v1/channels', body: { data: [{ broadcaster_user_id: 777 }] } },
    ]);
    const result = await adapter.validate(config({ ingest: undefined }), credential);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONFIG_INVALID');
      expect(result.technical).toMatch(/pasted stream URL and key/);
    }
  });

  it('uses stream.url/stream.key only when explicitly trusted and both are present', async () => {
    const routes: FakeRoute[] = [
      {
        match: '/public/v1/channels',
        body: {
          data: [
            {
              broadcaster_user_id: 777,
              slug: 'adastreams',
              stream: { url: 'rtmps://ingest.kick.test/live', key: 'from-api' },
            },
          ],
        },
      },
    ];
    const trusted = adapterWith(routes, true);
    const trustedResult = await trusted.adapter.validate(config({ ingest: undefined }), credential);
    expect(trustedResult.ok).toBe(true);
    if (trustedResult.ok) {
      expect(trustedResult.ingest).toEqual({
        protocol: 'rtmps',
        url: 'rtmps://ingest.kick.test/live',
        streamKey: 'from-api',
      });
    }

    // Default: the UNVERIFIED mapping is ignored and the pasted ingest wins.
    const untrusted = adapterWith(routes, false);
    const untrustedResult = await untrusted.adapter.validate(config(), credential);
    expect(untrustedResult.ok && untrustedResult.ingest).toEqual(ingest);
  });

  it('reports PLATFORM_ERROR if Kick returns no channel', async () => {
    const { adapter } = adapterWith([{ match: '/public/v1/channels', body: { data: [] } }]);
    const result = await adapter.validate(config(), credential);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PLATFORM_ERROR');
  });
});

describe('KickAdapter go-live sequence', () => {
  it('PATCHes title and category, then returns the configured ingest', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/public/v1/channels', method: 'PATCH', status: 204, text: '' },
    ]);
    const handle = await adapter.createBroadcast(config(), credential);
    expect(fake.sequence()).toEqual([`PATCH ${API}/public/v1/channels`]);
    expect(fake.calls[0]?.json).toEqual({ stream_title: 'Late night build', category_id: 42 });
    expect(handle).toEqual({
      streamId: '777',
      ingest,
      watchUrl: 'https://kick.com/adastreams',
    });
  });

  it('refuses to create a broadcast without an ingest', async () => {
    const { adapter } = adapterWith([]);
    await expect(
      adapter.createBroadcast(config({ ingest: undefined }), credential),
    ).rejects.toThrow(/stream URL and key/);
  });

  it('stopBroadcast makes no request — Kick has no stop endpoint', async () => {
    const { adapter, fake } = adapterWith([]);
    await adapter.stopBroadcast({ ingest }, credential);
    expect(fake.calls).toHaveLength(0);
  });

  it('reads live status, and does not treat a hidden viewer count as empty', async () => {
    const { adapter } = adapterWith([
      {
        match: '/public/v1/channels',
        body: { data: [{ stream: { is_live: true, viewer_count: 0 } }] },
      },
    ]);
    const status = await adapter.getStatus({ ingest }, credential);
    // 0 is reported as-is; the profile notes that 0 can mean "hidden".
    expect(status).toEqual({ live: true, ingestHealth: 'good', viewers: 0 });
  });
});

describe('KickAdapter chat write and moderation', () => {
  it('sends chat with the documented body', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/public/v1/chat', method: 'POST', body: { is_sent: true, message_id: 'x' } },
    ]);
    await adapter.sendChat({ streamId: '777', ingest }, 'evening all', credential);
    expect(fake.calls[0]?.url).toBe(`${API}/public/v1/chat`);
    expect(fake.calls[0]?.json).toEqual({
      type: 'user',
      content: 'evening all',
      broadcaster_user_id: 777,
    });
  });

  it('converts a timeout to MINUTES and clamps it to Kick\'s 1..10080 range', async () => {
    const message: ChatMessage = {
      id: 'm',
      platform: 'kick',
      destinationId: 'd',
      author: { id: '4242', displayName: 'Troll' },
      text: 'bad',
      receivedAt: 0,
      platformMessageId: 'uuid-1',
    };
    const { adapter, fake } = adapterWith([
      { match: '/public/v1/moderation/bans', method: 'POST', body: {} },
      { match: '/public/v1/moderation/bans', method: 'POST', body: {} },
      { match: '/public/v1/moderation/bans', method: 'POST', body: {} },
      { match: '/public/v1/chat/', method: 'DELETE', text: '' },
    ]);
    const handle = { streamId: '777', ingest };
    await adapter.moderate(handle, { action: 'timeout', message, durationSeconds: 600 }, credential);
    expect(fake.calls[0]?.json).toEqual({
      broadcaster_user_id: 777,
      user_id: 4242,
      duration: 10,
    });
    // 30 seconds rounds up to the 1-minute floor, not down to 0.
    await adapter.moderate(handle, { action: 'timeout', message, durationSeconds: 30 }, credential);
    expect((fake.calls[1]?.json as { duration: number }).duration).toBe(1);
    // A permanent ban omits duration entirely.
    await adapter.moderate(handle, { action: 'ban', message }, credential);
    expect(fake.calls[2]?.json).toEqual({ broadcaster_user_id: 777, user_id: 4242 });
    // Message deletion uses the UUID from the chat payload.
    await adapter.moderate(handle, { action: 'delete', message }, credential);
    expect(fake.calls[3]?.url).toBe(`${API}/public/v1/chat/uuid-1`);
  });
});

describe('KickAdapter error mapping', () => {
  it('maps 401 to AUTH_EXPIRED', async () => {
    const { adapter } = adapterWith([
      { match: '/public/v1/channels', status: 401, body: { message: 'Unauthorized' } },
    ]);
    await expect(adapter.validate(config(), credential)).rejects.toSatisfy((err: unknown) => {
      const e = err as HttpError;
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(401);
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_EXPIRED');
      return true;
    });
  });

  it('maps an undocumented 429 to RATE_LIMITED so backoff kicks in', async () => {
    const { adapter } = adapterWith([
      { match: '/public/v1/chat', method: 'POST', status: 429, text: '' },
    ]);
    await adapter.sendChat({ streamId: '777', ingest }, 'spam', credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('RATE_LIMITED');
    });
  });

  it('accepts an empty 204 body from PATCH channels', async () => {
    const { adapter } = adapterWith([
      { match: '/public/v1/channels', method: 'PATCH', status: 204, text: '' },
    ]);
    await expect(
      adapter.publishMetadata({ ingest }, { title: 'New title' }, credential),
    ).resolves.toBeUndefined();
  });
});
