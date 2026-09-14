// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AspectRatio,
  EngineCapabilities,
  EngineOutput,
  EngineOutputEvent,
  EngineStartRequest,
  Layer,
  Moment,
} from '@livetap/core';
import { DEFAULT_AUDIO, formatForPreset } from '@livetap/core';
import { DesktopEngine } from './DesktopEngine.js';
import type { DesktopEngineBridge, DesktopHostEvent, DesktopHostOutput, DesktopHostStartRequest } from './DesktopEngine.js';
import type { RecorderSupport } from './diagnostics.js';
import type { MediaDevicesLike } from '../browser/deps.js';
import {
  FakeMediaRecorder,
  asMediaRecorderCtor,
  asMediaStream,
  createFakeCanvas,
  createFakeMediaStream,
  createFakeTrack,
  createFakeVideoSource,
} from '../testing/fakes.js';

// ------------------------------------------------------------------ harness

interface PushedChunk {
  aspectRatio: AspectRatio;
  bytes: Uint8Array;
}

/** A stand-in for `window.livetap.engine` that records everything the renderer asks main to do. */
function createFakeBridge(overrides: Partial<DesktopEngineBridge> = {}) {
  const starts: DesktopHostStartRequest[] = [];
  const added: DesktopHostOutput[] = [];
  const removed: string[] = [];
  const chunks: PushedChunk[] = [];
  const endsOfStream: AspectRatio[] = [];
  let stops = 0;
  let emit: ((event: DesktopHostEvent) => void) | null = null;

  const capabilities: EngineCapabilities = {
    camera: true,
    microphone: true,
    screen: true,
    window: true,
    systemAudio: true,
    rtmp: true,
    srt: true,
    whip: true,
    recording: true,
    hardwareEncoders: [],
    maxFormats: 3,
    verification: 'PASS',
  };

  const bridge: DesktopEngineBridge = {
    capabilities: async () => capabilities,
    start: async (req) => {
      starts.push(req);
      return { ok: true };
    },
    addOutput: async (output) => {
      added.push(output);
      return { ok: true };
    },
    removeOutput: async (destinationId) => {
      removed.push(destinationId);
      return { ok: true };
    },
    stop: async () => {
      stops += 1;
      return { ok: true };
    },
    startRecording: async () => ({ ok: true, path: 'C:/recordings/a.mp4' }),
    stopRecording: async () => ({ ok: true, path: 'C:/recordings/a.mp4' }),
    pushChunk: (aspectRatio, data) => {
      chunks.push({ aspectRatio, bytes: new Uint8Array(data) });
    },
    endOfStream: (aspectRatio) => {
      endsOfStream.push(aspectRatio);
    },
    onEvent: (cb) => {
      emit = cb;
      return () => {
        emit = null;
      };
    },
    ...overrides,
  };

  return {
    bridge,
    starts,
    added,
    removed,
    chunks,
    endsOfStream,
    stopCount: () => stops,
    emit: (event: DesktopHostEvent) => emit?.(event),
    isListening: () => emit !== null,
  };
}

const H264 = 'video/x-matroska;codecs=avc1,opus';

function support(chosen: string | null = H264): RecorderSupport {
  return {
    supported: {},
    chosen,
    h264: chosen !== null && /avc1|h264/.test(chosen),
    hardwareRelief: chosen !== null && /avc1|h264/.test(chosen),
    webCodecs: { available: false, h264Configs: {} },
  };
}

function harness(options: { bridge?: ReturnType<typeof createFakeBridge>; chosen?: string | null } = {}) {
  const host = options.bridge ?? createFakeBridge();
  const canvases: Array<ReturnType<typeof createFakeCanvas>> = [];
  const cameraStream = createFakeMediaStream([createFakeTrack('video')]);
  const micStream = createFakeMediaStream([createFakeTrack('audio')]);
  const constraints: MediaStreamConstraints[] = [];
  const mediaDevices: MediaDevicesLike = {
    getUserMedia: async (c) => {
      constraints.push(c);
      return c.video ? asMediaStream(cameraStream) : asMediaStream(micStream);
    },
  };

  const engine = new DesktopEngine({
    bridge: host.bridge,
    mediaDevices,
    getDisplayMedia: null,
    MediaRecorderCtor: asMediaRecorderCtor(FakeMediaRecorder),
    RTCPeerConnectionCtor: null,
    fetch: null,
    AudioContextCtor: null,
    VideoEncoderProbe: null,
    createCanvas: (width, height) => {
      const fake = createFakeCanvas(width, height);
      canvases.push(fake);
      return fake.canvas;
    },
    createVideoElement: () => createFakeVideoSource(1280, 720),
    probeSupport: async () => support(options.chosen === undefined ? H264 : options.chosen),
    now: () => 0,
    raf: () => 0,
    caf: () => undefined,
  });

  const outputs: EngineOutputEvent[] = [];
  const errors: Array<{ code: string; technical?: string }> = [];
  const metrics: Array<{ renderFps: number; encodedKbps: number }> = [];
  engine.on('output', (event) => outputs.push(event));
  engine.on('engineError', (payload) => errors.push(payload));
  engine.on('metrics', (sample) => metrics.push({ renderFps: sample.renderFps, encodedKbps: sample.encodedKbps }));

  return { engine, host, canvases, constraints, outputs, errors, metrics, cameraStream, micStream };
}

function moment(): Moment {
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
  };
}

function output(destinationId: string, aspectRatio: AspectRatio = '16:9'): EngineOutput {
  return {
    destinationId,
    aspectRatio,
    ingest: { protocol: 'rtmp', url: 'rtmp://127.0.0.1:1935/live', streamKey: 'a' },
  };
}

function request(outputs: EngineOutput[], aspects: AspectRatio[] = ['16:9']): EngineStartRequest {
  return {
    formats: {
      '16:9': aspects.includes('16:9') ? formatForPreset('1080p30', '16:9') : undefined,
      '9:16': aspects.includes('9:16') ? formatForPreset('1080p30', '9:16') : undefined,
      '1:1': aspects.includes('1:1') ? formatForPreset('1080p30', '1:1') : undefined,
    },
    outputs,
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: false, container: 'mp4', source: 'program' },
  };
}

// ------------------------------------------------------------------ tests

describe('DesktopEngine', () => {
  beforeEach(() => {
    FakeMediaRecorder.reset();
  });

  it('reports itself as the ffmpeg engine and merges main capabilities with renderer capture', async () => {
    const h = harness();
    expect(h.engine.kind).toBe('ffmpeg');
    const caps = await h.engine.capabilities();
    expect(caps.rtmp).toBe(true);
    expect(caps.verification).toBe('PASS');
    // No getDisplayMedia in this harness, so screen capture is false whatever main says.
    expect(caps.screen).toBe(false);
    // systemAudio is evidence-only: no display capture has produced an audio track.
    expect(caps.systemAudio).toBe(false);
  });

  it('degrades main PASS to UNAVAILABLE when the renderer has no MediaRecorder', async () => {
    const h = harness();
    const engine = new DesktopEngine({
      bridge: h.host.bridge,
      mediaDevices: { getUserMedia: async () => asMediaStream(createFakeMediaStream()) },
      MediaRecorderCtor: null,
    });
    expect((await engine.capabilities()).verification).toBe('UNAVAILABLE');
  });

  it('opens the camera and composes the master aspect on startPreview', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    expect(h.constraints.some((c) => c.video)).toBe(true);
    expect(h.engine.isPreviewing).toBe(true);
    expect(h.canvases[0]?.canvas.width).toBe(1920);
    expect(h.canvases[0]?.canvas.height).toBe(1080);
  });

  it('tells main the pipe mimeType the renderer actually measured, then feeds it chunks', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));

    expect(h.host.starts).toHaveLength(1);
    expect(h.host.starts[0]?.source).toEqual({ kind: 'pipe', mimeType: H264 });
    expect(h.host.starts[0]?.outputs.map((o) => o.destinationId)).toEqual(['a']);

    const recorder = FakeMediaRecorder.instances[0]!;
    expect(recorder.timeslice).toBe(1000);
    recorder.emitChunk(64, 7);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.host.chunks).toHaveLength(1);
    expect(h.host.chunks[0]?.aspectRatio).toBe('16:9');
    expect(h.host.chunks[0]?.bytes[0]).toBe(7);
  });

  it('keeps chunks in the order MediaRecorder produced them even when one blob resolves late', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    const recorder = FakeMediaRecorder.instances[0]!;

    let releaseFirst = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    // The first chunk's bytes arrive AFTER the second one's would have.
    recorder.emitChunk(8, 1, () => gate);
    recorder.emitChunk(8, 2);
    await Promise.resolve();
    expect(h.host.chunks).toHaveLength(0);

    releaseFirst();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(h.host.chunks.map((c) => c.bytes[0])).toEqual([1, 2]);
  });

  it('runs one encoder per distinct aspect ratio, each fed from its own canvas', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a', '16:9'), output('b', '9:16')], ['16:9', '9:16']));

    expect(Object.keys(h.host.starts[0]?.formats ?? {}).sort()).toEqual(['16:9', '9:16']);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    const sizes = h.canvases.map((c) => `${c.canvas.width}x${c.canvas.height}`);
    expect(sizes).toContain('1920x1080');
    expect(sizes).toContain('1080x1920');

    FakeMediaRecorder.instances[0]!.emitChunk(16, 1);
    FakeMediaRecorder.instances[1]!.emitChunk(16, 2);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(h.host.chunks.map((c) => c.aspectRatio).sort()).toEqual(['16:9', '9:16']);
  });

  it('refuses an output whose aspect ratio was never composed instead of sending the master picture', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a', '16:9'), output('square', '1:1')], ['16:9']));

    expect(h.host.starts[0]?.outputs.map((o) => o.destinationId)).toEqual(['a']);
    expect(h.outputs).toContainEqual({
      type: 'outputLost',
      destinationId: 'square',
      code: 'CONFIG_INVALID',
      technical: 'No 1:1 picture was composed for this broadcast',
    });
  });

  it('fails every output with one humane reason when MediaRecorder cannot produce a stream', async () => {
    const h = harness({ chosen: null });
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a'), output('b')]));

    expect(h.host.starts).toHaveLength(0);
    expect(h.outputs.filter((e) => e.type === 'outputLost')).toHaveLength(2);
    expect(h.errors[0]?.code).toBe('ENCODER_FAILED');
  });

  it('fails every output when the desktop bridge is missing rather than throwing', async () => {
    const engine = new DesktopEngine({ bridge: null, MediaRecorderCtor: asMediaRecorderCtor(FakeMediaRecorder) });
    const seen: EngineOutputEvent[] = [];
    engine.on('output', (event) => seen.push(event));
    await engine.start(request([output('a')]));
    expect(seen).toEqual([
      {
        type: 'outputLost',
        destinationId: 'a',
        code: 'CONFIG_INVALID',
        technical: 'The desktop media bridge is not available in this window',
      },
    ]);
  });

  it('fails every output when main refuses to start', async () => {
    const host = createFakeBridge({ start: async () => ({ ok: false, errors: ['ffmpeg is not installed'] }) });
    const h = harness({ bridge: host });
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    expect(h.outputs).toEqual([
      { type: 'outputLost', destinationId: 'a', code: 'ENCODER_FAILED', technical: 'ffmpeg is not installed' },
    ]);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('maps every main-process engine event onto the MediaEngine channels', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));

    h.host.emit({ type: 'outputUp', destinationId: 'a' });
    h.host.emit({ type: 'outputDegraded', destinationId: 'a', technical: 'bitrate below target' });
    h.host.emit({ type: 'outputRecovered', destinationId: 'a' });
    h.host.emit({ type: 'outputLost', destinationId: 'a', code: 'INGEST_DISCONNECTED' });
    h.host.emit({ type: 'engineError', code: 'ENCODER_OVERLOADED', technical: 'stdin not draining' });

    expect(h.outputs).toEqual([
      { type: 'outputUp', destinationId: 'a' },
      { type: 'outputDegraded', destinationId: 'a', technical: 'bitrate below target' },
      { type: 'outputRecovered', destinationId: 'a' },
      { type: 'outputLost', destinationId: 'a', code: 'INGEST_DISCONNECTED' },
    ]);
    expect(h.errors).toContainEqual({ code: 'ENCODER_OVERLOADED', technical: 'stdin not draining' });
  });

  it('reports the compositor render rate, not ffmpeg remux rate, as renderFps', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    h.engine.composer.compositorFor('16:9')?.renderFrame(0);
    h.engine.composer.compositorFor('16:9')?.renderFrame(0);

    h.host.emit({
      type: 'metrics',
      payload: {
        encodedKbps: 4200,
        targetKbps: 4660,
        encoderDroppedPct: 0,
        networkDroppedPct: 0,
        renderFps: 0,
        targetFps: 30,
        updatedAt: 0,
      },
    });
    expect(h.metrics[0]).toEqual({ renderFps: 2, encodedKbps: 4200 });
  });

  it('refuses addOutput for an aspect ratio that is not being encoded', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    h.outputs.length = 0;

    await h.engine.addOutput(output('square', '1:1'));
    expect(h.host.added).toHaveLength(0);
    expect(h.outputs).toEqual([
      {
        type: 'outputLost',
        destinationId: 'square',
        code: 'CONFIG_INVALID',
        technical: 'No 1:1 picture is being encoded in this broadcast',
      },
    ]);
  });

  it('adds a matching output through the bridge', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    await h.engine.addOutput(output('b'));
    expect(h.host.added.map((o) => o.destinationId)).toEqual(['b']);
  });

  it('drains queued bytes and closes the pipe before stopping the engine', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    await h.engine.start(request([output('a')]));
    FakeMediaRecorder.instances[0]!.emitChunk(32, 9);

    await h.engine.stop();

    expect(h.host.chunks).toHaveLength(1);
    expect(h.host.endsOfStream).toEqual(['16:9']);
    expect(h.host.stopCount()).toBe(1);
    // Stopping the broadcast never stops the preview: the creator keeps seeing themselves.
    expect(h.engine.isPreviewing).toBe(true);
  });

  it('hides a dead camera layer and records the reason without painting it into the frame', async () => {
    const h = harness();
    await h.engine.startPreview(moment(), '16:9');
    const deviceLost: Array<{ kind: string }> = [];
    h.engine.on('deviceLost', (payload) => deviceLost.push(payload));

    h.cameraStream.getTracks()[0]!.end();

    expect(deviceLost).toEqual([{ kind: 'camera', deviceId: 'default' }]);
    expect(h.engine.composer.getNotice()).toBe('Camera disconnected');
    h.canvases[0]!.calls.length = 0;
    h.engine.composer.compositorFor('16:9')?.renderFrame(0);
    expect(h.canvases[0]!.texts()).not.toContain('Camera disconnected');
  });
});
