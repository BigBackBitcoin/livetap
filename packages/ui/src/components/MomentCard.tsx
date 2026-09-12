import type { ReactElement, ReactNode } from 'react';

export interface MomentCardProps {
  /**
   * The glyph for this Moment — preferably `<MomentIcon moment={id} />`, so the card
   * speaks the same visual language as the nav (PRODUCT_REVIEW P2-5). A plain string
   * still works and is rendered as an emoji: Moments carry an emoji `icon` key in
   * `@livetap/core`, and that path stays supported. When both are given, `icon` wins.
   */
  icon?: ReactNode;
  /** Emoji fallback, used only when `icon` is absent. */
  emoji?: string;
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
  emoji,
  name,
  active = false,
  onSelect,
  meta,
  disabled = false,
  className,
}: MomentCardProps): ReactElement {
  // A ReactNode icon is preferred; the emoji string is the backwards-compatible path.
  const glyph = icon ?? emoji ?? null;
  const isGlyph = glyph !== null && typeof glyph !== 'string' && typeof glyph !== 'number';

  return (
    <button
      type="button"
      className={['lt-moment', 'lt-touch', className].filter(Boolean).join(' ')}
      aria-pressed={active}
      disabled={disabled}
      onClick={onSelect}
    >
      <span
        className={['lt-moment__icon', isGlyph ? 'lt-moment__icon--glyph' : null]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      >
        {glyph}
      </span>
      <span className="lt-moment__name">{name}</span>
      {meta ? <span className="lt-moment__meta">{meta}</span> : null}
    </button>
  );
}
