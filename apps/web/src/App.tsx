import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router';

/**
 * The desktop shell loads the bundle from file://, and Capacitor serves it from a local origin
 * whose server has no history fallback: `https://localhost/` on Android, `capacitor://localhost`
 * on iOS. In all three a deep path survives only until the first reload, so a hash router is what
 * keeps every route reachable. `Capacitor` is the global the native bridge injects before the
 * bundle runs, which is why the Android case cannot be detected from the protocol alone.
 */
const useHashRouting =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' ||
    'livetap' in window ||
    'Capacitor' in window ||
    window.location.protocol === 'capacitor:');
const Router = useHashRouting ? HashRouter : BrowserRouter;
import { Spinner } from '@livetap/ui';

/**
 * Routes, per PRODUCT_SPEC §3.2 with the `/app` prefix this deployment uses so the
 * marketing site and the application can share one origin.
 *
 * The marketing page is not one of them. `/` is its own document — plain HTML, no framework —
 * because a React page cannot meet the landing's 60 KB budget however well it is split: React
 * 19's DOM renderer alone is 69.2 KB gzipped (`docs/qa/FRICTION_BENCHMARK.md` §6). This module
 * is the *application* document, reached at `/app/*`, `/oauth/*`, `/privacy` and `/terms`, and
 * every screen in it is behind `React.lazy` so no route pays for another's code.
 *
 * `/` still has a route here, as a redirect: the desktop and mobile shells load this document
 * over `file://` with a hash router, where an empty hash is `/` and the right answer is the
 * app, not a marketing page inside a native window.
 */
const AppBoot = lazy(() => import('./screens/AppBoot.js').then((m) => ({ default: m.AppBoot })));
const AppIndex = lazy(() => import('./screens/AppBoot.js').then((m) => ({ default: m.AppIndex })));
const AppShell = lazy(() => import('./components/AppShell.js').then((m) => ({ default: m.AppShell })));
const Onboarding = lazy(() =>
  import('./screens/onboarding/Onboarding.js').then((m) => ({ default: m.Onboarding })),
);
const Studio = lazy(() => import('./screens/Studio.js').then((m) => ({ default: m.Studio })));
const Destinations = lazy(() =>
  import('./screens/Destinations.js').then((m) => ({ default: m.Destinations })),
);
const Moments = lazy(() => import('./screens/Moments.js').then((m) => ({ default: m.Moments })));
const Settings = lazy(() => import('./screens/Settings.js').then((m) => ({ default: m.Settings })));
const Recordings = lazy(() =>
  import('./screens/Recordings.js').then((m) => ({ default: m.Recordings })),
);
const OAuthCallback = lazy(() =>
  import('./screens/OAuthCallback.js').then((m) => ({ default: m.OAuthCallback })),
);
const Privacy = lazy(() => import('./screens/Privacy.js').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./screens/Terms.js').then((m) => ({ default: m.Terms })));
const NotFound = lazy(() => import('./screens/NotFound.js').then((m) => ({ default: m.NotFound })));

/**
 * The one loading state in the product. It is text-first: a spinner with no words is a
 * spinner that cannot tell you it is stuck.
 */
function Loading({ label }: { label: string }): ReactElement {
  // Delay the visible spinner so a fast chunk never flashes one.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="lt-route-loading" role="status" aria-live="polite">
      {shown ? (
        <>
          <Spinner size={24} />
          <p>{label}</p>
        </>
      ) : (
        <span className="lt-sr-only">{label}</span>
      )}
    </div>
  );
}

export function App(): ReactElement {
  return (
    <Router>
      <Suspense fallback={<Loading label="Opening LIVETAP…" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          <Route path="/app" element={<AppBoot />}>
            <Route index element={<AppIndex />} />
            <Route path="start" element={<Onboarding />} />
            <Route element={<AppShell />}>
              <Route path="studio" element={<Studio />} />
              <Route path="destinations" element={<Destinations />} />
              <Route path="moments" element={<Moments />} />
              <Route path="settings" element={<Settings />} />
              <Route path="recordings" element={<Recordings />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
