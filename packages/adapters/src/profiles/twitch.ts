import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * Twitch (Helix API + EventSub).
 * Source: docs/research/PLATFORM_YOUTUBE_TWITCH_KICK.md §2.
 *
 * There is no broadcast object on Twitch: a stream exists because bytes are arriving.
 * LIVETAP's job is "set metadata, fetch the key, push" — and chat over EventSub WebSocket.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // Authorization Code, Device Code, Client Credentials
  // Twitch documents no PKCE anywhere. Desktop uses the Device Code Grant instead.
  pkce: 'UNAVAILABLE',
  broadcastCreation: 'RTMP_DESTINATION', // nothing to create
  streamCreation: 'RTMP_DESTINATION', // nothing to create
  streamKey: 'NATIVE_API', // GET /helix/streams/key (channel:read:stream_key)
  start: 'RTMP_DESTINATION', // starts when RTMP data arrives
  stop: 'RTMP_DESTINATION', // stop pushing; there is no stop endpoint
  metadata: 'NATIVE_API', // PATCH /helix/channels (channel:manage:broadcast)
  thumbnail: 'UNAVAILABLE', // live thumbnails are auto-captured and read-only
  chatRead: 'NATIVE_API', // EventSub channel.chat.message v1 over WebSocket
  chatWrite: 'NATIVE_API', // POST /helix/chat/messages
  moderation: 'NATIVE_API', // POST /helix/moderation/bans, DELETE /helix/chat/messages
  // Twitch has no per-stream concurrent-viewer analytics API; LIVETAP samples
  // GET /helix/streams viewer_count itself and stores the series.
  analytics: 'NATIVE_API',
  liveStatus: 'NATIVE_API', // GET /helix/streams + EventSub stream.online/offline
  // GET /helix/schedule is documented; the segment create/update endpoints and their
  // scopes were NOT verified in research, so LIVETAP does not offer scheduling here.
  scheduling: 'EXPERIMENTAL',
  vertical916: 'USER_ASSISTED', // Dual Format is GA but configured encoder-side, no API flag
  rtmps: 'RTMP_DESTINATION', // rtmps://live.twitch.tv/app is widely used but secondary-sourced
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE',
};

export const twitchProfile: PlatformProfile = {
  id: 'twitch',
  displayName: 'Twitch',
  connectionSummary:
    'Sign in with Twitch once — LIVETAP fetches your stream key, sets your title and category, and you go live the moment video starts flowing.',
  capabilities,
  supportedAspectRatios: ['16:9', '9:16'],
  preferredAspectRatio: '16:9',
  recommended: {
    // UNVERIFIED: help.twitch.tv/broadcast-guidelines is JavaScript-rendered and could not be
    // machine-read during research. These are the widely used community figures — treat as
    // defaults a user may override, not as documented limits.
    maxVideoKbps: 6000,
    minVideoKbps: 2500,
    audioKbps: 160,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 60,
    maxHeight: 1080,
  },
  // Twitch goes live by itself as soon as ingest is accepted.
  autoStartsOnIngest: true,
  eligibilityNotes: [
    'No eligibility gate: any Twitch account can stream and use the API. Affiliate or Partner status is only needed for 1440p/HEVC and server-side transcoding.',
    'Registering the app needs two-factor authentication on the Twitch account, but there is no app review queue.',
    'There is no start or stop API. LIVETAP going live means "set your title, then push video"; ending means "stop pushing".',
    'Twitch cannot set a stream thumbnail, and has no per-stream viewer analytics endpoint — LIVETAP samples the viewer count itself.',
    'Vertical (Dual Format) streaming is encoder-side only: LIVETAP has to produce the second 9:16 encode, Twitch has no API flag for it.',
    'On desktop, LIVETAP signs in with the device-code flow because Twitch does not support PKCE.',
  ],
};
