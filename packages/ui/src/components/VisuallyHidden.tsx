import type { ReactElement, ReactNode } from 'react';

export interface VisuallyHiddenProps {
  children: ReactNode;
  /** Render as this element instead of a `<span>`. */
  as?: 'span' | 'div' | 'p';
  /** Politeness of an announcement, when this is used as a live region. */
  live?: 'off' | 'polite' | 'assertive';
  id?: string;
}

/**
 * Hidden from sight, present for assistive technology. Content stays focusable,
 * so this is also the correct wrapper for a skip target's label.
 */
export function VisuallyHidden({
  children,
  as: Tag = 'span',
  live,
  id,
}: VisuallyHiddenProps): ReactElement {
  return (
    <Tag className="lt-sr-only" id={id} aria-live={live} aria-atomic={live ? true : undefined}>
      {children}
    </Tag>
  );
}
