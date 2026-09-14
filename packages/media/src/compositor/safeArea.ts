/**
 * Safe areas, in pixels.
 *
 * The normalized insets themselves live in `@livetap/core` (`SAFE_AREAS` in production/intents.ts)
 * because they are product knowledge: how much of a 9:16 frame TikTok's caption, follow button and
 * home indicator cover, and how much of a 1:1 frame a feed player crops. This module is the only
 * thing the compositor needs on top of that - the same rectangle in device pixels for the canvas
 * being drawn - so nothing has to re-derive it and no second copy of the numbers can drift.
 */
import type { AspectRatio } from '@livetap/core';
import { SAFE_AREAS } from '@livetap/core';
import type { PixelRect } from './placement.js';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The normalized insets for one aspect ratio, as fractions of width and height. */
export function safeAreaInsets(aspect: AspectRatio): SafeAreaInsets {
  const insets = SAFE_AREAS[aspect];
  return { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left };
}

/**
 * The rectangle of a `width` x `height` canvas that every platform for this aspect ratio leaves
 * visible. Anything a viewer must read - a name, a score, a call to action - belongs inside it.
 */
export function safeAreaRect(aspect: AspectRatio, width: number, height: number): PixelRect {
  const insets = safeAreaInsets(aspect);
  const x = insets.left * width;
  const y = insets.top * height;
  return {
    x,
    y,
    w: Math.max(0, width - x - insets.right * width),
    h: Math.max(0, height - y - insets.bottom * height),
  };
}
