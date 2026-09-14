import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@livetap/ui';
import { END_GRACE_MS, useAppStore } from '../state/store.js';
import { broadcastReality } from './preflight.js';
import { COPY } from '../lib/copy.js';
import { elapsed } from '../lib/format.js';

/**
 * The one way to stop a live broadcast, and the only one the product needs.
 *
 * The rule it exists to keep, from the owner's directive: there must always be one obvious way
 * to stop, and it must never be covered, clipped, inaccessible, unreachable in Pro, unreachable
 * in vertical mode, or unreachable on a phone. Before this bar, Studio was the only screen in the
 * entire application with any stop control at all, and on that screen it was measurably off the
 * bottom of the window between 640px and 1024.98px in 9:16 and 1:1 (box y=1741 in a 1112px
 * window at 834x1112), absent entirely during STARTING, and the lowest positioned layer in the
 * app's own stacking order, saved only by the boxes above it happening not to overlap it.
 *
 * So the stop control is not a feature of a screen. It is a feature of the shell: fixed to the
 * viewport, painted above every other layer in the product (`--lt-z-livebar`, beneath only the
 * skip link), with its own opaque surface so nothing can be clicked through it, rendered by
 * `AppShell` on every route, and mounted for exactly as long as the production is not idle.
 *
 * It is also the reason Studio's in-flow GO LIVE control disappears once a start begins: two
 * stop buttons on one screen is not "one obvious way to stop", and the pinned one is the one
 * that is on the screen at every width.
 */
export function LiveBar(): ReactElement | null {
  const production = useAppStore((s) => s.production);
  const destinations = useAppStore((s) => s.destinations);
  const adapterKind = useAppStore((s) => s.adapterKind);
  const engineHost = useAppStore((s) => s.engineHost);
  const goLive = useAppStore((s) => s.goLive);
  const endingAt = useAppStore((s) => s.endingAt);

  const requestEnd = useAppStore((s) => s.requestEnd);
  const undoEnd = useAppStore((s) => s.undoEnd);
  const cancelStart = useAppStore((s) => s.cancelStart);

  const onAir = production.state !== 'IDLE' && production.state !== 'PREVIEW';
  const elapsedMs = useElapsed(production.startedAt, onAir);
  const graceLeft = useGrace(endingAt);

  /*
   * The tab title is the one place a backgrounded live stream can still announce itself, and it
   * belongs here rather than in Studio: the stream survives a route change, so the title has to
   * as well. It used to be a Studio effect, whose cleanup reset the title to "LIVETAP" the moment
   * the user tapped Destinations, while the broadcast carried on.
   */
  useEffect(() => {
    if (!onAir) return undefined;
    document.title =
      production.state === 'LIVE' ? `● LIVE ${elapsed(elapsedMs)} — LIVETAP` : '● LIVETAP';
    return () => {
      document.title = 'LIVETAP';
    };
  }, [onAir, production.state, elapsedMs]);

  /*
   * Escape cancels a scheduled END from anywhere, for the same reason the bar is in the shell:
   * the gesture that takes back the most consequential action in the product cannot belong to
   * one screen. It never ends a live stream, only the ending of one.
   */
  useEffect(() => {
    if (endingAt === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') undoEnd();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [endingAt, undoEnd]);

  if (!onAir) return null;

  const reality = broadcastReality(destinations, adapterKind, engineHost);
  const ending = endingAt !== null;
  const starting = production.state === 'STARTING';
  const stopping = production.state === 'STOPPING' || goLive === 'stopping';

  const headline = ending
    ? 'Ending your broadcast'
    : starting
      ? 'Starting your broadcast'
      : stopping
        ? 'Ending your broadcast'
        : reality.allSimulated
          ? 'Live (demo)'
          : 'Live';

  const detail = ending
    ? 'Say your goodbyes.'
    : starting
      ? `Telling ${production.enabledCount === 1 ? 'your destination' : `your ${production.enabledCount} destinations`} you are live…`
      : stopping
        ? 'Telling your destinations the stream ended…'
        : reality.allSimulated
          ? `${elapsed(elapsedMs)} · nothing is broadcast anywhere`
          : `${elapsed(elapsedMs)} · live on ${production.liveCount} of ${production.enabledCount}`;

  return (
    <div
      className={['lt-livebar', reality.allSimulated ? 'lt-livebar--demo' : null]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label="Your live broadcast"
    >
      <p className="lt-livebar__status">
        <span className="lt-livebar__dot" aria-hidden="true" />
        <span className="lt-livebar__headline">{headline}</span>
        <span className="lt-livebar__detail lt-num">{detail}</span>
      </p>

      <div className="lt-livebar__action">
        {/*
          `data-lt-stop` names the control that can act on the broadcast right now, in whichever
          state the production is in. The audit asserts against it with `elementFromPoint` at
          every viewport, format and mode, so "the stop control is reachable" is a measurement
          rather than a claim - and one attribute means the measurement does not have to know
          which of the four states it is looking at.
        */}
        {ending ? (
          <Button variant="secondary" size="lg" data-lt-stop="undo" onClick={undoEnd}>
            {`${COPY.undo} · Ending in ${graceLeft}`}
          </Button>
        ) : starting ? (
          <Button
            variant="secondary"
            size="lg"
            data-lt-stop="cancel-start"
            onClick={() => void cancelStart()}
          >
            Cancel start
          </Button>
        ) : stopping ? (
          <p className="lt-livebar__ending" role="status">
            Ending…
          </p>
        ) : (
          <Button
            variant="danger"
            size="lg"
            className="lt-livebar__end"
            data-lt-stop="end"
            onClick={requestEnd}
            aria-label={`End broadcast. Live for ${elapsed(elapsedMs)}.`}
          >
            END
          </Button>
        )}
      </div>
    </div>
  );
}

/** Ticks once a second while on air. The value is never announced: a clock that speaks is unusable. */
function useElapsed(startedAt: number | undefined, onAir: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!onAir || startedAt === undefined) {
      setMs(0);
      return undefined;
    }
    const tick = (): void => setMs(Date.now() - startedAt);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [onAir, startedAt]);
  return ms;
}

/** 5 → 1, counting down the END grace the store is actually running. */
function useGrace(endingAt: number | null): number {
  const [left, setLeft] = useState(Math.round(END_GRACE_MS / 1000));
  useEffect(() => {
    if (endingAt === null) {
      setLeft(Math.round(END_GRACE_MS / 1000));
      return undefined;
    }
    const tick = (): void =>
      setLeft(Math.max(1, Math.ceil((END_GRACE_MS - (Date.now() - endingAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [endingAt]);
  return left;
}
