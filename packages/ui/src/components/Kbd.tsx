import type { ReactElement, ReactNode } from 'react';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** A keyboard key. Decorative — the shortcut must also be discoverable in the shortcut sheet. */
export function Kbd({ children, className }: KbdProps): ReactElement {
  return <kbd className={['lt-kbd', className].filter(Boolean).join(' ')}>{children}</kbd>;
}
