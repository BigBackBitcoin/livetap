/**
 * MockEngine - a deterministic, timer-driven MediaEngine for demos, E2E and unit tests.
 *
 * It never touches a camera, a codec or a socket. Everything it reports is clearly a simulation:
 * `capabilities().verification` is 'SIMULATED' so no screen can ever claim a verified encoder
 * because the mock said so.
 *
 * Failures are scripted, not random, so an E2E test can assert "destination 2 drops at 3s and
 * reconnects" without flakiness.
 */
import { TypedEmitter, formatForPreset } from '@livetap/core';
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
import type { CompositorCanvas } from '../compositor/types.js';

export interface MockScenario {
  /** Drop one output after `afterMs` from start() with the given error code. */
  failOutput?: { destinationId: string; afterMs: number; code?: ErrorCode };
  /** Degrade one output, optionally recovering it later. */
  degradeOutput?: { destinationId: string; afterMs: number; recoverAfterMs?: number };
  /** Emit deviceLost after `afterMs`. */
  dropDevice?: { kind: 'camera' | 'mic' | 'screen'; afterMs: number };
  /** Emit engineError ENCODER_FAILED and drop every output. */
  encoderCrashAfterMs?: number;
}

export interface MockEngineOptions {
  /** Delay before `outputUp` for each output. Default 800ms. */
  connectDelayMs?: number;
  /** Metrics cadence. Default 1000ms. */
  metricsIntervalMs?: number;
  scenario?: MockScenario;
  /** How many `addOutput` calls should fail before one succeeds. Default 0 (always succeeds). */
  reconnectFailsTimes?: number;
  /** Seed for the metrics noise so runs are reproducible. */
  seed?: number;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Canvas factory for the generated preview pattern. */
  createCanvas?: (width: number, height: number) => CompositorCanvas;
}

interface MockSession {
  output: EngineOutput;
  state: 'connecting' | 'up' | 'degraded' | 'lost' | 'stopped';
}

const PATTERN_FPS = 12;

export class MockEngine extends TypedEmitter<EngineEvents> implements MediaEngine {
  readonly kind = 'mock' as const;

  private readonly connectDelayMs: number;
  private readonly metricsIntervalMs: number;
  private readonly scenario: MockScenario;
  private readonly reconnectFailsTimes: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly createCanvas: ((width: number, height: number) => CompositorCanvas) | undefined;

  private readonly sessions = new Map<string, MockSession>();
  private readonly timers = new Set<unknown>();
  private readonly random: () => number;
  private formats: Partial<Record<AspectRatio, OutputFormat>> = {};
  private masterAspect: AspectRatio = '16:9';
  private activeMoment: Moment | null = null;
  private previewing = false;
  private live = false;
  private recording = false;
  private addOutputAttempts = 0;
  private metricsTick = 0;

  private patternCanvas: CompositorCanvas | null = null;
  private patternTimer: unknown = null;
  private patternPhase = 0;

  constructor(options: MockEngineOptions = {}) {
    super();
    this.connectDelayMs = options.connectDelayMs ?? 800;
    this.metricsIntervalMs = options.metricsIntervalMs ?? 1000;
    this.scenario = options.scenario ?? {};
    this.reconnectFailsTimes = options.reconnectFailsTimes ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.createCanvas = options.createCanvas ?? defaultCanvasFactory();
    this.random = mulberry32(options.seed ?? 0x5eed1234);
  }

  async capabilities(): Promise<EngineCapabilities> {
    return {
      camera: true,
      microphone: true,
      screen: true,
      window: true,
      systemAudio: true,
      rtmp: true,
      srt: true,
      whip: true,
      recording: true,
      hardwareEncoders: [],
      maxFormats: 3,
      // Nothing here is real. Never report PASS from a mock.
      verification: 'SIMULATED',
    };
  }

  /** The mock has no real media pipeline; `attachPreview` draws a generated pattern instead. */
  get previewStream(): MediaStream | null {
    return null;
  }

  /** The canvas the test pattern is drawn into, so a UI can mount it directly. */
  get previewCanvas(): CompositorCanvas | null {
    return this.patternCanvas;
  }

  get isPreviewing(): boolean {
    return this.previewing;
  }

  async startPreview(moment: Moment, masterAspect: AspectRatio): Promise<void> {
    this.activeMoment = moment;
    this.masterAspect = masterAspect;
    this.previewing = true;
    this.startPattern();
  }

  async stopPreview(): Promise<void> {
    this.previewing = false;
    this.stopPattern();
  }

  async setMoment(moment: Moment): Promise<void> {
    this.activeMoment = moment;
    this.drawPattern();
  }

  async start(req: EngineStartRequest): Promise<void> {
    this.formats = {};
    for (const aspect of ['16:9', '9:16', '1:1'] as AspectRatio[]) {
      const format = req.formats?.[aspect];
      if (format) this.formats[aspect] = format;
    }
    this.live = true;
    this.metricsTick = 0;
    for (const output of req.outputs) this.register(output);
    this.scheduleScenario();
    this.scheduleMetrics();
    if (req.recording?.enabled) await this.startRecording(req.recording);
  }

  /**
   * Add (or re-add) one output. Fails the first `reconnectFailsTimes` calls so a test can drive
   * the orchestrator's reconnect backoff, then succeeds.
   */
  async addOutput(output: EngineOutput): Promise<void> {
    this.addOutputAttempts += 1;
    if (this.addOutputAttempts <= this.reconnectFailsTimes) {
      throw new Error(`Mock reconnect attempt ${this.addOutputAttempts} failed`);
    }
    this.live = true;
    this.register(output);
    this.scheduleMetrics();
  }

  async removeOutput(destinationId: string): Promise<void> {
    const session = this.sessions.get(destinationId);
    if (!session) return;
    session.state = 'stopped';
    this.sessions.delete(destinationId);
    this.emit('output', { type: 'outputStopped', destinationId });
  }

  async stop(): Promise<void> {
    this.live = false;
    for (const handle of Array.from(this.timers)) this.clearTimer(handle);
    this.timers.clear();
    for (const [id, session] of Array.from(this.sessions.entries())) {
      session.state = 'stopped';
      this.emit('output', { type: 'outputStopped', destinationId: id });
    }
    this.sessions.clear();
    if (this.recording) await this.stopRecording();
  }

  async startRecording(_settings: RecordingSettings): Promise<void> {
    this.recording = true;
    this.emit('recording', { state: 'started', path: 'mock://recording.mp4' });
  }

  async stopRecording(): Promise<{ path?: string; blob?: Blob }> {
    if (!this.recording) return {};
    this.recording = false;
    this.emit('recording', { state: 'stopped', path: 'mock://recording.mp4' });
    return { path: 'mock://recording.mp4' };
  }

  /** Drop every timer (call this from a test teardown). */
  dispose(): void {
    for (const handle of Array.from(this.timers)) this.clearTimer(handle);
    this.timers.clear();
    this.stopPattern();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------- internals

  private register(output: EngineOutput): void {
    const unreal = simulationRefusal(output.ingest.url);
    if (unreal) {
      // The worst state this product can reach is a green LIVE badge with no bytes on the wire.
      // A simulated engine plus a real destination is exactly that, so it is refused here rather
      // than reported as connected: the destination card shows why, and nothing claims to be live.
      this.sessions.set(output.destinationId, { output, state: 'lost' });
      this.emit('output', {
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: unreal,
      });
      return;
    }
    const session: MockSession = { output, state: 'connecting' };
    this.sessions.set(output.destinationId, session);
    this.later(() => {
      if (session.state !== 'connecting' || this.sessions.get(output.destinationId) !== session) return;
      session.state = 'up';
      this.emit('output', { type: 'outputUp', destinationId: output.destinationId });
    }, this.connectDelayMs);
  }

  private scheduleScenario(): void {
    const s = this.scenario;
    if (s.failOutput) {
      const { destinationId, afterMs, code } = s.failOutput;
      this.later(() => {
        const session = this.sessions.get(destinationId);
        if (!session || session.state === 'stopped' || session.state === 'lost') return;
        session.state = 'lost';
        this.emit('output', {
          type: 'outputLost',
          destinationId,
          code: code ?? 'INGEST_DISCONNECTED',
          technical: `scripted failure after ${afterMs}ms`,
        });
      }, afterMs);
    }
    if (s.degradeOutput) {
      const { destinationId, afterMs, recoverAfterMs } = s.degradeOutput;
      this.later(() => {
        const session = this.sessions.get(destinationId);
        if (!session || session.state !== 'up') return;
        session.state = 'degraded';
        this.emit('output', { type: 'outputDegraded', destinationId, technical: 'scripted degradation' });
        if (recoverAfterMs !== undefined) {
          this.later(() => {
            const later = this.sessions.get(destinationId);
            if (!later || later.state !== 'degraded') return;
            later.state = 'up';
            this.emit('output', { type: 'outputRecovered', destinationId });
          }, recoverAfterMs);
        }
      }, afterMs);
    }
    if (s.dropDevice) {
      const { kind, afterMs } = s.dropDevice;
      this.later(() => this.emit('deviceLost', { kind }), afterMs);
    }
    if (s.encoderCrashAfterMs !== undefined) {
      this.later(() => {
        this.emit('engineError', { code: 'ENCODER_FAILED', technical: 'scripted encoder crash' });
        for (const [id, session] of Array.from(this.sessions.entries())) {
          if (session.state === 'stopped' || session.state === 'lost') continue;
          session.state = 'lost';
          this.emit('output', { type: 'outputLost', destinationId: id, code: 'ENCODER_FAILED', technical: 'scripted encoder crash' });
        }
      }, s.encoderCrashAfterMs);
    }
  }

  private scheduleMetrics(): void {
    this.later(() => {
      if (!this.live) return;
      this.emitMetrics();
      this.scheduleMetrics();
    }, this.metricsIntervalMs);
  }

  /** One plausible, seeded metrics sample. Public so tests can force a read. */
  emitMetrics(): void {
    this.metricsTick += 1;
    const format = this.formats[this.masterAspect] ?? formatForPreset('1080p30', this.masterAspect);
    const targetKbps = format.videoKbps + format.audioKbps;
    const degraded = Array.from(this.sessions.values()).some((s) => s.state === 'degraded');

    // A gentle sine ripple plus seeded noise: looks alive, stays reproducible.
    const ripple = Math.sin(this.metricsTick / 4) * 0.04;
    const noise = (this.random() - 0.5) * 0.06;
    const factor = (degraded ? 0.55 : 0.97) + ripple + noise;

    this.emit('metrics', {
      encodedKbps: Math.max(0, Math.round(targetKbps * factor)),
      targetKbps,
      encoderDroppedPct: degraded ? round1(this.random() * 4) : round1(this.random() * 0.4),
      networkDroppedPct: degraded ? round1(2 + this.random() * 5) : round1(this.random() * 0.3),
      renderFps: Math.max(1, Math.round(format.fps - (degraded ? 4 + this.random() * 6 : this.random()))),
      targetFps: format.fps,
      cpuPct: round1(18 + this.random() * 20),
      memoryMb: Math.round(320 + this.random() * 80),
      latencyMs: Math.round(1800 + this.random() * 600),
      updatedAt: this.now(),
    });
  }

  private later(fn: () => void, ms: number): void {
    const handle = this.setTimeoutFn(() => {
      this.timers.delete(handle);
      fn();
    }, Math.max(0, ms));
    this.timers.add(handle);
  }

  private clearTimer(handle: unknown): void {
    try {
      this.clearTimeoutFn(handle);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- test pattern

  /**
   * Draw a generated test pattern so the UI has something to show with no camera:
   * a moving gradient, "DEMO PREVIEW", and the active Moment's name.
   */
  attachPreview(videoEl: HTMLVideoElement | null | undefined): void {
    this.startPattern();
    const canvas = this.patternCanvas;
    if (!videoEl || !canvas) return;
    try {
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      const stream = canvas.captureStream?.(PATTERN_FPS);
      if (stream) videoEl.srcObject = stream;
      const played = videoEl.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    } catch {
      /* the canvas itself can still be mounted via `previewCanvas` */
    }
  }

  private startPattern(): void {
    if (!this.patternCanvas && this.createCanvas) {
      try {
        this.patternCanvas = this.createCanvas(1280, 720);
      } catch {
        this.patternCanvas = null;
      }
    }
    if (!this.patternCanvas || this.patternTimer !== null) {
      this.drawPattern();
      return;
    }
    const loop = (): void => {
      this.patternTimer = null;
      this.patternPhase = (this.patternPhase + 1) % 3600;
      this.drawPattern();
      if (this.previewing || this.live) {
        this.patternTimer = this.setTimeoutFn(loop, Math.round(1000 / PATTERN_FPS));
      }
    };
    loop();
  }

  private stopPattern(): void {
    if (this.patternTimer !== null) {
      this.clearTimer(this.patternTimer);
      this.patternTimer = null;
    }
  }

  private drawPattern(): void {
    const canvas = this.patternCanvas;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      const raw = canvas.getContext('2d');
      ctx = raw && typeof raw === 'object' ? (raw as CanvasRenderingContext2D) : null;
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const w = canvas.width || 1280;
    const h = canvas.height || 720;
    const phase = this.patternPhase / 60;
    try {
      const gradient = ctx.createLinearGradient?.(0, 0, w, h);
      if (gradient) {
        const shift = (Math.sin(phase) + 1) / 2;
        gradient.addColorStop(0, mixHex('#0B0F19', '#1E3A8A', shift));
        gradient.addColorStop(1, mixHex('#4C1D95', '#0F766E', 1 - shift));
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = '#0B0F19';
      }
      ctx.fillRect(0, 0, w, h);

      // A drifting band so it is obvious the pattern is animating.
      const bandX = ((Math.sin(phase / 2) + 1) / 2) * w * 0.8;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(bandX, 0, w * 0.2, h);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(h * 0.1)}px Inter, system-ui, sans-serif`;
      ctx.fillText('DEMO PREVIEW', w / 2, h / 2 - h * 0.06, w * 0.9);
      ctx.font = `500 ${Math.round(h * 0.05)}px Inter, system-ui, sans-serif`;
      ctx.fillText(this.activeMoment?.name ?? 'No Moment', w / 2, h / 2 + h * 0.07, w * 0.9);
      ctx.font = `400 ${Math.round(h * 0.032)}px Inter, system-ui, sans-serif`;
      ctx.fillText('Simulated picture — this build is not broadcasting', w / 2, h - h * 0.08, w * 0.9);
    } catch {
      /* a partial 2D context must not break the demo */
    }
  }
}

// -------------------------------------------------------------------- helpers

/**
 * Reserved names that can never be somebody's live server.
 *
 * RFC 2606 and RFC 6761 set these aside permanently: `.invalid` is guaranteed never to resolve,
 * `.test` exists for exactly this kind of harness, and `.example` plus the three example.* domains
 * are reserved for documentation. `.localhost` is deliberately NOT here - a loopback MediaMTX is a
 * real server that really records what it is sent, and the mock must not pretend to feed it.
 */
const SIMULATED_SUFFIXES = ['.invalid', '.test', '.example', 'example.com', 'example.net', 'example.org'];

/**
 * Why this ingest target cannot be simulated, or null when it can.
 *
 * MockEngine opens no socket and encodes nothing. Pointed at a real ingest it would report
 * `outputUp` for a destination that receives no bytes at all, and the whole UI - the badge, the
 * count, the timer, the recording row - would be describing a broadcast that is not happening.
 */
export function simulationRefusal(url: string): string | null {
  const host = hostOf(url);
  if (host === null) return null;
  const lower = host.toLowerCase();
  if (SIMULATED_SUFFIXES.some((suffix) => lower === suffix.replace(/^\./, '') || lower.endsWith(suffix))) return null;
  return `Demo mode cannot broadcast to ${lower}. Turn demo mode off to stream to a real server.`;
}

function hostOf(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  if (!match) return null;
  const authority = match[1] ?? '';
  const afterCredentials = authority.slice(authority.lastIndexOf('@') + 1);
  const withoutPort = afterCredentials.replace(/:\d+$/, '');
  return withoutPort.length > 0 ? withoutPort : null;
}

/** Deterministic 32-bit PRNG - same seed, same curve, every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function defaultCanvasFactory(): ((width: number, height: number) => CompositorCanvas) | undefined {
  const doc = (globalThis as { document?: { createElement?: (tag: string) => unknown } }).document;
  if (!doc?.createElement) return undefined;
  return (width: number, height: number) => {
    const canvas = doc.createElement!('canvas') as CompositorCanvas;
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
}
