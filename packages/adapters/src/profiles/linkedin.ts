import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * LinkedIn Live (Live Events API).
 * Source: docs/research/PLATFORM_X_LINKEDIN_OTHERS.md §2.
 *
 * LinkedIn has a genuinely complete live API — behind a closed partner program with a
 * certification demo, a background check, and terms that do not permit open-source
 * redistribution or self-hosting. Two gates stack: the developer must be admitted to the
 * Live Events API Program, and the end user must independently be approved for LinkedIn Live.
 * Every control-plane capability is therefore PARTNER_APPROVAL_REQUIRED and LIVETAP ships
 * LinkedIn as not-connectable by default.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // 3-legged authorization code; confidential client (secret required)
  // A separate native-pkce authorization endpoint exists but LinkedIn enables it per app on request.
  pkce: 'PARTNER_APPROVAL_REQUIRED',
  broadcastCreation: 'PARTNER_APPROVAL_REQUIRED', // POST /v2/liveVideos
  streamCreation: 'PARTNER_APPROVAL_REQUIRED', // POST /v2/liveAssetActions?action=register
  // The key is embedded in the returned ingestUrls and is fully dynamic. An approved partner
  // can paste a registered ingest URL into a LIVETAP Custom RTMP destination as a workaround.
  streamKey: 'PARTNER_APPROVAL_REQUIRED',
  start: 'PARTNER_APPROVAL_REQUIRED', // ingest, poll the asset, then patch liveVideoAsset
  stop: 'PARTNER_APPROVAL_REQUIRED', // POST /v2/liveAssetActions?action=end
  metadata: 'PARTNER_APPROVAL_REQUIRED',
  thumbnail: 'PARTNER_APPROVAL_REQUIRED',
  chatRead: 'PARTNER_APPROVAL_REQUIRED', // Comments API, and a separate Community Management product
  chatWrite: 'PARTNER_APPROVAL_REQUIRED',
  moderation: 'PARTNER_APPROVAL_REQUIRED',
  analytics: 'PARTNER_APPROVAL_REQUIRED', // videoAnalytics: views/viewers/watch time
  liveStatus: 'PARTNER_APPROVAL_REQUIRED', // liveVideos.state + asset recipe status + contentAccess
  scheduling: 'PARTNER_APPROVAL_REQUIRED', // mandatory since 22 Jun 2026; max 10/day
  vertical916: 'UNAVAILABLE', // Live Ingest Requirements specify 16:9
  rtmps: 'RTMP_DESTINATION', // supported and preferred; TCP 2935/2936, and 443 in newer samples
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

export const linkedinProfile: PlatformProfile = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  connectionSummary:
    'LinkedIn Live needs LIVETAP to be an approved LinkedIn Live Events partner, so it is turned off for now — LIVETAP will not pretend it works.',
  capabilities,
  supportedAspectRatios: ['16:9'],
  preferredAspectRatio: '16:9',
  recommended: {
    // Official Live Ingest Requirements: max 6 Mbps video, 128 kbps audio @48kHz, 1080p30,
    // keyframe every 2 seconds, H.264 + AAC, max 4 hours.
    maxVideoKbps: 6000,
    minVideoKbps: 2500,
    audioKbps: 128,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 30,
    maxHeight: 1080,
  },
  // Academic until the program gate is passed: going live means registering an asset,
  // pushing, polling and patching — not a single start call.
  autoStartsOnIngest: false,
  eligibilityNotes: [
    'LinkedIn Live is only available to developers admitted to the LinkedIn Live Events API Program, which requires a certification demo video and a background check. LIVETAP is not in that program, so this destination is off by default.',
    'Separately, your own account or Page must be approved for LinkedIn Live: more than 150 followers or connections, at least 30 days old, in good standing, and not based in mainland China.',
    'Since 22 June 2026 every LinkedIn Live must be a scheduled event. "Go live now" means scheduling one a minute ahead, with a window from 15 minutes before to 2 hours after, and a limit of 10 per day.',
    'LinkedIn is the most constrained major destination: 16:9, 1080p, 30 fps, 6 Mbps, 4 hours maximum.',
    'Member and organization live permissions cannot be requested together, so a profile and a Page need two separate connections.',
    'The LinkedIn Live Events terms do not permit open-source redistribution or self-hosting, which is a business blocker rather than an engineering one.',
    'If you are already an approved partner, you can register an ingest URL yourself and paste it into a LIVETAP Custom RTMP destination.',
  ],
};
