/**
 * BrowserEngine - the MediaEngine implementation for the web app and mobile WebViews.
 *
 * Pipeline: getUserMedia / getDisplayMedia -> <video> elements -> MomentCompositor (2D canvas)
 *           -> canvas.captureStream() + WebAudio mix -> WHIP (WebRTC) and/or MediaRecorder.
 *
 * Honest limits (see docs/architecture/MEDIA_ENGINE.md):
 * - A browser cannot speak RTMP/RTMPS/SRT. Those outputs either need the desktop app or the
 *   WHIP relay (MediaMTX) configured through `relay`.
 * - One encode per format: the canvas is captured once and fanned out to every WHIP session.
 * - Browser layers need Electron/webview; the compositor draws a labelled placeholder instead.
 */
import { TypedEmitter, formatForPreset } from '@livetap/core';
import type {
  AspectRatio,
  EngineCapabilities,
  EngineEvents,
  EngineOutput,
  EngineStartRequest,
  ErrorCode,
  Layer,
  MediaEngine,
  Moment,
  OutputFormat,
  RecordingSettings,
} from '@livetap/core';
import { MomentCompositor } from '../compositor/MomentCompositor.js';
import type { CompositorCanvas, DrawableSource } from '../compositor/types.js';
import { WhipClient, WhipError } from '../whip/WhipClient.js';
import {
  pickRecordingMime,
  probablySupportsDisplayAudio,
  resolveDeps,
  type AudioContextLike,
  type BrowserEngineOptions,
  type GainNodeLike,
  type MediaRecorderLike,
  type MediaStreamAudioDestinationLike,
  type RelayOptions,
  type ResolvedDeps,
} from './deps.js';

const RTMP_HINT = 'Browser cannot publish RTMP; use the desktop app or a WHIP relay';
const DEFAULT_WARM_MS = 5000;
const DEFAULT_STATS_MS = 2000;
const DEFAULT_METRICS_MS = 1000;
const LOSS_DEGRADE_PCT = 3;
const BITRATE_DEGRADE_RATIO = 0.5;

type SourceKind = 'camera' | 'screen' | 'window' | 'video';

interface SourceEntry {
  layerId: string;
  kind: SourceKind;
  /** deviceId for cameras, sourceId for screens, src for video layers. */
  key: string;
  stream: MediaStream | null;
  element: HTMLVideoElement | null;
  releaseTimer?: unknown;
}

interface StatsSample {
  at: number;
  bytesSent: number;
  packetsSent: number;
  packetsLost: number;
  framesSent: number;
  framesDropped: number;
  qualityLimitationReason?: string;
}

interface OutputSession {
  output: EngineOutput;
  mode: 'whip' | 'relay' | 'unsupported';
  client?: WhipClient;
  relayAspect?: AspectRatio;
  state: 'connecting' | 'up' | 'degraded' | 'lost' | 'stopped';
  offs: Array<() => void>;
  previous?: StatsSample;
  lossPct: number;
  kbps: number;
  encoderDroppedPct: number;
}

interface RelaySession {
  aspect: AspectRatio;
  client: WhipClient;
  destinationIds: Set<string>;
  connected: boolean;
}

interface StatsReportLike {
  forEach(callback: (value: unknown, key?: unknown) => void): void;
}

export class BrowserEngine extends TypedEmitter<EngineEvents> implements MediaEngine {
  readonly kind = 'browser' as const;

  private readonly deps: ResolvedDeps;
  private readonly relay: RelayOptions | undefined;
  private readonly warmMs: number;
  private readonly statsIntervalMs: number;
  private readonly metricsIntervalMs: number;
  private readonly onChunk: ((chunk: Blob, index: number) => void) | undefined;

  private compositor: MomentCompositor | null = null;
  private canvas: CompositorCanvas | null = null;
  private masterAspect: AspectRatio = '16:9';
  private formats: Partial<Record<AspectRatio, OutputFormat>> = {};
  private activeMoment: Moment | null = null;
  private previewing = false;

  private readonly sources = new Map<string, SourceEntry>();
  private micStream: MediaStream | null = null;
  private micKey: string | null = null;
  private systemAudioStream: MediaStream | null = null;

  private audioContext: AudioContextLike | null = null;
  private audioDestination: MediaStreamAudioDestinationLike | null = null;
  private micGain: GainNodeLike | null = null;
  private systemGain: GainNodeLike | null = null;
  private previewStreamValue: MediaStream | null = null;

  private readonly sessions = new Map<string, OutputSession>();
  private readonly relays = new Map<AspectRatio, RelaySession>();
  private statsTimer: unknown = null;
  private metricsTimer: unknown = null;

  private recorder: MediaRecorderLike | null = null;
  private recordedChunks: Blob[] = [];
  private recordedChunkCount = 0;
  private recordedBytes = 0;
  private lastRecordedBytes = 0;
  private lastRecordedAt = 0;
  private recorderMime = '';
  private recordingStopResolvers: Array<() => void> = [];

  private liveCaptureSucceeded = false;
  private running = false;

  constructor(options: BrowserEngineOptions = {}) {
    super();
    this.deps = resolveDeps(options);
    this.relay = options.relay;
    this.warmMs = options.keepSourceWarmMs ?? DEFAULT_WARM_MS;
    this.statsIntervalMs = options.statsIntervalMs ?? DEFAULT_STATS_MS;
    this.metricsIntervalMs = options.metricsIntervalMs ?? DEFAULT_METRICS_MS;
    this.onChunk = options.onChunk;
  }

  // ---------------------------------------------------------------- capabilities

  async capabilities(): Promise<EngineCapabilities> {
    const hasDevices = this.deps.mediaDevices !== null;
    const hasDisplay = this.deps.getDisplayMedia !== null;
    const recordingMime = pickRecordingMime(this.deps.MediaRecorderCtor);
    const hardwareEncoders: Array<'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'webcodecs'> = [];
    if (await this.probeWebCodecsHardware()) hardwareEncoders.push('webcodecs');
    return {
      camera: hasDevices,
      microphone: hasDevices,
      screen: hasDisplay,
      // getDisplayMedia lets the user pick a window, so window capture rides on the same API.
      window: hasDisplay,
      systemAudio: hasDisplay && probablySupportsDisplayAudio(),
      // Browsers have no RTMP/SRT socket. Only the desktop engine (or the relay) provides these.
      rtmp: false,
      srt: false,
      whip: this.deps.RTCPeerConnectionCtor !== null,
      recording: this.deps.MediaRecorderCtor !== null && recordingMime !== null,
      hardwareEncoders,
      // One canvas capture = one encode. Multi-format needs the relay or the desktop engine.
      maxFormats: 1,
      verification: !hasDevices ? 'UNAVAILABLE' : this.liveCaptureSucceeded ? 'PASS' : 'UNVERIFIED',
    };
  }

  /** Extra, non-contract environment detail for the Pro diagnostics panel. */
  describeEnvironment(): {
    recordingMimeType: string | null;
    relayConfigured: boolean;
    hasAudioMixing: boolean;
    hasCanvasCapture: boolean;
  } {
    return {
      recordingMimeType: pickRecordingMime(this.deps.MediaRecorderCtor),
      relayConfigured: this.relay !== undefined,
      hasAudioMixing: this.deps.AudioContextCtor !== null,
      hasCanvasCapture: typeof this.canvas?.captureStream === 'function',
    };
  }

  private async probeWebCodecsHardware(): Promise<boolean> {
    const probe = this.deps.VideoEncoderProbe;
    if (!probe?.isConfigSupported) return false;
    try {
      const result = await probe.isConfigSupported({
        codec: 'avc1.42E01E',
        width: 1280,
        height: 720,
        bitrate: 2_500_000,
        framerate: 30,
        hardwareAcceleration: 'prefer-hardware',
      });
      return result?.supported === true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- preview

  get previewStream(): MediaStream | null {
    return this.previewStreamValue;
  }

  get isPreviewing(): boolean {
    return this.previewing;
  }

  /** The compositor, exposed so the UI can mirror the canvas or read renderFps. */
  get composer(): MomentCompositor | null {
    return this.compositor;
  }

  async startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void> {
    this.masterAspect = masterAspect;
    const format = this.formatFor(masterAspect);
    this.ensureCompositor(format);
    this.activeMoment = cloneMoment(moment);
    await this.syncSources(this.activeMoment);
    this.compositor?.setMoment(this.activeMoment, this.deps.now(), { kind: 'cut', durationMs: 0 });
    this.compositor?.start(format.fps);
    this.buildPreviewStream(format.fps);
    this.previewing = true;
  }

  async stopPreview(): Promise<void> {
    this.previewing = false;
    this.compositor?.stop();
    for (const entry of Array.from(this.sources.values())) this.releaseSource(entry, true);
    this.sources.clear();
    stopStream(this.micStream);
    this.micStream = null;
    this.micKey = null;
    stopStream(this.systemAudioStream);
    this.systemAudioStream = null;
    this.teardownAudio();
    stopStream(this.previewStreamValue);
    this.previewStreamValue = null;
  }

  /** Point a <video> element at the composited preview. */
  attachPreview(videoEl: HTMLVideoElement | null | undefined): void {
    if (!videoEl) return;
    try {
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      if (this.previewStreamValue) videoEl.srcObject = this.previewStreamValue;
      const played = videoEl.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      /* preview attachment is best effort */
    }
  }

  async setMoment(moment: Moment): Promise<void> {
    const next = cloneMoment(moment);
    this.activeMoment = next;
    await this.syncSources(next);
    this.compositor?.setMoment(next, this.deps.now());
    this.refreshAudioGains(next);
  }

  // ---------------------------------------------------------------- live

  async start(req: EngineStartRequest): Promise<void> {
    this.formats = compactFormats(req.formats);
    const master = this.formatFor(this.masterAspect);
    if (this.compositor) {
      this.compositor.resize(master.width, master.height);
      this.compositor.start(master.fps);
    }
    if (!this.previewing && this.activeMoment) {
      await this.startPreview(this.activeMoment, this.masterAspect);
    }
    this.running = true;

    if (!this.previewStreamValue) {
      // Nothing to publish: report it once, then fail every output individually (never throw).
      this.emit('engineError', {
        code: 'ENCODER_FAILED',
        technical: 'No composited preview stream is available (canvas.captureStream unsupported or preview not started)',
      });
    }

    for (const output of req.outputs) await this.openOutput(output);

    if (req.recording?.enabled) await this.startRecording(req.recording);

    this.startTimers();
  }

  async addOutput(output: EngineOutput): Promise<void> {
    this.running = true;
    await this.openOutput(output);
    this.startTimers();
  }

  async removeOutput(destinationId: string): Promise<void> {
    const session = this.sessions.get(destinationId);
    if (!session) return;
    session.state = 'stopped';
    for (const off of session.offs) off();
    session.offs = [];
    this.sessions.delete(destinationId);
    if (session.mode === 'whip' && session.client) {
      await session.client.close('output removed').catch(() => undefined);
    }
    if (session.mode === 'relay' && session.relayAspect) {
      const relay = this.relays.get(session.relayAspect);
      relay?.destinationIds.delete(destinationId);
      if (relay && relay.destinationIds.size === 0) {
        this.relays.delete(session.relayAspect);
        await relay.client.close('last relay consumer removed').catch(() => undefined);
      }
    }
    this.emit('output', { type: 'outputStopped', destinationId });
    if (this.sessions.size === 0) this.stopTimers();
  }

  /** Stop every output and the recorder. The preview keeps running. */
  async stop(): Promise<void> {
    this.running = false;
    this.stopTimers();
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (!session) continue;
      session.state = 'stopped';
      for (const off of session.offs) off();
      session.offs = [];
      if (session.mode === 'whip' && session.client) {
        await session.client.close('production stopped').catch(() => undefined);
      }
      this.emit('output', { type: 'outputStopped', destinationId: id });
    }
    this.sessions.clear();
    for (const relay of Array.from(this.relays.values())) {
      await relay.client.close('production stopped').catch(() => undefined);
    }
    this.relays.clear();
    if (this.recorder) await this.stopRecording().catch(() => undefined);
  }

  // ---------------------------------------------------------------- outputs

  private async openOutput(output: EngineOutput): Promise<void> {
    const existing = this.sessions.get(output.destinationId);
    if (existing) await this.removeOutput(output.destinationId);

    const protocol = output.ingest.protocol;
    if (protocol === 'whip') {
      await this.openWhipOutput(output);
      return;
    }
    if (!this.relay) {
      // Honest refusal: no silent failure, no throw - the orchestrator gets a humane error.
      this.sessions.set(output.destinationId, blankSession(output, 'unsupported'));
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: `${RTMP_HINT} (protocol: ${protocol})`,
      });
      return;
    }
    await this.openRelayOutput(output);
  }

  private async openWhipOutput(output: EngineOutput): Promise<void> {
    const session = blankSession(output, 'whip');
    this.sessions.set(output.destinationId, session);

    if (!this.deps.RTCPeerConnectionCtor || !this.deps.fetch) {
      this.failOutput(session, 'CONFIG_INVALID', 'WebRTC is not available in this browser');
      return;
    }
    if (!this.previewStreamValue) {
      this.failOutput(session, 'ENCODER_FAILED', 'No composited stream to publish - start the preview first');
      return;
    }
    const format = this.formatFor(output.aspectRatio);
    const client = new WhipClient({
      endpoint: output.ingest.url,
      token: output.ingest.streamKey,
      stream: this.previewStreamValue,
      tracks: this.previewStreamValue?.getTracks() ?? [],
      format,
      RTCPeerConnectionCtor: this.deps.RTCPeerConnectionCtor,
      fetch: this.deps.fetch,
      setTimeoutFn: this.deps.setTimeoutFn,
      clearTimeoutFn: this.deps.clearTimeoutFn,
      now: this.deps.now,
    });
    session.client = client;
    session.offs.push(
      client.on('connected', () => {
        if (session.state === 'stopped') return;
        session.state = 'up';
        this.emit('output', { type: 'outputUp', destinationId: output.destinationId });
      }),
    );
    session.offs.push(
      client.on('disconnected', ({ reason, code }) => {
        if (session.state === 'stopped' || session.state === 'lost') return;
        this.failOutput(session, code, reason);
      }),
    );

    try {
      await client.publish();
    } catch (err) {
      const code = err instanceof WhipError ? err.code : 'INGEST_REFUSED';
      const status = err instanceof WhipError && err.status ? ` (HTTP ${err.status})` : '';
      this.failOutput(session, code, `${describe(err)}${status}`);
    }
  }

  private async openRelayOutput(output: EngineOutput): Promise<void> {
    const relayOptions = this.relay;
    if (!relayOptions) return;
    const session = blankSession(output, 'relay');
    session.relayAspect = output.aspectRatio;
    this.sessions.set(output.destinationId, session);

    if (!this.deps.RTCPeerConnectionCtor || !this.deps.fetch) {
      this.failOutput(session, 'CONFIG_INVALID', 'WebRTC is not available in this browser');
      return;
    }
    if (!this.previewStreamValue) {
      this.failOutput(session, 'ENCODER_FAILED', 'No composited stream to publish - start the preview first');
      return;
    }

    const existing = this.relays.get(output.aspectRatio);
    if (existing) {
      existing.destinationIds.add(output.destinationId);
      if (existing.connected) {
        session.state = 'up';
        this.emit('output', { type: 'outputUp', destinationId: output.destinationId });
      }
      return;
    }

    const format = this.formatFor(output.aspectRatio);
    const client = new WhipClient({
      endpoint: relayEndpoint(relayOptions.whipBaseUrl, output.aspectRatio),
      token: relayOptions.token,
      stream: this.previewStreamValue,
      tracks: this.previewStreamValue?.getTracks() ?? [],
      format,
      RTCPeerConnectionCtor: this.deps.RTCPeerConnectionCtor,
      fetch: this.deps.fetch,
      setTimeoutFn: this.deps.setTimeoutFn,
      clearTimeoutFn: this.deps.clearTimeoutFn,
      now: this.deps.now,
    });
    const relay: RelaySession = {
      aspect: output.aspectRatio,
      client,
      destinationIds: new Set([output.destinationId]),
      connected: false,
    };
    this.relays.set(output.aspectRatio, relay);

    session.offs.push(
      client.on('connected', () => {
        relay.connected = true;
        for (const id of relay.destinationIds) {
          const s = this.sessions.get(id);
          if (!s || s.state === 'stopped') continue;
          s.state = 'up';
          this.emit('output', { type: 'outputUp', destinationId: id });
        }
      }),
    );
    session.offs.push(
      client.on('disconnected', ({ reason, code }) => {
        relay.connected = false;
        for (const id of Array.from(relay.destinationIds)) {
          const s = this.sessions.get(id);
          if (!s || s.state === 'stopped' || s.state === 'lost') continue;
          this.failOutput(s, code, `relay: ${reason}`);
        }
      }),
    );

    try {
      await client.publish();
    } catch (err) {
      const code = err instanceof WhipError ? err.code : 'INGEST_REFUSED';
      this.relays.delete(output.aspectRatio);
      for (const id of Array.from(relay.destinationIds)) {
        const s = this.sessions.get(id);
        if (s) this.failOutput(s, code, `relay: ${describe(err)}`);
      }
    }
  }

  private failOutput(session: OutputSession, code: ErrorCode, technical: string): void {
    if (session.state === 'stopped') return;
    session.state = 'lost';
    this.emit('output', {
      type: 'outputLost',
      destinationId: session.output.destinationId,
      code,
      technical: technical.slice(0, 400),
    });
  }

  // ---------------------------------------------------------------- stats + metrics

  private startTimers(): void {
    if (this.statsTimer === null) this.scheduleStats();
    if (this.metricsTimer === null) this.scheduleMetrics();
  }

  private stopTimers(): void {
    if (this.statsTimer !== null) {
      this.deps.clearTimeoutFn(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.metricsTimer !== null) {
      this.deps.clearTimeoutFn(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  private scheduleStats(): void {
    this.statsTimer = this.deps.setTimeoutFn(() => {
      this.statsTimer = null;
      void this.pollStats().finally(() => {
        if (this.running && this.sessions.size > 0) this.scheduleStats();
      });
    }, this.statsIntervalMs);
  }

  private scheduleMetrics(): void {
    this.metricsTimer = this.deps.setTimeoutFn(() => {
      this.metricsTimer = null;
      this.emitMetrics();
      if (this.running) this.scheduleMetrics();
    }, this.metricsIntervalMs);
  }

  /** Poll every WHIP sender and flag degradation / recovery per output. */
  async pollStats(): Promise<void> {
    const now = this.deps.now();
    for (const session of Array.from(this.sessions.values())) {
      const client = session.mode === 'relay' && session.relayAspect ? this.relays.get(session.relayAspect)?.client : session.client;
      if (!client || session.state === 'stopped' || session.state === 'lost') continue;
      const report = await client.getStats();
      if (!report) continue;
      const sample = readOutboundSample(report, now);
      const previous = session.previous;
      session.previous = sample;
      if (!previous || sample.at <= previous.at) continue;

      const dt = (sample.at - previous.at) / 1000;
      const dBytes = Math.max(0, sample.bytesSent - previous.bytesSent);
      const dSent = Math.max(0, sample.packetsSent - previous.packetsSent);
      const dLost = Math.max(0, sample.packetsLost - previous.packetsLost);
      const dFrames = Math.max(0, sample.framesSent - previous.framesSent);
      const dDropped = Math.max(0, sample.framesDropped - previous.framesDropped);

      session.kbps = dt > 0 ? (dBytes * 8) / 1000 / dt : session.kbps;
      session.lossPct = dSent + dLost > 0 ? (dLost / (dSent + dLost)) * 100 : 0;
      session.encoderDroppedPct = dFrames + dDropped > 0 ? (dDropped / (dFrames + dDropped)) * 100 : 0;

      const format = this.formatFor(session.output.aspectRatio);
      const targetKbps = format.videoKbps + format.audioKbps;
      const starved = session.kbps > 0 && session.kbps < targetKbps * BITRATE_DEGRADE_RATIO;
      const lossy = session.lossPct > LOSS_DEGRADE_PCT;
      const limited = sample.qualityLimitationReason === 'bandwidth' || sample.qualityLimitationReason === 'cpu';

      if ((lossy || starved) && session.state === 'up') {
        session.state = 'degraded';
        this.emit('output', {
          type: 'outputDegraded',
          destinationId: session.output.destinationId,
          technical: `loss ${session.lossPct.toFixed(1)}%, ${Math.round(session.kbps)} of ${targetKbps} kbps${limited ? `, limited by ${sample.qualityLimitationReason}` : ''}`,
        });
      } else if (!lossy && !starved && session.state === 'degraded') {
        session.state = 'up';
        this.emit('output', { type: 'outputRecovered', destinationId: session.output.destinationId });
      }
    }
  }

  /** Emit one EngineMetrics sample. Public so the UI/tests can force a read. */
  emitMetrics(): void {
    const now = this.deps.now();
    const format = this.formatFor(this.masterAspect);
    const targetKbps = format.videoKbps + format.audioKbps;
    const live = Array.from(this.sessions.values()).filter((s) => s.state === 'up' || s.state === 'degraded');

    let encodedKbps = live.reduce((max, s) => Math.max(max, s.kbps), 0);
    if (encodedKbps === 0) encodedKbps = this.recorderKbps(now);

    this.emit('metrics', {
      encodedKbps: round1(encodedKbps),
      targetKbps,
      encoderDroppedPct: round1(live.reduce((max, s) => Math.max(max, s.encoderDroppedPct), 0)),
      networkDroppedPct: round1(live.reduce((max, s) => Math.max(max, s.lossPct), 0)),
      renderFps: this.compositor?.renderFps ?? 0,
      targetFps: format.fps,
      updatedAt: now,
    });
  }

  /** Bitrate derived from MediaRecorder chunk sizes, used when there is no WHIP sender. */
  private recorderKbps(now: number): number {
    if (!this.recorder || this.lastRecordedAt === 0) {
      this.lastRecordedAt = now;
      this.lastRecordedBytes = this.recordedBytes;
      return 0;
    }
    const dt = (now - this.lastRecordedAt) / 1000;
    if (dt <= 0) return 0;
    const dBytes = Math.max(0, this.recordedBytes - this.lastRecordedBytes);
    this.lastRecordedAt = now;
    this.lastRecordedBytes = this.recordedBytes;
    return (dBytes * 8) / 1000 / dt;
  }

  // ---------------------------------------------------------------- recording

  async startRecording(settings: RecordingSettings): Promise<void> {
    const Ctor = this.deps.MediaRecorderCtor;
    if (!Ctor || !this.previewStreamValue) {
      this.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
      return;
    }
    if (this.recorder) return;
    const mime = pickRecordingMime(Ctor, settings.container);
    if (mime === null) {
      this.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
      return;
    }
    const format = this.formatFor(this.masterAspect);
    try {
      const recorder = new Ctor(this.previewStreamValue, {
        mimeType: mime === '' ? undefined : mime,
        videoBitsPerSecond: format.videoKbps * 1000,
        audioBitsPerSecond: format.audioKbps * 1000,
      });
      this.recorder = recorder;
      this.recorderMime = mime === '' ? (recorder.mimeType ?? 'video/webm') : mime;
      this.recordedChunks = [];
      this.recordedChunkCount = 0;
      this.recordedBytes = 0;
      this.lastRecordedBytes = 0;
      this.lastRecordedAt = this.deps.now();
      recorder.ondataavailable = (event) => {
        const data = event?.data;
        if (!data || typeof data.size !== 'number' || data.size === 0) return;
        this.recordedBytes += data.size;
        const index = this.recordedChunkCount;
        this.recordedChunkCount += 1;
        if (this.onChunk) this.onChunk(data, index);
        else this.recordedChunks.push(data);
      };
      recorder.onerror = () => {
        this.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
      };
      recorder.onstop = () => {
        const resolvers = this.recordingStopResolvers;
        this.recordingStopResolvers = [];
        for (const resolve of resolvers) resolve();
      };
      // 1s timeslices keep memory bounded and let `onChunk` stream to storage.
      recorder.start(1000);
      this.emit('recording', { state: 'started' });
    } catch (err) {
      this.recorder = null;
      this.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
      this.emit('engineError', { code: 'RECORDING_FAILED', technical: describe(err) });
    }
  }

  async stopRecording(): Promise<{ path?: string; blob?: Blob }> {
    const recorder = this.recorder;
    if (!recorder) return {};
    this.recorder = null;
    const stopped = new Promise<void>((resolve) => {
      this.recordingStopResolvers.push(resolve);
      // Never hang if the recorder does not fire onstop.
      this.deps.setTimeoutFn(resolve, 500);
    });
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
    await stopped;
    this.emit('recording', { state: 'stopped' });
    const blob = makeBlob(this.recordedChunks, this.recorderMime);
    this.recordedChunks = [];
    return blob ? { blob } : {};
  }

  // ---------------------------------------------------------------- capture

  private ensureCompositor(format: OutputFormat): void {
    if (!this.canvas) {
      this.canvas = this.deps.createCanvas(format.width, format.height);
    }
    if (!this.compositor) {
      this.compositor = new MomentCompositor({
        canvas: this.canvas,
        aspect: this.masterAspect,
        width: format.width,
        height: format.height,
        resolver: (layerId) => this.resolveSource(layerId),
        now: this.deps.now,
        raf: this.deps.raf,
        caf: this.deps.caf,
        setTimeoutFn: this.deps.setTimeoutFn,
        clearTimeoutFn: this.deps.clearTimeoutFn,
      });
      return;
    }
    this.compositor.setAspect(this.masterAspect);
    this.compositor.resize(format.width, format.height);
  }

  private resolveSource(layerId: string): DrawableSource | null {
    return this.sources.get(layerId)?.element ?? null;
  }

  /** Acquire what the Moment needs, keep what it still uses, retire the rest (warm for 5s). */
  private async syncSources(moment: Moment): Promise<void> {
    const needed = new Set<string>();
    for (const layer of moment.layers) {
      if (!layer.visible) continue;
      if (layer.kind === 'camera') {
        needed.add(layer.id);
        await this.acquireCamera(layer.id, layer.deviceId);
      } else if (layer.kind === 'screen' || layer.kind === 'window') {
        needed.add(layer.id);
        await this.acquireDisplay(layer.id, layer.kind, layer.sourceId, layer.captureSystemAudio);
      } else if (layer.kind === 'video') {
        needed.add(layer.id);
        this.acquireVideoFile(layer.id, layer.src, layer.loop, layer.muted);
      }
    }
    for (const entry of Array.from(this.sources.values())) {
      if (needed.has(entry.layerId)) {
        if (entry.releaseTimer !== undefined) {
          this.deps.clearTimeoutFn(entry.releaseTimer);
          entry.releaseTimer = undefined;
        }
        continue;
      }
      this.scheduleRelease(entry);
    }
    await this.acquireMic(moment);
    this.refreshAudioGains(moment);
  }

  private scheduleRelease(entry: SourceEntry): void {
    if (entry.releaseTimer !== undefined) return;
    // Keep the capture warm briefly: tapping between Moments must not flash the camera light.
    entry.releaseTimer = this.deps.setTimeoutFn(() => {
      entry.releaseTimer = undefined;
      if (this.sources.get(entry.layerId) !== entry) return;
      this.releaseSource(entry, true);
      this.sources.delete(entry.layerId);
    }, this.warmMs);
  }

  private releaseSource(entry: SourceEntry, stopTracks: boolean): void {
    if (entry.releaseTimer !== undefined) {
      this.deps.clearTimeoutFn(entry.releaseTimer);
      entry.releaseTimer = undefined;
    }
    if (stopTracks) stopStream(entry.stream);
    try {
      if (entry.element) entry.element.srcObject = null;
    } catch {
      /* ignore */
    }
  }

  private async acquireCamera(layerId: string, deviceId: string): Promise<void> {
    const existing = this.sources.get(layerId);
    if (existing && existing.kind === 'camera' && existing.key === deviceId && hasLiveTrack(existing.stream)) return;
    const devices = this.deps.mediaDevices;
    if (!devices) return;
    if (existing) {
      this.releaseSource(existing, true);
      this.sources.delete(layerId);
    }
    try {
      const stream = await devices.getUserMedia({
        video: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      this.registerSource(layerId, 'camera', deviceId, stream);
      this.watchTracks(stream, 'camera', layerId, deviceId);
      this.liveCaptureSucceeded = true;
    } catch (err) {
      this.emit('deviceLost', { kind: 'camera', deviceId });
      this.emit('engineError', { code: 'CAMERA_LOST', technical: describe(err) });
      this.markLayerUnavailable(layerId, 'Camera unavailable');
    }
  }

  private async acquireDisplay(
    layerId: string,
    kind: 'screen' | 'window',
    sourceId: string,
    captureSystemAudio: boolean,
  ): Promise<void> {
    const existing = this.sources.get(layerId);
    if (existing && existing.key === sourceId && hasLiveTrack(existing.stream)) return;
    const getDisplayMedia = this.deps.getDisplayMedia;
    if (!getDisplayMedia) {
      this.emit('deviceLost', { kind: 'screen' });
      this.markLayerUnavailable(layerId, 'Screen sharing not supported');
      return;
    }
    if (existing) {
      this.releaseSource(existing, true);
      this.sources.delete(layerId);
    }
    try {
      // Lazily prompted: only when a Moment actually shows a screen layer.
      const stream = await getDisplayMedia({ video: true, audio: captureSystemAudio });
      this.registerSource(layerId, kind, sourceId, stream);
      this.watchTracks(stream, 'screen', layerId, sourceId);
      const audio = stream.getAudioTracks?.() ?? [];
      if (captureSystemAudio && audio.length > 0) this.systemAudioStream = stream;
      this.liveCaptureSucceeded = true;
    } catch (err) {
      this.emit('deviceLost', { kind: 'screen' });
      this.emit('engineError', { code: 'SCREEN_DENIED', technical: describe(err) });
      this.markLayerUnavailable(layerId, 'Screen sharing stopped');
    }
  }

  private acquireVideoFile(layerId: string, src: string, loop: boolean, muted: boolean): void {
    const existing = this.sources.get(layerId);
    if (existing && existing.key === src) return;
    const element = this.deps.createVideoElement();
    if (!element) return;
    try {
      element.src = src;
      element.loop = loop;
      element.muted = muted;
      element.autoplay = true;
      element.playsInline = true;
      const played = element.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      /* a video file that will not play shows the placeholder panel */
    }
    this.sources.set(layerId, { layerId, kind: 'video', key: src, stream: null, element });
  }

  private registerSource(layerId: string, kind: SourceKind, key: string, stream: MediaStream): void {
    const element = this.deps.createVideoElement();
    if (element) {
      try {
        element.srcObject = stream;
        element.muted = true;
        element.autoplay = true;
        element.playsInline = true;
        const played = element.play?.();
        if (played && typeof played.catch === 'function') played.catch(() => undefined);
      } catch {
        /* happy-dom and old WebViews may not implement play(); drawing still works */
      }
    }
    this.sources.set(layerId, { layerId, kind, key, stream, element });
  }

  private watchTracks(stream: MediaStream, kind: 'camera' | 'mic' | 'screen', layerId: string, deviceId?: string): void {
    const tracks = stream.getTracks?.() ?? [];
    for (const track of tracks) {
      try {
        track.onended = () => this.handleTrackEnded(kind, layerId, deviceId);
      } catch {
        /* fakes may not allow assigning onended */
      }
    }
  }

  /** A device vanished (unplugged, or the user hit "Stop sharing"). Preview must survive. */
  private handleTrackEnded(kind: 'camera' | 'mic' | 'screen', layerId: string, deviceId?: string): void {
    this.emit('deviceLost', { kind, deviceId });
    if (kind === 'mic') {
      stopStream(this.micStream);
      this.micStream = null;
      this.micKey = null;
      this.compositor?.setNotice('Microphone disconnected');
      return;
    }
    const entry = this.sources.get(layerId);
    if (entry) {
      this.releaseSource(entry, true);
      this.sources.delete(layerId);
    }
    this.markLayerUnavailable(layerId, kind === 'camera' ? 'Camera disconnected' : 'Screen sharing stopped');
  }

  /**
   * Hide a layer whose source died and show the reason on the canvas.
   * The compositor keeps rendering, so the program output never goes black.
   */
  private markLayerUnavailable(layerId: string, notice: string): void {
    if (this.activeMoment) {
      const updated: Moment = {
        ...this.activeMoment,
        layers: this.activeMoment.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: false } : layer)),
      };
      this.activeMoment = updated;
      this.compositor?.setMoment(updated, this.deps.now(), { kind: 'cut', durationMs: 0 });
    }
    this.compositor?.setNotice(notice);
  }

  private async acquireMic(moment: Moment): Promise<void> {
    const audio = moment.audio;
    if (audio.micDeviceId === 'none') {
      stopStream(this.micStream);
      this.micStream = null;
      this.micKey = null;
      return;
    }
    const key = [audio.micDeviceId, audio.echoCancellation, audio.noiseSuppression, audio.autoGain].join('|');
    if (this.micKey === key && hasLiveTrack(this.micStream)) return;
    const devices = this.deps.mediaDevices;
    if (!devices) return;
    stopStream(this.micStream);
    this.micStream = null;
    try {
      const stream = await devices.getUserMedia({
        audio: {
          deviceId: audio.micDeviceId !== 'default' ? { exact: audio.micDeviceId } : undefined,
          echoCancellation: audio.echoCancellation,
          noiseSuppression: audio.noiseSuppression,
          autoGainControl: audio.autoGain,
        },
        video: false,
      });
      this.micStream = stream;
      this.micKey = key;
      this.watchTracks(stream, 'mic', '__mic__', audio.micDeviceId);
      this.liveCaptureSucceeded = true;
    } catch (err) {
      this.micKey = null;
      this.emit('deviceLost', { kind: 'mic', deviceId: audio.micDeviceId });
      this.emit('engineError', { code: 'MIC_LOST', technical: describe(err) });
    }
  }

  // ---------------------------------------------------------------- audio + capture stream

  private buildPreviewStream(fps: number): void {
    const canvas = this.canvas;
    if (!canvas || typeof canvas.captureStream !== 'function') {
      this.previewStreamValue = null;
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(fps);
    } catch {
      stream = null;
    }
    if (!stream) {
      this.previewStreamValue = null;
      return;
    }
    const mixed = this.buildAudioMix();
    if (mixed) {
      for (const track of mixed.getAudioTracks?.() ?? []) {
        try {
          stream.addTrack(track);
        } catch {
          /* ignore */
        }
      }
    }
    this.previewStreamValue = stream;
  }

  /**
   * Mix mic + system audio through per-source GainNodes so micGain/systemGain/mute are
   * instantaneous and do not require re-acquiring a device.
   */
  private buildAudioMix(): MediaStream | null {
    const Ctor = this.deps.AudioContextCtor;
    if (!Ctor) {
      // No WebAudio: fall back to the raw mic track (no gain control, no system mix).
      return this.micStream;
    }
    try {
      const ctx = this.audioContext ?? new Ctor();
      this.audioContext = ctx;
      const destination = this.audioDestination ?? ctx.createMediaStreamDestination();
      this.audioDestination = destination;
      if (this.micStream && !this.micGain) {
        const gain = ctx.createGain();
        ctx.createMediaStreamSource(this.micStream).connect(gain);
        gain.connect(destination);
        this.micGain = gain;
      }
      if (this.systemAudioStream && !this.systemGain) {
        const gain = ctx.createGain();
        ctx.createMediaStreamSource(this.systemAudioStream).connect(gain);
        gain.connect(destination);
        this.systemGain = gain;
      }
      if (this.activeMoment) this.refreshAudioGains(this.activeMoment);
      void ctx.resume?.().catch?.(() => undefined);
      return destination.stream;
    } catch {
      return this.micStream;
    }
  }

  private refreshAudioGains(moment: Moment): void {
    const audio = moment.audio;
    if (this.micGain) this.micGain.gain.value = audio.micMuted ? 0 : clampGain(audio.micGain);
    if (this.systemGain) this.systemGain.gain.value = audio.systemAudio ? clampGain(audio.systemGain) : 0;
  }

  private teardownAudio(): void {
    try {
      this.micGain?.disconnect();
      this.systemGain?.disconnect();
      void this.audioContext?.close?.().catch?.(() => undefined);
    } catch {
      /* ignore */
    }
    this.micGain = null;
    this.systemGain = null;
    this.audioDestination = null;
    this.audioContext = null;
  }

  // ---------------------------------------------------------------- misc

  private formatFor(aspect: AspectRatio): OutputFormat {
    return this.formats[aspect] ?? firstFormat(this.formats) ?? formatForPreset('1080p30', aspect);
  }
}

// -------------------------------------------------------------------- helpers

function blankSession(output: EngineOutput, mode: OutputSession['mode']): OutputSession {
  return { output, mode, state: 'connecting', offs: [], lossPct: 0, kbps: 0, encoderDroppedPct: 0 };
}

/** One WHIP session per aspect ratio; the relay (MediaMTX) fans out to RTMP/SRT. */
export function relayEndpoint(baseUrl: string, aspect: AspectRatio): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${aspect.replace(':', 'x')}`;
}

export function cloneMoment(moment: Moment): Moment {
  return { ...moment, layers: moment.layers.map((layer) => ({ ...layer }) as Layer), audio: { ...moment.audio } };
}

function compactFormats(formats: Record<AspectRatio, OutputFormat | undefined>): Partial<Record<AspectRatio, OutputFormat>> {
  const out: Partial<Record<AspectRatio, OutputFormat>> = {};
  for (const aspect of ['16:9', '9:16', '1:1'] as AspectRatio[]) {
    const format = formats?.[aspect];
    if (format) out[aspect] = format;
  }
  return out;
}

function firstFormat(formats: Partial<Record<AspectRatio, OutputFormat>>): OutputFormat | undefined {
  return formats['16:9'] ?? formats['9:16'] ?? formats['1:1'];
}

/** Read the video outbound-rtp entry (plus its remote report) out of an RTCStatsReport. */
export function readOutboundSample(report: unknown, at: number): StatsSample {
  const sample: StatsSample = { at, bytesSent: 0, packetsSent: 0, packetsLost: 0, framesSent: 0, framesDropped: 0 };
  const iterable = report as StatsReportLike | undefined;
  if (!iterable || typeof iterable.forEach !== 'function') return sample;
  iterable.forEach((value) => {
    const stat = value as Record<string, unknown> | null;
    if (!stat || typeof stat !== 'object') return;
    const type = String(stat.type ?? '');
    const kind = String(stat.kind ?? stat.mediaType ?? '');
    if (type === 'outbound-rtp' && (kind === 'video' || kind === '')) {
      sample.bytesSent += num(stat.bytesSent);
      sample.packetsSent += num(stat.packetsSent);
      sample.framesSent += num(stat.framesSent) || num(stat.framesEncoded);
      sample.framesDropped += num(stat.framesDropped);
      const reason = stat.qualityLimitationReason;
      if (typeof reason === 'string' && reason !== 'none') sample.qualityLimitationReason = reason;
    }
    if (type === 'remote-inbound-rtp') {
      sample.packetsLost += num(stat.packetsLost);
    }
    if (type === 'outbound-rtp' && typeof stat.packetsLost === 'number') {
      sample.packetsLost += num(stat.packetsLost);
    }
  });
  return sample;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(2, Math.max(0, gain));
}

function hasLiveTrack(stream: MediaStream | null): boolean {
  if (!stream) return false;
  const tracks = stream.getTracks?.() ?? [];
  return tracks.some((track) => track.readyState !== 'ended');
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks?.() ?? []) {
    try {
      track.stop?.();
    } catch {
      /* ignore */
    }
  }
}

function makeBlob(chunks: Blob[], type: string): Blob | undefined {
  if (chunks.length === 0) return undefined;
  const BlobCtor = (globalThis as { Blob?: typeof Blob }).Blob;
  if (typeof BlobCtor !== 'function') return undefined;
  try {
    return new BlobCtor(chunks, { type });
  } catch {
    return undefined;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
