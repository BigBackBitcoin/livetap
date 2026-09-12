import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * X (Twitter) live video.
 * Source: docs/research/PLATFORM_X_LINKEDIN_OTHERS.md §1.
 *
 * There is no public API for creating, starting, stopping or reading an X live broadcast.
 * The `broadcast.read` / `broadcast.write` OAuth scopes are grantable but no documented
 * endpoint consumes them — LIVETAP must not request them. Going live means a human creates
 * an RTMP Source in X Live Studio / Media Studio, copies the URL and key, creates a
 * Broadcast, and publishes a Post. Pushing bytes alone does NOT make anything public.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // X API v2 OAuth 2.0 exists, but is irrelevant to going live
  pkce: 'OAUTH_API', // authorization code + PKCE is the only supported grant
  broadcastCreation: 'USER_ASSISTED', // created in the Live Studio UI
  streamCreation: 'USER_ASSISTED', // "Create Source" in the Studio UI
  streamKey: 'USER_ASSISTED', // human copies URL + key from the Studio
  start: 'USER_ASSISTED', // ingest alone does not go live; the human starts the broadcast
  stop: 'USER_ASSISTED',
  metadata: 'USER_ASSISTED', // title/description/audience set in the Studio
  thumbnail: 'USER_ASSISTED',
  chatRead: 'UNAVAILABLE', // native live chat has no API (Post replies are a different surface)
  chatWrite: 'UNAVAILABLE',
  moderation: 'UNAVAILABLE',
  analytics: 'USER_ASSISTED', // concurrents/watch time are visible in Live Studio only
  liveStatus: 'UNAVAILABLE', // no API reports whether a broadcast is live
  scheduling: 'USER_ASSISTED',
  vertical916: 'UNAVAILABLE', // 16:9 documented; other ratios are cropped in the broadcast card
  rtmps: 'RTMP_DESTINATION', // sources conflict on RTMP vs RTMPS — the pasted URL decides
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

export const xProfile: PlatformProfile = {
  id: 'x',
  displayName: 'X',
  connectionSummary:
    'Create an RTMP source in X Live Studio, paste its URL and key here, then start the broadcast on X — pushing video alone does not make you live.',
  capabilities,
  supportedAspectRatios: ['16:9'],
  preferredAspectRatio: '16:9',
  recommended: {
    // Secondary sources only: 1280x720 @30/60 or 1920x1080 @30, ~9 Mbps, AAC-LC <=128 kbps.
    maxVideoKbps: 9000,
    minVideoKbps: 2500,
    audioKbps: 128,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 60, // 1080p60 is not offered; 720p60 is
    maxHeight: 1080,
  },
  // X never auto-publishes on ingest — a human must start the broadcast in the Studio.
  autoStartsOnIngest: false,
  eligibilityNotes: [
    'X Premium or Premium+ is required to reach Live Studio and obtain a stream key. LIVETAP cannot provision this for you and cannot check it.',
    'X does NOT go live automatically when video arrives. You must create the broadcast in X Live Studio, start it there, and publish the Post — otherwise nobody sees your stream.',
    'X Live Studio is desktop-only and rolled out to selected regions.',
    'X publishes no live API at all: LIVETAP cannot create, start, stop, read chat from, or report the status of an X broadcast. The broadcast.read / broadcast.write scopes exist but no endpoint uses them, so LIVETAP never requests them.',
    'Replies to the announcement Post are readable through the paid X API, but they are a different surface from Live Studio chat and cost money per read — LIVETAP leaves that off by default.',
    'X live is 16:9. Other aspect ratios are cropped in the broadcast card.',
  ],
};
