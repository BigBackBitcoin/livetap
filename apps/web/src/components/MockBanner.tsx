import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Banner } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { useAppStore } from '../state/store.js';

/**
 * The honesty banner (PRODUCT_SPEC §4.4). Not dismissible while any demo destination is
 * enabled, because "I thought I was live" is the worst outcome this product can produce.
 * `info`, not `warning`: demo mode is a valid state, not a problem.
 */
export function MockBanner(): ReactElement | null {
  const destinations = useAppStore((s) => s.destinations);
  const enabledMocks = destinations.filter((d) => d.config.enabled && d.config.mock);
  if (enabledMocks.length === 0) return null;

  const allMock = destinations.length > 0 && destinations.every((d) => d.config.mock);
  const first = enabledMocks[0];
  const platformName = first ? PLATFORM_PROFILES[first.config.platform].displayName : '';

  const message = allMock
    ? 'Demo mode — every destination here is simulated. LIVETAP is not broadcasting anywhere.'
    : enabledMocks.length > 1
      ? `Demo mode — ${enabledMocks.length} of your destinations are simulated. Nothing is being broadcast to them.`
      : `Demo mode — "${first?.config.label ?? ''}" is a simulated destination. Nothing is being broadcast to ${platformName}.`;

  return (
    <div className="lt-bannerslot">
      <Banner
        tone="info"
        className="lt-mockbanner"
        action={
          <Link className="lt-textlink" to="/app/destinations">
            Manage demo destinations
          </Link>
        }
      >
        {message}
      </Banner>
    </div>
  );
}
