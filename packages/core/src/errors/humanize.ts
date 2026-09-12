import type { ErrorCode, HumaneError } from '../types/destination.js';

interface Template {
  what: (ctx: Ctx) => string;
  why: (ctx: Ctx) => string;
  doing: (ctx: Ctx) => string;
  youCan: (ctx: Ctx) => string;
  recoverable: boolean;
}

export interface Ctx {
  /** Destination label like "YouTube · My Channel". */
  target?: string;
  /** Platform display name like "Twitch". */
  platform?: string;
  /** Whether automatic reconnection is enabled. */
  autoReconnect?: boolean;
  /** Free-form technical detail (never secrets). */
  technical?: string;
}

const t = (ctx: Ctx) => ctx.target ?? ctx.platform ?? 'This destination';
const p = (ctx: Ctx) => ctx.platform ?? 'the platform';
const reconnecting = (ctx: Ctx) =>
  ctx.autoReconnect === false
    ? 'LIVETAP has paused this destination. Your other destinations keep streaming.'
    : 'LIVETAP is reconnecting automatically. Your other destinations keep streaming.';

const TEMPLATES: Record<ErrorCode, Template> = {
  AUTH_EXPIRED: {
    what: (c) => `${t(c)} needs you to sign in again.`,
    why: (c) => `${p(c)} sign-ins expire after a while for your security.`,
    doing: () => 'LIVETAP kept this destination out of the broadcast so nothing else is affected.',
    youCan: (c) => `Tap Reconnect on ${t(c)} and sign in again.`,
    recoverable: true,
  },
  AUTH_REVOKED: {
    what: (c) => `${t(c)} is no longer connected.`,
    why: (c) => `Access was removed on ${p(c)}'s side (or you removed LIVETAP from your account).`,
    doing: () => 'LIVETAP removed the stored connection.',
    youCan: (c) => `Connect ${p(c)} again from Destinations.`,
    recoverable: true,
  },
  AUTH_MISSING_SCOPE: {
    what: (c) => `${t(c)} did not grant LIVETAP permission to go live.`,
    why: () => 'One of the permissions was declined during sign-in.',
    doing: () => 'LIVETAP will not try to go live here until permission is granted.',
    youCan: (c) => `Reconnect ${t(c)} and allow live-streaming permission.`,
    recoverable: true,
  },
  AUTH_FAILED: {
    what: (c) => `Sign-in to ${p(c)} did not complete.`,
    why: () => 'The sign-in window was closed, or the platform returned an error.',
    doing: () => 'Nothing was saved.',
    youCan: () => 'Try connecting again.',
    recoverable: true,
  },
  NOT_ELIGIBLE: {
    what: (c) => `${t(c)} is not enabled for live streaming yet.`,
    why: (c) => `${p(c)} requires accounts to meet eligibility rules before going live.`,
    doing: () => 'LIVETAP left this destination out of the broadcast.',
    youCan: (c) => `Enable live streaming in your ${p(c)} account settings, then reconnect.`,
    recoverable: true,
  },
  INGEST_REFUSED: {
    what: (c) => `${t(c)} refused the stream.`,
    why: () => 'The stream server rejected the connection (often a wrong key or a broadcast that was not created).',
    doing: () => 'LIVETAP stopped sending to this destination only.',
    youCan: (c) => `Check the stream key for ${t(c)} and try again.`,
    recoverable: true,
  },
  INGEST_DISCONNECTED: {
    what: (c) => `${t(c)} stopped receiving your stream.`,
    why: () => 'The connection to the stream server dropped, usually because of your network.',
    doing: reconnecting,
    youCan: () => 'Check your internet connection. If this keeps happening, lower your quality in Settings.',
    recoverable: true,
  },
  INGEST_TIMEOUT: {
    what: (c) => `${t(c)} is not responding.`,
    why: () => 'The stream server did not answer in time.',
    doing: reconnecting,
    youCan: () => 'Wait a moment. If it stays offline, remove and re-add the destination.',
    recoverable: true,
  },
  INGEST_INVALID_KEY: {
    what: (c) => `${t(c)} did not accept the stream key.`,
    why: () => 'The key is wrong, expired, or was reset on the platform.',
    doing: () => 'LIVETAP did not go live here. Other destinations are unaffected.',
    youCan: (c) => `Copy a fresh stream key from ${p(c)} and paste it into this destination.`,
    recoverable: true,
  },
  NETWORK_OFFLINE: {
    what: () => 'Your device lost its internet connection.',
    why: () => 'No network is available right now.',
    doing: () => 'LIVETAP keeps encoding and will reconnect every destination as soon as you are back online.',
    youCan: () => 'Check Wi-Fi or Ethernet. A wired connection is the most reliable for streaming.',
    recoverable: true,
  },
  NETWORK_DEGRADED: {
    what: () => 'Your connection is struggling.',
    why: () => 'Upload speed dropped below what your quality setting needs, so frames are being skipped.',
    doing: () => 'LIVETAP is reducing quality slightly to keep you live.',
    youCan: () => 'Move closer to your router, pause large downloads, or lower quality in Settings.',
    recoverable: true,
  },
  ENCODER_FAILED: {
    what: () => 'Your device could not keep making the picture.',
    why: () => 'Something in the video pipeline stopped on this device.',
    doing: () => 'LIVETAP is restarting it at a safer quality and keeping you live.',
    youCan: () => 'Close other apps, or choose a lower quality in Settings.',
    recoverable: true,
  },
  ENCODER_OVERLOADED: {
    what: () => 'Your device cannot keep up with this quality.',
    why: () => 'Encoding is taking longer than a frame, so frames are being dropped.',
    doing: () => 'LIVETAP is lowering quality to protect your stream.',
    youCan: () => 'Close other apps, or choose a lower quality preset.',
    recoverable: true,
  },
  CAMERA_LOST: {
    what: () => 'Your camera disconnected.',
    why: () => 'The device was unplugged, disabled, or taken by another app.',
    doing: () => 'LIVETAP switched to your fallback layer so your stream stays up.',
    youCan: () => 'Reconnect the camera or pick another one from the camera menu.',
    recoverable: true,
  },
  MIC_LOST: {
    what: () => 'Your microphone disconnected.',
    why: () => 'The device was unplugged, disabled, or taken by another app.',
    doing: () => 'LIVETAP is streaming silence rather than stopping your broadcast.',
    youCan: () => 'Reconnect the microphone or pick another one from the mic menu.',
    recoverable: true,
  },
  SCREEN_DENIED: {
    what: () => 'Screen sharing was not allowed.',
    why: () => 'The system permission for screen recording was declined.',
    doing: () => 'LIVETAP left the screen layer empty.',
    youCan: () => 'Allow screen recording for LIVETAP in your system settings and try again.',
    recoverable: true,
  },
  DISK_FULL: {
    what: () => 'Your disk is almost full.',
    why: () => 'Recording needs free space and there is not enough left.',
    doing: () => 'LIVETAP stopped the recording but kept your stream live.',
    youCan: () => 'Free some space or change the recording folder.',
    recoverable: true,
  },
  RECORDING_FAILED: {
    what: () => 'Recording stopped unexpectedly.',
    why: () => 'The file could not be written.',
    doing: () => 'LIVETAP kept your stream live and saved what it could.',
    youCan: () => 'Check the recording folder and disk, then start recording again.',
    recoverable: true,
  },
  PLATFORM_ERROR: {
    what: (c) => `${p(c)} returned an error.`,
    why: () => 'The platform API failed to complete the request.',
    doing: () => 'LIVETAP will retry once, then leave this destination out.',
    youCan: () => 'Try again in a minute. Other destinations are unaffected.',
    recoverable: true,
  },
  RATE_LIMITED: {
    what: (c) => `${p(c)} asked LIVETAP to slow down.`,
    why: () => 'Too many requests were made in a short time.',
    doing: () => 'LIVETAP is waiting before trying again.',
    youCan: () => 'No action needed. This resolves on its own.',
    recoverable: true,
  },
  QUOTA_EXCEEDED: {
    what: (c) => `${p(c)} API quota is used up for today.`,
    why: () => 'The platform limits how many API calls an app may make per day.',
    doing: () => 'LIVETAP cannot create or control broadcasts here until the quota resets.',
    youCan: (c) => `Start the broadcast manually on ${p(c)} and stream to it with a stream key.`,
    recoverable: false,
  },
  CONFIG_INVALID: {
    what: (c) => `${t(c)} is missing something.`,
    why: () => 'The stream URL or key is empty or malformed.',
    doing: () => 'LIVETAP will not try to go live here.',
    youCan: () => 'Open the destination and fix the highlighted field.',
    recoverable: true,
  },
  UNKNOWN: {
    what: (c) => `Something went wrong with ${t(c)}.`,
    why: () => 'An unexpected error occurred.',
    doing: () => 'LIVETAP isolated the problem so your other destinations keep streaming.',
    youCan: () => 'Try again. If it persists, open Diagnostics in Pro mode and share the log.',
    recoverable: true,
  },
};

export function humanize(code: ErrorCode, ctx: Ctx = {}): HumaneError {
  const tpl = TEMPLATES[code] ?? TEMPLATES.UNKNOWN;
  return {
    code,
    what: tpl.what(ctx),
    why: tpl.why(ctx),
    doing: tpl.doing(ctx),
    youCan: tpl.youCan(ctx),
    technical: ctx.technical,
    recoverable: tpl.recoverable,
  };
}

/** Map low-level transport/API failures to ErrorCode. Pure and side-effect free. */
export function classifyFailure(input: { status?: number; message?: string; kind?: string }): ErrorCode {
  const msg = (input.message ?? '').toLowerCase();
  if (input.kind === 'offline' || msg.includes('enotfound') || msg.includes('network is unreachable')) {
    return 'NETWORK_OFFLINE';
  }
  if (input.status === 401) return 'AUTH_EXPIRED';
  if (input.status === 403) {
    if (msg.includes('quota')) return 'QUOTA_EXCEEDED';
    if (msg.includes('scope') || msg.includes('insufficient')) return 'AUTH_MISSING_SCOPE';
    if (msg.includes('enabled') || msg.includes('eligib')) return 'NOT_ELIGIBLE';
    return 'AUTH_REVOKED';
  }
  if (input.status === 429) return 'RATE_LIMITED';
  if (input.status !== undefined && input.status >= 500) return 'PLATFORM_ERROR';
  if (msg.includes('invalid stream key') || msg.includes('publish rejected') || msg.includes('netstream.publish.badname')) {
    return 'INGEST_INVALID_KEY';
  }
  if (msg.includes('connection refused') || msg.includes('econnrefused')) return 'INGEST_REFUSED';
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('etimedout')) return 'INGEST_TIMEOUT';
  if (msg.includes('broken pipe') || msg.includes('econnreset') || msg.includes('end of file') || msg.includes('eof')) {
    return 'INGEST_DISCONNECTED';
  }
  if (msg.includes('encoder')) return 'ENCODER_FAILED';
  if (msg.includes('no space') || msg.includes('enospc')) return 'DISK_FULL';
  return 'UNKNOWN';
}
