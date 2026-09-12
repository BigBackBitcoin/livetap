/**
 * Pure placement / fit geometry for the Moment compositor.
 *
 * Everything here is deliberately DOM-free so it can be unit tested in plain Node:
 * a Moment is authored in normalized 0..1 space and resolved to device pixels here.
 */
import type { AspectRatio } from '@livetap/core';
import type { Layer, NormalizedRect } from '@livetap/core';

/** A rectangle in device pixels. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FitMode = 'cover' | 'contain' | 'fill';

/** Reference height every authored size (font px, corner radius px) is expressed against. */
export const REFERENCE_HEIGHT = 1080;

/** Placement carrier: anything with a `placement` map (a Layer, or a bare object in tests). */
export interface HasPlacement {
  placement: Partial<Record<AspectRatio, NormalizedRect>> & { default: NormalizedRect };
}

/**
 * Resolve a layer's normalized rectangle for one aspect ratio.
 * Falls back to `placement.default` when the ratio has no specific override.
 */
export function resolvePlacement(layer: HasPlacement | Layer, aspect: AspectRatio): NormalizedRect {
  const map = (layer as HasPlacement).placement;
  const specific = map[aspect];
  const rect = specific ?? map.default;
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

/** Convert a normalized rect to device pixels on a canvas of `width` x `height`. */
export function toPixelRect(rect: NormalizedRect, width: number, height: number): PixelRect {
  return { x: rect.x * width, y: rect.y * height, w: rect.w * width, h: rect.h * height };
}

/**
 * Compute where a source of `srcW` x `srcH` should be drawn inside `dst`.
 *
 * - `fill`    stretches to exactly `dst` (aspect ratio is not preserved).
 * - `contain` scales down until the whole source is inside `dst`, centred (letterboxed).
 * - `cover`   scales up until `dst` is fully covered, centred (overflow is clipped by the caller).
 *
 * Degenerate sources (zero / negative / non-finite dimensions) fall back to `dst` so a
 * not-yet-ready <video> never produces NaN draw calls.
 */
export function computeFitRect(srcW: number, srcH: number, dst: PixelRect, fit: FitMode = 'cover'): PixelRect {
  if (!isPositive(srcW) || !isPositive(srcH) || !isPositive(dst.w) || !isPositive(dst.h) || fit === 'fill') {
    return { x: dst.x, y: dst.y, w: dst.w, h: dst.h };
  }
  const scaleX = dst.w / srcW;
  const scaleY = dst.h / srcH;
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h };
}

/** Clamp an authored corner radius to something drawable inside `rect`. */
export function clampRadius(radiusPx: number, rect: PixelRect): number {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) return 0;
  return Math.max(0, Math.min(radiusPx, Math.min(rect.w, rect.h) / 2));
}

/** Scale an authored-at-1080p pixel value to the current output height. */
export function scaleForHeight(valuePx: number, outputHeight: number): number {
  if (!isPositive(outputHeight)) return valuePx;
  return (valuePx * outputHeight) / REFERENCE_HEIGHT;
}

/** Layers sorted bottom-to-top by z, stable for equal z (authoring order wins). */
export function orderLayers(layers: readonly Layer[]): Layer[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => (a.layer.z === b.layer.z ? a.index - b.index : a.layer.z - b.layer.z))
    .map((entry) => entry.layer);
}

/** Layers that actually contribute pixels: visible, non-transparent, non-empty. */
export function visibleLayers(layers: readonly Layer[], aspect: AspectRatio): Layer[] {
  return orderLayers(layers).filter((layer) => {
    if (!layer.visible) return false;
    if (layer.opacity <= 0) return false;
    const rect = resolvePlacement(layer, aspect);
    return isPositive(rect.w) && isPositive(rect.h);
  });
}

function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}
