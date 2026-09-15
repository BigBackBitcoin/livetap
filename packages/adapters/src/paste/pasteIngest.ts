/**
 * The paste path: what a creator with nothing registered anywhere can do today.
 *
 * Every platform on LIVETAP's priority list publishes an RTMP/RTMPS ingest URL and a stream key
 * on the creator's own studio page. Copying those two values takes about thirty seconds and needs
 * no OAuth client, no review queue and no console work by whoever built LIVETAP. That is the
 * Level-3 fallback in docs/platforms/PLATFORM_AUTH_MATRIX.md, and it is the only path that works
 * on a build with no credentials configured — which is every build until an owner registers one.
 *
 * This module holds the three facts that path needs and nothing else:
 *  - where the two values are on each platform's own page (`PASTE_KEY_LOCATIONS`);
 *  - the documented server address to pre-fill, where we are confident of it and only there
 *    (`PASTE_INGEST_DEFAULTS`) — a guessed ingest host is worse than an empty field, because an
 *    empty field asks a question the creator can answer and a wrong default fails at go-live;
 *  - what LIVETAP genuinely cannot do for a pasted destination (`pasteLimitsLine`), derived from
 *    the platform's own profile rather than hand-written per platform.
 *
 * Nothing here ever touches a stream key except `splitCombinedIngest`, which moves one between
 * two fields in the form and returns it; it is never logged, stored or formatted into a message.
 */
import type { PlatformId, PlatformProfile } from '@livetap/core';

/** A documented, keyless server address for a platform's own ingest. */
export interface PasteIngestDefault {
  protocol: 'rtmp' | 'rtmps';
  /** Exactly as the platform prints it next to the stream key. */
  url: string;
}

/**
 * Platforms that can be served by pasting a key, in priority order.
 *
 * LinkedIn is absent and stays absent: it is the one platform that never shows a member a stream
 * key, so there is nothing to paste (PLATFORM_AUTH_MATRIX, Level 4). `custom` is absent because
 * it is not a fallback for anything — it is the generic destination, always registered.
 */
export const PASTE_CAPABLE_PLATFORMS: readonly PlatformId[] = [
  'youtube',
  'twitch',
  'facebook',
  'kick',
  'instagram',
  'tiktok',
  'x',
];

/**
 * Pre-filled server addresses. Two entries, both documented and both verified 2026-09-15.
 *
 * Twitch is deliberately NOT here: its ingest host is regional and the official source is
 * `GET https://ingest.twitch.tv/ingests` (`url_template_secure`), which `resolveIngest` in
 * ../real/twitchIngest.ts already reads. Kick, TikTok, Instagram and X are not here either —
 * their hosts are per-channel or per-session, so the creator pastes what their own page shows.
 */
export const PASTE_INGEST_DEFAULTS: Partial<Record<PlatformId, PasteIngestDefault>> = {
  youtube: { protocol: 'rtmp', url: 'rtmp://a.rtmp.youtube.com/live2' },
  facebook: { protocol: 'rtmps', url: 'rtmps://live-api-s.facebook.com:443/rtmp/' },
};

/**
 * Where the two values are, on the platform's own page.
 *
 * This is the only help the paste form is allowed to show (PRODUCT_SPEC §6): it tells the
 * creator where to look, never what a stream key is.
 */
export const PASTE_KEY_LOCATIONS: Record<PlatformId, string> = {
  youtube: 'YouTube Studio, then Go live, then Stream settings.',
  twitch: 'Twitch, then Creator Dashboard, then Settings, then Stream.',
  facebook: 'Facebook Live producer, then Streaming software.',
  kick: 'Kick, then Creator Dashboard, then Settings, then Stream.',
  instagram: 'instagram.com in a desktop browser, then Add post, then Live.',
  tiktok: 'TikTok LIVE Studio, or Go LIVE on tiktok.com in a desktop browser.',
  x: 'studio.x.com, then Sources, then your source.',
  linkedin: 'LinkedIn does not show you one. Use the tool LinkedIn already approved.',
  custom: "Your own server's settings page.",
};

/** The address the paste form should start with, or undefined when we will not guess. */
export function pasteIngestDefault(platform: PlatformId | undefined): PasteIngestDefault | undefined {
  if (!platform) return undefined;
  return PASTE_INGEST_DEFAULTS[platform];
}

/** The result of tidying up what the creator actually pasted. */
export interface PastedIngest {
  url: string;
  streamKey: string;
  /** The key was taken off the end of the address, because the platform showed them joined. */
  split: boolean;
  /** The address was pasted into the key field, so it was moved to the address field. */
  moved: boolean;
}

/**
 * Accept what the platform actually showed the creator, in either shape.
 *
 * Most platforms print a server address and a key as two separate fields. Some print one joined
 * address ending in the key, and some creators paste that joined address into whichever field
 * their eye landed on first. All three are the same two values, so all three are accepted, and
 * the form says out loud when it has moved something — a field that silently rewrites its own
 * contents is worse than one that refuses.
 *
 * The split is deliberately conservative. A real ingest URL has exactly one path segment (the
 * application: `/live2`, `/app`, `/rtmp`), so a second segment can only be a key — but it must
 * also be long enough to be one. `rtmp://host/live/app` keeps both segments and fails validation
 * with "a stream key is required", which is a question the creator can answer; guessing would
 * produce a destination that fails at go-live for a reason nobody can see.
 */
export function splitCombinedIngest(rawUrl: string, rawKey: string): PastedIngest {
  let url = rawUrl.trim();
  let streamKey = rawKey.trim();
  let moved = false;

  // The joined address pasted into the key field. Only when the address field is still empty:
  // a creator who filled both fields meant what they typed.
  if (url.length === 0 && isRtmpUrl(streamKey)) {
    url = streamKey;
    streamKey = '';
    moved = true;
  }

  if (streamKey.length > 0 || !isRtmpUrl(url)) return { url, streamKey, split: false, moved };

  const cut = lastPathSegment(url);
  if (!cut) return { url, streamKey, split: false, moved };
  return { url: cut.base, streamKey: cut.tail, split: true, moved };
}

/** The shortest key any of the priority platforms issues is comfortably longer than this. */
const MIN_KEY_LENGTH = 8;

function isRtmpUrl(value: string): boolean {
  return /^rtmps?:\/\/\S+$/i.test(value);
}

/**
 * `rtmp://host/app/KEY` -> `{ base: 'rtmp://host/app', tail: 'KEY' }`, or undefined when the
 * address has nothing on the end that could be a key.
 */
function lastPathSegment(url: string): { base: string; tail: string } | undefined {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return undefined;
  const afterScheme = schemeEnd + 3;
  const hostEnd = url.indexOf('/', afterScheme);
  if (hostEnd < 0) return undefined;

  // A key may legitimately carry a query string, so the split is on '/' over the whole
  // remainder rather than on a parsed pathname that would drop it.
  const segments = url.slice(hostEnd + 1).split('/');
  const tail = segments.pop() ?? '';
  if (segments.filter((segment) => segment.length > 0).length === 0) return undefined;
  if (tail.length < MIN_KEY_LENGTH) return undefined;
  return { base: url.slice(0, hostEnd + 1) + segments.join('/'), tail };
}

/**
 * What LIVETAP cannot do for this destination, because nobody signed in.
 *
 * A pasted destination is genuinely real — it puts real bytes on a real wire — so it is never
 * labelled demo. But without a token there is no control plane: LIVETAP cannot set the title,
 * cannot read the platform's own view of the stream, and cannot repeat a rejection only the
 * platform's API would explain. Whether the creator also has to press a button is the one part
 * that varies, and it is read off the profile rather than listed here, so this sentence cannot
 * drift from what the adapters actually do.
 */
export function pasteLimitsLine(profile: PlatformProfile): string {
  const name = profile.displayName;
  /*
   * The generic destination is the one case where LIVETAP does not know what is at the far end.
   * It may be a platform that publishes the moment video arrives, or one that waits for a human
   * to press a button — and saying either would be a claim about somebody else's server that
   * LIVETAP has no way to check. `customProfile.autoStartsOnIngest` means "the send starts when
   * the server accepts the publish", which is a fact about the transport, not about publication.
   */
  if (profile.id === 'custom') {
    return 'LIVETAP sends the video and nothing else: it cannot set the title, read what the far end sees, or tell you why it turned a stream away. Whether it publishes on its own is up to the far end.';
  }
  const start = profile.autoStartsOnIngest
    ? `${name} goes live when LIVETAP starts sending and ends when it stops.`
    : `You press Go live in ${name} once LIVETAP is sending, and end it there.`;
  return `${start} LIVETAP cannot set the title, read how ${name} sees the stream, or tell you why ${name} turned one away.`;
}
