import {
  supportsFromProfile,
  validateIngest,
  type BroadcastHandle,
  type BroadcastMetadata,
  type CapabilityKey,
  type CredentialRef,
  type DestinationAdapter,
  type DestinationConfig,
  type ErrorCode,
  type IngestTarget,
  type LiveStatus,
  type ModerationRequest,
  type PlatformProfile,
} from '@livetap/core';
import { kickProfile } from '../profiles/index.js';
import { request, type FetchLike, type RealAdapterOptions, type TokenProvider } from './http.js';

const DEFAULT_API_BASE = 'https://api.kick.com';

export interface KickAdapterOptions extends RealAdapterOptions {
  /** Optional: honour a stream.url/stream.key pair if Kick actually returns one. */
  trustChannelStreamKey?: boolean;
}

interface KickChannelsResponse {
  data?: Array<{
    broadcaster_user_id?: number;
    slug?: string;
    stream_title?: string;
    category?: { id?: number; name?: string };
    stream?: {
      is_live?: boolean;
      viewer_count?: number;
      start_time?: string;
      key?: string;
      url?: string;
    };
  }>;
}

/**
 * Kick adapter (Kick Public API).
 *
 * Kick has no broadcast object and no documented stream-key endpoint, so:
 *  - the user pastes the ingest URL + key (profile marks streamKey USER_ASSISTED),
 *  - "creating" a broadcast is `PATCH /public/v1/channels` for title/category, then the
 *    configured ingest is returned unchanged,
 *  - `stopBroadcast` is a no-op — Kick ends the stream when bytes stop,
 *  - there is deliberately NO `subscribeChat`: Kick chat read only exists as a webhook to a
 *    public HTTPS endpoint, which a desktop LIVETAP cannot receive. Chat write and
 *    moderation do work.
 */
export class KickAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile = kickProfile;

  private readonly fetch: FetchLike;
  private readonly tokenProvider: TokenProvider;
  private readonly apiBase: string;
  private readonly trustChannelStreamKey: boolean;

  constructor(options: KickAdapterOptions) {
    this.fetch = options.fetch;
    this.tokenProvider = options.tokenProvider;
    this.apiBase = options.apiBase ?? DEFAULT_API_BASE;
    this.trustChannelStreamKey = options.trustChannelStreamKey ?? false;
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
    const body = await request<KickChannelsResponse>(this.fetch, {
      url: `${this.apiBase}/public/v1/channels`,
      token,
    });
    const channel = body?.data?.[0];
    if (!channel?.broadcaster_user_id) {
      return { ok: false, code: 'PLATFORM_ERROR', technical: 'Kick returned no channel.' };
    }

    // Kick's stream.key/stream.url mapping is UNVERIFIED. Only trust it when the caller opts
    // in AND both fields actually arrive; otherwise require the user's pasted ingest.
    const fromApi =
      this.trustChannelStreamKey && channel.stream?.url && channel.stream?.key
        ? ({
            protocol: channel.stream.url.startsWith('rtmps://') ? 'rtmps' : 'rtmp',
            url: channel.stream.url,
            streamKey: channel.stream.key,
          } satisfies IngestTarget)
        : undefined;

    const ingest = fromApi ?? config.ingest;
    const check = validateIngest(ingest);
    if (!check.ok) {
      return {
        ok: false,
        code: 'CONFIG_INVALID',
        technical: `Kick needs a pasted stream URL and key. ${check.errors.join(' ')}`,
      };
    }

    const credentialPatch: CredentialRef | undefined = credential
      ? {
          ...credential,
          accountId: String(channel.broadcaster_user_id),
          ...(channel.slug ? { accountLabel: channel.slug } : {}),
        }
      : undefined;
    return {
      ok: true,
      ...(credentialPatch ? { credential: credentialPatch } : {}),
      ingest: ingest as IngestTarget,
      ...(channel.slug ? { watchUrl: `https://kick.com/${channel.slug}` } : {}),
    };
  }

  async createBroadcast(
    config: DestinationConfig,
    credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    const check = validateIngest(config.ingest);
    if (!check.ok) throw new Error(`Kick needs a stream URL and key. ${check.errors.join(' ')}`);
    const token = await this.tokenProvider(credential);
    if (config.metadata?.title || config.metadata?.category) {
      await this.patchChannel(token, config.metadata);
    }
    const slug = credential?.accountLabel;
    return {
      ...(credential?.accountId ? { streamId: credential.accountId } : {}),
      ingest: config.ingest as IngestTarget,
      ...(slug ? { watchUrl: `https://kick.com/${slug}` } : {}),
    };
  }

  async stopBroadcast(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<void> {
    // Kick has no stop endpoint. The stream ends when LIVETAP stops pushing bytes.
  }

  async getStatus(_handle: BroadcastHandle, credential?: CredentialRef): Promise<LiveStatus> {
    const token = await this.tokenProvider(credential);
    const body = await request<KickChannelsResponse>(this.fetch, {
      url: `${this.apiBase}/public/v1/channels`,
      token,
    });
    const stream = body?.data?.[0]?.stream;
    return {
      live: stream?.is_live === true,
      ingestHealth: stream?.is_live === true ? 'good' : 'noData',
      // NOTE: viewer_count is 0 when the streamer hid it — 0 does not mean "nobody".
      ...(stream?.viewer_count !== undefined ? { viewers: stream.viewer_count } : {}),
    };
  }

  async publishMetadata(
    _handle: BroadcastHandle,
    metadata: BroadcastMetadata,
    credential?: CredentialRef,
  ): Promise<void> {
    const token = await this.tokenProvider(credential);
    await this.patchChannel(token, metadata);
  }

  async sendChat(
    handle: BroadcastHandle,
    text: string,
    credential?: CredentialRef,
  ): Promise<void> {
    const token = await this.tokenProvider(credential);
    const broadcasterId = handle.streamId ?? credential?.accountId;
    await request(this.fetch, {
      url: `${this.apiBase}/public/v1/chat`,
      method: 'POST',
      token,
      json: {
        type: 'user',
        content: text,
        ...(broadcasterId ? { broadcaster_user_id: Number(broadcasterId) } : {}),
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
        url: `${this.apiBase}/public/v1/chat/${encodeURIComponent(id)}`,
        method: 'DELETE',
        token,
      });
      return;
    }
    const broadcasterId = handle.streamId ?? credential?.accountId;
    if (!broadcasterId) throw new Error('No Kick broadcaster id on the credential.');
    await request(this.fetch, {
      url: `${this.apiBase}/public/v1/moderation/bans`,
      method: 'POST',
      token,
      json: {
        broadcaster_user_id: Number(broadcasterId),
        user_id: Number(req.message.author.id),
        // Kick durations are MINUTES (1–10080). Twitch uses seconds; getting this wrong is a
        // factor-of-60 bug. Omit entirely for a permanent ban.
        ...(req.action === 'timeout'
          ? { duration: clampMinutes(req.durationSeconds ?? 300) }
          : {}),
      },
    });
  }

  // ------------------------------------------------------------------ internals

  private async patchChannel(token: string, metadata: BroadcastMetadata): Promise<void> {
    const body: Record<string, unknown> = {};
    if (metadata.title) body['stream_title'] = metadata.title;
    // `category` carries a Kick category_id resolved by the caller (GET /public/v2/categories).
    if (metadata.category) body['category_id'] = Number(metadata.category);
    if (Object.keys(body).length === 0) return;
    // Returns 204 No Content on success.
    await request(this.fetch, {
      url: `${this.apiBase}/public/v1/channels`,
      method: 'PATCH',
      token,
      json: body,
    });
  }
}

function clampMinutes(seconds: number): number {
  const minutes = Math.ceil(seconds / 60);
  return Math.min(10080, Math.max(1, minutes));
}
