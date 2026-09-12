import type { ReactElement } from 'react';
import { SpinnerIcon } from './Icons.js';
import type { IconSize } from './Icons.js';

export interface SpinnerProps {
  size?: IconSize;
  className?: string;
  /**
   * Accessible label. Omit inside a control that already announces `aria-busy`
   * (e.g. `Button loading`) — two announcements are worse than one.
   */
  label?: string;
}

/** A rotating arc. Static under `prefers-reduced-motion` (see global.css). */
export function Spinner({ size = 20, className, label }: SpinnerProps): ReactElement {
  const classes = ['lt-spinner', className].filter(Boolean).join(' ');
  return (
    <SpinnerIcon
      size={size}
      className={classes}
      {...(label ? { title: label } : { 'aria-hidden': true })}
    />
  );
}
