import { describe, expect, it } from 'vitest';
import { classifyFailure, type ChatMessage, type DestinationConfig } from '@livetap/core';
import { YouTubeAdapter } from './YouTubeAdapter.js';
import { HttpError } from './http.js';
import { createFakeFetch } from '../testing/fakeFetch.js';

const API = 'https://api.test/youtube/v3';
const credential = { id: 'cred-1', platform: 'youtube', accountId: 'UC123' };

function config(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    id: 'dest-yt',
    platform: 'youtube',
    label: 'My channel',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
    metadata: { title: 'Launch day', description: 'Hello', privacy: 'public' },
    ...overrides,
  };
}

function adapterWith(routes: Parameters<typeof createFakeFetch>[0]) {
  const fake = createFakeFetch(routes);
  const adapter = new YouTubeAdapter({
    fetch: fake.fetch,
    tokenProvider: async () => 'yt-access-token',
    apiBase: API,
    sleep: async () => undefined,
    streamPollIntervalMs: 0,
  });
  return { adapter, fake };
}

describe('YouTubeAdapter capabilities', () => {
  it('claims the full lifecycle and requires an explicit start', () => {
    const { adapter } = adapterWith([]);
    expect(adapter.profile.id).toBe('youtube');
    expect(adapter.profile.autoStartsOnIngest).toBe(false);
    expect(adapter.supports('broadcastCreation')).toBe(true);
    expect(adapter.supports('start')).toBe(true);
    expect(adapter.supports('chatRead')).toBe(true);
    expect(adapter.supports('chatWrite')).toBe(true);
    expect(adapter.supports('srt')).toBe(false);
    expect(adapter.supports('whip')).toBe(false);
  });
});

describe('YouTubeAdapter validate', () => {
  it('proves the token with a single channels.list call', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/channels', body: { items: [{ id: 'UC999', snippet: { title: 'Ada TV' } }] } },
    ]);
    const result = await adapter.validate(config(), credential);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.credential?.accountId).toBe('UC999');
      expect(result.credential?.accountLabel).toBe('Ada TV');
    }
    const call = fake.calls[0];
    expect(call?.method).toBe('GET');
    expect(call?.url).toBe(`${API}/channels?part=id%2Csnippet&mine=true`);
    expect(call?.headers['Authorization']).toBe('Bearer yt-access-token');
  });

  it('reports NOT_ELIGIBLE when the account has no channel', async () => {
    const { adapter } = adapterWith([{ match: '/channels', body: { items: [] } }]);
    const result = await adapter.validate(config(), credential);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_ELIGIBLE');
  });
});

describe('YouTubeAdapter go-live sequence', () => {
  const createRoutes = [
    {
      match: '/liveBroadcasts?',
      method: 'POST',
      body: { id: 'bcast-1', snippet: { liveChatId: 'chat-1' } },
    },
    {
      match: '/liveStreams?',
      method: 'POST',
      body: {
        id: 'stream-1',
        cdn: {
          ingestionInfo: {
            streamName: 'super-secret-key',
            ingestionAddress: 'rtmp://a.rtmp.youtube.com/live2',
            rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com/live2',
          },
        },
      },
    },
    { match: '/liveBroadcasts/bind', method: 'POST', body: { id: 'bcast-1' } },
  ];

  it('inserts the broadcast, inserts the stream, binds them, and returns RTMPS ingest', async () => {
    const { adapter, fake } = adapterWith(createRoutes);
    const handle = await adapter.createBroadcast(config(), credential);

    expect(fake.sequence()).toEqual([
      `POST ${API}/liveBroadcasts?part=id%2Csnippet%2CcontentDetails%2Cstatus`,
      `POST ${API}/liveStreams?part=id%2Csnippet%2Ccdn%2CcontentDetails`,
      `POST ${API}/liveBroadcasts/bind?id=bcast-1&part=id%2CcontentDetails&streamId=stream-1`,
    ]);

    const insert = fake.calls[0]?.json as {
      snippet: { title: string; scheduledStartTime: string };
      status: { privacyStatus: string };
      contentDetails: { enableAutoStart: boolean; monitorStream: { enableMonitorStream: boolean } };
    };
    expect(insert.snippet.title).toBe('Launch day');
    // scheduledStartTime is mandatory even for "go live now".
    expect(Date.parse(insert.snippet.scheduledStartTime)).toBeGreaterThan(0);
    expect(insert.status.privacyStatus).toBe('public');
    // LIVETAP transitions explicitly, so autoStart and the monitor stream stay off.
    expect(insert.contentDetails.enableAutoStart).toBe(false);
    expect(insert.contentDetails.monitorStream.enableMonitorStream).toBe(false);

    const streamInsert = fake.calls[1]?.json as {
      cdn: { ingestionType: string; resolution: string; frameRate: string };
    };
    expect(streamInsert.cdn).toMatchObject({
      ingestionType: 'rtmp',
      resolution: 'variable',
      frameRate: 'variable',
    });

    expect(handle).toEqual({
      broadcastId: 'bcast-1',
      streamId: 'stream-1',
      ingest: {
        protocol: 'rtmps',
        url: 'rtmps://a.rtmps.youtube.com/live2',
        streamKey: 'super-secret-key',
      },
      watchUrl: 'https://www.youtube.com/watch?v=bcast-1',
    });
    // Every request carried the bearer token and nothing carried the stream key.
    for (const call of fake.calls) {
      expect(call.headers['Authorization']).toBe('Bearer yt-access-token');
      expect(call.body ?? '').not.toContain('super-secret-key');
    }
  });

  it('polls liveStreams until active before transitioning to live', async () => {
    const { adapter, fake } = adapterWith([
      { match: 'part=status&id=stream-1', body: { items: [{ status: { streamStatus: 'inactive' } }] }, times: 2 },
      { match: 'part=status&id=stream-1', body: { items: [{ status: { streamStatus: 'active' } }] }, times: 1 },
      { match: '/liveBroadcasts/transition', method: 'POST', body: { id: 'bcast-1' } },
    ]);
    await adapter.startBroadcast(
      { broadcastId: 'bcast-1', streamId: 'stream-1', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    expect(fake.calls.filter((c) => c.url.includes('/liveStreams'))).toHaveLength(3);
    const transition = fake.calls.at(-1);
    expect(transition?.method).toBe('POST');
    expect(transition?.url).toBe(
      `${API}/liveBroadcasts/transition?id=bcast-1&part=id%2Cstatus&broadcastStatus=live`,
    );
  });

  it('gives up with a clear error if ingest never becomes active', async () => {
    const fake = createFakeFetch([
      { match: '/liveStreams', body: { items: [{ status: { streamStatus: 'inactive' } }] } },
    ]);
    const adapter = new YouTubeAdapter({
      fetch: fake.fetch,
      tokenProvider: async () => 't',
      apiBase: API,
      sleep: async () => undefined,
      streamPollMaxAttempts: 3,
    });
    await expect(
      adapter.startBroadcast(
        { broadcastId: 'b', streamId: 's', ingest: { protocol: 'rtmps', url: 'x' } },
        credential,
      ),
    ).rejects.toThrow(/never saw the stream become active/);
    expect(fake.calls).toHaveLength(3);
  });

  it('transitions to complete on stop', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/liveBroadcasts/transition', method: 'POST', body: {} },
    ]);
    await adapter.stopBroadcast(
      { broadcastId: 'bcast-1', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    expect(fake.calls[0]?.url).toBe(
      `${API}/liveBroadcasts/transition?id=bcast-1&part=id%2Cstatus&broadcastStatus=complete`,
    );
  });
});

describe('YouTubeAdapter status, chat and analytics', () => {
  it('reads stream status and concurrent viewers', async () => {
    const { adapter } = adapterWith([
      {
        match: '/liveStreams',
        body: { items: [{ status: { streamStatus: 'active', healthStatus: { status: 'good' } } }] },
      },
      {
        match: '/videos',
        body: { items: [{ liveStreamingDetails: { concurrentViewers: '1234' } }] },
      },
    ]);
    const status = await adapter.getStatus(
      { broadcastId: 'bcast-1', streamId: 'stream-1', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    expect(status).toEqual({ live: true, ingestHealth: 'good', viewers: 1234 });
  });

  it('omits viewers when YouTube omits concurrentViewers', async () => {
    const { adapter } = adapterWith([
      { match: '/videos', body: { items: [{ liveStreamingDetails: {}, statistics: {} }] } },
    ]);
    const analytics = await adapter.getAnalytics(
      { broadcastId: 'bcast-1', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    // Absent, not zero — hiding the count must not read as "nobody watching".
    expect(analytics.viewers).toBeUndefined();
  });

  it('polls live chat, honours pollingIntervalMillis and maps authors', async () => {
    const waits: number[] = [];
    const fake = createFakeFetch([
      { match: '/liveBroadcasts?part=snippet', body: { items: [{ snippet: { liveChatId: 'chat-1' } }] } },
      {
        match: '/liveChat/messages',
        body: {
          items: [
            {
              id: 'msg-1',
              snippet: { publishedAt: '2026-09-11T10:00:00Z', displayMessage: 'hello there' },
              authorDetails: {
                channelId: 'UCviewer',
                displayName: 'Viewer One',
                isChatModerator: true,
                isChatSponsor: true,
              },
            },
          ],
          nextPageToken: 'page-2',
          pollingIntervalMillis: 4321,
        },
        times: 1,
      },
      { match: '/liveChat/messages', body: { items: [] } },
    ]);
    let releaseAfterTwoPolls: () => void = () => undefined;
    const twoPolls = new Promise<void>((resolve) => {
      releaseAfterTwoPolls = resolve;
    });
    const adapter = new YouTubeAdapter({
      fetch: fake.fetch,
      tokenProvider: async () => 'yt-access-token',
      apiBase: API,
      sleep: async (ms) => {
        waits.push(ms);
        if (waits.length >= 2) releaseAfterTwoPolls();
        // Yield to the macrotask queue so the poll loop cannot starve the test.
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    const received: ChatMessage[] = [];
    const sub = await adapter.subscribeChat(
      { broadcastId: 'bcast-1', ingest: { protocol: 'rtmps', url: 'x' } },
      (m) => received.push(m),
      credential,
    );
    await twoPolls;
    sub.stop();

    expect(received[0]).toMatchObject({
      id: 'msg-1',
      platform: 'youtube',
      destinationId: 'bcast-1',
      text: 'hello there',
      platformMessageId: 'msg-1',
      author: { id: 'UCviewer', displayName: 'Viewer One', badges: ['moderator', 'member'] },
    });
    expect(received[0]?.mock).toBeUndefined();
    expect(waits[0]).toBe(4321);
    // The second page must carry the cursor from the first.
    const second = fake.calls.filter((c) => c.url.includes('/liveChat/messages'))[1];
    expect(second?.url).toContain('pageToken=page-2');
  });

  it('sends chat through liveChatMessages.insert', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/liveBroadcasts?part=snippet', body: { items: [{ snippet: { liveChatId: 'chat-1' } }] } },
      { match: '/liveChat/messages', method: 'POST', body: {} },
    ]);
    await adapter.sendChat(
      { broadcastId: 'bcast-1', ingest: { protocol: 'rtmps', url: 'x' } },
      'thanks for watching',
      credential,
    );
    const post = fake.calls.at(-1);
    expect(post?.url).toBe(`${API}/liveChat/messages?part=snippet`);
    expect(post?.json).toEqual({
      snippet: {
        liveChatId: 'chat-1',
        type: 'textMessageEvent',
        textMessageDetails: { messageText: 'thanks for watching' },
      },
    });
  });

  it('deletes a message and bans a user through the documented endpoints', async () => {
    const message: ChatMessage = {
      id: 'm1',
      platform: 'youtube',
      destinationId: 'd',
      author: { id: 'UCbad', displayName: 'Spammer' },
      text: 'spam',
      receivedAt: 0,
      platformMessageId: 'pm1',
    };
    const { adapter, fake } = adapterWith([
      { match: '/liveChat/messages', method: 'DELETE', body: {} },
      { match: '/liveBroadcasts?part=snippet', body: { items: [{ snippet: { liveChatId: 'chat-1' } }] } },
      { match: '/liveChat/bans', method: 'POST', body: {} },
    ]);
    const handle = { broadcastId: 'bcast-1', ingest: { protocol: 'rtmps' as const, url: 'x' } };
    await adapter.moderate(handle, { action: 'delete', message }, credential);
    expect(fake.calls[0]?.url).toBe(`${API}/liveChat/messages?id=pm1`);
    await adapter.moderate(handle, { action: 'timeout', message, durationSeconds: 60 }, credential);
    const ban = fake.calls.at(-1)?.json as { snippet: { type: string; banDurationSeconds: number } };
    expect(ban.snippet.type).toBe('temporary');
    expect(ban.snippet.banDurationSeconds).toBe(60);
  });
});

describe('YouTubeAdapter error mapping', () => {
  it('throws HttpError with the status so classifyFailure maps 401 to AUTH_EXPIRED', async () => {
    const { adapter } = adapterWith([
      {
        match: '/channels',
        status: 401,
        body: { error: { code: 401, message: 'Invalid Credentials' } },
      },
    ]);
    await expect(adapter.validate(config(), credential)).rejects.toSatisfy((err: unknown) => {
      const e = err as HttpError;
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(401);
      expect(e.message).toContain('Invalid Credentials');
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_EXPIRED');
      return true;
    });
  });

  it('maps 403 quota errors to QUOTA_EXCEEDED and 429 to RATE_LIMITED', async () => {
    const quota = adapterWith([
      {
        match: '/liveBroadcasts',
        method: 'POST',
        status: 403,
        body: { error: { message: 'The request cannot be completed because you have exceeded your quota.' } },
      },
    ]);
    await quota.adapter.createBroadcast(config(), credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('QUOTA_EXCEEDED');
    });

    const limited = adapterWith([
      { match: '/channels', status: 429, body: { error: { message: 'Too many requests' } } },
    ]);
    await limited.adapter.validate(config(), credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('RATE_LIMITED');
    });
  });

  it('never puts a token in the error message', async () => {
    const { adapter } = adapterWith([
      {
        match: '/channels',
        status: 400,
        text: 'access_token=super-secret-token is invalid',
      },
    ]);
    await expect(adapter.validate(config(), credential)).rejects.toSatisfy((err: unknown) => {
      expect((err as Error).message).not.toContain('super-secret-token');
      expect((err as Error).message).toContain('••••');
      return true;
    });
  });
});
