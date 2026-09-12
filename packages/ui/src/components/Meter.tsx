import type { ReactElement } from 'react';

export interface MeterProps {
  /** Current level, 0..1. */
  value: number;
  /** Accessible name, e.g. "Microphone level". */
  label: string;
  /** Peak-hold marker, 0..1. Omit to hide it. */
  peak?: number;
  /** Show the numeric value beside the bar. */
  showValue?: boolean;
  /**
   * True when the source should be producing sound but the level has been flat.
   * Turns the readout amber and appends "No signal" — a flat meter must never be
   * the only sign that a mic is dead.
   */
  silent?: boolean;
  className?: string;
}

const HOT = 0.8;
const CLIPPING = 0.97;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/**
 * An audio level bar.
 *
 * `role="meter"` with real `aria-valuenow`, so the level is readable without
 * sight. Colour shifts amber above 80% and red above 97%, but loudness is also
 * carried by the bar's length and by the numeric readout.
 */
export function Meter({
  value,
  label,
  peak,
  showValue = true,
  silent = false,
  className,
}: MeterProps): ReactElement {
  const level = clamp01(value);
  const pct = Math.round(level * 100);
  const classes = [
    'lt-meter',
    level >= CLIPPING ? 'lt-meter--clipping' : level >= HOT ? 'lt-meter--hot' : null,
    silent ? 'lt-meter--silent' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <div
        className="lt-meter__track"
        role="meter"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={silent ? 'No signal' : `${pct} percent`}
      >
        <div className="lt-meter__fill" style={{ inlineSize: `${pct}%` }} />
        {typeof peak === 'number' ? (
          <div
            className="lt-meter__peak"
            style={{ insetInlineStart: `${Math.round(clamp01(peak) * 100)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      {showValue ? (
        <span className="lt-meter__value lt-num">{silent ? 'No signal' : `${pct}%`}</span>
      ) : null}
    </div>
  );
}
