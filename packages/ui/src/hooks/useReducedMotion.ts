import { mediaQuery } from '../tokens.js';
import { useMediaQuery } from './useMediaQuery.js';

/**
 * True when the user has asked for less motion.
 *
 * CSS already handles the common cases (see global.css). Use this hook only where
 * JavaScript must behave differently — skipping a scroll animation, or not
 * starting a decorative timer at all.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery(mediaQuery.reducedMotion);
}
