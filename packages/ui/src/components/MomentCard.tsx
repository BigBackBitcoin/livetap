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
  /**
   * A picture of what this Moment actually looks like, drawn by the caller.
   *
   * The card carries an icon by default because an icon is cheap and always available. A real
   * thumbnail is better and the landing page already renders one, so this is the slot that lets
   * the product and the marketing page show the same card instead of building it twice. It
   * REPLACES the glyph rather than sitting beside it: two representations of the same Moment on
   * one 140px card is two things to read.
   */
  thumbnail?: ReactNode;
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
  thumbnail,
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
      {thumbnail ? (
        <span className="lt-moment__thumb" aria-hidden="true">
          {thumbnail}
        </span>
      ) : (
        <span
          className={['lt-moment__icon', isGlyph ? 'lt-moment__icon--glyph' : null]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {glyph}
        </span>
      )}
      <span className="lt-moment__name">{name}</span>
      {/*
        Rendered whether or not there is a meta line, because only the ACTIVE Moment has one and
        a strip of six cards where one is 18px taller than the rest is a ragged row, not a row.
        The element reserves the line; the words are still conditional, so nothing is announced
        that is not true.
      */}
      <span className="lt-moment__meta">{meta}</span>
    </button>
  );
}
