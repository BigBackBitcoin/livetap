// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AspectRatio,
  EngineMetrics,
  EngineOutput,
  EngineOutputEvent,
  EngineStartRequest,
  Layer,
  Moment,
} from '@livetap/core';
import { DEFAULT_AUDIO, formatForPreset } from '@livetap/core';
import { BrowserEngine, readOutboundSample, relayEndpoint } from './BrowserEngine.js';
import { pickRecordingMime } from './deps.js';
import type { BrowserEngineOptions, MediaDevicesLike } from './deps.js';
import {
  FAKE_ANSWER_SDP,
  FakeMediaRecorder,
  FakePeerConnection,
  asMediaRecorderCtor,
  asMediaStream,
  asPeerConnectionCtor,
  createFakeCanvas,
  createFakeFetch,
  createFakeMediaStream,
  createFakeTrack,
  createFakeVideoSource,
  type FakeFetchResponseSpec,
  type FakeMediaStream,
  type FakeTrack,
} from '../testing/fakes.js';

// ------------------------------------------------------------------ harness

/** A manual clock so metrics/stats/warm-up timers are deterministic. */
function createClock() {
  let now = 0;
  let nextId = 1;
  let tasks: Array<{ id: number; at: number; fn: () => void }> = [];
  return {
    now: () => now,
    setTimeoutFn: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      tasks.push({ id, at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeoutFn: (handle: unknown): void => {
      tasks = tasks.filter((t) => t.id !== handle);
    },
    pending: () => tasks.length,
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        tasks.sort((a, b) => a.at - b.at);
        const next = tasks[0];
        if (!next || next.at > target) break;
        tasks = tasks.slice(1);
        now = next.at;
        next.fn();
        // Let any async continuation (pollStats) settle before the next task.
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
      }
      now = target;
    },
  };
}

interface Harness {
  engine: BrowserEngine;
  clock: ReturnType<typeof createClock>;
  canvas: ReturnType<typeof createFakeCanvas>;
  devices: { calls: MediaStreamConstraints[]; cameraStream: FakeMediaStream; micStream: FakeMediaStream };
  display: { calls: Array<{ video?: unknown; audio?: unknown }>; stream: FakeMediaStream };
  fetch: ReturnType<typeof createFakeFetch>;
  outputs: EngineOutputEvent[];
  metrics: EngineMetrics[];
  deviceLost: Array<{ kind: string; deviceId?: string }>;
  recordings: Array<{ state: string }>;
  errors: Array<{ code: string; technical?: string }>;
}

function harness(
  options: Partial<BrowserEngineOptions> = {},
  fetchHandler?: (call: { url: string; method: string; headers: Record<string, string>; body?: string }) => FakeFetchResponseSpec,
): Harness {
  const clock = createClock();
  const canvas = createFakeCanvas(1920, 1080);
  const cameraStream = createFakeMediaStream([createFakeTrack('video')]);
  const micStream = createFakeMediaStream([createFakeTrack('audio')]);
  const displayStream = createFakeMediaStream([createFakeTrack('video'), createFakeTrack('audio')]);
  const deviceCalls: MediaStreamConstraints[] = [];
  const displayCalls: Array<{ video?: unknown; audio?: unknown }> = [];
  const fetchFake = createFakeFetch(fetchHandler);

  const mediaDevices: MediaDevicesLike = {
    getUserMedia: async (constraints) => {
      deviceCalls.push(constraints);
      return constraints.video ? asMediaStream(cameraStream) : asMediaStream(micStream);
    },
  };

  const engine = new BrowserEngine({
    mediaDevices,
    getDisplayMedia: async (opts) => {
      displayCalls.push(opts);
      return asMediaStream(displayStream);
    },
    MediaRecorderCtor: asMediaRecorderCtor(FakeMediaRecorder),
    RTCPeerConnectionCtor: asPeerConnectionCtor(FakePeerConnection),
    fetch: fetchFake.fetch,
    createCanvas: () => canvas.canvas,
    createVideoElement: () => createFakeVideoSource(1280, 720),
    AudioContextCtor: null,
    VideoEncoderProbe: null,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    // Never hand the compositor a real rAF: tests drive rendering explicitly.
    raf: () => 0,
    caf: () => undefined,
    ...options,
  });

  const h: Harness = {
    engine,
    clock,
    canvas,
    devices: { calls: deviceCalls, cameraStream, micStream },
    display: { calls: displayCalls, stream: displayStream },
    fetch: fetchFake,
    outputs: [],
    metrics: [],
    deviceLost: [],
    recordings: [],
    errors: [],
  };
  engine.on('output', (event) => h.outputs.push(event));
  engine.on('metrics', (sample) => h.metrics.push(sample));
  engine.on('deviceLost', (payload) => h.deviceLost.push(payload));
  engine.on('recording', (payload) => h.recordings.push(payload));
  engine.on('engineError', (payload) => h.errors.push(payload));
  return h;
}

function cameraMoment(overrides: Partial<Moment> = {}): Moment {
  const camera: Layer = {
    id: 'cam',
    kind: 'camera',
    name: 'Camera',
    visible: true,
    placement: { default: { x: 0, y: 0, w: 1, h: 1 } },
    opacity: 1,
    z: 10,
    fit: 'cover',
    mirror: true,
    deviceId: 'default',
  };
  return {
    id: 'main',
    name: 'Main Camera',
    icon: 'cam',
    builtIn: false,
    layers: [camera],
    audio: { ...DEFAULT_AUDIO },
    transition: { kind: 'cut', durationMs: 0 },
    ...overrides,
  };
}

function screenMoment(): Moment {
  const screen: Layer = {
    id: 'screen',
    kind: 'screen',
    name: 'Screen',
    visible: true,
    placement: { default: { x: 0, y: 0, w: 1, h: 1 } },
    opacity: 1,
    z: 5,
    fit: 'contain',
    sourceId: 'prompt',
    captureSystemAudio: true,
  };
  return { ...cameraMoment(), id: 'share', name: 'Screen Share', layers: [screen] };
}

function output(destinationId: string, protocol: EngineOutput['ingest']['protocol'], aspectRatio: AspectRatio = '16:9'): EngineOutput {
  const url =
    protocol === 'whip' ? `https://ingest.test/whip/${destinationId}` : protocol === 'srt' ? 'srt://live.test:9000' : 'rtmps://live.test/app';
  return { destinationId, aspectRatio, ingest: { protocol, url, streamKey: 'secret-key' } };
}

function request(outputs: EngineOutput[], recording = false): EngineStartRequest {
  return {
    formats: {
      '16:9': formatForPreset('1080p30', '16:9'),
      '9:16': formatForPreset('1080p30', '9:16'),
      '1:1': undefined,
    },
    outputs,
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: recording, container: 'mp4', source: 'program' },
  };
}

// ------------------------------------------------------------------ tests

describe('BrowserEngine.capabilities', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
    FakeMediaRecorder.reset();
  });

  it('never claims RTMP or SRT - a browser has no such socket', async () => {
    const caps = await harness().engine.capabilities();
    expect(caps.rtmp).toBe(false);
    expect(caps.srt).toBe(false);
    expect(caps.whip).toBe(true);
    expect(caps.maxFormats).toBe(1);
  });

  it('is UNVERIFIED until a real capture succeeds', async () => {
    const h = harness();
    expect((await h.engine.capabilities()).verification).toBe('UNVERIFIED');
    await h.engine.startPreview(cameraMoment(), '16:9');
    expect((await h.engine.capabilities()).verification).toBe('PASS');
  });

  it('is UNAVAILABLE with no mediaDevices at all', async () => {
    const caps = await harness({ mediaDevices: null, getDisplayMedia: null }).engine.capabilities();
    expect(caps.verification).toBe('UNAVAILABLE');
    expect(caps.camera).toBe(false);
    expect(caps.microphone).toBe(false);
    expect(caps.screen).toBe(false);
    expect(caps.window).toBe(false);
    expect(caps.systemAudio).toBe(false);
  });

  it('reports whip:false without RTCPeerConnection', async () => {
    const caps = await harness({ RTCPeerConnectionCtor: null }).engine.capabilities();
    expect(caps.whip).toBe(false);
  });

  it('reports the webcodecs hardware encoder only when the probe says so', async () => {
    const yes = await harness({ VideoEncoderProbe: { isConfigSupported: async () => ({ supported: true }) } }).engine.capabilities();
    expect(yes.hardwareEncoders).toEqual(['webcodecs']);

    const no = await harness({ VideoEncoderProbe: { isConfigSupported: async () => ({ supported: false }) } }).engine.capabilities();
    expect(no.hardwareEncoders).toEqual([]);
  });

  it('survives a throwing WebCodecs probe', async () => {
    const caps = await harness({
      VideoEncoderProbe: {
        isConfigSupported: async () => {
          throw new Error('not implemented');
        },
      },
    }).engine.capabilities();
    expect(caps.hardwareEncoders).toEqual([]);
  });

  it('reports recording support and the chosen mime type', async () => {
    const h = harness();
    const caps = await h.engine.capabilities();
    expect(caps.recording).toBe(true);
    expect(h.engine.describeEnvironment().recordingMimeType).toBe('video/mp4;codecs=avc1');
    expect(h.engine.describeEnvironment().relayConfigured).toBe(false);
  });

  it('reports no recording without MediaRecorder', async () => {
    const caps = await harness({ MediaRecorderCtor: null }).engine.capabilities();
    expect(caps.recording).toBe(false);
  });
});

describe('BrowserEngine preview + capture', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
    FakeMediaRecorder.reset();
  });

  it('acquires the camera with a 1280x720/30 ideal and the mic with the Moment audio flags', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');

    const videoCall = h.devices.calls.find((c) => c.video);
    const video = videoCall?.video as MediaTrackConstraints;
    expect(video.width).toEqual({ ideal: 1280 });
    expect(video.height).toEqual({ ideal: 720 });
    expect(video.frameRate).toEqual({ ideal: 30 });
    expect(video.deviceId).toBeUndefined(); // 'default' must not become an exact constraint

    const audioCall = h.devices.calls.find((c) => c.audio);
    const audio = audioCall?.audio as MediaTrackConstraints;
    expect(audio.echoCancellation).toBe(true);
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.autoGainControl).toBe(true);
  });

  it('pins a named camera device with an exact constraint', async () => {
    const h = harness();
    const moment = cameraMoment();
    (moment.layers[0] as Layer & { deviceId: string }).deviceId = 'cam-42';
    await h.engine.startPreview(moment, '16:9');
    const video = h.devices.calls.find((c) => c.video)?.video as MediaTrackConstraints;
    expect(video.deviceId).toEqual({ exact: 'cam-42' });
  });

  it('skips the microphone when the Moment has none', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment({ audio: { ...DEFAULT_AUDIO, micDeviceId: 'none' } }), '16:9');
    expect(h.devices.calls.some((c) => c.audio)).toBe(false);
  });

  it('does not prompt for screen capture until a Moment needs it', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    expect(h.display.calls).toHaveLength(0);

    await h.engine.setMoment(screenMoment());
    expect(h.display.calls).toEqual([{ video: true, audio: true }]);
  });

  it('captures the canvas at the format fps and exposes it as previewStream', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    expect(h.canvas.captureStreamCalls).toEqual([30]);
    expect(h.engine.previewStream).not.toBeNull();
    expect(h.engine.isPreviewing).toBe(true);
    expect(h.engine.composer?.width).toBe(1920);
    expect(h.engine.composer?.height).toBe(1080);
  });

  it('sizes the canvas for the master aspect ratio', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '9:16');
    expect(h.engine.composer?.width).toBe(1080);
    expect(h.engine.composer?.height).toBe(1920);
    expect(h.engine.composer?.aspect).toBe('9:16');
  });

  it('mixes mic and system audio through gain nodes when WebAudio is available', async () => {
    const { createFakeAudioContextCtor } = await import('../testing/fakes.js');
    const audio = createFakeAudioContextCtor();
    const h = harness({ AudioContextCtor: audio.ctor });
    await h.engine.startPreview(screenMoment(), '16:9');
    const ctx = audio.instances[0];
    expect(ctx).toBeDefined();
    // one gain for the mic, one for system audio
    expect(ctx!.gains.length).toBeGreaterThanOrEqual(1);
    expect(h.engine.describeEnvironment().hasAudioMixing).toBe(true);
  });

  it('applies mute and gain instantly on setMoment without re-acquiring the device', async () => {
    const { createFakeAudioContextCtor } = await import('../testing/fakes.js');
    const audio = createFakeAudioContextCtor();
    const h = harness({ AudioContextCtor: audio.ctor });
    await h.engine.startPreview(cameraMoment(), '16:9');
    const acquisitions = h.devices.calls.length;
    const micGain = audio.instances[0]?.gains[0];
    expect(micGain?.gain.value).toBe(1);

    await h.engine.setMoment(cameraMoment({ audio: { ...DEFAULT_AUDIO, micMuted: true } }));
    expect(micGain?.gain.value).toBe(0);
    expect(h.devices.calls.length).toBe(acquisitions);

    await h.engine.setMoment(cameraMoment({ audio: { ...DEFAULT_AUDIO, micGain: 1.5 } }));
    expect(micGain?.gain.value).toBe(1.5);
  });

  it('attaches the preview stream to a video element', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    // A plain fake, not happy-dom's <video>: happy-dom's srcObject setter rejects non-MediaStream.
    const video = createFakeVideoSource();
    h.engine.attachPreview(video);
    expect(video.srcObject).toBe(h.engine.previewStream);
    expect(video.muted).toBe(true);
    expect(() => h.engine.attachPreview(null)).not.toThrow();
  });

  it('keeps a camera warm for 5s after a Moment stops using it', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    const track = h.devices.cameraStream.getTracks()[0]!;
    await h.engine.setMoment(cameraMoment({ id: 'bg', layers: [] }));
    expect(track.readyState).toBe('live');

    await h.clock.advance(4999);
    expect(track.readyState).toBe('live');
    await h.clock.advance(2);
    expect(track.readyState).toBe('ended');
  });

  it('cancels the warm-up release when the Moment comes back', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    const track = h.devices.cameraStream.getTracks()[0]!;
    await h.engine.setMoment(cameraMoment({ id: 'bg', layers: [] }));
    await h.clock.advance(3000);
    await h.engine.setMoment(cameraMoment());
    await h.clock.advance(5000);
    expect(track.readyState).toBe('live');
  });

  it('emits deviceLost, hides the layer and keeps the preview alive when a camera track ends', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    const streamBefore = h.engine.previewStream;
    const track = h.devices.cameraStream.getTracks()[0] as FakeTrack;

    track.end();

    expect(h.deviceLost).toEqual([{ kind: 'camera', deviceId: 'default' }]);
    // Preview keeps running: same stream, compositor still looping, notice drawn on the canvas.
    expect(h.engine.isPreviewing).toBe(true);
    expect(h.engine.previewStream).toBe(streamBefore);
    expect(h.engine.composer?.isRunning).toBe(true);
    expect(h.engine.composer?.getNotice()).toBe('Camera disconnected');

    h.canvas.calls.length = 0;
    h.engine.composer?.renderFrame(h.clock.now());
    expect(h.canvas.texts()).toContain('Camera disconnected');
    // The dead camera layer is hidden rather than drawn as a frozen frame.
    expect(h.canvas.ops('drawImage')).toHaveLength(0);
  });

  it('emits deviceLost for the mic and keeps the preview alive', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    (h.devices.micStream.getTracks()[0] as FakeTrack).end();
    expect(h.deviceLost.some((d) => d.kind === 'mic')).toBe(true);
    expect(h.engine.isPreviewing).toBe(true);
  });

  it('reports a screen-capture refusal as deviceLost + SCREEN_DENIED without throwing', async () => {
    const h = harness({
      getDisplayMedia: async () => {
        throw new Error('NotAllowedError');
      },
    });
    await expect(h.engine.startPreview(screenMoment(), '16:9')).resolves.toBeUndefined();
    expect(h.deviceLost).toContainEqual({ kind: 'screen', deviceId: undefined });
    expect(h.errors.some((e) => e.code === 'SCREEN_DENIED')).toBe(true);
    expect(h.engine.isPreviewing).toBe(true);
  });

  it('reports a camera refusal as CAMERA_LOST without throwing', async () => {
    const h = harness({
      mediaDevices: {
        getUserMedia: async () => {
          throw new Error('NotFoundError');
        },
      },
    });
    await expect(h.engine.startPreview(cameraMoment(), '16:9')).resolves.toBeUndefined();
    expect(h.errors.some((e) => e.code === 'CAMERA_LOST')).toBe(true);
    expect(h.errors.some((e) => e.code === 'MIC_LOST')).toBe(true);
  });

  it('stopPreview releases every device', async () => {
    const h = harness();
    await h.engine.startPreview(screenMoment(), '16:9');
    const tracks = [...h.display.stream.getTracks(), ...h.devices.micStream.getTracks()];
    await h.engine.stopPreview();
    expect(h.engine.isPreviewing).toBe(false);
    expect(h.engine.previewStream).toBeNull();
    for (const track of tracks) expect(track.readyState).toBe('ended');
  });

  it('has no previewStream when the canvas cannot be captured', async () => {
    const plain = createFakeCanvas();
    const h = harness({ createCanvas: () => ({ width: 0, height: 0, getContext: plain.canvas.getContext }) });
    await h.engine.startPreview(cameraMoment(), '16:9');
    expect(h.engine.previewStream).toBeNull();
    expect(h.engine.describeEnvironment().hasCanvasCapture).toBe(false);
  });
});

describe('BrowserEngine outputs', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
    FakeMediaRecorder.reset();
  });

  it('refuses an RTMP output with CONFIG_INVALID and never throws when no relay is configured', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');

    await expect(h.engine.start(request([output('yt', 'rtmps')]))).resolves.toBeUndefined();

    expect(h.outputs).toHaveLength(1);
    const event = h.outputs[0]!;
    expect(event.type).toBe('outputLost');
    expect(event).toMatchObject({ destinationId: 'yt', code: 'CONFIG_INVALID' });
    expect((event as { technical?: string }).technical).toContain('Browser cannot publish RTMP');
    expect((event as { technical?: string }).technical).toContain('desktop app');
    // Nothing was attempted over the network.
    expect(h.fetch.calls).toHaveLength(0);
  });

  it('refuses SRT the same way', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('custom', 'srt')]));
    expect(h.outputs[0]).toMatchObject({ type: 'outputLost', code: 'CONFIG_INVALID' });
  });

  it('keeps the preview and the other outputs alive when one output is refused', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('yt', 'rtmps'), output('whip', 'whip')]));
    FakePeerConnection.instances[0]!.simulateConnected();

    expect(h.outputs.filter((e) => e.type === 'outputLost')).toHaveLength(1);
    expect(h.outputs.filter((e) => e.type === 'outputUp')).toEqual([{ type: 'outputUp', destinationId: 'whip' }]);
    expect(h.engine.isPreviewing).toBe(true);
  });

  it('publishes a WHIP output and emits outputUp once ICE connects', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));

    const post = h.fetch.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://ingest.test/whip/whip');
    expect(post?.headers.Authorization).toBe('Bearer secret-key');
    expect(h.outputs).toHaveLength(0);

    FakePeerConnection.instances[0]!.simulateConnected();
    expect(h.outputs).toEqual([{ type: 'outputUp', destinationId: 'whip' }]);
  });

  it('maps a 401 from a WHIP ingest to outputLost INGEST_INVALID_KEY without throwing', async () => {
    const h = harness({}, () => ({ status: 401, body: 'nope' }));
    await h.engine.startPreview(cameraMoment(), '16:9');
    await expect(h.engine.start(request([output('whip', 'whip')]))).resolves.toBeUndefined();
    expect(h.outputs[0]).toMatchObject({ type: 'outputLost', destinationId: 'whip', code: 'INGEST_INVALID_KEY' });
    expect((h.outputs[0] as { technical?: string }).technical).toContain('HTTP 401');
  });

  it('reports outputLost INGEST_DISCONNECTED when ICE fails mid-stream', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();
    h.outputs.length = 0;
    pc.simulateFailed('disconnected');
    expect(h.outputs[0]).toMatchObject({ type: 'outputLost', destinationId: 'whip', code: 'INGEST_DISCONNECTED' });
  });

  it('fails a WHIP output that has nothing to publish', async () => {
    const plain = createFakeCanvas();
    const h = harness({ createCanvas: () => ({ width: 0, height: 0, getContext: plain.canvas.getContext }) });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    expect(h.outputs[0]).toMatchObject({ type: 'outputLost', code: 'ENCODER_FAILED' });
    expect(h.errors.some((e) => e.code === 'ENCODER_FAILED')).toBe(true);
  });

  it('publishes ONE relay session per aspect ratio and brings up every destination on it', async () => {
    const h = harness({ relay: { whipBaseUrl: 'https://relay.livetap.test/whip/', token: 'relay-token' } });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(
      request([output('yt', 'rtmps', '16:9'), output('twitch', 'rtmp', '16:9'), output('tiktok', 'rtmps', '9:16')]),
    );

    const posts = h.fetch.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2); // one per aspect ratio, not one per destination
    expect(posts.map((p) => p.url).sort()).toEqual([
      'https://relay.livetap.test/whip/16x9',
      'https://relay.livetap.test/whip/9x16',
    ]);
    expect(posts[0]!.headers.Authorization).toBe('Bearer relay-token');

    FakePeerConnection.instances[0]!.simulateConnected();
    expect(h.outputs.filter((e) => e.type === 'outputUp').map((e) => e.destinationId).sort()).toEqual(['twitch', 'yt']);

    FakePeerConnection.instances[1]!.simulateConnected();
    expect(h.outputs.filter((e) => e.type === 'outputUp')).toHaveLength(3);
  });

  it('brings a late destination up immediately on an already-connected relay', async () => {
    const h = harness({ relay: { whipBaseUrl: 'https://relay.livetap.test/whip' } });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('yt', 'rtmps')]));
    FakePeerConnection.instances[0]!.simulateConnected();
    h.outputs.length = 0;

    await h.engine.addOutput(output('twitch', 'rtmps'));
    expect(h.fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(h.outputs).toEqual([{ type: 'outputUp', destinationId: 'twitch' }]);
  });

  it('drops every destination on a relay when the relay session dies', async () => {
    const h = harness({ relay: { whipBaseUrl: 'https://relay.livetap.test/whip' } });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('yt', 'rtmps'), output('twitch', 'rtmps')]));
    FakePeerConnection.instances[0]!.simulateConnected();
    h.outputs.length = 0;
    FakePeerConnection.instances[0]!.simulateFailed('failed');
    const lost = h.outputs.filter((e) => e.type === 'outputLost');
    expect(lost.map((e) => e.destinationId).sort()).toEqual(['twitch', 'yt']);
    expect(lost[0]).toMatchObject({ code: 'INGEST_DISCONNECTED' });
  });

  it('fails every relay destination when the relay POST is rejected', async () => {
    const h = harness({ relay: { whipBaseUrl: 'https://relay.livetap.test/whip' } }, () => ({ status: 502 }));
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('yt', 'rtmps')]));
    expect(h.outputs[0]).toMatchObject({ type: 'outputLost', code: 'PLATFORM_ERROR' });
  });

  it('addOutput after a loss reconnects that destination only', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    FakePeerConnection.instances[0]!.simulateConnected();
    FakePeerConnection.instances[0]!.simulateFailed('failed');
    h.outputs.length = 0;

    await h.engine.addOutput(output('whip', 'whip'));
    FakePeerConnection.instances[FakePeerConnection.instances.length - 1]!.simulateConnected();
    expect(h.outputs.filter((e) => e.type === 'outputUp')).toEqual([{ type: 'outputUp', destinationId: 'whip' }]);
  });

  it('removeOutput closes just that session and DELETEs its resource', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('a', 'whip'), output('b', 'whip')]));
    for (const pc of FakePeerConnection.instances) pc.simulateConnected();
    h.outputs.length = 0;

    await h.engine.removeOutput('a');
    expect(h.outputs).toEqual([{ type: 'outputStopped', destinationId: 'a' }]);
    expect(h.fetch.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
    expect(FakePeerConnection.instances[1]!.closed).toBe(false);
  });

  it('removeOutput on an unknown destination is a no-op', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await expect(h.engine.removeOutput('nope')).resolves.toBeUndefined();
    expect(h.outputs).toHaveLength(0);
  });

  it('stop() closes every output but leaves the preview running', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('a', 'whip'), output('b', 'whip')]));
    for (const pc of FakePeerConnection.instances) pc.simulateConnected();
    h.outputs.length = 0;

    await h.engine.stop();
    expect(h.outputs.map((e) => e.type)).toEqual(['outputStopped', 'outputStopped']);
    for (const pc of FakePeerConnection.instances) expect(pc.closed).toBe(true);
    expect(h.engine.isPreviewing).toBe(true);
    expect(h.engine.previewStream).not.toBeNull();
    expect(h.engine.composer?.isRunning).toBe(true);
  });

  it('does not emit outputLost for a session that was deliberately stopped', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('a', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();
    await h.engine.stop();
    h.outputs.length = 0;
    pc.simulateFailed('failed');
    expect(h.outputs).toHaveLength(0);
  });
});

describe('BrowserEngine metrics', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
    FakeMediaRecorder.reset();
  });

  it('emits a valid EngineMetrics sample every second', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    FakePeerConnection.instances[0]!.simulateConnected();

    await h.clock.advance(500);
    h.engine.composer?.renderFrame(h.clock.now());
    await h.clock.advance(500);
    expect(h.metrics).toHaveLength(1);
    const sample = h.metrics[0]!;
    expect(sample.targetKbps).toBe(4500 + 160);
    expect(sample.targetFps).toBe(30);
    expect(sample.renderFps).toBe(1);
    expect(sample.encodedKbps).toBeGreaterThanOrEqual(0);
    expect(sample.networkDroppedPct).toBe(0);
    expect(sample.encoderDroppedPct).toBe(0);
    expect(sample.updatedAt).toBe(1000);

    await h.clock.advance(2000);
    expect(h.metrics).toHaveLength(3);
  });

  it('computes encodedKbps from the outbound-rtp bytesSent delta', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();

    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', bytesSent: 0, packetsSent: 0 } });
    await h.clock.advance(2000); // first sample (baseline)
    // 1 000 000 bytes over 2s = 4000 kbps
    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', bytesSent: 1_000_000, packetsSent: 1000 } });
    await h.clock.advance(2000);

    const last = h.metrics[h.metrics.length - 1]!;
    expect(last.encodedKbps).toBeCloseTo(4000, 0);
  });

  it('degrades an output above 3% packet loss and recovers it afterwards', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();
    h.outputs.length = 0;

    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', bytesSent: 0, packetsSent: 0 }, r: { type: 'remote-inbound-rtp', packetsLost: 0 } });
    await h.clock.advance(2000);

    // 900 lost out of 10 000 sent = 8.3% loss, with plenty of bitrate.
    pc.setStats({
      v: { type: 'outbound-rtp', kind: 'video', bytesSent: 2_000_000, packetsSent: 10_000 },
      r: { type: 'remote-inbound-rtp', packetsLost: 900 },
    });
    await h.clock.advance(2000);
    const degraded = h.outputs.find((e) => e.type === 'outputDegraded');
    expect(degraded).toMatchObject({ destinationId: 'whip' });
    expect((degraded as { technical?: string }).technical).toContain('loss');

    pc.setStats({
      v: { type: 'outbound-rtp', kind: 'video', bytesSent: 4_000_000, packetsSent: 20_000 },
      r: { type: 'remote-inbound-rtp', packetsLost: 900 },
    });
    await h.clock.advance(2000);
    expect(h.outputs.some((e) => e.type === 'outputRecovered')).toBe(true);
  });

  it('degrades an output whose bitrate collapses below half the target', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();
    h.outputs.length = 0;

    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', bytesSent: 0, packetsSent: 0 } });
    await h.clock.advance(2000);
    // 100 000 bytes over 2s = 400 kbps, way under half of 4660.
    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', bytesSent: 100_000, packetsSent: 500, qualityLimitationReason: 'bandwidth' } });
    await h.clock.advance(2000);

    const degraded = h.outputs.find((e) => e.type === 'outputDegraded');
    expect((degraded as { technical?: string }).technical).toContain('limited by bandwidth');
  });

  it('derives encoderDroppedPct from framesSent/framesDropped', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    const pc = FakePeerConnection.instances[0]!;
    pc.simulateConnected();

    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', framesSent: 0, framesDropped: 0, bytesSent: 0, packetsSent: 0 } });
    await h.clock.advance(2000);
    pc.setStats({ v: { type: 'outbound-rtp', kind: 'video', framesSent: 90, framesDropped: 10, bytesSent: 5_000_000, packetsSent: 5000 } });
    await h.clock.advance(2000);

    expect(h.metrics[h.metrics.length - 1]!.encoderDroppedPct).toBeCloseTo(10, 1);
  });

  it('falls back to MediaRecorder chunk sizes when there is no WHIP sender', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([], true));
    const recorder = FakeMediaRecorder.instances[0]!;

    await h.clock.advance(1000); // baseline
    recorder.emitChunk(500_000); // 500 000 bytes in the next second = 4000 kbps
    await h.clock.advance(1000);

    const last = h.metrics[h.metrics.length - 1]!;
    expect(last.encodedKbps).toBeCloseTo(4000, 0);
  });

  it('stops emitting metrics once the production stops', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([output('whip', 'whip')]));
    await h.clock.advance(1000);
    expect(h.metrics).toHaveLength(1);
    await h.engine.stop();
    h.metrics.length = 0;
    await h.clock.advance(5000);
    expect(h.metrics).toHaveLength(0);
  });
});

describe('BrowserEngine recording', () => {
  beforeEach(() => {
    FakePeerConnection.reset();
    FakeMediaRecorder.reset();
  });

  it('records the program stream in MP4/H.264 with 1s timeslices', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([], true));

    expect(h.recordings).toEqual([{ state: 'started' }]);
    const recorder = FakeMediaRecorder.instances[0]!;
    expect(recorder.options?.mimeType).toBe('video/mp4;codecs=avc1');
    expect(recorder.timeslice).toBe(1000);
    expect(recorder.stream).toBe(h.engine.previewStream);
    expect(recorder.state).toBe('recording');
  });

  it('collects chunks and returns a Blob from stopRecording', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([], true));
    const recorder = FakeMediaRecorder.instances[0]!;
    recorder.emitChunk(1024);
    recorder.emitChunk(2048);

    const result = await h.engine.stopRecording();
    expect(h.recordings.map((r) => r.state)).toEqual(['started', 'stopped']);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(recorder.state).toBe('inactive');
  });

  it('streams chunks to an onChunk sink instead of buffering them', async () => {
    const chunks: Array<{ size: number; index: number }> = [];
    const h = harness({ onChunk: (chunk, index) => chunks.push({ size: chunk.size, index }) });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([], true));
    FakeMediaRecorder.instances[0]!.emitChunk(4096);
    FakeMediaRecorder.instances[0]!.emitChunk(8192);

    expect(chunks).toEqual([
      { size: 4096, index: 0 },
      { size: 8192, index: 1 },
    ]);
    const result = await h.engine.stopRecording();
    expect(result.blob).toBeUndefined();
  });

  it('prefers WebM when the container asks for it', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.startRecording({ enabled: true, container: 'webm', source: 'program' });
    expect(FakeMediaRecorder.instances[0]!.options?.mimeType).toBe('video/webm;codecs=vp9');
  });

  it('reports RECORDING_FAILED when MediaRecorder is unavailable', async () => {
    const h = harness({ MediaRecorderCtor: null });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.startRecording({ enabled: true, container: 'mp4', source: 'program' });
    expect(h.recordings).toEqual([{ state: 'failed', code: 'RECORDING_FAILED' }]);
  });

  it('reports RECORDING_FAILED when the recorder constructor throws', async () => {
    class Exploding {
      constructor() {
        throw new Error('unsupported mime');
      }
      static isTypeSupported(): boolean {
        return true;
      }
    }
    const h = harness({ MediaRecorderCtor: Exploding as unknown as never });
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.startRecording({ enabled: true, container: 'mp4', source: 'program' });
    expect(h.recordings[0]).toMatchObject({ state: 'failed' });
  });

  it('stopRecording without a recorder is a no-op', async () => {
    const h = harness();
    expect(await h.engine.stopRecording()).toEqual({});
    expect(h.recordings).toHaveLength(0);
  });

  it('stop() also stops the recorder', async () => {
    const h = harness();
    await h.engine.startPreview(cameraMoment(), '16:9');
    await h.engine.start(request([], true));
    await h.engine.stop();
    expect(h.recordings.map((r) => r.state)).toEqual(['started', 'stopped']);
  });
});

describe('BrowserEngine helpers', () => {
  it('relayEndpoint maps aspect ratios to relay paths', () => {
    expect(relayEndpoint('https://relay.test/whip', '16:9')).toBe('https://relay.test/whip/16x9');
    expect(relayEndpoint('https://relay.test/whip/', '9:16')).toBe('https://relay.test/whip/9x16');
    expect(relayEndpoint('https://relay.test/whip///', '1:1')).toBe('https://relay.test/whip/1x1');
  });

  it('readOutboundSample sums the video sender and its remote report', () => {
    const report = new Map<string, unknown>([
      ['a', { type: 'outbound-rtp', kind: 'video', bytesSent: 100, packetsSent: 10, framesSent: 30, framesDropped: 1 }],
      ['b', { type: 'outbound-rtp', kind: 'audio', bytesSent: 999, packetsSent: 999 }],
      ['c', { type: 'remote-inbound-rtp', packetsLost: 4 }],
      ['d', { type: 'candidate-pair' }],
      ['e', null],
    ]);
    const sample = readOutboundSample(report, 1234);
    expect(sample).toMatchObject({ at: 1234, bytesSent: 100, packetsSent: 10, packetsLost: 4, framesSent: 30, framesDropped: 1 });
  });

  it('readOutboundSample falls back to framesEncoded and records the limitation reason', () => {
    const report = new Map<string, unknown>([
      ['a', { type: 'outbound-rtp', kind: 'video', framesEncoded: 50, qualityLimitationReason: 'cpu' }],
      ['b', { type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'none' }],
    ]);
    const sample = readOutboundSample(report, 0);
    expect(sample.framesSent).toBe(50);
    expect(sample.qualityLimitationReason).toBe('cpu');
  });

  it('readOutboundSample tolerates a missing or malformed report', () => {
    expect(readOutboundSample(undefined, 5).bytesSent).toBe(0);
    expect(readOutboundSample({}, 5).at).toBe(5);
  });

  it('pickRecordingMime prefers MP4/H.264 then WebM and honours the container', () => {
    const ctor = { isTypeSupported: (t: string) => t.startsWith('video/webm') } as unknown as never;
    expect(pickRecordingMime(ctor)).toBe('video/webm;codecs="vp9,opus"');
    expect(pickRecordingMime(null)).toBeNull();
    const none = { isTypeSupported: () => false } as unknown as never;
    expect(pickRecordingMime(none)).toBeNull();
    const noProbe = {} as unknown as never;
    expect(pickRecordingMime(noProbe)).toBe('');
  });

  it('the fake WHIP answer is a valid SDP so the engine tests exercise the real parser', () => {
    expect(FAKE_ANSWER_SDP).toContain('v=0');
  });
});
