import { describe, expect, it } from 'vitest';
import { classifyFailure, type ChatMessage, type DestinationConfig } from '@livetap/core';
import { TwitchAdapter } from './TwitchAdapter.js';
import type { HttpError } from './http.js';
import { createFakeFetch, type FakeRoute } from '../testing/fakeFetch.js';
import type { MinimalWebSocket, Timers, WebSocketCtor } from './websocket.js';

const API = 'https://api.test/helix';
const credential = {
  id: 'cred-tw',
  platform: 'twitch',
  accountId: '1234567',
  accountLabel: 'adalovelace',
};

function config(overrides: Partial<DestinationConfig> = {}): DestinationConfig {
  return {
    id: 'dest-tw',
    platform: 'twitch',
    label: 'adalovelace',
    aspectRatio: '16:9',
    enabled: true,
    mock: false,
    metadata: { title: 'Rust and coffee', category: '509658' },
    ...overrides,
  };
}

/** A fake WebSocket that records what was sent and lets the test push frames in. */
class FakeSocket implements MinimalWebSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | undefined;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function manualTimers(): Timers & { run(): void; pending(): number } {
  let nextId = 1;
  const queue = new Map<number, () => void>();
  return {
    setTimeout(fn) {
      const id = nextId++;
      queue.set(id, fn);
      return id;
    },
    clearTimeout(handle) {
      queue.delete(handle as number);
    },
    run() {
      const entries = [...queue.entries()];
      queue.clear();
      for (const [, fn] of entries) fn();
    },
    pending: () => queue.size,
  };
}

function adapterWith(routes: FakeRoute[], extra: Partial<{ webSocketCtor: WebSocketCtor; timers: Timers }> = {}) {
  const fake = createFakeFetch(routes);
  const adapter = new TwitchAdapter({
    fetch: fake.fetch,
    tokenProvider: async () => 'tw-access-token',
    apiBase: API,
    clientId: 'livetap-client-id',
    ingestUrl: 'rtmp://ingest.test/app',
    eventSubUrl: 'wss://eventsub.test/ws',
    ...extra,
  });
  return { adapter, fake };
}

describe('TwitchAdapter capabilities', () => {
  it('reflects Twitch having no broadcast lifecycle and no PKCE', () => {
    const { adapter } = adapterWith([]);
    expect(adapter.profile.autoStartsOnIngest).toBe(true);
    expect(adapter.supports('streamKey')).toBe(true);
    expect(adapter.supports('metadata')).toBe(true);
    expect(adapter.supports('chatRead')).toBe(true);
    expect(adapter.supports('pkce')).toBe(false);
    expect(adapter.supports('thumbnail')).toBe(false);
    expect(adapter.supports('scheduling')).toBe(false);
  });
});

describe('TwitchAdapter go-live sequence', () => {
  it('PATCHes the channel then fetches the stream key, with Client-Id on every call', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/channels', method: 'PATCH', text: '' },
      { match: '/streams/key', body: { data: [{ stream_key: 'live_1234567_secret' }] } },
    ]);
    const handle = await adapter.createBroadcast(config(), credential);

    expect(fake.sequence()).toEqual([
      `PATCH ${API}/channels?broadcaster_id=1234567`,
      `GET ${API}/streams/key?broadcaster_id=1234567`,
    ]);
    expect(fake.calls[0]?.json).toEqual({ title: 'Rust and coffee', game_id: '509658' });
    for (const call of fake.calls) {
      expect(call.headers['Authorization']).toBe('Bearer tw-access-token');
      expect(call.headers['Client-Id']).toBe('livetap-client-id');
    }
    expect(handle).toEqual({
      streamId: '1234567',
      ingest: { protocol: 'rtmp', url: 'rtmp://ingest.test/app', streamKey: 'live_1234567_secret' },
      watchUrl: 'https://www.twitch.tv/adalovelace',
    });
  });

  it('skips the metadata PATCH when there is nothing to set', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/streams/key', body: { data: [{ stream_key: 'k' }] } },
    ]);
    await adapter.createBroadcast(config({ metadata: undefined }), credential);
    expect(fake.sequence()).toEqual([`GET ${API}/streams/key?broadcaster_id=1234567`]);
  });

  it('stopBroadcast makes no request at all — Twitch has no stop endpoint', async () => {
    const { adapter, fake } = adapterWith([]);
    await adapter.stopBroadcast(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      credential,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it('validates by reading the channel and the key', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/channels', body: { data: [{ broadcaster_id: '1234567', broadcaster_login: 'adalovelace' }] } },
      { match: '/streams/key', body: { data: [{ stream_key: 'k' }] } },
    ]);
    const result = await adapter.validate(config(), credential);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.watchUrl).toBe('https://www.twitch.tv/adalovelace');
      expect(result.ingest?.streamKey).toBe('k');
    }
    expect(fake.calls[0]?.url).toBe(`${API}/channels?broadcaster_id=1234567`);
  });

  it('fails validate cleanly when the credential has no broadcaster id', async () => {
    const { adapter } = adapterWith([]);
    const result = await adapter.validate(config({ accountId: undefined }), {
      id: 'c',
      platform: 'twitch',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUTH_FAILED');
  });

  it('reads live status and viewer count', async () => {
    const { adapter } = adapterWith([
      { match: '/streams?', body: { data: [{ type: 'live', viewer_count: 512 }] } },
    ]);
    const status = await adapter.getStatus(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      credential,
    );
    expect(status).toEqual({ live: true, ingestHealth: 'good', viewers: 512 });
  });

  it('reports offline when Twitch returns no stream', async () => {
    const { adapter } = adapterWith([{ match: '/streams?', body: { data: [] } }]);
    const status = await adapter.getStatus({ streamId: '1', ingest: { protocol: 'rtmp', url: 'x' } }, credential);
    expect(status).toEqual({ live: false, ingestHealth: 'noData' });
  });
});

describe('TwitchAdapter chat via EventSub WebSocket', () => {
  it('welcomes, subscribes to channel.chat.message v1, and maps notifications', async () => {
    FakeSocket.instances = [];
    const timers = manualTimers();
    const { adapter, fake } = adapterWith(
      [{ match: '/eventsub/subscriptions', method: 'POST', body: { data: [{ id: 'sub-1' }] } }],
      { webSocketCtor: FakeSocket as unknown as WebSocketCtor, timers },
    );
    const received: ChatMessage[] = [];
    const sub = await adapter.subscribeChat(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      (m) => received.push(m),
      credential,
    );

    const socket = FakeSocket.instances[0];
    expect(socket?.url).toBe('wss://eventsub.test/ws?keepalive_timeout_seconds=30');

    socket?.receive({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-abc', keepalive_timeout_seconds: 30 } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const post = fake.calls[0];
    expect(post?.method).toBe('POST');
    expect(post?.url).toBe(`${API}/eventsub/subscriptions`);
    expect(post?.headers['Client-Id']).toBe('livetap-client-id');
    expect(post?.headers['Authorization']).toBe('Bearer tw-access-token');
    expect(post?.json).toEqual({
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: '1234567', user_id: '1234567' },
      transport: { method: 'websocket', session_id: 'session-abc' },
    });

    socket?.receive({
      metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' },
      payload: {
        event: {
          chatter_user_id: '99',
          chatter_user_name: 'Kai',
          message_id: 'msg-99',
          message: { text: 'nice setup' },
          badges: [{ set_id: 'moderator' }, { set_id: 'subscriber' }],
        },
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      id: 'msg-99',
      platform: 'twitch',
      destinationId: '1234567',
      text: 'nice setup',
      platformMessageId: 'msg-99',
      author: { id: '99', displayName: 'Kai', badges: ['moderator', 'subscriber'] },
    });

    // Keepalive frames are accepted and simply re-arm the watchdog.
    socket?.receive({ metadata: { message_type: 'session_keepalive' } });
    expect(timers.pending()).toBe(1);

    sub.stop();
    expect(socket?.closed?.code).toBe(1000);
  });

  it('ignores notifications for other subscription types and malformed frames', async () => {
    FakeSocket.instances = [];
    const { adapter } = adapterWith(
      [{ match: '/eventsub/subscriptions', method: 'POST', body: {} }],
      { webSocketCtor: FakeSocket as unknown as WebSocketCtor, timers: manualTimers() },
    );
    const received: ChatMessage[] = [];
    await adapter.subscribeChat(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      (m) => received.push(m),
      credential,
    );
    const socket = FakeSocket.instances[0];
    socket?.onmessage?.({ data: 'not json' });
    socket?.receive({
      metadata: { message_type: 'notification', subscription_type: 'stream.online' },
      payload: { event: { id: 'x' } },
    });
    socket?.receive({
      metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' },
      payload: { event: { message: { text: 'no user id' } } },
    });
    expect(received).toHaveLength(0);
  });

  it('follows session_reconnect and only closes the old socket after the new one welcomes', async () => {
    FakeSocket.instances = [];
    const { adapter } = adapterWith(
      [{ match: '/eventsub/subscriptions', method: 'POST', body: {} }],
      { webSocketCtor: FakeSocket as unknown as WebSocketCtor, timers: manualTimers() },
    );
    await adapter.subscribeChat(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      () => undefined,
      credential,
    );
    const first = FakeSocket.instances[0];
    first?.receive({
      metadata: { message_type: 'session_reconnect' },
      payload: { session: { reconnect_url: 'wss://eventsub.test/ws?reconnect=1' } },
    });
    const second = FakeSocket.instances[1];
    expect(second?.url).toBe('wss://eventsub.test/ws?reconnect=1');
    // Closing early would earn close code 4004, so the old socket must still be open.
    expect(first?.closed).toBeUndefined();

    second?.receive({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-2' } },
    });
    expect(first?.closed?.code).toBe(1000);
  });

  it('reconnects and resubscribes when the keepalive watchdog fires', async () => {
    FakeSocket.instances = [];
    const timers = manualTimers();
    const { adapter, fake } = adapterWith(
      [{ match: '/eventsub/subscriptions', method: 'POST', body: {} }],
      { webSocketCtor: FakeSocket as unknown as WebSocketCtor, timers },
    );
    await adapter.subscribeChat(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      () => undefined,
      credential,
    );
    const first = FakeSocket.instances[0];
    first?.receive({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-1' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls).toHaveLength(1);

    timers.run(); // watchdog expires
    expect(first?.closed?.code).toBe(4000);
    const second = FakeSocket.instances[1];
    expect(second).toBeDefined();

    // A new session means new subscriptions: they are bound to the socket, not the app.
    second?.receive({
      metadata: { message_type: 'session_welcome' },
      payload: { session: { id: 'session-2' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls).toHaveLength(2);
    expect((fake.calls[1]?.json as { transport: { session_id: string } }).transport.session_id).toBe(
      'session-2',
    );
  });

  it('refuses to pretend chat works without a WebSocket implementation', async () => {
    const { adapter } = adapterWith([]);
    await expect(
      adapter.subscribeChat(
        { streamId: '1', ingest: { protocol: 'rtmp', url: 'x' } },
        () => undefined,
        credential,
      ),
    ).rejects.toThrow(/WebSocket/);
  });
});

describe('TwitchAdapter chat write and moderation', () => {
  it('sends chat through Helix', async () => {
    const { adapter, fake } = adapterWith([
      { match: '/chat/messages', method: 'POST', body: { data: [{ is_sent: true }] } },
    ]);
    await adapter.sendChat(
      { streamId: '1234567', ingest: { protocol: 'rtmp', url: 'x' } },
      'hi all',
      credential,
    );
    expect(fake.calls[0]?.url).toBe(`${API}/chat/messages`);
    expect(fake.calls[0]?.json).toEqual({
      broadcaster_id: '1234567',
      sender_id: '1234567',
      message: 'hi all',
    });
  });

  it('uses SECONDS for a timeout duration and omits duration for a ban', async () => {
    const message: ChatMessage = {
      id: 'm',
      platform: 'twitch',
      destinationId: 'd',
      author: { id: '4242', displayName: 'Troll' },
      text: 'bad',
      receivedAt: 0,
      platformMessageId: 'pm',
    };
    const { adapter, fake } = adapterWith([
      { match: '/moderation/bans', method: 'POST', body: {} },
      { match: '/moderation/bans', method: 'POST', body: {} },
      { match: '/chat/messages', method: 'DELETE', text: '' },
    ]);
    const handle = { streamId: '1234567', ingest: { protocol: 'rtmp' as const, url: 'x' } };
    await adapter.moderate(handle, { action: 'timeout', message, durationSeconds: 600 }, credential);
    expect(fake.calls[0]?.json).toEqual({ data: { user_id: '4242', duration: 600 } });
    await adapter.moderate(handle, { action: 'ban', message }, credential);
    expect(fake.calls[1]?.json).toEqual({ data: { user_id: '4242' } });
    await adapter.moderate(handle, { action: 'delete', message }, credential);
    expect(fake.calls[2]?.url).toBe(
      `${API}/chat/messages?broadcaster_id=1234567&moderator_id=1234567&message_id=pm`,
    );
  });
});

describe('TwitchAdapter error mapping', () => {
  it('maps 401 to AUTH_EXPIRED via HttpError', async () => {
    const { adapter } = adapterWith([
      { match: '/streams/key', status: 401, body: { message: 'Invalid OAuth token' } },
    ]);
    await expect(adapter.createBroadcast(config({ metadata: undefined }), credential)).rejects.toSatisfy(
      (err: unknown) => {
        const e = err as HttpError;
        expect(e.status).toBe(401);
        expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_EXPIRED');
        return true;
      },
    );
  });

  it('maps a missing-scope 403 to AUTH_MISSING_SCOPE', async () => {
    const { adapter } = adapterWith([
      { match: '/streams/key', status: 403, body: { message: 'Missing scope: channel:read:stream_key' } },
    ]);
    await adapter.createBroadcast(config({ metadata: undefined }), credential).catch((err: unknown) => {
      const e = err as HttpError;
      expect(classifyFailure({ status: e.status, message: e.message })).toBe('AUTH_MISSING_SCOPE');
    });
  });

  it('throws when Twitch returns no stream key rather than going live keyless', async () => {
    const { adapter } = adapterWith([{ match: '/streams/key', body: { data: [] } }]);
    await expect(
      adapter.createBroadcast(config({ metadata: undefined }), credential),
    ).rejects.toThrow(/did not return a stream key/);
  });
});
