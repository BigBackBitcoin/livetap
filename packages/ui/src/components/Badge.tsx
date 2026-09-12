import type { ReactElement, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Optional leading icon, 20px. */
  icon?: ReactNode;
  className?: string;
}

/**
 * A small, non-interactive label. Used for honest capability badges on the
 * "Add destination" sheet ("Connect with account", "Paste stream key",
 * "Not available") and for the `Mock` marker.
 *
 * Not a status indicator — destination state is `StatusChip`.
 */
export function Badge({ children, tone = 'neutral', icon, className }: BadgeProps): ReactElement {
  const classes = ['lt-badge', `lt-badge--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {icon}
      {children}
    </span>
  );
}
