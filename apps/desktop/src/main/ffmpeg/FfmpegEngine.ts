/**
 * FfmpegEngine — the OUTPUT half of the MediaEngine contract for desktop.
 *
 * SCOPE. This engine does not capture and does not composite. The renderer owns capture
 * (getUserMedia / getDisplayMedia), compositing (canvas) and preview, because that is where the
 * pixels already live and where the same React code runs on web and mobile. `startPreview` is
 * therefore a no-op here by design — see the MediaEngine contract note in packages/core.
 *
 * TOPOLOGY: "one encoder, N senders" (ADR-005 / DESKTOP_ARCHITECTURE.md).
 *
 *   per aspect ratio:  1 encoder process   →  TsFanout  →  1 sender process per destination
 *                      (the only encode)      (in TS)      (`-c copy`, ~1 % of a core each)
 *                                                        →  1 recorder process (`-c copy`)
 *
 * Why not ffmpeg's `tee` muxer, which is the textbook answer for fan-out? Because a tee output list
 * is fixed at process start. Adding a destination mid-broadcast, or reconnecting one that dropped,
 * would mean restarting the encoder — and that interrupts every other destination and the recording.
 * With this topology the encoder runs untouched from GO LIVE to the end, and a destination
 * failing, being removed, or being re-added costs exactly one short-lived `-c copy` process.
 * `buildTeeOutput` in ./argv.ts keeps the tee form (with its escaping rules) for reference.
 *
 * RESILIENCE. One destination can never take down another:
 *   - each sender is its own OS process with its own socket;
 *   - the fan-out never lets a sender apply backpressure to the encoder (bounded per-sink queue,
 *     drops on overflow);
 *   - a sender dying is reported as `outputLost` with a classified ErrorCode and nothing else moves.
 *
 * Reconnect policy lives in packages/core (BroadcastOrchestrator); this engine only reports and
 * obeys `addOutput` / `removeOutput`.
 */

import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { AspectRatio, ErrorCode, IngestTarget } from '@livetap/core';
import type { EngineCapabilities, EngineMetrics, OutputFormat, RecordingSettings } from '@livetap/core';
import { redactArgv, redactIngest, redactSecrets, validateIngest } from '@livetap/core';

import type { DesktopEngineEvent, DesktopEngineOutput, DesktopStartRequest } from '../../shared/ipc.js';
import { ArgvRefusedError, buildEncoderArgv, buildRecordingArgv, buildSenderArgv, recordingExtension } from './argv.js';
import type { EncoderSource } from './argv.js';
import { CpuSampler } from './cpu.js';
import { TsFanout } from './fanout.js';
import { BondClient, BondMonitor, BondSink, importPublicKey, type BondPathSpec } from '@livetap/bond';
import type { HardwareReport } from './hardware.js';
import { chooseEncoder, probeEncoders } from './hardware.js';
import { FfmpegStderrParser, classifyStderrLine } from './progress.js';
import type { ProgressSnapshot } from './progress.js';

export interface EngineLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const NOOP_LOGGER: EngineLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface FfmpegEngineOptions {
  ffmpegPath: string;
  /** Absolute directory recordings are written to. Created on demand. */
  recordingsDir: string;
  logger?: EngineLogger;
  /** Injected in tests. */
  spawnFn?: typeof spawn;
  now?: () => number;
  /** Injected in tests so a fake report can be supplied without running ffmpeg. */
  hardwareReport?: HardwareReport;
  /** Sample child-process CPU for metrics (adds one OS call every 10 s). */
  cpuSampling?: boolean;
  /** Emitted metrics cadence, ms. */
  metricsIntervalMs?: number;
  /**
   * Where LIVETAP Bond should send, when a destination asks for it.
   *
   * Absent - the default, and what ships today - means no Bond session is ever created and every
   * destination takes the direct RTMP path it always has. This is the brief's §58 rule expressed
   * in a type: bonding is an addition, never a requirement, and a build with no relay configured
   * behaves exactly as it did before Bond existed.
   */
  bond?: BondRelayConfig;
}

export interface BondRelayConfig {
  readonly host: string;
  readonly port: number;
  /** The relay's X25519 public key, 32 raw bytes, base64. */
  readonly relayStaticPublicBase64: string;
  /** The broker-signed session token, base64. */
  readonly tokenBase64: string;
  /** Extra local addresses to bind, beyond the default route. One path each. */
  readonly extraPaths?: readonly BondPathSpec[];
}

/** One Bond session per broadcast, shared by every destination that asked for it. */
interface BondState {
  client: BondClient;
  sinks: Map<string, BondSink>;
}

interface EncoderState {
  aspectRatio: AspectRatio;
  format: OutputFormat;
  child: ChildProcessWithoutNullStreams;
  fanout: TsFanout;
  parser: FfmpegStderrParser;
  lastProgress?: ProgressSnapshot;
  /** Bytes pushed from the renderer into stdin, for diagnostics. */
  inputBytes: number;
  /** Renderer chunks we could not hand to ffmpeg because stdin was saturated. */
  stalledWrites: number;
  stopping: boolean;
  videoPassthrough: boolean;
  videoEncoder: string;
}

interface SenderState {
  destinationId: string;
  aspectRatio: AspectRatio;
  ingest: IngestTarget;
  child: ChildProcessWithoutNullStreams;
  parser: FfmpegStderrParser;
  lastProgress?: ProgressSnapshot;
  /** Last classified error seen on stderr; used when the process exits non-zero. */
  lastErrorCode?: ErrorCode;
  lastErrorText?: string;
  /** true once `outputUp` has been emitted (first progress block with data). */
  reportedUp: boolean;
  /** true while degraded, so we emit `outputRecovered` exactly once. */
  degraded: boolean;
  /** Set when WE are shutting it down, so the exit is `outputStopped` not `outputLost`. */
  intentionalStop: boolean;
}

interface RecorderState {
  child: ChildProcessWithoutNullStreams;
  parser: FfmpegStderrParser;
  filePath: string;
  aspectRatio: AspectRatio;
  intentionalStop: boolean;
}

const RECORDER_SINK_ID = '__livetap_recorder__';

export class FfmpegEngine {
  readonly kind = 'ffmpeg' as const;

  private readonly options: FfmpegEngineOptions;
  private readonly log: EngineLogger;
  private readonly spawnFn: typeof spawn;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: DesktopEngineEvent) => void>();

  private readonly encoders = new Map<AspectRatio, EncoderState>();
  private readonly senders = new Map<string, SenderState>();
  private recorder: RecorderState | null = null;
  private bond: BondState | null = null;
  /*
   * Bond's decision layer, on the path this machine is publishing over.
   *
   * SEPARATE FROM `bond` ABOVE, which is the wire protocol and only exists when a destination
   * asked to be bonded. This runs on every broadcast, bonded or not, so a Windows creator gets the
   * same connection health a phone and a browser already report. Without it the product said
   * "your connection cannot keep up" on two surfaces and nothing at all on the third, which is the
   * kind of inconsistency that makes a creator distrust all three.
   */
  private readonly bondMonitor = new BondMonitor();
  private hardware: HardwareReport | null = null;
  private request: DesktopStartRequest | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private cpuTimer: NodeJS.Timeout | null = null;
  private readonly cpuSampler = new CpuSampler();
  private lastCpuPct: number | undefined;
  private startedAt = 0;
  private running = false;

  constructor(options: FfmpegEngineOptions) {
    this.options = options;
    this.log = options.logger ?? NOOP_LOGGER;
    this.spawnFn = options.spawnFn ?? spawn;
    this.now = options.now ?? (() => Date.now());
    if (options.hardwareReport) this.hardware = options.hardwareReport;
  }

  /* --------------------------------------------------------------- events */

  on(listener: (event: DesktopEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: DesktopEngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.log.error('engine listener threw', { error: String(error) });
      }
    }
  }

  /* --------------------------------------------------------- capabilities */

  /**
   * Honest capabilities. `verification` is PASS only when a real encode has been proven on THIS
   * machine by the probe; if ffmpeg cannot even be executed it is UNAVAILABLE, never a hopeful PASS.
   */
  async capabilities(): Promise<EngineCapabilities> {
    const report = await this.ensureHardware();
    const softwareWorks = report.all.some((r) => r.encoder === 'libx264' && r.status === 'PASS');
    return {
      // Capture belongs to the renderer; these reflect what the renderer can be granted on desktop.
      camera: true,
      microphone: true,
      screen: true,
      window: true,
      systemAudio: process.platform === 'win32',
      rtmp: softwareWorks,
      srt: softwareWorks,
      whip: softwareWorks,
      recording: softwareWorks,
      hardwareEncoders: report.hardwareKinds,
      // One encoder process per aspect ratio; three is the number of aspect ratios that exist.
      maxFormats: 3,
      verification: softwareWorks ? 'PASS' : 'UNAVAILABLE',
    };
  }

  async ensureHardware(): Promise<HardwareReport> {
    if (!this.hardware) {
      this.hardware = await probeEncoders(this.options.ffmpegPath);
      this.log.info('ffmpeg hardware probe complete', {
        recommended: this.hardware.recommended,
        working: this.hardware.working.map((r) => r.encoder),
      });
    }
    return this.hardware;
  }

  get hardwareReport(): HardwareReport | null {
    return this.hardware;
  }

  /* ---------------------------------------------------------------- start */

  async start(req: DesktopStartRequest): Promise<{ ok: boolean; errors?: string[] }> {
    if (this.running) return { ok: false, errors: ['Engine is already running.'] };

    // Validate every ingest target BEFORE spawning anything. A single bad destination must not
    // abort the broadcast, so invalid ones are reported and skipped, not thrown.
    const errors: string[] = [];
    const usable: DesktopEngineOutput[] = [];
    for (const output of req.outputs) {
      const validation = validateIngest(output.ingest);
      if (!validation.ok) {
        errors.push(`${output.destinationId}: ${validation.errors.join(' ')}`);
        this.emit({
          type: 'outputLost',
          destinationId: output.destinationId,
          code: 'CONFIG_INVALID',
          technical: validation.errors.join(' '),
        });
        continue;
      }
      usable.push(output);
    }

    const report = await this.ensureHardware();
    const videoEncoder = chooseEncoder(req.encoder.preference, report);

    const aspects = (Object.keys(req.formats) as AspectRatio[]).filter((a) => req.formats[a] !== undefined);
    if (aspects.length === 0) return { ok: false, errors: ['No output formats requested.'] };

    this.request = req;
    this.startedAt = this.now();

    /*
     * Open the Bond session before any encoder starts, but only if a destination actually wants it.
     *
     * A failure here is logged and NOT fatal. Bond is an addition; a relay that cannot be reached
     * must degrade to the direct RTMP path rather than take a broadcast down, and the destinations
     * that asked for it will refuse individually with a reason the creator can read. Experimental
     * networking is not allowed to destroy the basic broadcast system.
     */
    if (this.options.bond && usable.some((output) => output.viaBond)) {
      await this.openBondSession();
    }

    for (const aspect of aspects) {
      const format = req.formats[aspect];
      if (!format) continue;
      try {
        this.startEncoder(aspect, format, req, videoEncoder);
      } catch (error) {
        const technical = error instanceof Error ? error.message : String(error);
        errors.push(`encoder ${aspect}: ${technical}`);
        this.emit({ type: 'engineError', code: 'ENCODER_FAILED', technical });
      }
    }
    if (this.encoders.size === 0) {
      this.request = null;
      return { ok: false, errors: errors.length > 0 ? errors : ['No encoder could be started.'] };
    }

    this.running = true;

    for (const output of usable) {
      const result = this.startSender(output);
      if (!result.ok && result.errors) errors.push(...result.errors);
    }

    if (req.recording.enabled) {
      const result = this.startRecordingInternal(req.recording);
      if (!result.ok && result.errors) errors.push(...result.errors);
    }

    this.startMetrics();
    const out: { ok: boolean; errors?: string[] } = { ok: true };
    if (errors.length > 0) out.errors = errors;
    return out;
  }

  private startEncoder(
    aspect: AspectRatio,
    format: OutputFormat,
    req: DesktopStartRequest,
    videoEncoder: string,
  ): void {
    // Decision A′ (see DESKTOP_ARCHITECTURE.md): when the renderer hands us H.264 we copy the video
    // and only transcode Opus → AAC, so the ONLY video encode in the whole pipeline is the one
    // Chromium already did. Anything else (VP8/VP9 fallback) is transcoded once, here.
    const source: EncoderSource =
      req.source.kind === 'pipe'
        ? {
            kind: 'pipe',
            container: containerForMime(req.source.mimeType),
            videoPassthrough: mimeCarriesH264(req.source.mimeType),
          }
        : { kind: 'lavfi', ...(req.source.durationSeconds !== undefined ? { durationSeconds: req.source.durationSeconds } : {}) };

    const argv = buildEncoderArgv({ format, encoder: req.encoder, videoEncoder, source });
    const child = this.spawnChild(argv, 'encoder');

    const state: EncoderState = {
      aspectRatio: aspect,
      format,
      child,
      parser: new FfmpegStderrParser(),
      inputBytes: 0,
      stalledWrites: 0,
      stopping: false,
      videoPassthrough: source.kind === 'pipe' ? source.videoPassthrough : false,
      videoEncoder,
      fanout: new TsFanout({
        onSinkError: (id, error) => this.onSinkFailure(id, error.message),
        onSinkClosed: (id) => this.onSinkFailure(id, 'sender stream closed'),
        onSinkDrop: (id, _bytes, total) =>
          this.log.warn('fan-out dropped data for a saturated destination', { destinationId: id, totalDroppedBytes: total }),
      }),
    };
    this.encoders.set(aspect, state);

    state.fanout.attach(child.stdout);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onEncoderStderr(state, chunk));
    child.stdin.on('error', (error: Error) => {
      // EPIPE here means ffmpeg exited; the exit handler reports the real cause.
      this.log.warn('encoder stdin error', { aspect, error: error.message });
    });
    child.on('error', (error) => {
      this.emit({ type: 'engineError', code: 'ENCODER_FAILED', technical: error.message });
    });
    child.on('close', (code) => this.onEncoderExit(state, code));

    this.log.info('encoder started', {
      aspect,
      pid: child.pid,
      videoEncoder: state.videoPassthrough ? 'copy (renderer encoded)' : videoEncoder,
      size: `${format.width}x${format.height}@${format.fps}`,
      kbps: format.videoKbps,
    });
  }

  /* ------------------------------------------------------------- outputs */

  async addOutput(output: DesktopEngineOutput): Promise<{ ok: boolean; errors?: string[] }> {
    if (!this.running) return { ok: false, errors: ['Engine is not running.'] };
    return Promise.resolve(this.startSender(output));
  }

  private startSender(output: DesktopEngineOutput): { ok: boolean; errors?: string[] } {
    if (this.senders.has(output.destinationId)) {
      return { ok: false, errors: [`Destination ${output.destinationId} is already streaming.`] };
    }
    const encoder = this.encoders.get(output.aspectRatio);
    if (!encoder) {
      return { ok: false, errors: [`No encoder for aspect ratio ${output.aspectRatio}.`] };
    }

    /*
     * A Bond destination is a sink like any other.
     *
     * This is the whole integration, and it is four lines because the fan-out was already the right
     * shape: it takes a `Writable`, and `BondSink` is one. Every guarantee the fan-out already makes
     * - the source is never paused, every live sink gets every byte in order, a failing sink is
     * removed while the others continue, writes arrive aligned to whole TS packets - applies here
     * unchanged, and none of it had to be asked for.
     *
     * The direct path below is untouched. A build with no relay configured never reaches this
     * branch, which is how §58's "one path behaves exactly as it does today" is kept true by
     * construction rather than by testing for it afterwards.
     */
    if (output.viaBond) {
      const bond = this.bond;
      if (!bond) {
        const reason = 'This destination asked for LIVETAP Bond, but no relay is configured.';
        this.emit({ type: 'outputLost', destinationId: output.destinationId, code: 'CONFIG_INVALID', technical: reason });
        return { ok: false, errors: [reason] };
      }
      const sink = new BondSink(bond.client, { label: output.destinationId });
      bond.sinks.set(output.destinationId, sink);
      encoder.fanout.addSink(output.destinationId, sink);
      this.log.info('bond sender started', { destinationId: output.destinationId });
      return { ok: true };
    }

    let argv: string[];
    try {
      argv = buildSenderArgv({ ingest: output.ingest, format: encoder.format });
    } catch (error) {
      const reasons = error instanceof ArgvRefusedError ? error.reasons : [];
      const technical = error instanceof Error ? error.message : String(error);
      this.emit({
        type: 'outputLost',
        destinationId: output.destinationId,
        code: 'CONFIG_INVALID',
        technical: [technical, ...reasons].join(' '),
      });
      return { ok: false, errors: [technical] };
    }

    const child = this.spawnChild(argv, 'sender');
    const state: SenderState = {
      destinationId: output.destinationId,
      aspectRatio: output.aspectRatio,
      ingest: output.ingest,
      child,
      parser: new FfmpegStderrParser(),
      reportedUp: false,
      degraded: false,
      intentionalStop: false,
    };
    this.senders.set(output.destinationId, state);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onSenderStderr(state, chunk));
    child.stdout.resume(); // sender writes nothing to stdout, but drain it anyway
    child.on('error', (error) => {
      state.lastErrorText = error.message;
      state.lastErrorCode = 'UNKNOWN';
    });
    child.on('close', (code) => this.onSenderExit(state, code));

    // Attach AFTER wiring handlers so no byte is lost, and let the fan-out align to a TS packet.
    encoder.fanout.addSink(output.destinationId, child.stdin);

    this.log.info('sender started', {
      destinationId: output.destinationId,
      pid: child.pid,
      ingest: redactIngest(output.ingest),
    });
    return { ok: true };
  }

  /** Connect one Bond session for this broadcast, plus any extra local paths configured. */
  private async openBondSession(): Promise<void> {
    const config = this.options.bond;
    if (!config || this.bond) return;
    try {
      const client = new BondClient({
        relayHost: config.host,
        relayPort: config.port,
        relayStaticPublic: importPublicKey(Buffer.from(config.relayStaticPublicBase64, 'base64')),
        tokenBlob: Buffer.from(config.tokenBase64, 'base64'),
      });
      client.on('health', ({ health, reason }) => this.log.info('bond health', { health, reason }));
      client.on('pathLost', ({ label }) => this.log.warn('bond path lost', { label }));

      await client.connect({ transport: 'other', label: 'Network', metered: 'unknown' });
      for (const spec of config.extraPaths ?? []) {
        await client.addPath(spec).catch(() => undefined);
      }
      this.bond = { client, sinks: new Map() };
      this.log.info('bond session open', { relay: `${config.host}:${config.port}` });
    } catch (error) {
      // Degrade, never fail. The destinations that wanted Bond will say so one at a time.
      this.log.warn('bond session could not be opened', {
        technical: error instanceof Error ? error.message : String(error),
      });
      this.bond = null;
    }
  }

  private async closeBondSession(): Promise<void> {
    const bond = this.bond;
    this.bond = null;
    if (!bond) return;
    for (const id of bond.sinks.keys()) {
      for (const encoder of this.encoders.values()) encoder.fanout.removeSink(id);
    }
    await bond.client.close().catch(() => undefined);
  }

  /** Live Bond telemetry, or null when this broadcast is not using it. */
  bondTelemetry(): ReturnType<BondClient['telemetry']> | null {
    return this.bond?.client.telemetry() ?? null;
  }

  async removeOutput(destinationId: string): Promise<{ ok: boolean }> {
    const bondSink = this.bond?.sinks.get(destinationId);
    if (bondSink) {
      for (const encoder of this.encoders.values()) encoder.fanout.removeSink(destinationId);
      this.bond?.sinks.delete(destinationId);
      // The session stays open: other destinations may still be riding it, and tearing it down
      // here would end their broadcast to stop one.
      return { ok: true };
    }

    const sender = this.senders.get(destinationId);
    if (!sender) return { ok: false };
    sender.intentionalStop = true;
    const encoder = this.encoders.get(sender.aspectRatio);
    encoder?.fanout.removeSink(destinationId);
    await this.terminate(sender.child, 3000);
    return { ok: true };
  }

  /* ----------------------------------------------------------- recording */

  async startRecording(settings: RecordingSettings): Promise<{ ok: boolean; path?: string; errors?: string[] }> {
    return Promise.resolve(this.startRecordingInternal(settings));
  }

  private startRecordingInternal(settings: RecordingSettings): { ok: boolean; path?: string; errors?: string[] } {
    if (this.recorder) return { ok: false, errors: ['Already recording.'] };
    const master = this.masterAspect();
    if (!master) return { ok: false, errors: ['Engine is not running.'] };
    const encoder = this.encoders.get(master);
    if (!encoder) return { ok: false, errors: ['Engine is not running.'] };

    // Recordings only ever go inside the app's own recordings directory (or an explicit directory
    // the user chose through the native dialog, which main validated at choose time).
    const directory = settings.directory ?? this.options.recordingsDir;
    const extension = recordingExtension(settings.container);
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(directory, `LIVETAP-${stamp}.${extension}`);

    try {
      mkdirSync(directory, { recursive: true });
    } catch (error) {
      const technical = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'recording', state: 'failed', code: 'RECORDING_FAILED' });
      return { ok: false, errors: [technical] };
    }

    let argv: string[];
    try {
      argv = buildRecordingArgv({ filePath, container: settings.container });
    } catch (error) {
      const technical = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'recording', state: 'failed', code: 'RECORDING_FAILED' });
      return { ok: false, errors: [technical] };
    }

    const child = this.spawnChild(argv, 'recorder');
    const state: RecorderState = {
      child,
      parser: new FfmpegStderrParser(),
      filePath,
      aspectRatio: master,
      intentionalStop: false,
    };
    this.recorder = state;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onRecorderStderr(state, chunk));
    child.stdout.resume();
    child.on('close', (code) => this.onRecorderExit(state, code));
    encoder.fanout.addSink(RECORDER_SINK_ID, child.stdin);

    this.emit({ type: 'recording', state: 'started', path: filePath });
    this.log.info('recording started', { filePath, container: settings.container, extension });
    return { ok: true, path: filePath };
  }

  async stopRecording(): Promise<{ ok: boolean; path?: string }> {
    const recorder = this.recorder;
    if (!recorder) return { ok: false };
    recorder.intentionalStop = true;
    const encoder = this.encoders.get(recorder.aspectRatio);
    encoder?.fanout.removeSink(RECORDER_SINK_ID);
    // Close stdin so the muxer finalises the file, then wait for a clean exit.
    try {
      recorder.child.stdin.end();
    } catch {
      // already closed
    }
    await this.waitForExit(recorder.child, 8000);
    return { ok: true, path: recorder.filePath };
  }

  /* ----------------------------------------------------- renderer → main */

  /**
   * One MediaRecorder chunk from the renderer. Never drops: dropping bytes mid-container corrupts
   * the Matroska stream for good. If ffmpeg's stdin is saturated (it never is in practice — the
   * remux runs orders of magnitude faster than realtime) we count it and report overload.
   */
  pushChunk(aspect: AspectRatio, data: Uint8Array): void {
    const encoder = this.encoders.get(aspect);
    if (!encoder || encoder.stopping) return;
    if (encoder.child.stdin.destroyed || encoder.child.stdin.writableEnded) return;
    encoder.inputBytes += data.byteLength;
    const accepted = encoder.child.stdin.write(data);
    if (!accepted) {
      encoder.stalledWrites += 1;
      if (encoder.stalledWrites === 30) {
        this.emit({
          type: 'engineError',
          code: 'ENCODER_OVERLOADED',
          technical: 'ffmpeg stdin is not draining; the muxer cannot keep up with the renderer.',
        });
      }
    }
  }

  /** The renderer's recorder stopped; close stdin so the encoder flushes and exits cleanly. */
  endOfStream(aspect: AspectRatio): void {
    const encoder = this.encoders.get(aspect);
    if (!encoder) return;
    try {
      encoder.child.stdin.end();
    } catch {
      // already closed
    }
  }

  /* ----------------------------------------------------------------- stop */

  async stop(): Promise<{ ok: boolean }> {
    if (!this.running && this.encoders.size === 0) return { ok: false };
    this.running = false;
    this.stopMetrics();

    if (this.recorder) await this.stopRecording();

    /*
     * Close the Bond session before the encoders, for the same reason senders are stopped first:
     * it has to say goodbye while there is still a working process to say it from. The relay then
     * flushes its reorder buffer and ends the destination cleanly instead of waiting out an idle
     * timeout with the tail of the broadcast still in a buffer nobody is draining.
     */
    await this.closeBondSession();

    // Stop senders first so they flush their RTMP connections, then the encoders.
    const senderStops = [...this.senders.values()].map(async (sender) => {
      sender.intentionalStop = true;
      this.encoders.get(sender.aspectRatio)?.fanout.removeSink(sender.destinationId);
      try {
        sender.child.stdin.end();
      } catch {
        // already closed
      }
      await this.waitForExit(sender.child, 4000);
      await this.terminate(sender.child, 1000);
    });
    await Promise.all(senderStops);

    const encoderStops = [...this.encoders.values()].map(async (encoder) => {
      encoder.stopping = true;
      encoder.fanout.end();
      try {
        encoder.child.stdin.end();
      } catch {
        // already closed
      }
      await this.waitForExit(encoder.child, 4000);
      await this.terminate(encoder.child, 1000);
    });
    await Promise.all(encoderStops);

    this.senders.clear();
    this.encoders.clear();
    this.recorder = null;
    this.request = null;
    return { ok: true };
  }

  /* -------------------------------------------------------------- stderr */

  private onEncoderStderr(state: EncoderState, chunk: string): void {
    const { progress, logs } = state.parser.push(chunk);
    const last = progress[progress.length - 1];
    if (last) state.lastProgress = last;
    for (const line of logs) {
      const code = classifyStderrLine(line);
      if (code === null) continue;
      // SEC-D3: FFmpeg echoes the full publish URL in most connection errors.
      const safe = redactSecrets(line);
      this.log.warn('encoder stderr', { aspect: state.aspectRatio, line: safe });
      // An encoder-level failure affects every destination on this format, so it is an engineError.
      this.emit({ type: 'engineError', code: code === 'UNKNOWN' ? 'ENCODER_FAILED' : code, technical: safe });
    }
  }

  private onSenderStderr(state: SenderState, chunk: string): void {
    const { progress, logs } = state.parser.push(chunk);
    for (const snapshot of progress) {
      state.lastProgress = snapshot;
      if (!state.reportedUp && (snapshot.totalSizeBytes ?? 0) > 0) {
        state.reportedUp = true;
        this.emit({ type: 'outputUp', destinationId: state.destinationId });
      }
      // A sender that is copying packets should track realtime. Sustained speed < 0.9 means the
      // socket is backing up, which is the earliest honest warning of a failing destination.
      if (state.reportedUp && snapshot.speed !== undefined) {
        if (snapshot.speed < 0.9 && !state.degraded) {
          state.degraded = true;
          this.emit({
            type: 'outputDegraded',
            destinationId: state.destinationId,
            technical: `sender speed ${snapshot.speed.toFixed(2)}x`,
          });
        } else if (snapshot.speed >= 0.98 && state.degraded) {
          state.degraded = false;
          this.emit({ type: 'outputRecovered', destinationId: state.destinationId });
        }
      }
    }
    for (const line of logs) {
      const code = classifyStderrLine(line);
      if (code === null) continue;
      state.lastErrorCode = code;
      // SEC-D3: `lastErrorText` reaches error toasts and the diagnostics export,
      // and an RTMP failure line carries the whole publish URL. Redact once,
      // here, so no downstream consumer has to remember to.
      state.lastErrorText = redactSecrets(line);
      this.log.warn('sender stderr', { destinationId: state.destinationId, line: state.lastErrorText });
    }
  }

  private onRecorderStderr(state: RecorderState, chunk: string): void {
    const { logs } = state.parser.push(chunk);
    for (const line of logs) {
      const code = classifyStderrLine(line);
      if (code === null) continue;
      this.log.warn('recorder stderr', { line: redactSecrets(line) });
      if (code === 'DISK_FULL') this.emit({ type: 'recording', state: 'failed', code: 'DISK_FULL' });
    }
  }

  /* ---------------------------------------------------------------- exits */

  private onEncoderExit(state: EncoderState, code: number | null): void {
    state.parser.flush();
    this.encoders.delete(state.aspectRatio);
    state.fanout.end();
    if (state.stopping || !this.running) return;
    this.log.error('encoder exited unexpectedly', { aspect: state.aspectRatio, code });
    this.emit({
      type: 'engineError',
      code: 'ENCODER_FAILED',
      technical: `encoder for ${state.aspectRatio} exited with code ${String(code)}`,
    });
  }

  private onSenderExit(state: SenderState, code: number | null): void {
    state.parser.flush();
    this.senders.delete(state.destinationId);
    this.encoders.get(state.aspectRatio)?.fanout.removeSink(state.destinationId);
    if (state.intentionalStop) {
      this.emit({ type: 'outputStopped', destinationId: state.destinationId });
      return;
    }
    const classified = state.lastErrorCode ?? 'INGEST_DISCONNECTED';
    this.log.warn('sender exited', { destinationId: state.destinationId, code, classified });
    const event: DesktopEngineEvent = {
      type: 'outputLost',
      destinationId: state.destinationId,
      code: classified,
    };
    if (state.lastErrorText) event.technical = state.lastErrorText;
    this.emit(event);
  }

  private onRecorderExit(state: RecorderState, code: number | null): void {
    state.parser.flush();
    if (this.recorder === state) this.recorder = null;
    if (state.intentionalStop || code === 0) {
      this.emit({ type: 'recording', state: 'stopped', path: state.filePath });
      return;
    }
    this.emit({ type: 'recording', state: 'failed', path: state.filePath, code: 'RECORDING_FAILED' });
  }

  /** A fan-out sink failed at the stream level (EPIPE): treat it exactly like a sender failure. */
  private onSinkFailure(id: string, technical: string): void {
    if (id === RECORDER_SINK_ID) {
      this.log.warn('recorder sink failed', { technical });
      return;
    }
    const sender = this.senders.get(id);
    if (!sender || sender.intentionalStop) return;
    // The process close handler will emit outputLost with the classified code; just note the reason.
    sender.lastErrorText = sender.lastErrorText ?? technical;
  }

  /* -------------------------------------------------------------- metrics */

  private startMetrics(): void {
    const interval = this.options.metricsIntervalMs ?? 1000;
    this.metricsTimer = setInterval(() => this.emit({ type: 'metrics', payload: this.metrics() }), interval);
    if (this.options.cpuSampling !== false) {
      this.cpuTimer = setInterval(() => {
        void this.sampleCpu();
      }, 10_000);
    }
  }

  private stopMetrics(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.cpuTimer) clearInterval(this.cpuTimer);
    // Between broadcasts, not during one: the next one must not inherit this one's capacity
    // estimate or the hysteresis that would hold it in a decision made about a different network.
    this.bondMonitor.reset();
    this.metricsTimer = null;
    this.cpuTimer = null;
    this.lastCpuPct = undefined;
  }

  private async sampleCpu(): Promise<void> {
    const pids = [...this.encoders.values()].map((e) => e.child.pid).filter((p): p is number => typeof p === 'number');
    if (pids.length === 0) return;
    try {
      const result = await this.cpuSampler.sample(pids);
      this.lastCpuPct = result.perCorePct;
    } catch {
      this.lastCpuPct = undefined;
    }
  }

  /** Current metrics for the master format, aggregated across senders. */
  metrics(): EngineMetrics {
    const master = this.masterAspect();
    const encoder = master ? this.encoders.get(master) : undefined;
    const format = encoder?.format;
    const progress = encoder?.lastProgress;

    let worstNetworkDrop = 0;
    for (const state of this.encoders.values()) {
      worstNetworkDrop = Math.max(worstNetworkDrop, state.fanout.worstDropPct());
    }

    const encoderFrames = progress?.frame ?? 0;
    const dropped = progress?.dropFrames ?? 0;
    const encoderDroppedPct = encoderFrames + dropped > 0 ? (dropped / (encoderFrames + dropped)) * 100 : 0;

    const targetKbps = format ? format.videoKbps + format.audioKbps : 0;

    /*
     * One sample of the uplink, taken at the metrics cadence.
     *
     * Desktop measures more than a phone can: ffmpeg reports the bitrate it is actually pushing,
     * and the fan-out reports the share of packets it had to drop, which is genuine network loss
     * rather than a proxy for it. Only sampled while an encoder is actually running -- before that
     * there is no path, and a monitor with no paths correctly answers 'offline', which would be
     * true of the bond and a lie about a machine sitting happily in preview.
     */
    if (progress && targetKbps > 0) {
      const deliveredBps = (progress.bitrateKbps ?? 0) * 1000;
      const offeredBps = targetKbps * 1000;
      this.bondMonitor.observe(
        'uplink',
        {
          at: this.now(),
          throughputBps: deliveredBps,
          // ffmpeg does not report round trip or jitter for an RTMP push, and deriving them from
          // anything here would be inventing numbers the state machine would then act on.
          rttMs: 0,
          jitterMs: 0,
          loss: worstNetworkDrop / 100,
          retransmitRate: 0,
          atCapacity: deliveredBps < offeredBps * 0.95,
        },
        { transport: 'ethernet', label: 'Connection', independence: 'unknown' },
        offeredBps,
      );
    }
    const bonded = this.bondMonitor.paths().length > 0
      ? this.bondMonitor.decide(targetKbps * 1000, this.now())
      : null;

    const metrics: EngineMetrics = {
      encodedKbps: progress?.bitrateKbps ?? 0,
      targetKbps,
      encoderDroppedPct,
      networkDroppedPct: worstNetworkDrop,
      renderFps: progress?.fps ?? 0,
      targetFps: format?.fps ?? 0,
      ...(bonded ? { connectionHealth: bonded.health, recommendedKbps: Math.round(bonded.encoderCeilingBps / 1000) } : {}),
      updatedAt: this.now(),
    };
    if (this.lastCpuPct !== undefined) metrics.cpuPct = this.lastCpuPct;
    return metrics;
  }

  /* ---------------------------------------------------------------- utils */

  private masterAspect(): AspectRatio | null {
    if (this.request) {
      for (const aspect of ['16:9', '9:16', '1:1'] as AspectRatio[]) {
        if (this.request.formats[aspect] !== undefined && this.encoders.has(aspect)) return aspect;
      }
    }
    const first = this.encoders.keys().next();
    return first.done ? null : first.value;
  }

  private spawnChild(argv: string[], role: 'encoder' | 'sender' | 'recorder'): ChildProcessWithoutNullStreams {
    // ARGV ARRAY ONLY, no shell, no string concatenation, no inherited stdio.
    const child = this.spawnFn(this.options.ffmpegPath, argv, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    // SEC-D3: NEVER log a raw argv. A sender's last element is
    // `rtmp://host/app/<STREAM KEY>`, and this line runs at `info`, which the
    // electron-log FILE transport writes to disk on every broadcast.
    this.log.info(`${role} spawn`, { argv: redactArgv(argv).join(' '), pid: child.pid });
    return child;
  }

  private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.off('close', onClose);
        resolve();
      }, timeoutMs);
      const onClose = (): void => {
        clearTimeout(timer);
        resolve();
      };
      child.once('close', onClose);
    });
  }

  private async terminate(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await this.waitForExit(child, timeoutMs);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }

  /** Diagnostics snapshot for Pro mode / the verification script. Never contains secrets. */
  diagnostics(): {
    running: boolean;
    startedAt: number;
    encoders: Array<{ aspect: AspectRatio; pid?: number; videoPassthrough: boolean; videoEncoder: string; inputBytes: number; sinks: number }>;
    senders: Array<{ destinationId: string; pid?: number; ingest: IngestTarget; reportedUp: boolean; degraded: boolean }>;
    recording: string | null;
  } {
    return {
      running: this.running,
      startedAt: this.startedAt,
      encoders: [...this.encoders.values()].map((e) => ({
        aspect: e.aspectRatio,
        ...(e.child.pid !== undefined ? { pid: e.child.pid } : {}),
        videoPassthrough: e.videoPassthrough,
        videoEncoder: e.videoEncoder,
        inputBytes: e.inputBytes,
        sinks: e.fanout.sinkCount,
      })),
      senders: [...this.senders.values()].map((s) => ({
        destinationId: s.destinationId,
        ...(s.child.pid !== undefined ? { pid: s.child.pid } : {}),
        ingest: redactIngest(s.ingest),
        reportedUp: s.reportedUp,
        degraded: s.degraded,
      })),
      recording: this.recorder?.filePath ?? null,
    };
  }
}

/* ----------------------------------------------------------- mime helpers */

/**
 * Chromium reports `video/webm;codecs=h264` as supported but actually emits
 * `video/x-matroska;codecs=avc1` (measured on Electron 38.8.6 / Chrome 140 — see
 * docs/architecture/DESKTOP_ARCHITECTURE.md). Both are Matroska on the wire, so the H.264 path
 * always uses the `matroska` demuxer; only a true VP8/VP9 WebM uses `webm`.
 */
export function containerForMime(mimeType: string): 'matroska' | 'webm' | 'mp4' {
  const lower = mimeType.toLowerCase();
  if (lower.includes('mp4')) return 'mp4';
  if (mimeCarriesH264(lower)) return 'matroska';
  if (lower.includes('matroska')) return 'matroska';
  return 'webm';
}

export function mimeCarriesH264(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return lower.includes('h264') || lower.includes('avc1') || lower.includes('avc3');
}
