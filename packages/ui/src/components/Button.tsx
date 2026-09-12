import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
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

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
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
