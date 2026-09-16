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
 * - No RTMP fan-out ON THE DEVICE beyond what it can stand. Past
 *   `capabilities().maxSimultaneousStreams` outputs are refused with `CONFIG_INVALID`. Real
 *   multi-destination belongs behind a relay (ADR-009), and `useRelaySession` is now how it gets
 *   there: the device encodes once and publishes once to the relay, which fans out. Without a
 *   relay session this is still a one-destination engine, and says so.
 *
 * Verification: the mapping logic below is unit-tested against a fake plugin, including the
 * permission gate, the aspect refusal, the relay fan-out and every event translation. The native
 * RTMP auth the relay path depends on (`setAuthorization`, confirmed present in RootEncoder 2.8.1)
 * is NOT compiled or run here -- this host has no JDK and no Android SDK -- so the relay path is
 * proven up to the plugin boundary and UNVERIFIED beyond it. The Android native side behind
 * it compiles and ships in the debug APK's dex on this host but has never been RUN (no emulator
 * image, no nested virtualisation, no handset); the iOS side has not been compiled at all. See
 * docs/release/ANDROID_MANUAL_TEST.md.
 */
import { TypedEmitter } from '@livetap/core';
import { installVaultBridge } from '@livetap/capacitor-live-stream';
import { BondMonitor } from '@livetap/bond/browser';
import type {
  AspectRatio,
  CameraLayer,
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
  LiveStreamPermissionStatus,
  LiveStreamPlugin,
  StreamStateEvent,
  ThermalEvent,
} from '@livetap/capacitor-live-stream';

export type MobilePlatform = 'ios' | 'android' | 'web';

/**
 * A relay session this device publishes through, instead of publishing to each destination.
 *
 * `rtmpUrl` is the relay's own ingest for this broadcast. It is the same MediaMTX path and the
 * same forward list the browser's WHIP URL addresses -- only the way in differs, because a phone's
 * native encoder has an RTMP socket and no WHIP client.
 */
export interface MobileRelaySession {
  readonly rtmpUrl: string;
  /** `<user>:<pass>`. A credential: never logged, never in an event, never inside the URL. */
  readonly authorization?: string;
}

export interface MobileEngineOptions {
  /** Injected for tests; defaults to the registered native plugin. */
  plugin?: LiveStreamPlugin;
  /** Defaults to 'web' when Capacitor is not present (keeps unit tests free of a device). */
  platform?: MobilePlatform;
  now?: () => number;
  /**
   * Install the Keystore-backed `window.livetap.vault` bridge. Default true.
   *
   * Constructing the engine is the earliest hook this package owns that runs inside the WebView:
   * `apps/web/src/state/engine.ts` builds it during store creation, before any destination exists
   * and therefore before anything has a secret to keep. Set false in tests that assert on globals.
   */
  installVault?: boolean;
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
  /** nativeId -> destinationId. One-to-one for direct outputs; see `destinationsFor` for relayed. */
  private nativeIds = new Map<string, string>();
  private relay: MobileRelaySession | null = null;
  /*
   * Bond's decision layer, on the one path this device is publishing over.
   *
   * A phone genuinely has two radios and could one day bond them; today it publishes over whichever
   * one the OS chose, and the value here is the same as on web -- one model, one definition of
   * "degraded", one place that decides the encoder should come down. The inputs differ because the
   * measurements differ, and `observePublish` is explicit about which ones this surface can honestly
   * supply.
   */
  private readonly bond = new BondMonitor();
  private lastDroppedFrames = 0;
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
    if (options.installVault !== false) installVaultBridge();
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
    await this.ensureCapturePermissions(plugin);
    this.masterAspect = masterAspect;
    this.camera = cameraFromMoment(moment) ?? this.camera;
    await plugin.startPreview({ camera: this.camera, aspect: ASPECTS[masterAspect] });
    await plugin.setMute({ muted: isMuted(moment) });
    this.previewing = true;
  }

  /**
   * Ask for camera and microphone, and only then for notifications.
   *
   * Nothing on this surface works without the first two: every native method rejects until the OS
   * has granted them, and before this ran the creator met a raw native rejection string on a fresh
   * install instead of the system dialog. They are requested together and their refusal is thrown,
   * because a broadcast with no camera is not a degraded broadcast, it is no broadcast.
   *
   * Notifications are asked for afterwards and best-effort. On Android 13+ the live notification is
   * the only handle on a broadcast once the creator leaves the app, but a refusal costs the handle
   * and not the bytes, so it must never stand between the creator and GO LIVE. On older Android and
   * on iOS the alias can report `denied` on a device where the notification will appear anyway,
   * which is another reason not to gate on it.
   */
  private async ensureCapturePermissions(plugin: LiveStreamPlugin): Promise<void> {
    let status: LiveStreamPermissionStatus;
    try {
      status = await plugin.checkPermissions();
    } catch {
      // A plugin build without the permission methods (an old native binary against a new bundle)
      // must not make the app unusable: let startPreview reject with the native reason instead.
      return;
    }

    if (status.camera !== 'granted' || status.microphone !== 'granted') {
      status = await plugin.requestPermissions({ permissions: ['camera', 'microphone'] });
    }

    const missing = (['camera', 'microphone'] as const).filter((k) => status[k] !== 'granted');
    if (missing.length > 0) {
      const code: ErrorCode = missing.includes('camera') ? 'CAMERA_LOST' : 'MIC_LOST';
      this.emitter.emit('engineError', {
        code,
        technical: `permission not granted: ${missing.join(', ')}`,
      });
      throw new Error(
        `LIVETAP needs ${missing.join(' and ')} access on this phone. ` +
          'Grant it in Settings, then tap the preview again.',
      );
    }

    if (status.notifications !== 'granted') {
      try {
        await plugin.requestPermissions({ permissions: ['notifications'] });
      } catch {
        // Best effort by design; see the note above.
      }
    }
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

  /**
   * Publish through a relay instead of publishing to each destination directly.
   *
   * THIS IS WHAT LETS A PHONE REACH MORE THAN ONE DESTINATION. `maxSimultaneousStreams` is 1 on
   * Android: one hardware encoder, one RTMP socket, and a second push is refused with
   * CONFIG_INVALID whose own message has always said "use a relay for more (ADR-009)". The relay
   * existed and nothing connected it, so that sentence pointed at nothing. With a session set,
   * the device encodes once and publishes once, and the relay fans out to every destination.
   *
   * Deliberately the SAME NAME AND SHAPE as `BrowserEngine.useRelaySession`, because it is the
   * same decision made by the same caller at the same moment; only the protocol differs. It throws
   * while publishing for the same reason too: bytes already on the wire cannot be redirected by
   * changing a field, so a silent no-op would look like success while still forwarding to the
   * previous broadcast's destination list.
   */
  useRelaySession(session: MobileRelaySession | null): void {
    if (this.sessions.size > 0) {
      throw new Error('Cannot change the relay session while an output is publishing.');
    }
    this.relay = session;
  }

  /**
   * Open the single relay push that carries every destination.
   *
   * ASPECT IS NOT REFUSED HERE, and that is a capability gain rather than a missing check. A phone
   * encodes one format, so a direct 9:16 output alongside a 16:9 master is a genuine refusal. Once
   * the relay is carrying the broadcast it derives the other formats server-side, and it has
   * already refused the session outright at `POST /sessions` if it is not configured to -- with a
   * sentence naming the destination and the setting to change. Refusing again here would reject
   * broadcasts the relay just accepted.
   */
  private async openRelayOutputs(plugin: LiveStreamPlugin, outputs: readonly EngineOutput[]): Promise<void> {
    const relay = this.relay;
    if (!relay || outputs.length === 0) return;

    const format = this.formats[this.masterAspect];
    const fail = (code: ErrorCode, technical: string): void => {
      for (const output of outputs) {
        this.emitter.emit('output', { type: 'outputLost', destinationId: output.destinationId, code, technical });
      }
    };
    if (!format) {
      fail('CONFIG_INVALID', `no encoder format resolved for ${this.masterAspect}`);
      return;
    }

    // The native contract is url + "/" + key, so the session path is split off as the key. It is
    // not a secret -- the relay authenticates the publish with the credential below -- but keeping
    // the shape identical to a normal ingest means one native code path, not two.
    const cut = relay.rtmpUrl.lastIndexOf('/');
    if (cut <= 'rtmp://'.length) {
      fail('CONFIG_INVALID', 'the relay did not return a usable RTMP publish URL');
      return;
    }
    const [user, ...rest] = (relay.authorization ?? '').split(':');
    const credentials = relay.authorization ? { username: user!, password: rest.join(':') } : {};

    for (const output of outputs) {
      this.sessions.set(output.destinationId, {
        output,
        state: 'connecting',
        bitrateKbps: 0,
        droppedFrames: 0,
      });
    }

    try {
      const { id } = await plugin.startStream({
        url: relay.rtmpUrl.slice(0, cut),
        streamKey: relay.rtmpUrl.slice(cut + 1),
        ...credentials,
        videoKbps: format.videoKbps,
        audioKbps: format.audioKbps,
        width: format.width,
        height: format.height,
        fps: format.fps,
        keyframeSeconds: format.keyframeIntervalSeconds,
      });
      // Every destination is bound to the one native stream; `destinationsFor` fans its events out.
      for (const output of outputs) {
        const session = this.sessions.get(output.destinationId);
        if (session) session.nativeId = id;
      }
      this.nativeIds.set(id, outputs[0]!.destinationId);
    } catch (err) {
      for (const output of outputs) this.sessions.delete(output.destinationId);
      fail('INGEST_REFUSED', err instanceof Error ? err.message : String(err));
    }
  }

  /** Every destination carried by one native stream. More than one only when relaying. */
  private destinationsFor(nativeId: string): string[] {
    const ids: string[] = [];
    for (const [destinationId, session] of this.sessions) {
      if (session.nativeId === nativeId) ids.push(destinationId);
    }
    return ids;
  }

  async start(req: EngineStartRequest): Promise<void> {
    const plugin = await this.resolvePlugin();
    await this.subscribe(plugin);
    // GO LIVE can be reached without ever having opened the preview (a saved layout, a deep link),
    // and the native layer rejects every call until capture is granted. Asking here as well costs
    // one no-op check when the preview already asked.
    await this.ensureCapturePermissions(plugin);
    this.formats = { ...req.formats };
    const master = this.formats[this.masterAspect];
    this.targetKbps = master ? master.videoKbps : 0;
    this.targetFps = master ? master.fps : 30;

    if (this.relay) {
      await this.openRelayOutputs(plugin, req.outputs);
    } else {
      for (const output of req.outputs) {
        await this.openOutput(plugin, output);
      }
    }

    if (req.recording.enabled) {
      await this.startRecording(req.recording);
    }
  }

  async addOutput(output: EngineOutput): Promise<void> {
    if (this.relay && this.sessions.size > 0) {
      /*
       * A relay session's forward list is fixed when the session is created -- the relay was told
       * where to send at `POST /sessions` and built one ffmpeg process from that list. A late
       * destination is therefore not something this device can add by publishing harder; it would
       * come up green here and receive nothing at the platform. Refused with the reason, which is
       * also the instruction: end and start again to include it.
       */
      this.emitter.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: 'a destination cannot join a relay broadcast already in progress; end and start again to include it',
      });
      return;
    }
    const plugin = await this.resolvePlugin();
    await this.subscribe(plugin);
    await this.openOutput(plugin, output);
  }

  async removeOutput(destinationId: string): Promise<void> {
    const session = this.sessions.get(destinationId);
    if (!session) return;
    this.sessions.delete(destinationId);
    // Only tear the native push down once nothing else is riding it. Stopping a shared relay push
    // because one destination was removed would take every other destination off the air with it.
    if (session.nativeId && this.destinationsFor(session.nativeId).length === 0) {
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
    // Stopped once per NATIVE stream, not once per destination: relayed destinations share one
    // push, and the second stopStream for the same id is an error the native layer would report.
    const stopped = new Set<string>();
    for (const [destinationId, session] of Array.from(this.sessions.entries())) {
      if (session.nativeId && !stopped.has(session.nativeId)) {
        stopped.add(session.nativeId);
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
    // Between broadcasts, not during one. A new broadcast must not inherit the last one's capacity
    // estimate or the hysteresis that would hold it in the previous decision.
    this.bond.reset();
    this.lastDroppedFrames = 0;

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
    // One native stream, possibly many destinations: when relaying, every destination rides the
    // same push, so a single native event is the news for all of them.
    for (const destinationId of this.destinationsFor(event.id)) {
      this.applyStreamState(event, destinationId);
    }
    this.emitMetrics();
  }

  private applyStreamState(event: StreamStateEvent, destinationId: string): void {
    const session = this.sessions.get(destinationId);
    if (!session) return;

    if (event.bitrateKbps !== undefined) session.bitrateKbps = event.bitrateKbps;
    if (event.droppedFrames !== undefined) session.droppedFrames = event.droppedFrames;
    if (event.bitrateKbps !== undefined) this.observePublish(event);

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

  /**
   * Hand Bond one measurement of the path this device is publishing over.
   *
   * WHAT THIS SURFACE CAN HONESTLY MEASURE, and what it cannot. The native encoder reports the
   * bitrate it is actually achieving and the frames it had to drop because the socket could not
   * keep up. It does NOT report round trip, jitter or RTP loss, so those are left at zero rather
   * than being derived from something that does not mean the same thing -- a dropped-frame count
   * is backpressure, not packet loss, and feeding it in as loss would make the state machine
   * demote a path for a reason it did not have.
   *
   * What Bond therefore does here is the thing that actually matters on a phone: the encoder is
   * asked for 4500 kbps, the radio delivers 1200, and the capacity estimate falls until `decide`
   * says `insufficient` and names a bitrate the network can carry.
   */
  private observePublish(event: StreamStateEvent): void {
    const at = this.now();
    const deliveredBps = (event.bitrateKbps ?? 0) * 1000;
    const offeredBps = this.targetKbps * 1000;
    const total = event.droppedFrames ?? this.lastDroppedFrames;
    const newlyDropped = Math.max(0, total - this.lastDroppedFrames);
    this.lastDroppedFrames = total;

    this.bond.observe(
      'radio',
      {
        at,
        throughputBps: deliveredBps,
        rttMs: 0,
        jitterMs: 0,
        loss: 0,
        retransmitRate: 0,
        // Frames dropped since the last sample mean the socket is behind, which is exactly what
        // "this path is being asked for everything it has" means on a native encoder.
        atCapacity: newlyDropped > 0 || (offeredBps > 0 && deliveredBps < offeredBps * 0.95),
      },
      { transport: 'cellular', label: 'Mobile network', metered: 'unknown' },
      offeredBps,
    );
  }

  private emitMetrics(): void {
    const sessions = Array.from(this.sessions.values());
    const kbps = sessions.reduce((sum, s) => sum + s.bitrateKbps, 0);
    const dropped = sessions.reduce((max, s) => Math.max(max, s.droppedFrames), 0);
    /*
     * Thermal pressure is a real Bond input that only a phone has, and it belongs in the decision
     * rather than in a separate warning: a device that is throttling cannot sustain the bitrate it
     * managed a minute ago, and the encoder should be told before the OS decides for it.
     */
    const bonded = this.bond.paths().length > 0
      ? this.bond.decide(this.targetKbps * 1000, this.now(), {
          thermalPressure: this.thermalLevel === 'serious' || this.thermalLevel === 'critical',
        })
      : null;
    this.emitter.emit('metrics', {
      encodedKbps: kbps,
      targetKbps: this.targetKbps,
      // The native libraries report dropped frames, not an encoder-lag percentage; report 0
      // rather than inventing a number.
      encoderDroppedPct: 0,
      networkDroppedPct: dropped > 0 && this.targetFps > 0 ? Math.min(100, dropped) : 0,
      renderFps: this.targetFps,
      targetFps: this.targetFps,
      ...(bonded ? { connectionHealth: bonded.health, recommendedKbps: Math.round(bonded.encoderCeilingBps / 1000) } : {}),
      updatedAt: this.now(),
    });
  }
}

/** A Moment's first visible camera layer decides which physical camera the phone uses. */
function cameraFromMoment(moment: Moment): LiveStreamCamera | undefined {
  const cam = moment.layers.find((l): l is CameraLayer => l.kind === 'camera' && l.visible);
  if (!cam) return undefined;
  /*
   * `facing` is the question being asked, and it is asked directly now.
   *
   * This used to read `mirror`, because a selfie shot happens to want both the front lens and a
   * mirrored self-view. Conflating them meant the phone's lens was chosen by a render transform,
   * so un-mirroring the broadcast - which had to happen, it was sending every sign and t-shirt
   * out backwards - would silently have pointed every phone at its rear camera.
   *
   * `mirror` is still consulted, but only as a fallback for a Moment saved before `facing`
   * existed, where it is the only evidence of what the creator meant.
   */
  if (cam.facing) return cam.facing === 'environment' ? 'back' : 'front';
  return cam.mirror === false ? 'back' : 'front';
}

function isMuted(moment: Moment): boolean {
  return moment.audio.micMuted === true;
}
