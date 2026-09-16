/**
 * Test doubles for the media engine.
 *
 * These exist so BrowserEngine / WhipClient / MomentCompositor can be exercised with no camera,
 * no GPU, no codec and no network - which is exactly the situation on the build host.
 * Not exported from the package entry point: import from './testing/fakes.js' inside tests.
 */
import type { CompositorCanvas } from '../compositor/types.js';
import type {
  AudioContextCtorLike,
  AudioContextLike,
  AudioNodeLike,
  ConstantSourceLike,
  GainNodeLike,
  MediaRecorderCtorLike,
  MediaRecorderLike,
  MediaStreamAudioDestinationLike,
} from '../browser/deps.js';
import type { FetchLike, FetchResponseLike, RTCPeerConnectionCtor } from '../whip/WhipClient.js';

// ------------------------------------------------------------------ canvas

export interface RecordedCall {
  op: string;
  args: unknown[];
}

export interface FakeCanvas {
  canvas: CompositorCanvas;
  calls: RecordedCall[];
  captureStreamCalls: number[];
  stream: FakeMediaStream;
  ops(op: string): RecordedCall[];
  texts(): string[];
}

/** A canvas + 2D context that records every drawing call. */
export function createFakeCanvas(width = 1920, height = 1080): FakeCanvas {
  const calls: RecordedCall[] = [];
  const captureStreamCalls: number[] = [];
  const stream = createFakeMediaStream([createFakeTrack('video')]);
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };

  const ctx = {
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    rect: record('rect'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arcTo: record('arcTo'),
    clip: record('clip'),
    fill: record('fill'),
    stroke: record('stroke'),
    drawImage: record('drawImage'),
    fillText: record('fillText'),
    measureText: (text: string) => ({ width: text.length * 10 }),
    createLinearGradient: () => ({ addColorStop: record('addColorStop') }),
  };

  const canvas: CompositorCanvas = {
    width,
    height,
    getContext: () => ctx,
    captureStream: (fps?: number) => {
      captureStreamCalls.push(fps ?? 0);
      return stream as unknown as MediaStream;
    },
  };

  return {
    canvas,
    calls,
    captureStreamCalls,
    stream,
    ops: (op: string) => calls.filter((c) => c.op === op),
    texts: () => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])),
  };
}

/** A drawable stand-in for a <video> element with known intrinsic dimensions. */
export function createFakeVideoSource(videoWidth = 1280, videoHeight = 720): HTMLVideoElement {
  return {
    videoWidth,
    videoHeight,
    srcObject: null,
    muted: false,
    autoplay: false,
    playsInline: false,
    play: () => Promise.resolve(),
  } as unknown as HTMLVideoElement;
}

// ------------------------------------------------------------------ media streams

export interface FakeTrack {
  kind: 'video' | 'audio';
  id: string;
  readyState: 'live' | 'ended';
  onended: (() => void) | null;
  stop(): void;
  /** Simulate the device vanishing (unplugged, or "Stop sharing" clicked). */
  end(): void;
}

export function createFakeTrack(kind: 'video' | 'audio', id = `${kind}-${Math.random().toString(36).slice(2, 8)}`): FakeTrack {
  const track: FakeTrack = {
    kind,
    id,
    readyState: 'live',
    onended: null,
    stop() {
      track.readyState = 'ended';
    },
    end() {
      track.readyState = 'ended';
      track.onended?.();
    },
  };
  return track;
}

export interface FakeMediaStream {
  id: string;
  tracks: FakeTrack[];
  getTracks(): FakeTrack[];
  getVideoTracks(): FakeTrack[];
  getAudioTracks(): FakeTrack[];
  addTrack(track: FakeTrack): void;
}

export function createFakeMediaStream(tracks: FakeTrack[] = []): FakeMediaStream {
  const list = [...tracks];
  return {
    id: `stream-${Math.random().toString(36).slice(2, 8)}`,
    tracks: list,
    getTracks: () => list,
    getVideoTracks: () => list.filter((t) => t.kind === 'video'),
    getAudioTracks: () => list.filter((t) => t.kind === 'audio'),
    addTrack: (track: FakeTrack) => {
      list.push(track);
    },
  };
}

export function asMediaStream(stream: FakeMediaStream): MediaStream {
  return stream as unknown as MediaStream;
}

// ------------------------------------------------------------------ WebRTC

export interface FakeStatEntry {
  type: string;
  kind?: string;
  bytesSent?: number;
  packetsSent?: number;
  packetsLost?: number;
  framesSent?: number;
  framesDropped?: number;
  qualityLimitationReason?: string;
  /** On `remote-inbound-rtp`. Seconds, as WebRTC reports them; Bond converts to milliseconds. */
  roundTripTime?: number;
  jitter?: number;
}

/** A minimal RTCPeerConnection that never touches the network. */
export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  static reset(): void {
    FakePeerConnection.instances = [];
  }

  iceGatheringState = 'complete';
  iceConnectionState = 'new';
  connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  closed = false;
  stats = new Map<string, FakeStatEntry>();

  readonly config: unknown;
  readonly transceivers: Array<{ trackOrKind: unknown; init: unknown; sender: FakeSender; receiver: { track: null } }> = [];
  readonly codecPreferences: unknown[][] = [];
  offerOptions: unknown[] = [];

  constructor(config?: unknown) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  async createOffer(options?: unknown): Promise<{ type: string; sdp: string }> {
    this.offerOptions.push(options);
    return { type: 'offer', sdp: FAKE_OFFER_SDP };
  }

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = description;
  }

  addTransceiver(trackOrKind: unknown, init?: unknown): { sender: FakeSender; setCodecPreferences(codecs: unknown[]): void } {
    const sender = new FakeSender(typeof trackOrKind === 'object' ? (trackOrKind as FakeTrack) : null);
    const entry = {
      trackOrKind,
      init,
      sender,
      receiver: { track: null },
      setCodecPreferences: (codecs: unknown[]) => {
        this.codecPreferences.push(codecs);
      },
    };
    this.transceivers.push(entry);
    return entry;
  }

  getTransceivers(): unknown[] {
    return this.transceivers;
  }

  getSenders(): FakeSender[] {
    return this.transceivers.map((t) => t.sender);
  }

  async getStats(): Promise<Map<string, FakeStatEntry>> {
    return this.stats;
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  /** Drive ICE to connected so the engine emits outputUp. */
  simulateConnected(): void {
    this.iceConnectionState = 'connected';
    this.connectionState = 'connected';
    this.oniceconnectionstatechange?.();
  }

  simulateFailed(state: 'failed' | 'disconnected' = 'failed'): void {
    this.iceConnectionState = state;
    this.connectionState = state === 'failed' ? 'failed' : 'disconnected';
    this.oniceconnectionstatechange?.();
  }

  setStats(entries: Record<string, FakeStatEntry>): void {
    this.stats = new Map(Object.entries(entries));
  }
}

export class FakeSender {
  parameters: { encodings?: Array<{ maxBitrate?: number; maxFramerate?: number }> } = {};

  constructor(public track: FakeTrack | null) {}

  getParameters(): { encodings?: Array<{ maxBitrate?: number; maxFramerate?: number }> } {
    return this.parameters;
  }

  async setParameters(params: { encodings?: Array<{ maxBitrate?: number; maxFramerate?: number }> }): Promise<void> {
    this.parameters = params;
  }
}

export const FAKE_OFFER_SDP = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:secretsecretsecret',
  'a=candidate:1 1 udp 2130706431 192.168.0.2 50000 typ host',
  'a=sendonly',
].join('\r\n');

export const FAKE_ANSWER_SDP = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', 't=0 0', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=recvonly'].join(
  '\r\n',
);

export function asPeerConnectionCtor(ctor: typeof FakePeerConnection): RTCPeerConnectionCtor {
  return ctor as unknown as RTCPeerConnectionCtor;
}

// ------------------------------------------------------------------ fetch

export interface FakeFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FakeFetchResponseSpec {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: FakeFetchCall[];
}

/**
 * A fetch double. `handler` receives the recorded call and returns the response spec;
 * the default answers a WHIP POST with 201 + Location + an SDP answer.
 */
export function createFakeFetch(handler?: (call: FakeFetchCall) => FakeFetchResponseSpec | Promise<FakeFetchResponseSpec>): FakeFetch {
  const calls: FakeFetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: FakeFetchCall = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    const spec = (await handler?.(call)) ?? {
      status: 201,
      body: FAKE_ANSWER_SDP,
      headers: { Location: '/whip/resource/1', 'Accept-Patch': 'application/trickle-ice-sdpfrag' },
    };
    return makeResponse(spec);
  };
  return { fetch, calls };
}

export function makeResponse(spec: FakeFetchResponseSpec): FetchResponseLike {
  const status = spec.status ?? 200;
  const headers = new Map<string, string>(Object.entries(spec.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => spec.body ?? '',
  };
}

// ------------------------------------------------------------------ MediaRecorder

export class FakeMediaRecorder implements MediaRecorderLike {
  static instances: FakeMediaRecorder[] = [];
  static supported = new Set<string>(['video/mp4;codecs=avc1', 'video/webm;codecs=vp9']);

  static reset(): void {
    FakeMediaRecorder.instances = [];
  }

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.has(type);
  }

  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;
  timeslice: number | undefined;
  readonly mimeType: string;

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'video/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.timeslice = timeslice;
  }

  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }

  /**
   * Push a chunk of `size` bytes as if a timeslice elapsed.
   *
   * The blob carries a real `arrayBuffer()` filled with `fill`, because the desktop engine turns
   * every chunk into bytes and forwards it over IPC - a fake without those bytes would let a
   * chunk-ordering bug pass unnoticed. `resolveAfter` defers the conversion so a test can prove
   * that a slow chunk still reaches the bridge before the chunk behind it.
   */
  emitChunk(size = 1024, fill = 0, resolveAfter?: () => Promise<void>): void {
    const bytes = new Uint8Array(size).fill(fill);
    const blob = {
      size,
      type: this.mimeType,
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        if (resolveAfter) await resolveAfter();
        return bytes.buffer;
      },
    } as unknown as Blob;
    this.ondataavailable?.({ data: blob });
  }
}

export function asMediaRecorderCtor(ctor: typeof FakeMediaRecorder): MediaRecorderCtorLike {
  return ctor as unknown as MediaRecorderCtorLike;
}

// ------------------------------------------------------------------ WebAudio

export function createFakeAudioContextCtor(): { ctor: AudioContextCtorLike; instances: FakeAudioContext[] } {
  const instances: FakeAudioContext[] = [];
  class Ctor extends FakeAudioContext {
    constructor() {
      super();
      instances.push(this);
    }
  }
  return { ctor: Ctor as unknown as AudioContextCtorLike, instances };
}

export class FakeAudioContext implements AudioContextLike {
  readonly state = 'running';
  readonly destination = { id: 'destination' };
  readonly gains: FakeGainNode[] = [];
  readonly sources: MediaStream[] = [];
  destinationStream = createFakeMediaStream([createFakeTrack('audio')]);
  closed = false;

  createGain(): GainNodeLike {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createMediaStreamSource(stream: MediaStream): AudioNodeLike {
    this.sources.push(stream);
    return { connect: () => undefined, disconnect: () => undefined };
  }

  createMediaStreamDestination(): MediaStreamAudioDestinationLike {
    return {
      stream: asMediaStream(this.destinationStream),
      connect: () => undefined,
      disconnect: () => undefined,
    };
  }

  /** Every ConstantSourceNode this context has handed out, so a test can see the silence. */
  readonly constantSources: FakeConstantSource[] = [];

  createConstantSource(): ConstantSourceLike {
    const node = new FakeConstantSource();
    this.constantSources.push(node);
    return node;
  }

  async resume(): Promise<void> {
    /* no-op */
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeConstantSource implements ConstantSourceLike {
  offset = { value: 1 };
  connected = 0;
  started = false;
  stopped = false;

  connect(): unknown {
    this.connected += 1;
    return this;
  }

  disconnect(): void {
    this.connected = 0;
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeGainNode implements GainNodeLike {
  gain = { value: 1 };
  connected = 0;

  connect(): unknown {
    this.connected += 1;
    return this;
  }

  disconnect(): void {
    this.connected = 0;
  }
}
