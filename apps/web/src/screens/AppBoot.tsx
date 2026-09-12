import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router';
import { Spinner, useTheme } from '@livetap/ui';
import { useAppStore } from '../state/store.js';

/**
 * Boots the one orchestrator and one media engine, then hands over to the routed screen.
 *
 * It also applies the user's theme preference for the whole application, which is the only
 * place that can: `useTheme` used to be called by the Settings screen alone, so a stored
 * choice was painted only while Settings was on screen.
 */
export function AppBoot(): ReactElement {
  const ready = useAppStore((s) => s.ready);
  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  /*
   * The colour scheme follows the operating system on a first boot (PRODUCT_REVIEW P2-12).
   *
   * This used to write `livetap.theme = 'dark'` before the user had expressed any preference
   * and paint `data-theme="dark"`, which is a silent override of a stated system preference —
   * and it left Settings truthful only by accident, because the override had been written into
   * storage first. DESIGN_SYSTEM §2.1 is normative: `data-theme` when the user has chosen, and
   * "with no attribute, `prefers-color-scheme` decides". `useTheme` defaults to `'system'`,
   * removes the attribute in that state, and stores nothing until the user picks — so a first
   * boot follows the OS, dark remains the base palette in `tokens.css` for every machine that
   * does not ask for light, and the Settings control shows the truth in all three states.
   */
  useTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-density', mode === 'pro' ? 'pro' : 'simple');
    root.setAttribute('data-livetap-app', 'true');
    return () => {
      root.removeAttribute('data-density');
      root.removeAttribute('data-livetap-app');
    };
  }, [mode]);

  if (!ready) {
    return (
      <div className="lt-route-loading" role="status" aria-live="polite">
        <Spinner size={24} />
        <p>Starting LIVETAP…</p>
      </div>
    );
  }

  return <Outlet />;
}

/**
 * `/app` itself is a decision, not a screen: a dashboard between opening the app and going
 * live is a step that earns nothing (PRODUCT_SPEC §3.1).
 */
export function AppIndex(): ReactElement {
  const onboardingDone = useAppStore((s) => s.onboardingDone);
  const destinations = useAppStore((s) => s.destinations);
  const firstRun = !onboardingDone && destinations.length === 0;
  return <Navigate to={firstRun ? '/app/start' : '/app/studio'} replace />;
}
