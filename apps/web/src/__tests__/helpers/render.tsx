import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

/**
 * A 30-line render helper instead of a testing-library dependency.
 *
 * `apps/web` may not add npm dependencies, and React 19 already ships everything needed:
 * `act` from `react`, `createRoot` from `react-dom/client`. Queries go through the
 * accessibility surface (accessible name, role, text) rather than test ids, so a test that
 * passes is evidence the control is reachable by a person.
 */
export interface Mounted {
  container: HTMLElement;
  unmount(): Promise<void>;
  /** Click by accessible name, and flush everything React and the store do in response. */
  click(name: string | RegExp): Promise<void>;
  text(): string;
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

export async function mount(ui: ReactElement): Promise<Mounted> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;

  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });

  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  return {
    container,
    text: () => container.textContent ?? '',
    async click(name: string | RegExp): Promise<void> {
      const target = findByName(container, name);
      if (!target) throw new Error(`No clickable element named ${String(name)}`);
      await act(async () => {
        target.click();
      });
      await flush();
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

/** Accessible name first (aria-label), then visible text — the order a screen reader uses. */
export function findByName(root: ParentNode, name: string | RegExp): HTMLElement | null {
  const matches = (value: string | null | undefined): boolean => {
    if (!value) return false;
    const normalised = value.replace(/\s+/g, ' ').trim();
    return typeof name === 'string' ? normalised.includes(name) : name.test(normalised);
  };
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, a, [role="radio"], input'));
  return (
    candidates.find((el) => matches(el.getAttribute('aria-label'))) ??
    candidates.find((el) => matches(el.textContent)) ??
    null
  );
}

export async function flushAll(): Promise<void> {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    await Promise.resolve();
  });
}
