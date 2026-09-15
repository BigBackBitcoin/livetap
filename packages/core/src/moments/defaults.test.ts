/**
 * What the shipped Moments must never do to a broadcast.
 *
 * The bug this file exists for: every camera layer in `defaults.ts` carried `mirror: true`, and
 * the compositor applies `mirror` to the canvas that gets encoded and sent. So every LIVETAP
 * broadcast went out horizontally flipped — a t-shirt, a book, a whiteboard, a product label all
 * reached the audience backwards. It survived every test and every proof run because the only
 * camera on any of these machines is Chromium's green pac-man test pattern, in which a horizontal
 * flip is invisible unless you happen to read the frame counter in the corner. It was found by
 * pulling a frame out of a real recording and looking at it.
 *
 * Mirroring is something a SELF-VIEW wants. It is never something an audience wants.
 */
import { describe, expect, it } from 'vitest';

import { defaultMoments } from './defaults.js';
import { CONTENT_TYPES, INTENT_PROFILES, layoutMomentsForIntent } from '../production/intents.js';

const cameraLayers = () =>
  defaultMoments().flatMap((moment) =>
    moment.layers.filter((layer) => layer.kind === 'camera').map((layer) => ({ moment: moment.name, layer })),
  );

describe('the shipped Moments', () => {
  it('has camera layers to check', () => {
    expect(cameraLayers().length).toBeGreaterThan(0);
  });

  it('never mirrors a camera, because the composition is what the audience sees', () => {
    for (const { moment, layer } of cameraLayers()) {
      expect(layer.mirror ?? false, `${moment} mirrors its camera into the broadcast`).toBe(false);
    }
  });

  it('says which lens it means, rather than leaving a phone to infer it from a flip', () => {
    for (const { moment, layer } of cameraLayers()) {
      expect(layer.kind === 'camera' ? layer.facing : undefined, `${moment} does not say which way its camera faces`).toBe(
        'user',
      );
    }
  });

  it('does not let any intent turn mirroring back on', () => {
    for (const type of CONTENT_TYPES) {
      const moments = layoutMomentsForIntent(INTENT_PROFILES[type]);
      const cameras = moments.flatMap((m) => m.layers.filter((l) => l.kind === 'camera'));
      expect(cameras.length, `intent ${type} produced no camera layer to check`).toBeGreaterThan(0);
      for (const layer of cameras) {
        expect(layer.mirror ?? false, `intent ${type} mirrors the camera into the broadcast`).toBe(false);
      }
    }
  });
});
