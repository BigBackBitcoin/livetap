import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { AspectRatio } from '@livetap/core';
import { isActiveState } from '@livetap/core';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { useAppStore } from '../state/store.js';
import { currentFormatRenderer } from '../state/engine.js';
import '../outputs.css';

/**
 * The per-format output strip: one small picture per shape the broadcast is actually producing.
 *
 * "One production, several correct pictures" is the product's headline claim, and until now the
 * only place it was visible was the marketing page. This shows the creator the real thing: each
 * `<video>` here is pointed at the SAME MediaStream the encoder for that format is publishing, so
 * what they see is what the destinations under it receive. It is not a re-render, a preview
 * variant, or a mock-up.
 *
 * It renders nothing at all when there is nothing true to show: a simulated engine has no
 * per-format canvases, and a preview that has not started has no streams. An empty strip is the
 * honest answer, not a row of placeholders.
 */
const ASPECT_CLASS: Record<AspectRatio, string> = {
  '16:9': 'lt-output--16x9',
  '9:16': 'lt-output--9x16',
  '1:1': 'lt-output--1x1',
};

const ASPECT_LABEL: Record<AspectRatio, string> = {
  '16:9': 'Wide',
  '9:16': 'Vertical',
  '1:1': 'Square',
};

export function OutputStrip(): ReactElement | null {
  const destinations = useAppStore((s) => s.destinations);
  const productionState = useAppStore((s) => s.production.state);
  const renderer = currentFormatRenderer();
  if (!renderer) return null;

  const aspects = renderer.aspects.filter((aspect) => renderer.streamFor(aspect) !== null);
  if (aspects.length === 0) return null;

  // A destination that is broadcasting belongs here even if its toggle was turned off since.
  const shown = destinations.filter((d) => d.config.enabled || isActiveState(d.state));

  return (
    <section className="lt-outputs" aria-label="What each destination is receiving">
      <ul className="lt-outputs__list">
        {aspects.map((aspect) => {
          const forAspect = shown.filter((d) => d.config.aspectRatio === aspect);
          return (
            <li key={aspect} className={['lt-output', ASPECT_CLASS[aspect]].join(' ')}>
              <OutputPicture aspect={aspect} live={productionState === 'LIVE'} />
              <p className="lt-output__caption">
                <span className="lt-output__shape">{ASPECT_LABEL[aspect]}</span>
                <span className="lt-output__who">{describeDestinations(forAspect)}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OutputPicture({ aspect, live }: { aspect: AspectRatio; live: boolean }): ReactElement {
  const video = useRef<HTMLVideoElement | null>(null);

  /*
   * Point at the engine's stream for this format, and leave it pointed there.
   *
   * Assigning `srcObject` is not free even when the value is unchanged: the element tears its
   * pipeline down and rebuilds it, which on these tiles showed as every output picture blinking
   * black at the moment the broadcast went live - the one moment a creator is watching them to
   * check that each shape looks right. The `live` dependency is what caused it, and it has to
   * stay, because going live is also when a format's capture can legitimately be rebuilt. So the
   * effect still runs; the assignment is what became conditional.
   */
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const stream = currentFormatRenderer()?.streamFor(aspect) ?? null;
    if (stream && el.srcObject !== stream) el.srcObject = stream;
    if (el.srcObject && el.paused) {
      const played = el.play?.();
      if (played && typeof played.catch === 'function') played.catch(() => undefined);
    }
  }, [aspect, live]);

  return <video ref={video} className="lt-output__video" muted playsInline autoPlay aria-hidden="true" />;
}

/** Who gets this shape, in the creator's own words: platform names, never aspect-ratio jargon. */
function describeDestinations(
  destinations: ReadonlyArray<{ config: { platform: keyof typeof PLATFORM_PROFILES; label: string } }>,
): string {
  if (destinations.length === 0) return 'No destination yet';
  const names = destinations.map((d) => d.config.label || PLATFORM_PROFILES[d.config.platform].displayName);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}
