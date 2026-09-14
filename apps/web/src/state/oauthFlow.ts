/**
 * The one sign-in flow, for all three surfaces.
 *
 * Before this file existed, every piece of LIVETAP's OAuth was written and none of it was wired:
 * `buildAuthorizeUrl` had zero non-test callers, `PKCE_SESSION_KEY` was written by nothing, and
 * the desktop preload exposed `window.livetap.oauth.*` that no renderer code ever called. The
 * audit's verdict was that there is no OAuth flow in this product, not a broken one, an absent
 * one. This is the thing that was absent.
 *
 * The creator's view of all of this is one tap and their channel name on a card. They never see a
 * stream key, a scope, a token, a redirect URI or the word OAuth. Everything below exists to keep
 * that true.
 *
 * WEB      navigates the page to the platform, and `OAuthCallback` finishes when it comes back.
 * DESKTOP  binds a loopback listener in the main process, opens the system browser, and waits for
 *          the callback in place. Nothing navigates, so the flow completes inside `beginAuth`.
 * MOBILE   is the desktop shape with a different bridge behind `window.livetap.oauth`, which the
 *          Android workstream registers. Until it does, mobile falls through to the web path.
 *
 * The desktop branch uses the state the MAIN process generated (`LoopbackInfo.state`) rather than
 * generating its own. The loopback server refuses any callback whose state does not match its own,
 * so a renderer that invented a second state would build an authorize URL the listener is
 * guaranteed to reject, which is the two-state collision this seam was widened to avoid.
 */

import { buildAuthorizeUrl, generatePkce, generateState, PLATFORM_OAUTH } from '@livetap/adapters';
import type { AccountSummary, PlatformId } from '@livetap/core';
import { brokerBaseUrl, configuredPlatformIds } from './mockMode.js';
import type { OAuthConfigResponse } from './mockMode.js';
import { credentialFor, saveTokens, type StoredTokens } from './tokens.js';

/** Where the PKCE verifier and the state live between opening the platform's page and coming back. */
export const PKCE_SESSION_KEY = 'livetap.oauth.pending';

export interface PendingAuth {
  platform: PlatformId;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
}

/** The slice of `window.livetap.oauth` this module needs. Declared structurally so it is fakeable. */
export interface DesktopOAuthBridge {
  startLoopback(options?: { host?: 'localhost' | '127.0.0.1' }): Promise<{
    redirectUri: string;
    port: number;
    state: string;
  }>;
  waitForCallback(): Promise<string>;
  openExternal(url: string): Promise<unknown>;
}

export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface OAuthDeps {
  fetchImpl?: typeof fetch;
  storage?: SessionStorageLike | null;
  /** How the web surface leaves for the platform. Injected so a test never navigates. */
  navigate?: (url: string) => void;
  /** Present on desktop and, once the Android bridge lands, on mobile. */
  desktop?: DesktopOAuthBridge | undefined;
  /** The page origin the web redirect comes back to. */
  origin?: string;
  now?: () => number;
}

export type AuthOutcome =
  /** Desktop and mobile: the whole flow finished in place and the account is stored. */
  | { kind: 'connected'; platform: PlatformId; account: AccountSummary }
  /** Web: the page is on its way to the platform. Nothing more happens here. */
  | { kind: 'redirected'; platform: PlatformId }
  /** This deployment has no credentials for this platform, or the platform has no usable OAuth. */
  | { kind: 'unavailable'; platform: PlatformId; reason: string }
  /** The creator said no, or the platform refused. Never an error: a decision. */
  | { kind: 'denied'; platform: PlatformId; reason: string }
  | { kind: 'failed'; platform: PlatformId; what: string; why: string; youCan: string };

interface BrokerTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
}

function bridge(deps: OAuthDeps): DesktopOAuthBridge | undefined {
  if (deps.desktop !== undefined) return deps.desktop;
  const host = (globalThis as { window?: { livetap?: { oauth?: DesktopOAuthBridge } } }).window;
  return host?.livetap?.oauth;
}

function storageOf(deps: OAuthDeps): SessionStorageLike | null {
  if (deps.storage !== undefined) return deps.storage;
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

function originOf(deps: OAuthDeps): string {
  if (deps.origin) return deps.origin;
  const host = (globalThis as { location?: { origin?: string } }).location;
  return host?.origin ?? '';
}

/** The public client id this deployment holds for a platform, or undefined when it holds none. */
export async function clientIdFor(platform: PlatformId, deps: OAuthDeps = {}): Promise<string | undefined> {
  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) return undefined;
  try {
    const response = await doFetch(`${brokerBaseUrl()}/api/oauth/config`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as OAuthConfigResponse;
    if (!configuredPlatformIds(body).includes(platform)) return undefined;
    return body.platforms?.[platform]?.clientId;
  } catch {
    return undefined;
  }
}

export function writePending(storage: SessionStorageLike | null, pending: PendingAuth): void {
  if (!storage) return;
  try {
    storage.setItem(PKCE_SESSION_KEY, JSON.stringify(pending));
  } catch {
    /*
     * A browser with session storage disabled cannot complete the WEB flow at all, because the
     * verifier has to survive a full page navigation. It is not worth throwing here: the callback
     * reports "LIVETAP did not finish signing you in", which is exactly what happened.
     */
  }
}

export function readPending(storage: Pick<Storage, 'getItem' | 'removeItem'> | null): PendingAuth | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PKCE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAuth;
    return typeof parsed?.state === 'string' && typeof parsed?.platform === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Start a sign-in.
 *
 * On desktop this resolves `connected`, with the account already stored and named. On web it
 * resolves `redirected` and the page is leaving; `completeAuth` picks it up on the way back.
 */
export async function beginAuth(platform: PlatformId, deps: OAuthDeps = {}): Promise<AuthOutcome> {
  const config = PLATFORM_OAUTH[platform];
  if (!config) {
    return {
      kind: 'unavailable',
      platform,
      reason: `${platform} has no account sign-in. This destination takes a stream key you paste.`,
    };
  }
  const clientId = await clientIdFor(platform, deps);
  if (!clientId) {
    return {
      kind: 'unavailable',
      platform,
      reason: 'This copy of LIVETAP has no sign-in set up for that platform yet.',
    };
  }

  const pkce = config.pkce === 'none' ? undefined : await generatePkce({ encoding: config.pkce });
  const desktop = bridge(deps);

  if (desktop) {
    let loopback: Awaited<ReturnType<DesktopOAuthBridge['startLoopback']>>;
    try {
      loopback = await desktop.startLoopback({ host: config.loopbackHost });
    } catch {
      return failure(platform, 'LIVETAP could not open a sign-in.', 'The local sign-in listener would not start.');
    }
    const url = buildAuthorizeUrl(platform, {
      clientId,
      redirectUri: loopback.redirectUri,
      // The MAIN process owns the state, because the main process is what checks it.
      state: loopback.state,
      ...(pkce ? { codeChallenge: pkce.codeChallenge } : {}),
    });
    try {
      await desktop.openExternal(url);
      const callbackUrl = await desktop.waitForCallback();
      return await completeAuth(callbackUrl, deps, {
        platform,
        state: loopback.state,
        redirectUri: loopback.redirectUri,
        ...(pkce ? { codeVerifier: pkce.codeVerifier } : {}),
      });
    } catch {
      return failure(
        platform,
        'That sign-in did not finish.',
        'The browser window was closed, or it timed out before the platform replied.',
      );
    }
  }

  const redirectUri = `${originOf(deps)}/oauth/callback`;
  const state = generateState();
  writePending(storageOf(deps), {
    platform,
    state,
    redirectUri,
    ...(pkce ? { codeVerifier: pkce.codeVerifier } : {}),
  });
  const url = buildAuthorizeUrl(platform, {
    clientId,
    redirectUri,
    state,
    ...(pkce ? { codeChallenge: pkce.codeChallenge } : {}),
  });
  const go = deps.navigate ?? ((target: string): void => {
    (globalThis as { location?: { assign(url: string): void } }).location?.assign(target);
  });
  go(url);
  return { kind: 'redirected', platform };
}

export type CallbackOutcome =
  | { kind: 'ok'; platform: PlatformId; code: string; codeVerifier?: string; redirectUri: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'mismatch' }
  | { kind: 'missing' };

/**
 * Resolve a callback URL against the request we started.
 *
 * The `state` check is not a formality: without it, anyone who can make the user's browser open
 * this URL can trade an attacker's authorization code for a token bound to the user's session.
 * A mismatched or absent state is refused outright, never "tried anyway".
 */
export function resolveCallback(url: string, pending: PendingAuth | null): CallbackOutcome {
  const parsed = parseCallbackUrl(url);
  if (parsed.error) {
    return { kind: 'denied', reason: parsed.errorDescription ?? parsed.error };
  }
  if (!pending) return { kind: 'missing' };
  if (!parsed.state || parsed.state !== pending.state) return { kind: 'mismatch' };
  if (!parsed.code) return { kind: 'missing' };
  const outcome: CallbackOutcome = {
    kind: 'ok',
    platform: pending.platform,
    code: parsed.code,
    redirectUri: pending.redirectUri,
  };
  if (pending.codeVerifier) outcome.codeVerifier = pending.codeVerifier;
  return outcome;
}

/**
 * Finish a sign-in: verify the callback, exchange the code through the broker, store the tokens,
 * and hand back the account the creator will see.
 *
 * `pending` is passed explicitly by the desktop branch, which never touched session storage, and
 * read from session storage by the web branch, which navigated away and back.
 */
export async function completeAuth(
  callbackUrl: string,
  deps: OAuthDeps = {},
  pendingOverride?: PendingAuth,
): Promise<AuthOutcome> {
  const storage = storageOf(deps);
  const pending = pendingOverride ?? readPending(storage);
  const outcome = resolveCallback(callbackUrl, pending);
  const platform = pending?.platform ?? 'youtube';

  if (outcome.kind === 'denied') {
    if (!pendingOverride) storage?.removeItem(PKCE_SESSION_KEY);
    return { kind: 'denied', platform, reason: outcome.reason };
  }
  if (outcome.kind === 'mismatch') {
    if (!pendingOverride) storage?.removeItem(PKCE_SESSION_KEY);
    return failure(
      platform,
      'LIVETAP did not finish signing you in.',
      'The reply did not match the sign-in this device started, so it was refused.',
    );
  }
  if (outcome.kind === 'missing') {
    if (!pendingOverride) storage?.removeItem(PKCE_SESSION_KEY);
    return failure(
      platform,
      'LIVETAP did not finish signing you in.',
      'The reply from the platform had no sign-in code in it.',
    );
  }

  // The verifier is single use and the code is single use. Clear the pending record before the
  // exchange, so a refresh of this page cannot replay a code the platform will have burned.
  if (!pendingOverride) storage?.removeItem(PKCE_SESSION_KEY);

  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) {
    return failure(platform, 'LIVETAP could not finish signing you in.', 'This build cannot reach the sign-in service.');
  }

  const body: Record<string, string> = {
    platform: outcome.platform,
    code: outcome.code,
    redirectUri: outcome.redirectUri,
  };
  if (outcome.codeVerifier) body.codeVerifier = outcome.codeVerifier;

  let tokens: BrokerTokenResponse;
  try {
    const response = await doFetch(`${brokerBaseUrl()}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return failure(
        platform,
        'LIVETAP could not finish signing you in.',
        response.status === 501
          ? 'This copy of LIVETAP has no sign-in set up for that platform.'
          : 'The platform refused the last step of the sign-in.',
      );
    }
    tokens = (await response.json()) as BrokerTokenResponse;
  } catch {
    return failure(platform, 'LIVETAP could not finish signing you in.', 'The sign-in service could not be reached.');
  }

  if (!tokens.accessToken) {
    return failure(platform, 'LIVETAP could not finish signing you in.', 'The platform returned no usable sign-in.');
  }

  const now = deps.now ?? Date.now;
  const stored: StoredTokens = {
    accessToken: tokens.accessToken,
    // Recording what was GRANTED, not what was asked for. Kick lets the creator untick
    // streamkey:read on the consent screen, and a platform that says nothing about scopes is
    // taken at its word that it granted what was requested.
    scopes: tokens.scope ?? PLATFORM_OAUTH[outcome.platform]?.defaultScopes ?? [],
  };
  if (tokens.refreshToken) stored.refreshToken = tokens.refreshToken;
  if (tokens.expiresIn !== undefined) stored.expiresAt = now() + tokens.expiresIn * 1000;
  await saveTokens(outcome.platform, stored);

  const credential = credentialFor(outcome.platform, stored);
  const account: AccountSummary = { scopes: [...stored.scopes] };
  if (stored.expiresAt !== undefined) account.expiresAt = stored.expiresAt;
  if (credential.accountId) account.accountId = credential.accountId;
  if (credential.accountLabel) account.accountLabel = credential.accountLabel;
  return { kind: 'connected', platform: outcome.platform, account };
}

/**
 * Did the creator grant everything this platform needs for LIVETAP to fetch a key itself?
 *
 * Kick's consent screen has a tick box per scope. A creator who unticks `streamkey:read` has
 * authorized successfully and still cannot be streamed to without pasting a key, and the only
 * moment to say so is here, right after the connect, rather than at GO LIVE.
 */
export function missingScopes(platform: PlatformId, granted: readonly string[] | undefined): string[] {
  const config = PLATFORM_OAUTH[platform];
  if (!config || !granted) return [];
  return config.defaultScopes.filter((scope) => !granted.includes(scope));
}

function failure(platform: PlatformId, what: string, why: string): AuthOutcome {
  return {
    kind: 'failed',
    platform,
    what,
    why,
    youCan: 'Start the sign-in again from Destinations, or connect with a stream key instead.',
  };
}

interface ParsedCallback {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Read a redirect. Query string first, then the fragment, so one function covers the loopback
 * redirect, a hosted callback and a fragment-style response. Never throws on a malformed URL:
 * an unparseable callback is simply an error result.
 */
function parseCallbackUrl(url: string): ParsedCallback {
  const read = (search: URLSearchParams, into: ParsedCallback): void => {
    const code = search.get('code');
    const state = search.get('state');
    const error = search.get('error');
    const description = search.get('error_description') ?? search.get('error_message');
    if (code && into.code === undefined) into.code = code;
    if (state && into.state === undefined) into.state = state;
    if (error && into.error === undefined) into.error = error;
    if (description && into.errorDescription === undefined) into.errorDescription = description;
  };

  const result: ParsedCallback = {};
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    const trimmed = url.replace(/^[?#]/, '');
    read(new URLSearchParams(trimmed), result);
    if (!result.code && !result.error) result.error = 'invalid_request';
    return result;
  }
  read(parsed.searchParams, result);
  if (parsed.hash) read(new URLSearchParams(parsed.hash.replace(/^#/, '')), result);
  if (!result.code && !result.error) result.error = 'invalid_request';
  return result;
}
