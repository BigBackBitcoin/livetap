import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KEYS,
  CAPABILITY_CLASSES,
  PLATFORM_IDS,
  isAutomated,
  type CapabilityKey,
} from '@livetap/core';
import { PLATFORM_PROFILES, getProfile, mockProfile } from './index.js';
import { createMockAdapters } from '../mock/index.js';

describe('platform profiles', () => {
  it('has exactly one profile per PlatformId, keyed by its own id', () => {
    expect(Object.keys(PLATFORM_PROFILES).sort()).toEqual([...PLATFORM_IDS].sort());
    for (const id of PLATFORM_IDS) {
      expect(getProfile(id).id).toBe(id);
    }
  });

  it.each(PLATFORM_IDS)('%s declares every capability key with a known class', (id) => {
    const profile = getProfile(id);
    const keys = Object.keys(profile.capabilities).sort();
    expect(keys).toEqual([...CAPABILITY_KEYS].sort());
    for (const key of CAPABILITY_KEYS) {
      expect(CAPABILITY_CLASSES).toContain(profile.capabilities[key]);
    }
  });

  it.each(PLATFORM_IDS)('%s has honest, complete presentation fields', (id) => {
    const profile = getProfile(id);
    expect(profile.displayName.length).toBeGreaterThan(0);
    expect(profile.connectionSummary.length).toBeGreaterThan(10);
    expect(profile.eligibilityNotes.length).toBeGreaterThan(0);
    for (const note of profile.eligibilityNotes) expect(note.length).toBeGreaterThan(10);
    expect(profile.supportedAspectRatios.length).toBeGreaterThan(0);
    expect(profile.supportedAspectRatios).toContain(profile.preferredAspectRatio);
    expect(new Set(profile.supportedAspectRatios).size).toBe(profile.supportedAspectRatios.length);
    // Real profiles are never marked as mocks.
    expect(profile.mock).toBeUndefined();
  });

  it.each(PLATFORM_IDS)('%s has internally consistent encoder recommendations', (id) => {
    const { recommended } = getProfile(id);
    expect(recommended.minVideoKbps).toBeGreaterThan(0);
    expect(recommended.maxVideoKbps).toBeGreaterThanOrEqual(recommended.minVideoKbps);
    expect(recommended.audioKbps).toBeGreaterThan(0);
    expect(recommended.keyframeIntervalSeconds).toBeGreaterThan(0);
    expect(recommended.keyframeIntervalSeconds).toBeLessThanOrEqual(4);
    expect(recommended.codecs.length).toBeGreaterThan(0);
    expect(recommended.maxFps).toBeGreaterThanOrEqual(30);
    expect(recommended.maxHeight).toBeGreaterThanOrEqual(720);
  });

  it('never claims an automated capability without a way to deliver it', () => {
    for (const id of PLATFORM_IDS) {
      const caps = getProfile(id).capabilities;
      // Writing chat implies reading it is at least attempted somewhere, but the reverse is
      // not true. What must never happen: claiming automated start/stop without any ingest.
      if (isAutomated(caps.start)) {
        const hasIngest =
          isAutomated(caps.streamKey) ||
          caps.streamKey === 'USER_ASSISTED' ||
          isAutomated(caps.rtmps);
        expect(hasIngest, `${id} claims automated start with no ingest path`).toBe(true);
      }
    }
  });

  it('matches the research on the platforms with the biggest honesty risk', () => {
    // TikTok: no public live API at all.
    const tiktok = getProfile('tiktok');
    expect(tiktok.capabilities.broadcastCreation).toBe('UNAVAILABLE');
    expect(tiktok.capabilities.streamKey).toBe('USER_ASSISTED');
    expect(tiktok.capabilities.chatRead).toBe('UNAVAILABLE');
    expect(tiktok.supportedAspectRatios).toEqual(['9:16']);

    // Instagram: read-only surfaces, key pasted from Live Producer, vertical native.
    const instagram = getProfile('instagram');
    expect(instagram.capabilities.streamKey).toBe('USER_ASSISTED');
    expect(instagram.capabilities.broadcastCreation).toBe('UNAVAILABLE');
    expect(instagram.capabilities.vertical916).toBe('RTMP_DESTINATION');

    // Facebook: real API, but gated behind App Review + Business Verification.
    const facebook = getProfile('facebook');
    expect(facebook.capabilities.broadcastCreation).toBe('OAUTH_API');
    expect(facebook.autoStartsOnIngest).toBe(true);
    expect(facebook.eligibilityNotes.join(' ')).toMatch(/Business Verification/i);

    // Twitch: no PKCE (device code grant instead), implicit go-live.
    const twitch = getProfile('twitch');
    expect(twitch.capabilities.pkce).toBe('UNAVAILABLE');
    expect(twitch.autoStartsOnIngest).toBe(true);
    expect(twitch.capabilities.streamKey).toBe('NATIVE_API');

    // Kick: PKCE but a secret is still required; chat read is webhook-only.
    const kick = getProfile('kick');
    expect(kick.capabilities.pkce).toBe('OAUTH_API');
    expect(kick.capabilities.chatRead).toBe('UNAVAILABLE');
    expect(kick.capabilities.streamKey).toBe('USER_ASSISTED');
    expect(kick.eligibilityNotes.join(' ')).toMatch(/client secret/i);

    // YouTube: the only full lifecycle, and the only explicit start.
    const youtube = getProfile('youtube');
    expect(youtube.capabilities.broadcastCreation).toBe('NATIVE_API');
    expect(youtube.capabilities.start).toBe('NATIVE_API');
    expect(youtube.autoStartsOnIngest).toBe(false);

    // X: user-assisted end to end, and no live chat API.
    const x = getProfile('x');
    expect(x.capabilities.broadcastCreation).toBe('USER_ASSISTED');
    expect(x.capabilities.chatRead).toBe('UNAVAILABLE');
    expect(x.capabilities.liveStatus).toBe('UNAVAILABLE');

    // LinkedIn: partner-gated across the board.
    const linkedin = getProfile('linkedin');
    expect(linkedin.capabilities.broadcastCreation).toBe('PARTNER_APPROVAL_REQUIRED');
    expect(linkedin.capabilities.vertical916).toBe('UNAVAILABLE');

    // Custom: bytes only.
    const custom = getProfile('custom');
    expect(custom.capabilities.oauth).toBe('UNAVAILABLE');
    expect(custom.capabilities.srt).toBe('RTMP_DESTINATION');
    expect(custom.capabilities.whip).toBe('RTMP_DESTINATION');
  });

  it('marks mock profiles as mocks without changing any capability', () => {
    for (const id of PLATFORM_IDS) {
      const mocked = mockProfile(id);
      expect(mocked.mock).toBe(true);
      expect(mocked.capabilities).toEqual(getProfile(id).capabilities);
    }
  });
});

describe('mock adapters agree with their profiles', () => {
  const registry = createMockAdapters({ latencyMs: 0 });

  it('registers one adapter per platform', () => {
    expect(registry.list()).toHaveLength(PLATFORM_IDS.length);
    for (const id of PLATFORM_IDS) expect(registry.get(id)?.profile.id).toBe(id);
  });

  it.each(PLATFORM_IDS)('%s mock supports() exactly mirrors the capability matrix', (id) => {
    const adapter = registry.get(id);
    expect(adapter).toBeDefined();
    if (!adapter) return;
    expect(adapter.profile.mock).toBe(true);
    for (const key of CAPABILITY_KEYS as readonly CapabilityKey[]) {
      expect(adapter.supports(key)).toBe(isAutomated(getProfile(id).capabilities[key]));
    }
  });
});
