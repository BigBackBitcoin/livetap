/**
 * Injectable browser dependencies.
 *
 * Every platform API the BrowserEngine touches arrives through this object so the engine can be
 * unit-tested in happy-dom with fakes: no camera, no GPU, no network.
 *
 * The `*Like` interfaces use method shorthand on purpose - method parameters are bivariant, so the
 * real DOM objects satisfy them without casts, while a small test fake also does.
 */
import type { CompositorCanvas } from '../compositor/types.js';
import type { FetchLike, RTCPeerConnectionCtor } from '../whip/WhipClient.js';

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices?(): Promise<MediaDeviceInfo[]>;
}

/** Options we pass to getDisplayMedia (kept local so a fake needs nothing from lib.dom). */
export interface DisplayMediaOptions {
  video?: boolean | MediaTrackConstraints;
  audio?: boolean | MediaTrackConstraints;
}

export type GetDisplayMediaLike = (options: DisplayMediaOptions) => Promise<MediaStream>;

export interface MediaRecorderLike {
  readonly state?: string;
  readonly mimeType?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onstop: (() => void) | null;
  start(timesliceMs?: number): void;
  stop(): void;
}

export interface MediaRecorderOptionsLike {
  mimeType?: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
}

export interface MediaRecorderCtorLike {
  new (stream: MediaStream, options?: MediaRecorderOptionsLike): MediaRecorderLike;
  isTypeSupported?(type: string): boolean;
}

export interface AudioParamLike {
  value: number;
}

export interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface MediaStreamAudioDestinationLike extends AudioNodeLike {
  stream: MediaStream;
}

export interface AudioContextLike {
  readonly state?: string;
  readonly destination: unknown;
  createGain(): GainNodeLike;
  createMediaStreamSource(stream: MediaStream): AudioNodeLike;
  createMediaStreamDestination(): MediaStreamAudioDestinationLike;
  resume?(): Promise<void>;
  close?(): Promise<void>;
}

export type AudioContextCtorLike = new () => AudioContextLike;

/** Just enough of WebCodecs' VideoEncoder to probe for a hardware encoder. */
export interface VideoEncoderProbeLike {
  isConfigSupported?(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
}

/** A relay that turns one WHIP session into RTMP/SRT fan-out (LIVETAP ships MediaMTX for this). */
export interface RelayOptions {
  /** Base URL of the WHIP relay, e.g. https://relay.livetap.app/whip */
  whipBaseUrl: string;
  /** Bearer token for the relay. Never logged. */
  token?: string;
  /**
   * Exact WHIP endpoint for a relay SESSION created through infra/relay's session API
   * (`POST /sessions` -> `{ whipUrl }`). When set, every output shares ONE WHIP session and the
   * relay derives 9:16 / 1:1 formats server-side; `whipBaseUrl` is ignored for endpoint building.
   */
  whipUrl?: string;
}

export interface BrowserEngineOptions {
  mediaDevices?: MediaDevicesLike | null;
  getDisplayMedia?: GetDisplayMediaLike | null;
  MediaRecorderCtor?: MediaRecorderCtorLike | null;
  RTCPeerConnectionCtor?: RTCPeerConnectionCtor | null;
  fetch?: FetchLike | null;
  /** Creates the composite canvas. Defaults to document.createElement('canvas'). */
  createCanvas?: (width: number, height: number) => CompositorCanvas;
  /** Creates the <video> elements the compositor draws from. */
  createVideoElement?: () => HTMLVideoElement | null;
  AudioContextCtor?: AudioContextCtorLike | null;
  VideoEncoderProbe?: VideoEncoderProbeLike | null;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  raf?: (callback: (timestampMs: number) => void) => number;
  caf?: (handle: number) => void;
  /** When set, RTMP/RTMPS/SRT outputs are published as one WHIP session per aspect ratio. */
  relay?: RelayOptions;
  /** How long a camera/screen capture is kept alive after a Moment stops using it. */
  keepSourceWarmMs?: number;
  /** Optional sink for recording chunks (so long recordings are not kept in memory). */
  onChunk?: (chunk: Blob, index: number) => void;
  /** Statistics polling interval for WHIP outputs. Default 2000ms. */
  statsIntervalMs?: number;
  /** Engine metrics interval. Default 1000ms. */
  metricsIntervalMs?: number;
}

/** Resolved dependency set with defaults filled in from the current environment. */
export interface ResolvedDeps {
  mediaDevices: MediaDevicesLike | null;
  getDisplayMedia: GetDisplayMediaLike | null;
  MediaRecorderCtor: MediaRecorderCtorLike | null;
  RTCPeerConnectionCtor: RTCPeerConnectionCtor | null;
  fetch: FetchLike | null;
  createCanvas: (width: number, height: number) => CompositorCanvas;
  createVideoElement: () => HTMLVideoElement | null;
  AudioContextCtor: AudioContextCtorLike | null;
  VideoEncoderProbe: VideoEncoderProbeLike | null;
  now: () => number;
  setTimeoutFn: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  raf: ((callback: (timestampMs: number) => void) => number) | undefined;
  caf: ((handle: number) => void) | undefined;
}

interface BrowserGlobals {
  navigator?: {
    mediaDevices?: {
      getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
      getDisplayMedia?: (options: unknown) => Promise<MediaStream>;
      enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
    };
    userAgent?: string;
  };
  document?: {
    createElement?: (tag: string) => unknown;
  };
  MediaRecorder?: unknown;
  RTCPeerConnection?: unknown;
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
  VideoEncoder?: unknown;
  fetch?: unknown;
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

function g(): BrowserGlobals {
  return globalThis as unknown as BrowserGlobals;
}

/** Fill unspecified dependencies from the current environment. `null` explicitly disables one. */
export function resolveDeps(options: BrowserEngineOptions): ResolvedDeps {
  const env = g();
  const nav = env.navigator;
  const md = nav?.mediaDevices;

  const mediaDevices =
    options.mediaDevices !== undefined
      ? options.mediaDevices
      : md && typeof md.getUserMedia === 'function'
        ? ({
            getUserMedia: (constraints: MediaStreamConstraints) => md.getUserMedia!(constraints),
            enumerateDevices: md.enumerateDevices ? () => md.enumerateDevices!() : undefined,
          } as MediaDevicesLike)
        : null;

  const getDisplayMedia =
    options.getDisplayMedia !== undefined
      ? options.getDisplayMedia
      : md && typeof md.getDisplayMedia === 'function'
        ? (opts: DisplayMediaOptions) => md.getDisplayMedia!(opts)
        : null;

  const MediaRecorderCtor =
    options.MediaRecorderCtor !== undefined
      ? options.MediaRecorderCtor
      : typeof env.MediaRecorder === 'function'
        ? (env.MediaRecorder as unknown as MediaRecorderCtorLike)
        : null;

  const RTCPeerConnectionCtor =
    options.RTCPeerConnectionCtor !== undefined
      ? options.RTCPeerConnectionCtor
      : typeof env.RTCPeerConnection === 'function'
        ? (env.RTCPeerConnection as unknown as RTCPeerConnectionCtor)
        : null;

  const fetchFn =
    options.fetch !== undefined
      ? options.fetch
      : typeof env.fetch === 'function'
        ? ((env.fetch as unknown as FetchLike) as FetchLike)
        : null;

  const AudioCtor =
    options.AudioContextCtor !== undefined
      ? options.AudioContextCtor
      : typeof env.AudioContext === 'function'
        ? (env.AudioContext as unknown as AudioContextCtorLike)
        : typeof env.webkitAudioContext === 'function'
          ? (env.webkitAudioContext as unknown as AudioContextCtorLike)
          : null;

  const VideoEncoderProbe =
    options.VideoEncoderProbe !== undefined
      ? options.VideoEncoderProbe
      : env.VideoEncoder
        ? (env.VideoEncoder as unknown as VideoEncoderProbeLike)
        : null;

  const createCanvas =
    options.createCanvas ??
    ((width: number, height: number): CompositorCanvas => {
      const el = env.document?.createElement?.('canvas') as CompositorCanvas | undefined;
      if (!el) throw new Error('No canvas implementation available in this environment');
      el.width = width;
      el.height = height;
      return el;
    });

  const createVideoElement =
    options.createVideoElement ??
    ((): HTMLVideoElement | null => (env.document?.createElement?.('video') as HTMLVideoElement | undefined) ?? null);

  return {
    mediaDevices,
    getDisplayMedia,
    MediaRecorderCtor,
    RTCPeerConnectionCtor,
    fetch: fetchFn,
    createCanvas,
    createVideoElement,
    AudioContextCtor: AudioCtor,
    VideoEncoderProbe,
    now: options.now ?? (() => Date.now()),
    setTimeoutFn: options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimeoutFn: options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    raf: options.raf ?? (typeof env.requestAnimationFrame === 'function' ? (cb) => env.requestAnimationFrame!(cb) : undefined),
    caf: options.caf ?? (typeof env.cancelAnimationFrame === 'function' ? (h) => env.cancelAnimationFrame!(h) : undefined),
  };
}

/**
 * Whether this browser can plausibly capture system/tab audio with getDisplayMedia.
 * Chromium only (Firefox and Safari ignore the audio constraint). Heuristic, reported honestly.
 */
export function probablySupportsDisplayAudio(): boolean {
  const ua = g().navigator?.userAgent ?? '';
  if (!ua) return false;
  if (/firefox|fxios/i.test(ua)) return false;
  if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return false;
  return /chrome|chromium|edg/i.test(ua);
}

/** Recording mime candidates in preference order: fragmented MP4/H.264 first, then WebM. */
export const MP4_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs=avc1',
  'video/mp4',
] as const;

export const WEBM_MIME_CANDIDATES = [
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs=vp9',
  'video/webm;codecs="vp8,opus"',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

/**
 * Pick the best recording mime type this browser supports.
 * `prefer` follows RecordingSettings.container; mp4/avc1 wins by default because it is the only
 * container users can drop straight into most editors and social uploaders.
 */
export function pickRecordingMime(
  ctor: MediaRecorderCtorLike | null,
  prefer: 'mp4' | 'mkv' | 'webm' = 'mp4',
): string | null {
  if (!ctor) return null;
  const supported = (type: string): boolean => {
    try {
      return ctor.isTypeSupported ? ctor.isTypeSupported(type) : false;
    } catch {
      return false;
    }
  };
  const order = prefer === 'webm' ? [...WEBM_MIME_CANDIDATES, ...MP4_MIME_CANDIDATES] : [...MP4_MIME_CANDIDATES, ...WEBM_MIME_CANDIDATES];
  for (const candidate of order) {
    if (supported(candidate)) return candidate;
  }
  // No isTypeSupported at all (older WebViews): let the browser choose its default.
  return ctor.isTypeSupported ? null : '';
}
