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
import { youtubeProfile } from '../profiles/index.js';
import {
  defaultSleep,
  request,
  withQuery,
  type FetchLike,
  type RealAdapterOptions,
  type TokenProvider,
} from './http.js';

const DEFAULT_API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeAdapterOptions extends RealAdapterOptions {
  /** How long to wait between liveStreams.list polls (default 5000 ms, as YouTube suggests). */
  streamPollIntervalMs?: number;
  /** How many polls before giving up waiting for `streamStatus === "active"` (default 24). */
  streamPollMaxAttempts?: number;
}

interface YtListResponse<T> {
  items?: T[];
}

interface YtBroadcast {
  id?: string;
  snippet?: { liveChatId?: string; title?: string };
  status?: { lifeCycleStatus?: string };
}

interface YtStream {
  id?: string;
  status?: { streamStatus?: string; healthStatus?: { status?: string } };
  cdn?: {
    ingestionInfo?: {
      streamName?: string;
      ingestionAddress?: string;
      backupIngestionAddress?: string;
      rtmpsIngestionAddress?: string;
      rtmpsBackupIngestionAddress?: string;
    };
  };
}

interface YtVideo {
  id?: string;
  liveStreamingDetails?: {
    concurrentViewers?: string;
    activeLiveChatId?: string;
    actualStartTime?: string;
  };
  statistics?: { likeCount?: string };
}

interface YtChatListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      publishedAt?: string;
      displayMessage?: string;
      textMessageDetails?: { messageText?: string };
    };
    authorDetails?: {
      channelId?: string;
      displayName?: string;
      profileImageUrl?: string;
      isChatOwner?: boolean;
      isChatModerator?: boolean;
      isChatSponsor?: boolean;
      isVerified?: boolean;
    };
  }>;
  nextPageToken?: string;
  pollingIntervalMillis?: number;
}

/**
 * YouTube Live adapter (YouTube Data API v3).
 *
 * Implements the documented "life of a broadcast" sequence:
 *   liveBroadcasts.insert -> liveStreams.insert -> liveBroadcasts.bind
 *   -> poll liveStreams.list until status.streamStatus === 'active'
 *   -> liveBroadcasts.transition(live);  stop = liveBroadcasts.transition(complete)
 *
 * Chat is `liveChatMessages.list` polling, honouring the server's `pollingIntervalMillis`.
 * No token or stream key is ever logged: the token comes from `tokenProvider` per call and
 * the ingest key only ever travels inside the returned `IngestTarget`.
 */
export class YouTubeAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile = youtubeProfile;

  private readonly fetch: FetchLike;
  private readonly tokenProvider: TokenProvider;
  private readonly apiBase: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;

  constructor(options: YouTubeAdapterOptions) {
    this.fetch = options.fetch;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.sleep = options.sleep ?? defaultSleep;
    this.pollIntervalMs = options.streamPollIntervalMs ?? 5000;
    this.pollMaxAttempts = options.streamPollMaxAttempts ?? 24;
  }

  supports(capability: CapabilityKey): boolean {
    return supportsFromProfile(this.profile, capability);
  }

  async disconnect(_credential: CredentialRef | undefined): Promise<void> {
    // Token revocation is the SecureStore's job; the adapter holds nothing to clear.
  }

  async validate(
    _config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<
    | { ok: true; credential?: CredentialRef; ingest?: IngestTarget; watchUrl?: string }
    | { ok: false; code: ErrorCode; technical?: string }
  > {
    const token = await this.tokenProvider(credential);
    // Cheapest possible proof that the token works and carries a channel (1 quota unit).
    const body = await request<YtListResponse<{ id?: string; snippet?: { title?: string } }>>(
      this.fetch,
      { url: withQuery(`${this.apiBase}/channels`, { part: 'id,snippet', mine: 'true' }), token },
    );
    const channel = body?.items?.[0];
    if (!channel?.id) {
      return { ok: false, code: 'NOT_ELIGIBLE', technical: 'No YouTube channel on this account.' };
    }
    return {
      ok: true,
      credential: credential
        ? {
            ...credential,
            accountId: channel.id,
            ...(channel.snippet?.title ? { accountLabel: channel.snippet.title } : {}),
          }
        : undefined,
    };
  }

  async createBroadcast(
    config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    const token = await this.tokenProvider(credential);
    const metadata = config.metadata ?? {};
    const title = metadata.title ?? config.label;

    // 1. Create the broadcast. scheduledStartTime is mandatory even for "go live now".
    const broadcast = await request<YtBroadcast>(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts`, {
        part: 'id,snippet,contentDetails,status',
      }),
      method: 'POST',
      token,
      json: {
        snippet: {
          title,
          description: metadata.description ?? '',
          scheduledStartTime: new Date(Date.now() + 30_000).toISOString(),
        },
        status: {
          privacyStatus: metadata.privacy ?? 'public',
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          // LIVETAP transitions explicitly, so autoStart/autoStop stay off and the monitor
          // stream is disabled (enableAutoStart and the testing stage are mutually exclusive).
          enableAutoStart: false,
          enableAutoStop: false,
          enableDvr: true,
          recordFromStart: true,
          monitorStream: { enableMonitorStream: false },
        },
      },
    });
    const broadcastId = broadcast?.id;
    if (!broadcastId) throw new Error('YouTube did not return a broadcast id.');

    // 2. Create the stream (variable resolution must be paired with variable frame rate).
    const stream = await request<YtStream>(this.fetch, {
      url: withQuery(`${this.apiBase}/liveStreams`, { part: 'id,snippet,cdn,contentDetails' }),
      method: 'POST',
      token,
      json: {
        snippet: { title: `${title} (LIVETAP)` },
        cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
        contentDetails: { isReusable: false },
      },
    });
    const streamId = stream?.id;
    const info = stream?.cdn?.ingestionInfo;
    if (!streamId || !info?.streamName) {
      throw new Error('YouTube did not return stream ingestion info.');
    }

    // 3. Bind the stream to the broadcast.
    await request<YtBroadcast>(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts/bind`, {
        id: broadcastId,
        part: 'id,contentDetails',
        streamId,
      }),
      method: 'POST',
      token,
    });

    const address = info.rtmpsIngestionAddress ?? info.ingestionAddress;
    if (!address) throw new Error('YouTube did not return an ingestion address.');
    return {
      broadcastId,
      streamId,
      ingest: {
        protocol: address.startsWith('rtmps://') ? 'rtmps' : 'rtmp',
        url: address,
        streamKey: info.streamName,
      },
      watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
    };
  }

  /**
   * Wait for ingest to be accepted, then transition to `live`.
   * Transitioning before `streamStatus === 'active'` is the documented cause of
   * `errorStreamInactive`, so the poll loop is not optional.
   */
  async startBroadcast(handle: BroadcastHandle, credential?: CredentialRef): Promise<void> {
    const token = await this.tokenProvider(credential);
    if (!handle.broadcastId) throw new Error('Missing YouTube broadcast id.');
    if (handle.streamId) await this.waitForActiveStream(handle.streamId, token);
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts/transition`, {
        id: handle.broadcastId,
        part: 'id,status',
        broadcastStatus: 'live',
      }),
      method: 'POST',
      token,
    });
  }

  async stopBroadcast(handle: BroadcastHandle, credential?: CredentialRef): Promise<void> {
    if (!handle.broadcastId) return;
    const token = await this.tokenProvider(credential);
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts/transition`, {
        id: handle.broadcastId,
        part: 'id,status',
        broadcastStatus: 'complete',
      }),
      method: 'POST',
      token,
    });
  }

  async getStatus(handle: BroadcastHandle, credential?: CredentialRef): Promise<LiveStatus> {
    const token = await this.tokenProvider(credential);
    const result: LiveStatus = { live: false };
    if (handle.streamId) {
      const streams = await request<YtListResponse<YtStream>>(this.fetch, {
        url: withQuery(`${this.apiBase}/liveStreams`, { part: 'status', id: handle.streamId }),
        token,
      });
      const status = streams?.items?.[0]?.status;
      result.live = status?.streamStatus === 'active';
      result.ingestHealth = mapHealth(status?.healthStatus?.status);
    }
    if (handle.broadcastId) {
      const viewers = await this.concurrentViewers(handle.broadcastId, token);
      if (viewers !== undefined) result.viewers = viewers;
    }
    return result;
  }

  async publishMetadata(
    handle: BroadcastHandle,
    metadata: BroadcastMetadata,
    credential?: CredentialRef,
  ): Promise<void> {
    if (!handle.broadcastId) return;
    const token = await this.tokenProvider(credential);
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts`, { part: 'id,snippet,status' }),
      method: 'PUT',
      token,
      json: {
        id: handle.broadcastId,
        snippet: {
          title: metadata.title,
          description: metadata.description,
          // Required by liveBroadcasts.update even when unchanged.
          scheduledStartTime: new Date().toISOString(),
        },
        status: { privacyStatus: metadata.privacy ?? 'public' },
      },
    });
  }

  async publishThumbnail(
    handle: BroadcastHandle,
    _dataUrl: string,
    _credential?: CredentialRef,
  ): Promise<void> {
    // thumbnails.set is a multipart upload against a different host
    // (https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...).
    // Not wired up yet: it needs the media-upload path, so LIVETAP declines honestly
    // rather than silently doing nothing.
    void handle;
    throw new Error('Thumbnail upload is not implemented in this adapter yet.');
  }

  /** Polls liveChatMessages.list, honouring the server-provided pollingIntervalMillis. */
  async subscribeChat(
    handle: BroadcastHandle,
    onMessage: (m: ChatMessage) => void,
    credential?: CredentialRef,
  ): Promise<ChatSubscription> {
    if (!handle.broadcastId) throw new Error('Missing YouTube broadcast id.');
    const token = await this.tokenProvider(credential);
    const liveChatId = await this.liveChatId(handle.broadcastId, token);
    if (!liveChatId) throw new Error('This YouTube broadcast has no live chat.');

    let stopped = false;
    let pageToken: string | undefined;
    const destinationId = handle.broadcastId;

    const loop = async (): Promise<void> => {
      while (!stopped) {
        let waitMs = 5000;
        try {
          const freshToken = await this.tokenProvider(credential);
          const page = await request<YtChatListResponse>(this.fetch, {
            url: withQuery(`${this.apiBase}/liveChat/messages`, {
              liveChatId,
              part: 'id,snippet,authorDetails',
              maxResults: 200,
              pageToken,
            }),
            token: freshToken,
          });
          pageToken = page?.nextPageToken;
          if (page?.pollingIntervalMillis) waitMs = page.pollingIntervalMillis;
          for (const item of page?.items ?? []) {
            if (stopped) return;
            onMessage(toChatMessage(item, destinationId));
          }
        } catch {
          // Chat is best-effort: back off and try again rather than killing the broadcast.
          waitMs = 10000;
        }
        if (stopped) return;
        await this.sleep(waitMs);
      }
    };
    void loop();
    return {
      stop: () => {
        stopped = true;
      },
    };
  }

  async sendChat(
    handle: BroadcastHandle,
    text: string,
    credential?: CredentialRef,
  ): Promise<void> {
    if (!handle.broadcastId) throw new Error('Missing YouTube broadcast id.');
    const token = await this.tokenProvider(credential);
    const liveChatId = await this.liveChatId(handle.broadcastId, token);
    if (!liveChatId) throw new Error('This YouTube broadcast has no live chat.');
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/liveChat/messages`, { part: 'snippet' }),
      method: 'POST',
      token,
      json: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText: text },
        },
      },
    });
  }

  async moderate(
    handle: BroadcastHandle,
    req: ModerationRequest,
    credential?: CredentialRef,
  ): Promise<void> {
    const token = await this.tokenProvider(credential);
    if (req.action === 'delete') {
      const id = req.message.platformMessageId ?? req.message.id;
      await request(this.fetch, {
        url: withQuery(`${this.apiBase}/liveChat/messages`, { id }),
        method: 'DELETE',
        token,
      });
      return;
    }
    if (!handle.broadcastId) throw new Error('Missing YouTube broadcast id.');
    const liveChatId = await this.liveChatId(handle.broadcastId, token);
    if (!liveChatId) throw new Error('This YouTube broadcast has no live chat.');
    await request(this.fetch, {
      url: withQuery(`${this.apiBase}/liveChat/bans`, { part: 'snippet' }),
      method: 'POST',
      token,
      json: {
        snippet: {
          liveChatId,
          type: req.action === 'timeout' ? 'temporary' : 'permanent',
          bannedUserDetails: { channelId: req.message.author.id },
          ...(req.action === 'timeout'
            ? { banDurationSeconds: req.durationSeconds ?? 300 }
            : {}),
        },
      },
    });
  }

  async getAnalytics(
    handle: BroadcastHandle,
    credential?: CredentialRef,
  ): Promise<AnalyticsSnapshot> {
    const token = await this.tokenProvider(credential);
    const snapshot: AnalyticsSnapshot = { updatedAt: Date.now() };
    if (!handle.broadcastId) return snapshot;
    const body = await request<YtListResponse<YtVideo>>(this.fetch, {
      url: withQuery(`${this.apiBase}/videos`, {
        part: 'liveStreamingDetails,statistics',
        id: handle.broadcastId,
      }),
      token,
    });
    const video = body?.items?.[0];
    // concurrentViewers is ABSENT (not zero) with no viewers or a hidden count.
    const viewers = video?.liveStreamingDetails?.concurrentViewers;
    if (viewers !== undefined) snapshot.viewers = Number(viewers);
    const likes = video?.statistics?.likeCount;
    if (likes !== undefined) snapshot.likes = Number(likes);
    return snapshot;
  }

  // ------------------------------------------------------------------ internals

  private async waitForActiveStream(streamId: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt++) {
      const body = await request<YtListResponse<YtStream>>(this.fetch, {
        url: withQuery(`${this.apiBase}/liveStreams`, { part: 'status', id: streamId }),
        token,
      });
      if (body?.items?.[0]?.status?.streamStatus === 'active') return;
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error('YouTube never saw the stream become active (timed out waiting for ingest).');
  }

  private async liveChatId(broadcastId: string, token: string): Promise<string | undefined> {
    const body = await request<YtListResponse<YtBroadcast>>(this.fetch, {
      url: withQuery(`${this.apiBase}/liveBroadcasts`, { part: 'snippet', id: broadcastId }),
      token,
    });
    return body?.items?.[0]?.snippet?.liveChatId;
  }

  private async concurrentViewers(
    broadcastId: string,
    token: string,
  ): Promise<number | undefined> {
    const body = await request<YtListResponse<YtVideo>>(this.fetch, {
      url: withQuery(`${this.apiBase}/videos`, {
        part: 'liveStreamingDetails',
        id: broadcastId,
      }),
      token,
    });
    const raw = body?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
    return raw === undefined ? undefined : Number(raw);
  }
}

function mapHealth(status: string | undefined): LiveStatus['ingestHealth'] {
  switch (status) {
    case 'good':
      return 'good';
    case 'ok':
      return 'ok';
    case 'bad':
    case 'noData':
      return status;
    default:
      return undefined;
  }
}

function toChatMessage(
  item: NonNullable<YtChatListResponse['items']>[number],
  destinationId: string,
): ChatMessage {
  const author = item.authorDetails;
  const badges: NonNullable<ChatMessage['author']['badges']> = [];
  if (author?.isChatOwner) badges.push('owner');
  if (author?.isChatModerator) badges.push('moderator');
  if (author?.isChatSponsor) badges.push('member');
  if (author?.isVerified) badges.push('verified');
  const published = item.snippet?.publishedAt;
  return {
    id: item.id ?? `yt-${Math.random().toString(36).slice(2)}`,
    platform: 'youtube',
    destinationId,
    author: {
      id: author?.channelId ?? 'unknown',
      displayName: author?.displayName ?? 'YouTube viewer',
      ...(author?.profileImageUrl ? { avatarUrl: author.profileImageUrl } : {}),
      ...(badges.length ? { badges } : {}),
    },
    text: item.snippet?.displayMessage ?? item.snippet?.textMessageDetails?.messageText ?? '',
    receivedAt: published ? Date.parse(published) : Date.now(),
    ...(item.id ? { platformMessageId: item.id } : {}),
  };
}
