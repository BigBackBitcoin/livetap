import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { ButtonSize } from './Button.js';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label' | 'children'> {
  /**
   * The accessible name. **Required** — an icon-only control with no label is
   * invisible to a screen reader, and this prop is how the system prevents that.
   */
  label: string;
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  /** Renders in the "on" state (e.g. the dock tab currently open). */
  active?: boolean;
  className?: string;
}

/** A square, icon-only button. `label` becomes `aria-label`. */
export function IconButton({
  label,
  children,
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  const classes = [
    'lt-iconbtn',
    `lt-iconbtn--${variant}`,
    `lt-iconbtn--${size}`,
    active ? 'lt-iconbtn--active' : null,
    'lt-touch',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
