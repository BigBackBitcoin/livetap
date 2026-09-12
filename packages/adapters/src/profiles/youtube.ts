import type { CapabilityMatrix, PlatformProfile } from '@livetap/core';

/**
 * YouTube Live (YouTube Data API v3 / Live Streaming API).
 * Source: docs/research/PLATFORM_YOUTUBE_TWITCH_KICK.md §1.
 *
 * The only platform LIVETAP supports with a complete broadcast lifecycle API:
 * liveBroadcasts.insert -> liveStreams.insert -> bind -> poll streamStatus -> transition(live).
 */
const capabilities: CapabilityMatrix = {
  oauth: 'OAUTH_API', // Google Identity OAuth 2.0
  pkce: 'OAUTH_API', // documented for installed apps; S256 + loopback redirect
  broadcastCreation: 'NATIVE_API', // liveBroadcasts.insert
  streamCreation: 'NATIVE_API', // liveStreams.insert
  streamKey: 'NATIVE_API', // cdn.ingestionInfo.streamName
  start: 'NATIVE_API', // liveBroadcasts.transition -> live
  stop: 'NATIVE_API', // liveBroadcasts.transition -> complete
  metadata: 'NATIVE_API', // liveBroadcasts.insert/update
  thumbnail: 'NATIVE_API', // thumbnails.set (broadcastId === videoId)
  chatRead: 'NATIVE_API', // liveChatMessages.list (polling, pollingIntervalMillis)
  chatWrite: 'NATIVE_API', // liveChatMessages.insert
  moderation: 'NATIVE_API', // liveChatMessages.delete, liveChatBans.insert
  analytics: 'NATIVE_API', // videos.list?part=liveStreamingDetails -> concurrentViewers
  liveStatus: 'NATIVE_API', // liveStreams.list?part=status
  scheduling: 'NATIVE_API', // snippet.scheduledStartTime is mandatory anyway
  vertical916: 'EXPERIMENTAL', // no API field for aspect/format; vertical feed is a closed beta
  rtmps: 'NATIVE_API', // cdn.ingestionInfo.rtmpsIngestionAddress
  srt: 'UNAVAILABLE', // official protocol comparison lists RTMP/RTMPS/HLS/DASH only
  whip: 'UNAVAILABLE', // cdn.ingestionType accepts rtmp | hls | dash
};

export const youtubeProfile: PlatformProfile = {
  id: 'youtube',
  displayName: 'YouTube',
  connectionSummary:
    'Sign in with Google once — LIVETAP creates the broadcast, gets the stream key and takes it live for you.',
  capabilities,
  supportedAspectRatios: ['16:9', '9:16'],
  preferredAspectRatio: '16:9',
  recommended: {
    // support.google.com/youtube/answer/2853702 (recommended column)
    maxVideoKbps: 40000, // 2160p60
    minVideoKbps: 3000, // 720p30 floor
    audioKbps: 128, // stereo AAC
    keyframeIntervalSeconds: 2, // recommended 2s, never above 4s
    codecs: ['h264', 'hevc', 'av1'],
    maxFps: 60,
    maxHeight: 2160,
  },
  // YouTube needs an explicit transition to `live` once ingest is active.
  autoStartsOnIngest: false,
  eligibilityNotes: [
    'Your channel must be verified, you must be 16 or older, and you must have had no live-streaming restrictions in the past 90 days.',
    'A community-guidelines strike during a stream blocks live streaming for 14 days.',
    'YouTube allows 10 active streams per channel and 3 active streams per stream key.',
    'Publishing LIVETAP as a public YouTube app needs two separate Google approvals: OAuth app verification for the sensitive youtube.force-ssl scope, and a YouTube API Services compliance audit for quota above the default allocation.',
    'Vertical 9:16 has no API surface: YouTube accepts whatever the encoder pushes, and the vertical Shorts live feed is a region-limited beta.',
    'YouTube does not accept SRT or WHIP ingest — RTMPS only.',
  ],
};
