/**
 * The client for the relay's session API — the link that was missing.
 *
 * `infra/relay/session-api/relay-session.mjs` has existed and been tested for some time, and
 * `packages/media/src/browser/deps.ts:110` documents the contract it serves:
 * `POST /sessions -> { whipUrl }`. Nothing called it. `relayOptions()` in `engine.ts` reads a
 * STATIC `VITE_LIVETAP_RELAY_WHIP_URL` out of the build environment, so the only way web go-live
 * could ever have worked was for somebody to create a relay session by hand and bake its URL into
 * the bundle. The destination list never reached the relay at runtime, which means the relay never
 * knew where to forward. That is the sense in which the relay was "an unused docker directory":
 * not unwritten, unconnected.
 *
 * WHY THE RELAY EXISTS AT ALL, because it explains every decision below. A browser has no RTMP
 * socket, so the web surface cannot reach a platform directly. It also must never hold a stream
 * key long enough to leak one — a key is a password for someone's channel. So the browser sends
 * the destination list here ONCE, over TLS, and receives back only a WHIP URL. From that moment
 * the keys live server-side and the browser publishes media to a URL that is useless to anyone
 * who steals it after the session ends.
 *
 * PER CONNECTION, NOT PER PLATFORM. `destinations` carries one entry per destination id, which is
 * one per authorized account now that connections are keyed that way. Two YouTube channels are two
 * entries with two stream keys and two rows in the relay's forward list. Collapsing them by
 * platform would make multi-account look right in the UI and broadcast to one channel.
 */
import type { AspectRatio, DestinationConfig } from '@livetap/core';

/** What the relay's `POST /sessions` answers with. */
export interface RelaySession {
  readonly sessionId: string;
  readonly whipUrl: string;
  /**
   * Sent as `Authorization: Bearer <user>:<pass>` on the WHIP POST.
   * MediaMTX splits on the first colon and rejects a bare password with 401.
   */
  readonly whipAuthorization?: string;
  /**
   * The same session, for a publisher that speaks RTMP rather than WHIP — which on this product
   * means an Android handset, whose native encoder has an RTMP socket and no WHIP client. It is
   * the same MediaMTX path and the same forward list; only the way in differs.
   *
   * This is what lets a phone reach more than one destination at all. The device encodes once,
   * publishes once, and the relay fans out, instead of the handset attempting an RTMP socket per
   * destination — which it cannot do, and which is why mobile was capped at one.
   *
   * Absent from an older relay that does not advertise it, so a caller must treat it as optional
   * and say so rather than publishing to `undefined`.
   */
  readonly rtmpUrl?: string;
  /** `<user>:<pass>`, applied through the encoder's own auth. Never embedded in `rtmpUrl`. */
  readonly rtmpAuthorization?: string;
}

/** One destination, in the shape `validateIngest()` on the relay accepts. */
interface RelayDestination {
  readonly url: string;
  readonly streamKey?: string;
  readonly protocol?: string;
  readonly aspectRatio?: AspectRatio;
}

export interface OpenRelayOptions {
  readonly baseUrl: string;
  /** Bearer token the relay compares in constant time. Absent on an unauthenticated dev relay. */
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Build the relay's view of a destination from the app's own config.
 *
 * Exported for the tests, and because this is the one place a stream key is deliberately read out
 * of the config to be sent somewhere. It is worth being able to point at that line.
 */
export function toRelayDestination(
  config: DestinationConfig,
  streamKey: string | undefined,
): RelayDestination | null {
  const ingest = config.ingest;
  if (!ingest?.url) return null;
  return {
    url: ingest.url,
    ...(streamKey ? { streamKey } : {}),
    ...(ingest.protocol ? { protocol: ingest.protocol } : {}),
    aspectRatio: config.aspectRatio,
  };
}

function trimSlashes(base: string): string {
  return base.replace(/\/+$/, '');
}

/**
 * Open a relay session for this broadcast.
 *
 * The relay refuses more than ten destinations, refuses anything that is not RTMP or RTMPS, and
 * refuses private or loopback hosts — all of which are its decisions to make, not this client's.
 * So the errors it returns are surfaced verbatim rather than summarised: "this relay is not
 * configured for 9:16 re-encoding" is something a creator's operator can act on, and
 * "relay rejected the request" is not.
 */
export async function openRelaySession(
  destinations: readonly RelayDestination[],
  options: OpenRelayOptions,
): Promise<RelaySession> {
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) throw new RelayError('This browser has no fetch, so the relay cannot be reached.');
  if (destinations.length === 0) throw new RelayError('A relay session needs at least one destination.');

  let response: Response;
  try {
    response = await doFetch(`${trimSlashes(options.baseUrl)}/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify({ destinations }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    // A relay that cannot be reached is the single most likely failure, and the message a creator
    // sees should say which machine is not answering rather than "fetch failed".
    throw new RelayError(
      `The relay at ${trimSlashes(options.baseUrl)} did not answer. It may be offline.`,
    );
  }

  if (!response.ok) {
    const detail = await readErrors(response);
    throw new RelayError(
      detail ? `The relay refused this broadcast: ${detail}` : `The relay refused this broadcast.`,
      response.status,
    );
  }

  const body = (await response.json()) as Partial<RelaySession>;
  if (!body.whipUrl || !body.sessionId) {
    throw new RelayError('The relay answered without a session. It may be a different service.');
  }
  return {
    sessionId: body.sessionId,
    whipUrl: body.whipUrl,
    ...(body.whipAuthorization ? { whipAuthorization: body.whipAuthorization } : {}),
    ...(body.rtmpUrl ? { rtmpUrl: body.rtmpUrl } : {}),
    ...(body.rtmpAuthorization ? { rtmpAuthorization: body.rtmpAuthorization } : {}),
  };
}

/**
 * Close a relay session.
 *
 * NEVER THROWS. This runs on the END path, and a relay that has already forgotten the session —
 * because it restarted, or because the session timed out — must not be able to stop a creator
 * ending their broadcast. The session is torn down server-side by its own timeout in that case.
 * Returns whether the relay confirmed it, for callers that want to say so.
 */
export async function closeRelaySession(
  sessionId: string,
  options: OpenRelayOptions,
): Promise<boolean> {
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) return false;
  try {
    const response = await doFetch(`${trimSlashes(options.baseUrl)}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Pull the actionable part out of a refusal.
 *
 * The relay's 400 is `{ error: 'Invalid destinations.', details: [...] }` — the summary in
 * `error` and the part worth reading in `details`, indexed per destination
 * (`destinations[1]: Stream key is required.`). Reading only `error` would show a creator
 * "Invalid destinations." and throw away the sentence that says which one and why.
 *
 * SAFE TO DISPLAY. The relay describes what is wrong without echoing the value — "Stream key
 * contains characters that are not allowed", never the key — and addresses destinations by index.
 * That is what makes it safe to put this text in a notice, which is rendered and kept in the log.
 * If that ever stops being true on the relay side, this is the line that leaks it.
 */
async function readErrors(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: unknown; details?: unknown; error?: unknown };
    const list = Array.isArray(body.details) ? body.details : Array.isArray(body.errors) ? body.errors : null;
    const detail = list ? list.filter((e) => typeof e === 'string').join('; ') : '';
    if (detail) return detail;
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* A relay that answers non-JSON tells us nothing useful; the status code already did. */
  }
  return '';
}
