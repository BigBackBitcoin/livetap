/**
 * A ~40-line render harness built on `react-dom/client` + `act`.
 *
 * Deliberately not @testing-library/react: the library has exactly one rendering
 * need (mount, interact, assert on the DOM) and adding a dependency plus its
 * query DSL to satisfy it is not a trade worth making for a zero-dependency
 * package.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ReactNode } from 'react';

export interface Mounted {
  container: HTMLElement;
  root: Root;
  rerender: (next: ReactNode) => void;
  unmount: () => void;
}

export function render(ui: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  return {
    container,
    root,
    rerender(next: ReactNode) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Run a synchronous mutation inside `act` so React flushes before assertions. */
export function flush(fn: () => void): void {
  act(() => {
    fn();
  });
}

/** Click an element the way a user would, inside `act`. */
export function click(element: Element | null | undefined): void {
  if (!element) throw new Error('click(): element not found');
  flush(() => {
    (element as HTMLElement).click();
  });
}

/** Dispatch a keydown on `document` (the target every global handler listens on). */
export function pressKey(key: string, target: EventTarget = document): void {
  flush(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** Collapse whitespace so assertions do not depend on JSX formatting. */
export function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
