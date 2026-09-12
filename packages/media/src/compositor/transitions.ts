/**
 * Pure transition math. The compositor is driven by `tick(nowMs)` so transitions are
 * fully deterministic and testable with fake time (no requestAnimationFrame involved).
 */
import type { TransitionKind } from '@livetap/core';

/** Where one of the two Moments sits during a transition. */
export interface TransitionTransform {
  /** Multiplied into the layer opacity. */
  alpha: number;
  /** Canvas-space translation in device pixels. */
  translateX: number;
  translateY: number;
  /** Uniform scale about the canvas centre. */
  scale: number;
}

export interface TransitionFrame {
  /** 0..1, eased-independent linear progress. */
  progress: number;
  /** Eased progress actually applied to the transforms. */
  eased: number;
  /** Transform for the outgoing Moment, or null when it must not be drawn at all. */
  from: TransitionTransform | null;
  /** Transform for the incoming Moment. */
  to: TransitionTransform;
  /** True once the transition has fully completed. */
  done: boolean;
}

export const IDENTITY_TRANSFORM: TransitionTransform = { alpha: 1, translateX: 0, translateY: 0, scale: 1 };

/** Zoom depth: the outgoing Moment pushes out to 1.12x while the incoming comes in from 0.88x. */
const ZOOM_DEPTH = 0.12;

/**
 * Linear progress of a transition, clamped to 0..1.
 * A non-positive duration (or a `cut`) is complete immediately.
 */
export function transitionProgress(nowMs: number, startedAtMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  if (!Number.isFinite(nowMs) || !Number.isFinite(startedAtMs)) return 1;
  const elapsed = nowMs - startedAtMs;
  if (elapsed <= 0) return 0;
  if (elapsed >= durationMs) return 1;
  return elapsed / durationMs;
}

/** Symmetric ease used by every non-cut transition. */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * Resolve both Moments' transforms for a transition at `progress`.
 * `width`/`height` are the output size in device pixels (used by `slide`).
 */
export function computeTransitionFrame(
  kind: TransitionKind,
  progress: number,
  width: number,
  _height: number,
): TransitionFrame {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  const done = p >= 1;
  if (kind === 'cut' || done) {
    return { progress: p, eased: p, from: null, to: { ...IDENTITY_TRANSFORM }, done: true };
  }
  const e = easeInOutCubic(p);
  switch (kind) {
    case 'fade':
      return {
        progress: p,
        eased: e,
        from: { alpha: 1 - e, translateX: 0, translateY: 0, scale: 1 },
        to: { alpha: e, translateX: 0, translateY: 0, scale: 1 },
        done: false,
      };
    case 'slide':
      return {
        progress: p,
        eased: e,
        from: { alpha: 1, translateX: -e * width || 0, translateY: 0, scale: 1 },
        to: { alpha: 1, translateX: (1 - e) * width, translateY: 0, scale: 1 },
        done: false,
      };
    case 'zoom':
      return {
        progress: p,
        eased: e,
        from: { alpha: 1 - e, translateX: 0, translateY: 0, scale: 1 + ZOOM_DEPTH * e },
        to: { alpha: e, translateX: 0, translateY: 0, scale: 1 - ZOOM_DEPTH * (1 - e) },
        done: false,
      };
    default:
      // Unknown kinds behave as a cut rather than freezing the program output.
      return { progress: 1, eased: 1, from: null, to: { ...IDENTITY_TRANSFORM }, done: true };
  }
}
