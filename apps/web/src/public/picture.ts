/**
 * The picture engine.
 *
 * The stage used to be an empty grey rectangle with the word "Camera" in one corner, which is
 * exactly what a first-time visitor reported seeing. A page whose whole claim is "one production,
 * six correctly formatted outputs" has to show a production. So this module owns the only real
 * pixels on the page:
 *
 *   - a local camera preview, asked for once, never recorded and never uploaded, or
 *   - a demo clip that is good enough to stand in for one when the camera is denied or absent.
 *
 * It fills the layer elements `main.ts` already places. It does NOT place them: `main.ts` keeps
 * writing `--lx/--ly/--lw/--lh/--lr` and `.is-on`, and this module never touches those. The two
 * responsibilities meet at the layer element and nowhere else.
 *
 * `compose()` is the same picture drawn into a 2D context, so an output preview is a re-crop of
 * the production rather than a second drawing of it.
 */

import './picture.css';

import { SAFE_AREAS } from './data.js';
import type { Format } from './data.js';

/* ---------------------------------------------------------------------- types */

export type SourceKind = 'none' | 'demo' | 'camera';

export interface PictureAssets {
  creator: { mp4: string; webm: string; poster: string };
  guest: { mp4: string; webm: string; poster: string };
  /** An svg or webp url. Shown contained on a dark ground, so Screen Share reads as a screen. */
  screen: string;
}

export interface ComposedLayer {
  kind: 'color' | 'camera' | 'guest' | 'screen' | 'text';
  /** Normalized 0..1, exactly as `main.ts` computes it through the product's own placement. */
  rect: { x: number; y: number; w: number; h: number };
  radius?: number;
  text?: string;
}

export type CameraOutcome = 'granted' | 'denied' | 'unavailable' | 'insecure';

export interface Picture {
  /** The `<video>` elements the engine owns: main (camera stream or demo clip) and guest. */
  readonly main: HTMLVideoElement;
  readonly guest: HTMLVideoElement;
  readonly source: SourceKind;
  /**
   * Local only. Requests `getUserMedia` video (no audio), 1280x720 ideal, facingMode user.
   * Never records, never uploads. Resolves with the outcome; on anything but `granted` the
   * demo picture stays exactly as it was.
   */
  useCamera(): Promise<CameraOutcome>;
  stopCamera(): void;
  /** Fill the stage canvas's layer elements with real content. Placement stays `main.ts`'s. */
  mount(canvasEl: HTMLElement): void;
  onChange(cb: (source: SourceKind) => void): () => void;
  /** The element a DOM layer shows: `main` in the camera layer, `guest` in the guest layer. */
  videoFor(kind: 'camera' | 'guest'): HTMLVideoElement;
  /** Draw the current composition into a 2D context, for the output previews. */
  compose(ctx: CanvasRenderingContext2D, w: number, h: number, layers: ComposedLayer[]): void;
  /**
   * Start a new draw pass, discarding the shared downscale of the previous one.
   *
   * Call it once before a batch of `compose` calls. Every consumer in that batch then reads one
   * rescaled copy of the current frame instead of rescaling the video itself, and they are all
   * guaranteed to be showing the same instant - a thumbnail one frame behind the one beside it
   * is the bug this ordering exists to prevent.
   */
  beginFrame(): void;
}

/* ------------------------------------------------------------------- constants */

/**
 * Canvas takes no custom properties, so the values the previews paint with are literals. They
 * are the brand's own ground, panel and ink, and `screen.svg` is built from the same three.
 * The live accent only ever appears with an alpha, so it is written inline as rgba().
 */
const GROUND = '#12151A';
const PANEL = '#1C2027';
const INK = '#EDEFF2';

const FONT = "600 16px 'Archivo', 'Segoe UI', Helvetica, Arial, sans-serif";

/* ------------------------------------------------------------------- geometry */

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The centre cover crop: the largest centred window of a `sw x sh` source that has the
 * destination's aspect. Re-framing a 16:9 production into 9:16 is this function and nothing
 * else, which is why it is exported and tested rather than inlined.
 */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): CropRect {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { sx: 0, sy: 0, sw, sh };
  const scale = Math.max(dw / sw, dh / sh);
  const cw = dw / scale;
  const ch = dh / scale;
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
}

/** The contain fit: the whole source, centred, letterboxed inside the destination rect. */
export function containBox(
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): { x: number; y: number; w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { x: dx, y: dy, w: dw, h: dh };
  const scale = Math.min(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: dx + (dw - w) / 2, y: dy + (dh - h) / 2, w, h };
}

/**
 * The chat-safe zone, drawn.
 *
 * On a vertical platform the bottom 28% and the trailing 16% are where the platform's own chat
 * and buttons sit. That is the whole point the page is making, so the preview shows the band
 * rather than describing it.
 */
export function drawSafeArea(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  format: Format,
  label = 'chat',
): void {
  const s = SAFE_AREAS[format];
  const bottom = h * s.bottom;
  const right = w * s.right;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 77, 63, 0.12)';
  ctx.fillRect(0, h - bottom, w, bottom);
  ctx.fillRect(w - right, 0, right, h - bottom);

  /* A few diagonals, so the band reads as reserved rather than as a colour choice. */
  ctx.strokeStyle = 'rgba(255, 77, 63, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -h; x < w; x += 7) {
    ctx.moveTo(x, h);
    ctx.lineTo(x + bottom, h - bottom);
  }
  ctx.stroke();

  const size = Math.max(6, Math.round(h * 0.045));
  ctx.fillStyle = 'rgba(237, 239, 242, 0.72)';
  ctx.font = FONT.replace('16px', `${size}px`);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, 4, h - bottom + size + 2);
  ctx.restore();
}

/* --------------------------------------------------------------------- engine */

interface Demo {
  video: HTMLVideoElement;
  poster: HTMLImageElement | null;
  sources: HTMLSourceElement[];
}

function makeImage(src: string): HTMLImageElement | null {
  if (typeof document === 'undefined') return null;
  const img = document.createElement('img');
  img.decoding = 'async';
  img.alt = '';
  img.src = src;
  return img;
}

function makeVideo(
  clip: { mp4: string; webm: string; poster: string },
  reduced: boolean,
  label: string,
): Demo {
  const video = document.createElement('video');
  video.className = 'ltp-media';
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = !reduced;
  video.preload = 'metadata';
  video.poster = clip.poster;
  video.setAttribute('aria-label', label);
  /* Decoration: everything the clip shows is also said in text beside the stage. */
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  const sources = [
    ['video/webm', clip.webm],
    ['video/mp4', clip.mp4],
  ].map(([type, src]) => {
    const el = document.createElement('source');
    el.type = type as string;
    el.src = src as string;
    return el;
  });
  sources.forEach((s) => video.append(s));
  return { video, poster: makeImage(clip.poster), sources };
}

function ready(v: HTMLVideoElement): boolean {
  return v.videoWidth > 0 && v.videoHeight > 0 && (v.readyState ?? 0) >= 2;
}

/* ------------------------------------------------------- shared frame source */
/*
 * One production, many destinations, one resample.
 *
 * Every consumer used to call `drawImage` straight from the <video>, so a single camera frame
 * was decoded and rescaled once per thumbnail per pass: six destination tiles, six Moment rail
 * cards, the stage. A CPU profile of the page at four-times slowdown put 55.7% of all
 * main-thread time inside `drawImage`, at 10.6 ms a call, and the reason every call was that
 * expensive is that every one of them was resampling a full-resolution video frame down to a
 * 352x198 thumbnail, from scratch, independently.
 *
 * So the frame is rescaled ONCE per pass into a scratch canvas, and every consumer smaller than
 * the scratch reads from that instead. The expensive resample happens once; the rest become
 * near-1:1 copies of a small image. This is the same shape as the real broadcast pipeline, where
 * one composed picture fans out to many encoders rather than each encoder compositing its own.
 *
 * Nothing above the scratch size is touched: the stage still reads the video directly, so the
 * biggest picture on the page keeps full quality. 512px is comfortably above the 352px widest
 * thumbnail, so no consumer of the scratch is ever upscaling.
 */
const SCRATCH_W = 512;
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
let scratchSource: HTMLVideoElement | null = null;
let scratchFilled = false;
/** The video's own clock at the moment the scratch was filled. -1 means never. */
let scratchTime = -1;

/**
 * Drop the cached downscale.
 *
 * Called once per draw pass by whoever owns the loop. It is explicit rather than time-based
 * because a pass is a batch of composes, and the one thing that must never happen is a thumbnail
 * showing a frame older than the one beside it.
 */
export function beginFrame(): void {
  scratchFilled = false;
}

/** The shared downscale of this frame, or null when there is no cheaper source than the video. */
function scaled(video: HTMLVideoElement): { src: CanvasImageSource; w: number; h: number } | null {
  if (typeof document === 'undefined') return null;
  // Nothing to gain when the source is already at or below the scratch size.
  if (video.videoWidth <= SCRATCH_W) return null;

  const h = Math.max(1, Math.round((SCRATCH_W * video.videoHeight) / video.videoWidth));
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratchCtx = scratch.getContext('2d', { alpha: false });
    if (scratchCtx) {
      /*
       * The scratch is only ever read by consumers smaller than it is, and they do their own
       * filtering on the way down. Paying for high-quality filtering twice buys nothing at 352px.
       */
      scratchCtx.imageSmoothingQuality = 'low';
    }
  }
  if (!scratchCtx) return null;
  if (scratch.width !== SCRATCH_W || scratch.height !== h) {
    scratch.width = SCRATCH_W;
    scratch.height = h;
    scratchFilled = false;
  }
  /*
   * Refill only when the picture has actually moved on.
   *
   * Two loops draw from this - the destination thumbnails at 10 fps and the outputs panel at its
   * own cadence - and each correctly starts its own pass, so a blunt "invalidate on beginFrame"
   * would resample twice in a tick where both happen to run. The video's own clock settles it:
   * same `currentTime`, same pixels, and the copy already in the scratch is exactly right.
   *
   * It stays keyed on `beginFrame` as well, so a source swap or a paused clock can never serve a
   * frame from a previous pass.
   */
  const stale = scratchSource !== video || video.currentTime !== scratchTime;
  if (!scratchFilled && stale) {
    scratchCtx.drawImage(video, 0, 0, SCRATCH_W, h);
    scratchSource = video;
    scratchTime = video.currentTime;
  }
  scratchFilled = true;
  return { src: scratch, w: SCRATCH_W, h };
}

function drawable(
  demo: Demo,
  destWidth?: number,
): { src: CanvasImageSource; w: number; h: number } | null {
  if (ready(demo.video)) {
    /*
     * Only consumers that are actually smaller get the scratch. A destination wider than the
     * scratch would be upscaling a downscale, which is visibly worse than one honest resample.
     */
    if (destWidth !== undefined && destWidth <= SCRATCH_W) {
      const shared = scaled(demo.video);
      if (shared) return shared;
    }
    return { src: demo.video, w: demo.video.videoWidth, h: demo.video.videoHeight };
  }
  const p = demo.poster;
  if (p && p.naturalWidth > 0 && p.naturalHeight > 0) {
    return { src: p, w: p.naturalWidth, h: p.naturalHeight };
  }
  return null;
}

function play(v: HTMLVideoElement): void {
  try {
    const p: unknown = v.play?.();
    if (p && typeof (p as Promise<void>).catch === 'function') {
      (p as Promise<void>).catch(() => {
        /* Autoplay refused. The poster is already showing, so there is nothing to recover. */
      });
    }
  } catch {
    /* Same. A picture engine must never throw into the page's boot path. */
  }
}

export function createPicture(assets: PictureAssets, opts: { reduced: boolean }): Picture {
  const reduced = opts.reduced;
  const creator = makeVideo(assets.creator, reduced, 'Demo camera picture');
  const guestDemo = makeVideo(assets.guest, reduced, 'Demo guest picture');
  const screenImg = makeImage(assets.screen);
  if (screenImg) screenImg.className = 'ltp-media ltp-media--screen';

  let source: SourceKind = 'demo';
  let stream: MediaStream | null = null;
  const listeners = new Set<(s: SourceKind) => void>();

  const emit = (): void => {
    for (const cb of [...listeners]) cb(source);
  };

  const setSource = (next: SourceKind): void => {
    if (source === next) return;
    source = next;
    creator.video.classList.toggle('is-mirrored', next === 'camera');
    emit();
  };

  /* ------------------------------------------------------------------ camera */

  async function useCamera(): Promise<CameraOutcome> {
    const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return 'insecure';
    if (typeof isSecureContext === 'boolean' && !isSecureContext) return 'insecure';
    let got: MediaStream;
    try {
      got = await md.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        return 'denied';
      }
      return 'unavailable';
    }
    try {
      creator.video.srcObject = got;
    } catch {
      /* An element that will not take a stream is a browser that cannot show one. The demo
         picture is still loaded and still playing, so nothing is lost by saying so. */
      for (const track of got.getTracks()) track.stop();
      return 'unavailable';
    }
    stream = got;
    /* The demo clip is unloaded rather than hidden, so the browser stops fetching it.
       `srcObject` already takes precedence over the <source> children, so there is no reload. */
    creator.video.replaceChildren();
    creator.video.removeAttribute('src');
    setSource('camera');
    play(creator.video);
    return 'granted';
  }

  function stopCamera(): void {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    creator.video.srcObject = null;
    creator.video.poster = assets.creator.poster;
    creator.sources.forEach((s) => creator.video.append(s));
    try {
      creator.video.load?.();
    } catch {
      /* As above. */
    }
    setSource('demo');
    if (!reduced) play(creator.video);
  }

  /* ------------------------------------------------------------------- mount */

  function mount(canvasEl: HTMLElement): void {
    const layer = (kind: string): HTMLElement | null =>
      canvasEl.querySelector<HTMLElement>(`[data-lt-layer="${kind}"]`);

    const cam = layer('camera');
    if (cam) {
      cam.replaceChildren(creator.video);
      cam.classList.add('ltp-layer--media');
    }
    const gst = layer('guest');
    if (gst) {
      gst.replaceChildren(guestDemo.video);
      gst.classList.add('ltp-layer--media');
    }
    const scr = layer('screen');
    if (scr && screenImg) {
      scr.replaceChildren(screenImg);
      scr.classList.add('ltp-layer--media', 'ltp-layer--screen');
    }
    layer('color')?.classList.add('ltp-layer--ground');
    /* `main.ts` keeps writing this one's textContent, so it only ever gets a class. */
    layer('text')?.classList.add('ltp-layer--typed');

    if (!reduced) {
      play(creator.video);
      play(guestDemo.video);
    }
  }

  /* ----------------------------------------------------------------- compose */

  function ground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillStyle = GROUND;
    ctx.fillRect(x, y, w, h);
    if (typeof ctx.createLinearGradient !== 'function') return;
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, 'rgba(255, 77, 63, 0.16)');
    g.addColorStop(0.55, 'rgba(255, 77, 63, 0.04)');
    g.addColorStop(1, 'rgba(18, 21, 26, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }

  function clipRounded(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): boolean {
    if (r <= 0 || typeof ctx.roundRect !== 'function') return false;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    ctx.clip();
    return true;
  }

  function cover(
    ctx: CanvasRenderingContext2D,
    demo: Demo,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    const clipped = clipRounded(ctx, x, y, w, h, radius);
    const src = drawable(demo, w);
    if (!src) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, y, w, h);
    } else {
      /* The broadcast picture is never mirrored: the flip is a self-view convention and the
         people watching would read reversed text. Only the DOM preview gets `is-mirrored`. */
      const c = coverCrop(src.w, src.h, w, h);
      ctx.drawImage(src.src, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
    }
    if (clipped) ctx.restore();
  }

  function screen(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    ctx.fillStyle = GROUND;
    ctx.fillRect(x, y, w, h);
    const img = screenImg;
    if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(x + w * 0.08, y + h * 0.12, w * 0.84, h * 0.66);
      return;
    }
    const b = containBox(img.naturalWidth, img.naturalHeight, x, y, w, h);
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
  }

  function typed(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (!text) return;
    const size = Math.max(7, Math.round(h * 0.3));
    ctx.save();
    ctx.font = FONT.replace('16px', `${size}px`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x + w / 2;
    const cy = y + h / 2;
    /* A scrim behind the text only. A full-frame wash would darken a picture the page is
       asking you to look at. */
    const measured = ctx.measureText?.(text);
    const tw = Math.min(w, (measured?.width ?? w * 0.7) + size);
    const th = size * 1.8;
    ctx.fillStyle = 'rgba(18, 21, 26, 0.55)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, Math.min(th / 2, 8));
      ctx.fill();
    } else {
      ctx.fillRect(cx - tw / 2, cy - th / 2, tw, th);
    }
    ctx.fillStyle = INK;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function compose(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layers: ComposedLayer[],
  ): void {
    ground(ctx, 0, 0, w, h);
    for (const l of layers) {
      const x = l.rect.x * w;
      const y = l.rect.y * h;
      const lw = l.rect.w * w;
      const lh = l.rect.h * h;
      if (lw <= 0 || lh <= 0) continue;
      /* The radius arrives in the CSS layer's own px, against a stage far wider than a
         176px preview, so it is scaled by the preview's width rather than copied. */
      const r = ((l.radius ?? 0) * w) / 640;
      switch (l.kind) {
        case 'color':
          ground(ctx, x, y, lw, lh);
          break;
        case 'camera':
          cover(ctx, creator, x, y, lw, lh, r);
          break;
        case 'guest':
          cover(ctx, guestDemo, x, y, lw, lh, r);
          break;
        case 'screen':
          screen(ctx, x, y, lw, lh);
          break;
        case 'text':
          typed(ctx, l.text ?? '', x, y, lw, lh);
          break;
      }
    }
  }

  return {
    main: creator.video,
    guest: guestDemo.video,
    get source(): SourceKind {
      return source;
    },
    useCamera,
    stopCamera,
    mount,
    onChange(cb: (s: SourceKind) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    videoFor(kind: 'camera' | 'guest'): HTMLVideoElement {
      return kind === 'guest' ? guestDemo.video : creator.video;
    },
    compose,
    beginFrame,
  };
}
