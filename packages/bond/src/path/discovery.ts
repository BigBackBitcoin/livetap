/**
 * Finding out what network paths this device actually has.
 *
 * The mission's hardest instruction is in section 36: do not claim "4G + 5G + Wi-Fi" unless the
 * specific device really exposes independent usable Internet paths. Every bonding product on the
 * market overstates this, because the marketing writes itself and the truth is device-specific,
 * carrier-specific and often disappointing. So discovery here is built to UNDERSTATE.
 *
 * Three rules make that structural rather than aspirational:
 *
 *   A CANDIDATE IS NOT A PATH. Discovery returns `PathCandidate`, which is a thing the OS is
 *   offering. It becomes a `NetworkPath` only after a probe has reached the relay through it. The
 *   type system enforces the gap, so no amount of enthusiasm in a platform adapter can promote an
 *   interface into a usable path without evidence.
 *
 *   INDEPENDENCE IS MEASURED, NOT ASSUMED. Two handles from the OS is not two routes to the
 *   Internet. The only cheap proof is the relay reporting that our packets arrived from two
 *   different public addresses, which is why `PathIndependence` starts at `declared` and is only
 *   promoted to `observed` by the relay. Until then the product must not promise protection.
 *
 *   A RADIO IS NOT A PATH. Wi-Fi band, cellular generation and signal bars land in `radio`, which
 *   nothing in the policy engine can read. 2.4 GHz and 5 GHz on one access point are one path
 *   wearing two hats, and LTE and 5G on one SIM are usually one path negotiated by the modem.
 *
 * Platform adapters live outside this package - Android's is a Capacitor plugin over
 * ConnectivityManager, the desktop's is in the Electron main process - because they need native
 * APIs this package deliberately does not depend on. What is here is the contract they implement
 * and the reasoning every one of them must follow.
 */
import type { PathCandidate, PathTransport } from './types.js';

/** What a platform adapter provides. Implemented natively per OS. */
export interface PathDiscovery {
  /** Everything the OS is currently offering. May be empty; never throws. */
  list(): Promise<readonly PathCandidate[]>;
  /**
   * Watch for changes. Returns a function that stops watching.
   *
   * Networks appear and disappear constantly on a phone - walking out of Wi-Fi range, a train
   * going through a tunnel - and polling for that is both slow to react and expensive in battery.
   */
  watch(onChange: (candidates: readonly PathCandidate[]) => void): () => void;
  /** What this platform can and cannot do, for the honest capability report. */
  capabilities(): PlatformCapabilities;
}

/**
 * What a platform genuinely permits, stated bluntly.
 *
 * This is what section 37's device report is built from, and every field is allowed to say no.
 * A capability report that cannot express "this device will not do that" is a marketing document.
 */
export interface PlatformCapabilities {
  readonly platform: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'browser' | 'unknown';
  /**
   * Can this process hold more than one network at once and send on both?
   *
   * `unknown` is the honest default and is not a failure: it means nothing has measured it yet on
   * this device, and the product degrades to single-path rather than guessing.
   */
  readonly simultaneousPaths: 'yes' | 'no' | 'unknown';
  /** Can a socket be pinned to a specific interface? Without this there is no striping at all. */
  readonly canBindPerPath: 'yes' | 'no' | 'unknown';
  /** Does the platform tell us whether a network costs money? */
  readonly reportsMetered: boolean;
  /** Does the platform confirm a network actually reaches the Internet? */
  readonly reportsValidated: boolean;
  /** Anything that will bite later: entitlements, permissions, vendor limits. */
  readonly caveats: readonly string[];
}

/** Nothing found, nothing claimed. The honest answer on a surface with no network APIs. */
export const NO_DISCOVERY: PathDiscovery = {
  async list() {
    return [];
  },
  watch() {
    return () => undefined;
  },
  capabilities() {
    return {
      platform: 'unknown',
      simultaneousPaths: 'unknown',
      canBindPerPath: 'unknown',
      reportsMetered: false,
      reportsValidated: false,
      caveats: ['No platform network discovery is available on this surface.'],
    };
  },
};

/**
 * The browser's answer, which is: no.
 *
 * A web page cannot enumerate interfaces, cannot bind a socket to one, and cannot hold two
 * networks open. `navigator.connection` describes ONE effective connection and is a hint, not a
 * path list. This is stated explicitly rather than left out, because "we have not implemented it
 * yet" and "the platform forbids it" are different facts and only one of them can be fixed.
 */
export function browserCapabilities(): PlatformCapabilities {
  return {
    platform: 'browser',
    simultaneousPaths: 'no',
    canBindPerPath: 'no',
    reportsMetered: false,
    reportsValidated: false,
    caveats: [
      'A browser cannot enumerate network interfaces or bind a socket to one, so bonding is not possible on the web surface at all.',
      'navigator.connection describes one effective connection and is a hint, not a path.',
      'The web surface therefore runs single-path, which is the correct and complete behaviour there.',
    ],
  };
}

/**
 * Group candidates by what is plausibly one uplink.
 *
 * A heuristic, and labelled as one. It exists to stop the obvious over-claim - counting several
 * addresses on one interface, or both Wi-Fi bands, as separate paths - before anything reaches
 * the relay. It is not a substitute for the relay's egress-address check, which is the only real
 * evidence; it just means the product does not have to embarrass itself waiting for it.
 */
export function groupLikelyUplinks(
  candidates: readonly PathCandidate[],
): Map<string, readonly PathCandidate[]> {
  const groups = new Map<string, PathCandidate[]>();
  for (const candidate of candidates) {
    /*
     * Cellular candidates are grouped per subscription rather than per radio technology. LTE and
     * 5G on one SIM are one path - the modem chooses between them - and presenting them as two
     * would be the exact claim section 2 forbids. A genuinely dual-SIM device reports two
     * subscription ids and gets two groups.
     */
    const key =
      candidate.transport === 'cellular'
        ? `cellular:${candidate.radio?.subscriptionId ?? candidate.radio?.carrier ?? 'default'}`
        : candidate.transport === 'wifi'
          ? `wifi:${candidate.radio?.bssid ?? candidate.radio?.ssid ?? candidate.handle}`
          : `${candidate.transport}:${candidate.handle}`;
    const existing = groups.get(key);
    if (existing) existing.push(candidate);
    else groups.set(key, [candidate]);
  }
  return groups;
}

/**
 * The strongest claim the product may make right now, in one sentence.
 *
 * Deliberately conservative: it counts GROUPS, not candidates, and it refuses to promise anything
 * at all until the platform has said it can hold two networks at once. The string is written for
 * a developer reading a capability report, never for a creator - the creator sees "Excellent" or
 * "Protected" and nothing about radios.
 */
export function describeCapability(
  candidates: readonly PathCandidate[],
  capabilities: PlatformCapabilities,
): string {
  const usable = candidates.filter((c) => c.hasInternet);
  const groups = groupLikelyUplinks(usable);

  if (groups.size === 0) return 'No network path is available.';
  if (groups.size === 1) return 'One network path. Bonding is not applicable; the stream runs single-path.';
  if (capabilities.simultaneousPaths === 'no') {
    return `${groups.size} networks are visible, but this platform will not hold more than one at a time, so only one can carry the stream.`;
  }
  if (capabilities.simultaneousPaths === 'unknown') {
    return `${groups.size} networks are visible. Whether this device can use them at the same time has not been measured, so the stream runs single-path until it has been.`;
  }
  if (capabilities.canBindPerPath !== 'yes') {
    return `${groups.size} networks are visible and can be held at once, but sockets cannot be pinned to one, so traffic cannot be striped across them.`;
  }
  return `${groups.size} likely independent paths. Confirmed independent only once the relay reports distinct egress addresses.`;
}

/** Map an OS interface name to a transport class, for adapters that only have a name to go on. */
export function transportFromInterfaceName(name: string): PathTransport {
  const lower = name.toLowerCase();
  if (/^(wlan|wi-?fi|wlp|ath|en1)/.test(lower)) return 'wifi';
  if (/(rmnet|ccmni|pdp_ip|wwan|cellular|lte|nr)/.test(lower)) return 'cellular';
  if (/^(eth|enp|eno|ens|en0|ethernet)/.test(lower)) return 'ethernet';
  if (/(usb|rndis|ncm)/.test(lower)) return 'usb';
  return 'other';
}
