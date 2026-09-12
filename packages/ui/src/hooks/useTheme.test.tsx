import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { click, render, text } from '../testing/render.js';
import { useTheme } from './useTheme.js';
import { THEME_STORAGE_KEY } from '../tokens.js';

function Probe(): ReactElement {
  const { preference, resolved, setPreference, toggle } = useTheme();
  return (
    <div>
      <output data-testid="preference">{preference}</output>
      <output data-testid="resolved">{resolved}</output>
      <button type="button" data-testid="toggle" onClick={toggle}>
        toggle
      </button>
      <button type="button" data-testid="light" onClick={() => setPreference('light')}>
        light
      </button>
      <button type="button" data-testid="system" onClick={() => setPreference('system')}>
        system
      </button>
    </div>
  );
}

const read = (container: HTMLElement, id: string): string =>
  text(container.querySelector(`[data-testid="${id}"]`));

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('starts on the system preference and sets no attribute', () => {
    const { container, unmount } = render(<Probe />);
    expect(read(container, 'preference')).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    unmount();
  });

  it('toggles data-theme on the root element', () => {
    const { container, unmount } = render(<Probe />);
    const before = read(container, 'resolved');

    click(container.querySelector('[data-testid="toggle"]'));
    const after = document.documentElement.getAttribute('data-theme');
    expect(after).toBe(before === 'dark' ? 'light' : 'dark');
    expect(read(container, 'resolved')).toBe(after);

    click(container.querySelector('[data-testid="toggle"]'));
    expect(document.documentElement.getAttribute('data-theme')).toBe(before);
    unmount();
  });

  it('persists the preference to localStorage under livetap.theme', () => {
    const { container, unmount } = render(<Probe />);
    click(container.querySelector('[data-testid="light"]'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    unmount();
  });

  it('restores a stored preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { container, unmount } = render(<Probe />);
    expect(read(container, 'preference')).toBe('light');
    expect(read(container, 'resolved')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    unmount();
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    const { container, unmount } = render(<Probe />);
    expect(read(container, 'preference')).toBe('system');
    unmount();
  });

  it('going back to system removes the attribute so the OS decides again', () => {
    const { container, unmount } = render(<Probe />);
    click(container.querySelector('[data-testid="light"]'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    click(container.querySelector('[data-testid="system"]'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    unmount();
  });
});
