import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Banner } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import { broadcastReality } from './preflight.js';

/**
 * The honesty banner (PRODUCT_SPEC §4.4). Not dismissible while anything on this screen is
 * simulated, because "I thought I was live" is the worst outcome this product can produce.
 * `info`, not `warning`: demo mode is a valid state, not a problem.
 *
 * What it reads changed, and the change is the point. It used to filter on `config.mock`, which
 * is what a destination was configured as rather than what it will do. With demo mode on and one
 * pasted-key destination added, the store marks that destination as not simulated whatever the
 * build is, so the banner hid itself, the demo badges vanished, the button read GO LIVE and
 * then "Live on 1", and nothing left the machine. `broadcastReality` answers from the adapters and
 * the engine this process actually constructed, so the banner cannot be talked out of appearing
 * by a config field.
 */
export function MockBanner(): ReactElement | null {
  const destinations = useAppStore((s) => s.destinations);
  const adapterKind = useAppStore((s) => s.adapterKind);
  const engineHost = useAppStore((s) => s.engineHost);

  const reality = broadcastReality(destinations, adapterKind, engineHost);
  if (reality.simulated.length === 0) return null;

  const first = reality.simulated[0];
  const message = reality.allSimulated
    ? whyNothingLeaves(reality.reason)
    : reality.simulated.length > 1
      ? `Demo mode — ${reality.simulated.length} of your destinations are simulated. Nothing is being broadcast to them.`
      : `Demo mode — "${first?.config.label ?? ''}" is a simulated destination. Nothing is being broadcast to it.`;

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

/**
 * Why nothing is leaving, in the creator's terms.
 *
 * Three different facts produce the same outcome and the sentence says which one it is, because
 * "turn demo mode off" is useless advice to someone whose destinations are all demos, and
 * "remove the demo destinations" is useless advice to someone whose whole build is simulated.
 */
function whyNothingLeaves(reason: 'adapters' | 'engine' | 'destinations' | null): string {
  switch (reason) {
    case 'adapters':
      return 'Demo mode — this build talks to simulated platforms. LIVETAP is not broadcasting anywhere.';
    case 'engine':
      return 'Demo mode — this build makes a test picture and sends it nowhere.';
    default:
      return 'Demo mode — every destination here is simulated. LIVETAP is not broadcasting anywhere.';
  }
}
