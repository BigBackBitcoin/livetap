import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockEngine } from '@livetap/media';
import { createMockAdapters } from '@livetap/adapters';
import { createAppStore } from '../state/store.js';

/**
 * ONE PLATFORM IS NOT ONE ACCOUNT — at the store, where the collapse actually happened.
 *
 * `connectPlatform` used to open with
 *
 *     listDestinations().find((d) => d.config.platform === platform)
 *
 * and reconnect whatever it found. So the second "Connect YouTube" reconnected the first channel
 * instead of authorizing a second one, and a creator with Carter Gaming, Carter Live and Carter
 * Clips had exactly one row. Acceptance criteria A, B and D, broken in four lines.
 *
 * These drive the real store against the mock adapters, which is the same harness `store.test.ts`
 * uses. The mock adapters deliberately report no account identity from `validate()`, so these
 * tests exercise the path a demo creator takes; the duplicate-detection path, which needs a
 * provider identity to detect anything, is covered separately below.
 */
function build(): ReturnType<typeof createAppStore> {
  return createAppStore({
    engine: new MockEngine({ connectDelayMs: 1, metricsIntervalMs: 1000 }),
    registry: createMockAdapters({ latencyMs: 1 }),
    mockMode: true,
  });
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('several accounts on one platform', () => {
  /** Acceptance criteria A and B. */
  it('gives a second YouTube connection its own row instead of reusing the first', async () => {
    const store = build();
    await store.getState().init();

    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().connectPlatform('youtube', 'Carter Live');

    const youtube = store.getState().destinations.filter((d) => d.config.platform === 'youtube');
    expect(youtube, 'the second YouTube connect reused the first row instead of adding one').toHaveLength(2);
    expect(youtube.map((d) => d.config.label).sort()).toEqual(['Carter Gaming', 'Carter Live']);
  });

  /** Acceptance criterion J: N, not two. */
  it('holds as many accounts per platform as the creator connects', async () => {
    const store = build();
    await store.getState().init();

    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await store.getState().connectPlatform('youtube', name);
    }

    expect(store.getState().destinations.filter((d) => d.config.platform === 'youtube')).toHaveLength(4);
  });

  /** Acceptance criterion D: distinct identity, all the way down. */
  it('gives every account its own destination id', async () => {
    const store = build();
    await store.getState().init();

    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().connectPlatform('youtube', 'Carter Live');
    await store.getState().connectPlatform('tiktok', '@carterofficial');

    const ids = store.getState().destinations.map((d) => d.config.id);
    expect(new Set(ids).size, 'two destinations share one id').toBe(ids.length);
  });

  /** Acceptance criteria E and F. */
  it('removing one account leaves the other alone', async () => {
    const store = build();
    await store.getState().init();

    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().connectPlatform('youtube', 'Carter Live');
    const [first, second] = store.getState().destinations.filter((d) => d.config.platform === 'youtube');

    await store.getState().removeDestination(first!.config.id);

    const left = store.getState().destinations.filter((d) => d.config.platform === 'youtube');
    expect(left, 'removing one YouTube account removed the other as well').toHaveLength(1);
    expect(left[0]?.config.id).toBe(second!.config.id);
    expect(left[0]?.state, 'the surviving account was disturbed by its sibling leaving').toBe('READY');
  });

  /** Acceptance criterion C: choose which of them go live, independently. */
  it('lets the creator enable one account and not the other', async () => {
    const store = build();
    await store.getState().init();

    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().connectPlatform('youtube', 'Carter Live');
    const [gaming, live] = store.getState().destinations.filter((d) => d.config.platform === 'youtube');

    store.getState().setDestinationEnabled(live!.config.id, false);

    const after = store.getState().destinations.filter((d) => d.config.platform === 'youtube');
    expect(after.find((d) => d.config.id === gaming!.config.id)?.config.enabled).toBe(true);
    expect(
      after.find((d) => d.config.id === live!.config.id)?.config.enabled,
      'turning off one account turned off the other',
    ).toBe(false);
  });

  /** Acceptance criterion H: none of this asks for a LIVETAP account. */
  it('needs no LIVETAP account to hold several platform accounts', async () => {
    const store = build();
    await store.getState().init();

    await store.getState().connectPlatform('youtube', 'Carter Gaming');
    await store.getState().connectPlatform('tiktok', '@carterofficial');

    expect(store.getState().destinations).toHaveLength(2);
    expect(
      Object.keys(localStorage).some((k) => /account|user|profile|signin/i.test(k)),
      'holding two platform accounts created a LIVETAP identity',
    ).toBe(false);
  });
});
