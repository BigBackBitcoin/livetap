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
  type PlatformProfile,
} from '@livetap/core';
import { facebookProfile } from '../profiles/index.js';
import {
  defaultSleep,
  request,
  withQuery,
  type FetchLike,
  type RealAdapterOptions,
  type TokenProvider,
} from './http.js';

const DEFAULT_API_BASE = 'https://graph.facebook.com/v25.0';

export interface FacebookAdapterOptions extends RealAdapterOptions {
  /** Comment polling interval (default 4000 ms — the docs say "every few seconds"). */
  commentPollIntervalMs?: number;
}

interface FbLiveVideo {
  id?: string;
  stream_url?: string;
  secure_stream_url?: string;
  secure_stream_secondary_urls?: string[];
  status?: string;
  live_views?: number;
  permalink_url?: string;
  reactions?: { summary?: { total_count?: number } };
}

interface FbTarget {
  id?: string;
  name?: string;
  picture?: { data?: { url?: string } };
}

interface FbComments {
  data?: Array<{
    id?: string;
    created_time?: string;
    message?: string;
    from?: { id?: string; name?: string };
  }>;
  paging?: { cursors?: { after?: string } };
}

/**
 * Facebook Live adapter (Live Video API).
 *
 * Go-live sequence: POST /{target}/live_videos with `status=LIVE_NOW` returns the LiveVideo id
 * and `secure_stream_url` (RTMPS with the key embedded). The broadcast publishes itself once
 * ingest is accepted, so there is no separate start call. Ending is
 * POST /{live-video-id}?end_live_video=true, which also saves the VOD.
 *
 * Comments are polled from GET /{id}/comments. A lower-latency Server-Sent Events stream
 * exists at streaming-graph.facebook.com/{id}/live_comments — a future upgrade, deliberately
 * not used here because its reference page could not be verified during research.
 */
export class FacebookAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile = facebookProfile;

  private readonly fetch: FetchLike;
  private readonly tokenProvider: TokenProvider;
  private readonly apiBase: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly commentPollIntervalMs: number;

  constructor(options: FacebookAdapterOptions) {
    this.fetch = options.fetch;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.sleep = options.sleep ?? defaultSleep;
    this.commentPollIntervalMs = options.commentPollIntervalMs ?? 4000;
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
    const token = await this.tokenProvider(credential);
    const target = this.target(config, credential);
    const body = await request<FbTarget>(this.fetch, {
      // `picture` is an edge, so it is read with field expansion in the same request rather than
      // costing a second round trip. `redirect=false` makes Graph answer with JSON, not a 302.
      url: withQuery(`${this.apiBase}/${target}`, { fields: 'id,name,picture.redirect(false){url}' }),
      token,
    });
    if (!body?.id) {
      return { ok: false, code: 'AUTH_FAILED', technical: 'Facebook returned no target id.' };
    }
    // Returned even when the caller passed no credential: the first connect is the one that most
    // needs to say which Page it just connected, and a Page name is not a secret.
    const base: CredentialRef = credential ?? { id: 'oauth:facebook', platform: 'facebook' };
    const avatar = body.picture?.data?.url;
    return {
      ok: true,
      credential: {
        ...base,
        accountId: body.id,
        ...(body.name ? { accountLabel: body.name } : {}),
        ...(avatar ? { avatarUrl: avatar } : {}),
      },
    };
  }

  async createBroadcast(
    config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    const token = await this.tokenProvider(credential);
    const target = this.target(config, credential);
    const metadata = config.metadata ?? {};
    const body = await request<FbLiveVideo>(this.fetch, {
      url: `${this.apiBase}/${target}/live_videos`,
      method: 'POST',
      token,
      json: {
        // LIVE_NOW publishes the broadcast as soon as ingest is accepted.
        status: 'LIVE_NOW',
        title: (metadata.title ?? config.label).slice(0, 254),
        description: metadata.description ?? '',
        ...(metadata.privacy ? { privacy: JSON.stringify({ value: fbPrivacy(metadata.privacy) }) } : {}),
      },
    });
    const id = body?.id;
    const streamUrl = body?.secure_stream_url ?? body?.stream_url;
    if (!id || !streamUrl) throw new Error('Facebook did not return a live video stream URL.');
    return {
      broadcastId: id,
      ingest: splitIngest(streamUrl),
      watchUrl: body?.permalink_url
        ? absolute(body.permalink_url)
        : `https://www.facebook.com/${id}`,
    };
  }

  async stopBroadcast(handle: BroadcastHandle, credential?: CredentialRef): Promise<void> {
    if (!handle.broadcastId) return;
    const token = await this.tokenProvider(credential);
    await request(this.fetch, {
      url: `${this.apiBase}/${handle.broadcastId}`,
      method: 'POST',
      token,
      json: { end_live_video: true },
    });
  }

  async getStatus(handle: BroadcastHandle, credential?: CredentialRef): Promise<LiveStatus> {
    if (!handle.broadcastId) return { live: false };
    const token = await this.tokenProvider(credential);
    const body = await request<FbLiveVideo>(this.fetch, {
      url: withQuery(`${this.apiBase}/${handle.broadcastId}`, { fields: 'id,status,live_views' }),
      token,
    });
    return {
      live: body?.status === 'LIVE',
      ingestHealth: body?.status === 'LIVE' ? 'good' : 'noData',
      // live_views was UNVERIFIED in research: report it only when Facebook sends it.
      ...(body?.live_views !== undefined ? { viewers: body.live_views } : {}),
    };
  }

  async publishMetadata(
    handle: BroadcastHandle,
    metadata: BroadcastMetadata,
    credential?: CredentialRef,
  ): Promise<void> {
    if (!handle.broadcastId) return;
    const token = await this.tokenProvider(credential);
    const json: Record<string, unknown> = {};
    if (metadata.title) json['title'] = metadata.title.slice(0, 254);
    if (metadata.description) json['description'] = metadata.description;
    if (Object.keys(json).length === 0) return;
    await request(this.fetch, {
      url: `${this.apiBase}/${handle.broadcastId}`,
      method: 'POST',
      token,
      json,
    });
  }

  /** Polls GET /{id}/comments with a cursor. Read-only: comment write is unverified on live. */
  async subscribeChat(
    handle: BroadcastHandle,
    onMessage: (m: ChatMessage) => void,
    credential?: CredentialRef,
  ): Promise<ChatSubscription> {
    const liveVideoId = handle.broadcastId;
    if (!liveVideoId) throw new Error('Missing Facebook live video id.');
    let stopped = false;
    let after: string | undefined;
    const seen = new Set<string>();

    const loop = async (): Promise<void> => {
      while (!stopped) {
        try {
          const token = await this.tokenProvider(credential);
          const page = await request<FbComments>(this.fetch, {
            url: withQuery(`${this.apiBase}/${liveVideoId}/comments`, {
              fields: 'id,created_time,message,from',
              order: 'chronological',
              limit: 100,
              after,
            }),
            token,
          });
          after = page?.paging?.cursors?.after ?? after;
          for (const comment of page?.data ?? []) {
            if (stopped) return;
            if (!comment.id || seen.has(comment.id)) continue;
            seen.add(comment.id);
            onMessage({
              id: comment.id,
              platform: 'facebook',
              destinationId: liveVideoId,
              author: {
                id: comment.from?.id ?? 'unknown',
                displayName: comment.from?.name ?? 'Facebook viewer',
              },
              text: comment.message ?? '',
              receivedAt: comment.created_time ? Date.parse(comment.created_time) : Date.now(),
              platformMessageId: comment.id,
            });
          }
        } catch {
          // Comments are best-effort; never take the broadcast down for them.
        }
        if (stopped) return;
        await this.sleep(this.commentPollIntervalMs);
      }
    };
    void loop();
    return {
      stop: () => {
        stopped = true;
      },
    };
  }

  async getAnalytics(
    handle: BroadcastHandle,
    credential?: CredentialRef,
  ): Promise<AnalyticsSnapshot> {
    const snapshot: AnalyticsSnapshot = { updatedAt: Date.now() };
    if (!handle.broadcastId) return snapshot;
    const token = await this.tokenProvider(credential);
    const body = await request<FbLiveVideo>(this.fetch, {
      url: withQuery(`${this.apiBase}/${handle.broadcastId}`, {
        fields: 'id,live_views,reactions.summary(total_count)',
      }),
      token,
    });
    if (body?.live_views !== undefined) snapshot.viewers = body.live_views;
    const likes = body?.reactions?.summary?.total_count;
    if (likes !== undefined) snapshot.likes = likes;
    return snapshot;
  }

  // ------------------------------------------------------------------ internals

  /** Page id when we have one, otherwise the authenticated user's own timeline. */
  private target(config: DestinationConfig, credential?: CredentialRef): string {
    return credential?.accountId ?? config.accountId ?? 'me';
  }
}

/** `rtmps://host/rtmp/KEY` -> url `rtmps://host/rtmp` + streamKey `KEY`. */
function splitIngest(streamUrl: string): IngestTarget {
  const queryIndex = streamUrl.indexOf('?');
  const base = queryIndex === -1 ? streamUrl : streamUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : streamUrl.slice(queryIndex);
  const lastSlash = base.lastIndexOf('/');
  const url = lastSlash > 'rtmps://'.length ? base.slice(0, lastSlash) : base;
  const key = lastSlash > 'rtmps://'.length ? `${base.slice(lastSlash + 1)}${query}` : undefined;
  return {
    protocol: streamUrl.startsWith('rtmps://') ? 'rtmps' : 'rtmp',
    url,
    ...(key ? { streamKey: key } : {}),
  };
}

function fbPrivacy(privacy: NonNullable<BroadcastMetadata['privacy']>): string {
  switch (privacy) {
    case 'public':
      return 'EVERYONE';
    case 'unlisted':
      return 'ALL_FRIENDS';
    case 'private':
      return 'SELF';
  }
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `https://www.facebook.com${url}`;
}
