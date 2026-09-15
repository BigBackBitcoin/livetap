import type { PlatformId } from '@livetap/core';
import type { ChallengeEncoding } from './pkce.js';

/**
 * Per-platform OAuth facts, all taken from the research docs. Nothing here is invented:
 * where a platform has no usable OAuth for live streaming, `pkce` and the scope list say so
 * and the notes explain why.
 */
export interface OAuthPlatformConfig {
  /** Authorization endpoint for the standard (non-PKCE) flow. */
  authorizeUrl: string;
  /** Some platforms expose a separate authorization endpoint for PKCE (LinkedIn). */
  pkceAuthorizeUrl?: string;
  tokenUrl: string;
  /** Query parameter carrying the client id (`client_key` on TikTok). */
  clientIdParam: string;
  /** How multiple scopes are joined. */
  scopeSeparator: string;
  /** LIVETAP's recommended minimal scope set. */
  defaultScopes: string[];
  /** 'none' means the platform documents no PKCE support. */
  pkce: 'none' | ChallengeEncoding;
  /**
   * RFC 8628 device authorization endpoint, where the platform offers one.
   *
   * Twitch is the reason this field exists: its docs describe no PKCE anywhere, which leaves the
   * device code grant as the only way a desktop app with no client secret can get a token.
   */
  deviceAuthorizationUrl?: string;
  /** Token revocation endpoint. Absent means the platform publishes none and Disconnect is local only. */
  revokeUrl?: string;
  /**
   * How this platform renews an expiring access token.
   *
   * `refresh_token` is the standard grant. `fb_exchange_token` is Facebook's: it never issues a
   * refresh_token at all, and a long-lived token is renewed by exchanging the token itself, so a
   * client that assumes the standard grant simply never refreshes and silently expires.
   * `none` means the creator has to sign in again, which the UI must say out loud.
   */
  refreshGrant: 'refresh_token' | 'fb_exchange_token' | 'none';
  /**
   * Which spelling of loopback this platform's registered redirect uses.
   *
   * A provider compares `redirect_uri` as a STRING, so `http://localhost:5000/callback` and
   * `http://127.0.0.1:5000/callback` are two different values however identically they resolve.
   * Google requires the literal IP for installed apps; Kick's console registers the name.
   */
  loopbackHost: 'localhost' | '127.0.0.1';
  /** Extra fixed query parameters. */
  extraParams?: Record<string, string>;
  /** Whether the platform documents `state` as required. */
  stateRequired: boolean;
  /** Honest notes shown to developers, not end users. */
  notes: string[];
}

export const PLATFORM_OAUTH: Record<PlatformId, OAuthPlatformConfig | undefined> = {
  youtube: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdParam: 'client_id',
    scopeSeparator: ' ',
    defaultScopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
    pkce: 'base64url',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    refreshGrant: 'refresh_token',
    loopbackHost: '127.0.0.1',
    // access_type=offline + prompt=consent is what reliably yields a refresh token.
    extraParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    stateRequired: false,
    notes: [
      'Desktop: authorization code + PKCE with a loopback redirect (http://127.0.0.1:<port>). OOB is dead and custom schemes are deprecated.',
      'Web: server-side code exchange with the client secret; PKCE layered on top.',
      'youtube.force-ssl is a sensitive scope, so a public app needs Google OAuth verification.',
      'No Google verification is needed for the owner and their own account while the app sits in Testing status and that account is on the test-user list.',
      'While it sits in Testing, the AUTHORIZATION itself expires 7 days after consent and takes the refresh token with it. That is not an error state and must never be rendered as one: it is "YouTube needs you to sign in again", weekly, until verification lands.',
    ],
  },
  twitch: {
    authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    clientIdParam: 'client_id',
    scopeSeparator: ' ',
    defaultScopes: [
      'channel:read:stream_key',
      'channel:manage:broadcast',
      'user:read:chat',
      'user:write:chat',
      'moderator:manage:banned_users',
      'moderator:manage:chat_messages',
    ],
    // Twitch documents no PKCE anywhere.
    pkce: 'none',
    deviceAuthorizationUrl: 'https://id.twitch.tv/oauth2/device',
    revokeUrl: 'https://id.twitch.tv/oauth2/revoke',
    refreshGrant: 'refresh_token',
    loopbackHost: 'localhost',
    stateRequired: false,
    notes: [
      'Twitch does not support PKCE. Desktop must use the device code grant (https://id.twitch.tv/oauth2/device).',
      'Device-code refresh tokens are single-use and expire after 30 days of inactivity — persist the rotated token every refresh.',
      'state is "strongly encouraged" but not enforced, so LIVETAP always sends and verifies it.',
      'The RTMP ingest host comes from GET https://ingest.twitch.tv/ingests, url_template_secure first and url_template as the fallback. Never the hardcoded rtmps://live.twitch.tv/app: that is one PoP out of dozens, and the list is what Twitch keeps current.',
    ],
  },
  kick: {
    authorizeUrl: 'https://id.kick.com/oauth/authorize',
    tokenUrl: 'https://id.kick.com/oauth/token',
    clientIdParam: 'client_id',
    scopeSeparator: ' ',
    defaultScopes: [
      'user:read',
      'channel:read',
      'channel:write',
      'streamkey:read',
      'chat:write',
      // No `events:subscribe`. KickAdapter documents why it cannot use it — the subscription
      // delivers to a webhook at a public HTTPS endpoint, which a desktop LIVETAP has no way to
      // receive — so asking for it puts a permission on the consent screen that buys the creator
      // nothing. Scope minimisation is not a policy here, it is the consent screen being honest.
      'moderation:ban',
      'moderation:chat_message:manage',
    ],
    pkce: 'base64url',
    revokeUrl: 'https://id.kick.com/oauth/revoke',
    refreshGrant: 'refresh_token',
    loopbackHost: 'localhost',
    stateRequired: true,
    notes: [
      'PKCE (S256) is mandatory AND client_secret is required at the token endpoint, so the code exchange must be brokered server-side.',
      'Use http://localhost/... rather than http://127.0.0.1/... — Kick\'s docs front end rewrites the first 127.0.0.1 it finds.',
      'OAuth lives on id.kick.com while the API lives on api.kick.com.',
      'The consent screen lets the creator untick streamkey:read. Introspect the GRANTED scope list after every connect and degrade to the paste path; assuming the scope was granted is how a connect that looked fine fails at GO LIVE.',
      'The stream key rides on GET /public/v1/channels, and there is an open report that it comes back as empty strings while the channel is offline, which is exactly the state LIVETAP is in when it needs one. The paste fallback stays until one empirical test says otherwise.',
    ],
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v25.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v25.0/oauth/access_token',
    clientIdParam: 'client_id',
    scopeSeparator: ',',
    defaultScopes: ['publish_video', 'pages_manage_posts', 'pages_read_engagement'],
    // PKCE is documented for the OIDC flow only; treat secret-less Graph auth as unproven.
    pkce: 'base64url',
    // Graph publishes no RFC 7009 revocation endpoint. DELETE /me/permissions is its equivalent.
    revokeUrl: 'https://graph.facebook.com/v25.0/me/permissions',
    refreshGrant: 'fb_exchange_token',
    loopbackHost: '127.0.0.1',
    stateRequired: false,
    notes: [
      'PKCE is documented for the OIDC code flow. Whether it works for plain Graph scopes is unverified, so always exchange the code server-side.',
      'The short-lived token must be exchanged for a long-lived (~60 day) one server-side with the app secret.',
      'Facebook Login for Business uses a config_id instead of a raw scope list; pass it via extra params when you have one.',
      'Facebook never issues a refresh_token. Renewal is grant_type=fb_exchange_token against the same token endpoint, so a client that sends grant_type=refresh_token never renews and expires silently at about 60 days.',
      'Pin ONE Graph version across authorize, exchange and API calls. This repo had two (v25.0 to authorize, v21.0 to exchange), which is the kind of skew that only surfaces when Meta retires the older one.',
    ],
  },
  instagram: {
    authorizeUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    clientIdParam: 'client_id',
    scopeSeparator: ',',
    defaultScopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
    pkce: 'none',
    refreshGrant: 'none',
    loopbackHost: '127.0.0.1',
    stateRequired: false,
    notes: [
      'Instagram has no live API: this OAuth grants comment and status reads only. Going live is always a pasted stream key.',
      'No PKCE is documented and client_secret is required, so desktop needs a server-side exchange.',
    ],
  },
  tiktok: {
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    // TikTok names the parameter client_key, not client_id.
    clientIdParam: 'client_key',
    scopeSeparator: ',',
    defaultScopes: ['user.info.basic'],
    // Documented deviation from RFC 7636: the challenge is the SHA-256 HEX digest.
    pkce: 'hex',
    refreshGrant: 'refresh_token',
    loopbackHost: '127.0.0.1',
    stateRequired: false,
    notes: [
      'TikTok has no live scope at all. This OAuth is only useful if LIVETAP also publishes recorded video.',
      'PKCE is required for desktop and the challenge must be hex-encoded SHA-256, not base64url.',
      'Desktop redirect URIs must be localhost/127.0.0.1 with an explicit port and no query or fragment.',
    ],
  },
  x: {
    authorizeUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    clientIdParam: 'client_id',
    scopeSeparator: ' ',
    // Deliberately NOT broadcast.read / broadcast.write: those scopes are grantable but no
    // documented endpoint consumes them, so requesting them buys nothing and scares users.
    defaultScopes: ['tweet.read', 'users.read', 'offline.access'],
    pkce: 'base64url',
    revokeUrl: 'https://api.x.com/2/oauth2/revoke',
    refreshGrant: 'refresh_token',
    loopbackHost: '127.0.0.1',
    stateRequired: true,
    notes: [
      'X has no live API. This OAuth only enables the optional, metered "replies to the announcement Post" panel.',
      'Never request broadcast.read or broadcast.write: grantable, but mapped to no endpoint.',
      'Authorization codes expire in 30 seconds and access tokens last 2 hours unless offline.access is granted.',
    ],
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    // Loopback-only, and LinkedIn must enable it per application on request.
    pkceAuthorizeUrl: 'https://www.linkedin.com/oauth/native-pkce/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdParam: 'client_id',
    scopeSeparator: ' ',
    defaultScopes: ['r_member_live', 'w_member_live'],
    pkce: 'base64url',
    refreshGrant: 'none',
    loopbackHost: '127.0.0.1',
    stateRequired: false,
    notes: [
      'Live Events API access requires admission to LinkedIn\'s partner program; LIVETAP ships LinkedIn disabled.',
      'PKCE uses a separate native-pkce endpoint that LinkedIn enables per app on request.',
      'Member and organization live scopes cannot be combined in one authorization request — ask "profile or Page?" first.',
    ],
  },
  // A custom RTMP destination has no account and therefore no OAuth.
  custom: undefined,
};

export function getOAuthConfig(platform: PlatformId): OAuthPlatformConfig {
  const config = PLATFORM_OAUTH[platform];
  if (!config) throw new Error(`${platform} has no OAuth flow.`);
  return config;
}
