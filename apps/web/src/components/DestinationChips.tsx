import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Badge, Button, StatusChip } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { describeReconnect } from '@livetap/core';
import type { DestinationSnapshot, DestinationState } from '@livetap/core';
import { COPY } from '../lib/copy.js';
import { megabits, viewers } from '../lib/format.js';
import { useAppStore } from '../state/store.js';
import { DestinationErrorCard } from './NoticeCards.js';

/**
 * The one destination list in Studio (PRODUCT_SPEC §4.2, §5c).
 *
 * It used to be two: a compact chip row under the preview and a second, separately built list
 * of the same chips inside the dock's Destinations tab, 200px apart on the same screen
 * (PRODUCT_REVIEW P2-4). There is now exactly one list, rendered by this component, and it
 * lives in the dock's Destinations tab — which is also where §4.1 requires a destination's
 * ErrorCard to appear, so a failing destination's state and its explanation are in one place
 * instead of two. Dropping the row also lifts GO LIVE by the height of a chip row at every
 * breakpoint, which §5c's first requirement asks for.
 *
 * Two rules this component exists to keep: colour is never the only signal (the label and the
 * status sentence always render), and **chips never reorder** — not by state, not by health,
 * least of all while live, so a destination that fails stays where muscle memory left it.
 */
export function DestinationList(): ReactElement {
  const destinations = useAppStore((s) => s.destinations);
  const live = useAppStore((s) => s.production.state === 'LIVE' || s.production.state === 'STOPPING');
  const stopOne = useAppStore((s) => s.stopOne);
  const retry = useAppStore((s) => s.retry);
  const enabled = destinations.filter((d) => d.config.enabled);

  /*
   * A reconnect status line counts down ("Trying again in 4 s"), so the row has to tick while
   * one is running. It ticks only then: a list that re-renders every second for no reason is a
   * list that keeps waking a laptop up.
   */
  const reconnecting = enabled.some((d) => d.state === 'RECONNECTING');
  const now = useSecondTick(reconnecting);

  if (enabled.length === 0) {
    return (
      <p className="lt-dock__none">
        No destinations are switched on, so there is nowhere for this stream to go.
      </p>
    );
  }

  return (
    <ul className="lt-chiprow" aria-label="Where this stream is going">
      {enabled.map((snap) => (
        <li key={snap.config.id}>
          <span className="lt-chipwrap">
            <StatusChip
              state={snap.state}
              label={`${PLATFORM_PROFILES[snap.config.platform].displayName} · ${chipLabel(snap.state)}`}
              status={statusText(snap, now)}
            />
            {snap.config.mock ? <Badge tone="info">{COPY.demo}</Badge> : null}
          </span>

          <DestinationErrorCard snapshot={snap} />

          <div className="lt-dock__destactions">
            {snap.state === 'FAILED' ? (
              <Button variant="secondary" size="sm" onClick={() => void retry(snap.config.id)}>
                {COPY.retry}
              </Button>
            ) : null}
            {live && (snap.state === 'LIVE' || snap.state === 'DEGRADED') ? (
              <Button variant="ghost" size="sm" onClick={() => void stopOne(snap.config.id)}>
                Stop this destination
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * First run has no list to show, so it shows the one thing that has to happen instead. This
 * stays beside GO LIVE rather than in the dock: with zero destinations there is no list to
 * duplicate, and the call to action has to be on the fold (PRODUCT_SPEC §4.3, §5c first run).
 */
export function NoDestinationsPrompt(): ReactElement | null {
  const destinations = useAppStore((s) => s.destinations);
  if (destinations.some((d) => d.config.enabled)) return null;
  return (
    <div className="lt-chiprow lt-chiprow--empty">
      <p>No destinations yet — LIVETAP needs one place to send your stream.</p>
      <Link className="lt-textlink" to="/app/destinations">
        {COPY.addDestination}
      </Link>
    </div>
  );
}

/** Re-renders once a second while `active`, so a countdown in words stays true. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function chipLabel(state: DestinationState): string {
  switch (state) {
    case 'DISCONNECTED':
      return 'Not connected';
    case 'AUTHENTICATING':
      return 'Signing in';
    case 'READY':
      return 'Ready';
    case 'STARTING':
      return 'Starting';
    case 'LIVE':
      return 'Live';
    case 'DEGRADED':
      return 'Live, rough';
    case 'RECONNECTING':
      return 'Reconnecting';
    case 'FAILED':
      return 'Failed';
    case 'STOPPING':
      return 'Stopping';
    case 'ENDED':
      return 'Ended';
  }
}

/** The second line: a consequence in words, never a bare metric. */
export function statusText(snap: DestinationSnapshot, now?: number): string {
  const platform = PLATFORM_PROFILES[snap.config.platform].displayName;
  switch (snap.state) {
    case 'DISCONNECTED':
      return COPY.notConnectedSubtitle;
    case 'AUTHENTICATING':
      return `Waiting for ${platform}…`;
    case 'READY':
      return COPY.readySubtitle;
    case 'STARTING':
      return `Telling ${platform} you're live…`;
    case 'LIVE': {
      const parts: string[] = [];
      if (snap.health?.bitrateKbps) parts.push(megabits(snap.health.bitrateKbps));
      if (snap.health?.viewers !== undefined) parts.push(`${viewers(snap.health.viewers)} watching`);
      return parts.length > 0 ? parts.join(' · ') : 'Sending to this destination';
    }
    case 'DEGRADED':
      return 'Frames are being skipped here';
    case 'RECONNECTING': {
      /*
       * PRODUCT_SPEC §4.2 asks for the attempt, the maximum and the retry countdown. Core owns
       * that sentence (`describeReconnect`) so the desktop shell and the web app cannot word the
       * same fact two different ways.
       */
      const { line } = describeReconnect(snap, now ?? Date.now());
      return line === '' ? `Attempt ${snap.reconnectAttempt} — LIVETAP is reconnecting this one` : line;
    }
    case 'FAILED':
      return snap.error?.what ?? 'This destination is not in the stream';
    case 'STOPPING':
      return `Telling ${platform} the stream ended…`;
    case 'ENDED':
      return 'Ended';
  }
}
