import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@livetap/ui';
import type { AspectRatio, Moment } from '@livetap/core';
import { useAppStore } from '../state/store.js';
import { outputStreamFor } from '../state/engine.js';

/**
 * The shape is one of three known values, so it is a class rather than an inline style. That
 * matters beyond tidiness: the inline `style` attribute here was the last one in `apps/web`,
 * and it is the reason the deployed CSP still allowed `style-src 'unsafe-inline'`
 * (SECURITY_REVIEW SEC-W4), which also permits an injected `<style>` element.
 */
const RATIO_CLASS: Record<AspectRatio, string> = {
  '16:9': 'lt-preview--16x9',
  '9:16': 'lt-preview--9x16',
  '1:1': 'lt-preview--1x1',
};

/**
 * The program preview.
 *
 * It is not a bare `<video>`: it is a labelled region whose accessible description says what
 * viewers can see in words, generated from the active Moment's layers, so a blind creator can
 * confirm the composition (PRODUCT_SPEC §5c). When the engine has no camera it shows the
 * engine's own test pattern rather than a black rectangle (tenet 6).
 */
export function PreviewCanvas({
  aspect,
  live,
  muted,
}: {
  aspect: AspectRatio;
  live: boolean;
  muted: boolean;
}): ReactElement {
  const video = useRef<HTMLVideoElement | null>(null);
  const attach = useAppStore((s) => s.attachPreview);
  /*
   * The ACTIVE Moment, not the whole list.
   *
   * Subscribing to `s.moments` re-rendered the program preview every time any Moment anywhere
   * changed identity - a rename in the editor, a layer toggled on a Moment that is not on screen,
   * a reordering. Selecting the one Moment this component describes means zustand compares that
   * object instead of the array, and the preview re-renders when the picture it is describing
   * actually changed.
   */
  const active = useAppStore((s) => s.moments.find((m) => m.id === s.production.activeMomentId) ?? s.moments[0]);
  const productionState = useAppStore((s) => s.production.state);

  /*
   * Attach the engine's output for this aspect, and attach it ONCE.
   *
   * This used to re-run on every Moment change, and re-running means `srcObject = stream` and
   * `play()` on an element that was already playing that exact stream. A <video> handed a
   * srcObject tears down its pipeline and rebuilds it, so switching Moment - the single most
   * common thing a creator does while live - made the program preview stutter for no reason at
   * all. Changing Moment does not change which stream the preview should be showing; only the
   * aspect ratio and the engine's own lifecycle do.
   *
   * The comparison is against the engine's real output stream for this aspect, so the guard can
   * never leave the element showing a stale picture: if the engine rebuilt its capture (a quality
   * change, a restart), the identity differs and it is re-attached. Keeping the broad trigger list
   * and making the attach itself idempotent is deliberate - a preview that misses an attach is
   * black, which is worse than one that checks twice.
   */
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const wanted = outputStreamFor(aspect);
    if (wanted && el.srcObject === wanted) return;
    attach(el);
  }, [attach, aspect, live, productionState, active?.id]);

  return (
    <div
      className={['lt-preview', RATIO_CLASS[aspect], live ? 'is-live' : '']
        .filter(Boolean)
        .join(' ')}
      tabIndex={0}
      role="group"
      aria-label={`Program preview, ${active?.name ?? 'no Moment'}`}
      aria-describedby="lt-preview-desc"
    >
      <video ref={video} className="lt-preview__video" muted playsInline autoPlay />
      <div className="lt-preview__badges">
        {live ? <Badge tone="danger">Live</Badge> : null}
        {muted ? <Badge tone="warning">Muted</Badge> : null}
      </div>
      <p className="lt-sr-only" id="lt-preview-desc">
        {describe(active)}
      </p>
    </div>
  );
}

/** The composition in a sentence a person can act on. */
export function describe(moment: Moment | undefined): string {
  if (!moment) return 'Nothing is visible yet.';
  const visible = moment.layers.filter((l) => l.visible);
  if (visible.length === 0) return `${moment.name}: nothing is visible in this Moment.`;
  const parts = visible.map((layer) => {
    switch (layer.kind) {
      case 'camera':
        return area(layer.placement.default) === 'full' ? 'your camera, full frame' : 'your camera inset';
      case 'screen':
      case 'window':
        return 'your screen';
      case 'text':
        return `the words "${layer.text}"`;
      case 'color':
        return 'a plain background';
      case 'image':
        return 'a picture';
      case 'video':
        return 'a video clip';
      case 'browser':
        return 'a web page';
      default:
        return 'an overlay';
    }
  });
  return `${moment.name}: ${parts.join(', with ')}.`;
}

function area(rect: { w: number; h: number }): 'full' | 'inset' {
  return rect.w > 0.9 && rect.h > 0.9 ? 'full' : 'inset';
}
