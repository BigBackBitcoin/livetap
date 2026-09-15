import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEngine } from '@livetap/media';
import { createMockAdapters } from '@livetap/adapters';
import { createAppStore, reconcileGoLive } from '../state/store.js';
import { KEYS } from '../state/persist.js';
import { broadcastReality } from '../components/preflight.js';

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

/**
 * The END grace is deliberately not injectable.
 *
 * Every other timing in this store is passed in so tests need not wait, and this one is not,
 * because a five-second grace that a caller can shorten is a five-second grace a build can
 * shorten. The two tests below wait it out for real, which is the only way to prove that the
 * timer survives without a screen to hold it.
 */
const GRACE_WAIT_MS = 15_000;

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

  it('a key pasted after tapping a platform makes a destination of THAT platform', async () => {
    const { store } = build();
    await store.getState().init();
    const snap = await store.getState().addCustomDestination({
      label: 'YouTube',
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'pasted-key-0001',
      aspect: '16:9',
      platform: 'youtube',
    });

    /*
     * Pasting a key is HOW a destination was configured, not WHAT it is. Landing as `custom` cost
     * the creator the one sentence that matters on YouTube - that YouTube does not publish when
     * video arrives and they still have to press Go live in Studio - and replaced it with a
     * generic line about the far end.
     */
    expect(snap?.config.platform).toBe('youtube');
    expect(snap?.config.label).toBe('YouTube');
  });

  it('is still a generic RTMP destination when no platform was tapped', async () => {
    const { store } = build();
    await store.getState().init();
    const snap = await store.getState().addCustomDestination({
      label: 'My server',
      url: 'rtmp://live.example.com/app',
      streamKey: 'pasted-key-0002',
      aspect: '16:9',
    });

    expect(snap?.config.platform).toBe('custom');
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

  /**
   * P0-1, the worst defect this app had.
   *
   * The END grace used to be a `setTimeout` inside a Studio effect, so unmounting Studio ran the
   * effect's cleanup and cancelled the stop while `goLive` stayed `'live'`. Measured in the real
   * app: press END, tap Destinations, wait twelve seconds, both destinations still read Live.
   * There is no React in this test at all — which is the point. The stop belongs to the store.
   */
  it(
    'a scheduled END stops the broadcast with no screen mounted to run the timer',
    async () => {
      const { store } = build();
      await store.getState().init();
      await store.getState().connectPlatform('youtube');
      await store.getState().commitGoLive();
      await vi.waitFor(() => expect(store.getState().production.state).toBe('LIVE'));

      store.getState().requestEnd();
      expect(store.getState().endingAt).not.toBeNull();

      await vi.waitFor(() => expect(store.getState().goLive).toBe('idle'), { timeout: 10_000 });
      expect(store.getState().production.state).not.toBe('LIVE');
      expect(store.getState().endingAt).toBeNull();
    },
    GRACE_WAIT_MS,
  );

  it(
    'UNDO cancels the scheduled stop, and the broadcast is still live afterwards',
    async () => {
      const { store } = build();
      await store.getState().init();
      await store.getState().connectPlatform('youtube');
      await store.getState().commitGoLive();
      await vi.waitFor(() => expect(store.getState().production.state).toBe('LIVE'));

      store.getState().requestEnd();
      store.getState().undoEnd();
      await new Promise((resolve) => setTimeout(resolve, 7000));

      expect(store.getState().endingAt).toBeNull();
      expect(store.getState().production.state).toBe('LIVE');
      expect(store.getState().goLive).toBe('live');
    },
    GRACE_WAIT_MS,
  );

  /**
   * P0-2. STARTING is the window in which broadcast objects are being created on the platforms,
   * and it was the one state with no way out: the button reported itself busy and swallowed the
   * click. `BroadcastOrchestrator.stop()` has always accepted STARTING; nothing called it.
   */
  it('a start can be cancelled while it is still starting', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');

    const started = store.getState().commitGoLive();
    await store.getState().cancelStart();
    await started;

    expect(store.getState().production.state).not.toBe('LIVE');
    expect(store.getState().goLive).toBe('idle');
  });

  /**
   * The button describes the machine, not the last action the UI took. Without this, any
   * transition the orchestrator made on its own left the control describing a stream that had
   * already ended.
   */
  it('reconciles the button from the production state, and leaves the two pre-machine states alone', () => {
    expect(reconcileGoLive('LIVE', 'idle')).toBe('live');
    expect(reconcileGoLive('STARTING', 'idle')).toBe('starting');
    expect(reconcileGoLive('STOPPING', 'live')).toBe('stopping');
    expect(reconcileGoLive('IDLE', 'live')).toBe('idle');
    expect(reconcileGoLive('PREVIEW', 'countdown')).toBe('countdown');
    expect(reconcileGoLive('PREVIEW', 'starting')).toBe('starting');
  });

  /** The shape cannot change once a start has been committed, not merely once it has succeeded. */
  it('locks the stream shape from STARTING, not from LIVE', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');
    store.getState().setAspect('9:16');
    expect(store.getState().aspect).toBe('9:16');

    const started = store.getState().commitGoLive();
    await vi.waitFor(() => expect(store.getState().production.state).not.toBe('PREVIEW'));
    store.getState().setAspect('1:1');
    expect(store.getState().aspect).toBe('9:16');
    await started;
  });

  /**
   * The honesty rule, measured.
   *
   * A pasted-key destination is recorded as not simulated whatever the build is, so reading the
   * config alone made a demo build claim a real broadcast: the banner hid, the badges went, the
   * button said GO LIVE and then "Live on 1", and nothing left the machine. The adapters and the
   * engine that were actually constructed outrank anything a destination says about itself.
   */
  it('calls a broadcast simulated when the adapters or the engine are, whatever the config says', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'My server',
      url: 'rtmp://live.example.com/app',
      streamKey: 'a-key-for-this-test',
      aspect: '16:9',
    });
    const destinations = store.getState().destinations;
    expect(destinations[0]?.config.mock).toBe(false);

    expect(broadcastReality(destinations, 'mock', 'browser').allSimulated).toBe(true);
    expect(broadcastReality(destinations, 'mock', 'browser').reason).toBe('adapters');
    expect(broadcastReality(destinations, 'real', 'mock').allSimulated).toBe(true);
    expect(broadcastReality(destinations, 'real', 'mock').reason).toBe('engine');
    expect(broadcastReality(destinations, 'real', 'desktop').real).toHaveLength(1);
    expect(broadcastReality(destinations, 'real', 'desktop').reason).toBeNull();
  });

  /**
   * §37: the first broadcast that can reach a creator's own accounts says so, and waits.
   *
   * Every broadcast after it is confirmed by the countdown alone, which is cancellable, in the
   * control the creator is already looking at, and costs nothing to ignore. Asking every time is
   * how a confirmation becomes a reflex that confirms nothing.
   */
  it('asks once before the first broadcast that can reach real accounts, then never again', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().addCustomDestination({
      label: 'My server',
      url: 'rtmp://live.example.com/app',
      streamKey: 'a-key-for-the-confirmation-test',
      aspect: '16:9',
    });

    store.getState().startCountdown();
    expect(store.getState().pendingConfirm).toBe(true);
    expect(store.getState().goLive, 'nothing counts down until it is answered').toBe('idle');

    // "Not yet" leaves everything exactly as it was.
    store.getState().cancelCountdown();
    expect(store.getState().pendingConfirm).toBe(false);
    expect(store.getState().goLive).toBe('idle');
    expect(store.getState().realBroadcastAck).toBe(false);
    expect(store.getState().production.state).not.toBe('LIVE');

    store.getState().startCountdown();
    store.getState().confirmRealBroadcast();
    expect(store.getState().goLive).toBe('countdown');
    expect(store.getState().realBroadcastAck).toBe(true);
    expect(localStorage.getItem(KEYS.realBroadcastAck)).toBe('true');

    // Second time: straight to the countdown, no question.
    store.getState().cancelCountdown();
    store.getState().startCountdown();
    expect(store.getState().pendingConfirm).toBe(false);
    expect(store.getState().goLive).toBe('countdown');
  });

  it('never asks when nothing can leave the machine', async () => {
    const { store } = build();
    await store.getState().init();
    await store.getState().connectPlatform('youtube');

    store.getState().startCountdown();
    expect(store.getState().pendingConfirm).toBe(false);
    expect(store.getState().goLive).toBe('countdown');
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
