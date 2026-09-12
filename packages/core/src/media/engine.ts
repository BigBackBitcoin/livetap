import type { EngineMetrics } from '../types/health.js';
import type { IngestTarget, AspectRatio, ErrorCode } from '../types/destination.js';
import type { OutputFormat, RecordingSettings, EncoderSettings } from '../types/production.js';
import type { Moment } from '../types/moment.js';

/**
 * One network output the engine must feed.
 * Several outputs may share the same aspect ratio → the engine encodes once per format and fans out.
 */
export interface EngineOutput {
  destinationId: string;
  aspectRatio: AspectRatio;
  ingest: IngestTarget;
}

export interface EngineStartRequest {
  formats: Record<AspectRatio, OutputFormat | undefined>;
  outputs: EngineOutput[];
  encoder: EncoderSettings;
  recording: RecordingSettings;
}

export type EngineOutputEvent =
  | { type: 'outputUp'; destinationId: string }
  | { type: 'outputDegraded'; destinationId: string; technical?: string }
  | { type: 'outputRecovered'; destinationId: string }
  | { type: 'outputLost'; destinationId: string; code: ErrorCode; technical?: string }
  | { type: 'outputStopped'; destinationId: string };

export interface EngineEvents extends Record<string, unknown> {
  metrics: EngineMetrics;
  output: EngineOutputEvent;
  engineError: { code: ErrorCode; technical?: string };
  recording: { state: 'started' | 'stopped' | 'failed'; path?: string; code?: ErrorCode };
  deviceLost: { kind: 'camera' | 'mic' | 'screen'; deviceId?: string };
}

/**
 * MediaEngine: capture + composite + encode + distribute.
 * Implementations: BrowserEngine (web/mobile WebView), FfmpegEngine (Electron main), MockEngine (tests/demo).
 */
export interface MediaEngine {
  readonly kind: 'browser' | 'ffmpeg' | 'mock' | 'native';
  /** Which capabilities this engine actually has in this environment. */
  capabilities(): Promise<EngineCapabilities>;

  /** Start preview (capture + composite) without any network output. */
  startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void>;
  stopPreview(): Promise<void>;
  /** Switch the active Moment (transition handled by the engine). */
  setMoment(moment: Moment): Promise<void>;

  /** Start encoding + all outputs. Individual output failures are reported via events, never thrown. */
  start(req: EngineStartRequest): Promise<void>;
  /** Add an output while live (e.g. re-adding a recovered destination). */
  addOutput(output: EngineOutput): Promise<void>;
  /** Remove a single output while others keep going. */
  removeOutput(destinationId: string): Promise<void>;
  /** Stop everything (outputs, recording, encoder). Preview may continue. */
  stop(): Promise<void>;

  startRecording?(settings: RecordingSettings): Promise<void>;
  stopRecording?(): Promise<{ path?: string; blob?: Blob }>;

  on<K extends keyof EngineEvents>(event: K, listener: (payload: EngineEvents[K]) => void): () => void;
}

export interface EngineCapabilities {
  camera: boolean;
  microphone: boolean;
  screen: boolean;
  window: boolean;
  systemAudio: boolean;
  /** Can push RTMP/RTMPS directly (desktop), or needs a relay (browser → WHIP). */
  rtmp: boolean;
  srt: boolean;
  whip: boolean;
  recording: boolean;
  hardwareEncoders: Array<'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'webcodecs'>;
  /** Max simultaneous distinct formats this engine can encode. */
  maxFormats: number;
  /** Honest verification status of this engine in the current environment. */
  verification: 'PASS' | 'SIMULATED' | 'UNVERIFIED' | 'UNAVAILABLE';
}
