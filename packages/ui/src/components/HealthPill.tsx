import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { HealthLevel } from '@livetap/core';
import { HEALTH_HEADLINE } from '../tokens.js';
import { ChevronIcon } from './Icons.js';

export interface HealthPillProps {
  level: HealthLevel;
  /** One word. Defaults to the system word for the level. */
  headline?: string;
  /** Beginner-facing sentence, revealed when expanded. */
  detail?: string;
  /** Pro-facing metric lines, revealed when expanded and Pro density is on. */
  reasons?: readonly string[];
  /** Start expanded (Pro remembers per-section disclosure state). */
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Stream health as one word plus a colour, expandable to the detail behind it.
 *
 * Beginners see "Good". Pro sees "Good" plus the metrics that produced it. The
 * word is always present, so the colour is never doing the work alone, and the
 * headline lives in a polite live region so a level change is announced without
 * interrupting.
 */
export function HealthPill({
  level,
  headline,
  detail,
  reasons,
  defaultExpanded = false,
  className,
}: HealthPillProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  const word = headline ?? HEALTH_HEADLINE[level];
  const expandable = Boolean(detail || (reasons && reasons.length > 0));

  const pill = (
    <span className={['lt-pill', `lt-pill--${level}`].join(' ')} data-level={level}>
      <span className="lt-dot" aria-hidden="true" />
      <span aria-live="polite" aria-atomic="true">
        {word}
      </span>
      {expandable ? <ChevronIcon size={20} className="lt-pill__chevron" /> : null}
    </span>
  );

  if (!expandable) {
    return (
      <span className={['lt-health', className].filter(Boolean).join(' ')}>
        <span className="lt-sr-only">Stream health</span>
        {pill}
      </span>
    );
  }

  return (
    <div className={['lt-health', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={['lt-pill', `lt-pill--${level}`, 'lt-touch'].join(' ')}
        data-level={level}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="lt-dot" aria-hidden="true" />
        <span aria-live="polite" aria-atomic="true">
          {word}
        </span>
        <ChevronIcon size={20} className="lt-pill__chevron" />
      </button>
      <div id={panelId} hidden={!expanded}>
        {detail ? <p className="lt-health__detail">{detail}</p> : null}
        {reasons && reasons.length > 0 ? (
          <ul className="lt-health__reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
