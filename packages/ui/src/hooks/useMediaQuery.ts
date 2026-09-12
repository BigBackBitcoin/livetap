import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a media query.
 *
 * SSR-safe (returns `false` before hydration) and tolerant of the legacy
 * `addListener` API, which some embedded webviews still ship.
 *
 * Prefer the ready-made strings in `mediaQuery` from `../tokens.js` so no
 * component invents its own breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const [active, setActive] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = (): void => setActive(list.matches);
    onChange();

    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    // Legacy Safari / older webviews.
    if (typeof list.addListener === 'function') {
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    }
    return undefined;
  }, [query]);

  return active;
}
