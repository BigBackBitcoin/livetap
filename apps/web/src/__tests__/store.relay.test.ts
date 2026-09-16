import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEngine } from '@livetap/media';
import { createMockAdapters } from '@livetap/adapters';
import { createAppStore } from '../state/store.js';

/**
 * GO LIVE ON THE WEB ACTUALLY REACHES THE RELAY.
 *
 * Everything either side of this join was already built and tested: the relay's session API
 * (`infra/relay/session-api`), its WHIP receiver, and the engine's WHIP client. Nothing called
 * `POST /sessions`, so the engine fell back to a static `VITE_LIVETAP_RELAY_WHIP_URL` read out of
 * the build environment — a URL that can only exist if somebody created a relay session by hand
 * and baked it into the bundle. The destination list never reached the relay at runtime, which
 * means a correctly configured, running relay received nothing. The relay was not unwritten; it
 * was unconnected.
 *
 * These tests drive the real store and assert on the WIRE: what was POSTed, what the engine was
 * pointed at, and what was deleted afterwards. Asserting that `armRelay` ran would pass even if
 * every value in the request were wrong, which is the failure worth catching.
 */

interface Recorded {
  url: string;
  method: string;
  body: unknown;
  auth?: string;
}

function relayFetch(
  answer: { status: number; body: unknown } = {
    status: 201,
    body: {
      sessionId: 'sess-1',
      whipUrl: 'https://relay.test/live/sess-1/whip',
      whipAuthorization: 'pub:secretpass',
      // The same session through the door a phone can use: its encoder speaks RTMP, not WHIP.
      rtmpUrl: 'rtmp://relay.test:19350/live/sess-1',
      rtmpAuthorization: 'livetap:pub-secret',
    },
  },
): { calls: Recorded[]; impl: typeof fetch } {
  const calls: Recorded[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      ...(headers.authorization ? { auth: headers.authorization } : {}),
    });
    const isDelete = (init?.method ?? 'GET') === 'DELETE';
    const status = isDelete ? 204 : answer.status;
    return { ok: status < 400, status, json: async () => (isDelete ? {} : answer.body) };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function build(
  mockMode: boolean,
  relay: { baseUrl: string; token?: string } | null = { baseUrl: 'https://relay.test' },
  kind?: 'native',
): {
  store: ReturnType<typeof createAppStore>;
  endpoints: Array<Record<string, unknown> | null>;
} {
  const engine = new MockEngine({ connectDelayMs: 1, metricsIntervalMs: 1000 });
  // A phone reports kind 'native'; the store hands it an RTMP session rather than a WHIP one.
  if (kind) Object.defineProperty(engine, 'kind', { value: kind, configurable: true });
  const endpoints: Array<Record<string, unknown> | null> = [];
  // The real BrowserEngine gained `useRelaySession`; MockEngine stands in for it here so these
  // tests stay about the STORE's decisions rather than about WebRTC.
  (engine as unknown as { useRelaySession: unknown }).useRelaySession = (
    s: Record<string, unknown> | null,
  ) => {
    endpoints.push(s);
  };
  return {
    store: createAppStore({ engine, registry: createMockAdapters({ latencyMs: 1 }), mockMode, relay }),
    endpoints,
  };
}

/** Two destinations on the same platform, each with its own key — the multi-account case. */
async function twoYouTubeChannels(store: ReturnType<typeof createAppStore>): Promise<void> {
  await store.getState().addCustomDestination({
    label: 'Carter Gaming',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'key-for-gaming',
    aspect: '16:9',
    platform: 'youtube',
  });
  await store.getState().addCustomDestination({
    label: 'Carter Live',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'key-for-live',
    aspect: '16:9',
    platform: 'youtube',
  });
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('going live through the relay', () => {
  it('creates a relay session for THIS broadcast and points the engine at it', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(false, { baseUrl: 'https://relay.test', token: 'relay-shared-token' });
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();

    const post = calls.find((c) => c.method === 'POST');
    expect(post, 'GO LIVE never called the relay session API').toBeDefined();
    expect(post!.url).toBe('https://relay.test/sessions');
    expect(post!.auth).toBe('Bearer relay-shared-token');

    // The engine is pointed at the session's WHIP URL, carrying the relay's own publish
    // credential. Before this existed the engine only ever saw a build-time constant.
    expect(endpoints).toEqual([{ whipUrl: 'https://relay.test/live/sess-1/whip', token: 'pub:secretpass' }]);
  });

  /**
   * ONE ENTRY PER ACCOUNT, NOT PER PLATFORM.
   *
   * Two YouTube channels are two rows in the relay's forward list with two different keys.
   * Collapsing them by platform is the failure that looks completely correct in the UI — two rows,
   * two labels, both green — while only one channel ever receives video.
   */
  it('sends one destination per account, each with its own stream key', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();

    const sent = (calls.find((c) => c.method === 'POST')!.body as { destinations: Array<{ streamKey?: string }> })
      .destinations;
    expect(sent).toHaveLength(2);
    expect(sent.map((d) => d.streamKey).sort()).toEqual(['key-for-gaming', 'key-for-live']);
  });

  /**
   * §30: never confuse mock with real. A demo broadcast must not create a forwarding path on a
   * real relay, and must not send a demo key anywhere.
   */
  it('never contacts the relay in demo mode', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(true);
    await store.getState().init();
    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().commitGoLive();

    expect(calls).toHaveLength(0);
    expect(endpoints).toHaveLength(0);
  });

  it('deletes the session at END, and forgets the endpoint', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();
    await store.getState().confirmEnd();

    const del = calls.find((c) => c.method === 'DELETE');
    expect(del, 'END left a forwarding path alive on the relay holding this person stream keys').toBeDefined();
    expect(del!.url).toBe('https://relay.test/sessions/sess-1');
    // Null, so a stale session URL cannot be reused by the next broadcast.
    expect(endpoints[endpoints.length - 1]).toBeNull();
  });

  it('deletes the session when a start is cancelled, not only when a broadcast ends', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();
    await store.getState().cancelStart();

    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  /**
   * A cancel that arrives DURING the relay round-trip still cancels.
   *
   * Opening a relay session is a network call, so GO LIVE now has a window between the button
   * saying 'starting' and the orchestrator being told anything at all — and a start is cancellable
   * from the instant it begins. Awaiting the relay before recording the in-flight start left
   * `cancelStart` with nothing to cancel: it stopped an orchestrator that had not been asked to
   * start yet, and the broadcast then went live behind the cancel. This is that window, held open
   * deliberately.
   */
  it('cancels a start that is still waiting on the relay', async () => {
    let releaseRelay = (): void => {};
    const held = new Promise<void>((resolve) => {
      releaseRelay = resolve;
    });
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', (async (url: unknown, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') await held;
      return (impl as unknown as (u: unknown, i?: RequestInit) => unknown)(url, init);
    }) as unknown as typeof fetch);

    const { store } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);

    const starting = store.getState().commitGoLive();
    const cancelled = store.getState().cancelStart();
    releaseRelay();
    await Promise.all([starting, cancelled]);

    expect(store.getState().production.state, 'the broadcast went live behind the cancel').not.toBe('LIVE');
    expect(store.getState().goLive).toBe('idle');
    // And the session the abandoned start created was not left alive on the relay.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  /**
   * A relay that refuses must not be able to stop the broadcast, and its own sentence is the
   * actionable part. The relay answers 400 as `{ error, details: [...] }` — reading only `error`
   * would show a creator "Invalid destinations." and throw away the half that says which one.
   */
  it('surfaces the relay refusal without blocking GO LIVE', async () => {
    const { impl } = relayFetch({
      status: 400,
      body: { error: 'Invalid destinations.', details: ['destinations[1]: Stream key is required.'] },
    });
    vi.stubGlobal('fetch', impl);

    const { store } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await expect(store.getState().commitGoLive()).resolves.toBeUndefined();

    const said = store.getState().notices.map((n) => n.message).join('\n');
    expect(said).toMatch(/destinations\[1\]: Stream key is required\./);
  });

  it('says so plainly when no relay is configured, instead of failing silently', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    // `null`, not absent: a web build with no relay behind it.
    const { store } = build(false, null);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();

    expect(calls).toHaveLength(0);
    expect(store.getState().notices.map((n) => n.message).join('\n')).toMatch(/relay/i);
  });
});

/**
 * §28: THE SYSTEM MUST NEVER LOG A STREAM KEY.
 *
 * This path is the one place in the browser a stream key is deliberately read out of storage to
 * be sent somewhere, so it is the one place worth proving. The keys go into the request body and
 * must appear NOWHERE else: not in a notice, not in the activity log, not in the persisted
 * destination list, and not through console.
 */
describe('stream keys on the relay path', () => {
  it('puts the key on the wire and nowhere else', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const spoken: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        spoken.push(args.map((a) => String(a)).join(' '));
      });
    }

    const { store } = build(false);
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();
    await store.getState().confirmEnd();

    const SECRETS = ['key-for-gaming', 'key-for-live', 'pub:secretpass', 'livetap:pub-secret'];

    // It DID reach the relay — otherwise this test would pass on a broadcast that never happened.
    const body = JSON.stringify(calls.find((c) => c.method === 'POST')!.body);
    expect(SECRETS.filter((k) => body.includes(k))).toEqual(['key-for-gaming', 'key-for-live']);

    const state = store.getState();
    const surfaces: Array<[string, string]> = [
      ['notices', JSON.stringify(state.notices)],
      ['activity log', JSON.stringify(state.log)],
      ['destinations in state', JSON.stringify(state.destinations)],
      ['browser storage', JSON.stringify({ ...localStorage })],
      ['console', spoken.join('\n')],
    ];
    for (const [where, text] of surfaces) {
      for (const secret of SECRETS) {
        expect(text.includes(secret), `a secret reached ${where}`).toBe(false);
      }
    }
  });
});

/**
 * A PHONE REACHING MORE THAN ONE DESTINATION.
 *
 * Android has one encoder and one RTMP socket, so the second push was refused with a
 * CONFIG_INVALID whose own message read "use a relay for more (ADR-009)" -- pointing at a relay
 * nothing connected. The device now publishes ONCE to the relay and the relay fans out, which is
 * the same session the browser uses through a different door.
 */
describe('a phone going live through the relay', () => {
  it('hands a native engine the RTMP ingest, not the WHIP one', async () => {
    const { impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(false, { baseUrl: 'https://relay.test' }, 'native');
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();

    expect(endpoints).toEqual([
      { rtmpUrl: 'rtmp://relay.test:19350/live/sess-1', authorization: 'livetap:pub-secret' },
    ]);
  });

  /*
   * A browser always needs the relay: it has no RTMP socket, so even one destination is
   * unreachable without it. A handset can push one destination itself -- fewer hops, less latency,
   * no dependency on a relay being up. The relay is what makes the SECOND one possible, so that is
   * where it starts.
   */
  it('does not open a relay session for a single destination on a phone', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(false, { baseUrl: 'https://relay.test' }, 'native');
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'Carter Gaming',
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-for-gaming',
      aspect: '16:9',
      platform: 'youtube',
    });
    await store.getState().commitGoLive();

    expect(calls).toHaveLength(0);
    expect(endpoints).toHaveLength(0);
  });

  /* A browser still relays a single destination, because it has no other way to reach it. */
  it('still opens a relay session for a single destination in a browser', async () => {
    const { calls, impl } = relayFetch();
    vi.stubGlobal('fetch', impl);

    const { store } = build(false);
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'Carter Gaming',
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'key-for-gaming',
      aspect: '16:9',
      platform: 'youtube',
    });
    await store.getState().commitGoLive();

    expect(calls.some((c) => c.method === 'POST')).toBe(true);
  });

  it('says so plainly when the relay is too old to offer an RTMP ingest', async () => {
    // No rtmpUrl in the answer -- a relay predating the native publish path.
    const { calls, impl } = relayFetch({
      status: 201,
      body: { sessionId: 'sess-1', whipUrl: 'https://relay.test/live/sess-1/whip' },
    });
    vi.stubGlobal('fetch', impl);

    const { store, endpoints } = build(false, { baseUrl: 'https://relay.test' }, 'native');
    await store.getState().init();
    await twoYouTubeChannels(store);
    await store.getState().commitGoLive();

    // Not pointed at `undefined`, told the truth, and the useless session cleaned up rather than
    // left alive on the relay holding this person's stream keys.
    expect(endpoints).toHaveLength(0);
    expect(store.getState().notices.map((n) => n.message).join(' ')).toMatch(/only reach one destination/i);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
