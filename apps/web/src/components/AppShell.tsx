import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Icons, Logo, Toggle, VisuallyHidden } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { LiveBar } from './LiveBar.js';
import { MockBanner } from './MockBanner.js';
import { NoticeRegion } from './NoticeRegion.js';
import { Tour } from './Tour.js';

interface NavItem {
  to: string;
  label: string;
  icon: ReactElement;
}

const NAV: readonly NavItem[] = [
  { to: '/app/studio', label: 'Studio', icon: <Icons.play size={24} /> },
  { to: '/app/moments', label: 'Moments', icon: <Icons.tv size={24} /> },
  { to: '/app/destinations', label: 'Destinations', icon: <Icons.globe size={24} /> },
  { to: '/app/recordings', label: 'Recordings', icon: <Icons.record size={24} /> },
];

/**
 * The navigation chrome, identical in Simple and Pro at every breakpoint
 * (PRODUCT_SPEC §3.3). One CSS grid decides whether the rail is on the left (desktop),
 * the top (tablet) or the bottom (mobile); the markup order never changes, so the tab
 * order and the screen-reader reading order are the same everywhere.
 */
export function AppShell(): ReactElement {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const productionState = useAppStore((s) => s.production.state);
  const { pathname } = useLocation();

  /*
   * The stop control is chrome, not content. `LiveBar` is fixed to the bottom of the window on
   * every route, so the scrolling column has to end above it or the last thing on every screen
   * sits underneath the one control that must never be covered.
   */
  const onAir = productionState !== 'IDLE' && productionState !== 'PREVIEW';

  /*
   * A router does not reset the scroll position on its own, so arriving at Studio from a
   * scrolled onboarding screen landed 67px down the page with the demo banner already clipped,
   * and every move between app screens inherited wherever the last one had been left. Each
   * screen starts at its own top.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={['lt-shell', onAir ? 'is-onair' : null].filter(Boolean).join(' ')}>
      <a className="lt-skip-link" href="#lt-main">
        Skip to the main screen
      </a>

      <nav className="lt-shell__nav" aria-label="LIVETAP">
        <div className="lt-shell__brand">
          <NavLink to="/app/studio" aria-label="LIVETAP Studio">
            <Logo variant="mark" size={32} />
          </NavLink>
        </div>
        <ul className="lt-shell__navlist">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  ['lt-shell__navitem', 'lt-touch', isActive ? 'is-active' : ''].filter(Boolean).join(' ')
                }
              >
                <span aria-hidden="true">{item.icon}</span>
                <span className="lt-shell__navlabel">{item.label}</span>
              </NavLink>
            </li>
          ))}
          <li className="lt-shell__navspacer" aria-hidden="true" />
          <li>
            <NavLink
              to="/app/settings"
              className={({ isActive }) =>
                ['lt-shell__navitem', 'lt-touch', isActive ? 'is-active' : ''].filter(Boolean).join(' ')
              }
            >
              <span aria-hidden="true">
                <Icons.settings size={24} />
              </span>
              <span className="lt-shell__navlabel">Settings</span>
            </NavLink>
          </li>
        </ul>
        <div className="lt-shell__mode">
          <Toggle
            pressed={mode === 'pro'}
            onPressedChange={(next) => setMode(next ? 'pro' : 'simple')}
          >
            Pro mode
          </Toggle>
          <VisuallyHidden>
            Pro mode adds the controls LIVETAP normally decides for you, and diagnostics. Nothing is hidden.
          </VisuallyHidden>
        </div>
      </nav>

      {/*
        The Quick Tour sits INSIDE `<main>`, above the demo banner, because its offer is a
        banner in the flow rather than an overlay — see the long note in `Tour.tsx`. A fixed
        card pinned to the top of the viewport covered `MockBanner`'s own action link on a desk
        and the shape control, the mic picker and MUTE on a phone, and no position exists that
        is empty at every scroll offset. Taking room is the fix; taking a corner is not.

        It renders nothing at all while the production is not idle, so it and `LiveBar` can
        never be on screen together — see the three guarantees documented in `Tour.tsx`. The
        beats it shows once the creator presses "Show me" are still a fixed layer, at
        `--lt-z-golive` (40), far below `--lt-z-livebar` (900).
      */}
      <main className="lt-shell__main" id="lt-main">
        <Tour />
        <MockBanner />
        <Outlet />
      </main>

      {/*
        Last in the DOM, above everything in paint order, and outside `<main>` so a route change
        cannot unmount it. This is the whole answer to "END is cancelled by navigating away".
      */}
      <LiveBar />

      <NoticeRegion />
    </div>
  );
}
