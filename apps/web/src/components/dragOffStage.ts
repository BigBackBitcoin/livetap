/**
 * Drag a destination off the stage to drop it — the signature move, wired to the real thing.
 *
 * The public page has this gesture and it is the moment people remember: you pull a live
 * destination away, the connection line stretches, it lets go, and the others keep going. In the
 * app the same gesture has to stop an actual broadcast to an actual platform, which changes none
 * of the feel and all of the stakes.
 *
 * WHY THIS IS A HOOK AND NOT A LIBRARY. The public page uses anime.js's draggable, which is right
 * there because that page is already a choreography. The app's bundle is not, and a drag that ends
 * a live broadcast is exactly the interaction whose every rule should be readable in one file
 * rather than configured through someone else's abstraction.
 *
 * THE RULES IT ENCODES, each of which is a bug this product has already had:
 *
 *   ONE REGION, ONE OWNER. Only the grip starts a drag. The row it lives in carries buttons that
 *   stop, retry and remove, and a row-wide drag handler would mean a press that begins on a button
 *   and moves four pixels does something other than what the button says.
 *
 *   A TAP IS NOT A DRAG. Nothing happens until the pointer has travelled past a threshold, so the
 *   gesture cannot fire by accident on a touchscreen where every tap moves a little.
 *
 *   POINTER CAPTURE, ALWAYS. Without it a fast drag leaves the element, the element stops getting
 *   move events, and the row is left mid-gesture holding a transform nobody will clear.
 *
 *   THE KEYBOARD CAN DO IT TOO, and so can a button. A gesture is the memorable way to do this,
 *   never the only way: `onDrop` is also reachable by Delete on the focused grip, and the caller
 *   renders a visible control beside it. Somebody ending a broadcast in a hurry must not have to
 *   discover anything.
 *
 *   REDUCED MOTION KEEPS THE ACTION AND LOSES THE FLING. Pulling something across a screen is the
 *   part a vestibular disorder objects to. The keyboard path and the button are untouched.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

/** How far the pointer must travel for the destination to come off. Scaled down on small screens. */
export function dropDistance(viewportWidth: number): number {
  const full = 168;
  return Math.round(full * Math.min(1, Math.max(0.42, viewportWidth / 1440)));
}

export interface DragOffStageOptions {
  /** False whenever this destination is not in a state where dropping it means anything. */
  armed: boolean;
  /** The real action: stop this one destination. Called exactly once per completed gesture. */
  onDrop: () => void;
  /** True when the OS asks for reduced motion. Disables the drag; keyboard and button remain. */
  reducedMotion?: boolean;
  /** Injected in tests. */
  viewportWidth?: number;
}

export interface DragOffStage {
  /** Spread onto the grip element, and onto nothing else. */
  gripProps: {
    onPointerDown: (event: ReactPointerEvent) => void;
    onKeyDown: (event: ReactKeyboardEvent) => void;
    style: CSSProperties;
  };
  /** Spread onto the row so it can move and so CSS can read how far it has come. */
  rowProps: { style: CSSProperties; 'data-lt-dragging'?: '' };
  /** 0 to 1. At 1 the destination comes off. Exposed so the connection line can stretch. */
  tension: number;
  dragging: boolean;
}

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  target: Element;
  fired: boolean;
}

export function useDragOffStage(options: DragOffStageOptions): DragOffStage {
  const { armed, onDrop, reducedMotion = false } = options;
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [tension, setTension] = useState(0);
  const gesture = useRef<Gesture | null>(null);

  /*
   * `onDrop` is almost always an inline arrow from the caller, so a new identity every render.
   * Holding it in a ref means the pointer listeners below are bound once per gesture rather than
   * re-bound on every parent render - which, mid-drag, would drop the gesture on the floor.
   */
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const reset = useCallback(() => {
    gesture.current = null;
    setOffset(null);
    setTension(0);
  }, []);

  // Disarming mid-gesture (the production ended, the destination failed) has to leave no residue.
  useEffect(() => {
    if (!armed) reset();
  }, [armed, reset]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (!armed || reducedMotion) return;
      // Primary button only. A right-click opening a context menu must not begin a drag that then
      // has no pointerup to end it.
      if (event.button !== 0) return;
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is unavailable in some test environments; the gesture still works without it. */
      }
      gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, target, fired: false };
      setOffset({ x: 0, y: 0 });
    },
    [armed, reducedMotion],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId || g.fired) return;
      const x = event.clientX - g.startX;
      const y = event.clientY - g.startY;
      const width = options.viewportWidth ?? (typeof window === 'undefined' ? 1440 : window.innerWidth);
      const t = Math.min(1, Math.hypot(x, y) / dropDistance(width));
      setOffset({ x, y });
      setTension(t);
      if (t >= 1) {
        // Fire once, then let go of the pointer immediately: the row is about to change state and
        // a gesture still running over it would be aimed at something that no longer exists.
        g.fired = true;
        try {
          g.target.releasePointerCapture(g.pointerId);
        } catch {
          /* Already released. */
        }
        drop.current();
        reset();
      }
    },
    [options.viewportWidth, reset],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;
      // Short of the threshold: it held on. Nothing happened, and the row goes back.
      reset();
    },
    [reset],
  );

  useEffect(() => {
    if (!offset) return undefined;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [offset, onPointerMove, onPointerUp]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!armed) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        drop.current();
        return;
      }
      if (event.key === 'Escape') reset();
    },
    [armed, reset],
  );

  const dragging = offset !== null;

  return {
    gripProps: {
      onPointerDown,
      onKeyDown,
      // Without this a drag on a touchscreen scrolls the page instead, and on desktop it starts
      // the browser's own native drag of the element.
      style: { touchAction: armed && !reducedMotion ? 'none' : undefined, cursor: armed && !reducedMotion ? 'grab' : undefined },
    },
    rowProps: {
      style: {
        ...(offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}),
        ...({ '--lt-tension': tension.toFixed(3) } as CSSProperties),
      },
      ...(dragging ? { 'data-lt-dragging': '' as const } : {}),
    },
    tension,
    dragging,
  };
}
