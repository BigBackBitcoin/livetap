import { describe, expect, it } from 'vitest';
import { CustomRtmpAdapter, PLATFORM_PROFILES } from '@livetap/adapters';
import type { PlatformId } from '@livetap/core';
import { createRegistry } from '../state/registry.js';

/**
 * The registry is where "can LIVETAP broadcast to this platform at all?" is answered, and the
 * answer has to stay true of the build that is actually running.
 *
 * The state these tests are mostly about is the one every build is in until somebody registers
 * an OAuth client: nothing configured. That used to mean YouTube, Twitch, Facebook and Kick had
 * no adapter at all and failed at connect. It now means they get the real custom-RTMP adapter
 * wearing their own profile, which is exactly what the platform hands a creator on its own page.
 */
type ConfigBody = { platforms?: Record<string, { configured: boolean; clientId?: string }> };

function fetchReturning(body: ConfigBody | null): typeof fetch {
  return (async () => {
    if (body === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

const ALL_PASTE: PlatformId[] = ['youtube', 'twitch', 'facebook', 'kick', 'instagram', 'tiktok', 'x'];

describe('createRegistry with nothing configured', () => {
  it('gives every priority platform a paste path, and says none of them is connectable', async () => {
    const choice = await createRegistry({ mockMode: false, fetchImpl: fetchReturning({ platforms: {} }) });

    expect(choice.kind).toBe('real');
    expect(choice.connectable).toEqual([]);
    expect([...choice.pasteOnly].sort()).toEqual([...ALL_PASTE].sort());

    for (const platform of ALL_PASTE) {
      const adapter = choice.registry.get(platform);
      expect(adapter, platform).toBeInstanceOf(CustomRtmpAdapter);
      // Real, not mock: this destination puts real bytes on a real wire.
      expect(adapter?.profile.mock, platform).toBeUndefined();
    }
    // The generic destination is always there too.
    expect(choice.registry.get('custom')).toBeInstanceOf(CustomRtmpAdapter);
  });

  it('keeps each platform wearing its own profile, so none of them claims another one\'s shape', async () => {
    const choice = await createRegistry({ mockMode: false, fetchImpl: fetchReturning({ platforms: {} }) });

    const instagram = choice.registry.get('instagram');
    expect(instagram?.profile.id).toBe('instagram');
    expect(instagram?.profile.supportedAspectRatios).toEqual(['9:16']);
    expect(instagram?.profile.supportedAspectRatios).not.toContain('16:9');
    expect(instagram?.profile).toBe(PLATFORM_PROFILES.instagram);

    const youtube = choice.registry.get('youtube');
    expect(youtube?.profile.id).toBe('youtube');
    expect(youtube?.profile.supportedAspectRatios).toContain('16:9');
    expect(youtube?.profile.recommended.maxVideoKbps).toBe(
      PLATFORM_PROFILES.youtube.recommended.maxVideoKbps,
    );
  });

  it('never offers a paste path for LinkedIn, which never shows a member a key', async () => {
    const choice = await createRegistry({ mockMode: false, fetchImpl: fetchReturning({ platforms: {} }) });
    expect(choice.registry.get('linkedin')).toBeUndefined();
    expect(choice.pasteOnly).not.toContain('linkedin');
  });

  it('falls back to paste when the broker cannot be reached at all', async () => {
    const choice = await createRegistry({ mockMode: false, fetchImpl: fetchReturning(null) });
    expect(choice.connectable).toEqual([]);
    expect([...choice.pasteOnly].sort()).toEqual([...ALL_PASTE].sort());
  });

  it('falls back to paste on a build with no fetch at all', async () => {
    // A surface with no `fetch` can reach no platform API, so nothing is connectable — but the
    // paste path needs no network to be registered, and must still be complete.
    const original = globalThis.fetch;
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    try {
      const choice = await createRegistry({ mockMode: false });
      expect(choice.connectable).toEqual([]);
      expect([...choice.pasteOnly].sort()).toEqual([...ALL_PASTE].sort());
      expect(choice.registry.get('custom')).toBeInstanceOf(CustomRtmpAdapter);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('createRegistry with a configured client', () => {
  it('keeps the real API adapter and does NOT downgrade that platform to paste', async () => {
    const choice = await createRegistry({
      mockMode: false,
      fetchImpl: fetchReturning({
        platforms: {
          youtube: { configured: true, clientId: 'yt-client' },
          twitch: { configured: true, clientId: 'tw-client' },
        },
      }),
    });

    expect(choice.connectable.sort()).toEqual(['twitch', 'youtube']);
    expect(choice.pasteOnly).not.toContain('youtube');
    expect(choice.pasteOnly).not.toContain('twitch');

    const youtube = choice.registry.get('youtube');
    expect(youtube).not.toBeInstanceOf(CustomRtmpAdapter);
    // The API path is the one where the creator never sees a stream key.
    expect(youtube?.supports('broadcastCreation')).toBe(true);

    const twitch = choice.registry.get('twitch');
    expect(twitch).not.toBeInstanceOf(CustomRtmpAdapter);

    // The platforms nobody configured still fall back.
    expect(choice.registry.get('facebook')).toBeInstanceOf(CustomRtmpAdapter);
    expect(choice.pasteOnly).toContain('facebook');
    expect(choice.pasteOnly).toContain('kick');
  });

  it('hands Twitch to the paste path when it is configured without a client id', async () => {
    // Helix refuses every request without Client-Id, so a Twitch adapter with no client id can
    // only fail. It must not be reported as connectable, and it must not be left with nothing.
    const choice = await createRegistry({
      mockMode: false,
      fetchImpl: fetchReturning({ platforms: { twitch: { configured: true } } }),
    });

    expect(choice.connectable).toEqual([]);
    expect(choice.pasteOnly).toContain('twitch');
    expect(choice.registry.get('twitch')).toBeInstanceOf(CustomRtmpAdapter);
    expect(choice.registry.get('twitch')?.profile.id).toBe('twitch');
  });

  it('reports a platform with no API adapter as paste-only even when the broker lists it', async () => {
    // Instagram, TikTok and X have OAuth that grants no live capability. "configured" for them
    // can never mean "LIVETAP can sign you in and go live".
    const choice = await createRegistry({
      mockMode: false,
      fetchImpl: fetchReturning({
        platforms: { instagram: { configured: true, clientId: 'ig' }, x: { configured: true } },
      }),
    });

    expect(choice.connectable).toEqual([]);
    expect(choice.pasteOnly).toContain('instagram');
    expect(choice.pasteOnly).toContain('x');
    expect(choice.registry.get('instagram')).toBeInstanceOf(CustomRtmpAdapter);
  });
});

describe('createRegistry in mock mode', () => {
  it('still gives mock adapters for the account platforms, so CI is unchanged', async () => {
    const choice = await createRegistry({ mockMode: true });
    expect(choice.kind).toBe('mock');
    expect(choice.connectable).toEqual([]);
    expect(choice.pasteOnly).toEqual([]);
    for (const platform of ['youtube', 'twitch', 'kick', 'facebook'] as const) {
      const adapter = choice.registry.get(platform);
      expect(adapter, platform).toBeDefined();
      expect(adapter, platform).not.toBeInstanceOf(CustomRtmpAdapter);
      expect(adapter?.profile.mock, platform).toBe(true);
    }
  });

  it('defaults to mock mode, because the honest answer without evidence is "no"', async () => {
    const choice = await createRegistry();
    expect(choice.kind).toBe('mock');
  });
});
