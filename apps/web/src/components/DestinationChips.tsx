import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Badge, StatusChip } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import type { DestinationSnapshot, DestinationState } from '@livetap/core';
import { COPY } from '../lib/copy.js';
import { megabits, viewers } from '../lib/format.js';
import { useAppStore } from '../state/store.js';

/**
 * The destination chip row (PRODUCT_SPEC §4.2).
 *
 * Two rules this component exists to keep: colour is never the only signal (the label and the
 * status sentence always render), and **chips never reorder** — not by state, not by health,
 * least of all while live, so a destination that fails stays where muscle memory left it.
 */
export function DestinationChips(): ReactElement {
  const destinations = useAppStore((s) => s.destinations);
  const enabled = destinations.filter((d) => d.config.enabled);

  if (enabled.length === 0) {
    return (
      <div className="lt-chiprow lt-chiprow--empty">
        <p>No destinations yet — LIVETAP needs one place to send your stream.</p>
        <Link className="lt-textlink" to="/app/destinations">
          {COPY.addDestination}
        </Link>
      </div>
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
              status={statusText(snap)}
            />
            {snap.config.mock ? <Badge tone="info">{COPY.demo}</Badge> : null}
          </span>
        </li>
      ))}
    </ul>
  );
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
export function statusText(snap: DestinationSnapshot): string {
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
    case 'RECONNECTING':
      return `Attempt ${snap.reconnectAttempt} — LIVETAP is reconnecting this one`;
    case 'FAILED':
      return snap.error?.what ?? 'This destination is not in the stream';
    case 'STOPPING':
      return `Telling ${platform} the stream ended…`;
    case 'ENDED':
      return 'Ended';
  }
}
