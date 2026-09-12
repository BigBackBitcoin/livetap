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
    // access_type=offline + prompt=consent is what reliably yields a refresh token.
    extraParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    stateRequired: false,
    notes: [
      'Desktop: authorization code + PKCE with a loopback redirect (http://127.0.0.1:<port>). OOB is dead and custom schemes are deprecated.',
      'Web: server-side code exchange with the client secret; PKCE layered on top.',
      'youtube.force-ssl is a sensitive scope, so a public app needs Google OAuth verification.',
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
    stateRequired: false,
    notes: [
      'Twitch does not support PKCE. Desktop must use the device code grant (https://id.twitch.tv/oauth2/device).',
      'Device-code refresh tokens are single-use and expire after 30 days of inactivity — persist the rotated token every refresh.',
      'state is "strongly encouraged" but not enforced, so LIVETAP always sends and verifies it.',
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
      'events:subscribe',
      'moderation:ban',
      'moderation:chat_message:manage',
    ],
    pkce: 'base64url',
    stateRequired: true,
    notes: [
      'PKCE (S256) is mandatory AND client_secret is required at the token endpoint, so the code exchange must be brokered server-side.',
      'Use http://localhost/... rather than http://127.0.0.1/... — Kick\'s docs front end rewrites the first 127.0.0.1 it finds.',
      'OAuth lives on id.kick.com while the API lives on api.kick.com.',
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
    stateRequired: false,
    notes: [
      'PKCE is documented for the OIDC code flow. Whether it works for plain Graph scopes is unverified, so always exchange the code server-side.',
      'The short-lived token must be exchanged for a long-lived (~60 day) one server-side with the app secret.',
      'Facebook Login for Business uses a config_id instead of a raw scope list; pass it via extra params when you have one.',
    ],
  },
  instagram: {
    authorizeUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    clientIdParam: 'client_id',
    scopeSeparator: ',',
    defaultScopes: ['instagram_business_basic', 'instagram_business_manage_comments'],
    pkce: 'none',
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
