import { describe, expect, it, beforeEach } from 'vitest';
import { BroadcastOrchestrator, type Scheduler } from './BroadcastOrchestrator.js';
import { AdapterRegistry, supportsFromProfile, type BroadcastHandle, type DestinationAdapter } from '../destination/adapter.js';
import { TypedEmitter } from '../events.js';
import type { EngineEvents, EngineOutput, EngineStartRequest, MediaEngine, EngineCapabilities } from '../media/engine.js';
import type { CapabilityMatrix, DestinationConfig, PlatformProfile, DestinationSnapshot } from '../types/destination.js';
import { DEFAULT_PRODUCTION_SETTINGS } from '../production/formats.js';

// ---------------------------------------------------------------- test doubles

const ALL_AUTOMATED: CapabilityMatrix = {
  oauth: 'OAUTH_API',
  pkce: 'OAUTH_API',
  broadcastCreation: 'NATIVE_API',
  streamCreation: 'NATIVE_API',
  streamKey: 'NATIVE_API',
  start: 'NATIVE_API',
  stop: 'NATIVE_API',
  metadata: 'NATIVE_API',
  thumbnail: 'UNAVAILABLE',
  chatRead: 'NATIVE_API',
  chatWrite: 'NATIVE_API',
  moderation: 'UNAVAILABLE',
  analytics: 'NATIVE_API',
  liveStatus: 'NATIVE_API',
  scheduling: 'UNAVAILABLE',
  vertical916: 'RTMP_DESTINATION',
  rtmps: 'RTMP_DESTINATION',
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

function profile(id: PlatformProfile['id'], autoStartsOnIngest = true): PlatformProfile {
  return {
    id,
    displayName: id.toUpperCase(),
    connectionSummary: 'test',
    capabilities: ALL_AUTOMATED,
    supportedAspectRatios: ['16:9', '9:16'],
    preferredAspectRatio: '16:9',
    recommended: { maxVideoKbps: 6000, minVideoKbps: 1500, audioKbps: 160, keyframeIntervalSeconds: 2, codecs: ['h264'], maxFps: 60, maxHeight: 1080 },
    autoStartsOnIngest,
    eligibilityNotes: [],
    mock: true,
  };
}

interface FakeAdapterOptions {
  failValidate?: { code: 'AUTH_EXPIRED' | 'NOT_ELIGIBLE' };
  failCreate?: Error;
  autoStartsOnIngest?: boolean;
}

function fakeAdapter(id: PlatformProfile['id'], opts: FakeAdapterOptions = {}) {
  const calls = { create: 0, start: 0, stop: 0, metadata: 0, chatSubs: 0 };
  const prof = profile(id, opts.autoStartsOnIngest ?? true);
  const adapter: DestinationAdapter = {
    profile: prof,
    supports: (c) => supportsFromProfile(prof, c),
    async disconnect() {},
    async validate() {
      if (opts.failValidate) return { ok: false, code: opts.failValidate.code };
      return { ok: true, ingest: { protocol: 'rtmp', url: `rtmp://${id}.test/app`, streamKey: 'secret' } };
    },
    async createBroadcast(config): Promise<BroadcastHandle> {
      calls.create++;
      if (opts.failCreate) throw opts.failCreate;
      return { broadcastId: `${id}-b1`, streamId: `${id}-s1`, ingest: config.ingest!, watchUrl: `https://${id}.test/watch` };
    },
    async startBroadcast() {
      calls.start++;
    },
    async stopBroadcast() {
      calls.stop++;
    },
    async publishMetadata() {
      calls.metadata++;
    },
    async subscribeChat(_h, onMessage) {
      calls.chatSubs++;
      onMessage({ id: 'm1', platform: id, destinationId: 'x', author: { id: 'u', displayName: 'viewer' }, text: 'hi', receivedAt: 1, mock: true });
      return { stop() {} };
    },
  };
  return { adapter, calls };
}

class FakeEngine extends TypedEmitter<EngineEvents> implements MediaEngine {
  readonly kind = 'mock' as const;
  outputs = new Map<string, EngineOutput>();
  started: EngineStartRequest | undefined;
  stopped = 0;
  failStart = false;
  failAddOutputFor = new Set<string>();
  /**
   * `start()` succeeds and no output ever reports up.
   *
   * This is not a contrived state: it is exactly what a desktop broadcast to an ingest server that
   * is switched off looks like. The encoder process spawns and lives, each sender process spawns
   * and then dies on its own socket a moment later, and `start()` has long since resolved.
   */
  silent = false;

  async capabilities(): Promise<EngineCapabilities> {
    return { camera: true, microphone: true, screen: true, window: true, systemAudio: true, rtmp: true, srt: true, whip: false, recording: true, hardwareEncoders: [], maxFormats: 3, verification: 'SIMULATED' };
  }
  async startPreview() {}
  async stopPreview() {}
  async setMoment() {}
  async start(req: EngineStartRequest) {
    if (this.failStart) throw new Error('encoder init failed');
    this.started = req;
    for (const o of req.outputs) this.outputs.set(o.destinationId, o);
    // Simulate ingest acceptance asynchronously, like a real sender would.
    if (this.silent) return;
    queueMicrotask(() => {
      for (const o of req.outputs) this.emit('output', { type: 'outputUp', destinationId: o.destinationId });
    });
  }
  async addOutput(o: EngineOutput) {
    if (this.failAddOutputFor.has(o.destinationId)) throw new Error('connect ECONNREFUSED');
    this.outputs.set(o.destinationId, o);
    if (this.silent) return;
    queueMicrotask(() => this.emit('output', { type: 'outputUp', destinationId: o.destinationId }));
  }
  async removeOutput(id: string) {
    this.outputs.delete(id);
  }
  async stop() {
    this.stopped++;
    this.outputs.clear();
  }
}

class FakeScheduler implements Scheduler {
  timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  private seq = 0;
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ fn, ms, id });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  /** Fire all pending timers (in order) and drain microtasks. */
  async flush() {
    const pending = this.timers.splice(0);
    for (const t of pending) t.fn();
    await tick();
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function config(id: string, platform: DestinationConfig['platform'], over: Partial<DestinationConfig> = {}): DestinationConfig {
  return { id, platform, label: `${platform} channel`, aspectRatio: '16:9', enabled: true, mock: true, ...over };
}

// ---------------------------------------------------------------- tests

describe('BroadcastOrchestrator', () => {
  let engine: FakeEngine;
  let scheduler: FakeScheduler;
  let registry: AdapterRegistry;
  let yt: ReturnType<typeof fakeAdapter>;
  let tw: ReturnType<typeof fakeAdapter>;
  let orch: BroadcastOrchestrator;
  let events: DestinationSnapshot[];

  beforeEach(() => {
    engine = new FakeEngine();
    scheduler = new FakeScheduler();
    registry = new AdapterRegistry();
    yt = fakeAdapter('youtube', { autoStartsOnIngest: false });
    tw = fakeAdapter('twitch');
    registry.register(yt.adapter).register(tw.adapter);
    orch = new BroadcastOrchestrator({
      registry,
      engine,
      scheduler,
      random: () => 0.5,
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, reconnect: { ...DEFAULT_PRODUCTION_SETTINGS.reconnect, maxAttempts: 3 } },
    });
    events = [];
    orch.on('destination', (s) => events.push(s));
  });

  it('connects destinations through AUTHENTICATING to READY and resolves ingest from the adapter', async () => {
    orch.addDestination(config('d1', 'youtube'));
    const snap = await orch.connect('d1');
    expect(snap.state).toBe('READY');
    expect(snap.config.ingest?.url).toBe('rtmp://youtube.test/app');
    expect(events.map((e) => e.state)).toEqual(['DISCONNECTED', 'AUTHENTICATING', 'READY']);
  });

  it('surfaces a humane error and returns to DISCONNECTED when validation fails', async () => {
    registry.register(fakeAdapter('kick', { failValidate: { code: 'NOT_ELIGIBLE' } }).adapter);
    orch.addDestination(config('k', 'kick'));
    const snap = await orch.connect('k');
    expect(snap.state).toBe('DISCONNECTED');
    expect(snap.error?.code).toBe('NOT_ELIGIBLE');
    expect(snap.error?.youCan).toMatch(/Enable live streaming/);
  });

  it('refuses malformed custom ingest before touching the network', async () => {
    registry.register(fakeAdapter('custom').adapter);
    orch.addDestination(config('c', 'custom', { ingest: { protocol: 'rtmp', url: 'rtmp://x/app; rm -rf /', streamKey: 'k' } }));
    const snap = await orch.connect('c');
    expect(snap.state).toBe('DISCONNECTED');
    expect(snap.error?.code).toBe('CONFIG_INVALID');
  });

  it('goes live on all ready destinations with a single engine start and one format per aspect ratio', async () => {
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('d2', 'twitch', { aspectRatio: '9:16' }));
    orch.addDestination(config('d3', 'twitch'));
    await orch.connect('d1');
    await orch.connect('d2');
    await orch.connect('d3');
    await orch.goLive();
    await tick();
    expect(orch.getProduction().state).toBe('LIVE');
    expect(orch.getProduction().liveCount).toBe(3);
    expect(engine.started?.outputs).toHaveLength(3);
    expect(engine.started?.formats['16:9']).toBeDefined();
    expect(engine.started?.formats['9:16']).toBeDefined();
    expect(engine.started?.formats['1:1']).toBeUndefined();
    // YouTube requires explicit transition; Twitch auto-starts on ingest.
    expect(yt.calls.start).toBe(1);
    expect(tw.calls.start).toBe(0);
    expect(yt.calls.chatSubs).toBe(1);
  });

  it('isolates a destination whose broadcast creation fails; the others still go live', async () => {
    registry.register(fakeAdapter('kick', { failCreate: Object.assign(new Error('Forbidden'), { status: 403 }) }).adapter);
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('k', 'kick'));
    await orch.connect('d1');
    await orch.connect('k');
    await orch.goLive();
    await tick();
    expect(orch.getDestination('d1')?.state).toBe('LIVE');
    expect(orch.getDestination('k')?.state).toBe('FAILED');
    expect(orch.getDestination('k')?.error?.code).toBe('AUTH_REVOKED');
    expect(orch.getProduction().state).toBe('LIVE');
    expect(engine.started?.outputs.map((o) => o.destinationId)).toEqual(['d1']);
  });

  it('keeps the production alive when one destination drops, reconnects it with backoff, and never touches siblings', async () => {
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d1');
    await orch.connect('d2');
    await orch.goLive();
    await tick();

    engine.emit('output', { type: 'outputLost', destinationId: 'd2', code: 'INGEST_DISCONNECTED', technical: 'Broken pipe' });
    expect(orch.getDestination('d2')?.state).toBe('RECONNECTING');
    expect(orch.getDestination('d2')?.reconnectAttempt).toBe(1);
    expect(orch.getDestination('d2')?.error?.doing).toContain('other destinations keep streaming');
    expect(orch.getDestination('d1')?.state).toBe('LIVE');
    expect(orch.getProduction().state).toBe('LIVE');
    expect(scheduler.timers).toHaveLength(1);
    expect(scheduler.timers[0]?.ms).toBe(1000);

    await scheduler.flush();
    expect(orch.getDestination('d2')?.state).toBe('LIVE');
    expect(orch.getDestination('d2')?.reconnectAttempt).toBe(0);
    expect(engine.outputs.has('d2')).toBe(true);
    // Reconnect must not re-run the platform start transition or resubscribe chat.
    expect(tw.calls.create).toBe(1);
  });

  it('gives up after maxAttempts and marks the destination FAILED while the production continues', async () => {
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d1');
    await orch.connect('d2');
    await orch.goLive();
    await tick();

    engine.failAddOutputFor.add('d2');
    engine.emit('output', { type: 'outputLost', destinationId: 'd2', code: 'INGEST_DISCONNECTED' });
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      if (scheduler.timers.length === 0) break;
      delays.push(scheduler.timers[0]!.ms);
      await scheduler.flush();
    }
    expect(delays).toEqual([1000, 2000, 4000]); // attempts 1, 2, 3 all fail; attempt 4 exceeds maxAttempts=3 → FAILED
    expect(orch.getDestination('d2')?.state).toBe('FAILED');
    expect(orch.getDestination('d1')?.state).toBe('LIVE');
    expect(orch.getProduction().state).toBe('LIVE');
    expect(orch.getProduction().liveCount).toBe(1);
  });

  it('does not retry on invalid stream key — fails fast with actionable copy', async () => {
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    engine.emit('output', { type: 'outputLost', destinationId: 'd2', code: 'INGEST_INVALID_KEY' });
    expect(orch.getDestination('d2')?.state).toBe('FAILED');
    expect(orch.getDestination('d2')?.error?.youCan).toMatch(/fresh stream key/);
    expect(scheduler.timers).toHaveLength(0);
  });

  it('ends the production when the last active destination fails', async () => {
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    engine.emit('output', { type: 'outputLost', destinationId: 'd2', code: 'INGEST_INVALID_KEY' });
    await tick();
    expect(orch.getProduction().state).toBe('PREVIEW');
    expect(engine.stopped).toBe(1);
    expect(orch.getDestination('d2')?.state).toBe('ENDED');
  });

  it('marks DEGRADED and back to LIVE without dropping the output', async () => {
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    engine.emit('output', { type: 'outputDegraded', destinationId: 'd2' });
    expect(orch.getDestination('d2')?.state).toBe('DEGRADED');
    expect(orch.getDestination('d2')?.error?.code).toBe('NETWORK_DEGRADED');
    expect(orch.getProduction().liveCount).toBe(1);
    engine.emit('output', { type: 'outputRecovered', destinationId: 'd2' });
    expect(orch.getDestination('d2')?.state).toBe('LIVE');
    expect(orch.getDestination('d2')?.error).toBeUndefined();
  });

  it('stops cleanly: every destination ENDED, adapters told to stop, engine stopped once', async () => {
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d1');
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    await orch.stop();
    expect(orch.getProduction().state).toBe('PREVIEW');
    expect(orch.getDestination('d1')?.state).toBe('ENDED');
    expect(orch.getDestination('d2')?.state).toBe('ENDED');
    expect(yt.calls.stop).toBe(1);
    expect(tw.calls.stop).toBe(1);
    expect(engine.stopped).toBe(1);
    // Can go live again from ENDED.
    await orch.goLive();
    await tick();
    expect(orch.getProduction().state).toBe('LIVE');
  });

  it('can stop a single destination while others stay live, and retry a failed one mid-stream', async () => {
    orch.addDestination(config('d1', 'youtube'));
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d1');
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    await orch.stopDestination('d2');
    expect(orch.getDestination('d2')?.state).toBe('ENDED');
    expect(orch.getDestination('d1')?.state).toBe('LIVE');
    expect(orch.getProduction().state).toBe('LIVE');
    expect(engine.outputs.has('d2')).toBe(false);

    await orch.retryDestination('d2');
    await tick();
    expect(orch.getDestination('d2')?.state).toBe('LIVE');
    expect(tw.calls.create).toBe(2);
  });

  it('fails every destination with a humane encoder error when the engine cannot start', async () => {
    engine.failStart = true;
    orch.addDestination(config('d1', 'youtube'));
    await orch.connect('d1');
    await orch.goLive();
    expect(orch.getProduction().state).toBe('PREVIEW');
    expect(orch.getDestination('d1')?.state).toBe('FAILED');
    expect(orch.getDestination('d1')?.error?.code).toBe('ENCODER_FAILED');
  });

  it('never exposes stream keys in snapshots errors', async () => {
    registry.register(fakeAdapter('kick', { failCreate: new Error('publish to rtmp://kick.test/app/live_SECRET_KEY failed') }).adapter);
    orch.addDestination(config('k', 'kick'));
    await orch.connect('k');
    await orch.goLive();
    const json = JSON.stringify(orch.getDestination('k'));
    expect(json).not.toContain('live_SECRET_KEY');
  });

  it('warns instead of going live when nothing is connected', async () => {
    const notices: string[] = [];
    orch.on('notice', (n) => notices.push(n.message));
    orch.addDestination(config('d1', 'youtube'));
    await orch.goLive();
    expect(orch.getProduction().state).toBe('IDLE');
    expect(notices[0]).toMatch(/Connect at least one destination/);
  });
});

describe('reconnect countdown exposure', () => {
  it('publishes nextRetryAt and the policy max while RECONNECTING, and clears them on recovery', async () => {
    const engine = new FakeEngine();
    const scheduler = new FakeScheduler();
    const registry = new AdapterRegistry().register(fakeAdapter('twitch').adapter);
    let t = 10_000;
    const orch = new BroadcastOrchestrator({ registry, engine, scheduler, now: () => t, random: () => 0.5, settings: { ...DEFAULT_PRODUCTION_SETTINGS, reconnect: { ...DEFAULT_PRODUCTION_SETTINGS.reconnect, maxAttempts: 5, jitter: 0 } } });
    orch.addDestination(config('d2', 'twitch'));
    await orch.connect('d2');
    await orch.goLive();
    await tick();
    engine.emit('output', { type: 'outputLost', destinationId: 'd2', code: 'INGEST_DISCONNECTED' });
    const s = orch.getDestination('d2')!;
    expect(s.state).toBe('RECONNECTING');
    expect(s.reconnectMaxAttempts).toBe(5);
    expect(s.nextRetryAt).toBe(11_000);
    t = 11_000;
    await scheduler.flush();
    const after = orch.getDestination('d2')!;
    expect(after.state).toBe('LIVE');
    expect(after.nextRetryAt).toBeUndefined();
    expect(after.reconnectAttempt).toBe(0);
  });
});

/**
 * LIVE means bytes are on the wire. Nothing else is allowed to mean it.
 *
 * This is the product's load-bearing promise, written down as the directive's "most important
 * invariant": the application must never display LIVE unless the engine proves the broadcast is
 * actually active. It used to be violated in the one situation that matters, and violated
 * silently — `engine.start()` resolving was taken as the whole answer, so a broadcast aimed at an
 * ingest server that was switched off reported LIVE with a running clock while the far end had
 * never seen a packet. The creator has no way to see through that, which is what makes it the
 * worst defect this product can ship rather than merely a wrong label.
 */
describe('the production is live only when something arrived', () => {
  let engine: FakeEngine;
  let scheduler: FakeScheduler;
  let orch: BroadcastOrchestrator;
  let clock = 1_000;

  beforeEach(async () => {
    clock = 1_000;
    engine = new FakeEngine();
    scheduler = new FakeScheduler();
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('twitch').adapter);
    registry.register(fakeAdapter('kick').adapter);
    orch = new BroadcastOrchestrator({
      registry,
      engine,
      scheduler,
      now: () => clock,
      random: () => 0.5,
      settings: { ...DEFAULT_PRODUCTION_SETTINGS, reconnect: { ...DEFAULT_PRODUCTION_SETTINGS.reconnect, maxAttempts: 2 } },
    });
    orch.addDestination(config('d1', 'twitch'));
    orch.addDestination(config('d2', 'kick'));
    await orch.connect('d1');
    await orch.connect('d2');
  });

  it('stays STARTING when the encoder runs but no destination ever arrives', async () => {
    engine.silent = true;
    await orch.goLive();
    await tick();

    expect(engine.started).toBeDefined();
    expect(orch.getProduction().state).toBe('STARTING');
    expect(orch.getProduction().liveCount).toBe(0);
    // No clock either: an elapsed time is a claim about how long this has been broadcasting.
    expect(orch.getProduction().startedAt).toBeUndefined();
  });

  it('becomes LIVE the moment the first destination arrives, and not before', async () => {
    engine.silent = true;
    await orch.goLive();
    await tick();
    expect(orch.getProduction().state).toBe('STARTING');

    clock = 9_000;
    engine.emit('output', { type: 'outputUp', destinationId: 'd1' });
    await tick();

    const production = orch.getProduction();
    expect(production.state).toBe('LIVE');
    expect(production.liveCount).toBe(1);
    // The timer starts when the bytes did, not when the button was pressed.
    expect(production.startedAt).toBe(9_000);
    // The one that has not arrived is still honestly STARTING.
    expect(orch.getDestination('d2')?.state).toBe('STARTING');
  });

  it('does not restart the clock when the second destination arrives', async () => {
    engine.silent = true;
    await orch.goLive();
    await tick();
    clock = 5_000;
    engine.emit('output', { type: 'outputUp', destinationId: 'd1' });
    await tick();
    clock = 12_000;
    engine.emit('output', { type: 'outputUp', destinationId: 'd2' });
    await tick();

    expect(orch.getProduction().startedAt).toBe(5_000);
    expect(orch.getProduction().liveCount).toBe(2);
  });

  it('ends the production when every destination dies before any of them arrived', async () => {
    engine.silent = true;
    await orch.goLive();
    await tick();
    expect(orch.getProduction().state).toBe('STARTING');

    // Both senders die on their own sockets. Reconnect runs out, and then there is nothing left.
    for (const id of ['d1', 'd2']) {
      engine.emit('output', { type: 'outputLost', destinationId: id, code: 'INGEST_INVALID_KEY' });
    }
    await tick();
    await tick();

    expect(orch.getProduction().state).not.toBe('LIVE');
    expect(orch.getProduction().state).not.toBe('STARTING');
    // `stop()` moves a FAILED destination to ENDED and keeps its error, so the creator can still
    // read what went wrong and the next GO LIVE can start it again without a manual reset.
    expect(orch.getDestination('d1')?.state).toBe('ENDED');
    expect(orch.getDestination('d1')?.error?.code).toBe('INGEST_INVALID_KEY');
  });

  it('reaches LIVE normally when the engine does report outputs up', async () => {
    await orch.goLive();
    await tick();

    expect(orch.getProduction().state).toBe('LIVE');
    expect(orch.getProduction().liveCount).toBe(2);
  });
});
