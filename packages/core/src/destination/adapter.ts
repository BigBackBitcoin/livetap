import type {
  BroadcastMetadata,
  CapabilityKey,
  DestinationConfig,
  DestinationHealth,
  IngestTarget,
  PlatformProfile,
} from '../types/destination.js';
import type { ChatMessage, ModerationRequest } from '../types/chat.js';
import type { AspectRatio, ErrorCode } from '../types/destination.js';
import { isAutomated } from '../types/destination.js';

/**
 * Credential handle. Adapters never receive raw tokens from the UI; they receive an opaque
 * handle that a platform-specific SecureStore resolves. This keeps secrets out of renderer state.
 */
export interface CredentialRef {
  /** Opaque id in the secure store. */
  id: string;
  platform: string;
  /** Non-secret display data. */
  accountId?: string;
  accountLabel?: string;
  /**
   * The account's picture, as the platform serves it. Non-secret and the whole point of the
   * destination card: a creator recognises "Jam's Kitchen" and that avatar instantly, and
   * recognises a channel id never. Every adapter already fetches it on validate().
   */
  avatarUrl?: string;
  expiresAt?: number;
  /**
   * The scopes the platform actually GRANTED, not the ones LIVETAP asked for. Kick's consent
   * screen lets the creator untick streamkey:read, so the two lists routinely differ and only
   * this one may be used to decide whether LIVETAP can fetch a key or must ask for a pasted one.
   */
  scopes?: string[];
}

export interface AuthStartResult {
  /** URL to open in a system browser / auth window. */
  authorizationUrl: string;
  /** Opaque state to correlate the callback. */
  state: string;
  /** PKCE verifier held by the caller until the callback (never persisted unencrypted). */
  codeVerifier?: string;
}

export interface AuthCompleteInput {
  callbackUrl: string;
  state: string;
  codeVerifier?: string;
}

export interface BroadcastHandle {
  broadcastId?: string;
  streamId?: string;
  ingest: IngestTarget;
  watchUrl?: string;
}

export interface LiveStatus {
  live: boolean;
  /** Platform-reported ingest health. */
  ingestHealth?: 'good' | 'ok' | 'bad' | 'noData';
  viewers?: number;
}

export interface AnalyticsSnapshot {
  viewers?: number;
  peakViewers?: number;
  likes?: number;
  messages?: number;
  updatedAt: number;
}

export interface ChatSubscription {
  stop(): void;
}

/**
 * Capability-driven destination adapter.
 * Optional methods are only implemented when the platform profile marks the capability as automated.
 * The orchestrator checks `supports()` before calling any optional method.
 */
export interface DestinationAdapter {
  readonly profile: PlatformProfile;

  supports(capability: CapabilityKey): boolean;

  // --- Auth (OAuth platforms) ---
  beginAuth?(input: { redirectUri: string; aspectRatio?: AspectRatio }): Promise<AuthStartResult>;
  completeAuth?(input: AuthCompleteInput): Promise<CredentialRef>;
  disconnect(credential: CredentialRef | undefined): Promise<void>;

  /** Validate credentials/config and return the refreshed credential + resolved ingest if known. */
  validate(config: DestinationConfig, credential?: CredentialRef): Promise<{ ok: true; credential?: CredentialRef; ingest?: IngestTarget; watchUrl?: string } | { ok: false; code: ErrorCode; technical?: string }>;

  // --- Broadcast lifecycle ---
  /** Create the broadcast/stream on the platform (or just return the configured ingest for RTMP-only). */
  createBroadcast(config: DestinationConfig, credential?: CredentialRef): Promise<BroadcastHandle>;
  /** Transition the broadcast to live where the platform needs an explicit call. */
  startBroadcast?(handle: BroadcastHandle, credential?: CredentialRef): Promise<void>;
  stopBroadcast(handle: BroadcastHandle, credential?: CredentialRef): Promise<void>;
  getStatus?(handle: BroadcastHandle, credential?: CredentialRef): Promise<LiveStatus>;

  // --- Metadata ---
  publishMetadata?(handle: BroadcastHandle, metadata: BroadcastMetadata, credential?: CredentialRef): Promise<void>;
  publishThumbnail?(handle: BroadcastHandle, dataUrl: string, credential?: CredentialRef): Promise<void>;

  // --- Chat / moderation / analytics ---
  subscribeChat?(handle: BroadcastHandle, onMessage: (m: ChatMessage) => void, credential?: CredentialRef): Promise<ChatSubscription>;
  sendChat?(handle: BroadcastHandle, text: string, credential?: CredentialRef): Promise<void>;
  moderate?(handle: BroadcastHandle, req: ModerationRequest, credential?: CredentialRef): Promise<void>;
  getAnalytics?(handle: BroadcastHandle, credential?: CredentialRef): Promise<AnalyticsSnapshot>;

  /** Optional adapter-side health (platform-reported). */
  getHealth?(handle: BroadcastHandle, credential?: CredentialRef): Promise<Partial<DestinationHealth>>;
}

/** Default `supports` implementation derived from the profile's capability matrix. */
export function supportsFromProfile(profile: PlatformProfile, capability: CapabilityKey): boolean {
  return isAutomated(profile.capabilities[capability]);
}

export type AdapterFactory = (platform: string) => DestinationAdapter | undefined;

export class AdapterRegistry {
  private adapters = new Map<string, DestinationAdapter>();

  register(adapter: DestinationAdapter): this {
    this.adapters.set(adapter.profile.id, adapter);
    return this;
  }

  get(platform: string): DestinationAdapter | undefined {
    return this.adapters.get(platform);
  }

  list(): DestinationAdapter[] {
    return Array.from(this.adapters.values());
  }
}
