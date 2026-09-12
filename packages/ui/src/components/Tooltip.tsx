import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  /** Short text. A tooltip is never the only source of this information. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * CSS-only tooltip: shows on `:hover` and `:focus-within`, hidden on coarse pointers.
 *
 * The bubble itself is `aria-hidden`; the same text is exposed once through a
 * visually hidden span linked with `aria-describedby`, so screen-reader users get
 * the label without hearing it twice.
 */
export function Tooltip({ label, children, className }: TooltipProps): ReactElement {
  const id = useId();
  return (
    <span className={['lt-tooltip', className].filter(Boolean).join(' ')} aria-describedby={id}>
      {children}
      <span className="lt-tooltip__bubble" aria-hidden="true">
        {label}
      </span>
      <span className="lt-sr-only" id={id}>
        {label}
      </span>
    </span>
  );
}
