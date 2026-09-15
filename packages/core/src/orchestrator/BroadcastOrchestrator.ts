import { TypedEmitter } from '../events.js';
import type { AdapterRegistry, BroadcastHandle, CredentialRef, ChatSubscription } from '../destination/adapter.js';
import { isActiveState, isStartable, nextDestinationState, type DestinationEvent } from '../destination/stateMachine.js';
import { reconnectDelayMs, shouldRetry } from '../destination/reconnect.js';
import { humanize, classifyFailure } from '../errors/humanize.js';
import type { MediaEngine, EngineOutput, EngineOutputEvent } from '../media/engine.js';
import { resolveFormats } from '../production/formats.js';
import { defaultMoments } from '../moments/defaults.js';
import type {
  AccountSummary,
  AspectRatio,
  DestinationConfig,
  DestinationSnapshot,
  DestinationState,
  ErrorCode,
  HumaneError,
} from '../types/destination.js';
import type { Moment } from '../types/moment.js';
import type { ProductionSettings, ProductionSnapshot, ProductionState } from '../types/production.js';
import type { ChatMessage } from '../types/chat.js';
import type { EngineMetrics } from '../types/health.js';
import { validateIngest } from '../validation/ingest.js';

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface OrchestratorDeps {
  registry: AdapterRegistry;
  engine: MediaEngine;
  settings?: ProductionSettings;
  scheduler?: Scheduler;
  now?: () => number;
  random?: () => number;
  moments?: Moment[];
}

export interface OrchestratorEvents extends Record<string, unknown> {
  destination: DestinationSnapshot;
  production: ProductionSnapshot;
  chat: ChatMessage;
  metrics: EngineMetrics;
  notice: { level: 'info' | 'warning' | 'error'; error?: HumaneError; destinationId?: string; message: string };
  moment: Moment;
}

interface Record_ {
  snapshot: DestinationSnapshot;
  credential?: CredentialRef;
  handle?: BroadcastHandle;
  reconnectTimer?: unknown;
  chat?: ChatSubscription;
}

/**
 * BroadcastOrchestrator: the single place where production state, destination state machines,
 * the media engine and destination adapters meet.
 *
 * Guarantees:
 * - A destination failure never changes another destination's state.
 * - The production becomes LIVE only when a destination has actually arrived on the wire, and
 *   stays LIVE as long as at least one destination is active.
 * - All state changes go through the destination transition table.
 * - No secrets are held in snapshots (CredentialRef and BroadcastHandle are kept in private records).
 */
/**
 * A production that has been asked to start and has not stopped.
 *
 * STARTING and LIVE differ in what they CLAIM, not in what has to be cleaned up: both hold an
 * encoder, both own destinations, and both have to end when the last of those destinations dies.
 * Every place that asks "is something running?" rather than "is it live?" asks this one.
 */
function isRunning(state: ProductionState): boolean {
  return state === 'STARTING' || state === 'LIVE';
}

export class BroadcastOrchestrator extends TypedEmitter<OrchestratorEvents> {
  private readonly registry: AdapterRegistry;
  private readonly engine: MediaEngine;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly records = new Map<string, Record_>();
  private readonly offEngine: Array<() => void> = [];

  settings: ProductionSettings;
  moments: Moment[];
  private activeMomentId: string | null;
  private productionState: ProductionState = 'IDLE';
  private startedAt: number | undefined;
  private recording = false;
  private engineRunning = false;

  constructor(deps: OrchestratorDeps) {
    super();
    this.registry = deps.registry;
    this.engine = deps.engine;
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.settings = deps.settings ?? defaultSettings();
    this.moments = deps.moments ?? defaultMoments();
    this.activeMomentId = this.moments[1]?.id ?? this.moments[0]?.id ?? null;

    this.offEngine.push(this.engine.on('output', (e) => this.onEngineOutput(e)));
    this.offEngine.push(this.engine.on('metrics', (m) => this.emit('metrics', m)));
    this.offEngine.push(
      this.engine.on('engineError', ({ code, technical }) => {
        this.emit('notice', { level: 'error', error: humanize(code, { technical }), message: humanize(code).what });
      }),
    );
    this.offEngine.push(
      this.engine.on('deviceLost', ({ kind }) => {
        const code: ErrorCode = kind === 'camera' ? 'CAMERA_LOST' : kind === 'mic' ? 'MIC_LOST' : 'SCREEN_DENIED';
        this.emit('notice', { level: 'warning', error: humanize(code), message: humanize(code).what });
      }),
    );
    this.offEngine.push(
      this.engine.on('recording', (r) => {
        this.recording = r.state === 'started';
        if (r.state === 'failed') {
          const err = humanize(r.code ?? 'RECORDING_FAILED');
          this.emit('notice', { level: 'warning', error: err, message: err.what });
        }
        this.emitProduction();
      }),
    );
  }

  // ---------------------------------------------------------------- snapshots

  getProduction(): ProductionSnapshot {
    const snaps = this.listDestinations();
    return {
      state: this.productionState,
      activeMomentId: this.activeMomentId,
      startedAt: this.startedAt,
      liveCount: snaps.filter((s) => s.state === 'LIVE' || s.state === 'DEGRADED').length,
      enabledCount: snaps.filter((s) => s.config.enabled).length,
      recording: this.recording,
    };
  }

  listDestinations(): DestinationSnapshot[] {
    return Array.from(this.records.values()).map((r) => r.snapshot);
  }

  getDestination(id: string): DestinationSnapshot | undefined {
    return this.records.get(id)?.snapshot;
  }

  getActiveMoment(): Moment | undefined {
    return this.moments.find((m) => m.id === this.activeMomentId);
  }

  // ---------------------------------------------------------------- destinations

  addDestination(config: DestinationConfig): DestinationSnapshot {
    if (this.records.has(config.id)) throw new Error(`Destination ${config.id} already exists`);
    const snapshot: DestinationSnapshot = {
      config,
      state: 'DISCONNECTED',
      reconnectAttempt: 0,
      stateChangedAt: this.now(),
    };
    this.records.set(config.id, { snapshot });
    this.emit('destination', snapshot);
    return snapshot;
  }

  updateDestination(id: string, patch: Partial<Omit<DestinationConfig, 'id' | 'platform'>>): DestinationSnapshot {
    const rec = this.must(id);
    rec.snapshot = { ...rec.snapshot, config: { ...rec.snapshot.config, ...patch } };
    this.emit('destination', rec.snapshot);
    this.emitProduction();
    return rec.snapshot;
  }

  async removeDestination(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) return;
    if (isActiveState(rec.snapshot.state)) await this.stopDestination(id);
    this.clearReconnect(rec);
    rec.chat?.stop();
    this.records.delete(id);
    this.emitProduction();
  }

  /** Validate credentials/config for one destination (DISCONNECTED → AUTHENTICATING → READY). */
  async connect(id: string, credential?: CredentialRef): Promise<DestinationSnapshot> {
    const rec = this.must(id);
    const adapter = this.registry.get(rec.snapshot.config.platform);
    if (!adapter) {
      return this.fail(rec, 'CONFIG_INVALID', `No adapter for platform ${rec.snapshot.config.platform}`, 'AUTH_FAIL');
    }
    if (credential) rec.credential = credential;
    if (credential) rec.snapshot = withAccount(rec.snapshot, credential);
    if (!this.apply(rec, 'CONNECT')) return rec.snapshot;

    if (rec.snapshot.config.platform === 'custom' || adapter.profile.capabilities.streamKey === 'USER_ASSISTED') {
      const v = validateIngest(rec.snapshot.config.ingest);
      if (!v.ok) return this.fail(rec, 'CONFIG_INVALID', v.errors.join(' '), 'AUTH_FAIL');
    }

    try {
      const result = await adapter.validate(rec.snapshot.config, rec.credential);
      if (!result.ok) return this.fail(rec, result.code, result.technical, 'AUTH_FAIL');
      if (result.credential) {
        rec.credential = result.credential;
        // validate() is the ONE call that knows who the token belongs to. Every adapter already
        // asks the platform, and until now every adapter's answer was dropped here.
        rec.snapshot = withAccount(rec.snapshot, result.credential);
      }
      if (result.ingest) rec.snapshot = { ...rec.snapshot, config: { ...rec.snapshot.config, ingest: result.ingest } };
      if (result.watchUrl) rec.snapshot = { ...rec.snapshot, watchUrl: result.watchUrl };
      rec.snapshot = { ...rec.snapshot, error: undefined };
      this.apply(rec, 'AUTH_OK');
      return rec.snapshot;
    } catch (err) {
      return this.fail(rec, classifyFailure(errorInfo(err)), safeMessage(err), 'AUTH_FAIL');
    }
  }

  async disconnect(id: string): Promise<void> {
    const rec = this.must(id);
    if (isActiveState(rec.snapshot.state)) await this.stopDestination(id);
    const adapter = this.registry.get(rec.snapshot.config.platform);
    try {
      await adapter?.disconnect(rec.credential);
    } catch {
      /* disconnect is best-effort */
    }
    rec.credential = undefined;
    rec.handle = undefined;
    // The card must stop naming an account the moment the credential is gone. Leaving the name and
    // avatar behind after a revoke would be the UI claiming a connection that no longer exists.
    const { account: _dropped, ...withoutAccount } = rec.snapshot;
    rec.snapshot = withoutAccount;
    this.clearReconnect(rec);
    this.apply(rec, 'DISCONNECT');
  }

  // ---------------------------------------------------------------- moments

  async setMoment(momentId: string): Promise<void> {
    const moment = this.moments.find((m) => m.id === momentId);
    if (!moment) throw new Error(`Unknown moment ${momentId}`);
    this.activeMomentId = momentId;
    await this.engine.setMoment(moment);
    this.emit('moment', moment);
    this.emitProduction();
  }

  upsertMoment(moment: Moment): void {
    const idx = this.moments.findIndex((m) => m.id === moment.id);
    if (idx >= 0) this.moments[idx] = moment;
    else this.moments.push(moment);
    if (moment.id === this.activeMomentId) void this.engine.setMoment(moment);
    this.emit('moment', moment);
  }

  // ---------------------------------------------------------------- preview / live

  async startPreview(): Promise<void> {
    const moment = this.getActiveMoment();
    if (!moment) return;
    await this.engine.startPreview(moment, this.settings.masterAspectRatio);
    if (this.productionState === 'IDLE') this.setProductionState('PREVIEW');
  }

  async stopPreview(): Promise<void> {
    await this.engine.stopPreview();
    if (this.productionState === 'PREVIEW') this.setProductionState('IDLE');
  }

  /**
   * GO LIVE. Starts every enabled, startable destination. Destinations that fail during creation are
   * marked FAILED individually and never block the others. Returns the resulting snapshots.
   */
  async goLive(): Promise<DestinationSnapshot[]> {
    if (this.productionState === 'LIVE' || this.productionState === 'STARTING') return this.listDestinations();
    const candidates = Array.from(this.records.values()).filter(
      (r) => r.snapshot.config.enabled && isStartable(r.snapshot.state),
    );
    if (candidates.length === 0) {
      this.emit('notice', {
        level: 'warning',
        message: 'Connect at least one destination before going live.',
      });
      return this.listDestinations();
    }

    this.setProductionState('STARTING');
    for (const rec of candidates) this.apply(rec, 'START');

    // Create broadcasts in parallel; each failure is isolated.
    const outputs: EngineOutput[] = [];
    await Promise.all(
      candidates.map(async (rec) => {
        const adapter = this.registry.get(rec.snapshot.config.platform);
        if (!adapter) {
          this.fail(rec, 'CONFIG_INVALID', 'No adapter registered', 'GIVE_UP');
          return;
        }
        try {
          const handle = await adapter.createBroadcast(rec.snapshot.config, rec.credential);
          rec.handle = handle;
          rec.snapshot = {
            ...rec.snapshot,
            broadcastId: handle.broadcastId,
            streamId: handle.streamId,
            watchUrl: handle.watchUrl ?? rec.snapshot.watchUrl,
            error: undefined,
          };
          if (adapter.supports('metadata') && adapter.publishMetadata && rec.snapshot.config.metadata) {
            try {
              await adapter.publishMetadata(handle, rec.snapshot.config.metadata, rec.credential);
            } catch (err) {
              this.emit('notice', {
                level: 'warning',
                destinationId: rec.snapshot.config.id,
                message: `Could not update title/description on ${adapter.profile.displayName}.`,
                error: humanize('PLATFORM_ERROR', { platform: adapter.profile.displayName, technical: safeMessage(err) }),
              });
            }
          }
          outputs.push({
            destinationId: rec.snapshot.config.id,
            aspectRatio: rec.snapshot.config.aspectRatio,
            ingest: handle.ingest,
          });
          this.emit('destination', rec.snapshot);
        } catch (err) {
          this.fail(rec, classifyFailure(errorInfo(err)), safeMessage(err), 'GIVE_UP');
        }
      }),
    );

    if (outputs.length === 0) {
      this.setProductionState('PREVIEW');
      this.emit('notice', { level: 'error', message: 'No destination could be started. Nothing went live.' });
      return this.listDestinations();
    }

    const aspects = Array.from(new Set(outputs.map((o) => o.aspectRatio))) as AspectRatio[];
    try {
      await this.engine.start({
        formats: resolveFormats(this.settings, aspects),
        outputs,
        encoder: this.settings.encoder,
        recording: this.settings.recording,
      });
      this.engineRunning = true;
    } catch (err) {
      // Engine failure is global: every started destination fails with the same humane error.
      const code = classifyFailure(errorInfo(err));
      for (const rec of candidates) {
        if (isActiveState(rec.snapshot.state)) this.fail(rec, code === 'UNKNOWN' ? 'ENCODER_FAILED' : code, safeMessage(err), 'GIVE_UP');
      }
      this.setProductionState('PREVIEW');
      return this.listDestinations();
    }

    /*
     * NOT `setProductionState('LIVE')`, and this is the invariant the whole product rests on.
     *
     * `engine.start()` resolving means the encoder is running. It does not mean one byte reached
     * one destination: on desktop each sender is a separate process that is spawned and then dies
     * asynchronously if the far end refuses it, so an engine start succeeds identically whether
     * the ingest server is listening or was switched off an hour ago. Setting LIVE here made the
     * headline, the elapsed timer and the live bar all say a broadcast was happening while the
     * receiver reported zero publishers — a claim the creator acts on, tells an audience about,
     * and cannot see through.
     *
     * The production is live when the FIRST destination reports `outputUp`, which every engine
     * emits only on evidence: FfmpegEngine on bytes actually written by the sender, BrowserEngine
     * on a WHIP session the relay accepted, MockEngine on a target that is provably unreachable
     * and therefore honest about being a simulation. Until then this stays STARTING, which the
     * UI already renders as "Starting your broadcast" with a Cancel — true, and cancellable.
     *
     * `startedAt` moves with it, so the timer counts time on the wire rather than time since a
     * button was pressed.
     */
    return this.listDestinations();
  }

  /** Stop the whole production. Each destination is ended independently; errors are swallowed per destination. */
  async stop(): Promise<void> {
    if (this.productionState !== 'LIVE' && this.productionState !== 'STARTING') return;
    this.setProductionState('STOPPING');
    // Active destinations are stopped; FAILED ones are moved to ENDED (their error is kept for display)
    // so the next GO LIVE can start them again without a manual reset.
    const active = Array.from(this.records.values()).filter(
      (r) => isActiveState(r.snapshot.state) || r.snapshot.state === 'FAILED',
    );
    for (const rec of active) if (isActiveState(rec.snapshot.state)) this.apply(rec, 'STOP');
    try {
      await this.engine.stop();
    } catch (err) {
      this.emit('notice', { level: 'warning', message: 'Encoder did not stop cleanly.', error: humanize('ENCODER_FAILED', { technical: safeMessage(err) }) });
    }
    this.engineRunning = false;
    await Promise.all(active.map((rec) => this.finishStop(rec)));
    this.startedAt = undefined;
    this.setProductionState('PREVIEW');
  }

  /** Stop a single destination while the production keeps running. */
  async stopDestination(id: string): Promise<void> {
    const rec = this.must(id);
    if (!isActiveState(rec.snapshot.state)) return;
    this.clearReconnect(rec);
    this.apply(rec, 'STOP');
    if (this.engineRunning) {
      try {
        await this.engine.removeOutput(id);
      } catch {
        /* best effort */
      }
    }
    await this.finishStop(rec);
    // If that was the last active destination, the production ends too. STARTING counts: a
    // production whose every destination died before any of them arrived never became live, and
    // leaving it STARTING forever is the same lie in a quieter register.
    if (!this.listDestinations().some((s) => isActiveState(s.state)) && isRunning(this.productionState)) {
      await this.stop();
    } else {
      this.emitProduction();
    }
  }

  /** Reset a FAILED/ENDED destination to READY (credentials retained). */
  resetDestination(id: string): DestinationSnapshot {
    const rec = this.must(id);
    this.clearReconnect(rec);
    rec.snapshot = { ...rec.snapshot, error: undefined, reconnectAttempt: 0 };
    this.apply(rec, 'RESET');
    return rec.snapshot;
  }

  /** Re-add a FAILED destination to a live production (creates a new broadcast and output). */
  async retryDestination(id: string): Promise<DestinationSnapshot> {
    const rec = this.must(id);
    if (rec.snapshot.state === 'FAILED') this.resetDestination(id);
    if (this.productionState !== 'LIVE' || !isStartable(rec.snapshot.state)) return rec.snapshot;
    const adapter = this.registry.get(rec.snapshot.config.platform);
    if (!adapter) return rec.snapshot;
    this.apply(rec, 'START');
    try {
      const handle = await adapter.createBroadcast(rec.snapshot.config, rec.credential);
      rec.handle = handle;
      rec.snapshot = { ...rec.snapshot, broadcastId: handle.broadcastId, streamId: handle.streamId, watchUrl: handle.watchUrl ?? rec.snapshot.watchUrl };
      await this.engine.addOutput({ destinationId: id, aspectRatio: rec.snapshot.config.aspectRatio, ingest: handle.ingest });
    } catch (err) {
      this.fail(rec, classifyFailure(errorInfo(err)), safeMessage(err), 'GIVE_UP');
    }
    return rec.snapshot;
  }

  async sendChat(destinationId: string, text: string): Promise<void> {
    const rec = this.must(destinationId);
    const adapter = this.registry.get(rec.snapshot.config.platform);
    if (!adapter?.supports('chatWrite') || !adapter.sendChat || !rec.handle) {
      throw new Error('This destination does not support sending chat.');
    }
    await adapter.sendChat(rec.handle, text, rec.credential);
  }

  dispose(): void {
    for (const off of this.offEngine) off();
    for (const rec of this.records.values()) {
      this.clearReconnect(rec);
      rec.chat?.stop();
    }
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------- engine events

  private onEngineOutput(e: EngineOutputEvent): void {
    const rec = this.records.get(e.destinationId);
    if (!rec) return;
    switch (e.type) {
      case 'outputUp':
        void this.onOutputUp(rec);
        break;
      case 'outputDegraded':
        if (this.apply(rec, 'STREAM_DEGRADED')) {
          rec.snapshot = { ...rec.snapshot, error: humanize('NETWORK_DEGRADED', this.ctx(rec, e.technical)) };
          this.emit('destination', rec.snapshot);
        }
        break;
      case 'outputRecovered':
        if (this.apply(rec, 'STREAM_RECOVERED')) {
          rec.snapshot = { ...rec.snapshot, error: undefined };
          this.emit('destination', rec.snapshot);
        }
        break;
      case 'outputLost':
        this.onOutputLost(rec, e.code, e.technical);
        break;
      case 'outputStopped':
        // Engine confirms an output ended; the state machine already moved to STOPPING/ENDED via stop().
        break;
    }
  }

  private async onOutputUp(rec: Record_): Promise<void> {
    const adapter = this.registry.get(rec.snapshot.config.platform);
    const wasReconnecting = rec.snapshot.state === 'RECONNECTING';
    // Explicit platform start (e.g. YouTube transition to live) happens once ingest is up, first time only.
    if (!wasReconnecting && adapter?.startBroadcast && rec.handle && adapter.profile.autoStartsOnIngest === false) {
      try {
        await adapter.startBroadcast(rec.handle, rec.credential);
      } catch (err) {
        this.fail(rec, classifyFailure(errorInfo(err)), safeMessage(err), 'GIVE_UP');
        if (this.engineRunning) void this.engine.removeOutput(rec.snapshot.config.id).catch(() => undefined);
        return;
      }
    }
    if (this.apply(rec, 'STREAM_UP')) {
      rec.snapshot = { ...rec.snapshot, error: undefined, reconnectAttempt: 0, nextRetryAt: undefined };
      this.emit('destination', rec.snapshot);
      // The first destination to genuinely arrive is what makes the production live. See goLive().
      if (this.productionState === 'STARTING') {
        this.startedAt = this.now();
        this.setProductionState('LIVE');
      }
      this.emitProduction();
      if (!wasReconnecting) this.subscribeChat(rec, adapter);
    }
  }

  private onOutputLost(rec: Record_, code: ErrorCode, technical?: string): void {
    if (!this.apply(rec, 'STREAM_LOST')) return;
    const policy = this.settings.reconnect;
    const attempt = rec.snapshot.reconnectAttempt + 1;
    if (!shouldRetry(policy, attempt) || code === 'INGEST_INVALID_KEY' || code === 'AUTH_EXPIRED' || code === 'AUTH_REVOKED') {
      this.fail(rec, code, technical, 'GIVE_UP');
      return;
    }
    rec.snapshot = {
      ...rec.snapshot,
      reconnectAttempt: attempt,
      error: humanize(code === 'UNKNOWN' ? 'INGEST_DISCONNECTED' : code, this.ctx(rec, technical)),
    };
    this.emit('destination', rec.snapshot);
    this.emitProduction();
    this.scheduleReconnect(rec, attempt);
  }

  private scheduleReconnect(rec: Record_, attempt: number): void {
    this.clearReconnect(rec);
    const delay = reconnectDelayMs(this.settings.reconnect, attempt, this.random);
    rec.snapshot = {
      ...rec.snapshot,
      nextRetryAt: this.now() + delay,
      reconnectMaxAttempts: this.settings.reconnect.maxAttempts,
    };
    this.emit('destination', rec.snapshot);
    rec.reconnectTimer = this.scheduler.setTimeout(() => {
      rec.reconnectTimer = undefined;
      rec.snapshot = { ...rec.snapshot, nextRetryAt: undefined };
      void this.attemptReconnect(rec);
    }, delay);
  }

  private async attemptReconnect(rec: Record_): Promise<void> {
    if (rec.snapshot.state !== 'RECONNECTING' || !this.engineRunning || !rec.handle) return;
    this.apply(rec, 'RECONNECT_ATTEMPT');
    try {
      await this.engine.addOutput({
        destinationId: rec.snapshot.config.id,
        aspectRatio: rec.snapshot.config.aspectRatio,
        ingest: rec.handle.ingest,
      });
      // Success is signalled by the engine's outputUp event.
    } catch (err) {
      const attempt = rec.snapshot.reconnectAttempt + 1;
      if (!shouldRetry(this.settings.reconnect, attempt)) {
        this.fail(rec, classifyFailure(errorInfo(err)), safeMessage(err), 'GIVE_UP');
        return;
      }
      this.apply(rec, 'RECONNECT_FAIL');
      rec.snapshot = { ...rec.snapshot, reconnectAttempt: attempt };
      this.emit('destination', rec.snapshot);
      this.scheduleReconnect(rec, attempt);
    }
  }

  private subscribeChat(rec: Record_, adapter: ReturnType<AdapterRegistry['get']>): void {
    if (!adapter?.supports('chatRead') || !adapter.subscribeChat || !rec.handle || rec.chat) return;
    adapter
      .subscribeChat(rec.handle, (m) => this.emit('chat', m), rec.credential)
      .then((sub) => {
        rec.chat = sub;
      })
      .catch((err) => {
        this.emit('notice', {
          level: 'warning',
          destinationId: rec.snapshot.config.id,
          message: `Chat for ${adapter.profile.displayName} is unavailable right now.`,
          error: humanize('PLATFORM_ERROR', this.ctx(rec, safeMessage(err))),
        });
      });
  }

  // ---------------------------------------------------------------- helpers

  private async finishStop(rec: Record_): Promise<void> {
    rec.chat?.stop();
    rec.chat = undefined;
    const adapter = this.registry.get(rec.snapshot.config.platform);
    if (adapter && rec.handle) {
      try {
        await adapter.stopBroadcast(rec.handle, rec.credential);
      } catch (err) {
        this.emit('notice', {
          level: 'warning',
          destinationId: rec.snapshot.config.id,
          message: `${adapter.profile.displayName} may still show the broadcast as live for a moment.`,
          error: humanize('PLATFORM_ERROR', this.ctx(rec, safeMessage(err))),
        });
      }
    }
    rec.handle = undefined;
    if (rec.snapshot.state === 'STOPPING') this.apply(rec, 'STOPPED');
    else if (rec.snapshot.state === 'FAILED') this.apply(rec, 'STOP');
  }

  private fail(rec: Record_, code: ErrorCode, technical: string | undefined, event: DestinationEvent): DestinationSnapshot {
    this.clearReconnect(rec);
    const error = humanize(code, this.ctx(rec, technical));
    rec.snapshot = { ...rec.snapshot, error };
    if (!this.apply(rec, event)) {
      // No valid transition (e.g. failing while READY): still surface the error.
      this.emit('destination', rec.snapshot);
    }
    this.emit('notice', { level: 'error', destinationId: rec.snapshot.config.id, error, message: error.what });
    this.emitProduction();
    // If this failure removed the last active destination of a running production, end it.
    if (isRunning(this.productionState) && !this.listDestinations().some((s) => isActiveState(s.state))) {
      void this.stop();
    }
    return rec.snapshot;
  }

  private apply(rec: Record_, event: DestinationEvent): boolean {
    const next = nextDestinationState(rec.snapshot.state, event);
    if (next === null) return false;
    this.setDestinationState(rec, next);
    return true;
  }

  private setDestinationState(rec: Record_, state: DestinationState): void {
    if (rec.snapshot.state === state && state !== 'RECONNECTING') return;
    rec.snapshot = { ...rec.snapshot, state, stateChangedAt: this.now() };
    this.emit('destination', rec.snapshot);
  }

  private setProductionState(state: ProductionState): void {
    this.productionState = state;
    this.emitProduction();
  }

  private emitProduction(): void {
    this.emit('production', this.getProduction());
  }

  private ctx(rec: Record_, technical?: string) {
    const adapter = this.registry.get(rec.snapshot.config.platform);
    const displayName = adapter?.profile.displayName ?? rec.snapshot.config.platform;
    const label = rec.snapshot.config.label;
    return {
      target: !label || label === displayName ? displayName : `${displayName} · ${label}`,
      platform: adapter?.profile.displayName,
      autoReconnect: this.settings.reconnect.enabled,
      technical,
    };
  }

  private clearReconnect(rec: Record_): void {
    if (rec.reconnectTimer !== undefined) {
      this.scheduler.clearTimeout(rec.reconnectTimer);
      rec.reconnectTimer = undefined;
    }
  }

  private must(id: string): Record_ {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`Unknown destination ${id}`);
    return rec;
  }
}

/**
 * The non-secret half of a credential, and nothing else.
 *
 * Built field by field rather than by spreading the CredentialRef, so that adding a field to
 * CredentialRef can never widen what reaches a snapshot. `id` is the secure-store handle and is
 * deliberately absent: it is not a secret, but it is not the UI's business either, and a snapshot
 * is persisted.
 */
export function accountSummary(credential: CredentialRef): AccountSummary | undefined {
  const summary: AccountSummary = {};
  if (credential.accountId) summary.accountId = credential.accountId;
  if (credential.accountLabel) summary.accountLabel = credential.accountLabel;
  if (credential.avatarUrl) summary.avatarUrl = credential.avatarUrl;
  if (credential.scopes && credential.scopes.length > 0) summary.scopes = [...credential.scopes];
  if (typeof credential.expiresAt === 'number') summary.expiresAt = credential.expiresAt;
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function withAccount(snapshot: DestinationSnapshot, credential: CredentialRef): DestinationSnapshot {
  const summary = accountSummary(credential);
  if (!summary) return snapshot;
  return { ...snapshot, account: summary };
}

function defaultSettings(): ProductionSettings {
  return {
    masterAspectRatio: '16:9',
    qualityPreset: 'auto',
    encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
    recording: { enabled: false, container: 'mp4', source: 'program' },
    reconnect: { enabled: true, maxAttempts: 10, initialDelayMs: 1000, maxDelayMs: 30000, multiplier: 2, jitter: 0.2 },
  };
}

function errorInfo(err: unknown): { status?: number; message?: string; kind?: string } {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string; kind?: string; code?: string };
    return { status: e.status, message: e.message ?? e.code, kind: e.kind };
  }
  return { message: String(err) };
}

/** Never leak stream keys/tokens through error messages. */
function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/(rtmps?:\/\/[^\s]+\/)([^\s/?]+)/gi, '$1••••').replace(/(token|key|secret)=([^&\s]+)/gi, '$1=••••').slice(0, 500);
}
