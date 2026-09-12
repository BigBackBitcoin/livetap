import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Icons, Logo, Toggle, VisuallyHidden } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { MockBanner } from './MockBanner.js';
import { NoticeRegion } from './NoticeRegion.js';

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

  return (
    <div className="lt-shell">
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
            Pro mode adds encoder, layer and diagnostic controls. Nothing is hidden.
          </VisuallyHidden>
        </div>
      </nav>

      <main className="lt-shell__main" id="lt-main">
        <MockBanner />
        <Outlet />
      </main>

      <NoticeRegion />
    </div>
  );
}
