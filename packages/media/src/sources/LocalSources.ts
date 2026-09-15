/**
 * LocalSources - capture, and nothing else.
 *
 * This is the half of the media pipeline that touches real devices: getUserMedia for cameras and
 * microphones, getDisplayMedia for screens and windows, a <video> element for clip layers, and a
 * WebAudio graph that mixes mic + system audio behind per-source GainNodes.
 *
 * It was extracted out of BrowserEngine because two engines now need exactly this behaviour and
 * differ only in what they do with the composited pixels: BrowserEngine publishes them over WHIP,
 * DesktopEngine encodes them with MediaRecorder and pushes the bytes to the Electron main process.
 * Duplicating device acquisition across the two would mean two places for a permission bug, two
 * places for a track-ended bug, and two answers to "did a camera ever actually open?".
 *
 * It reports, it never decides. A camera that will not open produces `deviceLost` + `engineError`
 * + `layerUnavailable`; what the program then shows is the engine's call, not this file's.
 */
import type { ErrorCode, Moment } from '@livetap/core';
import type { DrawableSource } from '../compositor/types.js';
import type {
  AudioContextLike,
  ConstantSourceLike,
  GainNodeLike,
  MediaStreamAudioDestinationLike,
  ResolvedDeps,
} from '../browser/deps.js';

const DEFAULT_WARM_MS = 5000;

export type SourceKind = 'camera' | 'screen' | 'window' | 'video';

export interface SourceEntry {
  layerId: string;
  kind: SourceKind;
  /** deviceId for cameras, sourceId for screens, src for video layers. */
  key: string;
  stream: MediaStream | null;
  element: HTMLVideoElement | null;
  releaseTimer?: unknown;
}

/**
 * How a capture failure reaches the engine. Every one of these is a statement about the real
 * world, so none of them is optional and none of them is swallowed here.
 */
export interface LocalSourcesCallbacks {
  deviceLost(kind: 'camera' | 'mic' | 'screen', deviceId?: string): void;
  engineError(code: ErrorCode, technical: string): void;
  /** This layer has no source any more, and here is the reason in the operator's language. */
  layerUnavailable(layerId: string, reason: string): void;
}

export interface LocalSourcesOptions {
  deps: ResolvedDeps;
  callbacks: LocalSourcesCallbacks;
  /** How long a capture is kept alive after a Moment stops using it. Default 5000 ms. */
  keepSourceWarmMs?: number;
}

export class LocalSources {
  private readonly deps: ResolvedDeps;
  private readonly callbacks: LocalSourcesCallbacks;
  private readonly warmMs: number;

  private readonly sources = new Map<string, SourceEntry>();
  private micStream: MediaStream | null = null;
  private micKey: string | null = null;
  private systemAudioStream: MediaStream | null = null;

  private audioContext: AudioContextLike | null = null;
  /** The silent heartbeat that keeps the mix rendering when nothing else is connected. */
  private silence: ConstantSourceLike | null = null;
  private audioDestination: MediaStreamAudioDestinationLike | null = null;
  private micGain: GainNodeLike | null = null;
  private systemGain: GainNodeLike | null = null;

  private captureSucceeded = false;
  /**
   * Set only once a getDisplayMedia stream has actually handed us an audio track.
   *
   * MDN says browsers MAY ignore the audio hint and "the returned stream might contain no audio
   * track even when `audio` is true", and on macOS screen capture historically returns none at
   * all. So the capability starts false and is only ever raised by evidence.
   */
  private systemAudioSeen = false;

  constructor(options: LocalSourcesOptions) {
    this.deps = options.deps;
    this.callbacks = options.callbacks;
    this.warmMs = options.keepSourceWarmMs ?? DEFAULT_WARM_MS;
  }

  /** True once any getUserMedia / getDisplayMedia call has actually returned a stream. */
  get liveCaptureSucceeded(): boolean {
    return this.captureSucceeded;
  }

  /** True only once a display capture really produced an audio track on this machine. */
  get systemAudioObserved(): boolean {
    return this.systemAudioSeen;
  }

  get microphoneStream(): MediaStream | null {
    return this.micStream;
  }

  /** The `MediaSourceResolver` the compositors draw through. */
  resolve = (layerId: string): DrawableSource | null => {
    return this.sources.get(layerId)?.element ?? null;
  };

  /** Acquire what the Moment needs, keep what it still uses, retire the rest (warm for 5 s). */
  async sync(moment: Moment): Promise<void> {
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
    this.refreshGains(moment);
  }

  /** Release every device and tear the audio graph down. */
  stopAll(): void {
    for (const entry of Array.from(this.sources.values())) this.release(entry, true);
    this.sources.clear();
    stopStream(this.micStream);
    this.micStream = null;
    this.micKey = null;
    stopStream(this.systemAudioStream);
    this.systemAudioStream = null;
    this.teardownAudio();
  }

  // ---------------------------------------------------------------- video

  private scheduleRelease(entry: SourceEntry): void {
    if (entry.releaseTimer !== undefined) return;
    // Keep the capture warm briefly: tapping between Moments must not flash the camera light.
    entry.releaseTimer = this.deps.setTimeoutFn(() => {
      entry.releaseTimer = undefined;
      if (this.sources.get(entry.layerId) !== entry) return;
      this.release(entry, true);
      this.sources.delete(entry.layerId);
    }, this.warmMs);
  }

  private release(entry: SourceEntry, stopTracks: boolean): void {
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
      this.release(existing, true);
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
      this.captureSucceeded = true;
    } catch (err) {
      this.callbacks.deviceLost('camera', deviceId);
      this.callbacks.engineError('CAMERA_LOST', describe(err));
      this.callbacks.layerUnavailable(layerId, 'Camera unavailable');
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
      this.callbacks.deviceLost('screen');
      this.callbacks.layerUnavailable(layerId, 'Screen sharing not supported');
      return;
    }
    if (existing) {
      this.release(existing, true);
      this.sources.delete(layerId);
    }
    try {
      // Lazily prompted: only when a Moment actually shows a screen layer.
      const stream = await getDisplayMedia({ video: true, audio: captureSystemAudio });
      this.registerSource(layerId, kind, sourceId, stream);
      this.watchTracks(stream, 'screen', layerId, sourceId);
      const audio = stream.getAudioTracks?.() ?? [];
      // The only honest proof that this environment can capture system audio.
      if (audio.length > 0) this.systemAudioSeen = true;
      if (captureSystemAudio && audio.length > 0) this.systemAudioStream = stream;
      this.captureSucceeded = true;
    } catch (err) {
      this.callbacks.deviceLost('screen');
      this.callbacks.engineError('SCREEN_DENIED', describe(err));
      this.callbacks.layerUnavailable(layerId, 'Screen sharing stopped');
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
      /* a clip that will not play leaves the layer empty; the program keeps rendering */
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
    this.callbacks.deviceLost(kind, deviceId);
    if (kind === 'mic') {
      stopStream(this.micStream);
      this.micStream = null;
      this.micKey = null;
      this.callbacks.layerUnavailable('__mic__', 'Microphone disconnected');
      return;
    }
    const entry = this.sources.get(layerId);
    if (entry) {
      this.release(entry, true);
      this.sources.delete(layerId);
    }
    this.callbacks.layerUnavailable(layerId, kind === 'camera' ? 'Camera disconnected' : 'Screen sharing stopped');
  }

  // ---------------------------------------------------------------- audio

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
      this.captureSucceeded = true;
    } catch (err) {
      this.micKey = null;
      this.callbacks.deviceLost('mic', audio.micDeviceId);
      this.callbacks.engineError('MIC_LOST', describe(err));
    }
  }

  /**
   * Mix mic + system audio through per-source GainNodes so micGain/systemGain/mute are
   * instantaneous and do not require re-acquiring a device.
   *
   * The returned stream is stable across calls: every output that needs audio adds the SAME
   * tracks, so a second format costs no second microphone.
   */
  buildAudioMix(moment: Moment | null): MediaStream | null {
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
      /*
       * A SILENT HEARTBEAT, so the mix always has a live input.
       *
       * With no microphone and no system audio — a server, a laptop with the mic disabled,
       * anyone who picked "No microphone" — nothing above connects, and the destination node is
       * left with NO inputs at all. Its track still reports `readyState: "live"`, which is what
       * made this so hard to see, but a WebAudio graph with nothing connected to the destination
       * has no reason to render, so the track delivers no audio frames. `MediaRecorder` will not
       * emit a chunk until every track in its stream has produced data, so the recorder stalls
       * before the first chunk, the encoder ffmpeg receives nothing, and the sender ffmpeg never
       * writes a header — which is why, on a host with no capture devices, six ffmpeg processes
       * spawn and not one of them ever opens a TCP connection to the server.
       *
       * Measured on the owner's build host: with a capture device, 3 of 3 publishers and three
       * shapes decoded off disk; without one, 0 of 3 and not a single `[RTMP] conn opened` line
       * in the receiver's log. See docs/qa/NO_CAPTURE_DEVICE_DEFECT.md.
       *
       * A ConstantSourceNode at offset 0 is exactly silence, costs one node, and gives the graph
       * a reason to pull forever. It is also what the product already TELLS the creator it does:
       * "LIVETAP is streaming silence rather than stopping your broadcast."
       */
      if (!this.silence && typeof ctx.createConstantSource === 'function') {
        try {
          const quiet = ctx.createConstantSource();
          quiet.offset.value = 0;
          quiet.connect(destination);
          quiet.start();
          this.silence = quiet;
        } catch {
          /* An engine without ConstantSourceNode keeps the old behaviour rather than failing. */
        }
      }

      if (moment) this.refreshGains(moment);
      void ctx.resume?.().catch?.(() => undefined);
      return destination.stream;
    } catch {
      return this.micStream;
    }
  }

  refreshGains(moment: Moment): void {
    const audio = moment.audio;
    if (this.micGain) this.micGain.gain.value = audio.micMuted ? 0 : clampGain(audio.micGain);
    if (this.systemGain) this.systemGain.gain.value = audio.systemAudio ? clampGain(audio.systemGain) : 0;
  }

  private teardownAudio(): void {
    try {
      this.micGain?.disconnect();
      this.systemGain?.disconnect();
      this.silence?.stop?.();
      this.silence?.disconnect();
      void this.audioContext?.close?.().catch?.(() => undefined);
    } catch {
      /* ignore */
    }
    this.micGain = null;
    this.systemGain = null;
    this.silence = null;
    this.audioDestination = null;
    this.audioContext = null;
  }
}

// -------------------------------------------------------------------- helpers

export function hasLiveTrack(stream: MediaStream | null): boolean {
  if (!stream) return false;
  const tracks = stream.getTracks?.() ?? [];
  return tracks.some((track) => track.readyState !== 'ended');
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks?.() ?? []) {
    try {
      track.stop?.();
    } catch {
      /* ignore */
    }
  }
}

function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(2, Math.max(0, gain));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
