import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'title'> {
  /** Rendered as an `<h3>` in the card header. */
  title?: ReactNode;
  /** Header controls, right-aligned. */
  actions?: ReactNode;
  children?: ReactNode;
  /** Drop the shadow (for cards inside an already-elevated surface, e.g. a Sheet). */
  flat?: boolean;
  className?: string;
}

/**
 * A content container. Deliberately not clickable: a card that is also a button
 * makes its inner controls unreachable and its hit target ambiguous. Put a
 * `Button` inside instead.
 */
export function Card({
  title,
  actions,
  children,
  flat = false,
  className,
  ...rest
}: CardProps): ReactElement {
  const classes = ['lt-card', flat ? 'lt-card--flat' : null, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {title || actions ? (
        <div className="lt-card__header">
          {title ? <h3 className="lt-card__title">{title}</h3> : <span />}
          {actions ? <div className="lt-card__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
