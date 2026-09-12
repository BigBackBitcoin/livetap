import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router';
import { Spinner, THEME_STORAGE_KEY } from '@livetap/ui';
import { useAppStore } from '../state/store.js';

/**
 * Boots the one orchestrator and one media engine, then hands over to the routed screen.
 *
 * Studio is dark by default (DESIGN_SYSTEM §2.1), so the app root carries `data-app` and the
 * density attribute; the marketing site is left alone to follow the OS.
 */
export function AppBoot(): ReactElement {
  const ready = useAppStore((s) => s.ready);
  const mode = useAppStore((s) => s.mode);

  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  // Studio is dark by default (DESIGN_SYSTEM §2.1): the preview is the brightest thing on
  // screen and the chrome has to recede from it. This writes the preference once, on a first
  // app boot only, so Settings shows the real current value and the user can change it — rather
  // than painting dark while the control claims to be following the OS.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(THEME_STORAGE_KEY) === null) {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      }
      if (window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    } catch {
      // Storage disabled. The app still paints, following the OS.
    }
  }, []);

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
