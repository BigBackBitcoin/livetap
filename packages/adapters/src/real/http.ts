import type { CredentialRef } from '@livetap/core';

/**
 * Minimal structural types for the pieces of `fetch` the real adapters use.
 *
 * Declared structurally (rather than depending on DOM/undici types) so tests can inject a
 * recorded fake and so nothing but the standard Node 20 global is needed at runtime.
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

/** Resolves an access token for a credential handle. Adapters never see the stored secret. */
export type TokenProvider = (credential?: CredentialRef) => Promise<string>;

/** Options every real adapter takes. Secrets stay outside the adapter, behind tokenProvider. */
export interface RealAdapterOptions {
  fetch: FetchLike;
  tokenProvider: TokenProvider;
  /** Override the API base (tests, proxies, API-version pinning). */
  apiBase?: string;
  /** Injectable sleep so poll loops are instant in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * An HTTP failure shaped so core's `classifyFailure({ status, message })` can map it to an
 * ErrorCode (401 -> AUTH_EXPIRED, 403 + "quota" -> QUOTA_EXCEEDED, 429 -> RATE_LIMITED, ...).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, message: string, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = redact(url);
  }
}

/**
 * Strip anything secret-shaped from a string before it can reach a log or an error message.
 *
 * SEC-A4 (2026-09 security review): the previous rule set covered bearer
 * tokens, a handful of query parameters and the RTMP stream-key path segment,
 * but NOT the credentials the SRT and WHIP paths carry (`passphrase=`,
 * `streamid=`), nor `password=`/`signature=`/`authorization=`, nor userinfo in
 * a URL (`rtsp://user:pass@host`). Those are exactly the fields
 * `packages/core`'s `redactSecrets` handles, and the two lists must not
 * disagree: a reader who sees one of them let a value through cannot tell
 * whether the other would have masked it.
 *
 * Ordered longest-match-first so `refresh_token=` is not half-matched by the
 * shorter `token=` alternative.
 */
export function redact(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1••••')
    .replace(
      /((?:client_secret|code_verifier|refresh_token|access_token|id_token|stream_key|streamkey|passphrase|authorization|streamid|password|signature|secret|token|code|key|auth|pwd|sig)=)[^&\s]+/gi,
      '$1••••',
    )
    .replace(/(rtmps?:\/\/[^\s]+\/)([^\s/?]+)/gi, '$1••••')
    .replace(/((?:rtsps?|srt|https?|wss?):\/\/)[^\s@/]*@/gi, '$1••••@')
    .slice(0, 500);
}

export interface RequestSpec {
  url: string;
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  /** Serialized as JSON with a JSON content type. */
  json?: unknown;
  /** Serialized as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
}

/**
 * One place where every real adapter's HTTP goes, so auth headers, error mapping and
 * redaction are identical everywhere. Returns `undefined` for empty bodies (e.g. HTTP 204).
 */
export async function request<T>(fetchImpl: FetchLike, spec: RequestSpec): Promise<T | undefined> {
  const headers: Record<string, string> = { Accept: 'application/json', ...spec.headers };
  if (spec.token) headers['Authorization'] = `Bearer ${spec.token}`;
  let body: string | undefined;
  if (spec.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(spec.json);
  } else if (spec.form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(spec.form).toString();
  }

  const init: FetchInit = { method: spec.method ?? 'GET', headers };
  if (body !== undefined) init.body = body;

  const response = await fetchImpl(spec.url, init);
  const raw = await safeText(response);
  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(response, raw), spec.url);
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function errorMessage(response: FetchResponse, raw: string): string {
  const detail = extractMessage(raw) ?? response.statusText ?? '';
  const head = `HTTP ${response.status}`;
  return redact(detail ? `${head}: ${detail}` : head);
}

/** Pulls the human-readable part out of the several error envelopes these platforms use. */
function extractMessage(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      // Google: { error: { message, errors: [{ reason }] } }
      const err = obj['error'];
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        const reasons = Array.isArray(e['errors'])
          ? (e['errors'] as Array<Record<string, unknown>>)
              .map((x) => (typeof x['reason'] === 'string' ? x['reason'] : undefined))
              .filter((x): x is string => Boolean(x))
          : [];
        const msg = typeof e['message'] === 'string' ? e['message'] : undefined;
        if (msg || reasons.length) return [msg, ...reasons].filter(Boolean).join(' ');
      }
      // Twitch/Kick: { message } or { error_description }
      for (const key of ['message', 'error_description', 'error_message', 'detail']) {
        const v = obj[key];
        if (typeof v === 'string' && v) return v;
      }
    }
  } catch {
    // Not JSON: fall through to the raw body.
  }
  return raw.slice(0, 200);
}

async function safeText(response: FetchResponse): Promise<string> {
  try {
    return (await response.text()) ?? '';
  } catch {
    return '';
  }
}

/** Builds a URL with query params, skipping undefined values. */
export function withQuery(
  base: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
