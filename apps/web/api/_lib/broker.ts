/**
 * OAuth token broker — the ONLY place client secrets are used.
 *
 * Runs as a Vercel serverless function (Node runtime, Web-standard Request/Response).
 * The SPA sends an authorization code (+ PKCE verifier where used); we exchange it with the
 * platform using the client secret from environment variables and return the token set to the
 * SPA over the same HTTPS origin. Tokens are never logged or persisted here.
 *
 * Pure functions in this module take `env` and `fetch` as parameters so they are unit-testable.
 */

export type BrokerPlatform = 'youtube' | 'twitch' | 'kick' | 'facebook';

export interface BrokerEnv {
  [key: string]: string | undefined;
}

interface PlatformSpec {
  tokenUrl: string;
  clientIdVar: string;
  clientSecretVar: string;
  /** How the token endpoint wants the body. */
  body: 'form' | 'json';
  /** Whether the platform expects client credentials in a Basic auth header. */
  basicAuth?: boolean;
  /**
   * How this platform renews a token. Facebook is the reason this is not assumed: it never
   * issues a refresh_token, so `grant_type=refresh_token` is a request it can only refuse, and
   * a broker that sends it silently stops renewing at about the 60 day mark.
   */
  refreshGrant: 'refresh_token' | 'fb_exchange_token';
  /** RFC 8628 device authorization endpoint, for the platforms that document one. */
  deviceUrl?: string;
  /** Token revocation, where the platform publishes it. */
  revokeUrl?: string;
  /**
   * How the revocation endpoint wants to be called.
   *  - `post-token`: RFC 7009, form POST with `token=` (Google, Twitch, Kick).
   *  - `delete-permissions`: Graph has no RFC 7009 endpoint; DELETE /me/permissions is its equivalent.
   */
  revokeStyle?: 'post-token' | 'delete-permissions';
  /** Twitch sends client_id as a query param on revoke, not in the form body. */
  revokeQuery?: boolean;
}

/**
 * ONE Graph version for everything Facebook.
 *
 * This constant exists because the two halves of this repo disagreed: the authorize URL was
 * pinned to v25.0 and the token exchange to v21.0. A skew like that works right up until Meta
 * retires the older version, and then it fails in the half nobody is looking at.
 */
export const FACEBOOK_GRAPH_VERSION = 'v25.0';

const SPECS: Record<BrokerPlatform, PlatformSpec> = {
  // https://developers.google.com/identity/protocols/oauth2/web-server-app#exchange-authorization-code
  youtube: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdVar: 'LIVETAP_YOUTUBE_CLIENT_ID',
    clientSecretVar: 'LIVETAP_YOUTUBE_CLIENT_SECRET',
    body: 'form',
    refreshGrant: 'refresh_token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    revokeStyle: 'post-token',
  },
  // https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
  twitch: {
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    clientIdVar: 'LIVETAP_TWITCH_CLIENT_ID',
    clientSecretVar: 'LIVETAP_TWITCH_CLIENT_SECRET',
    body: 'form',
    refreshGrant: 'refresh_token',
    // Twitch documents no PKCE, so the device code grant is the only way a desktop build with no
    // client secret on the device can get a token. https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/
    deviceUrl: 'https://id.twitch.tv/oauth2/device',
    revokeUrl: 'https://id.twitch.tv/oauth2/revoke',
    revokeStyle: 'post-token',
  },
  // https://docs.kick.com/getting-started/generating-tokens-oauth2-flow
  kick: {
    tokenUrl: 'https://id.kick.com/oauth/token',
    clientIdVar: 'LIVETAP_KICK_CLIENT_ID',
    clientSecretVar: 'LIVETAP_KICK_CLIENT_SECRET',
    body: 'form',
    refreshGrant: 'refresh_token',
    revokeUrl: 'https://id.kick.com/oauth/revoke',
    revokeStyle: 'post-token',
  },
  // https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#exchangecode
  facebook: {
    tokenUrl: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    clientIdVar: 'LIVETAP_FACEBOOK_APP_ID',
    clientSecretVar: 'LIVETAP_FACEBOOK_APP_SECRET',
    body: 'form',
    refreshGrant: 'fb_exchange_token',
    revokeUrl: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/permissions`,
    revokeStyle: 'delete-permissions',
  },
};

export const BROKER_PLATFORMS = Object.keys(SPECS) as BrokerPlatform[];

/**
 * Point every platform endpoint at a local harness instead of the real platform.
 *
 * `infra/dev-harness/fake-idp/` speaks real OAuth and real YouTube/Twitch API shapes, so the
 * whole accounts flow can be built and proven on a machine with no platform credentials at all.
 * This is the one switch that makes that possible, and it is the most dangerous line in the file:
 * a production deployment that honoured it would post the owner's real client secret to whatever
 * host the variable named. So it is refused outright under NODE_ENV=production, and refused for
 * anything but a loopback http origin. There is no override and no escape hatch.
 */
export function oauthBaseOverride(env: BrokerEnv): string | undefined {
  const raw = env.LIVETAP_OAUTH_BASE;
  if (!raw) return undefined;
  if (env.NODE_ENV === 'production') return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') {
    return undefined;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * The endpoints to use for one platform, after the harness override is applied.
 *
 * The override rewrites only the endpoint host: the harness serves `/token`, `/revoke` and
 * `/device`, so a spec's real host is swapped for the harness base while the shape of the
 * request stays exactly what the platform itself would receive.
 */
function endpointsFor(platform: BrokerPlatform, env: BrokerEnv): PlatformSpec {
  const spec = SPECS[platform];
  const base = oauthBaseOverride(env);
  if (!base) return spec;
  const overridden: PlatformSpec = { ...spec, tokenUrl: base + '/token' };
  if (spec.revokeUrl) overridden.revokeUrl = base + '/revoke';
  if (spec.deviceUrl) overridden.deviceUrl = base + '/device';
  return overridden;
}

export function isBrokerPlatform(x: unknown): x is BrokerPlatform {
  return typeof x === 'string' && x in SPECS;
}

/** Which platforms are configured (client id AND secret present). Safe to expose publicly. */
export function configuredPlatforms(env: BrokerEnv): Record<BrokerPlatform, { configured: boolean; clientId?: string }> {
  const out = {} as Record<BrokerPlatform, { configured: boolean; clientId?: string }>;
  for (const p of BROKER_PLATFORMS) {
    const spec = SPECS[p];
    const id = env[spec.clientIdVar];
    const secret = env[spec.clientSecretVar];
    out[p] = id && secret ? { configured: true, clientId: id } : { configured: false };
  }
  return out;
}

export interface ExchangeInput {
  platform: BrokerPlatform;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface RefreshInput {
  platform: BrokerPlatform;
  /**
   * Whatever this platform renews with: the refresh token on Google, Twitch and Kick, and
   * the long-lived ACCESS token on Facebook, which issues no refresh token at all.
   */
  refreshToken: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string[];
  tokenType?: string;
}

export class BrokerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'BAD_REQUEST' | 'UPSTREAM' | 'RATE_LIMITED',
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

const REDIRECT_RE = /^(https:\/\/[^\s/]+\/[^\s]*|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*|livetap:\/\/[^\s]*)$/i;

/**
 * The one private-use redirect LIVETAP registers, spelled exactly.
 *
 * `livetap://` used to be accepted with any authority and any path, so the broker would
 * exchange a code for `livetap://anything/at/all`. On a desktop where any installed program
 * can claim a URI scheme, that is the difference between the OS handing the callback to
 * LIVETAP and handing it to whatever registered the scheme last. One spelling is the only
 * spelling this app uses, so it is the only spelling accepted.
 */
export const LIVETAP_REDIRECT_URI = 'livetap://oauth/callback';

/**
 * Is this a redirect_uri this deployment is willing to forward to the platform?
 *
 * `redirect_uri` is not a redirect the broker performs -- it is echoed to the
 * token endpoint, which refuses it unless it matches the one used in the
 * authorization request AND is registered on the OAuth client. So an arbitrary
 * https host here is not an open redirect. It is still worth pinning:
 *
 *  - it keeps this deployment's client secret from being usable in an exchange
 *    that some other site started, which is what would let a third party mint
 *    tokens on our client id if a platform ever relaxed its own check;
 *  - it makes the accepted set auditable instead of "any https URL on earth".
 *
 * Accepted: the deployment's own origin (`host`), RFC 8252 loopback for the
 * desktop app's ephemeral-port listener, and the `livetap://` private-use
 * scheme for platforms that only allow a fixed redirect.
 */
export function isAllowedRedirectUri(redirectUri: string, host?: string): boolean {
  if (!REDIRECT_RE.test(redirectUri)) return false;
  if (/^livetap:\/\//i.test(redirectUri)) return redirectUri.toLowerCase() === LIVETAP_REDIRECT_URI;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol === 'http:') {
    // Loopback only, and only literal addresses -- never a name DNS could move.
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  }
  if (url.protocol !== 'https:') return false;
  // No host to compare against (unit tests, a caller that did not pass one):
  // fall back to the shape check rather than failing on a comparison we cannot make.
  if (!host) return true;
  return url.host.toLowerCase() === host.toLowerCase();
}

/**
 * The host this deployment is being served as.
 *
 * `x-forwarded-host` is preferred because a custom domain in front of Vercel
 * leaves `host` as the platform hostname while the SPA's origin (and therefore
 * its redirect_uri) is the custom domain. Trusting a client-settable header
 * here is acceptable ONLY because of what this value gates: it narrows which
 * redirect_uri we are willing to FORWARD, and the platform independently
 * refuses any redirect_uri that is not registered on the OAuth client. A
 * forged header therefore buys an attacker a rejection from the platform
 * instead of a rejection from us -- never a token.
 */
export function requestHost(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('host') || undefined;
}

export function validateExchangeInput(body: unknown, host?: string): ExchangeInput {
  if (!body || typeof body !== 'object') throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (!isBrokerPlatform(b.platform)) throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
  if (typeof b.code !== 'string' || b.code.length < 4 || b.code.length > 2048) throw new BrokerError(400, 'Missing code.', 'BAD_REQUEST');
  if (typeof b.redirectUri !== 'string' || !isAllowedRedirectUri(b.redirectUri, host)) {
    throw new BrokerError(400, 'Invalid redirectUri.', 'BAD_REQUEST');
  }
  if (b.codeVerifier !== undefined && (typeof b.codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.codeVerifier))) {
    throw new BrokerError(400, 'Invalid codeVerifier.', 'BAD_REQUEST');
  }
  return { platform: b.platform, code: b.code, redirectUri: b.redirectUri, codeVerifier: b.codeVerifier as string | undefined };
}

export function validateRefreshInput(body: unknown): RefreshInput {
  if (!body || typeof body !== 'object') throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (!isBrokerPlatform(b.platform)) throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
  if (typeof b.refreshToken !== 'string' || b.refreshToken.length < 8 || b.refreshToken.length > 4096) {
    throw new BrokerError(400, 'Missing refreshToken.', 'BAD_REQUEST');
  }
  return { platform: b.platform, refreshToken: b.refreshToken };
}

function credentials(platform: BrokerPlatform, env: BrokerEnv): { spec: PlatformSpec; clientId: string; clientSecret: string } {
  const spec = endpointsFor(platform, env);
  const clientId = env[spec.clientIdVar];
  const clientSecret = env[spec.clientSecretVar];
  if (!clientId || !clientSecret) {
    throw new BrokerError(501, `${platform} sign-in is not configured on this LIVETAP deployment.`, 'NOT_CONFIGURED');
  }
  return { spec, clientId, clientSecret };
}

async function postToken(spec: PlatformSpec, params: Record<string, string>, fetchFn: typeof fetch): Promise<TokenSet> {
  const res = await fetchFn(spec.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  if (res.status === 429) throw new BrokerError(429, 'The platform asked us to slow down.', 'RATE_LIMITED');
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok || typeof json.access_token !== 'string') {
    const desc = typeof json.error_description === 'string' ? json.error_description : typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    // Never include tokens or codes in the message.
    throw new BrokerError(res.status >= 500 ? 502 : 400, `Token exchange failed: ${desc}`.slice(0, 300), 'UPSTREAM');
  }
  const scope = typeof json.scope === 'string' ? json.scope.split(/[\s,]+/).filter(Boolean) : Array.isArray(json.scope) ? (json.scope as string[]) : undefined;
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    scope,
    tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
  };
}

export async function exchangeCode(input: ExchangeInput, env: BrokerEnv, fetchFn: typeof fetch = fetch): Promise<TokenSet> {
  const { spec, clientId, clientSecret } = credentials(input.platform, env);
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  };
  if (input.codeVerifier) params.code_verifier = input.codeVerifier;
  return postToken(spec, params, fetchFn);
}

export async function refreshToken(input: RefreshInput, env: BrokerEnv, fetchFn: typeof fetch = fetch): Promise<TokenSet> {
  const { spec, clientId, clientSecret } = credentials(input.platform, env);
  if (spec.refreshGrant === 'fb_exchange_token') {
    /*
     * Facebook's renewal, which is not a refresh at all: there is no refresh_token to send, so a
     * long-lived token is exchanged for a fresher long-lived token using itself. The caller
     * therefore passes the ACCESS token in `refreshToken`, which is what that field documents.
     */
    return postToken(
      spec,
      {
        grant_type: 'fb_exchange_token',
        fb_exchange_token: input.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      fetchFn,
    );
  }
  return postToken(
    spec,
    { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: clientId, client_secret: clientSecret },
    fetchFn,
  );
}

/* ------------------------------------------------------------------ revoke */

export interface RevokeInput {
  platform: BrokerPlatform;
  token: string;
}

export function validateRevokeInput(body: unknown): RevokeInput {
  if (!body || typeof body !== 'object') throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (!isBrokerPlatform(b.platform)) throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
  if (typeof b.token !== 'string' || b.token.length < 8 || b.token.length > 4096) {
    throw new BrokerError(400, 'Missing token.', 'BAD_REQUEST');
  }
  return { platform: b.platform, token: b.token };
}

/**
 * Hand the token back to the platform, so Disconnect means disconnected.
 *
 * Deleting a token from the local vault only stops LIVETAP from using it. The grant stays alive
 * on the platform's side until it expires, which for a long-lived Facebook token is two months.
 * Disconnect has to mean the platform forgets us too, or the word is a lie.
 *
 * Always resolves. RFC 7009 has a revocation endpoint answer 200 even for an unknown token, and
 * a creator who tapped Disconnect has already decided: a network failure here must not leave
 * them staring at an error next to a credential they still cannot get rid of. Deleting the local
 * copy is the caller's half, and it happens either way.
 */
export async function revoke(input: RevokeInput, env: BrokerEnv, fetchFn: typeof fetch = fetch): Promise<{ revoked: boolean }> {
  const { spec, clientId, clientSecret } = credentials(input.platform, env);
  if (!spec.revokeUrl) return { revoked: false };
  try {
    if (spec.revokeStyle === 'delete-permissions') {
      // Graph publishes no RFC 7009 endpoint. DELETE /me/permissions drops every permission the
      // app holds for this user, which is the documented way to undo a Facebook Login grant.
      const res = await fetchFn(spec.revokeUrl + '?access_token=' + encodeURIComponent(input.token), {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      return { revoked: res.ok };
    }
    const params: Record<string, string> = { token: input.token, client_id: clientId };
    // Google wants the secret, Twitch documents client_id alone. Sending both keeps one code
    // path, and every one of these endpoints ignores the parameter it does not use.
    if (clientSecret) params.client_secret = clientSecret;
    const res = await fetchFn(spec.revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    return { revoked: res.ok };
  } catch {
    return { revoked: false };
  }
}

/* ------------------------------------------- device code grant (Twitch only) */

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/**
 * Start a device code flow (RFC 8628).
 *
 * Twitch is the only platform here that needs one, because it documents no PKCE at all. Without
 * PKCE a desktop authorization code flow would have to carry the client secret on the device,
 * and a secret inside a downloadable binary is not a secret. The device flow trades the redirect
 * for a short code the creator types on twitch.tv/activate, and needs no secret on the device.
 *
 * The client secret is deliberately not sent: Twitch's device endpoint takes client_id and
 * scopes, and nothing else.
 */
export async function startDeviceCode(
  platform: BrokerPlatform,
  scopes: string[],
  env: BrokerEnv,
  fetchFn: typeof fetch = fetch,
): Promise<DeviceCodeResponse> {
  const { spec, clientId } = credentials(platform, env);
  if (!spec.deviceUrl) {
    throw new BrokerError(400, platform + ' does not offer a device code sign-in.', 'BAD_REQUEST');
  }
  const res = await fetchFn(spec.deviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, scopes: scopes.join(' ') }).toString(),
  });
  if (res.status === 429) throw new BrokerError(429, 'The platform asked us to slow down.', 'RATE_LIMITED');
  const json = await readJson(res);
  if (!res.ok || typeof json.device_code !== 'string' || typeof json.user_code !== 'string') {
    const desc = typeof json.message === 'string' ? json.message : 'HTTP ' + res.status;
    throw new BrokerError(res.status >= 500 ? 502 : 400, ('Device sign-in failed: ' + desc).slice(0, 300), 'UPSTREAM');
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri:
      typeof json.verification_uri === 'string'
        ? json.verification_uri
        : typeof json.verification_url === 'string'
          ? json.verification_url
          : 'https://www.twitch.tv/activate',
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 1800,
    // RFC 8628's default, and the floor under which a poll earns slow_down instead of an answer.
    interval: typeof json.interval === 'number' && json.interval > 0 ? json.interval : 5,
  };
}

/**
 * Trade a device code for tokens. Resolves `undefined` while the creator has not finished on
 * their phone yet, which is the normal answer to most polls and is not an error.
 */
export async function pollDeviceCode(
  platform: BrokerPlatform,
  deviceCode: string,
  scopes: string[],
  env: BrokerEnv,
  fetchFn: typeof fetch = fetch,
): Promise<TokenSet | undefined> {
  const { spec, clientId } = credentials(platform, env);
  const res = await fetchFn(spec.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      scopes: scopes.join(' '),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString(),
  });
  const json = await readJson(res);
  if (res.ok && typeof json.access_token === 'string') return tokenSet(json);
  const message = typeof json.message === 'string' ? json.message : typeof json.error === 'string' ? json.error : '';
  // authorization_pending and slow_down both mean keep waiting. Twitch answers a not-yet poll
  // with 400, so a 400 with no other explanation is treated as "not yet" rather than as failure.
  if (/pending|slow_down/i.test(message) || res.status === 400) return undefined;
  throw new BrokerError(res.status >= 500 ? 502 : 400, ('Device sign-in failed: ' + (message || 'HTTP ' + res.status)).slice(0, 300), 'UPSTREAM');
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tokenSet(json: Record<string, unknown>): TokenSet {
  const scope =
    typeof json.scope === 'string'
      ? json.scope.split(/[\s,]+/).filter(Boolean)
      : Array.isArray(json.scope)
        ? (json.scope as string[])
        : undefined;
  return {
    accessToken: json.access_token as string,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
    scope,
    tokenType: typeof json.token_type === 'string' ? json.token_type : undefined,
  };
}

// ---------------------------------------------------------------- HTTP plumbing shared by handlers

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof BrokerError) return json(err.status, { error: err.code, message: err.message });
  return json(500, { error: 'INTERNAL', message: 'Unexpected error.' });
}

/**
 * Same-origin check.
 *
 * Why "no Origin header" is allowed, and why that is not a CSRF hole:
 *
 *  - The broker has NO ambient authority. There is no cookie, no session, no
 *    server-side state keyed to a user. A forged cross-site request would be
 *    the attacker exchanging the attacker's own authorization code, and CORS
 *    would stop them reading the response. There is nothing for CSRF to steal.
 *  - A browser cannot reach these handlers cross-site without sending `Origin`
 *    anyway. `readJsonBody` requires `Content-Type: application/json`, which is
 *    not a CORS-simple type, so the request is preflighted; the function
 *    returns no `Access-Control-Allow-*` headers, so the preflight fails and
 *    the POST is never sent. A `<form>` POST needs no preflight but cannot set
 *    that content type, and is refused with 415.
 *  - Omitting `Origin` is therefore only possible for a non-browser client
 *    (curl, the desktop app, tests). That is deliberate: the desktop app posts
 *    here for confidential-client exchanges and has no web origin to send.
 *
 * `Sec-Fetch-Site` is checked as a second, independent signal. Every current
 * browser sends it on every request and page script cannot forge it, so a
 * cross-site (or same-site-but-different-origin) fetch is refused even if some
 * future proxy strips `Origin`. Absent, it falls through to the Origin check.
 */
export function assertSameOrigin(req: Request): void {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new BrokerError(403, 'Cross-origin requests are not allowed.', 'BAD_REQUEST');
  }
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('host');
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new BrokerError(403, 'Bad origin.', 'BAD_REQUEST');
  }
  if (!host || originHost !== host) throw new BrokerError(403, 'Cross-origin requests are not allowed.', 'BAD_REQUEST');
}

/* ------------------------------------------------------------- rate limiting

 * A best-effort, per-instance, in-memory token bucket.
 *
 * BE HONEST ABOUT WHAT THIS IS. Vercel runs these functions in many isolated
 * instances and recycles them freely, so this map is NOT a global rate limit:
 * an attacker with enough concurrency gets roughly (limit x live instances),
 * and a cold start resets the counter. It is still worth having -- it stops one
 * warm instance being used as a free brute-force oracle against a platform's
 * token endpoint, and it costs nothing -- but it is NOT a defence against a
 * distributed attacker.
 *
 * A real limit needs shared state (Vercel KV / Upstash Redis / a Durable
 * Object) keyed on the client IP. That is tracked as an OPEN finding, SEC-W3,
 * in docs/qa/SECURITY_REVIEW.md. Do not mistake this for it.
 */
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Client identity for the limiter: the first hop in x-forwarded-for, else one shared bucket. */
export function rateLimitKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  return first && first.length <= 64 ? first : 'unknown';
}

export function assertWithinRateLimit(
  req: Request,
  now: number = Date.now(),
  max: number = RATE_LIMIT_MAX,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): void {
  const key = rateLimitKey(req);
  // Opportunistic sweep so a long-lived instance cannot grow the map without bound.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new BrokerError(429, 'Too many sign-in attempts. Wait a minute and try again.', 'RATE_LIMITED');
  }
}

/** Test-only: forget every bucket. */
export function resetRateLimit(): void {
  buckets.clear();
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new BrokerError(415, 'Expected application/json.', 'BAD_REQUEST');
  try {
    return await req.json();
  } catch {
    throw new BrokerError(400, 'Invalid JSON.', 'BAD_REQUEST');
  }
}
