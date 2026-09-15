import type { ButtonHTMLAttributes, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { Spinner } from './Spinner.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and sets `aria-busy`. The label stays in flow so the button's
   * width never jumps — a button that resizes under the pointer is a misclick.
   */
  loading?: boolean;
  /** Leading icon, rendered at 20px. */
  icon?: ReactNode;
  /** Fill the inline axis. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The system's button.
 *
 * `variant="live"` is reserved: GO LIVE in Studio and the single Landing CTA.
 * Exactly one solid-accent element may be on screen at a time (DESIGN_SYSTEM.md §0.3).
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  const classes = [
    'lt-btn',
    `lt-btn--${variant}`,
    `lt-btn--${size}`,
    block ? 'lt-btn--block' : null,
    loading ? 'lt-btn--loading' : null,
    'lt-touch',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /*
   * A press that begins on this button ends on this button.
   *
   * `click` is dispatched to the common ancestor of where the pointer went DOWN and where it came
   * UP, so anything that reflows the page in between silently eats it. That is not hypothetical:
   * blurring a field in the paste-key form adds an error line above the submit button, the button
   * moves a few pixels down while the pointer is still travelling, mouseup lands on whatever took
   * its place, and no click is ever dispatched. The creator fixes both errors, presses Connect,
   * and nothing happens — no destination, no message, nothing in the console. It was the only path
   * to a real platform, and it was reachable by making one typo first.
   *
   * Pointer capture sends every later event from that pointer here regardless of what moved, so a
   * press is judged on where it started. This is the same invariant `useSteadyWhilePressed` keeps
   * for a destination row, applied to every button in the product at once.
   */
  const capture = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Not every environment implements capture; the button still works without it. */
    }
    rest.onPointerDown?.(event);
  };

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
      onPointerDown={capture}
    >
      {loading ? (
        <span className="lt-btn__spinner">
          <Spinner size={20} />
        </span>
      ) : (
        icon
      )}
      <span className="lt-btn__label">{children}</span>
    </button>
  );
}
