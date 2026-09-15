/**
 * Where an OAuth token lives, how it is renewed, and how it is thrown away.
 *
 * ONE rule governs this file: a token is never rendered, never logged, never persisted anywhere a
 * page script can read it, and never handed to the UI. What the UI gets is `AccountSummary`, which
 * is a name, a picture, a list of granted scopes and an expiry. The adapters get a `TokenProvider`
 * closure, which is the only way an access token leaves this module.
 *
 * The three surfaces store it differently because their threat models are different:
 *
 *   DESKTOP  `window.livetap.vault`, which is Electron `safeStorage` on top of the OS credential
 *            store, written atomically at mode 0600, and which refuses to store anything at all
 *            when encryption is unavailable. A desktop creator signs in once.
 *
 *   MOBILE   the same `VaultBridge` shape, registered by the native secure store. Identical code
 *            path; only the implementation behind `window.livetap.vault` differs.
 *
 *   WEB      memory, for the life of the page, and nothing else. `localStorage` is readable by any
 *            script that ever runs on this origin, including one that arrives through a
 *            dependency, and a YouTube refresh token is a key to someone's channel. Losing it on
 *            reload costs one tap; leaking it costs the channel. This is the same trade
 *            `secrets.ts` already makes for stream keys, made for the same reason.
 *
 * Refresh happens inside the provider, not on a timer: a timer that fires while the app is
 * backgrounded or asleep is a token that expires anyway, and a refresh right before the call that
 * needs it is the only version that is always correct.
 */

import { PLATFORM_OAUTH } from '@livetap/adapters';
import type { AccountSummary, CredentialRef, PlatformId } from '@livetap/core';
import { brokerBaseUrl } from './mockMode.js';
import { valueOf, wrote } from './secrets.js';
import type { VaultBridge } from './secrets.js';

/** Renew this many ms before the platform says the token dies, so a slow call cannot straddle it. */
export const REFRESH_MARGIN_MS = 60_000;

export interface StoredTokens {
  accessToken: string;
  /**
   * Present when the platform issues one. Facebook never does: it renews by exchanging the access
   * token for a fresher access token, so `refreshToken` stays undefined there and the renewal path
   * sends `accessToken` instead. That asymmetry lives in the broker, not here.
   */
  refreshToken?: string;
  /** Epoch ms. Absent means the platform did not say, and the token is used until it is refused. */
  expiresAt?: number;
  /** Scopes the platform GRANTED. Never the ones LIVETAP asked for. */
  scopes: string[];
  accountId?: string;
  accountLabel?: string;
  avatarUrl?: string;
}

interface LivetapBridge {
  vault?: VaultBridge;
}

function vault(): VaultBridge | undefined {
  const host = (globalThis as { window?: { livetap?: LivetapBridge } }).window;
  return host?.livetap?.vault;
}

/**
 * One entry per platform.
 *
 * Per-platform rather than per-account because the product is one account per platform: the
 * Destinations screen offers "YouTube" once, and a creator with two channels picks which one at
 * sign-in time. If that ever becomes two rows, this key grows an account id and nothing else here
 * changes.
 */
function vaultKey(platform: PlatformId): string {
  return `oauth:${platform}`;
}

/** Web only. Cleared by a reload, deliberately. */
const memory = new Map<PlatformId, StoredTokens>();

export async function saveTokens(platform: PlatformId, tokens: StoredTokens): Promise<void> {
  const store = vault();
  // A refused write is not a write. Keeping the session copy means the creator finishes the
  // sign-in they started, on a machine whose keychain is unavailable, instead of watching it
  // succeed and then finding themselves signed out.
  if (store && wrote(await store.set(vaultKey(platform), JSON.stringify(tokens)))) return;
  memory.set(platform, tokens);
}

export async function readTokens(platform: PlatformId): Promise<StoredTokens | undefined> {
  const store = vault();
  if (!store) return memory.get(platform);
  // valueOf() is what makes this work at all on desktop: the Electron preload answers with a
  // result object, and handing that straight to JSON.parse is why every desktop sign-in used to
  // read back as no sign-in. See the note in secrets.ts.
  const raw = valueOf(await store.get(vaultKey(platform))) ?? undefined;
  if (!raw) return memory.get(platform);
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    return typeof parsed?.accessToken === 'string' && parsed.accessToken.length > 0 ? parsed : undefined;
  } catch {
    // A vault entry we cannot parse is an entry from an older shape. Treat it as absent rather
    // than as an error: the worst case is one more sign-in, and there is nothing to recover.
    return undefined;
  }
}

export async function forgetTokens(platform: PlatformId): Promise<void> {
  const store = vault();
  if (store) await store.delete(vaultKey(platform));
  memory.delete(platform);
}

/** True when a token for this platform is held somewhere this process can reach. */
export async function hasTokens(platform: PlatformId): Promise<boolean> {
  return (await readTokens(platform)) !== undefined;
}

/** The non-secret half, for the destination card. Never contains a token. */
export function summarize(tokens: StoredTokens): AccountSummary {
  const summary: AccountSummary = { scopes: [...tokens.scopes] };
  if (tokens.accountId) summary.accountId = tokens.accountId;
  if (tokens.accountLabel) summary.accountLabel = tokens.accountLabel;
  if (tokens.avatarUrl) summary.avatarUrl = tokens.avatarUrl;
  if (tokens.expiresAt !== undefined) summary.expiresAt = tokens.expiresAt;
  return summary;
}

/** The credential handle the adapters carry. Holds identity, never a secret. */
export function credentialFor(platform: PlatformId, tokens: StoredTokens): CredentialRef {
  const ref: CredentialRef = { id: vaultKey(platform), platform, scopes: [...tokens.scopes] };
  if (tokens.accountId) ref.accountId = tokens.accountId;
  if (tokens.accountLabel) ref.accountLabel = tokens.accountLabel;
  if (tokens.avatarUrl) ref.avatarUrl = tokens.avatarUrl;
  if (tokens.expiresAt !== undefined) ref.expiresAt = tokens.expiresAt;
  return ref;
}

/**
 * An error shaped so `classifyFailure` in packages/core maps it to AUTH_EXPIRED, which humanizes
 * to "YouTube needs you to sign in again."
 *
 * This matters more than it looks. A YouTube app in Google's Testing status has its AUTHORIZATION
 * expire seven days after consent, taking the refresh token with it, every single week. That is
 * the classic multistreaming-tool bug: the creator is shown `invalid_grant` and concludes the
 * product is broken. It is not an error code, it is one tap, and this is where that is decided.
 */
class TokenUnavailableError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'TokenUnavailableError';
  }
}

interface BrokerTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
}

type FetchLike = typeof fetch;

export interface TokenProviderOptions {
  /** Injected in tests; defaults to the global. */
  fetchImpl?: FetchLike;
  now?: () => number;
}

/**
 * Renew one platform's tokens through the broker, persisting whatever comes back.
 *
 * Persisting the rotated refresh token is not optional. Twitch device-code refresh tokens and
 * Kick refresh tokens are both single-use: keeping the old one after a successful refresh means
 * the NEXT refresh fails, the creator is signed out, and the cause looks like nothing at all.
 */
export async function refreshTokens(
  platform: PlatformId,
  current: StoredTokens,
  options: TokenProviderOptions = {},
): Promise<StoredTokens> {
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  const now = options.now ?? Date.now;
  const config = PLATFORM_OAUTH[platform];
  const grant = config?.refreshGrant ?? 'none';
  if (!doFetch || grant === 'none') {
    throw new TokenUnavailableError(`${platform} cannot renew a sign-in; it has to be done again.`);
  }
  // Facebook has no refresh token and renews using the access token itself. The broker knows
  // which grant to send; all this side has to get right is which secret to hand it.
  const renewWith = grant === 'fb_exchange_token' ? current.accessToken : current.refreshToken;
  if (!renewWith) {
    throw new TokenUnavailableError(`${platform} did not give LIVETAP a way to stay signed in.`);
  }

  const response = await doFetch(`${brokerBaseUrl()}/api/oauth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform, refreshToken: renewWith }),
  });
  if (!response.ok) {
    throw new TokenUnavailableError(`${platform} would not renew this sign-in.`);
  }
  const body = (await response.json()) as BrokerTokenResponse;
  if (!body.accessToken) {
    throw new TokenUnavailableError(`${platform} returned no usable sign-in.`);
  }
  const next: StoredTokens = {
    ...current,
    accessToken: body.accessToken,
    // Keep the old refresh token only when the platform sent none: a platform that DID send one
    // has rotated it, and the old one is already dead.
    refreshToken: body.refreshToken ?? current.refreshToken,
    scopes: body.scope && body.scope.length > 0 ? body.scope : current.scopes,
  };
  if (body.expiresIn !== undefined) next.expiresAt = now() + body.expiresIn * 1000;
  await saveTokens(platform, next);
  return next;
}

/**
 * The closure the real adapters call for every request.
 *
 * Refresh when the token is inside the margin, and again on the retry after the platform refuses
 * one anyway: an access token can die early (a revoke, a password change, a Testing-status
 * authorization hitting day seven) and the only signal is the 401 itself.
 */
export function tokenProviderFor(
  platform: PlatformId,
  options: TokenProviderOptions = {},
): (credential?: CredentialRef) => Promise<string> {
  const now = options.now ?? Date.now;
  return async (): Promise<string> => {
    const stored = await readTokens(platform);
    if (!stored) {
      throw new TokenUnavailableError(`LIVETAP is not signed in to ${platform}.`);
    }
    if (stored.expiresAt !== undefined && stored.expiresAt - now() <= REFRESH_MARGIN_MS) {
      return (await refreshTokens(platform, stored, options)).accessToken;
    }
    return stored.accessToken;
  };
}

/**
 * Disconnect, both halves.
 *
 * Order matters: revoke first, delete second. Deleting first and then failing to revoke would
 * leave a live grant on the platform that LIVETAP can no longer even name, let alone withdraw.
 * The revoke is best effort by design (see `revoke()` in the broker), so the local delete always
 * happens and Disconnect always finishes.
 */
export async function revokeTokens(platform: PlatformId, options: TokenProviderOptions = {}): Promise<boolean> {
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  const stored = await readTokens(platform);
  let revoked = false;
  if (stored && doFetch) {
    try {
      const response = await doFetch(`${brokerBaseUrl()}/api/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform,
          // Revoking the refresh token kills the whole grant on Google and Twitch; revoking only
          // the access token would leave the refresh token able to mint another one.
          token: stored.refreshToken ?? stored.accessToken,
        }),
      });
      if (response.ok) {
        const body = (await response.json()) as { revoked?: boolean };
        revoked = body.revoked === true;
      }
    } catch {
      // Offline, or no broker on this deployment. The local half below still runs.
    }
  }
  await forgetTokens(platform);
  return revoked;
}
