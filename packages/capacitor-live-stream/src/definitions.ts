/**
 * LiveStream — the LIVETAP native streaming plugin contract.
 *
 * This is the OUTPUT side of the media pipeline on a phone: the native layer owns the camera,
 * the microphone, the H.264/AAC encoders and the RTMP/RTMPS socket. The WebView owns the UI only.
 *
 * Why the WebView cannot do this itself (docs/research/DESKTOP_MOBILE_STORE_RESEARCH.md section 2.3):
 * - A browser/WebView cannot speak RTMP at all — it has no socket API for it.
 * - WKWebView `getUserMedia` audio has been reported to mute when the app is backgrounded, so a
 *   WebView-owned capture path cannot survive a phone call or a notification pull-down.
 * Therefore the native encoder owns capture, and the WebView never calls `getUserMedia` on mobile.
 *
 * Implementations:
 * - iOS     → HaishinKit.swift 2.0.9 (BSD-3-Clause): `MediaMixer` + `RTMPConnection` + `RTMPStream`
 * - Android → RootEncoder 2.8.1 (Apache-2.0): `GenericStream` + `Camera2Source` + `MicrophoneSource`
 * - Web     → throws (see web.ts). There is no browser fallback; the web app uses BrowserEngine.
 *
 * Everything native in this contract is UNVERIFIED on the build host: no Xcode, no Android SDK,
 * no device. See docs/architecture/MOBILE_ARCHITECTURE.md for the verification table.
 */
import type { ErrorCode } from '@livetap/core';
import type { PluginListenerHandle } from '@capacitor/core';

/** Aspect ratios the native capture pipeline can be configured for. Mirrors core `AspectRatio`. */
export type LiveStreamAspect = '9:16' | '16:9' | '1:1';

export type LiveStreamCamera = 'front' | 'back';

/**
 * One RTMP/RTMPS push. `connecting` is reported immediately by `startStream`; every later
 * transition arrives on the `streamState` listener and never as a thrown error, so one failing
 * destination can never take down a sibling (ADR-008).
 */
export type LiveStreamState = 'connecting' | 'connected' | 'degraded' | 'disconnected' | 'failed';

/** What the native layer can actually do on THIS device, right now. Never a guess. */
export interface LiveStreamCapabilities {
  /** Native camera capture is available and permitted. */
  camera: boolean;
  /** Native microphone capture is available and permitted. */
  microphone: boolean;
  /** RTMP push. True on a working native build; false on web. */
  rtmp: boolean;
  /** RTMPS (RTMP over TLS). The LIVETAP default for every platform that offers it. */
  rtmps: boolean;
  /**
   * SRT. Android: RootEncoder supports it. iOS: HaishinKit supports it from 2.x.
   * NOTE: SRT with a passphrase turns on AES inside the library, which changes the iOS
   * export-compliance answer (`ITSAppUsesNonExemptEncryption`). Keep it false until legal has
   * signed off — see docs/release/APP_STORE_READINESS.md item A22.
   */
  srt: boolean;
  /** HEVC output. Device- and platform-dependent; do not assume. */
  hevc: boolean;
  /** Local recording to the app sandbox while streaming. */
  recording: boolean;
  /**
   * Whether the camera keeps producing frames when the app is backgrounded.
   * iOS: false unless the app holds `com.apple.developer.avfoundation.multitasking-camera-access`
   * (an Apple-gated request). Android: true while a `camera` foreground service is running.
   */
  backgroundCamera: boolean;
  /** Whether audio keeps flowing when backgrounded (iOS: UIBackgroundModes audio; Android: FGS). */
  backgroundAudio: boolean;
  /** Screen capture (iOS ReplayKit / Android MediaProjection). Post-MVP; expected false. */
  screenCapture: boolean;
  /**
   * How many simultaneous RTMP pushes the native layer will accept — 1 to 2 in practice. A phone
   * encodes once, but every extra push is another TLS socket and another packetiser, and the
   * thermal budget runs out fast. Multi-destination on mobile belongs behind a relay in
   * LIVETAP CLOUD (ADR-009), not in more `startStream` calls.
   */
  maxSimultaneousStreams: number;
  /** Honest verification status of this implementation in this environment. */
  verification: 'PASS' | 'SIMULATED' | 'UNVERIFIED' | 'UNAVAILABLE';
  /** Free-form platform note for Pro Mode diagnostics. Never shown in Simple Mode. */
  platformNote?: string;
}

export interface StartPreviewOptions {
  camera: LiveStreamCamera;
  /** Capture aspect. LIVETAP mobile defaults to 9:16 (vertical-first, prompt pack section 09). */
  aspect: LiveStreamAspect;
}

export interface SetMuteOptions {
  muted: boolean;
}

/**
 * One output per call. Multiple destinations means multiple calls, each with its own id.
 * The native layer shares one encoder across calls where the platform library allows it; the
 * plugin refuses calls past `capabilities().maxSimultaneousStreams`.
 */
export interface StartStreamOptions {
  /** Ingest base URL, e.g. `rtmps://a.rtmps.youtube.com/live2`. Must be rtmp: or rtmps:. */
  url: string;
  /** Stream key. Appended to `url` by the native layer. Never logged, never echoed in events. */
  streamKey: string;
  videoKbps: number;
  audioKbps: number;
  width: number;
  height: number;
  fps: number;
  /** Keyframe interval in seconds. Platforms want 2s; YouTube requires 4s or less. */
  keyframeSeconds: number;
}

export interface StartStreamResult {
  /** Opaque native id for this output. Pass it to `stopStream`; it appears in every event. */
  id: string;
}

export interface StopStreamOptions {
  id: string;
}

export interface StartRecordingResult {
  /** Absolute sandbox path the recording is being written to. */
  path: string;
}

export interface StopRecordingResult {
  /** Absolute sandbox path of the finished file, if one was written. */
  path?: string;
  durationMs?: number;
}

/**
 * Emitted on every state transition of every output, plus periodic health while `connected`.
 * `code` is a core `ErrorCode` so the web layer reuses `humanizeError` unchanged.
 */
export interface StreamStateEvent {
  id: string;
  state: LiveStreamState;
  code?: ErrorCode;
  bitrateKbps?: number;
  droppedFrames?: number;
  /** Technical detail for Pro Mode. Must never contain the stream key. */
  technical?: string;
}

/** Emitted when the OS takes the camera or mic away (phone call, another app, backgrounding). */
export interface DeviceLostEvent {
  kind: 'camera' | 'mic';
  /** True when the native layer expects to get the device back by itself. */
  recoverable: boolean;
  technical?: string;
}

/** Emitted on thermal pressure so the UI can step quality down before the OS throttles. */
export interface ThermalEvent {
  /** Normalised across iOS `ProcessInfo.thermalState` and Android `PowerManager` thermal status. */
  level: 'nominal' | 'fair' | 'serious' | 'critical';
}

export interface LiveStreamPlugin {
  /** What this device can actually do. Call before showing any streaming UI. */
  capabilities(): Promise<LiveStreamCapabilities>;

  /**
   * Start camera + mic capture and render the preview behind the WebView.
   * Rejects if permissions are not granted — request them from the UI first.
   */
  startPreview(options: StartPreviewOptions): Promise<void>;
  stopPreview(): Promise<void>;
  switchCamera(): Promise<void>;
  setMute(options: SetMuteOptions): Promise<void>;

  /**
   * Start one RTMP/RTMPS push. Resolves as soon as the connection attempt is handed to the native
   * library (state `connecting`); success or failure arrives via `streamState`.
   */
  startStream(options: StartStreamOptions): Promise<StartStreamResult>;
  /** Stop one output. Other outputs, the preview and any recording keep running. */
  stopStream(options: StopStreamOptions): Promise<void>;

  /** Record the encoded program to the app sandbox. Shares the encoder with the live outputs. */
  startRecording(): Promise<StartRecordingResult>;
  stopRecording(): Promise<StopRecordingResult>;

  addListener(
    eventName: 'streamState',
    listener: (event: StreamStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'deviceLost',
    listener: (event: DeviceLostEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'thermal',
    listener: (event: ThermalEvent) => void,
  ): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}
