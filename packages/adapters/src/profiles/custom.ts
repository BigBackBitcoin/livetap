import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * Custom destination: any RTMP/RTMPS/SRT/WHIP endpoint the user supplies.
 * No control plane, no OAuth, no chat — just bytes to a URL the user owns.
 *
 * This is also the escape hatch for platforms LIVETAP has no adapter for, and for
 * partner-only surfaces (e.g. an approved LinkedIn partner pasting a registered ingest URL).
 */
const capabilities: CapabilityMatrix = {
  oauth: 'UNAVAILABLE',
  pkce: 'UNAVAILABLE',
  broadcastCreation: 'RTMP_DESTINATION', // "creating" means returning the configured ingest
  streamCreation: 'RTMP_DESTINATION',
  streamKey: 'USER_ASSISTED', // the user pastes URL + key
  start: 'RTMP_DESTINATION', // starts when the server accepts the publish
  stop: 'RTMP_DESTINATION', // stop pushing
  metadata: 'UNAVAILABLE',
  thumbnail: 'UNAVAILABLE',
  chatRead: 'UNAVAILABLE',
  chatWrite: 'UNAVAILABLE',
  moderation: 'UNAVAILABLE',
  analytics: 'UNAVAILABLE',
  liveStatus: 'UNAVAILABLE', // only the sender knows whether bytes are flowing
  scheduling: 'UNAVAILABLE',
  vertical916: 'RTMP_DESTINATION', // whatever the server accepts
  rtmps: 'RTMP_DESTINATION',
  srt: 'RTMP_DESTINATION',
  whip: 'RTMP_DESTINATION',
};

export const customProfile: PlatformProfile = {
  id: 'custom',
  displayName: 'Custom RTMP',
  connectionSummary:
    'Paste any stream URL and key — LIVETAP just sends video there and cannot see anything else about it.',
  capabilities,
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  preferredAspectRatio: '16:9',
  recommended: {
    // Conservative, widely safe defaults; the user's server decides the real limits.
    maxVideoKbps: 8000,
    minVideoKbps: 1500,
    audioKbps: 160,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 60,
    maxHeight: 1080,
  },
  autoStartsOnIngest: true,
  eligibilityNotes: [
    'LIVETAP has no way to check a custom destination before you go live, so double-check the URL and key.',
    'Nothing but video leaves LIVETAP for a custom destination: no title, no chat, no viewer count, no live status.',
    'RTMP, RTMPS, SRT and WHIP are all accepted — whichever your server speaks.',
  ],
};
