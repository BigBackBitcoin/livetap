/**
 * DesktopEngine - the renderer half of the desktop pipeline, and the cable that was never plugged in.
 *
 * The Electron main process already contains a verified RTMP publisher (FfmpegEngine + argv.ts +
 * fanout.ts) and the preload already exposes `engine.start / pushChunk / addOutput / removeOutput /
 * endOfStream / stop`. Nothing in the renderer ever called any of it, so on desktop the app could
 * not push a single byte: `packages/media` offered only BrowserEngine (WHIP, which no platform
 * ingest speaks) and MockEngine (a simulation). This class is the missing implementation.
 *
 *   getUserMedia ─▶ <video> ─▶ FormatRenderer (one canvas per aspect) ─▶ captureStream
 *        ─▶ MediaRecorder per aspect (H.264 when Chromium offers it)
 *        ─▶ window.livetap.engine.pushChunk(aspect, bytes)
 *        ─▶ main: ffmpeg -f matroska -i pipe:0 -c:v copy ─▶ fan-out ─▶ one RTMP sender per destination
 *
 * Two rules this file exists to keep:
 *
 * 1. ONE ENCODE PER ASPECT RATIO, and it is the RIGHT encode. A 9:16 destination gets the 9:16
 *    canvas, composed with the Moment's own 9:16 placements, never the master canvas at a smaller
 *    bitrate. `FormatRenderer.streamFor` returns null rather than substituting, and an output whose
 *    aspect was never composed fails loudly with CONFIG_INVALID.
 *
 * 2. CHUNKS ARRIVE IN ORDER. `Blob.arrayBuffer()` is async, so two timeslices resolving out of
 *    order would interleave Matroska clusters and corrupt the stream for the rest of the
 *    broadcast. Every aspect has its own serialised send queue, and `stop()` drains it before
 *    telling main the stream ended.
 */
import { TypedEmitter, formatForPreset } from '@livetap/core';
import type {
  AspectRatio,
  EngineCapabilities,
  EngineEvents,
  EngineOutput,
  EngineStartRequest,
  ErrorCode,
  IngestTarget,
  MediaEngine,
  Moment,
  EncoderSettings,
  OutputFormat,
  RecordingSettings,
} from '@livetap/core';
import { FormatRenderer } from '../compositor/FormatRenderer.js';
import { LocalSources } from '../sources/LocalSources.js';
import { cloneMoment } from '../browser/BrowserEngine.js';
import { resolveDeps, type BrowserEngineOptions, type MediaRecorderLike, type ResolvedDeps } from '../browser/deps.js';
import { RECORDER_TIMESLICE_MS, probeRecorderSupport, recorderOptions, type RecorderSupport } from './diagnostics.js';

/* ------------------------------------------------------------------ bridge */

/**
 * The preload bridge, described structurally.
 *
 * `packages/media` must not import from `apps/desktop` (the dependency runs the other way), so the
 * contract is restated here. It is kept identical to `LivetapApi['engine']` in
 * `apps/desktop/src/shared/ipc.ts`; the desktop package's own typecheck is what proves they agree.
 */
export interface DesktopHostOutput {
  destinationId: string;
  aspectRatio: AspectRatio;
  ingest: IngestTarget;
}

export interface DesktopHostStartRequest {
  source: { kind: 'pipe'; mimeType: string } | { kind: 'lavfi'; durationSeconds?: number };
  formats: Partial<Record<AspectRatio, OutputFormat>>;
  outputs: DesktopHostOutput[];
  encoder: EncoderSettings;
  recording: RecordingSettings;
}

export type DesktopHostEvent =
  | { type: 'metrics'; payload: EngineEvents['metrics'] }
  | { type: 'outputUp'; destinationId: string }
  | { type: 'outputDegraded'; destinationId: string; technical?: string }
  | { type: 'outputRecovered'; destinationId: string }
  | { type: 'outputLost'; destinationId: string; code: ErrorCode; technical?: string }
  | { type: 'outputStopped'; destinationId: string }
  | { type: 'engineError'; code: ErrorCode; technical?: string }
  | { type: 'recording'; state: 'started' | 'stopped' | 'failed'; path?: string; code?: ErrorCode };

export interface DesktopEngineBridge {
  capabilities(): Promise<EngineCapabilities>;
  start(req: DesktopHostStartRequest): Promise<{ ok: boolean; errors?: string[] }>;
  addOutput(output: DesktopHostOutput): Promise<{ ok: boolean; errors?: string[] }>;
  removeOutput(destinationId: string): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  startRecording(settings: RecordingSettings): Promise<{ ok: boolean; path?: string; errors?: string[] }>;
  stopRecording(): Promise<{ ok: boolean; path?: string }>;
  pushChunk(aspectRatio: AspectRatio, data: ArrayBuffer): void;
  endOfStream(aspectRatio: AspectRatio): void;
  onEvent(cb: (event: DesktopHostEvent) => void): () => void;
}

export interface DesktopEngineOptions extends BrowserEngineOptions {
  /** The preload bridge. Defaults to `window.livetap.engine`. */
  bridge?: DesktopEngineBridge | null;
  /** Recorder capability probe. Injectable so a test can force the VP9 fallback path. */
  probeSupport?: (width: number, height: number, bitrate: number, framerate: number) => Promise<RecorderSupport>;
  /** MediaRecorder timeslice, ms. Default 1000 (~330 KB a chunk at 1080p30, measured). */
  timesliceMs?: number;
}

interface RecorderEntry {
  aspect: AspectRatio;
  recorder: MediaRecorderLike;
  mimeType: string;
  /** Serialises Blob -> ArrayBuffer -> pushChunk so clusters cannot overtake each other. */
  queue: Promise<void>;
  bytes: number;
  stopped: boolean;
}

const CHUNK_UNREADABLE = 'This browser produced a recording chunk that cannot be read as bytes';

export class DesktopEngine extends TypedEmitter<EngineEvents> implements MediaEngine {
  readonly kind = 'ffmpeg' as const;

  private readonly deps: ResolvedDeps;
  private readonly bridge: DesktopEngineBridge | null;
  private readonly probe: (width: number, height: number, bitrate: number, framerate: number) => Promise<RecorderSupport>;
  private readonly timesliceMs: number;

  private readonly sources: LocalSources;
  private readonly renderer: FormatRenderer;

  private masterAspect: AspectRatio = '16:9';
  private formats: Partial<Record<AspectRatio, OutputFormat>> = {};
  private activeMoment: Moment | null = null;
  private previewing = false;
  private running = false;

  private readonly recorders = new Map<AspectRatio, RecorderEntry>();
  private readonly outputs = new Map<string, EngineOutput>();
  private offEvent: (() => void) | null = null;
  private support: RecorderSupport | null = null;
  private reportedUnreadableChunk = false;

  constructor(options: DesktopEngineOptions = {}) {
    super();
    this.deps = resolveDeps(options);
    this.bridge = options.bridge !== undefined ? options.bridge : defaultBridge();
    this.probe = options.probeSupport ?? probeRecorderSupport;
    this.timesliceMs = options.timesliceMs ?? RECORDER_TIMESLICE_MS;

    this.sources = new LocalSources({
      deps: this.deps,
      ...(options.keepSourceWarmMs !== undefined ? { keepSourceWarmMs: options.keepSourceWarmMs } : {}),
      callbacks: {
        deviceLost: (kind, deviceId) => this.emit('deviceLost', deviceId === undefined ? { kind } : { kind, deviceId }),
        engineError: (code, technical) => this.emit('engineError', { code, technical }),
        layerUnavailable: (layerId, reason) => this.markLayerUnavailable(layerId, reason),
      },
    });

    this.renderer = new FormatRenderer({
      createCanvas: this.deps.createCanvas,
      resolver: this.sources.resolve,
      audioTracks: () => this.audioTracks(),
      now: this.deps.now,
      ...(this.deps.raf ? { raf: this.deps.raf } : {}),
      ...(this.deps.caf ? { caf: this.deps.caf } : {}),
      setTimeoutFn: this.deps.setTimeoutFn,
      clearTimeoutFn: this.deps.clearTimeoutFn,
    });
  }

  // ---------------------------------------------------------------- capabilities

  /**
   * Main answers for the network and the encoders; the renderer answers for capture. A machine
   * whose ffmpeg publishes fine but whose renderer has no MediaRecorder cannot broadcast, and this
   * has to say so rather than inheriting main's PASS.
   */
  async capabilities(): Promise<EngineCapabilities> {
    const host = await this.bridge?.capabilities().catch(() => null);
    const hasDevices = this.deps.mediaDevices !== null;
    const hasRecorder = this.deps.MediaRecorderCtor !== null;
    const base: EngineCapabilities = host ?? {
      camera: hasDevices,
      microphone: hasDevices,
      screen: this.deps.getDisplayMedia !== null,
      window: this.deps.getDisplayMedia !== null,
      systemAudio: this.sources.systemAudioObserved,
      rtmp: false,
      srt: false,
      whip: false,
      recording: false,
      hardwareEncoders: [],
      maxFormats: 3,
      verification: 'UNAVAILABLE',
    };
    const capturable = hasDevices && hasRecorder;
    return {
      ...base,
      camera: base.camera && hasDevices,
      microphone: base.microphone && hasDevices,
      screen: base.screen && this.deps.getDisplayMedia !== null,
      window: base.window && this.deps.getDisplayMedia !== null,
      // Evidence, not a guess: raised only when a display capture really produced an audio track.
      systemAudio: this.sources.systemAudioObserved,
      verification: capturable ? base.verification : 'UNAVAILABLE',
    };
  }

  /** Extra, non-contract detail for the Pro diagnostics panel. */
  describeEnvironment(): { recorderMimeType: string | null; h264: boolean; bridgeAvailable: boolean; aspects: AspectRatio[] } {
    return {
      recorderMimeType: this.support?.chosen ?? null,
      h264: this.support?.h264 === true,
      bridgeAvailable: this.bridge !== null,
      aspects: this.renderer.aspects,
    };
  }

  // ---------------------------------------------------------------- preview

  get previewStream(): MediaStream | null {
    return this.renderer.streamFor(this.masterAspect);
  }

  get isPreviewing(): boolean {
    return this.previewing;
  }

  /** The master-aspect compositor, exposed so the UI can read renderFps or mirror the canvas. */
  get composer(): FormatRenderer {
    return this.renderer;
  }

  async startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void> {
    this.masterAspect = masterAspect;
    this.activeMoment = cloneMoment(moment);
    this.renderer.setFormats(this.formats, masterAspect, this.formatFor(masterAspect));
    await this.sources.sync(this.activeMoment);
    this.renderer.setMoment(this.activeMoment, this.deps.now(), { kind: 'cut', durationMs: 0 });
    this.renderer.start();
    this.previewing = true;
  }

  async stopPreview(): Promise<void> {
    this.previewing = false;
    this.renderer.stop();
    this.renderer.releaseStreams();
    this.sources.stopAll();
  }

  /** Point a <video> element at the composited master preview. */
  attachPreview(videoEl: HTMLVideoElement | null | undefined): void {
    if (!videoEl) return;
    try {
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      const stream = this.renderer.streamFor(this.masterAspect);
      if (stream) videoEl.srcObject = stream;
      const played = videoEl.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      /* preview attachment is best effort */
    }
  }

  async setMoment(moment: Moment): Promise<void> {
    const next = cloneMoment(moment);
    this.activeMoment = next;
    await this.sources.sync(next);
    this.renderer.setMoment(next, this.deps.now());
    this.sources.refreshGains(next);
  }

  // ---------------------------------------------------------------- live

  async start(req: EngineStartRequest): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) {
      // Not a crash: every output fails with the same humane reason and the app stays up.
      this.failEverything(req.outputs, 'CONFIG_INVALID', 'The desktop media bridge is not available in this window');
      return;
    }

    this.formats = compactFormats(req.formats);
    const master = this.formatFor(this.masterAspect);
    this.renderer.setFormats(this.formats, this.masterAspect, master);
    if (!this.previewing && this.activeMoment) {
      await this.startPreview(this.activeMoment, this.masterAspect);
    } else {
      this.renderer.start();
    }

    const support = await this.probe(master.width, master.height, master.videoKbps * 1000, master.fps).catch(() => null);
    this.support = support;
    if (!support || support.chosen === null) {
      this.failEverything(req.outputs, 'ENCODER_FAILED', 'MediaRecorder cannot produce a stream in this build');
      return;
    }

    // Aspects we can actually compose. An output asking for anything else is refused by name below
    // rather than being handed the master picture, which is the silent wrong-aspect broadcast bug.
    const encodable = this.renderer.aspects.filter((aspect) => this.formats[aspect] !== undefined);
    const usable = req.outputs.filter((output) => encodable.includes(output.aspectRatio));
    for (const output of req.outputs) {
      if (usable.includes(output)) continue;
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: `No ${output.aspectRatio} picture was composed for this broadcast`,
      });
    }

    const hostFormats: Partial<Record<AspectRatio, OutputFormat>> = {};
    for (const aspect of encodable) {
      const format = this.formats[aspect];
      if (format) hostFormats[aspect] = format;
    }

    let result: { ok: boolean; errors?: string[] };
    try {
      result = await bridge.start({
        source: { kind: 'pipe', mimeType: support.chosen },
        formats: hostFormats,
        outputs: usable.map((o) => ({ destinationId: o.destinationId, aspectRatio: o.aspectRatio, ingest: o.ingest })),
        encoder: req.encoder,
        recording: req.recording,
      });
    } catch (err) {
      this.failEverything(usable, 'ENCODER_FAILED', describe(err));
      return;
    }
    if (!result.ok) {
      this.failEverything(usable, 'ENCODER_FAILED', result.errors?.join('; ') ?? 'The media engine refused to start');
      return;
    }

    this.running = true;
    for (const output of usable) this.outputs.set(output.destinationId, output);
    this.listen();

    // Recorders start only after main has an encoder waiting on the other end of the pipe: a chunk
    // that arrives before the ffmpeg process exists is a chunk dropped mid-container.
    for (const aspect of encodable) {
      const format = this.formats[aspect];
      if (!format) continue;
      this.startRecorder(aspect, format, support.chosen);
    }
    if (result.errors && result.errors.length > 0) {
      this.emit('engineError', { code: 'ENCODER_FAILED', technical: result.errors.join('; ') });
    }
  }

  async addOutput(output: EngineOutput): Promise<void> {
    const bridge = this.bridge;
    if (!bridge || !this.running) {
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: 'The media engine is not running',
      });
      return;
    }
    if (!this.recorders.has(output.aspectRatio)) {
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: `No ${output.aspectRatio} picture is being encoded in this broadcast`,
      });
      return;
    }
    this.outputs.set(output.destinationId, output);
    const result = await bridge
      .addOutput({ destinationId: output.destinationId, aspectRatio: output.aspectRatio, ingest: output.ingest })
      .catch((err: unknown) => ({ ok: false, errors: [describe(err)] }));
    if (!result.ok) {
      this.outputs.delete(output.destinationId);
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'INGEST_REFUSED',
        technical: result.errors?.join('; ') ?? 'The sender could not be started',
      });
    }
  }

  async removeOutput(destinationId: string): Promise<void> {
    this.outputs.delete(destinationId);
    await this.bridge?.removeOutput(destinationId).catch(() => undefined);
  }

  /** Stop every output and encoder. The preview keeps running. */
  async stop(): Promise<void> {
    this.running = false;
    const bridge = this.bridge;
    await this.stopRecorders();
    this.outputs.clear();
    this.offEvent?.();
    this.offEvent = null;
    await bridge?.stop().catch(() => undefined);
  }

  // ---------------------------------------------------------------- recording

  async startRecording(settings: RecordingSettings): Promise<void> {
    const result = await this.bridge?.startRecording(settings).catch(() => ({ ok: false }));
    if (!result?.ok) this.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
  }

  async stopRecording(): Promise<{ path?: string; blob?: Blob }> {
    const result = await this.bridge?.stopRecording().catch(() => ({ ok: false, path: undefined }));
    return result?.path !== undefined ? { path: result.path } : {};
  }

  // ---------------------------------------------------------------- encoders

  private startRecorder(aspect: AspectRatio, format: OutputFormat, mimeType: string): void {
    const Ctor = this.deps.MediaRecorderCtor;
    const stream = this.renderer.streamFor(aspect);
    if (!Ctor || !stream) {
      this.failOutputsFor(aspect, 'ENCODER_FAILED', `No ${aspect} stream could be captured from the compositor`);
      return;
    }
    const entry: RecorderEntry = {
      aspect,
      recorder: null as unknown as MediaRecorderLike,
      mimeType,
      queue: Promise.resolve(),
      bytes: 0,
      stopped: false,
    };
    try {
      const recorder = new Ctor(stream, recorderOptions(mimeType, format.videoKbps, format.audioKbps));
      entry.recorder = recorder;
      recorder.ondataavailable = (event) => this.onChunk(entry, event?.data);
      recorder.onerror = () => {
        this.failOutputsFor(aspect, 'ENCODER_FAILED', `The ${aspect} recorder stopped unexpectedly`);
      };
      recorder.onstop = () => {
        entry.stopped = true;
      };
      recorder.start(this.timesliceMs);
      this.recorders.set(aspect, entry);
    } catch (err) {
      this.failOutputsFor(aspect, 'ENCODER_FAILED', describe(err));
    }
  }

  /**
   * One timeslice. The blob is converted and forwarded on this aspect's own promise chain, so the
   * bytes reach ffmpeg's stdin in exactly the order MediaRecorder produced them.
   */
  private onChunk(entry: RecorderEntry, blob: Blob | undefined): void {
    const bridge = this.bridge;
    if (!bridge || !blob || typeof blob.size !== 'number' || blob.size === 0) return;
    if (typeof blob.arrayBuffer !== 'function') {
      if (!this.reportedUnreadableChunk) {
        this.reportedUnreadableChunk = true;
        this.emit('engineError', { code: 'ENCODER_FAILED', technical: CHUNK_UNREADABLE });
      }
      return;
    }
    entry.bytes += blob.size;
    entry.queue = entry.queue
      .then(async () => {
        const buffer = await blob.arrayBuffer();
        if (buffer.byteLength === 0) return;
        bridge.pushChunk(entry.aspect, buffer);
      })
      .catch((err: unknown) => {
        this.emit('engineError', { code: 'ENCODER_FAILED', technical: describe(err) });
      });
  }

  /** Stop each recorder, wait for its queued bytes, then tell main the stream ended. */
  private async stopRecorders(): Promise<void> {
    const entries = Array.from(this.recorders.values());
    this.recorders.clear();
    for (const entry of entries) {
      try {
        entry.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const entry of entries) {
      await entry.queue.catch(() => undefined);
      this.bridge?.endOfStream(entry.aspect);
    }
  }

  // ---------------------------------------------------------------- events

  /** Main's engine events become MediaEngine events, one to one. */
  private listen(): void {
    if (this.offEvent || !this.bridge) return;
    this.offEvent = this.bridge.onEvent((event) => {
      switch (event.type) {
        case 'metrics':
          // renderFps comes from the compositor, not from ffmpeg: main only sees how fast it is
          // remuxing, while the number a creator needs is how fast the picture is being drawn.
          this.emit('metrics', { ...event.payload, renderFps: this.renderer.renderFps });
          return;
        case 'engineError':
          this.emit('engineError', event.technical === undefined ? { code: event.code } : { code: event.code, technical: event.technical });
          return;
        case 'recording':
          this.emit('recording', {
            state: event.state,
            ...(event.path !== undefined ? { path: event.path } : {}),
            ...(event.code !== undefined ? { code: event.code } : {}),
          });
          return;
        case 'outputUp':
          this.emit('output', { type: 'outputUp', destinationId: event.destinationId });
          return;
        case 'outputRecovered':
          this.emit('output', { type: 'outputRecovered', destinationId: event.destinationId });
          return;
        case 'outputStopped':
          this.emit('output', { type: 'outputStopped', destinationId: event.destinationId });
          return;
        case 'outputDegraded':
          this.emit('output', {
            type: 'outputDegraded',
            destinationId: event.destinationId,
            ...(event.technical !== undefined ? { technical: event.technical } : {}),
          });
          return;
        case 'outputLost':
          this.emit('output', {
            type: 'outputLost',
            destinationId: event.destinationId,
            code: event.code,
            ...(event.technical !== undefined ? { technical: event.technical } : {}),
          });
          return;
      }
    });
  }

  // ---------------------------------------------------------------- helpers

  private audioTracks(): MediaStreamTrack[] {
    const mixed = this.sources.buildAudioMix(this.activeMoment);
    return mixed?.getAudioTracks?.() ?? [];
  }

  /**
   * A layer whose source died is hidden and the reason is recorded for the UI. It is deliberately
   * NOT painted into the program: "Camera disconnected" is a sentence for the operator.
   */
  private markLayerUnavailable(layerId: string, reason: string): void {
    if (this.activeMoment && layerId !== '__mic__') {
      const updated: Moment = {
        ...this.activeMoment,
        layers: this.activeMoment.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: false } : layer)),
      };
      this.activeMoment = updated;
      this.renderer.setMoment(updated, this.deps.now(), { kind: 'cut', durationMs: 0 });
    }
    this.renderer.setNotice(reason);
  }

  private failEverything(outputs: readonly EngineOutput[], code: ErrorCode, technical: string): void {
    this.emit('engineError', { code, technical });
    for (const output of outputs) {
      this.emit('output', { type: 'outputLost', destinationId: output.destinationId, code, technical });
    }
  }

  private failOutputsFor(aspect: AspectRatio, code: ErrorCode, technical: string): void {
    this.emit('engineError', { code, technical });
    for (const output of this.outputs.values()) {
      if (output.aspectRatio !== aspect) continue;
      this.emit('output', { type: 'outputLost', destinationId: output.destinationId, code, technical });
    }
  }

  private formatFor(aspect: AspectRatio): OutputFormat {
    return this.formats[aspect] ?? formatForPreset('1080p30', aspect);
  }
}

// -------------------------------------------------------------------- helpers

function defaultBridge(): DesktopEngineBridge | null {
  const host = (globalThis as unknown as { window?: { livetap?: { engine?: DesktopEngineBridge } } }).window;
  return host?.livetap?.engine ?? null;
}

function compactFormats(formats: Record<AspectRatio, OutputFormat | undefined>): Partial<Record<AspectRatio, OutputFormat>> {
  const out: Partial<Record<AspectRatio, OutputFormat>> = {};
  for (const aspect of ['16:9', '9:16', '1:1'] as AspectRatio[]) {
    const format = formats?.[aspect];
    if (format) out[aspect] = format;
  }
  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
