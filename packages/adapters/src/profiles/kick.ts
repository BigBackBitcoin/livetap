import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * Kick (Kick Public API).
 * Source: docs/research/PLATFORM_YOUTUBE_TWITCH_KICK.md §3.
 *
 * Kick's control plane is metadata + chat write + moderation. There is no broadcast object,
 * chat READ is webhook-only (a public HTTPS endpoint LIVETAP desktop cannot offer), and the
 * stream-key mapping is documented only implicitly, so LIVETAP asks the user to paste it.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // OAuth 2.1 on id.kick.com
  // PKCE (S256) is mandatory, but client_secret is ALSO required at the token endpoint,
  // so there is no true public-client mode: the code exchange must be brokered server-side.
  pkce: 'OAUTH_API',
  broadcastCreation: 'UNAVAILABLE', // no broadcast/stream object exists
  streamCreation: 'UNAVAILABLE',
  // The `streamkey:read` scope exists and `GET /public/v1/channels` has stream.key/stream.url
  // in its schema, but the docs never bind the scope to an endpoint. Research flagged the
  // mapping UNVERIFIED, so LIVETAP ships the honest fallback: the user pastes URL + key.
  streamKey: 'USER_ASSISTED',
  start: 'RTMP_DESTINATION', // auto-starts on ingest
  stop: 'RTMP_DESTINATION', // no stop endpoint
  metadata: 'NATIVE_API', // PATCH /public/v1/channels (channel:write) -> 204
  thumbnail: 'UNAVAILABLE', // read-only on channel/livestream responses
  // Chat read exists ONLY as the chat.message.sent webhook, delivered to a public HTTPS URL.
  // There is no WebSocket, no polling endpoint, no chat history and no `chat:read` scope.
  chatRead: 'UNAVAILABLE',
  chatWrite: 'NATIVE_API', // POST /public/v1/chat (chat:write)
  moderation: 'NATIVE_API', // POST/DELETE /public/v1/moderation/bans — duration is in MINUTES
  analytics: 'UNAVAILABLE', // no analytics API; viewer_count is 0 when the streamer hides it
  liveStatus: 'NATIVE_API', // GET /public/v1/channels -> stream.is_live
  scheduling: 'UNAVAILABLE',
  vertical916: 'EXPERIMENTAL', // no official documentation either way
  rtmps: 'EXPERIMENTAL', // RTMPS support is not confirmed by any official Kick source
  srt: 'UNAVAILABLE', // undocumented
  whip: 'UNAVAILABLE',
};

export const kickProfile: PlatformProfile = {
  id: 'kick',
  displayName: 'Kick',
  connectionSummary:
    'Sign in with Kick so LIVETAP can set your title, then paste the stream URL and key from kick.com — Kick has no documented stream-key endpoint.',
  capabilities,
  supportedAspectRatios: ['16:9'],
  preferredAspectRatio: '16:9',
  recommended: {
    // UNVERIFIED: Kick's help article blocks automated fetching. These figures come from
    // consistent secondary sources and must be re-confirmed before being treated as limits.
    maxVideoKbps: 8000,
    minVideoKbps: 2500,
    audioKbps: 160,
    keyframeIntervalSeconds: 2,
    codecs: ['h264'],
    maxFps: 60,
    maxHeight: 1080,
  },
  autoStartsOnIngest: true,
  eligibilityNotes: [
    'You need a Kick account with two-factor authentication enabled to reach the Developer tab. There is no app review queue.',
    'Kick has no documented stream-key endpoint, so LIVETAP asks you to paste the stream URL and key from your Kick dashboard.',
    'Kick chat can only be read through a webhook sent to a public HTTPS address, so LIVETAP cannot show Kick chat from your computer. Sending chat and moderating still work.',
    'Kick publishes no analytics API and no rate limits. A viewer count of 0 can mean "hidden", not "nobody watching".',
    'RTMPS, SRT and vertical 9:16 are undocumented on Kick — LIVETAP uses whatever URL you paste.',
    'On desktop, signing in to Kick needs a LIVETAP-operated token exchange because Kick requires a client secret even with PKCE.',
  ],
};
