import {
  supportsFromProfile,
  type AnalyticsSnapshot,
  type BroadcastHandle,
  type BroadcastMetadata,
  type CapabilityKey,
  type ChatMessage,
  type ChatSubscription,
  type CredentialRef,
  type DestinationAdapter,
  type DestinationConfig,
  type ErrorCode,
  type IngestTarget,
  type LiveStatus,
  type ModerationRequest,
  type PlatformProfile,
} from '@livetap/core';
import { twitchProfile } from '../profiles/index.js';
import {
  request,
  withQuery,
  type FetchLike,
  type RealAdapterOptions,
  type TokenProvider,
} from './http.js';
import {
  messageText,
  realTimers,
  type MinimalWebSocket,
  type Timers,
  type WebSocketCtor,
} from './websocket.js';

const DEFAULT_API_BASE = 'https://api.twitch.tv/helix';
const DEFAULT_EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
/**
 * UNVERIFIED: the official docs give the URL form `rtmp://<ingest-server>/app/<key>` and point
 * at GET https://ingest.twitch.tv/ingests for the server list. `rtmps://live.twitch.tv/app`
 * is widely used but only secondary-sourced, so it stays overridable.
 */
const DEFAULT_INGEST_URL = 'rtmp://live.twitch.tv/app';

export interface TwitchAdapterOptions extends RealAdapterOptions {
  /** Required on every Helix request alongside the bearer token. */
  clientId: string;
  ingestUrl?: string;
  eventSubUrl?: string;
  webSocketCtor?: WebSocketCtor;
  timers?: Timers;
  /** EventSub keepalive window in seconds (10–600 per the docs). */
  keepaliveTimeoutSeconds?: number;
}

interface HelixList<T> {
  data?: T[];
}
interface HelixStreamKey {
  stream_key?: string;
}
interface HelixStream {
  id?: string;
  user_login?: string;
  viewer_count?: number;
  started_at?: string;
  type?: string;
}
interface HelixChannel {
  broadcaster_id?: string;
  broadcaster_login?: string;
  broadcaster_name?: string;
  title?: string;
  game_id?: string;
}

/**
 * Twitch adapter (Helix + EventSub WebSocket).
 *
 * Twitch has no broadcast lifecycle: going live is "set the metadata, fetch the key, push",
 * and ending is "stop pushing". So `createBroadcast` does the PATCH + key fetch, and
 * `stopBroadcast` is deliberately a no-op. Chat is EventSub `channel.chat.message` over a
 * WebSocket (the docs recommend it over IRC), with keepalive watchdog, reconnect handling
 * and resubscription — subscriptions are bound to the session, not to the app.
 */
export class TwitchAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile = twitchProfile;

  private readonly fetch: FetchLike;
  private readonly tokenProvider: TokenProvider;
  private readonly apiBase: string;
  private readonly clientId: string;
  private readonly ingestUrl: string;
  private readonly eventSubUrl: string;
  private readonly webSocketCtor: WebSocketCtor | undefined;
  private readonly timers: Timers;
  private readonly keepaliveTimeoutSeconds: number;

  constructor(options: TwitchAdapterOptions) {
    this.fetch = options.fetch;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.clientId = options.clientId;
    this.ingestUrl = options.ingestUrl ?? DEFAULT_INGEST_URL;
    this.eventSubUrl = options.eventSubUrl ?? DEFAULT_EVENTSUB_URL;
    this.webSocketCtor = options.webSocketCtor;
    this.timers = options.timers ?? realTimers;
    this.keepaliveTimeoutSeconds = options.keepaliveTimeoutSeconds ?? 30;
  }

  supports(capability: CapabilityKey): boolean {
    return supportsFromProfile(this.profile, capability);
  }

  async disconnect(_credential: CredentialRef | undefined): Promise<void> {
    // Nothing cached in the adapter.
  }

  async validate(
    config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<
    | { ok: true; credential?: CredentialRef; ingest?: IngestTarget; watchUrl?: string }
    | { ok: false; code: ErrorCode; technical?: string }
  > {
    const broadcasterId = this.broadcasterId(config, credential);
    if (!broadcasterId) {
      return { ok: false, code: 'AUTH_FAILED', technical: 'No Twitch broadcaster id on the credential.' };
    }
    const token = await this.tokenProvider(credential);
    const channels = await request<HelixList<HelixChannel>>(this.fetch, {
      url: withQuery(`${this.apiBase}/channels`, { broadcaster_id: broadcasterId }),
      token,
      headers: this.headers(),
    });
    const channel = channels?.data?.[0];
    if (!channel) {
      return { ok: false, code: 'PLATFORM_ERROR', technical: 'Twitch returned no channel.' };
    }
    const login = channel.broadcaster_login;
    return {
      ok: true,
      ingest: await this.fetchIngest(broadcasterId, token),
      ...(login ? { watchUrl: `https://www.twitch.tv/${login}` } : {}),
    };
  }

  async createBroadcast(
    config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    const broadcasterId = this.broadcasterId(config, credential);
    if (!broadcasterId) throw new Error('No Twitch broadcaster id on the credential.');
    const token = await this.tokenProvider(credential);

    // Metadata first, so the stream appears correctly from second zero.
    if (config.metadata?.title || config.metadata?.category) {
      await this.patchChannel(broadcasterId, token, config.metadata);
    }
    const ingest = await this.fetchIngest(broadcasterId, token);
    const login = credential?.accountLabel ?? config.accountId;
    return {
      streamId: broadcasterId,
      ingest,
      ...(login ? { watchUrl: `https://www.twitch.tv/${login}` } : {}),
    };
  }

  async stopBroadcast(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<void> {
    // Twitch has no stop endpoint. The stream ends when LIVETAP stops pushing bytes.
  }

  async getStatus(handle: BroadcastHandle, credential?: CredentialRef): Promise<LiveStatus> {
    const userId = handle.streamId ?? credential?.accountId;
    if (!userId) return { live: false };
    const token = await this.tokenProvider(credential);
    const body = await request<HelixList<HelixStream>>(this.fetch, {
      url: withQuery(`${this.apiBase}/streams`, { user_id: userId }),
      token,
      headers: this.headers(),
    });
    const stream = body?.data?.[0];
    if (!stream) return { live: false, ingestHealth: 'noData' };
    return {
      live: stream.type === 'live',
      ingestHealth: 'good',
      ...(stream.viewer_count !== undefined ? { viewers: stream.viewer_count } : {}),
    };
  }

  async publishMetadata(
    handle: BroadcastHandle,
    metadata: BroadcastMetadata,
    credential?: CredentialRef,
  ): Promise<void> {
    const broadcasterId = handle.streamId ?? credential?.accountId;
    if (!broadcasterId) throw new Error('No Twitch broadcaster id on the credential.');
    const token = await this.tokenProvider(credential);
    await this.patchChannel(broadcasterId, token, metadata);
  }

  /**
   * Chat over EventSub WebSocket: connect, capture session_id from the Welcome message,
   * create the `channel.chat.message` v1 subscription with a websocket transport, then
   * translate notifications into ChatMessage. Handles keepalive timeouts and
   * `session_reconnect` (the new socket must Welcome before the old one is closed, or
   * Twitch closes it with 4004).
   */
  async subscribeChat(
    handle: BroadcastHandle,
    onMessage: (m: ChatMessage) => void,
    credential?: CredentialRef,
  ): Promise<ChatSubscription> {
    if (!this.webSocketCtor) {
      throw new Error('Twitch chat needs a WebSocket implementation (pass webSocketCtor).');
    }
    const broadcasterId = handle.streamId ?? credential?.accountId;
    if (!broadcasterId) throw new Error('No Twitch broadcaster id on the credential.');
    const session = new TwitchEventSubSession({
      url: this.eventSubUrl,
      keepaliveTimeoutSeconds: this.keepaliveTimeoutSeconds,
      webSocketCtor: this.webSocketCtor,
      timers: this.timers,
      subscribe: async (sessionId) => {
        const token = await this.tokenProvider(credential);
        await request(this.fetch, {
          url: `${this.apiBase}/eventsub/subscriptions`,
          method: 'POST',
          token,
          headers: this.headers(),
          json: {
            type: 'channel.chat.message',
            version: '1',
            condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
            transport: { method: 'websocket', session_id: sessionId },
          },
        });
      },
      onEvent: (event) => {
        const message = toChatMessage(event, broadcasterId);
        if (message) onMessage(message);
      },
    });
    session.start();
    return { stop: () => session.stop() };
  }

  async sendChat(
    handle: BroadcastHandle,
    text: string,
    credential?: CredentialRef,
  ): Promise<void> {
    const broadcasterId = handle.streamId ?? credential?.accountId;
    if (!broadcasterId) throw new Error('No Twitch broadcaster id on the credential.');
    const token = await this.tokenProvider(credential);
    await request(this.fetch, {
      url: `${this.apiBase}/chat/messages`,
      method: 'POST',
      token,
      headers: this.headers(),
      json: { broadcaster_id: broadcasterId, sender_id: broadcasterId, message: text },
    });
  }

  async moderate(
    handle: BroadcastHandle,
    req: ModerationRequest,
    credential?: CredentialRef,
  ): Promise<void> {
    const broadcasterId = handle.streamId ?? credential?.accountId;
    if (!broadcasterId) throw new Error('No Twitch broadcaster id on the credential.');
    const token = await this.tokenProvider(credential);
    if (req.action === 'delete') {
      await request(this.fetch, {
        url: withQuery(`${this.apiBase}/chat/messages`, {
          broadcaster_id: broadcasterId,
          moderator_id: broadcasterId,
          message_id: req.message.platformMessageId ?? req.message.id,
        }),
        method: 'DELETE',
        token,
        headers: this.headers(),
      });
      return;
    }
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/moderation/bans`, {
        broadcaster_id: broadcasterId,
        moderator_id: broadcasterId,
      }),
      method: 'POST',
      token,
      headers: this.headers(),
      json: {
        data: {
          user_id: req.message.author.id,
          // Twitch durations are SECONDS (Kick uses minutes). Omit for a permanent ban.
          ...(req.action === 'timeout' ? { duration: req.durationSeconds ?? 300 } : {}),
        },
      },
    });
  }

  /**
   * Twitch has no per-stream analytics API, so this is a sample of the live viewer count.
   * Building a viewer graph means LIVETAP stores the series itself.
   */
  async getAnalytics(
    handle: BroadcastHandle,
    credential?: CredentialRef,
  ): Promise<AnalyticsSnapshot> {
    const status = await this.getStatus(handle, credential);
    return {
      ...(status.viewers !== undefined ? { viewers: status.viewers } : {}),
      updatedAt: Date.now(),
    };
  }

  // ------------------------------------------------------------------ internals

  private headers(): Record<string, string> {
    return { 'Client-Id': this.clientId };
  }

  private broadcasterId(config: DestinationConfig, credential?: CredentialRef): string | undefined {
    return credential?.accountId ?? config.accountId;
  }

  private async fetchIngest(broadcasterId: string, token: string): Promise<IngestTarget> {
    const body = await request<HelixList<HelixStreamKey>>(this.fetch, {
      url: withQuery(`${this.apiBase}/streams/key`, { broadcaster_id: broadcasterId }),
      token,
      headers: this.headers(),
    });
    const streamKey = body?.data?.[0]?.stream_key;
    if (!streamKey) throw new Error('Twitch did not return a stream key.');
    return {
      protocol: this.ingestUrl.startsWith('rtmps://') ? 'rtmps' : 'rtmp',
      url: this.ingestUrl,
      streamKey,
    };
  }

  private async patchChannel(
    broadcasterId: string,
    token: string,
    metadata: BroadcastMetadata,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (metadata.title) body['title'] = metadata.title;
    // `category` carries a Twitch game_id resolved by the caller (GET /helix/search/categories).
    if (metadata.category) body['game_id'] = metadata.category;
    if (Object.keys(body).length === 0) return;
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/channels`, { broadcaster_id: broadcasterId }),
      method: 'PATCH',
      token,
      headers: this.headers(),
      json: body,
    });
  }
}

// ---------------------------------------------------------------------------- EventSub

/**
 * Is this `reconnect_url` one we are willing to follow?
 *
 * SEC-A1 (2026-09 security review): the previous code did
 * `if (next) this.connect(next, true)` with whatever string arrived in the
 * frame. A websocket message is attacker-shaped data — the transport is
 * TLS-authenticated to Twitch, but the CONTENT is not something we should
 * trust to pick our next endpoint. An unvalidated value here means one frame
 * can move the chat socket to any host, or downgrade it to plaintext `ws://`
 * where the session is readable and injectable on the wire.
 *
 * Twitch's own reconnect URL is always on the same origin as the EventSub
 * endpoint we dialled, so that is the check: same protocol, same host, same
 * port. Comparing against the CONFIGURED base (rather than hard-coding
 * `twitch.tv`) keeps the rule correct for a test double or a proxy.
 */
export function isAcceptableReconnectUrl(next: unknown, baseUrl: string): next is string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return false;
  if (/[\r\n\0]/.test(next)) return false;
  let target: URL;
  let base: URL;
  try {
    target = new URL(next);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (target.protocol !== 'wss:' && target.protocol !== base.protocol) return false;
  return target.host === base.host && target.protocol === base.protocol;
}

/** Backoff for a socket that will not stay up. Bounded, so a flapping endpoint cannot spin. */
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

export function reconnectDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
}

interface EventSubSessionOptions {
  url: string;
  keepaliveTimeoutSeconds: number;
  webSocketCtor: WebSocketCtor;
  timers: Timers;
  subscribe: (sessionId: string) => Promise<void>;
  onEvent: (event: Record<string, unknown>) => void;
}

interface EventSubEnvelope {
  metadata?: { message_type?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; reconnect_url?: string; keepalive_timeout_seconds?: number };
    event?: Record<string, unknown>;
  };
}

/**
 * One EventSub WebSocket session with keepalive watchdog and reconnect handling.
 * Exported for tests; the adapter is the only production caller.
 */
export class TwitchEventSubSession {
  private readonly options: EventSubSessionOptions;
  private socket: MinimalWebSocket | undefined;
  private pendingSocket: MinimalWebSocket | undefined;
  private watchdog: unknown;
  private stopped = false;
  /** Consecutive failed connection attempts; reset by a session_welcome. */
  private reconnectAttempts = 0;
  private reconnectTimer: unknown;

  constructor(options: EventSubSessionOptions) {
    this.options = options;
  }

  start(): void {
    this.connect(this.withKeepalive(this.options.url), false);
  }

  stop(): void {
    this.stopped = true;
    this.clearWatchdog();
    if (this.reconnectTimer !== undefined) {
      this.options.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.pendingSocket?.close(1000, 'livetap stop');
    this.pendingSocket = undefined;
    this.socket?.close(1000, 'livetap stop');
    this.socket = undefined;
  }

  private withKeepalive(url: string): string {
    if (url.includes('keepalive_timeout_seconds')) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}keepalive_timeout_seconds=${this.options.keepaliveTimeoutSeconds}`;
  }

  private connect(url: string, isReconnect: boolean): void {
    if (this.stopped) return;
    const socket = new this.options.webSocketCtor(url);
    if (isReconnect) this.pendingSocket = socket;
    else this.socket = socket;

    socket.onmessage = (event) => {
      const text = messageText(event.data);
      if (!text) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      // SEC-A5: `JSON.parse('null')` is null and `JSON.parse('[]')` is an
      // array. Reading `.metadata` off null threw a TypeError straight out of
      // the socket's onmessage handler, which in Node is an unhandled error
      // that can take the process down -- from one remote frame containing the
      // four bytes `null`. Anything that is not a plain object is not a frame.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      this.handle(parsed as EventSubEnvelope, socket, isReconnect);
    };
    socket.onclose = () => {
      if (this.stopped) return;
      // A dropped socket loses every subscription: reconnect from scratch and resubscribe.
      if (socket === this.socket) this.reconnectFromScratch();
    };
    socket.onerror = () => {
      // Errors are followed by close; nothing extra to do.
    };
    this.armWatchdog();
  }

  private handle(
    envelope: EventSubEnvelope,
    socket: MinimalWebSocket,
    isReconnect: boolean,
  ): void {
    this.armWatchdog();
    const type = envelope.metadata?.message_type;
    if (type === 'session_welcome') {
      // A socket that reached Welcome is healthy: the backoff starts over.
      this.reconnectAttempts = 0;
      const sessionId = envelope.payload?.session?.id;
      if (isReconnect) {
        // The reconnect socket has welcomed: promote it, then close the old one (never before,
        // or Twitch closes the new connection with code 4004).
        const old = this.socket;
        this.socket = socket;
        this.pendingSocket = undefined;
        old?.close(1000, 'livetap reconnect');
        // Reconnect sessions keep their subscriptions; no resubscribe needed.
        return;
      }
      if (sessionId) void this.options.subscribe(sessionId).catch(() => undefined);
      return;
    }
    if (type === 'session_keepalive') return;
    if (type === 'session_reconnect') {
      const next = envelope.payload?.session?.reconnect_url;
      // SEC-A1: never dial a URL just because a frame told us to.
      if (isAcceptableReconnectUrl(next, this.options.url)) {
        this.connect(next, true);
      } else if (next !== undefined) {
        // Refuse it and fall back to our own endpoint rather than dropping chat.
        this.reconnectFromScratch();
      }
      return;
    }
    if (type === 'notification') {
      if (envelope.metadata?.subscription_type !== 'channel.chat.message') return;
      const event = envelope.payload?.event;
      if (event) this.options.onEvent(event);
      return;
    }
    if (type === 'revocation') {
      this.reconnectFromScratch();
    }
  }

  /**
   * SEC-A2: this used to call `connect()` directly, and `connect()` wires
   * `onclose` straight back to it. A socket that fails to open — a dead
   * network, a 429, a hostile endpoint closing immediately — therefore span a
   * tight, synchronous connect/close loop that pegged a core and hammered the
   * endpoint. THREAT_MODEL T12 claims "bounded reconnect with backoff"; this
   * is what makes that true.
   *
   * The FIRST reconnect stays immediate, because a single dropped socket
   * should recover without a visible gap in chat. Only repeated failures back
   * off, exponentially, capped at RECONNECT_MAX_MS.
   */
  private reconnectFromScratch(): void {
    if (this.stopped) return;
    if (this.reconnectTimer !== undefined) return; // one pending attempt at a time
    this.clearWatchdog();
    this.socket = undefined;
    const delay = reconnectDelayMs(this.reconnectAttempts);
    this.reconnectAttempts += 1;
    if (delay === 0) {
      this.connect(this.withKeepalive(this.options.url), false);
      return;
    }
    this.reconnectTimer = this.options.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopped) return;
      this.connect(this.withKeepalive(this.options.url), false);
    }, delay);
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    if (this.stopped) return;
    // Docs: if no notification or keepalive arrives inside the window, reconnect and resubscribe.
    const graceMs = (this.options.keepaliveTimeoutSeconds + 5) * 1000;
    this.watchdog = this.options.timers.setTimeout(() => {
      this.watchdog = undefined;
      const old = this.socket;
      this.socket = undefined;
      old?.close(4000, 'livetap keepalive timeout');
      this.reconnectFromScratch();
    }, graceMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== undefined) {
      this.options.timers.clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
  }
}

function toChatMessage(
  event: Record<string, unknown>,
  destinationId: string,
): ChatMessage | undefined {
  const text = readMessageText(event['message']);
  const userId = typeof event['chatter_user_id'] === 'string' ? event['chatter_user_id'] : undefined;
  const name =
    typeof event['chatter_user_name'] === 'string'
      ? event['chatter_user_name']
      : typeof event['chatter_user_login'] === 'string'
        ? event['chatter_user_login']
        : undefined;
  const messageId = typeof event['message_id'] === 'string' ? event['message_id'] : undefined;
  if (text === undefined || !userId) return undefined;
  const badges = readBadges(event['badges']);
  return {
    id: messageId ?? `tw-${userId}-${Date.now()}`,
    platform: 'twitch',
    destinationId,
    author: {
      id: userId,
      displayName: name ?? 'Twitch viewer',
      ...(badges.length ? { badges } : {}),
    },
    text,
    receivedAt: Date.now(),
    ...(messageId ? { platformMessageId: messageId } : {}),
  };
}

function readMessageText(message: unknown): string | undefined {
  if (message && typeof message === 'object') {
    const text = (message as Record<string, unknown>)['text'];
    if (typeof text === 'string') return text;
  }
  return undefined;
}

function readBadges(raw: unknown): NonNullable<ChatMessage['author']['badges']> {
  const badges: NonNullable<ChatMessage['author']['badges']> = [];
  if (!Array.isArray(raw)) return badges;
  for (const entry of raw as Array<Record<string, unknown>>) {
    const setId = entry['set_id'];
    if (setId === 'broadcaster') badges.push('owner');
    else if (setId === 'moderator') badges.push('moderator');
    else if (setId === 'subscriber' || setId === 'founder') badges.push('subscriber');
    else if (setId === 'partner') badges.push('verified');
  }
  return badges;
}
