import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * Instagram Live.
 * Source: docs/research/PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md §2.
 *
 * There is no public API to create, start, stop or manage an Instagram Live. The only live
 * surfaces are read-only (`live_media`, the `live_comments` webhook). Going live from an
 * encoder means the human opens Instagram Live Producer on instagram.com, copies a
 * single-use stream key, and presses "Go live" themselves.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // Instagram Business Login — useful for comments/status only, never for going live
  pkce: 'UNAVAILABLE', // not mentioned in the business-login docs; client_secret is required
  broadcastCreation: 'UNAVAILABLE', // live_media states explicitly: creating is not supported
  streamCreation: 'UNAVAILABLE',
  streamKey: 'USER_ASSISTED', // copied from Live Producer; rotates every session
  start: 'USER_ASSISTED', // the human presses "Go live" in Live Producer
  stop: 'USER_ASSISTED', // ended in Live Producer
  metadata: 'USER_ASSISTED', // title and audience are typed into Live Producer before the key is issued
  thumbnail: 'UNAVAILABLE',
  // live_comments arrives only as a webhook to a public HTTPS endpoint, only during the
  // broadcast, with no backfill — a desktop LIVETAP cannot receive it.
  chatRead: 'UNAVAILABLE',
  chatWrite: 'UNAVAILABLE', // replying to a live comment via API is UNVERIFIED
  moderation: 'UNAVAILABLE', // "Moderation is not supported by Live Producer at this time."
  analytics: 'UNAVAILABLE', // no live insights metric, no viewer count
  // GET /{ig-user-id}/live_media returns media only while broadcasting: a crude "am I live?"
  // probe that needs OAuth + App Review and has unverified propagation delay.
  liveStatus: 'EXPERIMENTAL',
  scheduling: 'UNAVAILABLE',
  vertical916: 'RTMP_DESTINATION', // 9:16 at 720x1280 is the recommended native format
  rtmps: 'RTMP_DESTINATION', // Live Producer issues the URL; the scheme is whatever it shows
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

export const instagramProfile: PlatformProfile = {
  id: 'instagram',
  displayName: 'Instagram',
  connectionSummary:
    'Paste the URL and stream key from Instagram Live Producer on instagram.com, then press "Go live" there — Instagram has no public live API.',
  capabilities,
  supportedAspectRatios: ['9:16'],
  preferredAspectRatio: '9:16',
  recommended: {
    // Official Instagram Live Producer post: 720x1280 @ 30 fps, 2,250-6,000 Kbps.
    maxVideoKbps: 6000,
    minVideoKbps: 2250,
    audioKbps: 128, // 44.1 kHz stereo, up to 256 Kbps
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 60, // 30 fps recommended, 60 fps supported
    maxHeight: 1280,
  },
  // Instagram does not publish the stream on ingest: the user must press "Go live".
  // LIVETAP cannot do that step, so it shows the destination as awaiting confirmation.
  autoStartsOnIngest: false,
  eligibilityNotes: [
    'Instagram requires a public account with at least 1,000 followers to create a live video.',
    'Instagram Live Producer is desktop-web only and Instagram describes it as "limited access at this time" — some accounts have no Live option at all.',
    'The Instagram stream key changes every session. LIVETAP never stores it; paste a fresh one before each broadcast.',
    'You must press "Go live" in Live Producer yourself, and end the broadcast there. LIVETAP only pushes the video.',
    'Instagram publishes no live chat API, no moderation and no viewer count, so LIVETAP shows none of those for Instagram.',
    'Instagram Live is vertical: LIVETAP defaults this destination to a 9:16 canvas.',
  ],
};
