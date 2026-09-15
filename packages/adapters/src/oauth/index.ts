import type { PlatformId } from '@livetap/core';
import { getOAuthConfig } from './endpoints.js';

export {
  computeCodeChallenge,
  generateCodeVerifier,
  generatePkce,
  generateState,
} from './pkce.js';
export type { ChallengeEncoding, GeneratePkceOptions, PkcePair } from './pkce.js';
export { PLATFORM_OAUTH, getOAuthConfig } from './endpoints.js';
export type { OAuthPlatformConfig } from './endpoints.js';

export interface AuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  /** Omit to use the platform's recommended minimal scope set. */
  scopes?: string[];
  state: string;
  /** Omit for platforms whose `pkce` is 'none' (Twitch, Instagram). */
  codeChallenge?: string;
  /** Facebook Login for Business passes a saved configuration id instead of scopes. */
  configId?: string;
  /** Anything platform-specific the caller needs to add (e.g. a nonce). */
  extraParams?: Record<string, string>;
}

/**
 * Builds the authorization URL for a platform. Pure: no network, no crypto, no state kept.
 *
 * PKCE parameters are only added when the platform documents PKCE support, so LIVETAP never
 * sends a `code_challenge` to a platform that would ignore it (Twitch) and never omits one
 * where it is mandatory (Kick, TikTok).
 */
export function buildAuthorizeUrl(platform: PlatformId, input: AuthorizeUrlInput): string {
  const config = getOAuthConfig(platform);
  /*
   * A platform that documents PKCE gets PKCE, or gets nothing.
   *
   * This used to read `config.pkce !== 'none' && Boolean(input.codeChallenge)`, so a caller that
   * forgot the challenge silently received a PKCE-less authorize URL — for Kick and TikTok, where
   * it is mandatory, as well as everywhere else. No caller does that today (`oauthFlow.ts` always
   * generates a pair), but the failure mode of the old line was a downgrade nobody would see,
   * and the failure mode of this one is a stack trace during development.
   */
  if (config.pkce !== 'none' && !input.codeChallenge) {
    throw new Error(`${platform} requires PKCE and no code_challenge was supplied`);
  }
  const usePkce = config.pkce !== 'none';
  const base = usePkce ? (config.pkceAuthorizeUrl ?? config.authorizeUrl) : config.authorizeUrl;

  const params = new URLSearchParams();
  params.set(config.clientIdParam, input.clientId);
  params.set('response_type', 'code');
  params.set('redirect_uri', input.redirectUri);
  if (input.configId) {
    params.set('config_id', input.configId);
  } else {
    const scopes = input.scopes ?? config.defaultScopes;
    if (scopes.length > 0) params.set('scope', scopes.join(config.scopeSeparator));
  }
  if (!input.state && config.stateRequired) {
    throw new Error(`${platform} requires an OAuth state parameter.`);
  }
  if (input.state) params.set('state', input.state);
  if (usePkce && input.codeChallenge) {
    params.set('code_challenge', input.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(config.extraParams ?? {})) params.set(key, value);
  for (const [key, value] of Object.entries(input.extraParams ?? {})) params.set(key, value);

  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${params.toString()}`;
}

export interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Parses an OAuth redirect. Reads the query string first and then the fragment, so it works
 * for a loopback redirect, a hosted callback, and an implicit-style fragment response.
 * Never throws on a malformed URL — an unparseable callback is simply an error result.
 */
export function parseCallback(url: string): CallbackResult {
  const read = (search: URLSearchParams, into: CallbackResult): void => {
    const code = search.get('code');
    const state = search.get('state');
    const error = search.get('error');
    const description = search.get('error_description') ?? search.get('error_message');
    if (code && into.code === undefined) into.code = code;
    if (state && into.state === undefined) into.state = state;
    if (error && into.error === undefined) into.error = error;
    if (description && into.errorDescription === undefined) into.errorDescription = description;
  };

  const result: CallbackResult = {};
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute URL: accept a bare query/fragment string too.
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
