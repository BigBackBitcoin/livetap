/**
 * MobileEngine — the `MediaEngine` implementation for the LIVETAP mobile app.
 *
 * Unlike BrowserEngine (which composites in a canvas and publishes WHIP) and FfmpegEngine (which
 * spawns ffmpeg), MobileEngine owns almost no media logic of its own: the native LiveStream plugin
 * owns capture, compositing, encoding and the RTMP socket. This class is the adapter that makes
 * that native surface look like the core `MediaEngine` contract, so the React UI is identical on
 * web, desktop and mobile.
 *
 * What it deliberately does NOT do:
 * - No Moment compositing. A phone gets the camera full-frame plus native overlays; the layer graph
 *   is honoured only to the extent of picking the camera and the mute state. `setMoment` therefore
 *   updates camera/mute and nothing else, and says so.
 * - No multi-format encoding. `maxFormats` is 1: a phone encodes once. Outputs whose aspect ratio
 *   differs from the master are reported as `outputLost` with `CONFIG_INVALID` rather than silently
 *   being sent the wrong shape.
 * - No RTMP fan-out beyond what the device can stand. Past
 *   `capabilities().maxSimultaneousStreams` outputs are refused with `CONFIG_INVALID`; real
 *   multi-destination belongs behind a relay in LIVETAP CLOUD (ADR-009).
 *
 * Verification: UNVERIFIED. The mapping logic below is unit-tested against a fake plugin; the
 * native side behind it has never been compiled or run on this host.
 */
import { TypedEmitter } from '@livetap/core';
import type {
  AspectRatio,
  EngineCapabilities,
  EngineEvents,
  EngineOutput,
  EngineStartRequest,
  ErrorCode,
  MediaEngine,
  Moment,
  OutputFormat,
  RecordingSettings,
} from '@livetap/core';
import type {
  DeviceLostEvent,
  LiveStreamAspect,
  LiveStreamCamera,
  LiveStreamCapabilities,
  LiveStreamPlugin,
  StreamStateEvent,
  ThermalEvent,
} from '@livetap/capacitor-live-stream';

export type MobilePlatform = 'ios' | 'android' | 'web';

export interface MobileEngineOptions {
  /** Injected for tests; defaults to the registered native plugin. */
  plugin?: LiveStreamPlugin;
  /** Defaults to 'web' when Capacitor is not present (keeps unit tests free of a device). */
  platform?: MobilePlatform;
  now?: () => number;
}

interface OutputSession {
  output: EngineOutput;
  /** Native stream id, once `startStream` has returned. */
  nativeId?: string;
  state: 'connecting' | 'up' | 'degraded' | 'lost' | 'stopped';
  bitrateKbps: number;
  droppedFrames: number;
}

/** Listener handles we must release on stop(). */
interface Subscription {
  remove: () => Promise<void>;
}

const ASPECTS: Record<AspectRatio, LiveStreamAspect> = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
};

export class MobileEngine implements MediaEngine {
  readonly kind = 'native' as const;

  private readonly emitter = new TypedEmitter<EngineEvents>();
  private readonly options: MobileEngineOptions;
  private readonly now: () => number;

  private plugin?: LiveStreamPlugin;
  private caps?: LiveStreamCapabilities;

  private sessions = new Map<string, OutputSession>();
  /** nativeId -> destinationId */
  private nativeIds = new Map<string, string>();
  private subscriptions: Subscription[] = [];

  private previewing = false;
  private masterAspect: AspectRatio = '9:16';
  private camera: LiveStreamCamera = 'front';
  private formats: Partial<Record<AspectRatio, OutputFormat>> = {};
  private recordingActive = false;
  private thermalLevel: ThermalEvent['level'] = 'nominal';
  private targetKbps = 0;
  private targetFps = 30;

  constructor(options: MobileEngineOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  // ---------------------------------------------------------------- capabilities

  async capabilities(): Promise<EngineCapabilities> {
    const plugin = await this.resolvePlugin();
    const caps = await plugin.capabilities();
    this.caps = caps;
    const platform = this.options.platform ?? 'web';
    return {
      camera: caps.camera,
      microphone: caps.microphone,
      // Screen capture on mobile is post-MVP: iOS needs a ReplayKit Broadcast Upload Extension,
      // Android needs MediaProjection plus a foreground service. Neither is in the MVP plugin.
      screen: caps.screenCapture,
      window: false,
      systemAudio: false,
      rtmp: caps.rtmp,
      srt: caps.srt,
      // A native RTMP pipeline has no reason to speak WHIP, and the phone is not a relay.
      whip: false,
      recording: caps.recording,
      hardwareEncoders:
        platform === 'ios' ? ['videotoolbox'] : platform === 'android' ? [] : [],
      // A phone encodes once. Two aspect ratios means two encodes, which the thermal budget
      // does not allow — the UI must pick one master aspect.
      maxFormats: 1,
      verification: caps.verification,
    };
  }

  // ---------------------------------------------------------------- preview

  async startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void> {
    const plugin = await this.resolvePlugin();
    await this.subscribe(plugin);
    this.masterAspect = masterAspect;
    this.camera = cameraFromMoment(moment) ?? this.camera;
    await plugin.startPreview({ camera: this.camera, aspect: ASPECTS[masterAspect] });
    await plugin.setMute({ muted: isMuted(moment) });
    this.previewing = true;
  }

  async stopPreview(): Promise<void> {
    if (!this.previewing) return;
    const plugin = await this.resolvePlugin();
    await plugin.stopPreview();
    this.previewing = false;
  }

  /**
   * On a phone a Moment collapses to two decisions: which camera, and whether the mic is muted.
   * Overlays, layouts and transitions are not honoured natively in the MVP.
   */
  async setMoment(moment: Moment): Promise<void> {
    const plugin = await this.resolvePlugin();
    const wanted = cameraFromMoment(moment);
    if (wanted && wanted !== this.camera) {
      await plugin.switchCamera();
      this.camera = wanted;
    }
    await plugin.setMute({ muted: isMuted(moment) });
  }

  // ---------------------------------------------------------------- outputs

  async start(req: EngineStartRequest): Promise<void> {
    const plugin = await this.resolvePlugin();
    await this.subscribe(plugin);
    this.formats = { ...req.formats };
    const master = this.formats[this.masterAspect];
    this.targetKbps = master ? master.videoKbps : 0;
    this.targetFps = master ? master.fps : 30;

    for (const output of req.outputs) {
      await this.openOutput(plugin, output);
    }

    if (req.recording.enabled) {
      await this.startRecording(req.recording);
    }
  }

  async addOutput(output: EngineOutput): Promise<void> {
    const plugin = await this.resolvePlugin();
    await this.subscribe(plugin);
    await this.openOutput(plugin, output);
  }

  async removeOutput(destinationId: string): Promise<void> {
    const session = this.sessions.get(destinationId);
    if (!session) return;
    this.sessions.delete(destinationId);
    if (session.nativeId) {
      this.nativeIds.delete(session.nativeId);
      const plugin = await this.resolvePlugin();
      try {
        await plugin.stopStream({ id: session.nativeId });
      } catch {
        // Stopping an output the native layer has already torn down is not worth surfacing:
        // the destination is stopped either way, which is what the caller asked for.
      }
    }
    this.emitter.emit('output', { type: 'outputStopped', destinationId });
  }

  async stop(): Promise<void> {
    const plugin = await this.resolvePlugin();
    for (const [destinationId, session] of Array.from(this.sessions.entries())) {
      if (session.nativeId) {
        try {
          await plugin.stopStream({ id: session.nativeId });
        } catch {
          // Best effort: a failed stop must not prevent the remaining outputs from stopping.
        }
      }
      this.emitter.emit('output', { type: 'outputStopped', destinationId });
    }
    this.sessions.clear();
    this.nativeIds.clear();

    if (this.recordingActive) {
      await this.stopRecording();
    }
    await this.unsubscribe();
  }

  // ---------------------------------------------------------------- recording

  async startRecording(_settings: RecordingSettings): Promise<void> {
    const plugin = await this.resolvePlugin();
    try {
      const { path } = await plugin.startRecording();
      this.recordingActive = true;
      this.emitter.emit('recording', { state: 'started', path });
    } catch {
      // A recording that cannot start must never take the live outputs down with it.
      this.emitter.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
    }
  }

  async stopRecording(): Promise<{ path?: string }> {
    if (!this.recordingActive) return {};
    const plugin = await this.resolvePlugin();
    this.recordingActive = false;
    try {
      const result = await plugin.stopRecording();
      this.emitter.emit('recording', { state: 'stopped', path: result.path });
      return result.path === undefined ? {} : { path: result.path };
    } catch {
      this.emitter.emit('recording', { state: 'failed', code: 'RECORDING_FAILED' });
      return {};
    }
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof EngineEvents>(
    event: K,
    listener: (payload: EngineEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  /** Current thermal reading, for Pro Mode diagnostics and the auto step-down policy. */
  get thermal(): ThermalEvent['level'] {
    return this.thermalLevel;
  }

  // ---------------------------------------------------------------- internals

  private async resolvePlugin(): Promise<LiveStreamPlugin> {
    if (this.options.plugin) return this.options.plugin;
    if (!this.plugin) {
      const mod = await import('@livetap/capacitor-live-stream');
      this.plugin = mod.LiveStream;
    }
    return this.plugin;
  }

  private async openOutput(plugin: LiveStreamPlugin, output: EngineOutput): Promise<void> {
    const reject = (code: ErrorCode, technical: string): void => {
      this.emitter.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code,
        technical,
      });
    };

    const protocol = output.ingest.protocol;
    if (protocol !== 'rtmp' && protocol !== 'rtmps') {
      reject(
        'CONFIG_INVALID',
        `mobile supports rtmp/rtmps only; got ${protocol}. SRT and WHIP need the desktop app or a relay.`,
      );
      return;
    }
    if (output.aspectRatio !== this.masterAspect) {
      reject(
        'CONFIG_INVALID',
        `a phone encodes one format: master aspect is ${this.masterAspect}, output wants ${output.aspectRatio}`,
      );
      return;
    }
    const format = this.formats[output.aspectRatio];
    if (!format) {
      reject('CONFIG_INVALID', `no encoder format resolved for ${output.aspectRatio}`);
      return;
    }
    const max = this.caps?.maxSimultaneousStreams ?? 1;
    const live = Array.from(this.sessions.values()).filter((s) => s.state !== 'stopped').length;
    if (live >= max) {
      reject(
        'CONFIG_INVALID',
        `device allows ${max} simultaneous RTMP push(es); use a relay for more (ADR-009)`,
      );
      return;
    }
    if (!output.ingest.streamKey) {
      reject('INGEST_INVALID_KEY', 'no stream key for this destination');
      return;
    }

    const session: OutputSession = {
      output,
      state: 'connecting',
      bitrateKbps: 0,
      droppedFrames: 0,
    };
    this.sessions.set(output.destinationId, session);

    try {
      const { id } = await plugin.startStream({
        url: output.ingest.url,
        streamKey: output.ingest.streamKey,
        videoKbps: format.videoKbps,
        audioKbps: format.audioKbps,
        width: format.width,
        height: format.height,
        fps: format.fps,
        keyframeSeconds: format.keyframeIntervalSeconds,
      });
      session.nativeId = id;
      this.nativeIds.set(id, output.destinationId);
    } catch (err) {
      this.sessions.delete(output.destinationId);
      reject('INGEST_REFUSED', err instanceof Error ? err.message : String(err));
    }
  }

  private async subscribe(plugin: LiveStreamPlugin): Promise<void> {
    if (this.subscriptions.length > 0) return;
    this.subscriptions.push(
      await plugin.addListener('streamState', (e) => this.onStreamState(e)),
      await plugin.addListener('deviceLost', (e) => this.onDeviceLost(e)),
      await plugin.addListener('thermal', (e) => this.onThermal(e)),
    );
  }

  private async unsubscribe(): Promise<void> {
    const subs = this.subscriptions;
    this.subscriptions = [];
    for (const sub of subs) {
      try {
        await sub.remove();
      } catch {
        // A listener that cannot be removed is not worth failing a stop() over.
      }
    }
  }

  private onStreamState(event: StreamStateEvent): void {
    const destinationId = this.nativeIds.get(event.id);
    if (!destinationId) return;
    const session = this.sessions.get(destinationId);
    if (!session) return;

    if (event.bitrateKbps !== undefined) session.bitrateKbps = event.bitrateKbps;
    if (event.droppedFrames !== undefined) session.droppedFrames = event.droppedFrames;

    switch (event.state) {
      case 'connecting':
        session.state = 'connecting';
        break;
      case 'connected': {
        const recovered = session.state === 'degraded' || session.state === 'lost';
        session.state = 'up';
        this.emitter.emit('output', {
          type: recovered ? 'outputRecovered' : 'outputUp',
          destinationId,
        });
        break;
      }
      case 'degraded':
        session.state = 'degraded';
        this.emitter.emit('output', {
          type: 'outputDegraded',
          destinationId,
          ...(event.technical === undefined ? {} : { technical: event.technical }),
        });
        break;
      case 'disconnected':
      case 'failed': {
        session.state = 'lost';
        const code: ErrorCode =
          event.code ?? (event.state === 'disconnected' ? 'INGEST_DISCONNECTED' : 'PLATFORM_ERROR');
        this.emitter.emit('output', {
          type: 'outputLost',
          destinationId,
          code,
          ...(event.technical === undefined ? {} : { technical: event.technical }),
        });
        break;
      }
    }

    this.emitMetrics();
  }

  private onDeviceLost(event: DeviceLostEvent): void {
    this.emitter.emit('deviceLost', { kind: event.kind === 'mic' ? 'mic' : 'camera' });
    if (!event.recoverable) {
      this.emitter.emit('engineError', {
        code: event.kind === 'mic' ? 'MIC_LOST' : 'CAMERA_LOST',
        ...(event.technical === undefined ? {} : { technical: event.technical }),
      });
    }
  }

  /**
   * Thermal policy (docs/architecture/MOBILE_ARCHITECTURE.md):
   * `serious` and above means the OS is about to throttle the encoder mid-broadcast. LIVETAP
   * reports it as an explicit engine condition so the orchestrator can step 1080p down to 720p
   * and 60 fps down to 30 fps, rather than letting the stream visibly fall apart.
   */
  private onThermal(event: ThermalEvent): void {
    this.thermalLevel = event.level;
    if (event.level === 'serious' || event.level === 'critical') {
      this.emitter.emit('engineError', {
        code: 'ENCODER_OVERLOADED',
        technical: `thermalState=${event.level}; step down resolution/fps`,
      });
    }
    this.emitMetrics();
  }

  private emitMetrics(): void {
    const sessions = Array.from(this.sessions.values());
    const kbps = sessions.reduce((sum, s) => sum + s.bitrateKbps, 0);
    const dropped = sessions.reduce((max, s) => Math.max(max, s.droppedFrames), 0);
    this.emitter.emit('metrics', {
      encodedKbps: kbps,
      targetKbps: this.targetKbps,
      // The native libraries report dropped frames, not an encoder-lag percentage; report 0
      // rather than inventing a number.
      encoderDroppedPct: 0,
      networkDroppedPct: dropped > 0 && this.targetFps > 0 ? Math.min(100, dropped) : 0,
      renderFps: this.targetFps,
      targetFps: this.targetFps,
      updatedAt: this.now(),
    });
  }
}

/** A Moment's first visible camera layer decides which physical camera the phone uses. */
function cameraFromMoment(moment: Moment): LiveStreamCamera | undefined {
  const cam = moment.layers.find((l) => l.kind === 'camera' && l.visible);
  if (!cam) return undefined;
  // `mirror` is how LIVETAP marks a selfie framing; on a phone that maps to the front camera.
  return cam.mirror === false ? 'back' : 'front';
}

function isMuted(moment: Moment): boolean {
  return moment.audio.micMuted === true;
}
