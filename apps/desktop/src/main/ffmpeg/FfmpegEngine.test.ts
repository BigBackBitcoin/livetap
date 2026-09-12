import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DesktopEngineEvent, DesktopStartRequest } from '../../shared/ipc.js';
import { FfmpegEngine, containerForMime, mimeCarriesH264 } from './FfmpegEngine.js';
import type { HardwareReport } from './hardware.js';

/* ------------------------------------------------------------- fake spawn */

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: string | null;
  argv: string[];
  killed: string[];
  kill(signal?: string): boolean;
  /** Simulate the process exiting. */
  exit(code: number): void;
}

let nextPid = 1000;
const spawned: FakeChild[] = [];

function makeChild(argv: string[]): FakeChild {
  const emitter = new EventEmitter() as FakeChild;
  emitter.pid = nextPid++;
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.argv = argv;
  emitter.killed = [];
  emitter.kill = (signal = 'SIGTERM') => {
    emitter.killed.push(signal);
    // Real ffmpeg exits on SIGTERM, so the fake does too. Without this the engine would sit out its
    // full terminate timeout in every test that stops a process.
    emitter.exit(signal === 'SIGKILL' ? 137 : 0);
    return true;
  };
  emitter.exit = (code: number) => {
    if (emitter.exitCode !== null) return;
    emitter.exitCode = code;
    emitter.emit('close', code);
  };
  // Keep stdout/stderr flowing so PassThrough buffers do not fill.
  emitter.stdin.resume();
  return emitter;
}

const fakeSpawn = ((_command: string, argv: readonly string[]) => {
  const child = makeChild([...argv]);
  spawned.push(child);
  return child as unknown as ChildProcessWithoutNullStreams;
}) as unknown as typeof spawn;

/** The encoder process is whichever fake child has `pipe:1` as its last argument. */
const encoderChildren = (): FakeChild[] => spawned.filter((c) => c.argv[c.argv.length - 1] === 'pipe:1');
const senderChildren = (): FakeChild[] => spawned.filter((c) => c.argv.includes('flv') || c.argv.includes('whip'));
const recorderChildren = (): FakeChild[] => spawned.filter((c) => c.argv.includes('-movflags'));

const hardware: HardwareReport = {
  ffmpegPath: 'ffmpeg',
  ffmpegVersion: 'ffmpeg version test',
  working: [{ encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 10 }],
  all: [
    { encoder: 'h264_nvenc', kind: 'nvenc', status: 'UNAVAILABLE', detail: 'no GPU', elapsedMs: 5 },
    { encoder: 'libx264', kind: 'software', status: 'PASS', elapsedMs: 10 },
  ],
  recommended: 'libx264',
  hardwareKinds: [],
};

const format = {
  aspectRatio: '16:9' as const,
  width: 1920,
  height: 1080,
  fps: 30 as const,
  videoKbps: 4500,
  audioKbps: 160,
  codec: 'h264' as const,
  keyframeIntervalSeconds: 2,
};

function request(overrides: Partial<DesktopStartRequest> = {}): DesktopStartRequest {
  return {
    source: { kind: 'pipe', mimeType: 'video/webm;codecs=h264,opus' },
    formats: { '16:9': format },
    outputs: [
      {
        destinationId: 'dest-a',
        aspectRatio: '16:9',
        ingest: { protocol: 'rtmp', url: 'rtmp://a.example/live', streamKey: 'key-a' },
      },
      {
        destinationId: 'dest-b',
        aspectRatio: '16:9',
        ingest: { protocol: 'rtmps', url: 'rtmps://b.example/live', streamKey: 'key-b' },
      },
    ],
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: false, container: 'mp4', source: 'program' },
    ...overrides,
  };
}

let dir: string;
let engine: FfmpegEngine;
let events: DesktopEngineEvent[];

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  spawned.length = 0;
  dir = mkdtempSync(path.join(os.tmpdir(), 'livetap-engine-'));
  events = [];
  engine = new FfmpegEngine({
    ffmpegPath: 'ffmpeg',
    recordingsDir: path.join(dir, 'recordings'),
    spawnFn: fakeSpawn,
    hardwareReport: hardware,
    cpuSampling: false,
    metricsIntervalMs: 100_000, // never fires during a test
  });
  engine.on((event) => events.push(event));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('FfmpegEngine.capabilities', () => {
  it('reports PASS only because libx264 actually encoded, and reports no hardware', async () => {
    const capabilities = await engine.capabilities();
    expect(capabilities.verification).toBe('PASS');
    expect(capabilities.rtmp).toBe(true);
    expect(capabilities.srt).toBe(true);
    expect(capabilities.recording).toBe(true);
    // The compiled-in nvenc must NOT be advertised, because the probe failed.
    expect(capabilities.hardwareEncoders).toEqual([]);
    expect(capabilities.maxFormats).toBe(3);
  });

  it('reports UNAVAILABLE, not PASS, when no encoder works', async () => {
    const broken = new FfmpegEngine({
      ffmpegPath: 'ffmpeg',
      recordingsDir: dir,
      spawnFn: fakeSpawn,
      hardwareReport: { ...hardware, working: [], all: [], recommended: 'libx264', hardwareKinds: [] },
    });
    const capabilities = await broken.capabilities();
    expect(capabilities.verification).toBe('UNAVAILABLE');
    expect(capabilities.rtmp).toBe(false);
  });
});

describe('FfmpegEngine.start', () => {
  it('starts exactly ONE encoder for two destinations on the same aspect ratio', async () => {
    const result = await engine.start(request());
    expect(result.ok).toBe(true);
    expect(encoderChildren()).toHaveLength(1);
    expect(senderChildren()).toHaveLength(2);
    const diagnostics = engine.diagnostics();
    expect(diagnostics.encoders).toHaveLength(1);
    expect(diagnostics.senders).toHaveLength(2);
    expect(diagnostics.encoders[0]?.sinks).toBe(2);
  });

  it('copies video when the renderer produced H.264 — the single-encode claim', async () => {
    await engine.start(request());
    const encoder = encoderChildren()[0];
    expect(encoder?.argv.join(' ')).toContain('-c:v copy');
    expect(encoder?.argv.join(' ')).not.toContain('libx264');
    expect(engine.diagnostics().encoders[0]?.videoPassthrough).toBe(true);
  });

  it('transcodes once when the renderer could only produce VP9', async () => {
    await engine.start(request({ source: { kind: 'pipe', mimeType: 'video/webm;codecs=vp9,opus' } }));
    const encoder = encoderChildren()[0];
    expect(encoder?.argv.join(' ')).toContain('-c:v libx264');
    expect(engine.diagnostics().encoders[0]?.videoPassthrough).toBe(false);
  });

  it('starts one encoder per aspect ratio, not per destination', async () => {
    await engine.start(
      request({
        formats: { '16:9': format, '9:16': { ...format, aspectRatio: '9:16', width: 1080, height: 1920 } },
        outputs: [
          {
            destinationId: 'yt',
            aspectRatio: '16:9',
            ingest: { protocol: 'rtmp', url: 'rtmp://a.example/live', streamKey: 'k1' },
          },
          {
            destinationId: 'twitch',
            aspectRatio: '16:9',
            ingest: { protocol: 'rtmp', url: 'rtmp://b.example/live', streamKey: 'k2' },
          },
          {
            destinationId: 'tiktok',
            aspectRatio: '9:16',
            ingest: { protocol: 'rtmp', url: 'rtmp://c.example/live', streamKey: 'k3' },
          },
        ],
      }),
    );
    // 3 destinations, 2 aspect ratios → 2 encodes.
    expect(encoderChildren()).toHaveLength(2);
    expect(senderChildren()).toHaveLength(3);
  });

  it('never uses a shell and never concatenates a command line', async () => {
    await engine.start(request());
    for (const child of spawned) {
      expect(Array.isArray(child.argv)).toBe(true);
      expect(child.argv.length).toBeGreaterThan(3);
    }
  });

  it('skips an invalid destination and keeps the rest live', async () => {
    const result = await engine.start(
      request({
        outputs: [
          {
            destinationId: 'good',
            aspectRatio: '16:9',
            ingest: { protocol: 'rtmp', url: 'rtmp://a.example/live', streamKey: 'k' },
          },
          // No stream key: core validateIngest refuses it.
          { destinationId: 'bad', aspectRatio: '16:9', ingest: { protocol: 'rtmp', url: 'rtmp://b.example/live' } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.errors?.join(' ')).toContain('bad');
    expect(senderChildren()).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'outputLost', destinationId: 'bad', code: 'CONFIG_INVALID' })]),
    );
  });

  it('refuses a second start', async () => {
    await engine.start(request());
    expect(await engine.start(request())).toEqual({ ok: false, errors: ['Engine is already running.'] });
  });

  it('refuses a request with no formats', async () => {
    const result = await engine.start(request({ formats: {}, outputs: [] }));
    expect(result.ok).toBe(false);
  });
});

describe('FfmpegEngine fan-out', () => {
  it('sends every encoder byte to both senders', async () => {
    await engine.start(request());
    const encoder = encoderChildren()[0];
    const senders = senderChildren();
    const received = senders.map(() => 0);
    senders.forEach((sender, index) => {
      sender.stdin.on('data', (chunk: Buffer) => {
        received[index] = (received[index] ?? 0) + chunk.length;
      });
    });

    const packet = Buffer.alloc(188, 0x11);
    packet[0] = 0x47;
    for (let i = 0; i < 10; i += 1) encoder?.stdout.write(packet);
    await flush();

    expect(received[0]).toBe(1880);
    expect(received[1]).toBe(1880);
  });

  it('pushes renderer chunks into the encoder stdin unchanged', async () => {
    await engine.start(request());
    const encoder = encoderChildren()[0];
    const written: Buffer[] = [];
    encoder?.stdin.on('data', (chunk: Buffer) => written.push(chunk));
    engine.pushChunk('16:9', new Uint8Array([1, 2, 3, 4]));
    engine.pushChunk('16:9', new Uint8Array([5, 6]));
    await flush();
    expect(Buffer.concat(written).equals(Buffer.from([1, 2, 3, 4, 5, 6]))).toBe(true);
    expect(engine.diagnostics().encoders[0]?.inputBytes).toBe(6);
  });

  it('ignores a chunk for an aspect ratio that is not running', async () => {
    await engine.start(request());
    expect(() => engine.pushChunk('9:16', new Uint8Array([1]))).not.toThrow();
    expect(engine.diagnostics().encoders[0]?.inputBytes).toBe(0);
  });

  it('endOfStream closes the encoder stdin so it flushes', async () => {
    await engine.start(request());
    const encoder = encoderChildren()[0];
    engine.endOfStream('16:9');
    await flush();
    expect(encoder?.stdin.writableEnded).toBe(true);
  });
});

describe('FfmpegEngine destination isolation', () => {
  it('one sender dying leaves the encoder and the other sender alone', async () => {
    await engine.start(request());
    const encoder = encoderChildren()[0];
    const [senderA, senderB] = senderChildren();

    senderB?.stderr.write('[flv @ 0x1] rtmps://b.example/live: Broken pipe\n');
    await flush();
    senderB?.exit(1);
    await flush();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'outputLost', destinationId: 'dest-b', code: 'INGEST_DISCONNECTED' }),
      ]),
    );
    expect(encoder?.exitCode).toBeNull();
    expect(senderA?.exitCode).toBeNull();
    expect(engine.diagnostics().senders.map((s) => s.destinationId)).toEqual(['dest-a']);
    expect(engine.diagnostics().encoders[0]?.sinks).toBe(1);
  });

  it('classifies the failure from the sender stderr, not from the exit code', async () => {
    await engine.start(request());
    const senderB = senderChildren()[1];
    senderB?.stderr.write('[tcp @ 0x1] Connection to tcp://b.example:1935 failed: Connection refused\n');
    await flush();
    senderB?.exit(1);
    await flush();
    const lost = events.find((e) => e.type === 'outputLost' && e.destinationId === 'dest-b');
    expect(lost).toMatchObject({ code: 'INGEST_REFUSED' });
  });

  it('defaults to INGEST_DISCONNECTED when a sender dies silently', async () => {
    await engine.start(request());
    senderChildren()[1]?.exit(255);
    await flush();
    const lost = events.find((e) => e.type === 'outputLost' && e.destinationId === 'dest-b');
    expect(lost).toMatchObject({ code: 'INGEST_DISCONNECTED' });
  });

  it('emits outputUp once the sender reports bytes on the wire', async () => {
    await engine.start(request());
    senderChildren()[0]?.stderr.write('frame=30\ntotal_size=131072\nspeed=1.0x\nprogress=continue\n');
    await flush();
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'outputUp', destinationId: 'dest-a' })]),
    );
    expect(events.filter((e) => e.type === 'outputUp' && e.destinationId === 'dest-a')).toHaveLength(1);
  });

  it('reports degraded then recovered from the sender speed', async () => {
    await engine.start(request());
    const sender = senderChildren()[0];
    sender?.stderr.write('total_size=131072\nspeed=1.0x\nprogress=continue\n');
    await flush();
    sender?.stderr.write('total_size=140000\nspeed=0.55x\nprogress=continue\n');
    await flush();
    sender?.stderr.write('total_size=160000\nspeed=1.0x\nprogress=continue\n');
    await flush();
    const types = events
      .filter((e) => 'destinationId' in e && e.destinationId === 'dest-a')
      .map((e) => e.type);
    expect(types).toEqual(['outputUp', 'outputDegraded', 'outputRecovered']);
  });

  it('removeOutput is a clean stop, not a loss', async () => {
    await engine.start(request());
    const senderB = senderChildren()[1];
    await engine.removeOutput('dest-b');
    senderB?.exit(0);
    await flush();
    expect(events.some((e) => e.type === 'outputLost' && e.destinationId === 'dest-b')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'outputStopped', destinationId: 'dest-b' })]),
    );
  });

  it('removeOutput on an unknown destination is a no-op', async () => {
    await engine.start(request());
    expect(await engine.removeOutput('nope')).toEqual({ ok: false });
  });

  it('addOutput while live starts one process and does not restart the encoder', async () => {
    await engine.start(request());
    const encoderPid = encoderChildren()[0]?.pid;
    const before = spawned.length;
    const result = await engine.addOutput({
      destinationId: 'dest-c',
      aspectRatio: '16:9',
      ingest: { protocol: 'rtmp', url: 'rtmp://c.example/live', streamKey: 'key-c' },
    });
    expect(result.ok).toBe(true);
    expect(spawned.length).toBe(before + 1);
    expect(encoderChildren()).toHaveLength(1);
    expect(encoderChildren()[0]?.pid).toBe(encoderPid);
    expect(engine.diagnostics().encoders[0]?.sinks).toBe(3);
  });

  it('addOutput refuses a duplicate id and an unvalidated ingest', async () => {
    await engine.start(request());
    expect(
      (
        await engine.addOutput({
          destinationId: 'dest-a',
          aspectRatio: '16:9',
          ingest: { protocol: 'rtmp', url: 'rtmp://x/live', streamKey: 'k' },
        })
      ).ok,
    ).toBe(false);
    const bad = await engine.addOutput({
      destinationId: 'dest-z',
      aspectRatio: '16:9',
      ingest: { protocol: 'rtmp', url: 'rtmp://x/live;id', streamKey: 'k' },
    });
    expect(bad.ok).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ destinationId: 'dest-z', code: 'CONFIG_INVALID' })]),
    );
  });

  it('addOutput refuses an aspect ratio with no encoder', async () => {
    await engine.start(request());
    const result = await engine.addOutput({
      destinationId: 'vertical',
      aspectRatio: '9:16',
      ingest: { protocol: 'rtmp', url: 'rtmp://v/live', streamKey: 'k' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.join(' ')).toContain('9:16');
  });

  it('addOutput before start is refused', async () => {
    const result = await engine.addOutput({
      destinationId: 'x',
      aspectRatio: '16:9',
      ingest: { protocol: 'rtmp', url: 'rtmp://x/live', streamKey: 'k' },
    });
    expect(result.ok).toBe(false);
  });

  it('never logs a stream key — diagnostics are redacted', async () => {
    await engine.start(request());
    const diagnostics = engine.diagnostics();
    const json = JSON.stringify(diagnostics);
    expect(json).not.toContain('key-a');
    expect(json).not.toContain('key-b');
    expect(diagnostics.senders[0]?.ingest.streamKey).toBe('••••ey-a');
  });
});

describe('FfmpegEngine encoder failure', () => {
  it('an encoder dying is an engine error, not a per-destination error', async () => {
    await engine.start(request());
    encoderChildren()[0]?.exit(1);
    await flush();
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'engineError', code: 'ENCODER_FAILED' })]),
    );
  });

  it('maps an encoder stderr failure into an engineError', async () => {
    await engine.start(request());
    encoderChildren()[0]?.stderr.write('[libx264 @ 0x1] Error: cannot open encoder\n');
    await flush();
    expect(events.some((e) => e.type === 'engineError')).toBe(true);
  });
});

describe('FfmpegEngine recording', () => {
  it('records by copying the program stream and reports the path', async () => {
    const result = await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    expect(result.ok).toBe(true);
    expect(recorderChildren()).toHaveLength(1);
    expect(recorderChildren()[0]?.argv.join(' ')).toContain('-c copy');
    expect(recorderChildren()[0]?.argv.join(' ')).toContain('aac_adtstoasc');
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'recording', state: 'started' })]));
    expect(engine.diagnostics().recording).toMatch(/LIVETAP-.*\.mp4$/);
  });

  it('the recorder is just another sink on the same single encode', async () => {
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    // 2 senders + 1 recorder, still one encoder.
    expect(encoderChildren()).toHaveLength(1);
    expect(engine.diagnostics().encoders[0]?.sinks).toBe(3);
  });

  it('stopRecording closes stdin so the muxer finalises the file', async () => {
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    const recorder = recorderChildren()[0];
    const stopped = engine.stopRecording();
    await flush();
    expect(recorder?.stdin.writableEnded).toBe(true);
    recorder?.exit(0);
    const result = await stopped;
    expect(result.ok).toBe(true);
    expect(result.path).toMatch(/\.mp4$/);
  });

  it('a failed recorder does not stop the stream', async () => {
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    recorderChildren()[0]?.exit(1);
    await flush();
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'recording', state: 'failed' })]));
    expect(encoderChildren()[0]?.exitCode).toBeNull();
    expect(engine.diagnostics().senders).toHaveLength(2);
  });

  it('refuses to record twice and refuses to record when idle', async () => {
    expect((await engine.startRecording({ enabled: true, container: 'mp4', source: 'program' })).ok).toBe(false);
    await engine.start(request());
    expect((await engine.startRecording({ enabled: true, container: 'mp4', source: 'program' })).ok).toBe(true);
    expect((await engine.startRecording({ enabled: true, container: 'mp4', source: 'program' })).ok).toBe(false);
  });

  it('stopRecording when not recording is a no-op', async () => {
    expect(await engine.stopRecording()).toEqual({ ok: false });
  });
});

describe('FfmpegEngine.metrics', () => {
  it('derives metrics from the encoder progress block', async () => {
    await engine.start(request());
    encoderChildren()[0]?.stderr.write(
      'frame=300\nfps=29.9\nbitrate=4610.5kbits/s\ndrop_frames=3\nspeed=1.0x\nprogress=continue\n',
    );
    await flush();
    const metrics = engine.metrics();
    expect(metrics.encodedKbps).toBeCloseTo(4610.5, 1);
    expect(metrics.renderFps).toBeCloseTo(29.9, 1);
    expect(metrics.targetFps).toBe(30);
    expect(metrics.targetKbps).toBe(4660); // 4500 video + 160 audio
    expect(metrics.encoderDroppedPct).toBeCloseTo((3 / 303) * 100, 3);
    expect(metrics.networkDroppedPct).toBe(0);
  });

  it('reports zeroes rather than guesses before any progress arrives', async () => {
    await engine.start(request());
    const metrics = engine.metrics();
    expect(metrics.encodedKbps).toBe(0);
    expect(metrics.cpuPct).toBeUndefined();
  });
});

describe('FfmpegEngine.stop', () => {
  it('stops senders and encoders and clears state', async () => {
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    const children = [...spawned];
    const stopping = engine.stop();
    await flush();
    for (const child of children) child.exit(0);
    expect(await stopping).toEqual({ ok: true });
    expect(engine.diagnostics().senders).toHaveLength(0);
    expect(engine.diagnostics().encoders).toHaveLength(0);
    expect(engine.diagnostics().running).toBe(false);
  });

  it('stop when idle is a no-op', async () => {
    expect(await engine.stop()).toEqual({ ok: false });
  });

  it('an encoder exiting during stop is not reported as a failure', async () => {
    await engine.start(request());
    const children = [...spawned];
    const stopping = engine.stop();
    await flush();
    for (const child of children) child.exit(1);
    await stopping;
    expect(events.some((e) => e.type === 'engineError')).toBe(false);
  });
});

describe('FfmpegEngine listeners', () => {
  it('unsubscribes cleanly', async () => {
    const seen: DesktopEngineEvent[] = [];
    const off = engine.on((event) => seen.push(event));
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    expect(seen.length).toBeGreaterThan(0);
    const count = seen.length;
    off();
    senderChildren()[0]?.exit(1);
    await flush();
    expect(seen.length).toBe(count);
  });

  it('a throwing listener does not break the others', async () => {
    const seen: string[] = [];
    engine.on(() => {
      throw new Error('listener bug');
    });
    engine.on((event) => seen.push(event.type));
    await engine.start(request({ recording: { enabled: true, container: 'mp4', source: 'program' } }));
    expect(seen).toContain('recording');
  });
});

describe('mime helpers', () => {
  it("knows Chromium's H.264 recording is Matroska, not WebM", () => {
    // isTypeSupported('video/webm;codecs=h264') is true but recorder.mimeType comes back as
    // 'video/x-matroska;codecs=avc1' — measured on Electron 38.8.6.
    expect(containerForMime('video/webm;codecs=h264,opus')).toBe('matroska');
    expect(containerForMime('video/x-matroska;codecs=avc1,opus')).toBe('matroska');
    expect(containerForMime('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(containerForMime('video/mp4;codecs=avc1.42E01E')).toBe('mp4');
  });

  it('detects H.264 under all its spellings', () => {
    expect(mimeCarriesH264('video/webm;codecs=h264')).toBe(true);
    expect(mimeCarriesH264('video/webm;codecs=avc1')).toBe(true);
    expect(mimeCarriesH264('video/mp4;codecs=avc3.640028')).toBe(true);
    expect(mimeCarriesH264('video/webm;codecs=vp8,opus')).toBe(false);
    expect(mimeCarriesH264('video/webm;codecs=av01')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SECURITY REVIEW 2026-09 — SEC-D3: a stream key must never reach a log line,
// an event payload or the diagnostics export.
//
// This failed before the fix: `spawnChild` logged `argv.join(' ')` at `info`,
// and main configures electron-log's FILE transport at `info`, so every
// go-live wrote `rtmp://a.example/live/key-a` into main.log on disk.
// ---------------------------------------------------------------------------

interface CapturedLog {
  level: string;
  message: string;
  meta: string;
}

function capturingEngine(): { engine: FfmpegEngine; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  const record = (level: string) => (message: string, meta?: Record<string, unknown>) => {
    logs.push({ level, message, meta: JSON.stringify(meta ?? {}) });
  };
  const captured = new FfmpegEngine({
    ffmpegPath: 'ffmpeg',
    recordingsDir: path.join(dir, 'recordings'),
    spawnFn: fakeSpawn,
    hardwareReport: hardware,
    cpuSampling: false,
    metricsIntervalMs: 100_000,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
  });
  return { engine: captured, logs };
}

const allText = (logs: CapturedLog[]): string => logs.map((l) => `${l.level} ${l.message} ${l.meta}`).join('\n');

describe('SEC-D3 stream keys never reach the engine log', () => {
  it('redacts the publish URL in the spawn argv log line', async () => {
    const { engine: captured, logs } = capturingEngine();
    await captured.start(request());
    const text = allText(logs);

    expect(text).not.toContain('key-a');
    expect(text).not.toContain('key-b');
    expect(text).not.toContain('rtmp://a.example/live/key-a');
    // The log is still useful: the host and the redaction marker are both there.
    expect(text).toContain('rtmp://a.example/live/');
    expect(text).toContain('••••');
    // Sanity: the key really was passed to the child process, so the test is
    // proving redaction and not merely that the key was never used.
    expect(spawned.some((c) => c.argv.some((a) => a.includes('key-a')))).toBe(true);

    // Mirror the existing stop pattern: the fake children do not exit on
    // stdin.end(), so tell them to, or stop() sits out its 4 s timeouts.
    const stopping = captured.stop();
    for (const child of spawned) child.exit(0);
    await stopping;
  });

  it('redacts an FFmpeg stderr line that echoes the publish URL', async () => {
    const { engine: captured, logs } = capturingEngine();
    await captured.start(request());
    const sender = senderChildren()[0];
    expect(sender).toBeDefined();
    sender?.stderr.write('rtmp://a.example/live/key-a: Input/output error\n');
    await flush();
    await flush();

    const text = allText(logs);
    expect(text).not.toContain('key-a');
    expect(text).toContain('••••');

    // ...and the text handed onward (toasts, diagnostics) is redacted too.
    const senders = captured.diagnostics().senders;
    expect(JSON.stringify(senders)).not.toContain('key-a');

    // Mirror the existing stop pattern: the fake children do not exit on
    // stdin.end(), so tell them to, or stop() sits out its 4 s timeouts.
    const stopping = captured.stop();
    for (const child of spawned) child.exit(0);
    await stopping;
  });

  it('never puts a key in an emitted event, including engineError technicals', async () => {
    const { engine: captured, logs } = capturingEngine();
    const seen: DesktopEngineEvent[] = [];
    captured.on((e) => seen.push(e));
    await captured.start(request());
    const encoder = encoderChildren()[0];
    encoder?.stderr.write('Error opening output rtmp://a.example/live/key-a: Broken pipe\n');
    await flush();
    await flush();

    expect(JSON.stringify(seen)).not.toContain('key-a');
    expect(allText(logs)).not.toContain('key-a');

    // Mirror the existing stop pattern: the fake children do not exit on
    // stdin.end(), so tell them to, or stop() sits out its 4 s timeouts.
    const stopping = captured.stop();
    for (const child of spawned) child.exit(0);
    await stopping;
  });

  it('keeps the diagnostics export free of keys and passphrases', async () => {
    const { engine: captured } = capturingEngine();
    await captured.start(
      request({
        outputs: [
          {
            destinationId: 'dest-srt',
            aspectRatio: '16:9',
            ingest: {
              protocol: 'srt',
              url: 'srt://h.example:9000',
              streamId: 'sid1234',
              passphrase: 'p4ssphrase',
            },
          },
        ],
      }),
    );
    const json = JSON.stringify(captured.diagnostics());
    expect(json).not.toContain('p4ssphrase');
    // Mirror the existing stop pattern: the fake children do not exit on
    // stdin.end(), so tell them to, or stop() sits out its 4 s timeouts.
    const stopping = captured.stop();
    for (const child of spawned) child.exit(0);
    await stopping;
  });
});
