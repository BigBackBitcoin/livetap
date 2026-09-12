import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { IconButton } from './IconButton.js';
import { XIcon } from './Icons.js';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Sheet title. Becomes the dialog's accessible name. */
  title: string;
  children: ReactNode;
  /** Footer actions, pinned below the scrolling body. */
  footer?: ReactNode;
  /** Hide the close button (only for sheets whose content provides its own exit). */
  hideClose?: boolean;
  className?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Bottom sheet on mobile, side panel from 640px up (see components.css).
 *
 * Guarantees: `role="dialog"`, `aria-modal="true"`, a real focus trap, `Escape`
 * closes, background scroll locked, and focus returned to whatever opened it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  hideClose = false,
  className,
}: SheetProps): ReactElement | null {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Remember the opener, move focus in, restore on close.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;

    const node = sheetRef.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape closes, from anywhere — including when focus sits on the scrim.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const trapTab = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const node = sheetRef.current;
    if (!node) return;
    const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusables.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  const body = (
    <>
      {/* The scrim is not a button: a dialog that can be dismissed only by an
          off-target click is undiscoverable. Escape and the close button are the
          documented exits; clicking the scrim is a convenience on top. */}
      <div className="lt-sheet__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={['lt-sheet', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="lt-sheet__handle" aria-hidden="true" />
        <div className="lt-sheet__header">
          <h2 className="lt-sheet__title" id={titleId}>
            {title}
          </h2>
          {hideClose ? null : (
            <IconButton label="Close" onClick={onClose}>
              <XIcon size={24} />
            </IconButton>
          )}
        </div>
        <div className="lt-sheet__body">{children}</div>
        {footer ? <div className="lt-sheet__header">{footer}</div> : null}
      </div>
    </>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}
