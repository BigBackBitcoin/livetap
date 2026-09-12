/**
 * Twitch ingest (PoP) selection from the official, unauthenticated ingest list.
 *
 * The adapter used to hard-code `rtmp://live.twitch.tv/app`, which is only a SECONDARY-sourced
 * claim (see docs/research/PLATFORM_YOUTUBE_TWITCH_KICK.md §2.3/§2.7 item 10). What the official
 * docs actually give is the URL *form* `rtmp://<ingest-server>/app/<stream-key>` plus
 * `GET https://ingest.twitch.tv/ingests` — no auth — as the source of the server list. So the
 * honest implementation is: ask Twitch which PoP to use, cache the answer, and fall back to the
 * old default only when the list cannot be read.
 *
 * The list entries look like:
 *   { name, url_template: "rtmp://<host>/app/{stream_key}", url_template_secure: "rtmps://...",
 *     priority, availability, default }
 *
 * Design notes:
 * - RTMPS is preferred whenever the entry offers it. Ingest carries the stream key in the URL
 *   path; on plaintext RTMP that key is readable by anything on the wire.
 * - Nothing here ever touches the stream key. `resolveIngest` returns a *keyless* base URL and
 *   the adapter appends nothing — the key travels in `IngestTarget.streamKey`, so a note or an
 *   error message produced in this module cannot leak it.
 * - The list is remote data, so every field is validated: an entry can move where LIVETAP pushes
 *   bytes, and a `ws://`-style downgrade or a junk host must never be obeyed.
 */
import { redact, request, type FetchLike } from './http.js';

/** Official ingest list. Documented at https://dev.twitch.tv/docs/video-broadcast/reference/. */
export const TWITCH_INGEST_LIST_URL = 'https://ingest.twitch.tv/ingests';

/**
 * UNVERIFIED (secondary-sourced): `rtmp://live.twitch.tv/app` is widely used but the official
 * docs never name it. It stays only as the last resort when the ingest list is unreachable.
 */
export const TWITCH_FALLBACK_INGEST_URL = 'rtmp://live.twitch.tv/app';

/** The PoP list is stable; re-fetching it per go-live would be pointless traffic. */
export const TWITCH_INGEST_CACHE_MS = 60 * 60 * 1000;

/**
 * A *failed* lookup is cached far more briefly than a successful one. Caching the fallback for a
 * full hour would pin a whole session to the secondary-sourced default because of one blip.
 */
export const TWITCH_INGEST_RETRY_MS = 60 * 1000;

export interface ResolvedIngest {
  protocol: 'rtmp' | 'rtmps';
  /** Keyless base URL, e.g. `rtmps://sfo.contribute.live-video.net/app`. */
  url: string;
}

export interface IngestResolution extends ResolvedIngest {
  /** PoP name from the list. Absent when the fallback was used. */
  name?: string;
  /**
   * Non-secret explanation of why the official list was not used. Absent on success. Shaped to be
   * safe for a diagnostics panel or a log line: it never contains a key, token or URL credential.
   */
  technical?: string;
}

/**
 * Caller-owned cache slot. Deliberately not module-level state: a global cache would leak across
 * adapter instances and across tests, and would be impossible to reset.
 */
export interface IngestCache {
  value?: IngestResolution;
  expiresAt?: number;
}

export function createIngestCache(): IngestCache {
  return {};
}

export interface ResolveIngestOptions {
  cache?: IngestCache;
  /** Injectable clock so cache expiry is testable without waiting an hour. */
  now?: () => number;
  ttlMs?: number;
  retryMs?: number;
  listUrl?: string;
  fallback?: ResolvedIngest;
}

interface IngestListBody {
  ingests?: unknown;
}

interface IngestEntry {
  name?: unknown;
  url_template?: unknown;
  url_template_secure?: unknown;
  priority?: unknown;
  availability?: unknown;
  default?: unknown;
}

/**
 * Resolve the ingest server to push to, preferring the official list and degrading honestly.
 *
 * Never throws: a destination must not fail to go live because a PoP-selection nicety was
 * unreachable. A failure returns the fallback plus a `technical` note.
 */
export async function resolveIngest(
  fetchImpl: FetchLike,
  options: ResolveIngestOptions = {},
): Promise<IngestResolution> {
  const now = options.now ?? Date.now;
  const at = now();
  const cache = options.cache;
  if (cache?.value !== undefined && cache.expiresAt !== undefined && at < cache.expiresAt) {
    return cache.value;
  }

  const fallback: ResolvedIngest = options.fallback ?? {
    protocol: 'rtmp',
    url: TWITCH_FALLBACK_INGEST_URL,
  };

  let resolution: IngestResolution;
  try {
    const body = await request<IngestListBody>(fetchImpl, {
      url: options.listUrl ?? TWITCH_INGEST_LIST_URL,
    });
    const picked = selectIngest(body?.ingests);
    resolution =
      picked ?? {
        ...fallback,
        technical: 'Twitch ingest list had no usable server; using the default ingest.',
      };
  } catch (err) {
    resolution = {
      ...fallback,
      technical: `Twitch ingest list unavailable (${describeError(err)}); using the default ingest.`,
    };
  }

  if (cache) {
    cache.value = resolution;
    const ttl =
      resolution.technical === undefined
        ? (options.ttlMs ?? TWITCH_INGEST_CACHE_MS)
        : (options.retryMs ?? TWITCH_INGEST_RETRY_MS);
    cache.expiresAt = at + ttl;
  }
  return resolution;
}

/**
 * Pick one entry out of the list: the `default: true` server if there is one, otherwise the
 * lowest `priority`. Entries Twitch reports as unavailable (`availability` < 1) are skipped
 * either way — a downed PoP is worse than a distant one.
 *
 * Exported for tests and for a future "let the user override the PoP" UI.
 */
export function selectIngest(raw: unknown): IngestResolution | undefined {
  if (!Array.isArray(raw)) return undefined;

  interface Candidate {
    ingest: ResolvedIngest;
    priority: number;
    isDefault: boolean;
    name: string | undefined;
  }
  const candidates: Candidate[] = [];

  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as IngestEntry;
    // `availability` is 1.0 for up and 0.0 for down. A missing/non-numeric value means Twitch
    // did not report it, which is not the same as "down": a documented `url_template` is still
    // a better answer than the secondary-sourced fallback.
    if (typeof entry.availability === 'number' && !(entry.availability >= 1)) continue;
    // RTMPS first: the stream key rides in the ingest URL path.
    const ingest =
      ingestFromTemplate(entry.url_template_secure) ?? ingestFromTemplate(entry.url_template);
    if (!ingest) continue;
    candidates.push({
      ingest,
      priority:
        typeof entry.priority === 'number' && Number.isFinite(entry.priority)
          ? entry.priority
          : Number.MAX_SAFE_INTEGER,
      isDefault: entry.default === true,
      name: typeof entry.name === 'string' && entry.name.length <= 200 ? entry.name : undefined,
    });
  }

  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    if (candidate.isDefault !== best.isDefault) {
      if (candidate.isDefault) best = candidate;
      continue;
    }
    if (candidate.priority < best.priority) best = candidate;
  }
  if (!best) return undefined;
  return { ...best.ingest, ...(best.name !== undefined ? { name: best.name } : {}) };
}

/**
 * Turn `rtmp://<host>/app/{stream_key}` into a keyless base URL, rejecting anything that is not
 * a plain RTMP/RTMPS URL with a host. The template is remote data: it decides where LIVETAP
 * points its encoder, so a scheme outside the allow-list, an embedded credential, control
 * characters or a missing host all mean "unusable", not "try it anyway".
 */
export function ingestFromTemplate(template: unknown): ResolvedIngest | undefined {
  if (typeof template !== 'string') return undefined;
  const trimmed = template.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return undefined;
  if (/[\s\0]/.test(trimmed)) return undefined;

  const keyless = trimmed.replace(/\{stream_key\}\s*$/i, '').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(keyless);
  } catch {
    return undefined;
  }
  const protocol =
    parsed.protocol === 'rtmps:' ? 'rtmps' : parsed.protocol === 'rtmp:' ? 'rtmp' : undefined;
  if (protocol === undefined) return undefined;
  if (parsed.hostname.length === 0) return undefined;
  // `rtmp://user:pass@host/app` would smuggle a credential into a value we log and display.
  if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
  return { protocol, url: keyless };
}

/** A short, redacted description of a failure, safe to put in a `technical` note. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const message = redact(err.message);
    return message.length > 0 ? message.slice(0, 160) : err.name;
  }
  return 'unknown error';
}
