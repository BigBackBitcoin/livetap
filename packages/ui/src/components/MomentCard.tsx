import type { ReactElement, ReactNode } from 'react';

export interface MomentCardProps {
  /** Emoji or an icon element. Moments carry an `icon` key in `@livetap/core`. */
  icon: ReactNode;
  name: string;
  active?: boolean;
  onSelect: () => void;
  /** Optional meta line — "Live now" for the active Moment, or a hotkey hint. */
  meta?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A Moment as a large, tappable card: icon, name, one line of meta.
 *
 * Big on purpose. Switching Moments is the most frequent action while live, often
 * performed on a phone, sometimes while talking — so it gets a ≥140×96px target
 * and never hides behind a menu.
 */
export function MomentCard({
  icon,
  name,
  active = false,
  onSelect,
  meta,
  disabled = false,
  className,
}: MomentCardProps): ReactElement {
  return (
    <button
      type="button"
      className={['lt-moment', 'lt-touch', className].filter(Boolean).join(' ')}
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="lt-moment__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="lt-moment__name">{name}</span>
      {meta ? <span className="lt-moment__meta">{meta}</span> : null}
    </button>
  );
}
