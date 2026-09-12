import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

export interface ToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'onChange' | 'children'> {
  /** Current state. */
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  /** Visible label. Omit only when `aria-label` is supplied instead. */
  children?: ReactNode;
  /** Put the switch after the label (default) or before it. */
  switchFirst?: boolean;
  className?: string;
}

/**
 * A switch: `<button role="switch" aria-checked>`, not a checkbox.
 *
 * Rationale: every toggle in LIVETAP takes effect immediately (mute, recording,
 * theme). A checkbox implies a form that will be submitted later. `role="switch"`
 * says "this is on or off right now", which is the truth, and keeps the native
 * button's Space/Enter activation and focus behaviour (PRODUCT_REVIEW P2-13).
 */
export function Toggle({
  pressed,
  onPressedChange,
  children,
  switchFirst = false,
  className,
  disabled,
  type = 'button',
  onClick,
  ...rest
}: ToggleProps): ReactElement {
  const control = (
    <span className="lt-toggle__track" aria-hidden="true">
      <span className="lt-toggle__knob" />
    </span>
  );

  return (
    <button
      type={type}
      className={['lt-toggle', 'lt-touch', className].filter(Boolean).join(' ')}
      role="switch"
      aria-checked={pressed}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onPressedChange(!pressed);
      }}
      {...rest}
    >
      {switchFirst ? control : null}
      {children ? <span className="lt-toggle__label">{children}</span> : null}
      {switchFirst ? null : control}
    </button>
  );
}
