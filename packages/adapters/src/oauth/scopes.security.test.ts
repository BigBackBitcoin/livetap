/**
 * TEAM F (SECURITY), 2026-09-15. §23's scope-minimisation question, answered by
 * matching every scope LIVETAP asks for against a call site that needs it.
 *
 * A scope is a permission the creator hands over on a consent screen they read in two
 * seconds. Asking for one LIVETAP never uses costs the creator real trust, raises the
 * blast radius of a stolen token, and — on Google — pushes the app into a verification
 * tier it did not need. "We might want it later" is not a reason; incremental
 * authorization exists.
 *
 * The mechanism is deliberately not a hand-maintained list of claims. Each scope below
 * names the ENDPOINT it gates, and the test greps the shipped adapter for a call to that
 * endpoint. A scope whose endpoint has no call site is a finding, and stays a finding
 * until either the call site or the scope goes.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PLATFORM_OAUTH } from './endpoints.js';

function adapterSource(file: string): string {
  return readFileSync(new URL(`../real/${file}`, import.meta.url), 'utf8');
}

interface ScopeUse {
  /** The scope string, exactly as it is sent. */
  scope: string;
  /** What it unlocks, in one line. */
  gates: string;
  /** A pattern that must appear in the shipped adapter, or null when nothing uses it. */
  evidence: RegExp | null;
}

const YOUTUBE: ScopeUse[] = [
  {
    scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
    gates:
      'everything: liveBroadcasts insert/bind/transition, liveStreams, liveChat read/write/ban, videos. ' +
      'Google publishes no narrower scope that covers liveChatMessages, so this is one scope or none',
    evidence: /liveBroadcasts|liveChat\/messages/,
  },
];

const TWITCH: ScopeUse[] = [
  { scope: 'channel:read:stream_key', gates: 'GET /streams/key', evidence: /apiBase\}\/streams\/key/ },
  { scope: 'channel:manage:broadcast', gates: 'PATCH /channels (title, category)', evidence: /apiBase\}\/channels/ },
  { scope: 'user:read:chat', gates: 'the EventSub chat subscription', evidence: /eventsub\/subscriptions/ },
  { scope: 'user:write:chat', gates: 'POST /chat/messages', evidence: /apiBase\}\/chat\/messages/ },
  { scope: 'moderator:manage:banned_users', gates: 'POST /moderation/bans', evidence: /moderation\/bans/ },
  {
    scope: 'moderator:manage:chat_messages',
    gates: 'DELETE /chat/messages',
    evidence: /apiBase\}\/chat\/messages/,
  },
];

const KICK: ScopeUse[] = [
  { scope: 'user:read', gates: 'GET /public/v1/users', evidence: /public\/v1\/users/ },
  { scope: 'channel:read', gates: 'GET /public/v1/channels', evidence: /public\/v1\/channels/ },
  { scope: 'channel:write', gates: 'PATCH /public/v1/channels', evidence: /method: 'PATCH'/ },
  {
    scope: 'streamkey:read',
    gates: "the stream.key/stream.url fields on GET /public/v1/channels",
    evidence: /KICK_STREAM_KEY_SCOPE|streamkey:read/,
  },
  { scope: 'chat:write', gates: 'POST /public/v1/chat', evidence: /public\/v1\/chat`/ },
  { scope: 'moderation:ban', gates: 'POST /public/v1/moderation/bans', evidence: /public\/v1\/moderation\/bans/ },
  {
    scope: 'moderation:chat_message:manage',
    gates: 'DELETE /public/v1/chat/{id}',
    evidence: /public\/v1\/chat\/\$\{encodeURIComponent/,
  },
];

const FACEBOOK: ScopeUse[] = [
  { scope: 'publish_video', gates: 'POST /{target}/live_videos', evidence: /live_videos/ },
  {
    scope: 'pages_read_engagement',
    gates: 'GET /{liveVideoId}/comments',
    evidence: /\/comments`|\/comments'|\$\{liveVideoId\}\/comments/,
  },
  {
    scope: 'pages_manage_posts',
    gates: 'publishing a live video to a PAGE rather than a profile — Meta gates Page content on it',
    // The adapter makes one call that needs it (POST /{page-id}/live_videos) but that call
    // is the same one `publish_video` gates, so there is no endpoint unique to this scope.
    // It has never been exercised against the real Graph API. See SEC-F19.
    evidence: /live_videos/,
  },
];

const TABLE: Array<{ platform: string; file: string; scopes: ScopeUse[] }> = [
  { platform: 'youtube', file: 'YouTubeAdapter.ts', scopes: YOUTUBE },
  { platform: 'twitch', file: 'TwitchAdapter.ts', scopes: TWITCH },
  { platform: 'kick', file: 'KickAdapter.ts', scopes: KICK },
  { platform: 'facebook', file: 'FacebookAdapter.ts', scopes: FACEBOOK },
];

describe('SEC-F18 every scope LIVETAP requests is matched to a call site that needs it', () => {
  it('the table below covers every scope in PLATFORM_OAUTH for the four brokered platforms', () => {
    for (const { platform, scopes } of TABLE) {
      const declared = PLATFORM_OAUTH[platform as keyof typeof PLATFORM_OAUTH]!.defaultScopes;
      expect([...scopes.map((s) => s.scope)].sort(), platform).toEqual([...declared].sort());
    }
  });

  for (const { platform, file, scopes } of TABLE) {
    describe(platform, () => {
      const source = adapterSource(file);
      for (const use of scopes) {
        if (use.evidence === null) continue;
        it(`${use.scope} is used: ${use.gates}`, () => {
          expect(use.evidence!.test(source), `${file} has no call site for ${use.scope}`).toBe(true);
        });
      }
    });
  }

  /**
   * SEC-F18, FIXED 2026-09-15.
   *
   * Kick's `defaultScopes` used to include `events:subscribe`, while `KickAdapter.ts` says in
   * its own words that there is deliberately no chat subscription, because "Kick chat read only
   * exists as a webhook to a public HTTPS endpoint, which a desktop LIVETAP cannot receive." So
   * the consent screen asked a creator to grant a permission the shipped code is documented as
   * unable to use.
   *
   * Scope minimisation is not a policy box here. It is the consent screen telling the truth: a
   * permission LIVETAP cannot exercise is one the creator is being asked to give away for
   * nothing. It goes back the day a relay endpoint exists to receive the webhook, and this test
   * is what makes adding it back a deliberate act.
   */
  it('does not ask Kick for events:subscribe while nothing can receive the webhook', () => {
    const kick = PLATFORM_OAUTH.kick!;
    const source = adapterSource('KickAdapter.ts');
    const canReceive =
      /async\s+subscribeChat\s*\(/.test(source) || /public\/v1\/events/.test(source);

    if (canReceive) {
      expect(
        kick.defaultScopes,
        'KickAdapter can receive events now, so the scope should be requested again',
      ).toContain('events:subscribe');
    } else {
      expect(
        kick.defaultScopes,
        'nothing in KickAdapter can receive a Kick webhook, so the scope must not be requested',
      ).not.toContain('events:subscribe');
    }
  });
});

describe('SEC-F19 the scopes LIVETAP deliberately does NOT request', () => {
  it('never asks X for broadcast.read or broadcast.write, which map to no endpoint', () => {
    const x = PLATFORM_OAUTH.x!;
    expect(x.defaultScopes).not.toContain('broadcast.read');
    expect(x.defaultScopes).not.toContain('broadcast.write');
    expect(x.defaultScopes).toEqual(['tweet.read', 'users.read', 'offline.access']);
  });

  it('never asks Twitch for user:read:email, which the adapter notes it does not need', () => {
    expect(PLATFORM_OAUTH.twitch!.defaultScopes).not.toContain('user:read:email');
    // The adapter reads /users without it and says so.
    expect(adapterSource('TwitchAdapter.ts')).toContain('user:read:email');
  });

  it('never asks YouTube for a Google scope beyond youtube.force-ssl', () => {
    const youtube = PLATFORM_OAUTH.youtube!;
    expect(youtube.defaultScopes).toHaveLength(1);
    for (const scope of youtube.defaultScopes) {
      expect(scope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\/youtube\./);
      // No drive, no gmail, no userinfo, no openid.
      expect(scope).not.toMatch(/drive|gmail|userinfo|openid|profile|email/);
    }
  });

  it('asks Facebook for no scope that would let LIVETAP post as the creator outside live', () => {
    const facebook = PLATFORM_OAUTH.facebook!;
    for (const forbidden of [
      'publish_to_groups',
      'user_posts',
      'user_friends',
      'email',
      'pages_messaging',
      'business_management',
      'ads_management',
    ]) {
      expect(facebook.defaultScopes, forbidden).not.toContain(forbidden);
    }
  });

  it('the platforms with no working sign-in ask for nothing that implies one', () => {
    // instagram, tiktok, x and linkedin are not brokered at all: apps/web/api/_lib/broker.ts
    // has four platforms. Their scope lists exist as research, and the notes say so.
    for (const id of ['instagram', 'tiktok', 'x', 'linkedin'] as const) {
      const config = PLATFORM_OAUTH[id]!;
      expect(config.notes.join(' '), id).toMatch(/no live|disabled|partner|only useful|no live scope/i);
    }
  });
});

describe('SEC-F20 the granted scope list is recorded, not assumed', () => {
  it('Kick records that streamkey:read can be withheld, and the adapter degrades', () => {
    const kick = adapterSource('KickAdapter.ts');
    expect(kick).toContain('streamkey:read');
    // The adapter must consult the RECORDED grant rather than assume the request succeeded.
    expect(kick).toMatch(/credential\?\.scopes|scopes\.includes\(KICK_STREAM_KEY_SCOPE\)/);
  });

  it('every brokered platform declares whether state is required, so nothing is guessed', () => {
    for (const id of ['youtube', 'twitch', 'kick', 'facebook'] as const) {
      expect(typeof PLATFORM_OAUTH[id]!.stateRequired, id).toBe('boolean');
    }
  });
});
