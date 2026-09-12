/**
 * Honest platform status, derived from the capability matrix — never hand-written.
 *
 * PRODUCT_SPEC tenet 8: the UI says what the platform actually does. There are exactly three
 * answers, and each one is read off `profile.capabilities.streamKey`, because that capability
 * decides whether LIVETAP can obtain an ingest target on the user's behalf.
 *
 * The one-line summary is *derived* rather than taken from `profile.connectionSummary`
 * verbatim. The profiles are engineering documentation and are written in protocol terms, which
 * Simple mode may never show (PRODUCT_SPEC §6.2). So Simple gets a sentence generated from the
 * same capability values the profile encodes, and the profile's own prose stays available as
 * `details` for Pro mode, where that vocabulary belongs. Both come from one source of truth, so
 * neither can drift from what the adapters can actually do.
 */
import { PLATFORM_PROFILES } from '@livetap/adapters';
import type { CapabilityClass, PlatformId, PlatformProfile } from '@livetap/core';
import { COPY } from './copy.js';

export type ConnectMethod = 'account' | 'key' | 'unavailable';

export interface PlatformStatus {
  id: PlatformId;
  profile: PlatformProfile;
  method: ConnectMethod;
  /** The button/badge label a user reads. */
  actionLabel: string;
  /** Badge tone. Colour is never the only carrier — the label always ships with it. */
  tone: 'success' | 'info' | 'neutral';
  /** One honest line under the platform name, safe for Simple mode. */
  summary: string;
  /** True when nothing the user does here can produce a broadcast. */
  blocked: boolean;
  /** Why it is blocked, for `aria-describedby`. */
  blockedReason?: string;
  /** The platform's own notes, in the platform's own terms. Pro mode only. */
  details: readonly string[];
}

function methodFor(cls: CapabilityClass): ConnectMethod {
  switch (cls) {
    case 'NATIVE_API':
    case 'OAUTH_API':
    case 'RTMP_DESTINATION':
      return 'account';
    case 'USER_ASSISTED':
    case 'EXPERIMENTAL':
      return 'key';
    default:
      return 'unavailable';
  }
}

export function platformStatus(id: PlatformId): PlatformStatus {
  const profile = PLATFORM_PROFILES[id];
  const method = id === 'custom' ? 'key' : methodFor(profile.capabilities.streamKey);
  const blocked = method === 'unavailable';
  const base: PlatformStatus = {
    id,
    profile,
    method,
    actionLabel:
      method === 'account' ? COPY.connectAccount : method === 'key' ? COPY.pasteKey : COPY.notAvailable,
    tone: method === 'account' ? 'success' : method === 'key' ? 'info' : 'neutral',
    summary: summaryFor(profile, method),
    blocked,
    details: profile.eligibilityNotes,
  };
  if (blocked) base.blockedReason = blockedReasonFor(profile);
  return base;
}

/** A beginner sentence, generated from what the capability matrix says is true. */
function summaryFor(profile: PlatformProfile, method: ConnectMethod): string {
  const name = profile.displayName;
  if (method === 'unavailable') {
    return `${name} does not let an app like LIVETAP go live for you, so LIVETAP will not pretend it can.`;
  }
  const manualStart = profile.capabilities.start === 'USER_ASSISTED';
  const vertical = profile.supportedAspectRatios.includes('9:16');
  const onlyVertical = vertical && profile.supportedAspectRatios.length === 1;

  if (method === 'account') {
    const base = `Sign in once and LIVETAP sets the broadcast up for you.`;
    return manualStart ? `${base} You press Go live in ${name} when LIVETAP is sending.` : base;
  }

  const base = `Copy a key from ${name}'s own live dashboard and paste it here.`;
  const start = manualStart ? ` You press Go live in ${name} once LIVETAP is sending.` : '';
  const shape = onlyVertical ? ` ${name} is vertical, so LIVETAP sends it a vertical picture.` : '';
  return `${base}${start}${shape}`;
}

/**
 * Why a blocked platform is blocked — the first thing that is actually true about it, in plain
 * words. `eligibilityNotes` are the platform's own terms and can carry protocol vocabulary, so
 * they stay in Pro mode.
 */
function blockedReasonFor(profile: PlatformProfile): string {
  return `${profile.displayName} only allows approved partner tools to go live. LIVETAP is not one, and would rather say so than waste your evening.`;
}

/** Every platform, in the order onboarding and the add sheet present them. */
export const PLATFORM_ORDER: readonly PlatformId[] = [
  'youtube',
  'twitch',
  'tiktok',
  'kick',
  'facebook',
  'instagram',
  'x',
  'linkedin',
  'custom',
];

export function allPlatformStatuses(): PlatformStatus[] {
  return PLATFORM_ORDER.map(platformStatus);
}
