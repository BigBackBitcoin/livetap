import type { ReactElement } from 'react';
import type { DestinationState } from '@livetap/core';
import { STATE_LABEL, PULSING_STATES } from '../tokens.js';
import { AlertIcon } from './Icons.js';

/** How the state's dot is drawn. Shape carries state as well as colour. */
export type DotTreatment = 'solid' | 'pulse' | 'ring' | 'glyph';

const DOT: Record<DestinationState, DotTreatment> = {
  DISCONNECTED: 'ring',
  AUTHENTICATING: 'solid',
  READY: 'solid',
  STARTING: 'solid',
  LIVE: 'pulse',
  DEGRADED: 'solid',
  RECONNECTING: 'pulse',
  FAILED: 'glyph',
  STOPPING: 'solid',
  ENDED: 'solid',
};

export interface StatusChipProps {
  state: DestinationState;
  /**
   * The word shown to the user. Defaults to the system label for the state.
   * **Always rendered** — colour is never the only carrier of state.
   */
  label?: string;
  /** Tiny secondary line, e.g. "YouTube · 4,200 kbps" or "Attempt 2 of 8". */
  status?: string;
  /**
   * Secondary line for a live detail that changes every second, e.g. core's
   * `describeReconnect()` output: "Trying again in 4 s (attempt 2 of 10)". Wins over
   * `status`, is clipped with an ellipsis rather than wrapping, and is repeated in a
   * `title` so the full sentence is reachable when it does not fit.
   */
  detail?: string;
  /** Announce state changes politely (use on the Studio chip row). */
  live?: boolean;
  className?: string;
}

/**
 * The destination-state chip: a coloured dot, a word, and optionally one line of
 * detail. Colours and dot treatments per state come from DESIGN_SYSTEM.md §2.4.
 *
 * `LIVE` is the only solid-filled chip in the system, so a glance anywhere in the
 * app answers "am I live?" without reading. `FAILED` shares the red family but can
 * never be confused with it: muted tint, static alert glyph, and its own word.
 */
export function StatusChip({
  state,
  label,
  status,
  detail,
  live = false,
  className,
}: StatusChipProps): ReactElement {
  const text = label ?? STATE_LABEL[state];
  const secondary = detail ?? status;
  const treatment = DOT[state];
  const classes = [
    'lt-chip',
    `lt-chip--${state.toLowerCase()}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const dotClasses = [
    'lt-dot',
    treatment === 'pulse' ? 'lt-dot--pulse' : null,
    treatment === 'ring' ? 'lt-dot--ring' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      data-state={state}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
    >
      {/* The chip's label is 12px, so the glyph beside it is the 16px step, not the 24 default. */}
      {treatment === 'glyph' ? (
        <AlertIcon size={16} />
      ) : (
        <span className={dotClasses} aria-hidden="true" />
      )}
      <span className="lt-chip__text">
        <span className="lt-chip__label">{text}</span>
        {secondary ? (
          <span className="lt-chip__status" title={secondary}>
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Exported so the app can assert the invariant rather than re-deriving it. */
export function isPulsingState(state: DestinationState): boolean {
  return PULSING_STATES.includes(state);
}
