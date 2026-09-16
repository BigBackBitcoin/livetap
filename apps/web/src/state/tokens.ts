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
 * ONE ENTRY PER AUTHORIZED ACCOUNT, NOT PER PLATFORM.
 *
 * This file used to say the opposite, and said why: "the product is one account per platform: the
 * Destinations screen offers YouTube once, and a creator with two channels picks which one at
 * sign-in time. If that ever becomes two rows, this key grows an account id and nothing else here
 * changes." That is now the product — a creator may connect Carter Gaming, Carter Live and Carter
 * Clips and go live to all three at once — and this is that key growing.
 *
 * WHY THE KEY IS A CONNECTION ID AND NOT THE PROVIDER'S ACCOUNT ID, which is the obvious choice
 * and is wrong: at the moment tokens are stored, nobody knows which account they belong to. The
 * OAuth exchange returns an access token and nothing else. The channel id, the title and the
 * avatar arrive later, from the adapter's own validate() against the platform's "who am I"
 * endpoint. Keying on an identity that does not exist yet means either a second write to move the
 * entry, or a window in which two concurrent sign-ins collide on the same placeholder.
 *
 * So LIVETAP mints the identity itself, when the flow starts, and the provider's account id is
 * stored INSIDE the record once it is known — where it is what duplicate detection READS, rather
 * than what addresses the vault.
 *
 * A bare PlatformId is still accepted everywhere a ConnectionRef is, and means the legacy single
 * connection for that platform: `oauth:youtube`, which is the key every already-signed-in creator
 * has in their vault right now. Upgrading must not sign anybody out.
 */
export interface ConnectionRef {
  /** The LIVETAP id for ONE authorized account. Stable for the life of the connection. */
  connectionId: string;
  platform: PlatformId;
}

/** Either addressing form. A bare platform is the legacy single connection. */
export type TokenTarget = PlatformId | ConnectionRef;

function vaultKey(target: TokenTarget): string {
  return typeof target === 'string'
    ? `oauth:${target}`
    : `oauth:${target.platform}:${target.connectionId}`;
}

/** Web only. Cleared by a reload, deliberately. Keyed by the vault key, so both forms agree. */
const memory = new Map<string, StoredTokens>();

export async function saveTokens(target: TokenTarget, tokens: StoredTokens): Promise<void> {
  const store = vault();
  const key = vaultKey(target);
  // A refused write is not a write. Keeping the session copy means the creator finishes the
  // sign-in they started, on a machine whose keychain is unavailable, instead of watching it
  // succeed and then finding themselves signed out.
  if (store && wrote(await store.set(key, JSON.stringify(tokens)))) return;
  memory.set(key, tokens);
}

function parseTokens(raw: string | undefined): StoredTokens | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    return typeof parsed?.accessToken === 'string' && parsed.accessToken.length > 0 ? parsed : undefined;
  } catch {
    // A vault entry we cannot parse is an entry from an older shape. Treat it as absent rather
    // than as an error: the worst case is one more sign-in, and there is nothing to recover.
    return undefined;
  }
}

/*
 * THE UPGRADE PATH, and the reason it is a read and never a write.
 *
 * A creator who signed in before multi-account shipped has `oauth:youtube` in their vault. Their
 * first connection under the new model asks for `oauth:youtube:<connectionId>`, finds nothing, and
 * would sign them out of a channel they are still authorized on. So a connection whose own key is
 * absent falls back to the platform's legacy entry.
 *
 * It does NOT copy the entry forward. Migrating on read would leave one grant under two keys, and
 * revoking either would leave the other holding a token the platform has already killed — a row
 * that looks signed in and fails at GO LIVE. The legacy entry stays where it is and dies when the
 * connection using it is disconnected.
 */
function legacyKey(target: TokenTarget): string | null {
  return typeof target === 'string' ? null : `oauth:${target.platform}`;
}

export async function readTokens(target: TokenTarget): Promise<StoredTokens | undefined> {
  const store = vault();
  const key = vaultKey(target);
  const legacy = legacyKey(target);
  if (!store) return memory.get(key) ?? (legacy ? memory.get(legacy) : undefined);
  // valueOf() is what makes this work at all on desktop: the Electron preload answers with a
  // result object, and handing that straight to JSON.parse is why every desktop sign-in used to
  // read back as no sign-in. See the note in secrets.ts.
  const mine = parseTokens(valueOf(await store.get(key)) ?? undefined) ?? memory.get(key);
  if (mine) return mine;
  if (!legacy) return undefined;
  return parseTokens(valueOf(await store.get(legacy)) ?? undefined) ?? memory.get(legacy);
}

export async function forgetTokens(target: TokenTarget): Promise<void> {
  const store = vault();
  const key = vaultKey(target);
  if (store) await store.delete(key);
  memory.delete(key);
  /*
   * A connection that was reading the legacy entry has to delete THAT entry too, or the creator
   * presses Disconnect, is told the account is gone, and the token is still in their keychain.
   */
  const legacy = legacyKey(target);
  if (legacy) {
    if (store) await store.delete(legacy);
    memory.delete(legacy);
  }
}

/** True when a token for this connection is held somewhere this process can reach. */
export async function hasTokens(target: TokenTarget): Promise<boolean> {
  return (await readTokens(target)) !== undefined;
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

/**
 * The credential handle the adapters carry. Holds identity, never a secret.
 *
 * `id` is the vault key, so two YouTube connections produce two DIFFERENT credential refs and an
 * adapter can never read the other channel's token by holding the wrong one.
 */
export function credentialFor(target: TokenTarget, tokens: StoredTokens): CredentialRef {
  const platform = typeof target === 'string' ? target : target.platform;
  const ref: CredentialRef = { id: vaultKey(target), platform, scopes: [...tokens.scopes] };
  if (typeof target !== 'string') ref.connectionId = target.connectionId;
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
  target: TokenTarget,
  current: StoredTokens,
  options: TokenProviderOptions = {},
): Promise<StoredTokens> {
  const platform = typeof target === 'string' ? target : target.platform;
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
  /*
   * Written back to THIS connection, never to the platform. A creator with two YouTube channels
   * refreshing Carter Live must not overwrite Carter Gaming's token with a grant that belongs to
   * a different channel — the second one would then broadcast to the first one's channel, which
   * is the worst failure this feature can produce and the reason the key moved.
   */
  await saveTokens(target, next);
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
  target: TokenTarget,
  options: TokenProviderOptions = {},
): (credential?: CredentialRef) => Promise<string> {
  const now = options.now ?? Date.now;
  const platform = typeof target === 'string' ? target : target.platform;
  /*
   * THE CREDENTIAL DECIDES, NOT THE CLOSURE.
   *
   * One adapter serves every destination on a platform — `registerApiAdapter` registers a single
   * `YouTubeAdapter` — so a provider bound to one connection at registration time would hand
   * Carter Live's request Carter Gaming's token, and the second channel would broadcast to the
   * first channel's channel. Every adapter already calls `tokenProvider(credential)`; this
   * closure simply stopped ignoring the argument.
   *
   * `target` remains the fallback for a caller with no credential — the legacy single connection.
   */
  return async (credential?: CredentialRef): Promise<string> => {
    const from: TokenTarget =
      credential?.connectionId !== undefined
        ? { connectionId: credential.connectionId, platform: (credential.platform as PlatformId) ?? platform }
        : target;
    const stored = await readTokens(from);
    if (!stored) {
      throw new TokenUnavailableError(`LIVETAP is not signed in to ${platform}.`);
    }
    const fresh =
      stored.expiresAt !== undefined && stored.expiresAt - now() <= REFRESH_MARGIN_MS
        ? await refreshTokens(from, stored, options)
        : stored;
    rememberIssued(fresh.accessToken, from);
    return fresh.accessToken;
  };
}

/*
 * WHICH CONNECTION OWNS THE TOKEN WE JUST HANDED OUT.
 *
 * `refreshingFetch` is also registered once per platform, and unlike the provider it is never
 * given a credential — it sees a `fetch` call and a 401 and nothing else. So it recovers the
 * connection from the only identifying thing it does have: the bearer token that was refused,
 * which this module issued and can therefore attribute.
 *
 * Bounded by construction. One entry per connection, replaced whenever that connection issues a
 * fresher token, so it holds as many entries as the creator has accounts rather than one per
 * request.
 */
const issuedBy = new Map<string, TokenTarget>();

function rememberIssued(accessToken: string, target: TokenTarget): void {
  const key = vaultKey(target);
  for (const [token, owner] of issuedBy) {
    if (vaultKey(owner) === key && token !== accessToken) issuedBy.delete(token);
  }
  issuedBy.set(accessToken, target);
}

/** The connection that was handed this access token, or nothing if we did not issue it. */
function ownerOf(accessToken: string): TokenTarget | undefined {
  return issuedBy.get(accessToken);
}

/**
 * Disconnect, both halves.
 *
 * Order matters: revoke first, delete second. Deleting first and then failing to revoke would
 * leave a live grant on the platform that LIVETAP can no longer even name, let alone withdraw.
 * The revoke is best effort by design (see `revoke()` in the broker), so the local delete always
 * happens and Disconnect always finishes.
 */
export async function revokeTokens(target: TokenTarget, options: TokenProviderOptions = {}): Promise<boolean> {
  const platform = typeof target === 'string' ? target : target.platform;
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  const stored = await readTokens(target);
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
  await forgetTokens(target);
  return revoked;
}

/**
 * A fetch that renews the sign-in once when the platform says 401, and tries again.
 *
 * `tokenProviderFor` refreshes on the CLOCK: it looks at `expiresAt` and renews inside the margin.
 * That covers the ordinary case and misses the one that actually bites, because an access token
 * can die well before it says it will — a revoke, a password change, and above all a Google
 * project in Testing status, where the authorization expires seven days after consent whatever the
 * token claims. The only signal is the 401 itself, and nothing was listening for it, so a creator
 * came back on day eight, found themselves signed out, and had a perfectly good refresh token
 * sitting in the vault the whole time. That is the classic multistreaming-tool bug and this is the
 * two dozen lines that avoid it.
 *
 * Wrapped here, around the adapters' `fetch`, rather than inside each adapter: this is the one
 * seam where a credential meets HTTP, so there is exactly one place to get it right.
 */
export function refreshingFetch(
  target: TokenTarget,
  doFetch: FetchLike,
  options: TokenProviderOptions = {},
): FetchLike {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const first = await doFetch(input, init);
    if (first.status !== 401) return first;

    // Only a request WE authorised can be retried: without an Authorization header a 401 is the
    // platform's answer to something else, and re-sending it would be a pointless second call.
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const sent = headers['Authorization'] ?? headers['authorization'];
    if (!sent?.startsWith('Bearer ')) return first;

    /*
     * Refresh the connection that was REFUSED, not the platform's first one.
     *
     * This read `readTokens(platform)`, which under one-account-per-platform was the only answer
     * there was. With several it would renew Carter Gaming's grant because Carter Live got a 401,
     * leave Carter Live still refused, and quietly rotate a refresh token belonging to a channel
     * that was working — turning one signed-out account into two.
     */
    const refused = sent.slice('Bearer '.length);
    const owner = ownerOf(refused) ?? target;
    const stored = await readTokens(owner);
    if (!stored?.refreshToken) return first;

    let renewed: StoredTokens;
    try {
      // The renewal goes through the SAME fetch, so a caller that injected one (a test, or a
      // harness pointing at a local identity provider) does not find half the flow escaping to
      // the real network.
      renewed = await refreshTokens(owner, stored, { fetchImpl: doFetch, ...options });
    } catch {
      // The refresh token is dead too. Hand back the original 401 so the adapter reports the
      // platform's own answer rather than a second, less informative failure of ours.
      return first;
    }
    if (renewed.accessToken === stored.accessToken) return first;
    rememberIssued(renewed.accessToken, owner);

    // Rebuilt rather than spread-over: a lower-case `authorization` left beside the new
    // `Authorization` is two auth headers, one of them the dead one.
    const retryHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== 'authorization') retryHeaders[key] = value;
    }
    retryHeaders['Authorization'] = `Bearer ${renewed.accessToken}`;
    return doFetch(input, { ...init, headers: retryHeaders });
  };
}
