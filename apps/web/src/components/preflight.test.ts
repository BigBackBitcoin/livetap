/**
 * Pre-flight says one true sentence about why a broadcast cannot start.
 *
 * The case these tests exist for is the second run. Stream keys are deliberately never written to
 * browser storage, so a creator who set up two destinations yesterday opens the app today with
 * both of them listed on the Destinations screen and neither of them able to broadcast. Studio
 * used to answer that with "No destination is ready - add a destination", which is the one piece
 * of advice guaranteed to make it worse: they already have the destination, and following the
 * instruction gives them a duplicate that also has no key.
 */
import { describe, expect, it } from 'vitest';
import type { DestinationSnapshot } from '@livetap/core';

import { evaluatePreflight } from './preflight.js';

function destination(overrides: {
  id: string;
  label: string;
  state?: DestinationSnapshot['state'];
  enabled?: boolean;
  mock?: boolean;
}): DestinationSnapshot {
  return {
    config: {
      id: overrides.id,
      platform: 'custom',
      label: overrides.label,
      aspectRatio: '16:9',
      enabled: overrides.enabled ?? true,
      mock: overrides.mock ?? false,
    },
    state: overrides.state ?? 'DISCONNECTED',
    reconnectAttempt: 0,
    stateChangedAt: 0,
  };
}

const HEALTHY = {
  online: true,
  hasCamera: true,
  hasMic: true,
  micMuted: false,
  recording: false,
};

describe('why nothing is ready', () => {
  it('tells a first-time creator to add a destination', () => {
    const p = evaluatePreflight({ ...HEALTHY, destinations: [] });

    expect(p.level).toBe('red');
    expect(p.items).toHaveLength(1);
    expect(p.items[0]?.id).toBe('no-destination');
    expect(p.items[0]?.fix?.label).toBe('Add a destination');
  });

  it('names the destination whose key did not survive the reload, and does not ask for a new one', () => {
    const youtube = destination({ id: 'd1', label: 'YouTube' });
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [youtube],
      needsKeyIds: new Set(['d1']),
    });

    expect(p.items[0]?.id).toBe('needs-key');
    expect(p.items[0]?.text).toContain('YouTube');
    expect(p.items[0]?.fix?.label).toBe('Paste a new key');
    // The failure this pins: never send someone to create a second copy of what they have.
    expect(p.items[0]?.fix?.label).not.toBe('Add a destination');
  });

  it('counts them when more than one needs a key', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [
        destination({ id: 'd1', label: 'YouTube' }),
        destination({ id: 'd2', label: 'Twitch' }),
      ],
      needsKeyIds: new Set(['d1', 'd2']),
    });

    expect(p.items[0]?.text).toContain('2 destinations');
    expect(p.items[0]?.fix?.label).toBe('Paste the keys');
  });

  it('says it is still connecting rather than blaming the creator for it', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [destination({ id: 'd1', label: 'Twitch', state: 'AUTHENTICATING' })],
    });

    expect(p.items[0]?.id).toBe('connecting');
    expect(p.items[0]?.text).toContain('Twitch');
    // Nothing for them to do, so nothing to offer. A fix link here is a dead end.
    expect(p.items[0]?.fix).toBeUndefined();
  });

  it('points at the switch when every destination is switched off', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [destination({ id: 'd1', label: 'YouTube', enabled: false })],
    });

    expect(p.items[0]?.id).toBe('all-switched-off');
    expect(p.items[0]?.text).toContain('YouTube');
    expect(p.items[0]?.fix?.label).toBe('Switch one back on');
  });

  it('falls back to what happened, not to what to create, when destinations exist but failed', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [
        destination({ id: 'd1', label: 'YouTube', state: 'FAILED' }),
        destination({ id: 'd2', label: 'Twitch', state: 'FAILED' }),
      ],
    });

    expect(p.items[0]?.id).toBe('none-ready');
    expect(p.items[0]?.text).toContain('2 destinations');
    expect(p.items[0]?.fix?.label).toBe('See what happened');
  });

  it('prefers the missing key over every other explanation, because it is the actionable one', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [
        destination({ id: 'd1', label: 'YouTube' }),
        destination({ id: 'd2', label: 'Twitch', state: 'AUTHENTICATING' }),
      ],
      needsKeyIds: new Set(['d1']),
    });

    expect(p.items[0]?.id).toBe('needs-key');
  });

  it('is unaffected once something is ready', () => {
    const p = evaluatePreflight({
      ...HEALTHY,
      destinations: [
        destination({ id: 'd1', label: 'YouTube', state: 'READY' }),
        destination({ id: 'd2', label: 'Twitch' }),
      ],
      needsKeyIds: new Set(['d2']),
    });

    expect(p.level).toBe('green');
    expect(p.readyCount).toBe(1);
  });
});
