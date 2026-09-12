import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, mediaQuery } from '../tokens.js';
import type { ThemeName, ThemePreference } from '../tokens.js';

export interface UseThemeResult {
  /** What the user chose. `'system'` means "follow the OS". */
  preference: ThemePreference;
  /** What is actually painted right now. */
  resolved: ThemeName;
  setPreference: (next: ThemePreference) => void;
  /** Cycle dark -> light -> dark. Resolves `'system'` to the opposite of what is painted. */
  toggle: () => void;
}

function isPreference(value: string | null): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

function readStored(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(raw) ? raw : 'system';
  } catch {
    // Private mode, or storage disabled. A theme is not worth throwing over.
    return 'system';
  }
}

function systemTheme(): ThemeName {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(mediaQuery.prefersLight).matches ? 'light' : 'dark';
}

/**
 * Reads and writes `data-theme` on `<html>` plus `localStorage["livetap.theme"]`.
 *
 * Dark is the default because Studio's preview is the brightest thing on screen
 * and the chrome has to recede from it. `'system'` is stored as a *preference*,
 * not as a resolved value, so a user who follows the OS keeps following it.
 */
export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStored());
  const [systemResolved, setSystemResolved] = useState<ThemeName>(() => systemTheme());

  // Track the OS preference so `'system'` stays live.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(mediaQuery.prefersLight);
    const onChange = (): void => setSystemResolved(list.matches ? 'light' : 'dark');
    onChange();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    if (typeof list.addListener === 'function') {
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    }
    return undefined;
  }, []);

  const resolved: ThemeName = preference === 'system' ? systemResolved : preference;

  // Paint it. `'system'` removes the attribute so the CSS media query decides.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference): void => {
    setPreferenceState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice still applies for this session.
    }
  }, []);

  const toggle = useCallback((): void => {
    setPreference(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setPreference]);

  return { preference, resolved, setPreference, toggle };
}
