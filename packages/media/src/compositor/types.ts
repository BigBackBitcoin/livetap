/**
 * Structural canvas types. The compositor only needs a 2D context and a size, so both
 * HTMLCanvasElement and OffscreenCanvas satisfy `CompositorCanvas` — and so does a test fake.
 */

/** Anything the 2D context can draw. */
export type DrawableSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap
  | OffscreenCanvas;

/**
 * Maps a layer id to the live media that should fill it.
 * The engine owns acquisition; the compositor only draws what it is given.
 * Returning null/undefined makes the compositor draw a "waiting for source" panel.
 */
export type MediaSourceResolver = (layerId: string) => DrawableSource | null | undefined;

/** The subset of a canvas the compositor uses. */
export interface CompositorCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d'): unknown;
  /** Present on HTMLCanvasElement; absent on OffscreenCanvas. */
  captureStream?(frameRequestRate?: number): MediaStream;
}

/** Intrinsic pixel size of a drawable source, 0 when not yet known. */
export function sourceDimensions(source: DrawableSource): { w: number; h: number } {
  const anySource = source as Partial<HTMLVideoElement & HTMLImageElement & { width: number; height: number }>;
  if (typeof anySource.videoWidth === 'number' && anySource.videoWidth > 0) {
    return { w: anySource.videoWidth, h: anySource.videoHeight ?? 0 };
  }
  if (typeof anySource.naturalWidth === 'number' && anySource.naturalWidth > 0) {
    return { w: anySource.naturalWidth, h: anySource.naturalHeight ?? 0 };
  }
  return { w: Number(anySource.width ?? 0), h: Number(anySource.height ?? 0) };
}

/** True when a <video> element has enough data to be drawn without throwing. */
export function isDrawable(source: DrawableSource | null | undefined): source is DrawableSource {
  if (!source) return false;
  const dims = sourceDimensions(source);
  return dims.w > 0 && dims.h > 0;
}
