import type { PlatformId, PlatformProfile } from '@livetap/core';
import { youtubeProfile } from './youtube.js';
import { twitchProfile } from './twitch.js';
import { kickProfile } from './kick.js';
import { facebookProfile } from './facebook.js';
import { instagramProfile } from './instagram.js';
import { tiktokProfile } from './tiktok.js';
import { xProfile } from './x.js';
import { linkedinProfile } from './linkedin.js';
import { customProfile } from './custom.js';

export { youtubeProfile } from './youtube.js';
export { twitchProfile } from './twitch.js';
export { kickProfile } from './kick.js';
export { facebookProfile } from './facebook.js';
export { instagramProfile } from './instagram.js';
export { tiktokProfile } from './tiktok.js';
export { xProfile } from './x.js';
export { linkedinProfile } from './linkedin.js';
export { customProfile } from './custom.js';

/**
 * Honest platform profiles, one per PlatformId.
 *
 * These are the single source of truth for what LIVETAP is allowed to claim in the UI:
 * every affordance must be gated on `isAutomated(profile.capabilities[key])`
 * (see docs/architecture/DESTINATION_ADAPTERS.md).
 */
export const PLATFORM_PROFILES: Record<PlatformId, PlatformProfile> = {
  youtube: youtubeProfile,
  twitch: twitchProfile,
  kick: kickProfile,
  facebook: facebookProfile,
  instagram: instagramProfile,
  tiktok: tiktokProfile,
  x: xProfile,
  linkedin: linkedinProfile,
  custom: customProfile,
};

export function getProfile(id: PlatformId): PlatformProfile {
  return PLATFORM_PROFILES[id];
}

/** Same profile, marked as a mock so it can never masquerade as production. */
export function mockProfile(id: PlatformId): PlatformProfile {
  return { ...PLATFORM_PROFILES[id], mock: true };
}
