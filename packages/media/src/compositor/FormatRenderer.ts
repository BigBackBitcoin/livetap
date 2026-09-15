/**
 * FormatRenderer - one correctly composed picture per distinct aspect ratio.
 *
 * "One production, several correct pictures" is the product's headline claim, and the only way to
 * honour it is to compose each aspect ratio at its own true dimensions from the same sources.
 * A 16:9 canvas handed to a 9:16 destination is not a vertical broadcast; it is a landscape
 * broadcast that the platform will letterbox or crop, and the Moment's own '9:16' placements -
 * the thing that makes vertical look composed rather than cropped - never run at all.
 *
 * So: N canvases, N MomentCompositor instances, ONE MediaSourceResolver shared between them. The
 * camera is opened once. Each compositor resolves the same layer ids to the same <video> elements
 * and draws them into its own geometry.
 *
 * There is deliberately no fallback. `streamFor('1:1')` returns null when 1:1 was never resolved,
 * because a silent fallback to the master canvas is exactly the bug this class exists to remove.
 */
import type { AspectRatio, Moment, OutputFormat, TransitionKind } from '@livetap/core';
import { MomentCompositor, defaultCaf, defaultRaf } from './MomentCompositor.js';
import { DisplayCadence, frameIntervalMs, frameIsDue, nextDueAt } from './cadence.js';
import type { CompositorCanvas, MediaSourceResolver } from './types.js';

export const ASPECT_ORDER: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];

export interface FormatRendererOptions {
  createCanvas(width: number, height: number): CompositorCanvas;
  resolver: MediaSourceResolver;
  /** Audio tracks to attach to every captured stream. Called once per stream built. */
  audioTracks?: () => MediaStreamTrack[];
  now?: () => number;
  raf?: (callback: (timestampMs: number) => void) => number;
  caf?: (handle: number) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  background?: string;
}

interface FormatEntry {
  aspect: AspectRatio;
  format: OutputFormat;
  canvas: CompositorCanvas;
  compositor: MomentCompositor;
  stream: MediaStream | null;
  /** The fps the stream was captured at, so a format change knows to rebuild it. */
  capturedFps: number;
}

export class FormatRenderer {
  private readonly options: FormatRendererOptions;
  private readonly entries = new Map<AspectRatio, FormatEntry>();

  private master: AspectRatio = '16:9';
  private moment: Moment | null = null;
  private running = false;

  /** The single render loop for every format. See `start`. */
  private rafHandle: number | null = null;
  private timerHandle: unknown = null;
  /** When each format's next composited frame is owed, in `now()` time. */
  private readonly frameDueAt = new Map<AspectRatio, number>();
  /** The display's own measured cadence, which is what the throttle is allowed to assume. */
  private readonly cadence = new DisplayCadence();

  constructor(options: FormatRendererOptions) {
    this.options = options;
  }

  get masterAspect(): AspectRatio {
    return this.master;
  }

  /** Every aspect ratio currently composed, in a stable order. */
  get aspects(): AspectRatio[] {
    return ASPECT_ORDER.filter((aspect) => this.entries.has(aspect));
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The master compositor, which is what the UI previews. Null before the first `setFormats`. */
  get masterCompositor(): MomentCompositor | null {
    return this.entries.get(this.master)?.compositor ?? null;
  }

  /** Frames a second on the master canvas, which is the number the metrics sample reports. */
  get renderFps(): number {
    return this.masterCompositor?.renderFps ?? 0;
  }

  compositorFor(aspect: AspectRatio): MomentCompositor | null {
    return this.entries.get(aspect)?.compositor ?? null;
  }

  canvasFor(aspect: AspectRatio): CompositorCanvas | null {
    return this.entries.get(aspect)?.canvas ?? null;
  }

  formatFor(aspect: AspectRatio): OutputFormat | null {
    return this.entries.get(aspect)?.format ?? null;
  }

  /**
   * Make the set of composed aspects exactly `formats`, plus the master (the UI always has
   * something to preview). Existing compositors are resized rather than rebuilt so a quality
   * change mid-preview does not drop a frame or re-open a device.
   */
  setFormats(formats: Partial<Record<AspectRatio, OutputFormat>>, masterAspect: AspectRatio, masterFormat: OutputFormat): void {
    this.master = masterAspect;
    const wanted = new Map<AspectRatio, OutputFormat>();
    wanted.set(masterAspect, formats[masterAspect] ?? masterFormat);
    for (const aspect of ASPECT_ORDER) {
      const format = formats[aspect];
      if (format) wanted.set(aspect, format);
    }

    for (const [aspect, entry] of Array.from(this.entries.entries())) {
      if (wanted.has(aspect)) continue;
      entry.compositor.stop();
      entry.compositor.dispose();
      releaseStream(entry.stream);
      this.entries.delete(aspect);
      this.frameDueAt.delete(aspect);
    }

    for (const [aspect, format] of wanted.entries()) {
      const existing = this.entries.get(aspect);
      if (!existing) {
        this.entries.set(aspect, this.createEntry(aspect, format));
        continue;
      }
      existing.format = format;
      if (existing.compositor.width !== format.width || existing.compositor.height !== format.height) {
        existing.compositor.resize(format.width, format.height);
        // A resized canvas invalidates the capture: a MediaStreamTrack keeps the size it was
        // created at, so an old stream would keep publishing the old dimensions.
        releaseStream(existing.stream);
        existing.stream = null;
      }
    }

    if (this.moment) {
      for (const entry of this.entries.values()) {
        if (entry.compositor.moment === null) entry.compositor.setMoment(this.moment, this.now(), { kind: 'cut', durationMs: 0 });
      }
    }
    if (this.running) this.start();
  }

  private createEntry(aspect: AspectRatio, format: OutputFormat): FormatEntry {
    const canvas = this.options.createCanvas(format.width, format.height);
    const compositor = new MomentCompositor({
      canvas,
      aspect,
      width: format.width,
      height: format.height,
      resolver: this.options.resolver,
      ...(this.options.now ? { now: this.options.now } : {}),
      ...(this.options.raf ? { raf: this.options.raf } : {}),
      ...(this.options.caf ? { caf: this.options.caf } : {}),
      ...(this.options.setTimeoutFn ? { setTimeoutFn: this.options.setTimeoutFn } : {}),
      ...(this.options.clearTimeoutFn ? { clearTimeoutFn: this.options.clearTimeoutFn } : {}),
      ...(this.options.background ? { background: this.options.background } : {}),
    });
    return { aspect, format, canvas, compositor, stream: null, capturedFps: 0 };
  }

  /** Show a Moment on every composed aspect at once. */
  setMoment(moment: Moment, nowMs?: number, override?: { kind: TransitionKind; durationMs: number }): void {
    this.moment = moment;
    const at = nowMs ?? this.now();
    for (const entry of this.entries.values()) {
      if (override) entry.compositor.setMoment(moment, at, override);
      else entry.compositor.setMoment(moment, at);
    }
  }

  /**
   * Operator state, recorded and never drawn into the program. See MomentCompositor.setNotice:
   * the compositor keeps the text so the UI can show it beside the preview, and the program
   * canvas stays clean because controls and diagnostics do not belong on the wire.
   */
  setNotice(text: string | null): void {
    for (const entry of this.entries.values()) entry.compositor.setNotice(text);
  }

  getNotice(): string | null {
    return this.masterCompositor?.getNotice() ?? null;
  }

  /**
   * ONE render loop for every format, not one per format.
   *
   * Each MomentCompositor used to run its own animation-frame loop. Three loops, three callbacks,
   * and - the part that cost real milliseconds - no guarantee that the three draws of a given
   * camera frame happened in the same task. Measured on a GPU-less host
   * (`apps/web/scripts/perf-canvas.mjs`): drawing one 1280x720 camera frame into the studio's
   * three canvases costs 10.5 ms for the first draw and 8.1 ms for the second and third when they
   * share a task, because the frame only has to be converted once - and 11.4 ms EACH when the
   * three draws land in three different animation frames. Independent loops drift apart on their
   * own, and the moment they do, every composited frame costs about 30% more than it needs to.
   *
   * So the driver lives here, where the set of formats is known, and it ticks the compositors
   * directly. The master is ticked first: it is the one the creator is watching, so it gets the
   * freshest frame and the others inherit the conversion it paid for.
   *
   * The per-format due times are computed from a single `now` in a single callback, which is what
   * keeps formats that share a frame rate - the normal case, since every aspect comes from the
   * same quality preset - permanently in lockstep instead of merely starting that way.
   */
  start(): void {
    this.running = true;
    // Running, but on this loop: `startDriven` cancels any scheduler of their own and leaves
    // `isRunning` and `targetFps` reporting the truth about a compositor that is producing frames.
    for (const entry of this.entries.values()) entry.compositor.startDriven(entry.format.fps);
    if (this.rafHandle === null && this.timerHandle === null) this.schedule();
  }

  stop(): void {
    this.running = false;
    for (const entry of this.entries.values()) entry.compositor.stop();
    if (this.rafHandle !== null) {
      (this.options.caf ?? defaultCaf())?.(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.timerHandle !== null) {
      (this.options.clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timerHandle);
      this.timerHandle = null;
    }
    this.frameDueAt.clear();
    this.cadence.reset();
  }

  private schedule(): void {
    if (!this.running) return;
    const raf = this.options.raf ?? defaultRaf();
    if (raf) {
      this.rafHandle = raf(() => {
        this.rafHandle = null;
        if (!this.running) return;
        this.driveFrame();
        this.schedule();
      });
      return;
    }
    const setTimeoutFn = this.options.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timerHandle = setTimeoutFn(() => {
      this.timerHandle = null;
      if (!this.running) return;
      this.driveFrame();
      this.schedule();
    }, Math.max(1, Math.round(1000 / this.fastestFps())));
  }

  /**
   * Compose every format that is due, in one task, master first.
   *
   * "Due" is decided by `cadence.ts`, which carries the reasoning and the measurement behind it.
   * The short version: a format is due unless the NEXT animation frame would still deliver it on
   * time, so a display no faster than the format is never throttled at all.
   */
  private driveFrame(): void {
    const now = this.now();
    const period = this.cadence.observe(now);
    for (const aspect of this.tickOrder()) {
      const entry = this.entries.get(aspect);
      if (!entry) continue;
      const due = this.frameDueAt.get(aspect) ?? 0;
      // See cadence.ts: the tolerance is half the DISPLAY's period, so a display no faster than
      // the format never skips a frame, and a fast one skips only what captureStream would drop.
      if (!frameIsDue(now, due, period)) continue;
      this.frameDueAt.set(aspect, nextDueAt(now, due, frameIntervalMs(entry.format.fps)));
      entry.compositor.tick(now);
    }
  }

  /** The master first, then the rest in a stable order. */
  private tickOrder(): AspectRatio[] {
    const rest = ASPECT_ORDER.filter((aspect) => aspect !== this.master && this.entries.has(aspect));
    return this.entries.has(this.master) ? [this.master, ...rest] : rest;
  }

  private fastestFps(): number {
    let fps = 1;
    for (const entry of this.entries.values()) fps = Math.max(fps, entry.format.fps || 30);
    return Math.min(60, fps);
  }

  /**
   * The live stream for one aspect: that aspect's canvas capture, plus the shared audio tracks.
   * Returns null when this aspect is not composed, or when the canvas cannot be captured at all -
   * both of which the caller must report rather than paper over.
   */
  streamFor(aspect: AspectRatio): MediaStream | null {
    const entry = this.entries.get(aspect);
    if (!entry) return null;
    if (entry.stream && entry.capturedFps === entry.format.fps) return entry.stream;
    // Never start a capture while stopped. Otherwise reading `previewStream` after stopPreview
    // would quietly re-open the canvas capture and the UI would show a frozen picture that looks
    // exactly like a live one.
    if (!this.running) return null;
    releaseStream(entry.stream);
    entry.stream = null;

    const canvas = entry.canvas;
    if (typeof canvas.captureStream !== 'function') return null;
    let stream: MediaStream | null = null;
    try {
      stream = canvas.captureStream(entry.format.fps);
    } catch {
      stream = null;
    }
    if (!stream) return null;
    for (const track of this.options.audioTracks?.() ?? []) {
      try {
        stream.addTrack(track);
      } catch {
        /* a stream that will not take an audio track still carries video */
      }
    }
    entry.stream = stream;
    entry.capturedFps = entry.format.fps;
    return stream;
  }

  /** Forget every captured stream (the audio graph changed, or the preview is restarting). */
  releaseStreams(): void {
    for (const entry of this.entries.values()) {
      releaseStream(entry.stream);
      entry.stream = null;
      entry.capturedFps = 0;
    }
  }

  dispose(): void {
    this.stop();
    for (const entry of this.entries.values()) {
      entry.compositor.dispose();
      releaseStream(entry.stream);
    }
    this.entries.clear();
    this.moment = null;
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

/**
 * Stop only the VIDEO tracks of a canvas capture. The audio tracks belong to the shared WebAudio
 * mix and are attached to every format's stream, so stopping them here would silence the other
 * formats and the recording.
 */
function releaseStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getVideoTracks?.() ?? []) {
    try {
      track.stop?.();
    } catch {
      /* ignore */
    }
  }
}
