import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * TikTok LIVE.
 * Source: docs/research/PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md §3.
 *
 * There is no public TikTok LIVE API for third parties: no live product, no live scope, no
 * live webhook event. A keyless go-live exists for approved partners only. LIVETAP therefore
 * treats TikTok as a paste-the-stream-key destination and ships no TikTok chat integration
 * (the unofficial reverse-engineered Webcast clients are a ToS and stability risk we refuse
 * to export onto users).
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // Login Kit exists — but grants identity/video scopes only, nothing live
  pkce: 'OAUTH_API', // required for desktop; note TikTok wants the SHA-256 hex-encoded, not base64url
  broadcastCreation: 'UNAVAILABLE', // no public endpoint; keyless go-live is partner-only
  streamCreation: 'UNAVAILABLE',
  streamKey: 'USER_ASSISTED', // copied from TikTok LIVE Studio / livecenter.tiktok.com/producer
  start: 'USER_ASSISTED', // the human presses "Go LIVE"
  stop: 'USER_ASSISTED',
  metadata: 'USER_ASSISTED', // title + category entered in TikTok's UI before the key is issued
  thumbnail: 'UNAVAILABLE',
  chatRead: 'UNAVAILABLE', // no API and no webhook; unofficial clients are not an option we ship
  chatWrite: 'UNAVAILABLE',
  moderation: 'UNAVAILABLE',
  analytics: 'UNAVAILABLE', // no live viewer count, no gift/diamond API
  liveStatus: 'UNAVAILABLE', // no documented way to ask "is this user live?"
  scheduling: 'UNAVAILABLE',
  vertical916: 'RTMP_DESTINATION', // 1080x1920 portrait is the native format
  rtmps: 'RTMP_DESTINATION', // the UI may issue rtmp:// or rtmps:// — use whatever it shows
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

export const tiktokProfile: PlatformProfile = {
  id: 'tiktok',
  displayName: 'TikTok',
  connectionSummary:
    'Paste your stream key from TikTok LIVE Studio — TikTok has no public live API.',
  capabilities,
  supportedAspectRatios: ['9:16'],
  preferredAspectRatio: '9:16',
  recommended: {
    // UNVERIFIED: no official TikTok encoder spec page was retrievable. Secondary sources
    // agree on ~2,000-4,500 Kbps at 1080x1920/30fps, with no benefit above ~5,000 Kbps.
    maxVideoKbps: 4500,
    minVideoKbps: 2000,
    audioKbps: 160,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 30, // viewer playback is reported to be capped at 30 fps
    maxHeight: 1920,
  },
  // You confirm and end the broadcast in TikTok's own dashboard.
  autoStartsOnIngest: false,
  eligibilityNotes: [
    'TikTok LIVE access is granted by TikTok, not by LIVETAP. It is commonly reported to need at least 1,000 followers, and 18+ for the stream-key path, and requirements vary by country.',
    'If your account has no LIVE access, no stream key exists at all — no amount of clicking will produce one.',
    'TikTok issues a new stream key every session, so LIVETAP never stores it.',
    'You start and end the broadcast in TikTok\'s dashboard. LIVETAP only pushes the video.',
    'TikTok has no public live chat, moderation, viewer-count or live-status API, so LIVETAP shows none of those for TikTok. Tools that read TikTok chat do so by reverse-engineering TikTok\'s internal service, which risks your account — LIVETAP will not bundle that.',
    'Some other multistreaming tools go live to TikTok without a stream key because they hold a private partner integration. That is a partner-access difference, not a LIVETAP bug.',
    'TikTok LIVE is vertical: LIVETAP defaults this destination to a 9:16 canvas.',
  ],
};
