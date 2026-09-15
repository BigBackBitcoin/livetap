/**
 * MomentCompositor - renders a Moment (and transitions between Moments) onto a 2D canvas.
 *
 * Design rules:
 * - No WebGL, no dependencies. 2D canvas only, so it works in a browser, a WebView and OffscreenCanvas.
 * - Driven by `tick(nowMs)`: transitions are a pure function of time, so tests use fake time.
 * - The compositor never acquires media. The engine hands it a `MediaSourceResolver`.
 */
import type { AspectRatio, Layer, Moment, TransitionKind } from '@livetap/core';
import {
  clampRadius,
  computeFitRect,
  resolvePlacement,
  scaleForHeight,
  toPixelRect,
  visibleLayers,
  type PixelRect,
} from './placement.js';
import { computeTransitionFrame, transitionProgress, type TransitionTransform } from './transitions.js';
import { approximateWidth, wrapText } from './text.js';
import { DisplayCadence, frameIntervalMs, frameIsDue, nextDueAt } from './cadence.js';
import {
  isDrawable,
  sourceDimensions,
  type CompositorCanvas,
  type DrawableSource,
  type MediaSourceResolver,
} from './types.js';

/** Internally we use the HTML context type; OffscreenCanvas' context is structurally compatible. */
type Ctx2D = CanvasRenderingContext2D;

export interface MomentCompositorOptions {
  canvas: CompositorCanvas;
  aspect: AspectRatio;
  width: number;
  height: number;
  resolver?: MediaSourceResolver;
  now?: () => number;
  /** Animation frame scheduler; falls back to setTimeout when absent. */
  raf?: (callback: (timestampMs: number) => void) => number;
  caf?: (handle: number) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Loader for image layers. Defaults to an <img> based loader when `Image` exists. */
  loadImage?: (src: string) => Promise<DrawableSource>;
  /** Canvas background painted under every layer. */
  background?: string;
  /**
   * Draw operator diagnostics (the notice banner, and the labelled placeholder plates that name
   * what a layer is waiting for) into the frame.
   *
   * DEFAULT FALSE, and only ever true for a canvas that is NOT captured. The program output must
   * contain the production and nothing else: an audit found "Camera disconnected" and "Requires
   * the desktop app" burned into the pixels that went out to viewers, and in 9:16 the plate
   * covered the subject. Controls and diagnostics belong in the application UI, which is why the
   * notice is still recorded here (`getNotice()`) for the UI to render beside the preview.
   */
  operatorOverlay?: boolean;
}

export interface TransitionState {
  kind: TransitionKind;
  progress: number;
  done: boolean;
  fromMomentId?: string;
  toMomentId?: string;
}

const PANEL_BG = '#111827';
const PANEL_BORDER = '#334155';
const PANEL_TEXT = '#94A3B8';
const NOTICE_BG = 'rgba(15, 23, 42, 0.88)';
const NOTICE_TEXT = '#F8FAFC';
const SANS = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

export class MomentCompositor {
  readonly canvas: CompositorCanvas;

  private ctx: Ctx2D | null;
  private aspectRatio: AspectRatio;
  private widthPx: number;
  private heightPx: number;
  private resolver: MediaSourceResolver;
  private readonly nowFn: () => number;
  private readonly raf: ((callback: (timestampMs: number) => void) => number) | undefined;
  private readonly caf: ((handle: number) => void) | undefined;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly loadImage: ((src: string) => Promise<DrawableSource>) | undefined;
  private readonly background: string;
  private readonly operatorOverlay: boolean;

  private current: Moment | null = null;
  private previous: Moment | null = null;
  private transitionKind: TransitionKind = 'cut';
  private transitionDurationMs = 0;
  private transitionStartedAt = 0;
  private transitionActive = false;

  private notice: string | null = null;
  private readonly imageCache = new Map<string, DrawableSource>();
  private readonly imageLoading = new Set<string>();
  private frameStamps: number[] = [];
  private running = false;
  private targetFpsValue = 30;
  private rafHandle: number | null = null;
  private timerHandle: unknown = null;
  private framesRendered = 0;
  /** When the next composited frame is owed, in `nowFn` time. See `schedule`. */
  private frameDueAt = 0;
  /** What this display is actually doing, which is what the throttle is allowed to assume. */
  private readonly cadence = new DisplayCadence();

  constructor(options: MomentCompositorOptions) {
    this.canvas = options.canvas;
    this.aspectRatio = options.aspect;
    this.widthPx = Math.max(2, Math.round(options.width));
    this.heightPx = Math.max(2, Math.round(options.height));
    this.resolver = options.resolver ?? (() => null);
    this.nowFn = options.now ?? (() => Date.now());
    this.raf = options.raf ?? defaultRaf();
    this.caf = options.caf ?? defaultCaf();
    this.setTimeoutFn = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.loadImage = options.loadImage ?? defaultImageLoader();
    this.background = options.background ?? '#000000';
    this.operatorOverlay = options.operatorOverlay === true;
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    this.ctx = acquireContext(this.canvas);
  }

  // ------------------------------------------------------------------ state

  get aspect(): AspectRatio {
    return this.aspectRatio;
  }

  get width(): number {
    return this.widthPx;
  }

  get height(): number {
    return this.heightPx;
  }

  get moment(): Moment | null {
    return this.current;
  }

  get targetFps(): number {
    return this.targetFpsValue;
  }

  get frameCount(): number {
    return this.framesRendered;
  }

  /** Frames actually rendered in the last second. */
  get renderFps(): number {
    const cutoff = this.nowFn() - 1000;
    this.frameStamps = this.frameStamps.filter((t) => t > cutoff);
    return this.frameStamps.length;
  }

  /** False in an environment without canvas 2D support; rendering then becomes a safe no-op. */
  get hasContext(): boolean {
    return this.ctx !== null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setResolver(resolver: MediaSourceResolver): void {
    this.resolver = resolver;
  }

  setAspect(aspect: AspectRatio): void {
    this.aspectRatio = aspect;
  }

  resize(width: number, height: number): void {
    this.widthPx = Math.max(2, Math.round(width));
    this.heightPx = Math.max(2, Math.round(height));
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    // Some canvas implementations reset state on resize; re-acquire defensively.
    this.ctx = acquireContext(this.canvas) ?? this.ctx;
  }

  /**
   * Record an operator notice, e.g. "Camera disconnected". Pass null to clear.
   *
   * This is state, not paint. It reaches the frame only on a compositor built with
   * `operatorOverlay: true`, which is never one whose canvas is captured. Everywhere else the UI
   * reads `getNotice()` and renders it in the app, beside the preview.
   */
  setNotice(text: string | null): void {
    this.notice = text && text.trim() !== '' ? text : null;
  }

  getNotice(): string | null {
    return this.notice;
  }

  /**
   * Show a Moment. The first Moment appears immediately; later ones transition using the
   * incoming Moment's own transition settings unless `override` is given.
   */
  setMoment(moment: Moment, nowMs: number = this.nowFn(), override?: { kind: TransitionKind; durationMs: number }): void {
    const transition = override ?? moment.transition;
    if (!this.current) {
      this.current = moment;
      this.previous = null;
      this.transitionActive = false;
      this.transitionKind = 'cut';
      this.transitionDurationMs = 0;
      this.transitionStartedAt = nowMs;
      return;
    }
    if (this.current.id === moment.id && !this.transitionActive) {
      // Same Moment edited in place: swap without a transition so edits feel live.
      this.current = moment;
      return;
    }
    this.previous = this.current;
    this.current = moment;
    this.transitionKind = transition?.kind ?? 'cut';
    this.transitionDurationMs = Math.max(0, transition?.durationMs ?? 0);
    this.transitionStartedAt = nowMs;
    this.transitionActive = this.transitionKind !== 'cut' && this.transitionDurationMs > 0;
    if (!this.transitionActive) this.previous = null;
  }

  /** Current transition, or null when nothing is transitioning. */
  transitionState(nowMs: number = this.nowFn()): TransitionState | null {
    if (!this.transitionActive) return null;
    const progress = transitionProgress(nowMs, this.transitionStartedAt, this.transitionDurationMs);
    return {
      kind: this.transitionKind,
      progress,
      done: progress >= 1,
      fromMomentId: this.previous?.id,
      toMomentId: this.current?.id,
    };
  }

  // ------------------------------------------------------------------ loop

  /** Start the render loop at `fps` (rAF when available, otherwise setTimeout). */
  start(fps = 30): void {
    this.targetFpsValue = clampFps(fps);
    if (this.running) return;
    this.running = true;
    // A fresh start owes a frame immediately; only a running loop carries a due time forward.
    this.frameDueAt = 0;
    this.cadence.reset();
    this.schedule();
  }

  /**
   * Run, but on somebody else's loop.
   *
   * FormatRenderer drives every format from one animation-frame callback so that the three draws
   * of a single camera frame share a task (and therefore share one video-frame conversion). That
   * makes this compositor's own scheduler redundant - but not its STATE: `isRunning` means "this
   * compositor is producing frames", and the engine, the metrics sample and the UI all read it.
   * Left to the plain `stop()` this method replaces, a perfectly healthy live preview reported
   * itself as stopped, which is precisely the kind of lie the rest of this codebase is careful
   * not to tell. So the flag and the target frame rate are set truthfully, and only the scheduling
   * is handed over.
   */
  startDriven(fps = 30): void {
    this.targetFpsValue = clampFps(fps);
    this.cancelScheduled();
    this.running = true;
    this.frameDueAt = 0;
    this.cadence.reset();
  }

  stop(): void {
    this.running = false;
    this.cancelScheduled();
  }

  private cancelScheduled(): void {
    if (this.rafHandle !== null) {
      this.caf?.(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.timerHandle !== null) {
      this.clearTimeoutFn(this.timerHandle);
      this.timerHandle = null;
    }
  }

  dispose(): void {
    this.stop();
    this.imageCache.clear();
    this.imageLoading.clear();
    this.current = null;
    this.previous = null;
  }

  /** Advance time and render one frame. This is the only entry point the loop uses. */
  tick(nowMs: number = this.nowFn()): void {
    if (this.transitionActive) {
      const progress = transitionProgress(nowMs, this.transitionStartedAt, this.transitionDurationMs);
      if (progress >= 1) {
        this.transitionActive = false;
        this.previous = null;
      }
    }
    this.renderFrame(nowMs);
  }

  /** Render the current state at `nowMs` without mutating transition bookkeeping. */
  renderFrame(nowMs: number = this.nowFn()): void {
    this.framesRendered += 1;
    this.frameStamps.push(nowMs);
    if (this.frameStamps.length > 240) {
      const cutoff = nowMs - 1000;
      this.frameStamps = this.frameStamps.filter((t) => t > cutoff);
    }

    const ctx = this.ctx;
    if (!ctx) return;

    const progress = this.transitionActive
      ? transitionProgress(nowMs, this.transitionStartedAt, this.transitionDurationMs)
      : 1;
    const frame = computeTransitionFrame(
      this.transitionActive ? this.transitionKind : 'cut',
      progress,
      this.widthPx,
      this.heightPx,
    );

    safely(() => {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.widthPx, this.heightPx);
      if (this.previous && frame.from) this.drawMoment(ctx, this.previous, frame.from);
      if (this.current) this.drawMoment(ctx, this.current, frame.to);
      if (this.notice && this.operatorOverlay) this.drawNotice(ctx, this.notice);
      ctx.restore();
    });
  }

  // ------------------------------------------------------------------ drawing

  /**
   * Compose at the format's frame rate, not at the display's.
   *
   * The rAF branch used to render on every animation frame and ignore `targetFps` entirely, which
   * is a silent multiplier on the most expensive thing this product does: a 1080p30 broadcast on a
   * 120 Hz laptop composed four frames for every one the encoder could use, and `captureStream`
   * threw three of them away.
   *
   * `cadence.ts` decides what is due, and carries the measurement showing why the tolerance has to
   * be derived from the DISPLAY rather than from the format. In the product this loop is not the
   * one that runs - FormatRenderer drives every format together through `startDriven` and `tick` -
   * but a compositor used on its own must throttle by the same rule, or the two disagree about
   * what a frame rate means.
   */
  private schedule(): void {
    if (!this.running) return;
    const raf = this.raf;
    if (raf) {
      this.rafHandle = raf(() => {
        this.rafHandle = null;
        if (!this.running) return;
        const now = this.nowFn();
        const period = this.cadence.observe(now);
        if (frameIsDue(now, this.frameDueAt, period)) {
          this.frameDueAt = nextDueAt(now, this.frameDueAt, frameIntervalMs(this.targetFpsValue));
          this.tick(now);
        }
        this.schedule();
      });
      return;
    }
    this.timerHandle = this.setTimeoutFn(
      () => {
        this.timerHandle = null;
        if (!this.running) return;
        this.tick(this.nowFn());
        this.schedule();
      },
      Math.max(1, Math.round(1000 / this.targetFpsValue)),
    );
  }

  private drawMoment(ctx: Ctx2D, moment: Moment, transform: TransitionTransform): void {
    const cx = this.widthPx / 2;
    const cy = this.heightPx / 2;
    ctx.save();
    ctx.translate(cx + transform.translateX, cy + transform.translateY);
    ctx.scale(transform.scale, transform.scale);
    ctx.translate(-cx, -cy);
    for (const layer of visibleLayers(moment.layers, this.aspectRatio)) {
      this.drawLayer(ctx, layer, clamp01(transform.alpha));
    }
    ctx.restore();
  }

  private drawLayer(ctx: Ctx2D, layer: Layer, groupAlpha: number): void {
    const rect = toPixelRect(resolvePlacement(layer, this.aspectRatio), this.widthPx, this.heightPx);
    const radius = clampRadius(scaleForHeight(layer.radius ?? 0, this.heightPx), rect);
    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity) * groupAlpha;
    clipRect(ctx, rect, radius);
    switch (layer.kind) {
      case 'color':
        ctx.fillStyle = layer.color;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        break;
      case 'camera':
      case 'screen':
      case 'window':
      case 'video':
        this.drawMediaLayer(ctx, layer, rect);
        break;
      case 'image':
        this.drawImageLayer(ctx, layer, rect);
        break;
      case 'text':
        this.drawTextLayer(ctx, layer, rect);
        break;
      case 'browser':
        // Browser sources need an Electron BrowserView / webview. UNVERIFIED on the web.
        this.drawPlaceholder(ctx, rect, radius, layer.name || 'Browser source', 'Requires the desktop app');
        break;
      case 'overlay':
        this.drawPlaceholder(ctx, rect, radius, layer.name || 'Overlay', `Preset: ${layer.preset}`);
        break;
    }
    ctx.restore();
  }

  private drawMediaLayer(ctx: Ctx2D, layer: Layer, rect: PixelRect): void {
    const source = this.resolver(layer.id);
    if (!isDrawable(source)) {
      this.drawPlaceholder(ctx, rect, 0, layer.name || labelFor(layer.kind), 'Waiting for source');
      return;
    }
    const dims = sourceDimensions(source);
    const fit = layer.fit ?? 'cover';
    if (fit === 'contain') {
      // Letterbox so a portrait screen share does not show whatever is underneath.
      ctx.fillStyle = '#000000';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    const draw = computeFitRect(dims.w, dims.h, rect, fit);
    if (layer.mirror) {
      ctx.translate(2 * rect.x + rect.w, 0);
      ctx.scale(-1, 1);
    }
    safely(() => ctx.drawImage(source as CanvasImageSource, draw.x, draw.y, draw.w, draw.h));
  }

  private drawImageLayer(ctx: Ctx2D, layer: Extract<Layer, { kind: 'image' }>, rect: PixelRect): void {
    const cached = this.imageCache.get(layer.src);
    if (isDrawable(cached)) {
      const dims = sourceDimensions(cached);
      const draw = computeFitRect(dims.w, dims.h, rect, layer.fit ?? 'contain');
      if (layer.mirror) {
        ctx.translate(2 * rect.x + rect.w, 0);
        ctx.scale(-1, 1);
      }
      safely(() => ctx.drawImage(cached as CanvasImageSource, draw.x, draw.y, draw.w, draw.h));
      return;
    }
    this.requestImage(layer.src);
    this.drawPlaceholder(ctx, rect, 0, layer.name || 'Image', 'Loading...');
  }

  private drawTextLayer(ctx: Ctx2D, layer: Extract<Layer, { kind: 'text' }>, rect: PixelRect): void {
    const fontSize = Math.max(8, scaleForHeight(layer.fontSizePx, this.heightPx));
    const padding = fontSize * 0.35;
    if (layer.background) {
      ctx.fillStyle = layer.background;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.font = `${layer.weight} ${Math.round(fontSize)}px ${layer.fontFamily || SANS}`;
    ctx.fillStyle = layer.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = layer.align;
    const measure = makeMeasure(ctx, fontSize);
    const maxWidth = Math.max(1, rect.w - padding * 2);
    const lineHeight = fontSize * 1.2;
    const maxLines = Math.max(1, Math.floor(rect.h / lineHeight));
    const lines = wrapText(layer.text, maxWidth, measure, { maxLines });
    const blockHeight = lines.length * lineHeight;
    const top = rect.y + (rect.h - blockHeight) / 2;
    const x =
      layer.align === 'left'
        ? rect.x + padding
        : layer.align === 'right'
          ? rect.x + rect.w - padding
          : rect.x + rect.w / 2;
    lines.forEach((line, index) => {
      safely(() => ctx.fillText(line, x, top + index * lineHeight + lineHeight / 2, maxWidth));
    });
  }

  /**
   * A layer with nothing to draw yet. On the program canvas this is a plain plate the size of the
   * layer: the composition keeps its geometry and the viewer is told nothing, because "Waiting for
   * source" is a sentence for the operator, not for an audience. The labelled version only ever
   * appears on an operator-overlay compositor.
   */
  private drawPlaceholder(ctx: Ctx2D, rect: PixelRect, radius: number, title: string, subtitle?: string): void {
    if (!this.operatorOverlay) {
      drawPlate(ctx, rect, radius);
      return;
    }
    drawPanel(ctx, rect, radius, title, subtitle);
  }

  private drawNotice(ctx: Ctx2D, text: string): void {
    const fontSize = Math.max(12, scaleForHeight(34, this.heightPx));
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `600 ${Math.round(fontSize)}px ${SANS}`;
    const measure = makeMeasure(ctx, fontSize);
    const padX = fontSize * 0.8;
    const w = Math.min(this.widthPx * 0.9, measure(text) + padX * 2);
    const h = fontSize * 2;
    const x = (this.widthPx - w) / 2;
    const y = this.heightPx - h - fontSize;
    roundedRectPath(ctx, { x, y, w, h }, Math.min(h / 2, fontSize));
    ctx.fillStyle = NOTICE_BG;
    safely(() => ctx.fill());
    ctx.fillStyle = NOTICE_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    safely(() => ctx.fillText(text, this.widthPx / 2, y + h / 2, w - padX));
    ctx.restore();
  }

  private requestImage(src: string): void {
    const loader = this.loadImage;
    if (!loader || this.imageLoading.has(src) || this.imageCache.has(src)) return;
    this.imageLoading.add(src);
    loader(src)
      .then((bitmap) => {
        this.imageCache.set(src, bitmap);
      })
      .catch(() => {
        /* A broken image keeps showing the placeholder; never break the program output. */
      })
      .finally(() => {
        this.imageLoading.delete(src);
      });
  }
}

// -------------------------------------------------------------------- helpers

function labelFor(kind: Layer['kind']): string {
  if (kind === 'camera') return 'Camera';
  if (kind === 'screen') return 'Screen';
  if (kind === 'window') return 'Window';
  return 'Video';
}

function clipRect(ctx: Ctx2D, rect: PixelRect, radius: number): void {
  if (radius > 0) {
    roundedRectPath(ctx, rect, radius);
  } else {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
  }
  safely(() => ctx.clip());
}

/** Path-only rounded rectangle (no ctx.roundRect dependency - older WebViews lack it). */
export function roundedRectPath(ctx: Ctx2D, rect: PixelRect, radius: number): void {
  const r = Math.max(0, Math.min(radius, Math.min(rect.w, rect.h) / 2));
  const { x, y, w, h } = rect;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** The program-safe placeholder: the layer's shape, filled, with no words on it. */
function drawPlate(ctx: Ctx2D, rect: PixelRect, radius: number): void {
  ctx.save();
  roundedRectPath(ctx, rect, radius > 0 ? radius : Math.min(16, Math.min(rect.w, rect.h) / 8));
  ctx.fillStyle = PANEL_BG;
  safely(() => ctx.fill());
  ctx.restore();
}

function drawPanel(ctx: Ctx2D, rect: PixelRect, radius: number, title: string, subtitle?: string): void {
  ctx.save();
  roundedRectPath(ctx, rect, radius > 0 ? radius : Math.min(16, Math.min(rect.w, rect.h) / 8));
  ctx.fillStyle = PANEL_BG;
  safely(() => ctx.fill());
  ctx.strokeStyle = PANEL_BORDER;
  ctx.lineWidth = Math.max(1, Math.min(rect.w, rect.h) * 0.004);
  safely(() => ctx.stroke());
  const fontSize = Math.max(10, Math.min(rect.h * 0.12, rect.w * 0.08));
  ctx.fillStyle = PANEL_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(fontSize)}px ${SANS}`;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  safely(() => ctx.fillText(title, cx, subtitle ? cy - fontSize * 0.7 : cy, rect.w * 0.9));
  if (subtitle) {
    ctx.font = `400 ${Math.round(fontSize * 0.7)}px ${SANS}`;
    safely(() => ctx.fillText(subtitle, cx, cy + fontSize * 0.7, rect.w * 0.9));
  }
  ctx.restore();
}

function makeMeasure(ctx: Ctx2D, fontSizePx: number): (text: string) => number {
  return (text: string) => {
    try {
      const metrics = ctx.measureText?.(text);
      const width = metrics?.width;
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) return width;
    } catch {
      /* fall through to the estimate */
    }
    return approximateWidth(text, fontSizePx);
  };
}

/** Canvas calls against a fake/partial context must never break a live program. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* intentionally ignored */
  }
}

/**
 * The program context.
 *
 * An opaque context (`getContext('2d', { alpha: false })`) was tried here, on the reasoning that
 * the background is filled edge to edge every frame so the alpha channel carries nothing. It was
 * measured and it does nothing: on this product's target rasteriser, one 1280x720 camera frame
 * drawn into a 1920x1080 canvas costs 10.1 ms opaque and 10.1 ms not, with and without an attached
 * `captureStream` (`node apps/web/scripts/perf-canvas.mjs`, six interleaved rounds, n=200 each).
 * It is left out rather than kept as a harmless extra, because an unmeasured change to how the
 * program canvas is allocated is not harmless - it is a thing that would have to be ruled out the
 * next time a frame looks wrong.
 */
function acquireContext(canvas: CompositorCanvas): Ctx2D | null {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx !== 'object') return null;
    return ctx as Ctx2D;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function clampFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  return Math.min(60, Math.max(1, Math.round(fps)));
}

export function defaultRaf(): ((callback: (timestampMs: number) => void) => number) | undefined {
  const g = globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number };
  const raf = g.requestAnimationFrame;
  return typeof raf === 'function' ? (cb) => raf.call(globalThis, cb) : undefined;
}

export function defaultCaf(): ((handle: number) => void) | undefined {
  const g = globalThis as { cancelAnimationFrame?: (h: number) => void };
  const caf = g.cancelAnimationFrame;
  return typeof caf === 'function' ? (h) => caf.call(globalThis, h) : undefined;
}

function defaultImageLoader(): ((src: string) => Promise<DrawableSource>) | undefined {
  const g = globalThis as { Image?: typeof Image };
  const ImageCtor = g.Image;
  if (typeof ImageCtor !== 'function') return undefined;
  return (src: string) =>
    new Promise<DrawableSource>((resolve, reject) => {
      const img = new ImageCtor();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load image: ${src.slice(0, 120)}`));
      img.src = src;
    });
}
