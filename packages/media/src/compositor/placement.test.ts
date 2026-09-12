import { describe, expect, it } from 'vitest';
import type { AspectRatio, Layer, NormalizedRect } from '@livetap/core';
import { defaultMoments } from '@livetap/core';
import {
  REFERENCE_HEIGHT,
  clampRadius,
  computeFitRect,
  orderLayers,
  resolvePlacement,
  scaleForHeight,
  toPixelRect,
  visibleLayers,
  type PixelRect,
} from './placement.js';

const FULL: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

function layer(partial: Partial<Layer> & { id: string }): Layer {
  return {
    kind: 'color',
    name: partial.id,
    visible: true,
    placement: { default: FULL },
    opacity: 1,
    z: 0,
    color: '#fff',
    ...partial,
  } as Layer;
}

describe('resolvePlacement', () => {
  const placement = {
    default: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    '9:16': { x: 0, y: 0.5, w: 1, h: 0.5 },
  } as Layer['placement'];

  it('uses the aspect-specific rect when one exists', () => {
    expect(resolvePlacement({ placement }, '9:16')).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it('falls back to default for ratios without an override', () => {
    expect(resolvePlacement({ placement }, '16:9')).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(resolvePlacement({ placement }, '1:1')).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('returns a copy so callers cannot mutate the Moment', () => {
    const result = resolvePlacement({ placement }, '16:9');
    result.x = 0.9;
    expect(resolvePlacement({ placement }, '16:9').x).toBe(0.1);
  });

  it('resolves every built-in Moment layer in every aspect ratio', () => {
    for (const moment of defaultMoments()) {
      for (const l of moment.layers) {
        for (const aspect of ['16:9', '9:16', '1:1'] as AspectRatio[]) {
          const rect = resolvePlacement(l, aspect);
          expect(rect.w).toBeGreaterThan(0);
          expect(rect.h).toBeGreaterThan(0);
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(1.0001);
          expect(rect.y + rect.h).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });
});

describe('toPixelRect', () => {
  it('scales normalized space into device pixels', () => {
    expect(toPixelRect({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, 1920, 1080)).toEqual({ x: 960, y: 270, w: 480, h: 540 });
  });
});

describe('computeFitRect', () => {
  const dst: PixelRect = { x: 100, y: 50, w: 400, h: 200 };

  it('fill stretches exactly to the destination', () => {
    expect(computeFitRect(1280, 720, dst, 'fill')).toEqual(dst);
  });

  it('contain letterboxes and stays inside the destination', () => {
    const r = computeFitRect(1000, 1000, dst, 'contain');
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
    expect(r.x).toBe(200); // centred horizontally
    expect(r.y).toBe(50);
    expect(r.w).toBeLessThanOrEqual(dst.w);
    expect(r.h).toBeLessThanOrEqual(dst.h);
  });

  it('cover fills the destination and overflows on one axis', () => {
    const r = computeFitRect(1000, 1000, dst, 'cover');
    expect(r.w).toBe(400);
    expect(r.h).toBe(400);
    expect(r.y).toBe(-50); // overflow is centred, clipped by the caller
    expect(r.x).toBe(100);
  });

  it('preserves aspect ratio for cover and contain', () => {
    for (const fit of ['cover', 'contain'] as const) {
      const r = computeFitRect(1280, 720, dst, fit);
      expect(r.w / r.h).toBeCloseTo(1280 / 720, 6);
    }
  });

  it('centres the source in both fit modes', () => {
    for (const fit of ['cover', 'contain'] as const) {
      const r = computeFitRect(640, 480, dst, fit);
      expect(r.x + r.w / 2).toBeCloseTo(dst.x + dst.w / 2, 6);
      expect(r.y + r.h / 2).toBeCloseTo(dst.y + dst.h / 2, 6);
    }
  });

  it('defaults to cover', () => {
    expect(computeFitRect(1000, 1000, dst)).toEqual(computeFitRect(1000, 1000, dst, 'cover'));
  });

  it('falls back to the destination for degenerate sources', () => {
    expect(computeFitRect(0, 720, dst, 'cover')).toEqual(dst);
    expect(computeFitRect(1280, 0, dst, 'contain')).toEqual(dst);
    expect(computeFitRect(Number.NaN, 720, dst, 'cover')).toEqual(dst);
    expect(computeFitRect(-10, -10, dst, 'cover')).toEqual(dst);
    expect(computeFitRect(Number.POSITIVE_INFINITY, 720, dst, 'cover')).toEqual(dst);
  });

  it('falls back to the destination when the destination is empty', () => {
    const empty = { x: 0, y: 0, w: 0, h: 0 };
    expect(computeFitRect(1280, 720, empty, 'cover')).toEqual(empty);
  });

  it('never produces NaN', () => {
    for (const fit of ['cover', 'contain', 'fill'] as const) {
      const r = computeFitRect(1920, 1080, { x: 0, y: 0, w: 1080, h: 1920 }, fit);
      for (const value of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('clampRadius', () => {
  const rect: PixelRect = { x: 0, y: 0, w: 100, h: 40 };

  it('clamps to half the shortest side', () => {
    expect(clampRadius(999, rect)).toBe(20);
  });

  it('passes small radii through', () => {
    expect(clampRadius(8, rect)).toBe(8);
  });

  it('treats invalid radii as square corners', () => {
    expect(clampRadius(-4, rect)).toBe(0);
    expect(clampRadius(Number.NaN, rect)).toBe(0);
  });
});

describe('scaleForHeight', () => {
  it('is identity at the 1080p reference height', () => {
    expect(scaleForHeight(96, REFERENCE_HEIGHT)).toBe(96);
  });

  it('halves authored sizes at 540p and doubles at 2160p', () => {
    expect(scaleForHeight(96, 540)).toBe(48);
    expect(scaleForHeight(96, 2160)).toBe(192);
  });

  it('returns the raw value when the height is unusable', () => {
    expect(scaleForHeight(96, 0)).toBe(96);
  });
});

describe('orderLayers / visibleLayers', () => {
  it('sorts by z ascending and keeps authoring order for ties', () => {
    const layers = [
      layer({ id: 'top', z: 50 }),
      layer({ id: 'a', z: 10 }),
      layer({ id: 'b', z: 10 }),
      layer({ id: 'bg', z: 0 }),
    ];
    expect(orderLayers(layers).map((l) => l.id)).toEqual(['bg', 'a', 'b', 'top']);
  });

  it('does not mutate the input array', () => {
    const layers = [layer({ id: 'top', z: 50 }), layer({ id: 'bg', z: 0 })];
    orderLayers(layers);
    expect(layers.map((l) => l.id)).toEqual(['top', 'bg']);
  });

  it('drops hidden, transparent and empty layers', () => {
    const layers = [
      layer({ id: 'ok', z: 1 }),
      layer({ id: 'hidden', visible: false }),
      layer({ id: 'transparent', opacity: 0 }),
      layer({ id: 'empty', placement: { default: { x: 0, y: 0, w: 0, h: 0.5 } } }),
    ];
    expect(visibleLayers(layers, '16:9').map((l) => l.id)).toEqual(['ok']);
  });

  it('respects per-aspect placement when deciding emptiness', () => {
    const layers = [
      layer({
        id: 'only-portrait',
        placement: { default: { x: 0, y: 0, w: 0, h: 0 }, '9:16': { x: 0, y: 0, w: 1, h: 1 } },
      }),
    ];
    expect(visibleLayers(layers, '16:9')).toHaveLength(0);
    expect(visibleLayers(layers, '9:16')).toHaveLength(1);
  });
});
