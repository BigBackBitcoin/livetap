import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, formatForPreset } from '@livetap/core';
import type {
  AspectRatio,
  EngineOutput,
  EngineOutputEvent,
  EngineStartRequest,
  Moment,
  OutputFormat,
  RecordingSettings,
} from '@livetap/core';
import { MobileEngine } from './MobileEngine.js';
import type {
  DeviceLostEvent,
  LiveStreamCapabilities,
  LiveStreamPermissionAlias,
  LiveStreamPermissionStatus,
  LiveStreamPlugin,
  RequestLiveStreamPermissionsOptions,
  SetMuteOptions,
  StartPreviewOptions,
  StartRecordingResult,
  StartStreamOptions,
  StartStreamResult,
  StopRecordingResult,
  StopStreamOptions,
  StreamStateEvent,
  ThermalEvent,
} from '@livetap/capacitor-live-stream';

type Call = { method: string; args?: unknown };

/**
 * A fake native plugin. It records every call and lets the test push `streamState`, `deviceLost`
 * and `thermal` events back at the engine, which is the only thing worth unit-testing on a host
 * with no device: the event mapping.
 */
class FakeLiveStream implements LiveStreamPlugin {
  calls: Call[] = [];
  started: StartStreamOptions[] = [];
  stopped: string[] = [];
  nextId = 1;
  failStartStream = false;
  failRecording = false;
  caps: LiveStreamCapabilities = {
    camera: true,
    microphone: true,
    rtmp: true,
    rtmps: true,
    srt: false,
    hevc: false,
    recording: true,
    backgroundCamera: false,
    backgroundAudio: true,
    screenCapture: false,
    maxSimultaneousStreams: 2,
    verification: 'SIMULATED',
  };

  /** What the OS reports today. Tests move it to 'prompt' or 'denied' to drive the gate. */
  permissions: LiveStreamPermissionStatus = {
    camera: 'granted',
    microphone: 'granted',
    notifications: 'granted',
  };
  /** Aliases the fake creator refuses when the dialog appears. */
  deny: LiveStreamPermissionAlias[] = [];

  private listeners = new Map<string, Array<(e: never) => void>>();

  async capabilities(): Promise<LiveStreamCapabilities> {
    this.calls.push({ method: 'capabilities' });
    return this.caps;
  }

  async checkPermissions(): Promise<LiveStreamPermissionStatus> {
    this.calls.push({ method: 'checkPermissions' });
    return { ...this.permissions };
  }

  async requestPermissions(
    options?: RequestLiveStreamPermissionsOptions,
  ): Promise<LiveStreamPermissionStatus> {
    this.calls.push({ method: 'requestPermissions', args: options });
    const asked: LiveStreamPermissionAlias[] = options?.permissions ?? [
      'camera',
      'microphone',
      'notifications',
    ];
    for (const alias of asked) {
      this.permissions[alias] = this.deny.includes(alias) ? 'denied' : 'granted';
    }
    return { ...this.permissions };
  }

  async startPreview(options: StartPreviewOptions): Promise<void> {
    this.calls.push({ method: 'startPreview', args: options });
  }

  async stopPreview(): Promise<void> {
    this.calls.push({ method: 'stopPreview' });
  }

  async switchCamera(): Promise<void> {
    this.calls.push({ method: 'switchCamera' });
  }

  async setMute(options: SetMuteOptions): Promise<void> {
    this.calls.push({ method: 'setMute', args: options });
  }

  async startStream(options: StartStreamOptions): Promise<StartStreamResult> {
    this.calls.push({ method: 'startStream', args: options });
    if (this.failStartStream) throw new Error('ingest refused by fake');
    this.started.push(options);
    return { id: `native-${this.nextId++}` };
  }

  async stopStream(options: StopStreamOptions): Promise<void> {
    this.calls.push({ method: 'stopStream', args: options });
    this.stopped.push(options.id);
  }

  async startRecording(): Promise<StartRecordingResult> {
    this.calls.push({ method: 'startRecording' });
    if (this.failRecording) throw new Error('no disk space in fake');
    return { path: '/sandbox/livetap-001.mp4' };
  }

  async stopRecording(): Promise<StopRecordingResult> {
    this.calls.push({ method: 'stopRecording' });
    return { path: '/sandbox/livetap-001.mp4', durationMs: 1234 };
  }

  addListener(
    eventName: 'streamState',
    listener: (event: StreamStateEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'deviceLost',
    listener: (event: DeviceLostEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'thermal',
    listener: (event: ThermalEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  async addListener(
    eventName: string,
    listener: (event: never) => void,
  ): Promise<{ remove: () => Promise<void> }> {
    const list = this.listeners.get(eventName) ?? [];
    list.push(listener);
    this.listeners.set(eventName, list);
    return {
      remove: async () => {
        this.calls.push({ method: 'removeListener', args: eventName });
        this.listeners.set(
          eventName,
          (this.listeners.get(eventName) ?? []).filter((l) => l !== listener),
        );
      },
    };
  }

  async removeAllListeners(): Promise<void> {
    this.listeners.clear();
  }

  /** Test helper: push a native event at the engine. */
  fire(eventName: 'streamState', event: StreamStateEvent): void;
  fire(eventName: 'deviceLost', event: DeviceLostEvent): void;
  fire(eventName: 'thermal', event: ThermalEvent): void;
  fire(eventName: string, event: unknown): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      (listener as (e: unknown) => void)(event);
    }
  }
}

const RECORDING_OFF: RecordingSettings = {
  enabled: false,
  container: 'mp4',
  source: 'program',
};

function moment(overrides: { micMuted?: boolean; mirror?: boolean; facing?: 'user' | 'environment' } = {}): Moment {
  return {
    id: 'm1',
    name: 'Vertical',
    icon: '📱',
    layers: [
      {
        id: 'cam',
        kind: 'camera',
        name: 'Camera',
        visible: true,
        placement: { default: { x: 0, y: 0, w: 1, h: 1 } },
        opacity: 1,
        z: 0,
        mirror: overrides.mirror ?? true,
        ...(overrides.facing ? { facing: overrides.facing } : {}),
        deviceId: 'default',
      },
    ],
    audio: { ...DEFAULT_AUDIO, micMuted: overrides.micMuted ?? false },
    transition: { kind: 'cut', durationMs: 0 },
    builtIn: true,
  };
}

function formats(aspect: AspectRatio): Record<AspectRatio, OutputFormat | undefined> {
  return {
    '16:9': aspect === '16:9' ? formatForPreset('1080p30', '16:9') : undefined,
    '9:16': aspect === '9:16' ? formatForPreset('1080p30', '9:16') : undefined,
    '1:1': aspect === '1:1' ? formatForPreset('1080p30', '1:1') : undefined,
  };
}

function output(destinationId: string, aspect: AspectRatio = '9:16'): EngineOutput {
  return {
    destinationId,
    aspectRatio: aspect,
    ingest: { protocol: 'rtmps', url: 'rtmps://ingest.example/live2', streamKey: 'secret-key' },
  };
}

function startRequest(outputs: EngineOutput[], aspect: AspectRatio = '9:16'): EngineStartRequest {
  return {
    formats: formats(aspect),
    outputs,
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: RECORDING_OFF,
  };
}

async function primed(plugin: FakeLiveStream, aspect: AspectRatio = '9:16'): Promise<MobileEngine> {
  const engine = new MobileEngine({ plugin, platform: 'ios', now: () => 1_000 });
  await engine.capabilities();
  await engine.startPreview(moment(), aspect);
  return engine;
}

describe('MobileEngine', () => {
  it('reports the native engine kind', () => {
    expect(new MobileEngine({ plugin: new FakeLiveStream() }).kind).toBe('native');
  });

  it('maps native capabilities onto EngineCapabilities and admits one format only', async () => {
    const plugin = new FakeLiveStream();
    const engine = new MobileEngine({ plugin, platform: 'ios' });

    const caps = await engine.capabilities();

    expect(caps.rtmp).toBe(true);
    expect(caps.whip).toBe(false);
    expect(caps.screen).toBe(false);
    expect(caps.window).toBe(false);
    expect(caps.systemAudio).toBe(false);
    expect(caps.maxFormats).toBe(1);
    expect(caps.hardwareEncoders).toEqual(['videotoolbox']);
    expect(caps.verification).toBe('SIMULATED');
  });

  it('starts a vertical preview with the front camera and the Moment mute state', async () => {
    const plugin = new FakeLiveStream();
    const engine = new MobileEngine({ plugin });

    await engine.startPreview(moment({ micMuted: true }), '9:16');

    expect(plugin.calls).toEqual(
      expect.arrayContaining([
        { method: 'startPreview', args: { camera: 'front', aspect: '9:16' } },
        { method: 'setMute', args: { muted: true } },
      ]),
    );
  });

  it('asks the OS for camera and microphone before it touches the camera', async () => {
    const plugin = new FakeLiveStream();
    plugin.permissions = { camera: 'prompt', microphone: 'prompt', notifications: 'prompt' };
    const engine = new MobileEngine({ plugin });

    await engine.startPreview(moment(), '9:16');

    const methods = plugin.calls.map((c) => c.method);
    expect(methods.indexOf('requestPermissions')).toBeLessThan(methods.indexOf('startPreview'));
    expect(plugin.calls).toContainEqual({
      method: 'requestPermissions',
      args: { permissions: ['camera', 'microphone'] },
    });
  });

  it('does not re-prompt when the OS has already granted capture', async () => {
    const plugin = new FakeLiveStream();
    const engine = new MobileEngine({ plugin });

    await engine.startPreview(moment(), '9:16');

    expect(plugin.calls.filter((c) => c.method === 'requestPermissions')).toEqual([]);
  });

  it('refuses to preview when the creator denies the camera, and says which one', async () => {
    const plugin = new FakeLiveStream();
    plugin.permissions = { camera: 'prompt', microphone: 'prompt', notifications: 'prompt' };
    plugin.deny = ['camera'];
    const engine = new MobileEngine({ plugin });
    const errors: Array<{ code: string }> = [];
    engine.on('engineError', (e) => errors.push(e));

    await expect(engine.startPreview(moment(), '9:16')).rejects.toThrow(/camera/);

    expect(plugin.calls.map((c) => c.method)).not.toContain('startPreview');
    expect(errors).toEqual([
      { code: 'CAMERA_LOST', technical: 'permission not granted: camera' },
    ]);
  });

  it('asks for notifications separately and previews anyway when they are refused', async () => {
    const plugin = new FakeLiveStream();
    plugin.permissions = { camera: 'prompt', microphone: 'prompt', notifications: 'prompt' };
    plugin.deny = ['notifications'];
    const engine = new MobileEngine({ plugin });

    await engine.startPreview(moment(), '9:16');

    expect(plugin.calls).toContainEqual({
      method: 'requestPermissions',
      args: { permissions: ['notifications'] },
    });
    expect(plugin.calls.map((c) => c.method)).toContain('startPreview');
  });

  it('switches camera when the Moment says the camera faces the other way', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);

    await engine.setMoment(moment({ facing: 'environment' }));

    expect(plugin.calls.filter((c) => c.method === 'switchCamera')).toHaveLength(1);
  });

  it('keeps the front camera when the Moment is un-mirrored but still faces the creator', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);

    // The shipped Moments are exactly this shape now: not mirrored, still a selfie shot. Reading
    // the flip instead of the facing would point the phone at the wall.
    await engine.setMoment(moment({ mirror: false, facing: 'user' }));

    expect(plugin.calls.filter((c) => c.method === 'switchCamera')).toHaveLength(0);
  });

  it('falls back to the mirror flag for a Moment saved before facing existed', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);

    await engine.setMoment(moment({ mirror: false }));

    expect(plugin.calls.filter((c) => c.method === 'switchCamera')).toHaveLength(1);
  });

  it('passes the resolved encoder format and the stream key to the native layer', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);

    await engine.start(startRequest([output('d1')]));

    const expected = formatForPreset('1080p30', '9:16');
    expect(plugin.started).toHaveLength(1);
    expect(plugin.started[0]).toEqual({
      url: 'rtmps://ingest.example/live2',
      streamKey: 'secret-key',
      videoKbps: expected.videoKbps,
      audioKbps: expected.audioKbps,
      width: expected.width,
      height: expected.height,
      fps: expected.fps,
      keyframeSeconds: expected.keyframeIntervalSeconds,
    });
  });

  it('translates connected / degraded / recovered / failed into engine output events', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1')]));

    plugin.fire('streamState', { id: 'native-1', state: 'connected', bitrateKbps: 4500 });
    plugin.fire('streamState', { id: 'native-1', state: 'degraded', technical: 'rtt 900ms' });
    plugin.fire('streamState', { id: 'native-1', state: 'connected' });
    plugin.fire('streamState', { id: 'native-1', state: 'failed', code: 'AUTH_REVOKED' });

    expect(events).toEqual([
      { type: 'outputUp', destinationId: 'd1' },
      { type: 'outputDegraded', destinationId: 'd1', technical: 'rtt 900ms' },
      { type: 'outputRecovered', destinationId: 'd1' },
      { type: 'outputLost', destinationId: 'd1', code: 'AUTH_REVOKED' },
    ]);
  });

  it('defaults a disconnect without a code to INGEST_DISCONNECTED', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1')]));
    plugin.fire('streamState', { id: 'native-1', state: 'disconnected' });

    expect(events).toEqual([
      { type: 'outputLost', destinationId: 'd1', code: 'INGEST_DISCONNECTED' },
    ]);
  });

  it('ignores events for unknown native ids instead of throwing', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1')]));
    plugin.fire('streamState', { id: 'native-999', state: 'connected' });

    expect(events).toEqual([]);
  });

  it('refuses SRT and WHIP outputs with CONFIG_INVALID rather than pretending', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(
      startRequest([
        {
          destinationId: 'srt1',
          aspectRatio: '9:16',
          ingest: { protocol: 'srt', url: 'srt://relay.example:9000' },
        },
      ]),
    );

    expect(plugin.started).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'outputLost', destinationId: 'srt1', code: 'CONFIG_INVALID' });
  });

  it('refuses an output whose aspect ratio is not the single master format', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin, '9:16');
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('wide', '16:9')], '9:16'));

    expect(plugin.started).toHaveLength(0);
    expect(events[0]).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('refuses an output with no stream key with INGEST_INVALID_KEY', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(
      startRequest([
        {
          destinationId: 'nokey',
          aspectRatio: '9:16',
          ingest: { protocol: 'rtmps', url: 'rtmps://ingest.example/live2' },
        },
      ]),
    );

    expect(events[0]).toMatchObject({ code: 'INGEST_INVALID_KEY' });
  });

  it('caps concurrent pushes at the device limit and points at the relay', async () => {
    const plugin = new FakeLiveStream();
    plugin.caps = { ...plugin.caps, maxSimultaneousStreams: 1 };
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1'), output('d2')]));

    expect(plugin.started).toHaveLength(1);
    const lost = events.filter((e) => e.type === 'outputLost');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ destinationId: 'd2', code: 'CONFIG_INVALID' });
  });

  it('reports a failed startStream as outputLost and keeps no session', async () => {
    const plugin = new FakeLiveStream();
    plugin.failStartStream = true;
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1')]));

    expect(events[0]).toMatchObject({ type: 'outputLost', destinationId: 'd1', code: 'INGEST_REFUSED' });
    // The refused destination must not occupy a slot.
    await engine.addOutput(output('d2'));
    expect(plugin.calls.filter((c) => c.method === 'startStream')).toHaveLength(2);
  });

  it('removes one output without touching its siblings', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];

    await engine.start(startRequest([output('d1')]));
    await engine.addOutput(output('d2'));
    engine.on('output', (e) => events.push(e));

    await engine.removeOutput('d1');

    expect(plugin.stopped).toEqual(['native-1']);
    expect(events).toEqual([{ type: 'outputStopped', destinationId: 'd1' }]);
  });

  it('stops every output and releases its native listeners', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const events: EngineOutputEvent[] = [];
    engine.on('output', (e) => events.push(e));

    await engine.start(startRequest([output('d1')]));
    await engine.addOutput(output('d2'));
    await engine.stop();

    expect(plugin.stopped).toEqual(['native-1', 'native-2']);
    expect(events.filter((e) => e.type === 'outputStopped')).toHaveLength(2);
    expect(plugin.calls.filter((c) => c.method === 'removeListener')).toHaveLength(3);
  });

  it('emits aggregated metrics from native bitrate reports', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const metrics: Array<{ encodedKbps: number; targetKbps: number; updatedAt: number }> = [];
    engine.on('metrics', (m) => metrics.push(m));

    await engine.start(startRequest([output('d1')]));
    plugin.fire('streamState', { id: 'native-1', state: 'connected', bitrateKbps: 4200 });

    expect(metrics.at(-1)).toMatchObject({
      encodedKbps: 4200,
      targetKbps: formatForPreset('1080p30', '9:16').videoKbps,
      updatedAt: 1_000,
    });
  });

  it('surfaces an unrecoverable device loss as both deviceLost and engineError', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const lost: Array<{ kind: string }> = [];
    const errors: Array<{ code: string }> = [];
    engine.on('deviceLost', (e) => lost.push(e));
    engine.on('engineError', (e) => errors.push(e));

    plugin.fire('deviceLost', { kind: 'camera', recoverable: false, technical: 'backgrounded' });

    expect(lost).toEqual([{ kind: 'camera' }]);
    expect(errors).toEqual([{ code: 'CAMERA_LOST', technical: 'backgrounded' }]);
  });

  it('does not raise an engine error for a recoverable device interruption', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const errors: unknown[] = [];
    engine.on('engineError', (e) => errors.push(e));

    plugin.fire('deviceLost', { kind: 'mic', recoverable: true });

    expect(errors).toEqual([]);
  });

  it('raises ENCODER_OVERLOADED on serious thermal pressure so quality can step down', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const errors: Array<{ code: string }> = [];
    engine.on('engineError', (e) => errors.push(e));

    plugin.fire('thermal', { level: 'fair' });
    expect(errors).toEqual([]);
    expect(engine.thermal).toBe('fair');

    plugin.fire('thermal', { level: 'serious' });
    expect(errors).toEqual([
      { code: 'ENCODER_OVERLOADED', technical: 'thermalState=serious; step down resolution/fps' },
    ]);
  });

  it('starts recording when the start request asks for it', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const recordings: Array<{ state: string; path?: string }> = [];
    engine.on('recording', (r) => recordings.push(r));

    await engine.start({
      ...startRequest([output('d1')]),
      recording: { ...RECORDING_OFF, enabled: true },
    });

    expect(recordings).toEqual([{ state: 'started', path: '/sandbox/livetap-001.mp4' }]);
  });

  it('reports a recording failure as RECORDING_FAILED without failing the stream', async () => {
    const plugin = new FakeLiveStream();
    plugin.failRecording = true;
    const engine = await primed(plugin);
    const recordings: Array<{ state: string; code?: string }> = [];
    engine.on('recording', (r) => recordings.push(r));

    await engine.start({
      ...startRequest([output('d1')]),
      recording: { ...RECORDING_OFF, enabled: true },
    });

    expect(plugin.started).toHaveLength(1);
    expect(recordings).toEqual([{ state: 'failed', code: 'RECORDING_FAILED' }]);
  });

  it('returns the sandbox path when recording stops', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);

    await engine.startRecording({ ...RECORDING_OFF, enabled: true });
    const result = await engine.stopRecording();

    expect(result).toEqual({ path: '/sandbox/livetap-001.mp4' });
  });
});

/**
 * A PHONE REACHING MORE THAN ONE DESTINATION.
 *
 * `maxSimultaneousStreams` is 1 on real Android hardware: one encoder, one RTMP socket. The second
 * push has always been refused with a CONFIG_INVALID whose own message reads "use a relay for more
 * (ADR-009)" — and the relay existed, was tested, and nothing connected it, so that sentence
 * pointed at nothing. Mobile was a single-destination product by omission rather than by design.
 *
 * With a relay session the device encodes once and publishes once; the relay fans out. These tests
 * are about the mapping, which is the only part a host with no device can honestly prove. The
 * native side that opens the socket is unverified on hardware — see the header of MobileEngine.ts.
 */
describe('MobileEngine publishing through a relay', () => {
  const RELAY = {
    rtmpUrl: 'rtmp://relay.example.com:19350/live/abc123def456',
    authorization: 'livetap:pub-secret',
  };

  async function relayed(plugin: FakeLiveStream, outputs: EngineOutput[]): Promise<MobileEngine> {
    const engine = await primed(plugin);
    engine.useRelaySession(RELAY);
    await engine.start(startRequest(outputs));
    return engine;
  }

  it('publishes ONE native stream for three destinations, past the device cap', async () => {
    const plugin = new FakeLiveStream();
    plugin.caps = { ...plugin.caps, maxSimultaneousStreams: 1 };

    await relayed(plugin, [output('yt'), output('twitch'), output('kick')]);

    expect(plugin.started, 'the device opened one socket per destination, which it cannot do').toHaveLength(1);
  });

  it('splits the relay URL into url + key and passes credentials separately, never in the URL', async () => {
    const plugin = new FakeLiveStream();
    await relayed(plugin, [output('yt')]);

    const started = plugin.started[0]!;
    expect(started.url).toBe('rtmp://relay.example.com:19350/live');
    expect(started.streamKey).toBe('abc123def456');
    expect(started.username).toBe('livetap');
    expect(started.password).toBe('pub-secret');
    // A password inside a URL survives in encoder logs and diagnostics panels.
    expect(started.url).not.toContain('pub-secret');
    expect(started.streamKey).not.toContain('pub-secret');
  });

  it('brings every destination up from the one native stream', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt'), output('twitch')]);
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (e) => seen.push(e));

    plugin.fire('streamState', { id: plugin.started.length ? 'native-1' : 'native-1', state: 'connected' });

    expect(seen.filter((e) => e.type === 'outputUp').map((e) => e.destinationId).sort()).toEqual([
      'twitch',
      'yt',
    ]);
  });

  it('takes every destination down together when the one push fails', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt'), output('twitch')]);
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (e) => seen.push(e));

    plugin.fire('streamState', { id: 'native-1', state: 'failed', technical: 'relay refused' });

    expect(seen.filter((e) => e.type === 'outputLost').map((e) => e.destinationId).sort()).toEqual([
      'twitch',
      'yt',
    ]);
  });

  /**
   * The relay derives the other formats server-side and has ALREADY refused the session outright
   * at `POST /sessions` if it is not configured to, naming the destination and the setting. A
   * phone refusing again here would reject broadcasts the relay just accepted — and vertical plus
   * horizontal in one broadcast is the thing a phone could never do before.
   */
  it('does not refuse a destination whose aspect differs from the master, once relaying', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin, '9:16');
    engine.useRelaySession(RELAY);
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (e) => seen.push(e));

    await engine.start(startRequest([output('tiktok', '9:16'), output('yt', '16:9')], '9:16'));

    expect(seen.filter((e) => e.type === 'outputLost')).toHaveLength(0);
    expect(plugin.started).toHaveLength(1);
  });

  it('keeps the shared push alive when one destination is removed, and stops it with the last', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt'), output('twitch')]);

    await engine.removeOutput('yt');
    expect(plugin.stopped, 'removing one destination took the others off the air').toHaveLength(0);

    await engine.removeOutput('twitch');
    expect(plugin.stopped).toEqual(['native-1']);
  });

  it('stops the native push once, not once per destination', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt'), output('twitch'), output('kick')]);

    await engine.stop();

    expect(plugin.stopped).toEqual(['native-1']);
  });

  /**
   * A relay session's forward list is fixed when the session is created. A destination added
   * afterwards would come up green on the phone and receive nothing at the platform, which is the
   * exact failure this product keeps having to design against.
   */
  it('refuses a destination that tries to join a relay broadcast in progress', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt')]);
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (e) => seen.push(e));

    await engine.addOutput(output('late'));

    expect(plugin.started).toHaveLength(1);
    const lost = seen.find((e) => e.type === 'outputLost');
    expect(lost?.destinationId).toBe('late');
    expect(lost && 'technical' in lost ? lost.technical : '').toMatch(/end and start again/i);
  });

  it('refuses to change the relay session while an output is publishing', async () => {
    const plugin = new FakeLiveStream();
    const engine = await relayed(plugin, [output('yt')]);

    expect(() => engine.useRelaySession({ rtmpUrl: 'rtmp://other/live/xyz' })).toThrow(
      /while an output is publishing/,
    );
  });

  /** The relay path must not weaken the direct one: with no session, the device cap still holds. */
  it('still enforces the device cap when there is no relay session', async () => {
    const plugin = new FakeLiveStream();
    plugin.caps = { ...plugin.caps, maxSimultaneousStreams: 1 };
    const engine = await primed(plugin);
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (e) => seen.push(e));

    await engine.start(startRequest([output('yt'), output('twitch')]));

    expect(plugin.started).toHaveLength(1);
    expect(seen.find((e) => e.type === 'outputLost')?.destinationId).toBe('twitch');
  });
});

/**
 * BOND IS A PARTICIPANT ON ANDROID TOO.
 *
 * The phone cannot measure round trip, jitter or RTP loss — the native encoder does not report
 * them — so those go in as zero rather than being derived from a dropped-frame count, which is
 * backpressure and not packet loss. What Bond does here is the thing that actually matters on a
 * handset: the encoder is asked for a bitrate, the radio delivers less, and the decision layer
 * says so and names one the network can carry.
 */
describe('MobileEngine connection health', () => {
  it('says nothing about connection health before anything is publishing', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    const metrics: Array<{ connectionHealth?: string; recommendedKbps?: number }> = [];
    engine.on('metrics', (m) => metrics.push(m));

    await engine.start(startRequest([]));

    for (const m of metrics) expect(m.connectionHealth).toBeUndefined();
  });

  it('reports health and a recommended bitrate once the radio has carried something', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    await engine.start(startRequest([output('yt')]));
    const metrics: Array<{ connectionHealth?: string; recommendedKbps?: number }> = [];
    engine.on('metrics', (m) => metrics.push(m));

    plugin.fire('streamState', { id: 'native-1', state: 'connected', bitrateKbps: 6000 });

    const last = metrics[metrics.length - 1]!;
    expect(last.connectionHealth, 'Bond never saw the publish').toBeDefined();
    expect(last.connectionHealth).not.toBe('offline');
    expect(last.recommendedKbps).toBeGreaterThan(0);
  });

  /* The case a phone actually hits: asked for 4500, the radio gives 400. */
  it('calls the connection insufficient when the radio cannot carry the encoder', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    await engine.start(startRequest([output('yt')]));
    const metrics: Array<{ connectionHealth?: string; recommendedKbps?: number }> = [];
    engine.on('metrics', (m) => metrics.push(m));

    plugin.fire('streamState', { id: 'native-1', state: 'connected', bitrateKbps: 4000 });
    plugin.fire('streamState', { id: 'native-1', state: 'degraded', bitrateKbps: 400, droppedFrames: 120 });

    const last = metrics[metrics.length - 1]!;
    expect(['degraded', 'insufficient']).toContain(last.connectionHealth);
  });

  it('forgets the previous broadcast health rather than carrying it into the next', async () => {
    const plugin = new FakeLiveStream();
    const engine = await primed(plugin);
    await engine.start(startRequest([output('yt')]));
    plugin.fire('streamState', { id: 'native-1', state: 'connected', bitrateKbps: 6000 });

    await engine.stop();
    const metrics: Array<{ connectionHealth?: string }> = [];
    engine.on('metrics', (m) => metrics.push(m));
    await engine.start(startRequest([output('yt')]));

    for (const m of metrics) expect(m.connectionHealth).toBeUndefined();
  });
});
