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
}

const SPECS: Record<BrokerPlatform, PlatformSpec> = {
  // https://developers.google.com/identity/protocols/oauth2/web-server-app#exchange-authorization-code
  youtube: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdVar: 'LIVETAP_YOUTUBE_CLIENT_ID',
    clientSecretVar: 'LIVETAP_YOUTUBE_CLIENT_SECRET',
    body: 'form',
  },
  // https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
  twitch: {
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    clientIdVar: 'LIVETAP_TWITCH_CLIENT_ID',
    clientSecretVar: 'LIVETAP_TWITCH_CLIENT_SECRET',
    body: 'form',
  },
  // https://docs.kick.com/getting-started/generating-tokens-oauth2-flow
  kick: {
    tokenUrl: 'https://id.kick.com/oauth/token',
    clientIdVar: 'LIVETAP_KICK_CLIENT_ID',
    clientSecretVar: 'LIVETAP_KICK_CLIENT_SECRET',
    body: 'form',
  },
  // https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#exchangecode
  facebook: {
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    clientIdVar: 'LIVETAP_FACEBOOK_APP_ID',
    clientSecretVar: 'LIVETAP_FACEBOOK_APP_SECRET',
    body: 'form',
  },
};

export const BROKER_PLATFORMS = Object.keys(SPECS) as BrokerPlatform[];

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

export function validateExchangeInput(body: unknown): ExchangeInput {
  if (!body || typeof body !== 'object') throw new BrokerError(400, 'Body must be a JSON object.', 'BAD_REQUEST');
  const b = body as Record<string, unknown>;
  if (!isBrokerPlatform(b.platform)) throw new BrokerError(400, 'Unknown platform.', 'BAD_REQUEST');
  if (typeof b.code !== 'string' || b.code.length < 4 || b.code.length > 2048) throw new BrokerError(400, 'Missing code.', 'BAD_REQUEST');
  if (typeof b.redirectUri !== 'string' || !REDIRECT_RE.test(b.redirectUri)) throw new BrokerError(400, 'Invalid redirectUri.', 'BAD_REQUEST');
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
  const spec = SPECS[platform];
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
  return postToken(
    spec,
    { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: clientId, client_secret: clientSecret },
    fetchFn,
  );
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

/** Same-origin check: browsers send Origin on cross-origin POSTs; we only accept our own origin or none (curl/tests). */
export function assertSameOrigin(req: Request): void {
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

export async function readJsonBody(req: Request): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new BrokerError(415, 'Expected application/json.', 'BAD_REQUEST');
  try {
    return await req.json();
  } catch {
    throw new BrokerError(400, 'Invalid JSON.', 'BAD_REQUEST');
  }
}
