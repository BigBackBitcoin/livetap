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
  type DestinationHealth,
  type ErrorCode,
  type IngestTarget,
  type LiveStatus,
  type ModerationRequest,
  type PlatformProfile,
} from '@livetap/core';
import { mulberry32, type Rng } from './rng.js';
import { MOCK_BADGE_POOL, MOCK_DISPLAY_NAMES, MOCK_MESSAGES } from './corpus.js';

/** Shown wherever mock destinations are visible. Mock mode must never look like production. */
export const MOCK_BANNER = 'Mock mode — no real platforms are connected';

/** A mock handle is always self-identifying. */
export interface MockBroadcastHandle extends BroadcastHandle {
  readonly mock: true;
}

export interface MockTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: MockTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Scripted behaviour for a mock adapter. All fields optional; defaults are "happy path". */
export interface MockScenario {
  /** Seed for the deterministic PRNG. Same seed => same chat, same ids, same jitter. */
  seed?: number;
  /** Fixed latency for every simulated network call. Omit for a seeded 300–900 ms. */
  latencyMs?: number;
  /** Make validate() resolve `{ ok: false, code }`. */
  failValidate?: ErrorCode;
  /** Make createBroadcast() throw an error that core's classifyFailure maps back to this code. */
  failCreate?: ErrorCode;
  /** Milliseconds between mock chat messages (default 2500). */
  chatRateMs?: number;
  /** Starting viewer count for the analytics curve (default 12). */
  viewersStart?: number;
  /** Clock, injectable for deterministic tests. */
  now?: () => number;
  /** Timers, injectable for deterministic tests. */
  timers?: MockTimers;
}

/** HTTP-ish shapes so a scripted failure round-trips through core's classifyFailure. */
const FAILURE_SHAPES: Partial<Record<ErrorCode, { status?: number; message: string }>> = {
  AUTH_EXPIRED: { status: 401, message: 'mock: access token expired' },
  AUTH_REVOKED: { status: 403, message: 'mock: access revoked' },
  AUTH_MISSING_SCOPE: { status: 403, message: 'mock: insufficient scope for live streaming' },
  NOT_ELIGIBLE: { status: 403, message: 'mock: live streaming is not enabled for this account' },
  QUOTA_EXCEEDED: { status: 403, message: 'mock: daily quota exceeded' },
  RATE_LIMITED: { status: 429, message: 'mock: slow down' },
  PLATFORM_ERROR: { status: 503, message: 'mock: platform unavailable' },
  INGEST_INVALID_KEY: { message: 'mock: invalid stream key' },
  INGEST_REFUSED: { message: 'mock: connection refused' },
  INGEST_TIMEOUT: { message: 'mock: request timed out' },
  INGEST_DISCONNECTED: { message: 'mock: broken pipe' },
  NETWORK_OFFLINE: { message: 'mock: ENOTFOUND' },
  ENCODER_FAILED: { message: 'mock: encoder failed to start' },
};

export class MockAdapterError extends Error {
  readonly status: number | undefined;
  readonly code: ErrorCode;
  readonly mock = true as const;
  constructor(code: ErrorCode) {
    const shape = FAILURE_SHAPES[code] ?? { message: `mock: ${code}` };
    super(shape.message);
    this.name = 'MockAdapterError';
    this.status = shape.status;
    this.code = code;
  }
}

interface MockCallLog {
  validate: number;
  create: number;
  start: number;
  stop: number;
  metadata: number;
  thumbnail: number;
  chatSubscribe: number;
  chatSend: number;
  moderate: number;
  analytics: number;
  status: number;
}

/**
 * A realistic, offline stand-in for any destination platform.
 *
 * It honours the capability matrix of the profile it is given, so mock mode exercises exactly
 * the same capability-gated code paths as production: a mock TikTok still has no chat, and a
 * mock YouTube still needs an explicit start. Nothing here touches the network.
 */
export class MockDestinationAdapter implements DestinationAdapter {
  readonly profile: PlatformProfile;
  readonly scenario: MockScenario;
  readonly calls: MockCallLog = {
    validate: 0,
    create: 0,
    start: 0,
    stop: 0,
    metadata: 0,
    thumbnail: 0,
    chatSubscribe: 0,
    chatSend: 0,
    moderate: 0,
    analytics: 0,
    status: 0,
  };

  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly timers: MockTimers;
  private readonly chatRateMs: number;
  private readonly viewersStart: number;

  private live = false;
  private created = false;
  private startedAt: number | undefined;
  private peakViewers = 0;
  private messageCount = 0;
  private serial = 0;
  private destinationId = 'mock-destination';
  private listener: ((m: ChatMessage) => void) | undefined;
  private chatTimer: unknown;

  constructor(profile: PlatformProfile, scenario: MockScenario = {}) {
    // A mock profile must never claim to be production.
    this.profile = profile.mock === true ? profile : { ...profile, mock: true };
    this.scenario = scenario;
    this.rng = mulberry32(scenario.seed ?? 20260911);
    this.now = scenario.now ?? (() => Date.now());
    this.timers = scenario.timers ?? realTimers;
    this.chatRateMs = scenario.chatRateMs ?? 2500;
    this.viewersStart = scenario.viewersStart ?? 12;
  }

  supports(capability: CapabilityKey): boolean {
    return supportsFromProfile(this.profile, capability);
  }

  // ------------------------------------------------------------------ lifecycle

  async disconnect(_credential: CredentialRef | undefined): Promise<void> {
    this.stopChat();
    this.live = false;
    this.created = false;
  }

  async validate(
    config: DestinationConfig,
    _credential?: CredentialRef,
  ): Promise<
    | { ok: true; credential?: CredentialRef; ingest?: IngestTarget; watchUrl?: string }
    | { ok: false; code: ErrorCode; technical?: string }
  > {
    this.calls.validate++;
    this.destinationId = config.id;
    await this.delay();
    if (this.scenario.failValidate) {
      return {
        ok: false,
        code: this.scenario.failValidate,
        technical: new MockAdapterError(this.scenario.failValidate).message,
      };
    }
    // Platforms whose stream key the user pastes keep the user's ingest; the rest get a fake one.
    const ingest =
      this.profile.capabilities.streamKey === 'USER_ASSISTED' && config.ingest
        ? config.ingest
        : this.fakeIngest();
    return { ok: true, ingest };
  }

  async createBroadcast(
    config: DestinationConfig,
    _credential?: CredentialRef,
  ): Promise<BroadcastHandle> {
    this.calls.create++;
    this.destinationId = config.id;
    await this.delay();
    if (this.scenario.failCreate) throw new MockAdapterError(this.scenario.failCreate);

    const broadcastId = this.id('b');
    const handle: MockBroadcastHandle = {
      mock: true,
      broadcastId,
      streamId: this.id('s'),
      ingest:
        this.profile.capabilities.streamKey === 'USER_ASSISTED' && config.ingest
          ? config.ingest
          : this.fakeIngest(),
      watchUrl: `https://mock.livetap.app/${this.profile.id}/${broadcastId}`,
    };
    this.created = true;
    // Platforms that publish on ingest are live the moment the broadcast exists in mock mode.
    if (this.profile.autoStartsOnIngest) this.goLive();
    return handle;
  }

  async startBroadcast(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<void> {
    this.calls.start++;
    await this.delay();
    this.goLive();
  }

  async stopBroadcast(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<void> {
    this.calls.stop++;
    await this.delay();
    this.stopChat();
    this.live = false;
    this.created = false;
    this.startedAt = undefined;
  }

  async getStatus(_handle: BroadcastHandle, _credential?: CredentialRef): Promise<LiveStatus> {
    this.calls.status++;
    return {
      live: this.live,
      ingestHealth: this.live ? 'good' : 'noData',
      viewers: this.live ? this.viewers() : 0,
    };
  }

  async getHealth(
    _handle: BroadcastHandle,
    _credential?: CredentialRef,
  ): Promise<Partial<DestinationHealth>> {
    const target = this.profile.recommended.maxVideoKbps;
    return {
      bitrateKbps: this.live ? Math.round(target * (0.88 + this.rng.next() * 0.1)) : 0,
      droppedFramesPct: this.live ? Number((this.rng.next() * 0.4).toFixed(2)) : 0,
      rttMs: 20 + this.rng.int(40),
      viewers: this.live ? this.viewers() : 0,
      platformStatus: this.live ? 'good' : 'noData',
      updatedAt: this.now(),
    };
  }

  // ------------------------------------------------------------------ metadata

  async publishMetadata(
    _handle: BroadcastHandle,
    _metadata: BroadcastMetadata,
    _credential?: CredentialRef,
  ): Promise<void> {
    this.calls.metadata++;
    await this.delay();
  }

  async publishThumbnail(
    _handle: BroadcastHandle,
    _dataUrl: string,
    _credential?: CredentialRef,
  ): Promise<void> {
    this.calls.thumbnail++;
    await this.delay();
  }

  // ------------------------------------------------------------------ chat

  async subscribeChat(
    _handle: BroadcastHandle,
    onMessage: (m: ChatMessage) => void,
    _credential?: CredentialRef,
  ): Promise<ChatSubscription> {
    this.calls.chatSubscribe++;
    this.listener = onMessage;
    const tick = (): void => {
      if (this.listener !== onMessage) return;
      onMessage(this.nextChatMessage());
      this.chatTimer = this.timers.setTimeout(tick, this.chatRateMs);
    };
    this.chatTimer = this.timers.setTimeout(tick, this.chatRateMs);
    return {
      stop: () => {
        if (this.listener === onMessage) this.stopChat();
      },
    };
  }

  async sendChat(
    _handle: BroadcastHandle,
    text: string,
    _credential?: CredentialRef,
  ): Promise<void> {
    this.calls.chatSend++;
    await this.delay();
    this.messageCount++;
    this.listener?.({
      id: this.id('m'),
      platform: this.profile.id,
      destinationId: this.destinationId,
      author: { id: 'mock-broadcaster', displayName: 'You', badges: ['owner'] },
      text,
      receivedAt: this.now(),
      own: true,
      mock: true,
    });
  }

  async moderate(
    _handle: BroadcastHandle,
    _req: ModerationRequest,
    _credential?: CredentialRef,
  ): Promise<void> {
    this.calls.moderate++;
    await this.delay();
  }

  async getAnalytics(
    _handle: BroadcastHandle,
    _credential?: CredentialRef,
  ): Promise<AnalyticsSnapshot> {
    this.calls.analytics++;
    const viewers = this.live ? this.viewers() : 0;
    this.peakViewers = Math.max(this.peakViewers, viewers);
    return {
      viewers,
      peakViewers: this.peakViewers,
      likes: Math.round(viewers * (0.18 + this.rng.next() * 0.1)),
      messages: this.messageCount,
      updatedAt: this.now(),
    };
  }

  // ------------------------------------------------------------------ internals

  /** Viewer curve: fast early growth that flattens out, plus seeded jitter. */
  private viewers(): number {
    if (this.startedAt === undefined) return 0;
    const minutes = Math.max(0, (this.now() - this.startedAt) / 60000);
    const curve = this.viewersStart * (1 + 2.4 * Math.log1p(minutes));
    const jitter = 1 + (this.rng.next() - 0.5) * 0.12;
    return Math.max(0, Math.round(curve * jitter));
  }

  private nextChatMessage(): ChatMessage {
    this.messageCount++;
    const badge = this.rng.pick(MOCK_BADGE_POOL);
    const name = this.rng.pick(MOCK_DISPLAY_NAMES);
    return {
      id: this.id('m'),
      platform: this.profile.id,
      destinationId: this.destinationId,
      author: {
        id: `mock-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        displayName: name,
        ...(badge ? { badges: [badge] } : {}),
      },
      text: this.rng.pick(MOCK_MESSAGES),
      receivedAt: this.now(),
      platformMessageId: this.id('pm'),
      mock: true,
    };
  }

  private goLive(): void {
    if (!this.created) this.created = true;
    if (!this.live) {
      this.live = true;
      this.startedAt = this.now();
    }
  }

  private stopChat(): void {
    if (this.chatTimer !== undefined) {
      this.timers.clearTimeout(this.chatTimer);
      this.chatTimer = undefined;
    }
    this.listener = undefined;
  }

  private fakeIngest(): IngestTarget {
    return {
      protocol: 'rtmp',
      url: `rtmp://mock.${this.profile.id}.livetap.local/live`,
      streamKey: `mock-${this.profile.id}-${this.hex(12)}`,
    };
  }

  private id(prefix: string): string {
    this.serial++;
    return `mk_${prefix}_${this.profile.id}_${this.serial}_${this.hex(6)}`;
  }

  private hex(length: number): string {
    let out = '';
    while (out.length < length) out += this.rng.int(16).toString(16);
    return out.slice(0, length);
  }

  private async delay(): Promise<void> {
    const ms = this.scenario.latencyMs ?? this.rng.between(300, 900);
    if (ms <= 0) return;
    await new Promise<void>((resolve) => {
      this.timers.setTimeout(resolve, ms);
    });
  }
}
