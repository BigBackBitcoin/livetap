import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * Facebook Live (Live Video API).
 * Source: docs/research/PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md §1.
 *
 * The only Meta surface with a real live control plane: POST /{target}/live_videos with
 * status=LIVE_NOW returns `secure_stream_url`, and POST /{id}?end_live_video=true ends it.
 * Everything is gated behind App Review of the "Live Video API" feature AND Business
 * Verification, so the control-plane capabilities are OAUTH_API rather than NATIVE_API:
 * they work for app-role users immediately and for everyone else only after approval.
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // Facebook Login / Facebook Login for Business
  // PKCE is documented for the OIDC code flow. Whether it is supported for a plain
  // Graph-API-scope authorization is UNVERIFIED, so LIVETAP uses a server-side exchange.
  pkce: 'EXPERIMENTAL',
  broadcastCreation: 'OAUTH_API', // POST /{page-id}/live_videos (App Review + Business Verification)
  streamCreation: 'OAUTH_API', // same call creates the ingest stream(s)
  streamKey: 'OAUTH_API', // secure_stream_url in the create response
  start: 'OAUTH_API', // status=LIVE_NOW at create time (no separate start call needed)
  stop: 'OAUTH_API', // POST /{live-video-id}?end_live_video=true
  metadata: 'OAUTH_API', // title (<=254 chars), description, privacy at create or update
  // schedule_custom_profile_image only exists for SCHEDULED creates; setting a thumbnail on a
  // running live video is UNVERIFIED, so LIVETAP does not offer it.
  thumbnail: 'UNAVAILABLE',
  chatRead: 'OAUTH_API', // GET /{id}/comments polling; SSE on streaming-graph.facebook.com
  // Posting a comment on a live video is not confirmed as a documented edge -> read-only.
  chatWrite: 'EXPERIMENTAL',
  moderation: 'UNAVAILABLE', // a blocked_users edge is referenced but its contract is UNVERIFIED
  analytics: 'OAUTH_API', // reactions/likes/polls; concurrent viewers (live_views) is UNVERIFIED
  liveStatus: 'OAUTH_API', // `status` field + LiveVideoInputStream.stream_health
  // status=SCHEDULED_UNPUBLISHED + event_params is documented, but the changelog also records
  // scheduling as deprecated. Contradictory -> LIVETAP treats it as experimental.
  scheduling: 'EXPERIMENTAL',
  vertical916: 'RTMP_DESTINATION', // accepted, but 16:9 is the documented recommendation
  rtmps: 'RTMP_DESTINATION', // RTMPS is mandatory; plain RTMP was removed in Nov 2019
  srt: 'UNAVAILABLE',
  whip: 'UNAVAILABLE', // dash_ingest_url exists, but that is DASH, not WebRTC
};

export const facebookProfile: PlatformProfile = {
  id: 'facebook',
  displayName: 'Facebook',
  connectionSummary:
    'Sign in with Facebook and pick a Page — LIVETAP creates the live video and goes live as soon as video arrives.',
  capabilities,
  supportedAspectRatios: ['16:9', '9:16'],
  preferredAspectRatio: '16:9',
  recommended: {
    // Official Live Video API reference: 1080p60 4,500-9,000 Kbps; keyframe 2s, max 4s.
    maxVideoKbps: 9000,
    minVideoKbps: 1500,
    audioKbps: 128, // AAC-LC 44.1/48 kHz stereo, 256 Kbps max
    keyframeIntervalSeconds: 2,
    codecs: ['h264'], // H.264 Level 4.1 to 1080p30, Level 4.2 for 1080p60
    maxFps: 60,
    maxHeight: 1080,
  },
  // Created with status=LIVE_NOW, so the broadcast publishes itself once ingest is accepted.
  autoStartsOnIngest: true,
  eligibilityNotes: [
    'Your Facebook account must be at least 60 days old, and the Page or professional-mode profile must have at least 100 followers.',
    'Facebook requires App Review of the "Live Video API" feature plus Business Verification before anyone other than an app developer or tester can go live. Business Verification can take weeks.',
    'A Facebook stream URL expires if unused for 24 hours, and a single broadcast must not exceed 8 hours.',
    'Facebook recommends 16:9. Vertical 9:16 is accepted but is off the documented spec.',
    'LIVETAP cannot moderate Facebook live comments or set a thumbnail on a running broadcast — neither is documented.',
    'Sending comments as the broadcaster is not a confirmed API, so LIVETAP shows Facebook chat read-only.',
    'Facebook requires RTMPS; plain RTMP was switched off in November 2019. SRT and WHIP are not supported.',
  ],
};
