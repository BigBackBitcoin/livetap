/**
 * BrowserEngine - the MediaEngine implementation for the web app and mobile WebViews.
 *
 * Pipeline: getUserMedia / getDisplayMedia -> <video> elements -> FormatRenderer (one 2D canvas
 *           per distinct aspect ratio) -> canvas.captureStream() + WebAudio mix -> WHIP (WebRTC)
 *           and/or MediaRecorder.
 *
 * Honest limits (see docs/architecture/MEDIA_ENGINE.md):
 * - A browser cannot speak RTMP/RTMPS/SRT. Those outputs either need the desktop app or the
 *   WHIP relay (MediaMTX) configured through `relay`.
 * - One encode per FORMAT, not one encode per broadcast: a 9:16 destination is published from the
 *   9:16 canvas, composed with the Moment's own 9:16 placements. An output whose aspect ratio was
 *   never composed is refused with CONFIG_INVALID rather than being handed the master picture.
 * - Browser layers need Electron/webview; the compositor leaves that layer's rectangle empty.
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
import { FormatRenderer } from '../compositor/FormatRenderer.js';
import type { MomentCompositor } from '../compositor/MomentCompositor.js';
import { KEYFRAME_INTERVAL_MS } from '../desktop/diagnostics.js';
import { LocalSources } from '../sources/LocalSources.js';
import { WhipClient, WhipError } from '../whip/WhipClient.js';
import {
  pickRecordingMime,
  probablySupportsDisplayAudio,
  resolveDeps,
  type BrowserEngineOptions,
  type MediaRecorderLike,
  type RelayOptions,
  type ResolvedDeps,
} from './deps.js';

const RTMP_HINT = 'Browser cannot publish RTMP; use the desktop app or a WHIP relay';
const DEFAULT_STATS_MS = 2000;
const DEFAULT_METRICS_MS = 1000;
const LOSS_DEGRADE_PCT = 3;
const BITRATE_DEGRADE_RATIO = 0.5;

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
  private readonly statsIntervalMs: number;
  private readonly metricsIntervalMs: number;
  private readonly onChunk: ((chunk: Blob, index: number) => void) | undefined;

  private readonly sources: LocalSources;
  private readonly renderer: FormatRenderer;

  private masterAspect: AspectRatio = '16:9';
  private formats: Partial<Record<AspectRatio, OutputFormat>> = {};
  private activeMoment: Moment | null = null;
  private previewing = false;

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

  private running = false;

  constructor(options: BrowserEngineOptions = {}) {
    super();
    this.deps = resolveDeps(options);
    this.relay = options.relay;
    this.statsIntervalMs = options.statsIntervalMs ?? DEFAULT_STATS_MS;
    this.metricsIntervalMs = options.metricsIntervalMs ?? DEFAULT_METRICS_MS;
    this.onChunk = options.onChunk;

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
      // Evidence, not a user-agent guess: false until a display capture actually produced an
      // audio track. `describeEnvironment().systemAudioLikely` carries the prediction.
      systemAudio: this.sources.systemAudioObserved,
      // Browsers have no RTMP/SRT socket. Only the desktop engine (or the relay) provides these.
      rtmp: false,
      srt: false,
      whip: this.deps.RTCPeerConnectionCtor !== null,
      recording: this.deps.MediaRecorderCtor !== null && recordingMime !== null,
      hardwareEncoders,
      // One canvas and one WebRTC encode PER ASPECT RATIO, which is every aspect ratio there is.
      // This used to be 1 because the engine captured a single canvas; FormatRenderer composes
      // each aspect at its own dimensions, so the limit is now the number of formats, not one.
      maxFormats: 3,
      verification: !hasDevices ? 'UNAVAILABLE' : this.sources.liveCaptureSucceeded ? 'PASS' : 'UNVERIFIED',
    };
  }

  /** Extra, non-contract environment detail for the Pro diagnostics panel. */
  describeEnvironment(): {
    recordingMimeType: string | null;
    relayConfigured: boolean;
    hasAudioMixing: boolean;
    hasCanvasCapture: boolean;
    systemAudioLikely: boolean;
  } {
    return {
      recordingMimeType: pickRecordingMime(this.deps.MediaRecorderCtor),
      relayConfigured: this.relay !== undefined,
      hasAudioMixing: this.deps.AudioContextCtor !== null,
      hasCanvasCapture: typeof this.renderer.canvasFor(this.masterAspect)?.captureStream === 'function',
      // A prediction, not a capability: Chromium-only in practice, and even there the audio
      // constraint is a hint. Use it to word the UI ("we will try"), never to promise.
      systemAudioLikely: this.deps.getDisplayMedia !== null && probablySupportsDisplayAudio(),
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
    return this.renderer.streamFor(this.masterAspect);
  }

  get isPreviewing(): boolean {
    return this.previewing;
  }

  /** The master-aspect compositor, exposed so the UI can mirror the canvas or read renderFps. */
  get composer(): MomentCompositor | null {
    return this.renderer.masterCompositor;
  }

  /** Every composed format, for the UI's per-destination output strip. */
  get formatRenderer(): FormatRenderer {
    return this.renderer;
  }

  async startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void> {
    this.masterAspect = masterAspect;
    this.activeMoment = cloneMoment(moment);
    this.renderer.setFormats(this.formats, masterAspect, this.formatFor(masterAspect));
    await this.sources.sync(this.activeMoment);
    this.renderer.setMoment(this.activeMoment, this.deps.now(), { kind: 'cut', durationMs: 0 });
    this.renderer.start();
    // Materialise the master capture now: the preview <video> needs it, and a capture that is
    // going to fail should fail here rather than at GO LIVE.
    this.renderer.streamFor(masterAspect);
    this.previewing = true;
  }

  async stopPreview(): Promise<void> {
    this.previewing = false;
    this.renderer.stop();
    this.renderer.releaseStreams();
    this.sources.stopAll();
  }

  /** Point a <video> element at the composited preview. */
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
    this.formats = compactFormats(req.formats);
    const master = this.formatFor(this.masterAspect);
    this.renderer.setFormats(this.formats, this.masterAspect, master);
    if (!this.previewing && this.activeMoment) {
      await this.startPreview(this.activeMoment, this.masterAspect);
    } else {
      this.renderer.start();
    }
    this.running = true;

    if (!this.renderer.streamFor(this.masterAspect)) {
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
    // The picture this destination actually asked for. Never the master canvas at a different
    // shape: that is a landscape broadcast wearing a vertical bitrate cap.
    const stream = this.renderer.streamFor(output.aspectRatio);
    if (!stream) {
      this.failOutput(session, 'ENCODER_FAILED', `No ${output.aspectRatio} picture is being composed - start the preview first`);
      return;
    }
    const format = this.formatFor(output.aspectRatio);
    const client = new WhipClient({
      endpoint: output.ingest.url,
      token: output.ingest.streamKey,
      stream,
      tracks: stream.getTracks?.() ?? [],
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
    // Session-mode relay (exact whipUrl): one WHIP session for every output, keyed by the first
    // aspect ratio that opened it; the relay produces the other formats server-side.
    const relayKey: AspectRatio = relayOptions.whipUrl
      ? (this.relays.keys().next().value ?? output.aspectRatio)
      : output.aspectRatio;
    session.relayAspect = relayKey;
    this.sessions.set(output.destinationId, session);

    if (!this.deps.RTCPeerConnectionCtor || !this.deps.fetch) {
      this.failOutput(session, 'CONFIG_INVALID', 'WebRTC is not available in this browser');
      return;
    }

    const existing = this.relays.get(relayKey);
    if (existing) {
      existing.destinationIds.add(output.destinationId);
      if (existing.connected) {
        session.state = 'up';
        this.emit('output', { type: 'outputUp', destinationId: output.destinationId });
      }
      return;
    }

    // Per-aspect relay: publish the aspect's own picture. Session-mode relay: publish the master,
    // because the relay is the thing deriving the other formats and it was told which one it gets.
    const stream = this.renderer.streamFor(relayKey) ?? (relayOptions.whipUrl ? this.renderer.streamFor(this.masterAspect) : null);
    if (!stream) {
      this.failOutput(session, 'ENCODER_FAILED', `No ${relayKey} picture is being composed - start the preview first`);
      return;
    }

    const format = this.formatFor(relayKey);
    const client = new WhipClient({
      endpoint: relayOptions.whipUrl ?? relayEndpoint(relayOptions.whipBaseUrl, relayKey),
      token: relayOptions.token,
      stream,
      tracks: stream.getTracks?.() ?? [],
      format,
      RTCPeerConnectionCtor: this.deps.RTCPeerConnectionCtor,
      fetch: this.deps.fetch,
      setTimeoutFn: this.deps.setTimeoutFn,
      clearTimeoutFn: this.deps.clearTimeoutFn,
      now: this.deps.now,
    });
    const relay: RelaySession = {
      aspect: relayKey,
      client,
      destinationIds: new Set([output.destinationId]),
      connected: false,
    };
    this.relays.set(relayKey, relay);

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
      this.relays.delete(relayKey);
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
      renderFps: this.renderer.renderFps,
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
    const stream = this.renderer.streamFor(this.masterAspect);
    if (!Ctor || !stream) {
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
      const recorder = new Ctor(stream, {
        mimeType: mime === '' ? undefined : mime,
        videoBitsPerSecond: format.videoKbps * 1000,
        audioBitsPerSecond: format.audioKbps * 1000,
        // A local recording wants frequent keyframes for the same reason a broadcast does: it is
        // what makes the file seekable. See KEYFRAME_INTERVAL_MS.
        videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
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

  // ---------------------------------------------------------------- misc

  private audioTracks(): MediaStreamTrack[] {
    const mixed = this.sources.buildAudioMix(this.activeMoment);
    return mixed?.getAudioTracks?.() ?? [];
  }

  /**
   * Hide a layer whose source died and record the reason for the UI.
   *
   * The reason is NOT painted into the program. The compositor keeps rendering, so the output
   * never goes black, and the words stay in the application where the operator can act on them.
   */
  private markLayerUnavailable(layerId: string, notice: string): void {
    if (this.activeMoment && layerId !== '__mic__') {
      const updated: Moment = {
        ...this.activeMoment,
        layers: this.activeMoment.layers.map((layer) => (layer.id === layerId ? { ...layer, visible: false } : layer)),
      };
      this.activeMoment = updated;
      this.renderer.setMoment(updated, this.deps.now(), { kind: 'cut', durationMs: 0 });
    }
    this.renderer.setNotice(notice);
  }

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
