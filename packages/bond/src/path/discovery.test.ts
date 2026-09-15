import { describe, expect, it } from 'vitest';
import {
  NO_DISCOVERY,
  browserCapabilities,
  describeCapability,
  groupLikelyUplinks,
  transportFromInterfaceName,
  type PlatformCapabilities,
} from './discovery.js';
import type { PathCandidate } from './types.js';

function candidate(overrides: Partial<PathCandidate> = {}): PathCandidate {
  return {
    handle: 'net-1',
    transport: 'wifi',
    label: 'Wi-Fi',
    hasInternet: true,
    validated: true,
    metered: 'unmetered',
    ...overrides,
  };
}

const ABLE: PlatformCapabilities = {
  platform: 'android',
  simultaneousPaths: 'yes',
  canBindPerPath: 'yes',
  reportsMetered: true,
  reportsValidated: true,
  caveats: [],
};

describe('groupLikelyUplinks', () => {
  it('counts both Wi-Fi bands on one access point as one path', () => {
    // Section 8. 2.4 GHz and 5 GHz on one AP are one path wearing two hats, and presenting them
    // as two independent uplinks is the most common over-claim in this whole product category.
    const groups = groupLikelyUplinks([
      candidate({ handle: 'wifi-24', radio: { bssid: 'aa:bb:cc:dd:ee:ff', band: '2.4GHz' } }),
      candidate({ handle: 'wifi-5', radio: { bssid: 'aa:bb:cc:dd:ee:ff', band: '5GHz' } }),
    ]);
    expect(groups.size).toBe(1);
  });

  it('counts LTE and 5G on one SIM as one path', () => {
    // The modem chooses between them. They are not two routes to the Internet.
    const groups = groupLikelyUplinks([
      candidate({ handle: 'cell-lte', transport: 'cellular', radio: { subscriptionId: 1, generation: 'LTE' } }),
      candidate({ handle: 'cell-nr', transport: 'cellular', radio: { subscriptionId: 1, generation: '5G' } }),
    ]);
    expect(groups.size).toBe(1);
  });

  it('counts two SIMs as two paths', () => {
    const groups = groupLikelyUplinks([
      candidate({ handle: 'cell-a', transport: 'cellular', radio: { subscriptionId: 1 } }),
      candidate({ handle: 'cell-b', transport: 'cellular', radio: { subscriptionId: 2 } }),
    ]);
    expect(groups.size).toBe(2);
  });

  it('counts Wi-Fi and cellular as two paths', () => {
    const groups = groupLikelyUplinks([
      candidate({ handle: 'wifi', radio: { bssid: 'aa:bb' } }),
      candidate({ handle: 'cell', transport: 'cellular', radio: { subscriptionId: 1 } }),
    ]);
    expect(groups.size).toBe(2);
  });

  it('separates two different access points', () => {
    const groups = groupLikelyUplinks([
      candidate({ handle: 'wifi-home', radio: { bssid: 'aa:aa:aa:aa:aa:aa' } }),
      candidate({ handle: 'wifi-phone', radio: { bssid: 'bb:bb:bb:bb:bb:bb' } }),
    ]);
    expect(groups.size).toBe(2);
  });
});

describe('describeCapability', () => {
  it('will not promise bonding on a platform that has not been measured', () => {
    // `unknown` is the honest default, and it must not read as a capability. The product degrades
    // to single-path rather than guessing.
    const text = describeCapability(
      [candidate({ handle: 'a', radio: { bssid: 'a' } }), candidate({ handle: 'b', transport: 'cellular', radio: { subscriptionId: 1 } })],
      { ...ABLE, simultaneousPaths: 'unknown' },
    );
    expect(text).toContain('has not been measured');
    expect(text).toContain('single-path');
  });

  it('says plainly when a platform refuses to hold two networks', () => {
    const text = describeCapability(
      [candidate({ handle: 'a', radio: { bssid: 'a' } }), candidate({ handle: 'b', transport: 'cellular', radio: { subscriptionId: 1 } })],
      { ...ABLE, simultaneousPaths: 'no' },
    );
    expect(text).toContain('will not hold more than one');
  });

  it('says plainly when sockets cannot be pinned, however many networks there are', () => {
    // Two networks with no per-socket binding is two networks you can switch between, not bond.
    const text = describeCapability(
      [candidate({ handle: 'a', radio: { bssid: 'a' } }), candidate({ handle: 'b', transport: 'cellular', radio: { subscriptionId: 1 } })],
      { ...ABLE, canBindPerPath: 'no' },
    );
    expect(text).toContain('cannot be pinned');
  });

  it('still hedges independence even in the best case', () => {
    // Two OS handles is not two routes to the Internet. Only the relay can settle that.
    const text = describeCapability(
      [candidate({ handle: 'a', radio: { bssid: 'a' } }), candidate({ handle: 'b', transport: 'cellular', radio: { subscriptionId: 1 } })],
      ABLE,
    );
    expect(text).toContain('Confirmed independent only once the relay');
  });

  it('does not describe one path as bonding', () => {
    expect(describeCapability([candidate()], ABLE)).toContain('single-path');
  });

  it('ignores networks the OS says have no Internet', () => {
    const text = describeCapability(
      [candidate({ handle: 'a', radio: { bssid: 'a' } }), candidate({ handle: 'b', transport: 'cellular', hasInternet: false })],
      ABLE,
    );
    expect(text).toContain('One network path');
  });

  it('has an answer when there is nothing at all', () => {
    expect(describeCapability([], ABLE)).toBe('No network path is available.');
  });
});

describe('the browser', () => {
  it('says the platform forbids it, not that it is unimplemented', () => {
    // "Not built yet" and "impossible here" are different facts and only one can be fixed.
    const caps = browserCapabilities();
    expect(caps.simultaneousPaths).toBe('no');
    expect(caps.canBindPerPath).toBe('no');
    expect(caps.caveats.join(' ')).toContain('cannot enumerate network interfaces');
  });
});

describe('NO_DISCOVERY', () => {
  it('finds nothing and claims nothing', async () => {
    expect(await NO_DISCOVERY.list()).toEqual([]);
    expect(NO_DISCOVERY.capabilities().simultaneousPaths).toBe('unknown');
  });

  it('returns a stop function that is safe to call', () => {
    const stop = NO_DISCOVERY.watch(() => undefined);
    expect(() => stop()).not.toThrow();
  });
});

describe('transportFromInterfaceName', () => {
  it('recognises the usual suspects on each platform', () => {
    expect(transportFromInterfaceName('wlan0')).toBe('wifi');
    expect(transportFromInterfaceName('en1')).toBe('wifi');
    expect(transportFromInterfaceName('rmnet_data0')).toBe('cellular');
    expect(transportFromInterfaceName('eth0')).toBe('ethernet');
    expect(transportFromInterfaceName('en0')).toBe('ethernet');
    expect(transportFromInterfaceName('usb0')).toBe('usb');
    expect(transportFromInterfaceName('rndis0')).toBe('usb');
  });

  it('says other rather than guessing', () => {
    expect(transportFromInterfaceName('tun0')).toBe('other');
    expect(transportFromInterfaceName('utun4')).toBe('other');
    expect(transportFromInterfaceName('')).toBe('other');
  });
});
