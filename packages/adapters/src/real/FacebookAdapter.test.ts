import { describe, expect, it } from 'vitest';
import { classifyFailure, type ChatMessage, type DestinationConfig } from '@livetap/core';
import { FacebookAdapter } from './FacebookAdapter.js';
import { HttpError } from './http.js';
import { createFakeFetch, type FakeRoute } from '../testing/fakeFetch.js';

const API = 'https://graph.test/v25.0';
const credential = {
  id: 'cred-fb',
  platform: 'facebook',
  accountId: '1055512345',
  accountLabel: 'Ada Labs',
};

function config(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    id: 'dest-fb',
    platform: 'facebook',
    label: 'Ada Labs',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
    metadata: { title: 'Workshop', description: 'Live build', privacy: 'public' },
    ...overrides,
  };
}

function adapterWith(routes: FakeRoute[], sleep?: (ms: number) => Promise<void>) {
  const fake = createFakeFetch(routes);
  const adapter = new FacebookAdapter({
    fetch: fake.fetch,
    tokenProvider: async () => 'fb-page-token',
    apiBase: API,
    ...(sleep ? { sleep } : {}),
  });
  return { adapter, fake };
}

describe('FacebookAdapter capabilities', () => {
  it('claims creation and stop, but not moderation, thumbnails or chat write', () => {
    const { adapter } = adapterWith([]);
    expect(adapter.supports('broadcastCreation')).toBe(true);
    expect(adapter.supports('stop')).toBe(true);
    expect(adapter.supports('chatRead')).toBe(true);
    expect(adapter.supports('chatWrite')).toBe(false);
    expect(adapter.supports('moderation')).toBe(false);
    expect(adapter.supports('thumbnail')).toBe(false);
    expect(adapter.supports('srt')).toBe(false);
    // status=LIVE_NOW at create means no separate start call.
    expect(adapter.profile.autoStartsOnIngest).toBe(true);
    expect('startBroadcast' in adapter).toBe(false);
  });
});

describe('FacebookAdapter go-live sequence', () => {
  it('creates the live video with LIVE_NOW and splits secure_stream_url into url + key', async () => {
    const { adapter, fake } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        body: {
          id: '90210',
          secure_stream_url: 'rtmps://rtmp-api.facebook.test/rtmp/FB-90210-key-abc',
          permalink_url: '/AdaLabs/videos/90210/',
        },
      },
    ]);
    const handle = await adapter.createBroadcast(config(), credential);

    expect(fake.sequence()).toEqual([`POST ${API}/1055512345/live_videos`]);
    expect(fake.calls[0]?.headers['Authorization']).toBe('Bearer fb-page-token');
    expect(fake.calls[0]?.json).toEqual({
      status: 'LIVE_NOW',
      title: 'Workshop',
      description: 'Live build',
      privacy: '{"value":"EVERYONE"}',
    });
    expect(handle).toEqual({
      broadcastId: '90210',
      ingest: {
        protocol: 'rtmps',
        url: 'rtmps://rtmp-api.facebook.test/rtmp',
        streamKey: 'FB-90210-key-abc',
      },
      watchUrl: 'https://www.facebook.com/AdaLabs/videos/90210/',
    });
  });

  it('falls back to the user timeline when no Page id is known', async () => {
    const { adapter, fake } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        body: { id: '1', secure_stream_url: 'rtmps://host/rtmp/k' },
      },
    ]);
    await adapter.createBroadcast(config({ accountId: undefined }), {
      id: 'c',
      platform: 'facebook',
    });
    expect(fake.calls[0]?.url).toBe(`${API}/me/live_videos`);
  });

  it('truncates a long title to Facebook\'s 254-character limit', async () => {
    const { adapter, fake } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        body: { id: '1', secure_stream_url: 'rtmps://host/rtmp/k' },
      },
    ]);
    await adapter.createBroadcast(
      config({ metadata: { title: 'x'.repeat(400) } }),
      credential,
    );
    expect((fake.calls[0]?.json as { title: string }).title).toHaveLength(254);
  });

  it('throws rather than going live without a stream URL', async () => {
    const { adapter } = adapterWith([{ match: '/live_videos', method: 'POST', body: { id: '1' } }]);
    await expect(adapter.createBroadcast(config(), credential)).rejects.toThrow(
      /did not return a live video stream URL/,
    );
  });

  it('ends the broadcast with end_live_video=true', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/90210', method: 'POST', body: { success: true } },
    ]);
    await adapter.stopBroadcast(
      { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    expect(fake.calls[0]?.url).toBe(`${API}/90210`);
    expect(fake.calls[0]?.json).toEqual({ end_live_video: true });
  });

  it('reads status and only reports live_views when Facebook sends it', async () => {
    const withViews = adapterWith([
      { match: '/90210', body: { id: '90210', status: 'LIVE', live_views: 88 } },
    ]);
    await expect(
      withViews.adapter.getStatus(
        { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
        credential,
      ),
    ).resolves.toEqual({ live: true, ingestHealth: 'good', viewers: 88 });

    const withoutViews = adapterWith([
      { match: '/90210', body: { id: '90210', status: 'VOD' } },
    ]);
    await expect(
      withoutViews.adapter.getStatus(
        { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
        credential,
      ),
    ).resolves.toEqual({ live: false, ingestHealth: 'noData' });
  });

  it('updates metadata on a running broadcast', async () => {
    const { adapter, fake } = adapterWith([{ match: '/90210', method: 'POST', body: {} }]);
    await adapter.publishMetadata(
      { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
      { title: 'New title', description: 'New description' },
      credential,
    );
    expect(fake.calls[0]?.json).toEqual({ title: 'New title', description: 'New description' });
  });
});

describe('FacebookAdapter comments', () => {
  it('polls comments chronologically, advances the cursor and de-duplicates', async () => {
    let releaseAfterTwoPolls: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      releaseAfterTwoPolls = resolve;
    });
    let polls = 0;
    const { adapter, fake } = adapterWith(
      [
        {
          match: '/comments',
          body: {
            data: [
              {
                id: 'c1',
                created_time: '2026-09-11T10:00:00+0000',
                message: 'great stream',
                from: { id: 'u1', name: 'Bo' },
              },
              { id: 'c1', message: 'duplicate that must be ignored', from: { id: 'u1', name: 'Bo' } },
            ],
            paging: { cursors: { after: 'cursor-2' } },
          },
          times: 1,
        },
        { match: '/comments', body: { data: [] } },
      ],
      async () => {
        polls++;
        if (polls >= 2) releaseAfterTwoPolls();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );

    const received: ChatMessage[] = [];
    const sub = await adapter.subscribeChat(
      { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
      (m) => received.push(m),
      credential,
    );
    await done;
    sub.stop();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'c1',
      platform: 'facebook',
      destinationId: '90210',
      text: 'great stream',
      platformMessageId: 'c1',
      author: { id: 'u1', displayName: 'Bo' },
    });
    expect(fake.calls[0]?.url).toContain('order=chronological');
    expect(fake.calls[1]?.url).toContain('after=cursor-2');
  });

  it('survives a comment poll failure without throwing', async () => {
    let release: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { adapter } = adapterWith(
      [{ match: '/comments', status: 500, body: { error: { message: 'boom' } } }],
      async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );
    const sub = await adapter.subscribeChat(
      { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
      () => undefined,
      credential,
    );
    await done;
    sub.stop();
  });

  it('reads reactions for analytics', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/90210', body: { live_views: 12, reactions: { summary: { total_count: 34 } } } },
    ]);
    const analytics = await adapter.getAnalytics(
      { broadcastId: '90210', ingest: { protocol: 'rtmps', url: 'x' } },
      credential,
    );
    expect(analytics).toMatchObject({ viewers: 12, likes: 34 });
    expect(fake.calls[0]?.url).toContain('reactions.summary%28total_count%29');
  });
});

describe('FacebookAdapter error mapping', () => {
  it('maps 401 to AUTH_EXPIRED', async () => {
    const { adapter } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        status: 401,
        body: { error: { message: 'Error validating access token: Session has expired' } },
      },
    ]);
    await expect(adapter.createBroadcast(config(), credential)).rejects.toSatisfy((err: unknown) => {
      const e = err as HttpError;
      expect(e).toBeInstanceOf(HttpError);
      expect(e.status).toBe(401);
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_EXPIRED');
      return true;
    });
  });

  it('maps an unapproved-permission 403 to AUTH_MISSING_SCOPE', async () => {
    const { adapter } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        status: 403,
        body: { error: { message: 'Insufficient permission: publish_video not granted' } },
      },
    ]);
    await adapter.createBroadcast(config(), credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_MISSING_SCOPE');
    });
  });

  it('maps a 5xx to PLATFORM_ERROR and keeps Graph error reasons in the message', async () => {
    const { adapter } = adapterWith([
      { match: '/live_videos', method: 'POST', status: 500, body: { error: { message: 'Unknown error' } } },
    ]);
    await adapter.createBroadcast(config(), credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(e.message).toContain('Unknown error');
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('PLATFORM_ERROR');
    });
  });

  it('redacts a stream key that leaks into an error body', async () => {
    const { adapter } = adapterWith([
      {
        match: '/live_videos',
        method: 'POST',
        status: 400,
        text: 'bad url rtmps://rtmp-api.facebook.test/rtmp/FB-secret-key',
      },
    ]);
    await expect(adapter.createBroadcast(config(), credential)).rejects.toSatisfy((err: unknown) => {
      expect((err as Error).message).not.toContain('FB-secret-key');
      expect((err as Error).message).toContain('••••');
      return true;
    });
  });
});
