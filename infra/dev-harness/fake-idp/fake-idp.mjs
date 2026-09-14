#!/usr/bin/env node
/**
 * LIVETAP fake identity provider and platform API (DEVELOPMENT HARNESS).
 *
 * WHAT THIS IS
 * ------------
 * A single, dependency-free Node server (node:http, node:crypto, node:url only)
 * that speaks enough real OAuth 2.0 and enough real YouTube/Twitch API shape
 * that LIVETAP's PRODUCTION code paths run against it unmodified:
 *
 *   - packages/adapters/src/oauth/pkce.ts generates a real verifier and a real
 *     S256 challenge, and this server really verifies it. A wrong verifier is
 *     rejected with invalid_grant. There is no stub in that path.
 *   - apps/web/api/_lib/broker.ts posts a real form-encoded token exchange and
 *     gets back the standard JSON token set it parses.
 *   - apps/desktop/src/main/oauth.ts binds a loopback port and this server
 *     really 302s to it with code and state.
 *   - packages/adapters/src/real/YouTubeAdapter.ts and TwitchAdapter.ts call
 *     the platform-shaped endpoints below with no changes at all.
 *   - the ingest address handed out points at a LOCAL RTMP server, so the app
 *     gets a stream key from an API and then pushes real bytes to a real
 *     server. That is what makes an end-to-end test end-to-end.
 *
 * WHAT THIS IS NOT
 * ----------------
 * NOT a product. NOT a security boundary. NOT deployable. It mints bearer
 * tokens for anyone who asks, it has no user database, its "consent screen" is
 * a button, and its control surface lets any caller mutate its state. It binds
 * to 127.0.0.1 and refuses to start with NODE_ENV=production. A production
 * build must never be pointed at it. See README.md.
 *
 * Run:  node infra/dev-harness/fake-idp/fake-idp.mjs
 */

import { createServer as createHttpServer } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Codes live 60 seconds, per the task spec and close to every real provider. */
export const AUTH_CODE_TTL_MS = 60_000;

/** How many entries of the request journal /_control keeps. */
const REQUEST_LOG_MAX = 200;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function flag(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return TRUE_VALUES.has(String(value).toLowerCase());
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function list(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Read configuration out of an environment object. Pure, so tests can build a
 * server with an inline env instead of mutating process.env.
 */
export function loadConfig(env = process.env) {
  const shortTokens = flag(env.LIVETAP_FAKE_SHORT_TOKENS, false);
  const ttl = shortTokens ? 5 : integer(env.LIVETAP_FAKE_TOKEN_TTL, 3600);
  return {
    host: env.LIVETAP_FAKE_IDP_HOST ?? '127.0.0.1',
    port: integer(env.LIVETAP_FAKE_IDP_PORT, 8789),
    allowPublicBind: flag(env.LIVETAP_FAKE_IDP_ALLOW_PUBLIC_BIND, false),
    /** Base RTMP URL handed out as the ingest address. Point it at your local RTMP server. */
    ingestBase: (env.LIVETAP_FAKE_INGEST ?? 'rtmp://127.0.0.1:1935/live').replace(/\/+$/, ''),
    tokenTtlSeconds: ttl,
    rotateRefreshToken: flag(env.LIVETAP_FAKE_ROTATE_REFRESH, true),
    requirePkce: flag(env.LIVETAP_FAKE_REQUIRE_PKCE, true),
    requireState: flag(env.LIVETAP_FAKE_REQUIRE_STATE, false),
    requireClientSecret: flag(env.LIVETAP_FAKE_REQUIRE_CLIENT_SECRET, false),
    enforceScopes: flag(env.LIVETAP_FAKE_ENFORCE_SCOPES, true),
    autoApprove: flag(env.LIVETAP_FAKE_AUTO_APPROVE, false),
    clientIds: list(env.LIVETAP_FAKE_CLIENT_IDS, ['livetap-dev-client']),
    clientSecret: env.LIVETAP_FAKE_CLIENT_SECRET ?? 'livetap-dev-secret',
    /** Twitch sends Client-Id on every Helix call; refusing a mismatch proves the app sends it. */
    enforceTwitchClientId: flag(env.LIVETAP_FAKE_ENFORCE_CLIENT_ID, true),
    /** Milliseconds after liveStreams.insert before streamStatus flips to "active". */
    streamActiveAfterMs: integer(env.LIVETAP_FAKE_STREAM_ACTIVE_AFTER_MS, 0),
    account: {
      youtubeChannelId: env.LIVETAP_FAKE_YOUTUBE_CHANNEL_ID ?? 'UCfakeIdpDevChannel0001',
      youtubeTitle: env.LIVETAP_FAKE_YOUTUBE_TITLE ?? 'LIVETAP Dev Channel',
      twitchUserId: env.LIVETAP_FAKE_TWITCH_USER_ID ?? '900001',
      twitchLogin: env.LIVETAP_FAKE_TWITCH_LOGIN ?? 'livetap_dev',
      twitchDisplayName: env.LIVETAP_FAKE_TWITCH_DISPLAY_NAME ?? 'LIVETAP Dev',
    },
    /** Boot-time faults, e.g. "youtube:500,twitch:slow=1500". */
    bootFaults: list(env.LIVETAP_FAKE_FAULT, []),
    nodeEnv: env.NODE_ENV ?? '',
    allowProduction: flag(env.LIVETAP_FAKE_IDP_I_KNOW_THIS_IS_A_HARNESS, false),
  };
}

/** Scopes an endpoint refuses to work without, when enforceScopes is on. */
const REQUIRED_SCOPES = {
  youtube: ['https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube'],
  twitchStreamKey: ['channel:read:stream_key'],
  twitchManageBroadcast: ['channel:manage:broadcast'],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest();
}

function randomId(prefix, bytes = 16) {
  return `${prefix}${randomBytes(bytes).toString('hex')}`;
}

/** Constant-time string compare that does not leak length through an early return. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still burn a comparison so the branch is not a timing signal on its own.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mask anything secret-shaped before it reaches the request journal.
 * The rule list mirrors packages/adapters/src/real/http.ts on purpose: two
 * redaction lists that disagree are worse than one that is slightly too broad.
 */
export function redact(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1****')
    .replace(
      /((?:client_secret|code_verifier|refresh_token|access_token|stream_key|streamkey|password|secret|token|code|key)=)[^&\s]+/gi,
      '$1****',
    )
    .slice(0, 400);
}

/** What /_control is allowed to say about a token: a prefix and a length, never the value. */
export function describeSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return { prefix: value.slice(0, 8), length: value.length };
}

function nowMs() {
  return Date.now();
}

async function readBody(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Accepts both form-encoded (what every OAuth client sends) and JSON bodies. */
function parseBody(raw, contentType) {
  if (!raw) return {};
  if (String(contentType ?? '').includes('application/json')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
  return status;
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(html);
  return status;
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, ...SECURITY_HEADERS });
  res.end();
  return 302;
}

/** Google's error envelope, which packages/adapters http.ts extractMessage() reads. */
function googleError(res, status, reason, message) {
  return sendJson(res, status, {
    error: {
      code: status,
      message,
      errors: [{ message, domain: 'youtube.liveBroadcast', reason }],
      status: status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
    },
  });
}

/** Twitch's error envelope: { error, status, message }. */
function twitchError(res, status, error, message) {
  return sendJson(res, status, { error, status, message });
}

/** RFC 6749 section 5.2 error body. */
function oauthError(res, status, error, description) {
  const headers = status === 401 ? { 'WWW-Authenticate': 'Basic realm="livetap-fake-idp"' } : {};
  return sendJson(res, status, { error, error_description: description }, headers);
}

// ---------------------------------------------------------------------------
// Redirect URI policy
// ---------------------------------------------------------------------------

/**
 * Which redirect_uri values this harness will hand a code to.
 *
 * Deliberately the same shape as apps/web/api/_lib/broker.ts isAllowedRedirectUri:
 * loopback http for the desktop app's ephemeral-port listener, the livetap://
 * private-use scheme, and https for the web app. A harness that accepted
 * anything would let a mistake in the product's redirect handling pass.
 */
export function isAllowedRedirectUri(redirectUri) {
  if (typeof redirectUri !== 'string' || redirectUri.length === 0 || redirectUri.length > 2048) return false;
  if (/[\s\r\n\0]/.test(redirectUri)) return false;
  if (/^livetap:\/\//i.test(redirectUri)) return true;
  let url;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol === 'http:') {
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1';
  }
  return url.protocol === 'https:';
}

// ---------------------------------------------------------------------------
// PKCE verification. This is the part that must be real.
// ---------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const HEX_CHALLENGE_RE = /^[0-9a-f]{64}$/;
const B64URL_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43}$/;

export function isValidCodeChallenge(challenge) {
  return typeof challenge === 'string' && (B64URL_CHALLENGE_RE.test(challenge) || HEX_CHALLENGE_RE.test(challenge));
}

/**
 * RFC 7636 S256 verification, plus TikTok's documented hex deviation, which
 * packages/adapters/src/oauth/pkce.ts also implements. Which encoding to
 * compare is decided by the SHAPE OF THE STORED CHALLENGE, never by anything
 * the token request says, so a client cannot pick the weaker comparison.
 */
export function verifyPkce(codeVerifier, storedChallenge, storedMethod) {
  if (typeof codeVerifier !== 'string' || !VERIFIER_RE.test(codeVerifier)) {
    return { ok: false, reason: 'code_verifier is not 43 to 128 unreserved characters (RFC 7636).' };
  }
  if (storedMethod !== 'S256') {
    return { ok: false, reason: `Unsupported code_challenge_method "${storedMethod}".` };
  }
  const digest = sha256(codeVerifier);
  const expected = HEX_CHALLENGE_RE.test(storedChallenge) ? digest.toString('hex') : base64url(digest);
  if (!safeEqual(expected, storedChallenge)) {
    return { ok: false, reason: 'code_verifier does not match the code_challenge from the authorization request.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fault injection
// ---------------------------------------------------------------------------

export const FAULT_KINDS = ['401', '500', 'slow', 'expired', '429'];

function emptyFaults() {
  return { pending401: 0, fail500: 0, slowMs: 0, rateLimit429: 0 };
}

/** Parse one boot-time fault spec, e.g. "youtube:500" or "twitch:slow=1500". */
export function parseFaultSpec(spec) {
  const [platformRaw, rest] = String(spec).split(':');
  if (!platformRaw || !rest) return null;
  const platform = platformRaw.trim().toLowerCase();
  if (platform !== 'youtube' && platform !== 'twitch') return null;
  const [kindRaw, valueRaw] = rest.split('=');
  const kind = kindRaw.trim().toLowerCase();
  if (!FAULT_KINDS.includes(kind)) return null;
  const count = valueRaw === undefined ? undefined : Number.parseInt(valueRaw, 10);
  return { platform, kind, value: Number.isFinite(count) ? count : undefined };
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

function createState(config) {
  return {
    config,
    startedAt: nowMs(),
    /** request_id -> pending authorization request awaiting a consent decision. */
    pending: new Map(),
    /** code -> authorization code record. */
    codes: new Map(),
    /** access token -> token record. */
    tokens: new Map(),
    /** refresh token -> token record. */
    refresh: new Map(),
    /** token record id -> record, for /_control and revocation bookkeeping. */
    grants: new Map(),
    streams: new Map(),
    broadcasts: new Map(),
    chat: new Map(),
    faults: { youtube: emptyFaults(), twitch: emptyFaults() },
    requestLog: [],
    counters: { authorize: 0, approve: 0, deny: 0, issued: 0, refreshed: 0, revoked: 0, rejected: 0 },
  };
}

function resetState(state) {
  const fresh = createState(state.config);
  for (const key of Object.keys(fresh)) {
    if (key === 'config' || key === 'startedAt') continue;
    state[key] = fresh[key];
  }
  applyBootFaults(state);
}

function applyBootFaults(state) {
  for (const spec of state.config.bootFaults) {
    const parsed = parseFaultSpec(spec);
    if (parsed) injectFault(state, parsed.platform, parsed.kind, parsed.value);
  }
}

export function injectFault(state, platform, kind, value) {
  const bucket = state.faults[platform];
  if (!bucket) return { ok: false, error: `Unknown platform "${platform}".` };
  switch (kind) {
    case '401':
      bucket.pending401 += value ?? 1;
      return { ok: true };
    case '500':
      // Negative means "until cleared"; a count means "this many calls".
      bucket.fail500 = value ?? -1;
      return { ok: true };
    case '429':
      bucket.rateLimit429 = value ?? -1;
      return { ok: true };
    case 'slow':
      bucket.slowMs = value ?? 1500;
      return { ok: true };
    case 'expired':
      for (const grant of state.grants.values()) {
        if (grant.platform === platform && !grant.revoked) grant.expiresAt = nowMs() - 1;
      }
      return { ok: true };
    default:
      return { ok: false, error: `Unknown fault "${kind}". Known: ${FAULT_KINDS.join(', ')}.` };
  }
}

function clearFaults(state, platform) {
  const platforms = platform ? [platform] : ['youtube', 'twitch'];
  for (const name of platforms) {
    if (state.faults[name]) state.faults[name] = emptyFaults();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Apply any fault owed to this platform before the handler runs.
 * Returns the HTTP status written, or null when the call should proceed.
 */
async function applyFaults(state, platform, url, res) {
  const bucket = state.faults[platform];
  const oneShot = url.searchParams.get('_fault');
  const oneShotMs = integer(url.searchParams.get('_faultMs'), 1500);

  if (oneShot === 'slow' || (bucket && bucket.slowMs > 0)) {
    await sleep(oneShot === 'slow' ? oneShotMs : bucket.slowMs);
  }
  if (oneShot === 'expired') {
    injectFault(state, platform, 'expired');
  }
  const fail500 = oneShot === '500' || (bucket && bucket.fail500 !== 0);
  if (fail500) {
    if (bucket && bucket.fail500 > 0) bucket.fail500 -= 1;
    return platform === 'youtube'
      ? googleError(res, 500, 'backendError', 'Injected fault: backend error.')
      : twitchError(res, 500, 'Internal Server Error', 'Injected fault: backend error.');
  }
  const rate429 = oneShot === '429' || (bucket && bucket.rateLimit429 !== 0);
  if (rate429) {
    if (bucket && bucket.rateLimit429 > 0) bucket.rateLimit429 -= 1;
    return platform === 'youtube'
      ? googleError(res, 429, 'rateLimitExceeded', 'Injected fault: rate limited.')
      : twitchError(res, 429, 'Too Many Requests', 'Injected fault: rate limited.');
  }
  const fail401 = oneShot === '401' || (bucket && bucket.pending401 > 0);
  if (fail401) {
    if (bucket && bucket.pending401 > 0) bucket.pending401 -= 1;
    return platform === 'youtube'
      ? googleError(res, 401, 'authError', 'Injected fault: invalid credentials.')
      : twitchError(res, 401, 'Unauthorized', 'Injected fault: invalid OAuth token.');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token issuing
// ---------------------------------------------------------------------------

function scopeList(scope) {
  if (Array.isArray(scope)) return scope.filter((s) => typeof s === 'string');
  return String(scope ?? '')
    .split(/[\s,+]+/)
    .filter(Boolean);
}

function issueTokens(state, { platform, clientId, scope, existingGrant }) {
  const config = state.config;
  const accessToken = randomId(`lt_at_${platform}_`, 24);
  const refreshToken = randomId(`lt_rt_${platform}_`, 24);
  const issuedAt = nowMs();
  const expiresAt = issuedAt + config.tokenTtlSeconds * 1000;

  const grant = existingGrant ?? {
    id: randomUUID(),
    platform,
    clientId,
    scope,
    createdAt: issuedAt,
    refreshCount: 0,
    revoked: false,
  };
  if (existingGrant) {
    state.tokens.delete(existingGrant.accessToken);
    if (config.rotateRefreshToken) state.refresh.delete(existingGrant.refreshToken);
    grant.refreshCount += 1;
  }
  grant.accessToken = accessToken;
  grant.refreshToken = config.rotateRefreshToken || !existingGrant ? refreshToken : existingGrant.refreshToken;
  grant.issuedAt = issuedAt;
  grant.expiresAt = expiresAt;

  state.tokens.set(accessToken, grant);
  state.refresh.set(grant.refreshToken, grant);
  state.grants.set(grant.id, grant);
  if (existingGrant) state.counters.refreshed += 1;
  else state.counters.issued += 1;

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.tokenTtlSeconds,
    refresh_token: grant.refreshToken,
    // Twitch returns scope as an array; Google returns a space-delimited string.
    // The broker parses both, and getting this wrong per platform would hide a bug.
    scope: platform === 'twitch' ? grant.scope : grant.scope.join(' '),
  };
}

function revokeGrant(state, grant) {
  grant.revoked = true;
  grant.revokedAt = nowMs();
  state.tokens.delete(grant.accessToken);
  state.refresh.delete(grant.refreshToken);
  state.counters.revoked += 1;
}

/**
 * Resolve a bearer token for a platform API call.
 * Returns { ok: true, grant } or { ok: false, status, reason }.
 */
function authenticate(state, req, platform) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return { ok: false, status: 401, reason: 'Missing or malformed Authorization header.' };
  const grant = state.tokens.get(match[1]);
  if (!grant || grant.revoked) return { ok: false, status: 401, reason: 'Invalid access token.' };
  if (grant.expiresAt <= nowMs()) return { ok: false, status: 401, reason: 'Access token has expired.' };
  if (grant.platform !== platform) {
    return { ok: false, status: 401, reason: `This token was issued for ${grant.platform}, not ${platform}.` };
  }
  return { ok: true, grant };
}

function hasAnyScope(grant, required) {
  return required.some((scope) => grant.scope.includes(scope));
}

// ---------------------------------------------------------------------------
// /authorize
// ---------------------------------------------------------------------------

function inferPlatform(url, pathPlatform) {
  const explicit = url.searchParams.get('platform');
  if (explicit === 'youtube' || explicit === 'twitch') return explicit;
  if (pathPlatform) return pathPlatform;
  const scope = url.searchParams.get('scope') ?? '';
  if (/googleapis\.com\/auth\/youtube/.test(scope)) return 'youtube';
  if (/channel:|user:read:chat|moderator:/.test(scope)) return 'twitch';
  return 'youtube';
}

function redirectWithError(res, redirectUri, error, description, state) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return sendRedirect(res, url.toString());
}

function handleAuthorize(state, url, res, pathPlatform) {
  const config = state.config;
  state.counters.authorize += 1;
  const params = url.searchParams;
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const responseType = params.get('response_type') ?? '';
  const scope = params.get('scope') ?? '';
  const oauthState = params.get('state') ?? '';
  const challenge = params.get('code_challenge') ?? '';
  const challengeMethod = params.get('code_challenge_method') ?? '';
  const platform = inferPlatform(url, pathPlatform);

  // Errors that must NOT be redirected: an unvalidated client or redirect_uri
  // is exactly what an open redirect is made of (RFC 6749 section 4.1.2.1).
  if (!config.clientIds.includes(clientId)) {
    state.counters.rejected += 1;
    return sendHtml(
      res,
      400,
      errorPage('invalid_client', `Unknown client_id "${escapeHtml(clientId)}". Known: ${config.clientIds.map(escapeHtml).join(', ')}.`),
    );
  }
  if (!isAllowedRedirectUri(redirectUri)) {
    state.counters.rejected += 1;
    return sendHtml(
      res,
      400,
      errorPage('invalid_request', 'redirect_uri must be https, http on loopback, or livetap://. It is not redirected to because it was not validated.'),
    );
  }

  // From here on the redirect_uri is trusted, so errors go back to the client.
  if (responseType !== 'code') {
    state.counters.rejected += 1;
    return redirectWithError(res, redirectUri, 'unsupported_response_type', 'Only response_type=code is supported.', oauthState);
  }
  if (scope.trim().length === 0) {
    state.counters.rejected += 1;
    return redirectWithError(res, redirectUri, 'invalid_scope', 'scope must not be empty.', oauthState);
  }
  if (config.requireState && oauthState.length === 0) {
    state.counters.rejected += 1;
    return redirectWithError(res, redirectUri, 'invalid_request', 'state is required by this harness.', oauthState);
  }
  if (config.requirePkce || challenge.length > 0) {
    if (challengeMethod !== 'S256') {
      state.counters.rejected += 1;
      return redirectWithError(res, redirectUri, 'invalid_request', 'code_challenge_method must be S256.', oauthState);
    }
    if (!isValidCodeChallenge(challenge)) {
      state.counters.rejected += 1;
      return redirectWithError(
        res,
        redirectUri,
        'invalid_request',
        'code_challenge must be a base64url SHA-256 digest (43 chars) or a hex digest (64 chars).',
        oauthState,
      );
    }
  }

  const requestId = randomId('req_', 12);
  state.pending.set(requestId, {
    requestId,
    platform,
    clientId,
    redirectUri,
    scope: scopeList(scope),
    state: oauthState,
    codeChallenge: challenge,
    codeChallengeMethod: challenge ? 'S256' : null,
    createdAt: nowMs(),
  });

  const auto = params.get('auto');
  if (auto === 'approve' || (config.autoApprove && auto !== 'deny')) {
    return decide(state, requestId, 'approve', res);
  }
  if (auto === 'deny') return decide(state, requestId, 'deny', res);

  return sendHtml(res, 200, consentPage(state.pending.get(requestId), config));
}

function decide(state, requestId, decision, res) {
  const pending = state.pending.get(requestId);
  if (!pending) return sendHtml(res, 400, errorPage('invalid_request', 'That sign-in request is unknown or already finished.'));
  state.pending.delete(requestId);

  if (decision !== 'approve') {
    state.counters.deny += 1;
    return redirectWithError(res, pending.redirectUri, 'access_denied', 'The fake account owner denied the request.', pending.state);
  }

  state.counters.approve += 1;
  const code = randomId('lt_code_', 24);
  state.codes.set(code, {
    code,
    platform: pending.platform,
    clientId: pending.clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    issuedAt: nowMs(),
    expiresAt: nowMs() + AUTH_CODE_TTL_MS,
    used: false,
    grantId: null,
  });

  const target = new URL(pending.redirectUri);
  target.searchParams.set('code', code);
  if (pending.state) target.searchParams.set('state', pending.state);
  return sendRedirect(res, target.toString());
}

const PAGE_STYLE =
  'font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.25rem;color:#111';

function consentPage(pending, config) {
  const account = pending.platform === 'youtube' ? config.account.youtubeTitle : config.account.twitchDisplayName;
  const scopes = pending.scope.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>LIVETAP fake IdP</title>
<body style="${PAGE_STYLE}">
<p style="background:#fff4d6;border:1px solid #e0b300;padding:.75rem;border-radius:.5rem">
<strong>Development harness.</strong> No real account is involved and no real token is issued.</p>
<h1>Allow LIVETAP to use <em>${escapeHtml(account)}</em>?</h1>
<p>Platform: <strong>${escapeHtml(pending.platform)}</strong><br>
Client: <code>${escapeHtml(pending.clientId)}</code><br>
Redirect: <code>${escapeHtml(pending.redirectUri)}</code><br>
PKCE: <code>${pending.codeChallenge ? 'S256' : 'none'}</code></p>
<p>Requested scopes:</p><ul>${scopes}</ul>
<p>
<a href="/authorize/decision?request_id=${escapeHtml(pending.requestId)}&amp;decision=approve"
   style="display:inline-block;background:#127c3a;color:#fff;padding:.6rem 1.2rem;border-radius:.4rem;text-decoration:none">Approve</a>
<a href="/authorize/decision?request_id=${escapeHtml(pending.requestId)}&amp;decision=deny"
   style="display:inline-block;margin-left:.75rem;padding:.6rem 1.2rem;border-radius:.4rem;text-decoration:none;color:#a11">Deny</a>
</p></body>`;
}

function errorPage(error, description) {
  return `<!doctype html><meta charset="utf-8"><title>LIVETAP fake IdP</title>
<body style="${PAGE_STYLE}">
<h1>${escapeHtml(error)}</h1><p>${escapeHtml(description)}</p>
<p style="color:#666">This is the LIVETAP development harness, not a real identity provider.</p></body>`;
}

// ---------------------------------------------------------------------------
// /token
// ---------------------------------------------------------------------------

/** Client credentials may arrive in the body or in an HTTP Basic header. */
function clientCredentials(req, body) {
  const header = req.headers.authorization ?? '';
  const basic = /^Basic\s+(\S+)$/i.exec(header);
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const index = decoded.indexOf(':');
    if (index > 0) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, index)),
        clientSecret: decodeURIComponent(decoded.slice(index + 1)),
        fromHeader: true,
      };
    }
  }
  return {
    clientId: typeof body.client_id === 'string' ? body.client_id : '',
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : '',
    fromHeader: false,
  };
}

function checkClient(state, req, body) {
  const config = state.config;
  const { clientId, clientSecret, fromHeader } = clientCredentials(req, body);
  if (!config.clientIds.includes(clientId)) {
    return { ok: false, status: fromHeader ? 401 : 400, error: 'invalid_client', description: 'Unknown client_id.' };
  }
  if (clientSecret.length > 0 && !safeEqual(clientSecret, config.clientSecret)) {
    return { ok: false, status: 401, error: 'invalid_client', description: 'client_secret does not match.' };
  }
  if (clientSecret.length === 0 && config.requireClientSecret) {
    return { ok: false, status: 401, error: 'invalid_client', description: 'client_secret is required by this harness.' };
  }
  return { ok: true, clientId, isConfidential: clientSecret.length > 0 };
}

function handleTokenRequest(state, req, res, body) {
  const grantType = typeof body.grant_type === 'string' ? body.grant_type : '';
  const client = checkClient(state, req, body);
  if (!client.ok) {
    state.counters.rejected += 1;
    return oauthError(res, client.status, client.error, client.description);
  }

  if (grantType === 'authorization_code') return authorizationCodeGrant(state, res, body, client);
  if (grantType === 'refresh_token') return refreshTokenGrant(state, res, body, client);
  state.counters.rejected += 1;
  return oauthError(
    res,
    400,
    'unsupported_grant_type',
    `grant_type "${grantType}" is not supported. Use authorization_code or refresh_token.`,
  );
}

function authorizationCodeGrant(state, res, body, client) {
  const code = typeof body.code === 'string' ? body.code : '';
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : '';
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';

  if (code.length === 0) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_request', 'code is required.');
  }
  const record = state.codes.get(code);
  if (!record) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'Unknown authorization code.');
  }
  if (record.used) {
    // RFC 6749 section 4.1.2: a replayed code SHOULD revoke everything it minted.
    state.counters.rejected += 1;
    if (record.grantId) {
      const grant = state.grants.get(record.grantId);
      if (grant && !grant.revoked) revokeGrant(state, grant);
    }
    return oauthError(res, 400, 'invalid_grant', 'Authorization code has already been used. The tokens it issued were revoked.');
  }
  if (record.expiresAt <= nowMs()) {
    state.codes.delete(code);
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'Authorization code has expired (60 second lifetime).');
  }
  if (record.clientId !== client.clientId) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'This code was issued to a different client_id.');
  }
  if (redirectUri.length === 0) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_request', 'redirect_uri is required for the authorization_code grant.');
  }
  if (redirectUri !== record.redirectUri) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
  }
  if (record.codeChallenge) {
    const result = verifyPkce(verifier, record.codeChallenge, record.codeChallengeMethod);
    if (!result.ok) {
      // The code is NOT consumed here on purpose: PKCE failure means the caller
      // is probably not the client that started the flow, and burning the code
      // would let anyone grief a legitimate sign-in.
      state.counters.rejected += 1;
      return oauthError(res, 400, 'invalid_grant', result.reason);
    }
  } else if (state.config.requirePkce) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_request', 'This harness requires PKCE and this code carries no challenge.');
  }

  record.used = true;
  record.usedAt = nowMs();
  const tokens = issueTokens(state, { platform: record.platform, clientId: client.clientId, scope: record.scope });
  record.grantId = state.tokens.get(tokens.access_token).id;
  return sendJson(res, 200, tokens);
}

function refreshTokenGrant(state, res, body, client) {
  const token = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  if (token.length === 0) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_request', 'refresh_token is required.');
  }
  const grant = state.refresh.get(token);
  if (!grant || grant.revoked) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'Unknown or revoked refresh_token.');
  }
  if (grant.clientId !== client.clientId) {
    state.counters.rejected += 1;
    return oauthError(res, 400, 'invalid_grant', 'This refresh_token belongs to a different client_id.');
  }
  const tokens = issueTokens(state, {
    platform: grant.platform,
    clientId: grant.clientId,
    scope: grant.scope,
    existingGrant: grant,
  });
  return sendJson(res, 200, tokens);
}

/** RFC 7009: always 200, even for an unknown token, so it is not a probe oracle. */
function handleRevoke(state, res, token) {
  const grant = state.tokens.get(token) ?? state.refresh.get(token);
  if (grant && !grant.revoked) revokeGrant(state, grant);
  return sendJson(res, 200, { revoked: Boolean(grant) });
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

function ingestProtocol(base) {
  return base.startsWith('rtmps://') ? 'rtmps' : 'rtmp';
}

/**
 * Only advertise an RTMPS address when the configured ingest really is RTMPS.
 *
 * YouTubeAdapter prefers rtmpsIngestionAddress over ingestionAddress, so
 * emitting a fake rtmps:// field would silently send the encoder somewhere a
 * plain local RTMP server cannot answer, and the end-to-end test would fail for
 * a reason that has nothing to do with the product.
 */
function youtubeIngestionInfo(config, streamKey) {
  const info = {
    streamName: streamKey,
    ingestionAddress: config.ingestBase,
    backupIngestionAddress: config.ingestBase,
  };
  if (ingestProtocol(config.ingestBase) === 'rtmps') {
    info.rtmpsIngestionAddress = config.ingestBase;
    info.rtmpsBackupIngestionAddress = config.ingestBase;
  }
  return info;
}

function twitchIngestList(config) {
  const entry = {
    _id: 1,
    availability: 1,
    default: true,
    name: 'LIVETAP dev harness (local)',
    priority: 0,
    url_template: `${config.ingestBase}/{stream_key}`,
  };
  if (ingestProtocol(config.ingestBase) === 'rtmps') {
    entry.url_template_secure = `${config.ingestBase}/{stream_key}`;
  }
  return { ingests: [entry] };
}

// ---------------------------------------------------------------------------
// YouTube-shaped API
// ---------------------------------------------------------------------------

function streamStatusOf(state, stream) {
  if (stream.forcedActive === true) return 'active';
  if (stream.forcedActive === false) return 'inactive';
  return nowMs() >= stream.activeAt ? 'active' : 'inactive';
}

function streamStatusBlock(state, stream) {
  const streamStatus = streamStatusOf(state, stream);
  return {
    streamStatus,
    healthStatus: {
      status: stream.forcedHealth ?? (streamStatus === 'active' ? 'good' : 'noData'),
      lastUpdateTimeSeconds: Math.floor(nowMs() / 1000),
      configurationIssues: [],
    },
  };
}

function broadcastResource(state, broadcast) {
  return {
    kind: 'youtube#liveBroadcast',
    etag: `etag_${broadcast.id}`,
    id: broadcast.id,
    snippet: {
      title: broadcast.title,
      description: broadcast.description,
      scheduledStartTime: broadcast.scheduledStartTime,
      ...(broadcast.actualStartTime ? { actualStartTime: broadcast.actualStartTime } : {}),
      channelId: state.config.account.youtubeChannelId,
      liveChatId: broadcast.liveChatId,
      isDefaultBroadcast: false,
    },
    status: {
      lifeCycleStatus: broadcast.lifeCycleStatus,
      privacyStatus: broadcast.privacyStatus,
      recordingStatus: broadcast.lifeCycleStatus === 'complete' ? 'recorded' : 'notRecording',
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      boundStreamId: broadcast.boundStreamId ?? undefined,
      enableAutoStart: false,
      enableAutoStop: false,
      enableDvr: true,
      recordFromStart: true,
      monitorStream: { enableMonitorStream: false, broadcastStreamDelayMs: 0 },
    },
  };
}

function streamResource(state, stream) {
  return {
    kind: 'youtube#liveStream',
    etag: `etag_${stream.id}`,
    id: stream.id,
    snippet: { title: stream.title, channelId: state.config.account.youtubeChannelId },
    cdn: {
      ingestionType: 'rtmp',
      resolution: 'variable',
      frameRate: 'variable',
      ingestionInfo: youtubeIngestionInfo(state.config, stream.streamKey),
    },
    status: streamStatusBlock(state, stream),
    contentDetails: { isReusable: false },
  };
}

function listEnvelope(kind, items) {
  return {
    kind,
    etag: `etag_${items.length}`,
    pageInfo: { totalResults: items.length, resultsPerPage: items.length },
    items,
  };
}

function handleYouTube(state, req, res, url, body, publicBase) {
  const config = state.config;
  const auth = authenticate(state, req, 'youtube');
  if (!auth.ok) return googleError(res, auth.status, 'authError', auth.reason);
  if (config.enforceScopes && !hasAnyScope(auth.grant, REQUIRED_SCOPES.youtube)) {
    return googleError(res, 403, 'insufficientPermissions', 'Request had insufficient authentication scopes.');
  }

  const path = url.pathname.replace(/^\/youtube\/v3/, '');
  const method = req.method;

  if (path === '/channels' && method === 'GET') {
    const avatar = `${publicBase}/assets/avatar.svg`;
    return sendJson(
      res,
      200,
      listEnvelope('youtube#channelListResponse', [
        {
          kind: 'youtube#channel',
          etag: 'etag_channel',
          id: config.account.youtubeChannelId,
          snippet: {
            title: config.account.youtubeTitle,
            description: 'Fake channel served by the LIVETAP development harness.',
            customUrl: '@livetap-dev',
            publishedAt: '2020-01-01T00:00:00Z',
            thumbnails: {
              default: { url: avatar, width: 88, height: 88 },
              medium: { url: avatar, width: 240, height: 240 },
              high: { url: avatar, width: 800, height: 800 },
            },
          },
        },
      ]),
    );
  }

  if (path === '/liveStreams' && method === 'POST') {
    const id = randomId('str_', 8);
    const stream = {
      id,
      title: body?.snippet?.title ?? 'LIVETAP stream',
      streamKey: randomId('lt-key-', 12),
      createdAt: nowMs(),
      activeAt: nowMs() + config.streamActiveAfterMs,
      forcedActive: undefined,
      forcedHealth: undefined,
    };
    state.streams.set(id, stream);
    return sendJson(res, 200, streamResource(state, stream));
  }

  if (path === '/liveStreams' && method === 'GET') {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    const items = ids.length
      ? ids.map((id) => state.streams.get(id)).filter(Boolean)
      : [...state.streams.values()];
    return sendJson(res, 200, listEnvelope('youtube#liveStreamListResponse', items.map((s) => streamResource(state, s))));
  }

  if (path === '/liveBroadcasts/bind' && method === 'POST') {
    const broadcastId = url.searchParams.get('id') ?? '';
    const streamId = url.searchParams.get('streamId') ?? '';
    const broadcast = state.broadcasts.get(broadcastId);
    if (!broadcast) return googleError(res, 404, 'liveBroadcastNotFound', 'No such broadcast.');
    if (streamId && !state.streams.has(streamId)) {
      return googleError(res, 404, 'liveStreamNotFound', 'No such stream.');
    }
    broadcast.boundStreamId = streamId || null;
    broadcast.lifeCycleStatus = streamId ? 'ready' : 'created';
    return sendJson(res, 200, broadcastResource(state, broadcast));
  }

  if (path === '/liveBroadcasts/transition' && method === 'POST') {
    const broadcastId = url.searchParams.get('id') ?? '';
    const target = url.searchParams.get('broadcastStatus') ?? '';
    const broadcast = state.broadcasts.get(broadcastId);
    if (!broadcast) return googleError(res, 404, 'liveBroadcastNotFound', 'No such broadcast.');
    if (!['testing', 'live', 'complete'].includes(target)) {
      return googleError(res, 400, 'invalidTransition', `Unknown broadcastStatus "${target}".`);
    }
    if (target === 'live') {
      const stream = broadcast.boundStreamId ? state.streams.get(broadcast.boundStreamId) : undefined;
      if (!stream || streamStatusOf(state, stream) !== 'active') {
        // The real API's most common failure, and the reason the adapter polls
        // liveStreams.list before transitioning. Reproducing it keeps that loop honest.
        return googleError(res, 403, 'errorStreamInactive', 'The bound stream is not active.');
      }
      broadcast.actualStartTime = new Date().toISOString();
    }
    broadcast.lifeCycleStatus = target;
    return sendJson(res, 200, broadcastResource(state, broadcast));
  }

  if (path === '/liveBroadcasts' && method === 'POST') {
    const id = randomId('bc_', 8);
    const broadcast = {
      id,
      title: body?.snippet?.title ?? 'LIVETAP broadcast',
      description: body?.snippet?.description ?? '',
      scheduledStartTime: body?.snippet?.scheduledStartTime ?? new Date().toISOString(),
      privacyStatus: body?.status?.privacyStatus ?? 'public',
      lifeCycleStatus: 'created',
      liveChatId: `lt.chat.${id}`,
      boundStreamId: null,
      createdAt: nowMs(),
    };
    state.broadcasts.set(id, broadcast);
    state.chat.set(broadcast.liveChatId, []);
    return sendJson(res, 200, broadcastResource(state, broadcast));
  }

  if (path === '/liveBroadcasts' && method === 'PUT') {
    const broadcast = state.broadcasts.get(body?.id ?? '');
    if (!broadcast) return googleError(res, 404, 'liveBroadcastNotFound', 'No such broadcast.');
    if (typeof body?.snippet?.title === 'string') broadcast.title = body.snippet.title;
    if (typeof body?.snippet?.description === 'string') broadcast.description = body.snippet.description;
    if (typeof body?.status?.privacyStatus === 'string') broadcast.privacyStatus = body.status.privacyStatus;
    return sendJson(res, 200, broadcastResource(state, broadcast));
  }

  if (path === '/liveBroadcasts' && method === 'GET') {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    const items = ids.length
      ? ids.map((id) => state.broadcasts.get(id)).filter(Boolean)
      : [...state.broadcasts.values()];
    return sendJson(
      res,
      200,
      listEnvelope('youtube#liveBroadcastListResponse', items.map((b) => broadcastResource(state, b))),
    );
  }

  if (path === '/videos' && method === 'GET') {
    const id = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)[0];
    const broadcast = id ? state.broadcasts.get(id) : undefined;
    if (!broadcast) return sendJson(res, 200, listEnvelope('youtube#videoListResponse', []));
    const live = broadcast.lifeCycleStatus === 'live';
    return sendJson(
      res,
      200,
      listEnvelope('youtube#videoListResponse', [
        {
          kind: 'youtube#video',
          id: broadcast.id,
          liveStreamingDetails: {
            // Absent (not zero) when nobody is watching, exactly like the real API.
            ...(live ? { concurrentViewers: '7' } : {}),
            activeLiveChatId: broadcast.liveChatId,
            ...(broadcast.actualStartTime ? { actualStartTime: broadcast.actualStartTime } : {}),
          },
          statistics: { likeCount: '3', viewCount: '11' },
        },
      ]),
    );
  }

  if (path === '/liveChat/messages' && method === 'GET') {
    const liveChatId = url.searchParams.get('liveChatId') ?? '';
    const messages = state.chat.get(liveChatId);
    if (!messages) return googleError(res, 404, 'liveChatNotFound', 'No such live chat.');
    const from = integer(url.searchParams.get('pageToken'), 0);
    const page = messages.slice(from);
    return sendJson(res, 200, {
      kind: 'youtube#liveChatMessageListResponse',
      pollingIntervalMillis: 3000,
      nextPageToken: String(messages.length),
      pageInfo: { totalResults: messages.length, resultsPerPage: page.length },
      items: page,
    });
  }

  if (path === '/liveChat/messages' && method === 'POST') {
    const liveChatId = body?.snippet?.liveChatId ?? '';
    const messages = state.chat.get(liveChatId);
    if (!messages) return googleError(res, 404, 'liveChatNotFound', 'No such live chat.');
    const text = body?.snippet?.textMessageDetails?.messageText ?? '';
    const message = {
      kind: 'youtube#liveChatMessage',
      id: randomId('msg_', 8),
      snippet: {
        type: 'textMessageEvent',
        liveChatId,
        publishedAt: new Date().toISOString(),
        displayMessage: text,
        textMessageDetails: { messageText: text },
      },
      authorDetails: {
        channelId: config.account.youtubeChannelId,
        displayName: config.account.youtubeTitle,
        profileImageUrl: `${publicBase}/assets/avatar.svg`,
        isChatOwner: true,
        isChatModerator: true,
        isChatSponsor: false,
        isVerified: false,
      },
    };
    messages.push(message);
    return sendJson(res, 200, message);
  }

  return googleError(res, 404, 'notFound', `The fake IdP does not implement ${method} ${url.pathname}.`);
}

// ---------------------------------------------------------------------------
// Twitch-shaped API
// ---------------------------------------------------------------------------

function handleTwitch(state, req, res, url, body) {
  const config = state.config;
  const path = url.pathname.replace(/^\/helix/, '');

  // GET /helix/ingests and the real https://ingest.twitch.tv/ingests are both
  // unauthenticated, so the ingest list is answered before the token check.
  if (path === '/ingests' && req.method === 'GET') {
    return sendJson(res, 200, twitchIngestList(config));
  }

  const clientIdHeader = req.headers['client-id'] ?? '';
  if (config.enforceTwitchClientId) {
    if (typeof clientIdHeader !== 'string' || clientIdHeader.length === 0) {
      return twitchError(res, 401, 'Unauthorized', 'Client-Id header is required on every Helix request.');
    }
    if (!config.clientIds.includes(clientIdHeader)) {
      return twitchError(res, 401, 'Unauthorized', 'Client-Id header does not match the token client.');
    }
  }

  const auth = authenticate(state, req, 'twitch');
  if (!auth.ok) return twitchError(res, auth.status, 'Unauthorized', auth.reason);
  const account = config.account;

  if (path === '/users' && req.method === 'GET') {
    return sendJson(res, 200, {
      data: [
        {
          id: account.twitchUserId,
          login: account.twitchLogin,
          display_name: account.twitchDisplayName,
          type: '',
          broadcaster_type: '',
          description: 'Fake user served by the LIVETAP development harness.',
          profile_image_url: `${state.publicBase}/assets/avatar.svg`,
          offline_image_url: '',
          view_count: 0,
          created_at: '2020-01-01T00:00:00Z',
        },
      ],
    });
  }

  if (path === '/streams/key' && req.method === 'GET') {
    if (config.enforceScopes && !hasAnyScope(auth.grant, REQUIRED_SCOPES.twitchStreamKey)) {
      return twitchError(res, 401, 'Unauthorized', 'Missing scope channel:read:stream_key.');
    }
    const broadcasterId = url.searchParams.get('broadcaster_id') ?? '';
    if (broadcasterId !== account.twitchUserId) {
      return twitchError(res, 400, 'Bad Request', 'broadcaster_id does not match the authenticated user.');
    }
    if (!state.twitchStreamKey) state.twitchStreamKey = randomId('live_dev_', 12);
    return sendJson(res, 200, { data: [{ stream_key: state.twitchStreamKey }] });
  }

  if (path === '/streams' && req.method === 'GET') {
    const userId = url.searchParams.get('user_id') ?? '';
    if (!state.twitchLive || userId !== account.twitchUserId) {
      return sendJson(res, 200, { data: [], pagination: {} });
    }
    return sendJson(res, 200, {
      data: [
        {
          id: state.twitchLive.id,
          user_id: account.twitchUserId,
          user_login: account.twitchLogin,
          user_name: account.twitchDisplayName,
          game_id: state.twitchChannel.game_id,
          game_name: 'Just Chatting',
          type: 'live',
          title: state.twitchChannel.title,
          viewer_count: state.twitchLive.viewers,
          started_at: state.twitchLive.startedAt,
          language: 'en',
          thumbnail_url: `${state.publicBase}/assets/avatar.svg`,
          tag_ids: [],
          tags: [],
          is_mature: false,
        },
      ],
      pagination: {},
    });
  }

  if (path === '/channels' && req.method === 'GET') {
    return sendJson(res, 200, {
      data: [
        {
          broadcaster_id: account.twitchUserId,
          broadcaster_login: account.twitchLogin,
          broadcaster_name: account.twitchDisplayName,
          broadcaster_language: 'en',
          game_id: state.twitchChannel.game_id,
          game_name: 'Just Chatting',
          title: state.twitchChannel.title,
          delay: 0,
          tags: [],
        },
      ],
    });
  }

  if (path === '/channels' && req.method === 'PATCH') {
    if (config.enforceScopes && !hasAnyScope(auth.grant, REQUIRED_SCOPES.twitchManageBroadcast)) {
      return twitchError(res, 401, 'Unauthorized', 'Missing scope channel:manage:broadcast.');
    }
    if (typeof body?.title === 'string') state.twitchChannel.title = body.title;
    if (typeof body?.game_id === 'string') state.twitchChannel.game_id = body.game_id;
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return 204;
  }

  if (path === '/chat/messages' && req.method === 'POST') {
    return sendJson(res, 200, {
      data: [{ message_id: randomId('tmsg_', 8), is_sent: true }],
    });
  }

  if (path === '/eventsub/subscriptions') {
    // Honest refusal: EventSub is a WebSocket protocol and this harness is
    // node:http only. Chat over EventSub cannot be exercised here.
    return twitchError(
      res,
      501,
      'Not Implemented',
      'The LIVETAP dev harness does not implement EventSub (it needs a WebSocket server).',
    );
  }

  return twitchError(res, 404, 'Not Found', `The fake IdP does not implement ${req.method} ${url.pathname}.`);
}

// ---------------------------------------------------------------------------
// /_control
// ---------------------------------------------------------------------------

function controlSnapshot(state) {
  const config = state.config;
  return {
    harness: 'livetap-fake-idp',
    warning: 'Development harness. Never deploy this and never point a production build at it.',
    startedAt: new Date(state.startedAt).toISOString(),
    uptimeMs: nowMs() - state.startedAt,
    config: {
      ingestBase: config.ingestBase,
      tokenTtlSeconds: config.tokenTtlSeconds,
      rotateRefreshToken: config.rotateRefreshToken,
      requirePkce: config.requirePkce,
      requireState: config.requireState,
      requireClientSecret: config.requireClientSecret,
      enforceScopes: config.enforceScopes,
      enforceTwitchClientId: config.enforceTwitchClientId,
      autoApprove: config.autoApprove,
      clientIds: config.clientIds,
      streamActiveAfterMs: config.streamActiveAfterMs,
    },
    counters: state.counters,
    pendingAuthorizations: [...state.pending.values()].map((p) => ({
      requestId: p.requestId,
      platform: p.platform,
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      scope: p.scope,
      hasPkce: Boolean(p.codeChallenge),
      ageMs: nowMs() - p.createdAt,
    })),
    codes: [...state.codes.values()].map((c) => ({
      // Never the code itself: it is a bearer credential until it is used.
      code: describeSecret(c.code),
      platform: c.platform,
      clientId: c.clientId,
      redirectUri: c.redirectUri,
      scope: c.scope,
      hasPkce: Boolean(c.codeChallenge),
      used: c.used,
      expired: c.expiresAt <= nowMs(),
    })),
    tokens: [...state.grants.values()].map((g) => ({
      id: g.id,
      platform: g.platform,
      clientId: g.clientId,
      scope: g.scope,
      // Prefix and length only. A full access token must never appear here.
      accessToken: describeSecret(g.accessToken),
      refreshToken: describeSecret(g.refreshToken),
      issuedAt: new Date(g.issuedAt).toISOString(),
      expiresAt: new Date(g.expiresAt).toISOString(),
      expired: g.expiresAt <= nowMs(),
      revoked: g.revoked,
      refreshCount: g.refreshCount,
    })),
    revokedTokenIds: [...state.grants.values()].filter((g) => g.revoked).map((g) => g.id),
    broadcasts: [...state.broadcasts.values()].map((b) => ({
      id: b.id,
      title: b.title,
      privacyStatus: b.privacyStatus,
      lifeCycleStatus: b.lifeCycleStatus,
      boundStreamId: b.boundStreamId,
      liveChatId: b.liveChatId,
      chatMessages: (state.chat.get(b.liveChatId) ?? []).length,
    })),
    streams: [...state.streams.values()].map((s) => ({
      id: s.id,
      title: s.title,
      // The stream key is a secret the encoder pushes with: prefix and length only.
      streamKey: describeSecret(s.streamKey),
      ingestionAddress: state.config.ingestBase,
      streamStatus: streamStatusOf(state, s),
      forcedActive: s.forcedActive ?? null,
    })),
    twitch: {
      channel: state.twitchChannel,
      live: state.twitchLive ? { id: state.twitchLive.id, viewers: state.twitchLive.viewers } : null,
      streamKey: describeSecret(state.twitchStreamKey ?? ''),
    },
    faults: state.faults,
    requestLog: state.requestLog,
  };
}

function handleControlPost(state, res, body) {
  const op = typeof body.op === 'string' ? body.op : '';
  switch (op) {
    case 'reset':
      resetState(state);
      initPlatformState(state);
      return sendJson(res, 200, { ok: true, op, snapshot: controlSnapshot(state) });
    case 'fault': {
      const result = injectFault(state, body.platform, String(body.fault ?? ''), body.count);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });
      return sendJson(res, 200, { ok: true, op, faults: state.faults });
    }
    case 'clearFaults':
      clearFaults(state, body.platform);
      return sendJson(res, 200, { ok: true, op, faults: state.faults });
    case 'streamActive': {
      const stream = state.streams.get(String(body.streamId ?? ''));
      if (!stream) return sendJson(res, 404, { ok: false, error: 'Unknown streamId.' });
      stream.forcedActive = body.active === undefined ? true : Boolean(body.active);
      if (typeof body.health === 'string') stream.forcedHealth = body.health;
      return sendJson(res, 200, { ok: true, op, streamStatus: streamStatusOf(state, stream) });
    }
    case 'twitchLive': {
      const live = body.live === undefined ? true : Boolean(body.live);
      state.twitchLive = live
        ? { id: randomId('tstream_', 6), viewers: integer(body.viewers, 12), startedAt: new Date().toISOString() }
        : null;
      return sendJson(res, 200, { ok: true, op, live: Boolean(state.twitchLive) });
    }
    case 'revokeAll': {
      for (const grant of state.grants.values()) if (!grant.revoked) revokeGrant(state, grant);
      return sendJson(res, 200, { ok: true, op, revoked: state.counters.revoked });
    }
    default:
      return sendJson(res, 400, {
        ok: false,
        error: `Unknown op "${op}".`,
        knownOps: ['reset', 'fault', 'clearFaults', 'streamActive', 'twitchLive', 'revokeAll'],
      });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="LIVETAP dev account">
<rect width="96" height="96" rx="48" fill="#1f6feb"/>
<text x="48" y="60" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">LT</text>
</svg>`;

function initPlatformState(state) {
  state.twitchChannel = { title: 'LIVETAP dev stream', game_id: '509658' };
  state.twitchLive = null;
  state.twitchStreamKey = null;
  state.publicBase = state.publicBase ?? '';
}

function logRequest(state, req, url, status) {
  state.requestLog.push({
    at: new Date().toISOString(),
    method: req.method,
    path: redact(url.pathname + url.search),
    status,
  });
  if (state.requestLog.length > REQUEST_LOG_MAX) state.requestLog.shift();
}

async function route(state, req, res, url) {
  const method = req.method ?? 'GET';
  const path = url.pathname;

  if (path === '/assets/avatar.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(AVATAR_SVG);
    return 200;
  }

  if (path === '/healthz') return sendJson(res, 200, { ok: true, harness: 'livetap-fake-idp' });

  if (path === '/.well-known/openid-configuration' || path === '/.well-known/oauth-authorization-server') {
    const base = state.publicBase;
    return sendJson(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    });
  }

  // /authorize, /token, /revoke, optionally prefixed with a platform so each
  // platform can be given its own endpoint URLs in PLATFORM_OAUTH overrides.
  const oauthMatch = /^(?:\/(youtube|twitch))?\/(authorize|token|revoke)(\/decision)?$/.exec(path);
  if (oauthMatch) {
    const pathPlatform = oauthMatch[1] ?? null;
    const endpoint = oauthMatch[2];
    const isDecision = Boolean(oauthMatch[3]);

    if (endpoint === 'authorize' && isDecision) {
      const requestId = url.searchParams.get('request_id') ?? '';
      const decision = url.searchParams.get('decision') ?? 'deny';
      return decide(state, requestId, decision, res);
    }
    if (endpoint === 'authorize') {
      if (method !== 'GET' && method !== 'HEAD') {
        return oauthError(res, 405, 'invalid_request', 'Use GET for /authorize.');
      }
      return handleAuthorize(state, url, res, pathPlatform);
    }
    if (endpoint === 'token') {
      if (method !== 'POST') return oauthError(res, 405, 'invalid_request', 'Use POST for /token.');
      const raw = await readBody(req);
      const body = parseBody(raw, req.headers['content-type']);
      return handleTokenRequest(state, req, res, body);
    }
    // /revoke: Google accepts the token as a query param, RFC 7009 wants a form post.
    const raw = method === 'POST' ? await readBody(req) : '';
    const body = parseBody(raw, req.headers['content-type']);
    const token = (typeof body.token === 'string' && body.token) || url.searchParams.get('token') || '';
    if (!token) return oauthError(res, 400, 'invalid_request', 'token is required.');
    return handleRevoke(state, res, token);
  }

  if (path === '/_control') {
    if (method === 'GET') return sendJson(res, 200, controlSnapshot(state));
    if (method === 'POST') {
      const raw = await readBody(req);
      const body = parseBody(raw, req.headers['content-type'] ?? 'application/json');
      return handleControlPost(state, res, body);
    }
    return sendJson(res, 405, { ok: false, error: 'Use GET or POST on /_control.' });
  }

  if (path.startsWith('/youtube/v3/')) {
    const faulted = await applyFaults(state, 'youtube', url, res);
    if (faulted !== null) return faulted;
    const raw = method === 'POST' || method === 'PUT' ? await readBody(req) : '';
    const body = parseBody(raw, req.headers['content-type'] ?? 'application/json');
    return handleYouTube(state, req, res, url, body, state.publicBase);
  }

  if (path.startsWith('/helix/') || path === '/ingests') {
    const faulted = await applyFaults(state, 'twitch', url, res);
    if (faulted !== null) return faulted;
    if (path === '/ingests') return sendJson(res, 200, twitchIngestList(state.config));
    const raw = method === 'POST' || method === 'PATCH' || method === 'PUT' ? await readBody(req) : '';
    const body = parseBody(raw, req.headers['content-type'] ?? 'application/json');
    return handleTwitch(state, req, res, url, body);
  }

  if (path === '/') return sendHtml(res, 200, indexPage(state));

  return sendJson(res, 404, { error: 'not_found', error_description: `No route for ${method} ${path}.` });
}

function indexPage(state) {
  const base = escapeHtml(state.publicBase);
  return `<!doctype html><meta charset="utf-8"><title>LIVETAP fake IdP</title>
<body style="${PAGE_STYLE}">
<p style="background:#fff4d6;border:1px solid #e0b300;padding:.75rem;border-radius:.5rem">
<strong>LIVETAP development harness.</strong> Not a real identity provider. Never deploy this.</p>
<h1>Fake IdP</h1>
<ul>
<li><code>${base}/authorize</code></li>
<li><code>${base}/token</code></li>
<li><code>${base}/revoke</code></li>
<li><code>${base}/youtube/v3</code> (YouTube adapter apiBase)</li>
<li><code>${base}/helix</code> (Twitch adapter apiBase)</li>
<li><code>${base}/_control</code></li>
</ul>
<p>Ingest handed out: <code>${escapeHtml(state.config.ingestBase)}</code></p>
<p>See <code>infra/dev-harness/fake-idp/README.md</code>.</p></body>`;
}

// ---------------------------------------------------------------------------
// Server construction
// ---------------------------------------------------------------------------

/**
 * Build (but do not listen on) the harness server.
 * Returns the node http.Server with a `livetapState` property for tests.
 */
export function createServer(options = {}) {
  const config = options.config ?? loadConfig(options.env ?? process.env);
  const state = createState(config);
  initPlatformState(state);
  applyBootFaults(state);

  const server = createHttpServer((req, res) => {
    // The Host header decides the absolute URLs handed back (avatars, discovery).
    // It is client-controlled, which is fine here: nothing is authorized by it,
    // and a harness that hard-coded a port could not be run on port 0 in tests.
    const host = typeof req.headers.host === 'string' && /^[\w.\-[\]]+(:\d+)?$/.test(req.headers.host)
      ? req.headers.host
      : `${config.host}:${config.port}`;
    state.publicBase = `http://${host}`;

    let url;
    try {
      url = new URL(req.url ?? '/', state.publicBase);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    route(state, req, res, url)
      .then((status) => logRequest(state, req, url, status ?? res.statusCode))
      .catch((err) => {
        logRequest(state, req, url, 500);
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'server_error', error_description: redact(String(err && err.message)) });
        } else {
          res.end();
        }
      });
  });

  server.livetapState = state;
  return server;
}

/** Bind the server. Pass port 0 for an ephemeral port (what the tests use). */
export function start(options = {}) {
  const config = options.config ?? loadConfig(options.env ?? process.env);
  if (config.nodeEnv === 'production' && !config.allowProduction) {
    throw new Error(
      'The LIVETAP fake IdP refuses to run with NODE_ENV=production. It is a development harness, not a service.',
    );
  }
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.allowPublicBind) {
    throw new Error(
      `Refusing to bind the fake IdP to ${config.host}. It mints tokens for anyone who asks. Set LIVETAP_FAKE_IDP_ALLOW_PUBLIC_BIND=1 if you truly mean it.`,
    );
  }
  const server = createServer({ config });
  const port = options.port ?? config.port;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, config.host, () => {
      server.off('error', reject);
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      server.livetapState.publicBase = `http://${config.host}:${bound}`;
      resolve({ server, port: bound, baseUrl: `http://${config.host}:${bound}`, config });
    });
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  // start() validates before it binds and can throw synchronously, so it is
  // wrapped rather than called bare: a refusal should print one clear line,
  // not a stack trace.
  Promise.resolve()
    .then(() => start())
    .then(({ baseUrl, config }) => {
      const lines = [
        '',
        '  LIVETAP fake identity provider  (DEVELOPMENT HARNESS, never deploy)',
        `  listening            ${baseUrl}`,
        `  authorize            ${baseUrl}/authorize`,
        `  token                ${baseUrl}/token`,
        `  revoke               ${baseUrl}/revoke`,
        `  youtube apiBase      ${baseUrl}/youtube/v3`,
        `  twitch apiBase       ${baseUrl}/helix`,
        `  control              ${baseUrl}/_control`,
        `  ingest handed out    ${config.ingestBase}`,
        `  access token ttl     ${config.tokenTtlSeconds}s`,
        `  client ids           ${config.clientIds.join(', ')}`,
        '',
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    })
    .catch((err) => {
      process.stderr.write(`fake-idp failed to start: ${err.message}\n`);
      process.exitCode = 1;
    });
}
