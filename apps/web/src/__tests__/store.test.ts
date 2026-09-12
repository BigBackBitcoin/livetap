import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEngine } from '@livetap/media';
import { createMockAdapters } from '@livetap/adapters';
import { createAppStore } from '../state/store.js';
import { KEYS } from '../state/persist.js';

/**
 * The store's contract: GO LIVE reaches the orchestrator, and every state the orchestrator
 * reports is mirrored into React — never inferred, never optimistically set.
 */
function build(): { store: ReturnType<typeof createAppStore>; engine: MockEngine } {
  const engine = new MockEngine({ connectDelayMs: 1, metricsIntervalMs: 1000 });
  const store = createAppStore({
    engine,
    registry: createMockAdapters({ latencyMs: 1 }),
    mockMode: true,
  });
  return { store, engine };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('app store', () => {
  it('boots one orchestrator and reports the engine it actually got', async () => {
    const { store } = build();
    await store.getState().init();
    expect(store.getState().ready).toBe(true);
    expect(store.getState().engineKind).toBe('mock');
    expect(store.getState().moments.length).toBeGreaterThan(0);
  });

  it('connects a platform and mirrors the destination snapshot', async () => {
    const { store } = build();
    await store.getState().init();

    const snap = await store.getState().connectPlatform('youtube');
    expect(snap?.state).toBe('READY');

    const mirrored = store.getState().destinations;
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]?.state).toBe('READY');
    expect(mirrored[0]?.config.mock).toBe(true);
  });

  it('gives a paste-key platform a demo ingest in mock mode, so it can actually connect', async () => {
    const { store } = build();
    await store.getState().init();

    const snap = await store.getState().connectPlatform('tiktok');
    // TikTok's stream key is USER_ASSISTED, so the orchestrator validates the ingest first.
    expect(snap?.state).toBe('READY');
    expect(snap?.config.ingest?.url).toContain('demo.livetap.invalid');
  });

  it('refuses a platform whose capability matrix says it is not possible', async () => {
    const { store } = build();
    await store.getState().init();

    const snap = await store.getState().connectPlatform('linkedin');
    expect(snap).toBeUndefined();
    expect(store.getState().destinations).toHaveLength(0);
  });

  it('GO LIVE reaches the orchestrator and every destination becomes LIVE', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');
    await store.getState().connectPlatform('tiktok');

    await store.getState().commitGoLive();
    await vi.waitFor(() => {
      expect(store.getState().production.state).toBe('LIVE');
      expect(store.getState().destinations.every((d) => d.state === 'LIVE')).toBe(true);
    });
    expect(store.getState().goLive).toBe('live');
    expect(store.getState().production.liveCount).toBe(2);
  });

  it('isolates one destination failing: the other stays LIVE and a humane notice appears', async () => {
    const { store, engine } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');
    await store.getState().connectPlatform('tiktok');
    await store.getState().commitGoLive();
    await vi.waitFor(() =>
      expect(store.getState().destinations.every((d) => d.state === 'LIVE')).toBe(true),
    );

    const tiktok = store.getState().destinations.find((d) => d.config.platform === 'tiktok');
    expect(tiktok).toBeDefined();
    engine.emit('output', {
      type: 'outputLost',
      destinationId: tiktok!.config.id,
      code: 'INGEST_DISCONNECTED',
    });

    const after = store.getState().destinations;
    const youtube = after.find((d) => d.config.platform === 'youtube');
    const dropped = after.find((d) => d.config.platform === 'tiktok');
    expect(dropped?.state).toBe('RECONNECTING');
    expect(youtube?.state).toBe('LIVE');
    expect(store.getState().production.state).toBe('LIVE');

    // The reconnect carries a humane error with all four fields, never a protocol string.
    expect(dropped?.error?.what).toBeTruthy();
    expect(dropped?.error?.why).toBeTruthy();
    expect(dropped?.error?.doing).toBeTruthy();
    expect(dropped?.error?.youCan).toBeTruthy();
  });

  it('ends the broadcast and returns the button to idle', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');
    await store.getState().commitGoLive();
    await vi.waitFor(() => expect(store.getState().production.state).toBe('LIVE'));

    await store.getState().confirmEnd();
    expect(store.getState().goLive).toBe('idle');
    expect(store.getState().production.state).not.toBe('LIVE');
  });

  it('persists destinations without their stream key', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'My server',
      url: 'rtmp://live.example.com/app',
      streamKey: 'super-secret-key-1234',
      aspect: '16:9',
    });

    const raw = localStorage.getItem(KEYS.destinations) ?? '[]';
    expect(raw).toContain('live.example.com');
    expect(raw).not.toContain('super-secret-key-1234');
  });

  it('never writes a stream key to any browser storage', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'My server',
      url: 'rtmps://live.example.com/app',
      streamKey: 'another-secret-5678',
      aspect: '16:9',
    });

    const everything = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key) ?? '')
      .join('\n');
    expect(everything).not.toContain('another-secret-5678');
    expect(sessionStorage.getItem('livetap.oauth.pending')).toBeNull();
  });

  it('builds the automatic production from the intent and the chosen destinations', async () => {
    const { store } = build();
    await store.getState().init();
    store.getState().setIntent('talking');
    await store.getState().connectPlatform('youtube');
    await store.getState().connectPlatform('tiktok');

    const plan = store.getState().automaticProduction();
    expect(plan).not.toBeNull();
    expect(plan?.formats).toContain('16:9');
    expect(plan?.formats).toContain('9:16');
    expect(plan?.explanation.join(' ')).toContain('Talking');
  });

  it('the countdown is cancellable and tells no platform anything', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');

    store.getState().startCountdown();
    expect(store.getState().goLive).toBe('countdown');
    store.getState().cancelCountdown();
    expect(store.getState().goLive).toBe('idle');
    expect(store.getState().destinations[0]?.state).toBe('READY');
    expect(store.getState().production.state).not.toBe('LIVE');
  });
});
