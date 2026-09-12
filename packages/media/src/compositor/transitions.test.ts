import { describe, expect, it } from 'vitest';
import type { TransitionKind } from '@livetap/core';
import { computeTransitionFrame, easeInOutCubic, transitionProgress } from './transitions.js';

describe('transitionProgress', () => {
  it('is 0 at the start and 1 at the end', () => {
    expect(transitionProgress(1000, 1000, 400)).toBe(0);
    expect(transitionProgress(1400, 1000, 400)).toBe(1);
  });

  it('is linear in between', () => {
    expect(transitionProgress(1100, 1000, 400)).toBeCloseTo(0.25, 6);
    expect(transitionProgress(1200, 1000, 400)).toBeCloseTo(0.5, 6);
    expect(transitionProgress(1300, 1000, 400)).toBeCloseTo(0.75, 6);
  });

  it('clamps outside the window', () => {
    expect(transitionProgress(500, 1000, 400)).toBe(0);
    expect(transitionProgress(99999, 1000, 400)).toBe(1);
  });

  it('completes immediately for a zero or invalid duration', () => {
    expect(transitionProgress(1000, 1000, 0)).toBe(1);
    expect(transitionProgress(1000, 1000, -100)).toBe(1);
    expect(transitionProgress(1000, 1000, Number.NaN)).toBe(1);
    expect(transitionProgress(Number.NaN, 1000, 400)).toBe(1);
  });
});

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });

  it('is monotonically increasing', () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeInOutCubic(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps out-of-range input', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('computeTransitionFrame', () => {
  const W = 1920;
  const H = 1080;

  it('cut never draws the outgoing Moment', () => {
    const frame = computeTransitionFrame('cut', 0.5, W, H);
    expect(frame.from).toBeNull();
    expect(frame.done).toBe(true);
    expect(frame.to).toEqual({ alpha: 1, translateX: 0, translateY: 0, scale: 1 });
  });

  it('fade cross-fades with complementary alphas', () => {
    const frame = computeTransitionFrame('fade', 0.5, W, H);
    expect(frame.from?.alpha).toBeCloseTo(0.5, 6);
    expect(frame.to.alpha).toBeCloseTo(0.5, 6);
    expect((frame.from?.alpha ?? 0) + frame.to.alpha).toBeCloseTo(1, 6);
    expect(frame.done).toBe(false);
  });

  it('fade starts with the outgoing Moment fully visible', () => {
    const frame = computeTransitionFrame('fade', 0, W, H);
    expect(frame.from?.alpha).toBe(1);
    expect(frame.to.alpha).toBe(0);
  });

  it('slide moves the incoming Moment in from the right', () => {
    const start = computeTransitionFrame('slide', 0, W, H);
    expect(start.to.translateX).toBe(W);
    expect(start.from?.translateX).toBe(0);

    const mid = computeTransitionFrame('slide', 0.5, W, H);
    expect(mid.to.translateX).toBeCloseTo(W / 2, 6);
    expect(mid.from?.translateX).toBeCloseTo(-W / 2, 6);
    // Both stay fully opaque: slide is a positional transition.
    expect(mid.to.alpha).toBe(1);
    expect(mid.from?.alpha).toBe(1);
  });

  it('zoom pushes the outgoing Moment out and pulls the incoming one in', () => {
    const mid = computeTransitionFrame('zoom', 0.5, W, H);
    expect(mid.from?.scale).toBeGreaterThan(1);
    expect(mid.to.scale).toBeLessThan(1);
    expect(mid.to.scale).toBeGreaterThan(0.8);
    expect(mid.from?.alpha).toBeCloseTo(1 - mid.to.alpha, 6);
  });

  it('every kind lands exactly on identity when complete', () => {
    for (const kind of ['cut', 'fade', 'slide', 'zoom'] as TransitionKind[]) {
      const frame = computeTransitionFrame(kind, 1, W, H);
      expect(frame.done).toBe(true);
      expect(frame.from).toBeNull();
      expect(frame.to).toEqual({ alpha: 1, translateX: 0, translateY: 0, scale: 1 });
    }
  });

  it('clamps and sanitises progress', () => {
    expect(computeTransitionFrame('fade', -1, W, H).from?.alpha).toBe(1);
    expect(computeTransitionFrame('fade', 5, W, H).done).toBe(true);
    expect(computeTransitionFrame('fade', Number.NaN, W, H).done).toBe(true);
  });

  it('treats an unknown transition kind as a cut instead of freezing', () => {
    const frame = computeTransitionFrame('spin' as TransitionKind, 0.5, W, H);
    expect(frame.done).toBe(true);
    expect(frame.from).toBeNull();
  });

  it('reports eased progress alongside linear progress', () => {
    const frame = computeTransitionFrame('fade', 0.25, W, H);
    expect(frame.progress).toBeCloseTo(0.25, 6);
    expect(frame.eased).toBeCloseTo(easeInOutCubic(0.25), 6);
    expect(frame.eased).not.toBeCloseTo(frame.progress, 3);
  });
});
