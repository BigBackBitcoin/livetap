/**
 * The app store: one `BroadcastOrchestrator`, mirrored into React.
 *
 * Rules this file keeps:
 *  - Exactly one orchestrator and one media engine exist per store. Screens never construct either.
 *  - React state is a *mirror*: every destination and production change arrives as an orchestrator
 *    event, so the UI can never disagree with the machine.
 *  - Nothing secret is stored here or persisted. Stream keys live in `secrets.ts`.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  BroadcastOrchestrator,
  DEFAULT_PRODUCTION_SETTINGS,
  INTENT_PROFILES,
  buildAutomaticProduction,
  defaultMoments,
} from '@livetap/core';
import type {
  AdapterRegistry,
  AspectRatio,
  AutomaticProduction,
  ChatMessage,
  ContentType,
  DestinationAspectInput,
  DestinationConfig,
  DestinationSnapshot,
  EngineEvents,
  EngineMetrics,
  HumaneError,
  MediaEngine,
  Moment,
  PlatformId,
  ProductionSnapshot,
  ProductionState,
  QualityPreset,
} from '@livetap/core';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import type { GoLiveState } from '@livetap/ui';
import { demoIngest } from '../lib/mockIngest.js';
import { platformStatus } from '../lib/platformStatus.js';
import * as persist from './persist.js';
import { DEFAULT_SETTINGS } from './persist.js';
import type { StorageLike } from './persist.js';
import { envMockMode } from './mockMode.js';
import { createEngine } from './engine.js';
import type { EngineHost } from './engine.js';
import { createRegistry } from './registry.js';
import type { RegistryKind } from './registry.js';
import { forgetStreamKey, readStreamKey, saveStreamKey } from './secrets.js';
import { forgetTokens, revokeTokens } from './tokens.js';
import { derivePhase, destroySession, isOnAir, type DestroyReport, type SessionPhase } from './session.js';
import { broadcastReality } from '../components/preflight.js';

export type Mode = 'simple' | 'pro';

export interface Notice {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  error?: HumaneError;
  destinationId?: string;
  at: number;
}

export interface RecordingItem {
  id: string;
  startedAt: number;
  endedAt?: number;
  path?: string;
  blob?: Blob;
  demo: boolean;
  destinations: string[];
}

/** A line in the in-product diagnostics view. Never contains a key or a token. */
export interface LogLine {
  at: number;
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface AppState {
  ready: boolean;
  mockMode: boolean;
  engineKind: string;
  /** Whether the destinations in use are simulated or real, as observed rather than configured. */
  adapterKind: RegistryKind;
  /** Which host surface the engine resolved to: browser, desktop, mobile or mock. */
  engineHost: EngineHost;

  production: ProductionSnapshot;
  destinations: DestinationSnapshot[];
  /**
   * Destinations that exist but came back from storage without their stream key.
   *
   * Keys are deliberately never written to browser storage, so a restored paste-key destination
   * is complete in every respect except the one that lets it broadcast. Nothing in its snapshot
   * says so - to the orchestrator it is simply a destination nobody has connected yet - which is
   * why Studio used to tell a returning creator to add a destination they already had.
   */
  needsKey: string[];
  moments: Moment[];
  chat: ChatMessage[];
  metrics?: EngineMetrics;
  notices: Notice[];
  recordings: RecordingItem[];
  log: LogLine[];

  intent: ContentType | null;
  onboardingDone: boolean;
  mode: Mode;
  quality: QualityPreset;
  recordEveryStream: boolean;
  aspect: AspectRatio;

  goLive: GoLiveState;
  endingAt: number | null;
  /**
   * The visitor has deliberately ended and forgotten this session.
   *
   * The ONLY phase fact that is stored. Everything before it — starting, active, live, ending —
   * is derived by `derivePhase` from `goLive`, `endingAt` and the destination count, because a
   * second field tracking whether a broadcast is running is a second thing that can disagree
   * with the first. This product has been bitten twice by exactly that shape.
   */
  sessionEnded: boolean;
  /**
   * The creator has been told, once, that the next broadcast reaches real accounts.
   *
   * Persisted, because it is a fact about the person rather than about the session, and asking
   * again every time is how a confirmation becomes a reflex that confirms nothing.
   */
  realBroadcastAck: boolean;
  /** GO LIVE was pressed on a real broadcast that has not been acknowledged yet. */
  pendingConfirm: boolean;
  micMuted: boolean;
  screenSharing: boolean;

  init(): Promise<void>;
  attachPreview(el: HTMLVideoElement | null): void;

  setIntent(intent: ContentType): void;
  setMode(mode: Mode): void;
  setQuality(quality: QualityPreset): void;
  setRecordEveryStream(on: boolean): void;
  setAspect(aspect: AspectRatio): void;
  finishOnboarding(): Promise<void>;
  restartOnboarding(): void;

  connectPlatform(platform: PlatformId, label?: string): Promise<DestinationSnapshot | undefined>;
  addCustomDestination(input: {
    label: string;
    url: string;
    streamKey: string;
    aspect: AspectRatio;
    /**
     * Which platform the creator was actually setting up, when they got here by tapping one.
     *
     * Pasting a key is HOW a destination is configured, not WHAT it is. A key pasted after
     * tapping YouTube makes a YouTube destination: it carries YouTube's name wherever it is named,
     * YouTube's own aspect ratios and bitrate ceiling, and YouTube's own honesty line - which for
     * YouTube is the load-bearing one, because YouTube does not publish when video arrives and
     * the creator still has to press Go live in Studio. Omitted, this is a generic RTMP
     * destination, which is what the Custom RTMP row means.
     */
    platform?: PlatformId;
  }): Promise<DestinationSnapshot | undefined>;
  replaceStreamKey(id: string, streamKey: string): Promise<void>;
  reconnect(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  removeDestination(id: string): Promise<void>;
  /**
   * Sign an account out without deleting the destination.
   *
   * Distinct from `removeDestination` on purpose: removing a destination while it is LIVE
   * also removes the only control that can stop it. Disconnecting releases the credential
   * and returns the destination to DISCONNECTED, which is a state the user can see.
   */
  disconnect(id: string): Promise<void>;
  setDestinationEnabled(id: string, enabled: boolean): void;
  stopOne(id: string): Promise<void>;

  setMoment(id: string): Promise<void>;
  upsertMoment(moment: Moment): void;
  setCameraDevice(deviceId: string): void;
  setMicDevice(deviceId: string): void;
  toggleMic(): Promise<void>;
  toggleScreen(): Promise<void>;

  startCountdown(): void;
  cancelCountdown(): void;
  /**
   * Studio has left the screen while a countdown was armed.
   *
   * Separate from `cancelCountdown` so the two reasons read differently in the code and so this
   * one can say out loud what happened: a countdown that survives a route change invisibly, and
   * then goes live by itself when the creator wanders back, is the worst shape this control has.
   */
  releaseCountdown(): void;
  /** Acknowledge the real-broadcast warning and begin the countdown. */
  confirmRealBroadcast(): void;
  commitGoLive(): Promise<void>;
  /** Abandon a start that is still in STARTING, before anything is live. */
  cancelStart(): Promise<void>;
  requestEnd(): void;
  undoEnd(): void;
  confirmEnd(): Promise<void>;

  sendChat(text: string): Promise<void>;
  dismissNotice(id: string): void;

  automaticProduction(): AutomaticProduction | null;

  demoDropDestination(id: string): void;
  demoDegradeDestination(id: string): void;
  demoLoseCamera(): void;
  demoCrashEncoder(): void;

  /**
   * End the guest session and forget the person: secrets, tokens, then preferences.
   *
   * Refuses while anything may still be on the wire and returns a report of what was actually
   * cleared, so a caller can tell the truth rather than a reassuring sentence.
   */
  endSession(): Promise<DestroyReport>;
  /** The phase, derived. Never stored except for the terminal end. */
  sessionPhase(): SessionPhase;
  resetEverything(): void;
}

export interface StoreDeps {
  registry?: AdapterRegistry;
  engine?: MediaEngine;
  mockMode?: boolean;
  /** Injected so tests can drive the countdown and the END grace without waiting. */
  now?: () => number;
}

interface Runtime {
  orchestrator: BroadcastOrchestrator;
  engine: MediaEngine;
  mockMode: boolean;
  offs: Array<() => void>;
  recordingId: string | null;
  /**
   * The END grace timer.
   *
   * It lives on the runtime, not in a React effect, because a stop that is owned by a screen is
   * cancelled by navigating away from that screen: the user presses END, taps another tab, and
   * the broadcast keeps running with no way to stop it from where they now are.
   */
  graceTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The GO LIVE countdown, owned here rather than by the button that draws it.
   *
   * It used to live entirely inside `GoLiveButton`, a component that only exists while Studio is
   * mounted. Navigating away mid-countdown therefore stopped the clock while leaving `goLive` at
   * `'countdown'` in the store — and `LiveBar` does not show a countdown, so the state was armed,
   * invisible and uncancellable. Coming back to Studio remounted the button, which started a
   * FRESH countdown and then went live, with nobody having pressed anything.
   *
   * The END grace already learned this lesson (`graceTimer` above): an action with consequences
   * cannot be owned by a screen, because a screen can be unmounted by a tap on the nav.
   */
  countdownTimer: ReturnType<typeof setTimeout> | null;
  /** Releases the GO LIVE button if a platform call hangs. Never touches the broadcast. */
  startTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The in-flight `goLive()`, so a cancel can outlive the start it is cancelling.
   *
   * `BroadcastOrchestrator.goLive` sets the production LIVE when its own work finishes, and it
   * does not re-check whether a stop landed while it was in flight. Stopping once during STARTING
   * therefore stops what is already up and then watches the start bring it back.
   */
  starting: Promise<unknown> | null;
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A reload kills a browser broadcast, and the app used to come back to a clean idle Studio
 * without ever saying so — the user's only evidence that the stream had ended was that it had.
 * State honesty means the machine names what it did, so the fact is carried across the reload in
 * `sessionStorage` (this tab only, nothing sensitive) and read once on the next boot.
 */
const WAS_LIVE_KEY = 'livetap.wasLive';

/**
 * How long the simulated engine takes to report an output back up. Passed to the engine
 * explicitly so the demo outage below can be timed against a number this file states rather
 * than a default it hopes for.
 */
const DEMO_CONNECT_DELAY_MS = 800;

/**
 * How long a demo drop stays down before it recovers. Four seconds is long enough to read the
 * humane error card, watch the other destination stay LIVE, and see the reconnect countdown
 * tick — which is the entire point of the demo (PRODUCT_REVIEW P2-11).
 */
const DEMO_OUTAGE_MS = 4000;

/**
 * The grace period between tapping END and the stream actually ending (PRODUCT_SPEC §4.3).
 *
 * The timer that runs it lives on the runtime below rather than in a screen's effect. A stop
 * owned by a React effect is cancelled by unmounting that screen, and the measurement was
 * unambiguous: press END, tap Destinations, and twelve seconds later both destinations still
 * read Live with `goLive` still `'live'`. The stop has to outlive the screen that asked for it.
 */
export const END_GRACE_MS = 5000;

/**
 * The in-button countdown before anything reaches a platform.
 *
 * Three seconds for a demo, because nothing leaves the machine and the pause is only a chance to
 * change your mind. Five for a real broadcast, matching the END grace exactly: the same amount of
 * time to stop a stream starting as to stop one ending, with the same activate-to-cancel gesture
 * in the same control. There is still no modal - §4.3's reasoning has not changed, and a dialog
 * over the preview at the moment of going live is the worst possible time to read.
 */
export const DEMO_COUNTDOWN_SECONDS = 3;
export const REAL_COUNTDOWN_SECONDS = 5;

/**
 * How long `commitGoLive` waits for the orchestrator before it gives the button back.
 *
 * `goLive` used to be set to `'starting'` and only cleared after `orchestrator.goLive()`
 * resolved, so a platform API that never answered left the one dominant control spinning with
 * no way out. The orchestrator's own work is unaffected by this: the timeout releases the
 * button, never the broadcast, and `mirror()` reconciles the button back to whatever the machine
 * actually did the moment it says so.
 */
const START_BUTTON_TIMEOUT_MS = 30_000;

function markLive(live: boolean): void {
  try {
    const s = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    if (!s) return;
    if (live) s.setItem(WAS_LIVE_KEY, '1');
    else s.removeItem(WAS_LIVE_KEY);
  } catch {
    // Storage disabled. The notice is a courtesy, never a requirement.
  }
}

function takeWasLive(): boolean {
  try {
    const s = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
    if (!s) return false;
    const had = s.getItem(WAS_LIVE_KEY) !== null;
    s.removeItem(WAS_LIVE_KEY);
    return had;
  } catch {
    return false;
  }
}

/**
 * `MediaEngine` only declares `on`, but every engine in this repo extends core's
 * `TypedEmitter`, which is how the demo controls can raise a genuine engine event rather than
 * fake a UI state. Feature-detected, so a future engine without an emitter degrades to a no-op.
 */
interface EngineEmitter {
  emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void;
}

function engineEmitter(runtime: Runtime | null): EngineEmitter | null {
  const candidate = runtime?.engine as unknown as EngineEmitter | undefined;
  return typeof candidate?.emit === 'function' ? candidate : null;
}

/**
 * What the one dominant control should say, given what the machine is actually doing.
 *
 * `goLive` used to be set only by the actions that drove it, so any transition the orchestrator
 * made on its own - every destination failing, a desktop shell disappearing, a stop that came
 * from somewhere other than the button - left the button describing a broadcast that had ended.
 * The two states the machine has no opinion about are the two that exist before it is involved:
 * a countdown and a start that has been asked for but not yet reported.
 */
export function reconcileGoLive(state: ProductionState, current: GoLiveState): GoLiveState {
  switch (state) {
    case 'LIVE':
      return 'live';
    case 'STARTING':
      return 'starting';
    case 'STOPPING':
      return 'stopping';
    default:
      return current === 'countdown' || current === 'starting' ? current : 'idle';
  }
}

const EMPTY_PRODUCTION: ProductionSnapshot = {
  state: 'IDLE',
  activeMomentId: null,
  liveCount: 0,
  enabledCount: 0,
  recording: false,
};

export type AppStore = UseBoundStore<StoreApi<AppState>>;

/**
 * Everything the store needs off disk, read once.
 *
 * `localStorage.getItem` is synchronous and blocks the main thread, and on this machine a single
 * call was measured at **1017 ms** under load. Store construction made seven of them, three of
 * which read and re-parsed the SAME settings blob for three different fields — so the first paint
 * could be preceded by a multi-second freeze whose profile is 81% "(program)", V8's bucket for
 * blocking platform calls, and which therefore looks like nothing at all in a flame chart.
 *
 * Reading them together is not a micro-optimisation: it is the difference between one blocking
 * call and seven, on the path a creator waits through before they can press anything.
 */
function readBoot(): {
  intent: ContentType | null;
  onboardingDone: boolean;
  mode: Mode;
  settings: typeof DEFAULT_SETTINGS;
  realBroadcastAck: boolean;
} {
  return {
    intent: persist.readIntent(),
    onboardingDone: persist.read<boolean>(persist.KEYS.onboarding, false),
    mode: persist.read<Mode>(persist.KEYS.mode, 'simple'),
    settings: persist.read(persist.KEYS.settings, DEFAULT_SETTINGS),
    realBroadcastAck: persist.read<boolean>(persist.KEYS.realBroadcastAck, false),
  };
}

export function createAppStore(deps: StoreDeps = {}): AppStore {
  let runtime: Runtime | null = null;
  const now = deps.now ?? ((): number => Date.now());
  const boot = readBoot();

  return create<AppState>((set, get) => {
    /** Push one humane notice. Deduplicated by destination + code so a retry loop cannot spam. */
    const notice = (n: Omit<Notice, 'id' | 'at'>): void => {
      const entry: Notice = { ...n, id: uid('notice'), at: now() };
      set((s) => {
        const duplicate = s.notices.some(
          (x) =>
            x.destinationId === entry.destinationId &&
            x.error?.code === entry.error?.code &&
            x.message === entry.message,
        );
        const notices = duplicate ? s.notices : [...s.notices, entry].slice(-6);
        return {
          notices,
          log: [...s.log, { at: entry.at, level: entry.level, text: entry.message }].slice(-2000),
        };
      });
    };

    /** Cancel a scheduled END. Called by anything that makes the scheduled stop wrong. */
    const clearGrace = (): void => {
      if (runtime?.graceTimer) clearTimeout(runtime.graceTimer);
      if (runtime) runtime.graceTimer = null;
    };

    const clearCountdown = (): void => {
      if (runtime?.countdownTimer) clearTimeout(runtime.countdownTimer);
      if (runtime) runtime.countdownTimer = null;
    };

    /**
     * Start the countdown, and own the clock that ends it.
     *
     * The length matches what `GoLiveButton` draws, because the button is the only thing that
     * SHOWS the number - five seconds when real accounts are on the line, three when nothing
     * leaves the machine. The button no longer decides when it is over.
     */
    const armCountdown = (): void => {
      const r = runtime;
      if (!r) return;
      clearCountdown();
      const s = get();
      const reality = broadcastReality(s.destinations, s.adapterKind, s.engineHost);
      const seconds = reality.real.length > 0 ? REAL_COUNTDOWN_SECONDS : DEMO_COUNTDOWN_SECONDS;
      set({ goLive: 'countdown', pendingConfirm: false });
      r.countdownTimer = setTimeout(() => {
        if (runtime) runtime.countdownTimer = null;
        if (get().goLive !== 'countdown') return;
        void get().commitGoLive();
      }, seconds * 1000);
    };

    const clearStartTimer = (): void => {
      if (runtime?.startTimer) clearTimeout(runtime.startTimer);
      if (runtime) runtime.startTimer = null;
    };

    const mirror = (): void => {
      const r = runtime;
      if (!r) return;
      const production = r.orchestrator.getProduction();
      markLive(production.state === 'LIVE');
      const previous = get().goLive;
      const goLive = reconcileGoLive(production.state, previous);
      /*
       * A scheduled END only means anything while there is something to end. If the production
       * left LIVE by itself - every destination failed, the encoder died, the desktop shell went
       * away - the countdown would otherwise keep ticking towards a stop of nothing, over a bar
       * that says "Ending in 3" about a broadcast that has already stopped.
       */
      const stillEnding = get().endingAt !== null && production.state === 'LIVE';
      if (!stillEnding) clearGrace();
      set({
        production,
        destinations: r.orchestrator.listDestinations(),
        moments: [...r.orchestrator.moments],
        goLive,
        endingAt: stillEnding ? get().endingAt : null,
      });
    };

    const persistDestinations = (): void => {
      const r = runtime;
      if (!r) return;
      persist.writeDestinations(r.orchestrator.listDestinations().map((s) => s.config));
    };

    const applySettings = (patch: Partial<typeof DEFAULT_SETTINGS>): void => {
      const next = {
        quality: patch.quality ?? get().quality,
        recordEveryStream: patch.recordEveryStream ?? get().recordEveryStream,
        aspect: patch.aspect ?? get().aspect,
      };
      persist.write(persist.KEYS.settings, next);
      const r = runtime;
      if (r) {
        r.orchestrator.settings = {
          ...r.orchestrator.settings,
          qualityPreset: next.quality,
          masterAspectRatio: next.aspect,
          recording: { ...r.orchestrator.settings.recording, enabled: next.recordEveryStream },
        };
      }
    };

    return {
      ready: false,
      mockMode: deps.mockMode ?? envMockMode(),
      engineKind: 'mock',
      adapterKind: 'mock',
      engineHost: 'mock',

      production: EMPTY_PRODUCTION,
      destinations: [],
      needsKey: [],
      moments: defaultMoments(),
      chat: [],
      notices: [],
      recordings: [],
      log: [],

      intent: boot.intent,
      onboardingDone: boot.onboardingDone,
      mode: boot.mode,
      quality: boot.settings.quality,
      recordEveryStream: boot.settings.recordEveryStream,
      aspect: boot.settings.aspect,

      goLive: 'idle',

      sessionEnded: false,
      endingAt: null,
      realBroadcastAck: boot.realBroadcastAck,
      pendingConfirm: false,
      micMuted: false,
      screenSharing: false,

      async init(): Promise<void> {
        if (runtime) return;
        const mockMode = deps.mockMode ?? envMockMode();
        const chosen = deps.registry
          ? { registry: deps.registry, kind: 'injected' as RegistryKind }
          : await createRegistry({ mockMode });
        const registry = chosen.registry;
        const engineChoice = deps.engine
          ? { engine: deps.engine, kind: deps.engine.kind, host: 'browser' as EngineHost }
          : // Stated rather than inherited, because the demo outage below is timed against it.
            await createEngine({ mockMode, mock: { connectDelayMs: DEMO_CONNECT_DELAY_MS } });
        const engine = engineChoice.engine;
        const stored = persist.readMoments();
        const settings = persist.read(persist.KEYS.settings, DEFAULT_SETTINGS);
        const orchestrator = new BroadcastOrchestrator({
          registry,
          engine,
          moments: stored ?? defaultMoments(),
          settings: {
            ...DEFAULT_PRODUCTION_SETTINGS,
            qualityPreset: settings.quality,
            masterAspectRatio: settings.aspect,
            recording: { ...DEFAULT_PRODUCTION_SETTINGS.recording, enabled: settings.recordEveryStream },
          },
        });
        runtime = {
          orchestrator,
          engine,
          mockMode,
          offs: [],
          recordingId: null,
          graceTimer: null,
          countdownTimer: null,
          startTimer: null,
          starting: null,
        };

        runtime.offs.push(
          orchestrator.on('destination', () => {
            mirror();
            persistDestinations();
          }),
          orchestrator.on('production', () => mirror()),
          orchestrator.on('moment', () => {
            mirror();
            persist.write(persist.KEYS.moments, runtime?.orchestrator.moments ?? []);
          }),
          orchestrator.on('metrics', (m) => set({ metrics: m })),
          orchestrator.on('chat', (m) => set((s) => ({ chat: [...s.chat, m].slice(-200) }))),
          orchestrator.on('notice', (n) =>
            notice({
              level: n.level,
              message: n.message,
              error: n.error,
              destinationId: n.destinationId,
            }),
          ),
        );

        runtime.offs.push(
          engine.on('recording', (r) => {
            if (r.state === 'started') {
              const item: RecordingItem = {
                id: uid('rec'),
                startedAt: now(),
                demo: get().destinations.every((d) => d.config.mock),
                destinations: get()
                  .destinations.filter((d) => d.config.enabled)
                  .map((d) => PLATFORM_PROFILES[d.config.platform].displayName),
              };
              if (runtime) runtime.recordingId = item.id;
              set((s) => ({ recordings: [item, ...s.recordings] }));
            }
            if (r.state === 'stopped') {
              const recId = runtime?.recordingId;
              set((s) => ({
                recordings: s.recordings.map((x) =>
                  x.id === recId ? { ...x, endedAt: now(), path: r.path ?? x.path } : x,
                ),
              }));
              if (runtime) runtime.recordingId = null;
            }
          }),
        );

        // Bring back the destinations the user already configured. Stream keys are not persisted,
        // so a paste-key destination comes back needing its key again — and says so.
        for (const config of persist.readDestinations()) {
          try {
            /*
             * A demo destination's ingest key is redacted on write like every other key, which
             * is right — but it is also a fake, so restoring it without one left the user with
             * "TikTok is missing something. / The stream URL or key is empty or malformed." and
             * a button asking them to paste a key they never had, after nothing more than a page
             * reload. Re-derive the demo target instead. Nothing secret is being recovered here.
             */
            const restored: DestinationConfig =
              config.mock && platformStatus(config.platform).method === 'key'
                ? { ...config, ingest: demoIngest(config.platform) }
                : config;
            orchestrator.addDestination(restored);
          } catch {
            // A duplicate id in storage is not worth failing a cold start over.
          }
        }
        const wasLive = takeWasLive();
        set({
          ready: true,
          mockMode,
          engineKind: engineChoice.kind,
          adapterKind: chosen.kind,
          engineHost: engineChoice.host,
        });
        mirror();

        if (wasLive) {
          notice({
            level: 'warning',
            message:
              'Your broadcast ended when this page reloaded. Nothing is going out now — tap GO LIVE when you are ready to start again.',
          });
        }

        const awaitingKey: string[] = [];
        for (const snap of orchestrator.listDestinations()) {
          const needsKey = platformStatus(snap.config.platform).method === 'key';
          const key = await readStreamKey(snap.config.id);
          if (snap.config.mock) {
            void orchestrator.connect(snap.config.id);
          } else if (needsKey && !key) {
            awaitingKey.push(snap.config.id);
            notice({
              level: 'info',
              destinationId: snap.config.id,
              message: `${snap.config.label} needs its stream key again — keys are never saved in your browser.`,
            });
          } else {
            void orchestrator.connect(snap.config.id);
          }
        }
        set({ needsKey: awaitingKey });

        try {
          await orchestrator.startPreview();
        } catch {
          // A preview that will not start is reported by the engine's own error event.
        }
        mirror();
      },

      attachPreview(el: HTMLVideoElement | null): void {
        const engine = runtime?.engine as
          | { attachPreview?: (e: HTMLVideoElement | null) => void }
          | undefined;
        engine?.attachPreview?.(el);
      },

      setIntent(intent: ContentType): void {
        persist.write(persist.KEYS.intent, intent);
        set({ intent });
      },

      setMode(mode: Mode): void {
        persist.write(persist.KEYS.mode, mode);
        set({ mode });
      },

      setQuality(quality: QualityPreset): void {
        applySettings({ quality });
        set({ quality });
      },

      setRecordEveryStream(on: boolean): void {
        applySettings({ recordEveryStream: on });
        set({ recordEveryStream: on });
      },

      setAspect(aspect: AspectRatio): void {
        /*
         * Locked from the moment a start begins, not from the moment it succeeds. Platforms are
         * told the format when the broadcast object is created, which happens in STARTING, and
         * STOPPING is still sending frames - so `=== 'LIVE'` left two windows in which the shape
         * could be changed under a stream that had already committed to the old one.
         */
        const state = get().production.state;
        if (state !== 'IDLE' && state !== 'PREVIEW') return;
        applySettings({ aspect });
        set({ aspect });
        void runtime?.orchestrator.startPreview();
      },

      async finishOnboarding(): Promise<void> {
        const r = runtime;
        const plan = get().automaticProduction();
        if (r && plan) {
          r.orchestrator.settings = { ...r.orchestrator.settings, ...plan.settings };
          for (const moment of plan.moments) r.orchestrator.upsertMoment(moment);
          for (const [destId, aspect] of Object.entries(plan.destinationAspects)) {
            try {
              r.orchestrator.updateDestination(destId, { aspectRatio: aspect });
            } catch {
              // The destination was removed between the summary and Open Studio.
            }
          }
          await r.orchestrator.setMoment(plan.activeMomentId).catch(() => undefined);
          persist.write(persist.KEYS.moments, r.orchestrator.moments);
          applySettings({
            aspect: plan.settings.masterAspectRatio,
            quality: plan.settings.qualityPreset,
          });
          set({ aspect: plan.settings.masterAspectRatio, quality: plan.settings.qualityPreset });
          await r.orchestrator.startPreview().catch(() => undefined);
        }
        persist.write(persist.KEYS.onboarding, true);
        set({ onboardingDone: true });
        mirror();
      },

      restartOnboarding(): void {
        persist.write(persist.KEYS.onboarding, false);
        set({ onboardingDone: false });
      },

      async connectPlatform(
        platform: PlatformId,
        label?: string,
      ): Promise<DestinationSnapshot | undefined> {
        const r = runtime;
        if (!r) return undefined;
        const profile = PLATFORM_PROFILES[platform];
        const status = platformStatus(platform);
        if (status.blocked) return undefined;

        /*
         * EVERY CALL IS A NEW AUTHORIZATION, NOT A RECONNECT OF THE PLATFORM'S ONE ROW.
         *
         * This used to begin `listDestinations().find(d => d.config.platform === platform)` and
         * reconnect whatever it found, which is why a creator with three YouTube channels had
         * one: the second "Connect YouTube" reconnected the first channel and the third did it
         * again. Reconnecting an EXISTING connection is a different verb and has its own entry
         * point — `reconnectDestination(id)`, the button on the card that is already there.
         *
         * Duplicate prevention does not belong here either, because here is too early: nobody
         * knows which account this will turn out to be until the platform says. It happens below,
         * against the provider's own identity.
         */
        const destinationId = uid(platform);
        const config: DestinationConfig = {
          id: destinationId,
          platform,
          label: label ?? profile.displayName,
          aspectRatio: profile.preferredAspectRatio,
          enabled: true,
          mock: r.mockMode,
          // In mock mode a paste-key platform still needs a structurally valid ingest to connect.
          ingest: r.mockMode && status.method === 'key' ? demoIngest(platform) : undefined,
        };
        r.orchestrator.addDestination(config);
        const snap = await r.orchestrator.connect(destinationId);

        /*
         * NOW the platform has said who this is, so duplicates can be detected honestly.
         *
         * The directive's rule: identify the provider account, detect an existing connection,
         * surface it, and offer reconnect rather than silently creating a second row for the
         * same channel. Two DIFFERENT channels on one platform are legitimate and common; the
         * same channel twice is a creator who pressed the button again.
         */
        const accountId = snap?.account?.accountId;
        const twin = accountId
          ? r.orchestrator
              .listDestinations()
              .find(
                (d) =>
                  d.config.id !== destinationId &&
                  d.config.platform === platform &&
                  d.account?.accountId === accountId,
              )
          : undefined;

        if (twin) {
          /*
           * Drop the connection just made and hand back the one that already exists. The token
           * goes with it: leaving it behind would put a second live grant for the same channel in
           * the vault under a connection id nothing refers to any more, which nothing could ever
           * revoke.
           */
          await r.orchestrator.removeDestination(destinationId);
          await forgetTokens({ connectionId: destinationId, platform });
          const reconnected = await r.orchestrator.connect(twin.config.id);
          mirror();
          persistDestinations();
          return reconnected ?? r.orchestrator.getDestination(twin.config.id);
        }

        /*
         * Name the row after the ACCOUNT, not the platform.
         *
         * Three rows reading "YouTube" are three rows a creator cannot tell apart, and this is
         * the screen where they choose which channel goes live. `AccountSummary` has carried
         * `accountLabel` and an avatar since before there was anything to use them for — its own
         * comment names this exact creator — so the label only stays "YouTube" when the platform
         * declined to say, and an explicit label the caller passed always wins.
         */
        const accountLabel = snap?.account?.accountLabel;
        if (!label && accountLabel && accountLabel !== config.label) {
          r.orchestrator.updateDestination(destinationId, { label: accountLabel });
        }

        mirror();
        persistDestinations();
        return r.orchestrator.getDestination(destinationId) ?? snap;
      },

      async addCustomDestination(input): Promise<DestinationSnapshot | undefined> {
        const r = runtime;
        if (!r) return undefined;
        const platform: PlatformId = input.platform ?? 'custom';
        const destinationId = uid(platform);
        await saveStreamKey(destinationId, input.streamKey);
        const config: DestinationConfig = {
          id: destinationId,
          platform,
          /*
           * The form requires a name now (PRODUCT_REVIEW P2-15), so this is a guard against a
           * caller that is not the form, not a silent default: a destination named after a
           * fallback the user never typed is a destination they cannot recognise later.
           */
          label: input.label.trim() || PLATFORM_PROFILES[platform].displayName,
          aspectRatio: input.aspect,
          enabled: true,
          mock: false,
          ingest: {
            protocol: input.url.trim().toLowerCase().startsWith('rtmps:') ? 'rtmps' : 'rtmp',
            url: input.url.trim(),
            streamKey: input.streamKey.trim(),
          },
        };
        r.orchestrator.addDestination(config);
        const snap = await r.orchestrator.connect(destinationId);
        mirror();
        persistDestinations();
        return snap;
      },

      async replaceStreamKey(destinationId: string, streamKey: string): Promise<void> {
        const r = runtime;
        if (!r) return;
        const snap = r.orchestrator.getDestination(destinationId);
        if (!snap?.config.ingest) return;
        await saveStreamKey(destinationId, streamKey);
        r.orchestrator.updateDestination(destinationId, {
          ingest: { ...snap.config.ingest, streamKey: streamKey.trim() },
        });
        await r.orchestrator.connect(destinationId);
        set((s) => ({ needsKey: s.needsKey.filter((id) => id !== destinationId) }));
        mirror();
      },

      async reconnect(destinationId: string): Promise<void> {
        await runtime?.orchestrator.connect(destinationId);
        mirror();
      },

      async retry(destinationId: string): Promise<void> {
        const r = runtime;
        if (!r) return;
        if (r.orchestrator.getProduction().state === 'LIVE') {
          await r.orchestrator.retryDestination(destinationId);
        } else {
          r.orchestrator.resetDestination(destinationId);
          await r.orchestrator.connect(destinationId);
        }
        set((s) => ({ notices: s.notices.filter((n) => n.destinationId !== destinationId) }));
        mirror();
      },

      async disconnect(destinationId: string): Promise<void> {
        const snap = runtime?.orchestrator.getDestination(destinationId);
        await runtime?.orchestrator.disconnect(destinationId);
        await forgetStreamKey(destinationId);
        /*
         * Actually disconnect. The confirmation this sits behind says "LIVETAP tells YouTube to
         * forget it, deletes what it kept on this device", and until now BOTH halves were false:
         * `revokeTokens` had no caller anywhere outside its own unit test, and nothing removed the
         * vault entry either. So a creator who signed out kept a live grant on the platform and a
         * usable refresh token on their disk. Measured end to end against a real OAuth server: zero
         * calls to `/api/oauth/revoke`, zero grants revoked, the token still under `oauth:youtube`.
         *
         * `revokeTokens` forgets locally whether or not the platform's endpoint answers, which is
         * the right order: a revoke that fails because the machine is offline must still not leave
         * the credential behind.
         */
        /*
         * Only a destination that HAS an account signs one out, and only THAT account.
         *
         * Two things guard this. A creator can have an API-connected YouTube and a pasted-key
         * YouTube side by side, and revoking on every disconnect would mean removing the pasted
         * one — which never had a token — signs them out of the connected one. That is why the
         * `snap?.account` test is here.
         *
         * The second is newer and is acceptance criterion F. This used to pass the PLATFORM, so
         * disconnecting Carter Gaming revoked the grant at `oauth:youtube` — the only one there
         * was — and signed the creator out of Carter Live and Carter Clips at the same time,
         * silently, while their rows went on saying Connected. It passes the CONNECTION now, and
         * a connection is one account.
         */
        const platform = snap?.config.platform;
        if (platform && platform !== 'custom' && snap?.account) {
          await revokeTokens({ connectionId: destinationId, platform });
        }
      },

      async removeDestination(destinationId: string): Promise<void> {
        await runtime?.orchestrator.removeDestination(destinationId);
        await forgetStreamKey(destinationId);
        set((s) => ({
          notices: s.notices.filter((n) => n.destinationId !== destinationId),
          needsKey: s.needsKey.filter((id) => id !== destinationId),
        }));
        mirror();
        persistDestinations();
      },

      setDestinationEnabled(destinationId: string, enabled: boolean): void {
        runtime?.orchestrator.updateDestination(destinationId, { enabled });
        mirror();
        persistDestinations();
      },

      async stopOne(destinationId: string): Promise<void> {
        await runtime?.orchestrator.stopDestination(destinationId);
        mirror();
      },

      async setMoment(momentId: string): Promise<void> {
        await runtime?.orchestrator.setMoment(momentId).catch(() => undefined);
        mirror();
      },

      upsertMoment(moment: Moment): void {
        const r = runtime;
        if (!r) return;
        r.orchestrator.upsertMoment(moment);
        persist.write(persist.KEYS.moments, r.orchestrator.moments);
        mirror();
      },

      /**
       * A device choice applies to every Moment, not just the active one: "which camera" is a
       * property of the person, not of the arrangement they happen to be showing.
       */
      setCameraDevice(deviceId: string): void {
        const r = runtime;
        if (!r) return;
        for (const moment of [...r.orchestrator.moments]) {
          const layers = moment.layers.map((l) => (l.kind === 'camera' ? { ...l, deviceId } : l));
          r.orchestrator.upsertMoment({ ...moment, layers });
        }
        persist.write(persist.KEYS.moments, r.orchestrator.moments);
        mirror();
      },

      setMicDevice(deviceId: string): void {
        const r = runtime;
        if (!r) return;
        for (const moment of [...r.orchestrator.moments]) {
          r.orchestrator.upsertMoment({
            ...moment,
            audio: { ...moment.audio, micDeviceId: deviceId },
          });
        }
        persist.write(persist.KEYS.moments, r.orchestrator.moments);
        mirror();
      },

      async toggleMic(): Promise<void> {
        const r = runtime;
        const next = !get().micMuted;
        set({ micMuted: next });
        const active = r?.orchestrator.getActiveMoment();
        if (r && active) {
          r.orchestrator.upsertMoment({ ...active, audio: { ...active.audio, micMuted: next } });
        }
        mirror();
      },

      async toggleScreen(): Promise<void> {
        const next = !get().screenSharing;
        set({ screenSharing: next });
        const r = runtime;
        const active = r?.orchestrator.getActiveMoment();
        if (r && active) {
          const layers = active.layers.map((l) =>
            l.kind === 'screen' || l.kind === 'window' ? { ...l, visible: next } : l,
          );
          r.orchestrator.upsertMoment({ ...active, layers });
        }
        mirror();
      },

      startCountdown(): void {
        if (get().goLive !== 'idle') return;
        /*
         * §37: a real broadcast says so before it starts, once. The countdown alone is the right
         * confirmation for every broadcast after that - it is cancellable, it is in the control
         * the creator is already looking at, and it costs nothing to ignore - but the FIRST time
         * a creator's own accounts are on the line they are told in words, and have to answer.
         * Which destinations are real is read from the adapters actually in use, never from a
         * build flag: `addCustomDestination` sets `mock: false` regardless of demo mode, so the
         * config alone would call a simulated RTMP push a real broadcast.
         */
        const s = get();
        const reality = broadcastReality(s.destinations, s.adapterKind, s.engineHost);
        if (reality.real.length > 0 && !s.realBroadcastAck) {
          set({ pendingConfirm: true });
          return;
        }
        armCountdown();
      },

      cancelCountdown(): void {
        const state = get();
        if (state.goLive !== 'countdown' && !state.pendingConfirm) return;
        clearCountdown();
        set({ goLive: 'idle', pendingConfirm: false });
      },

      /**
       * Studio is no longer on screen, and it was holding an armed countdown.
       *
       * Called from Studio's own unmount. A countdown is the last chance to change your mind, so
       * leaving the screen is treated as changing your mind - the alternative the directive allows
       * is to keep it and make it visible elsewhere, and there is nowhere honest to put it: the
       * live bar is for a broadcast that is HAPPENING, and a countdown in it would be a second
       * place to press stop for something that has not started.
       *
       * It says so out loud. Silently dropping an armed action is how the creator learns not to
       * trust the button.
       */
      releaseCountdown(): void {
        const state = get();
        if (state.goLive !== 'countdown' && !state.pendingConfirm) return;
        clearCountdown();
        set({ goLive: 'idle', pendingConfirm: false });
        notice({
          level: 'info',
          message: 'Your broadcast was not started — you left the studio while it was counting down.',
        });
      },

      confirmRealBroadcast(): void {
        if (!get().pendingConfirm) return;
        persist.write(persist.KEYS.realBroadcastAck, true);
        set({ realBroadcastAck: true, pendingConfirm: false });
        armCountdown();
      },

      async commitGoLive(): Promise<void> {
        const r = runtime;
        if (!r) return;
        clearCountdown();
        set({ goLive: 'starting', pendingConfirm: false });
        clearStartTimer();
        r.startTimer = setTimeout(() => {
          if (runtime) runtime.startTimer = null;
          // The machine is still working; only the button is handed back, and `mirror()` will
          // correct it the moment the orchestrator reports what actually happened.
          if (get().goLive === 'starting') mirror();
        }, START_BUTTON_TIMEOUT_MS);
        const started = r.orchestrator.goLive();
        r.starting = started;
        try {
          await started;
        } finally {
          if (r.starting === started) r.starting = null;
          clearStartTimer();
          mirror();
        }
      },

      /**
       * Abandon a start that has not finished.
       *
       * `BroadcastOrchestrator.stop()` already accepts STARTING, and a destination's own state
       * machine has `STARTING -> STOP -> STOPPING`, so this is the machine's own path rather than
       * a special case. Before it existed, the seconds in which broadcast objects are created on
       * the platforms were the seconds with no way out at all.
       */
      async cancelStart(): Promise<void> {
        const r = runtime;
        if (!r) return;
        clearGrace();
        clearStartTimer();
        set({ goLive: 'stopping', endingAt: null });
        const inFlight = r.starting;
        try {
          await r.orchestrator.stop();
          if (inFlight) {
            /*
             * Stop again once the start has finished committing. Measured: without this the
             * production came back LIVE a few milliseconds after the cancel, because `goLive()`
             * ends by setting LIVE unconditionally. The second stop is a no-op when the first
             * one won the race, and it is the whole cancel when it did not.
             */
            await inFlight.catch(() => undefined);
            await r.orchestrator.stop();
          }
        } finally {
          mirror();
          set({ goLive: 'idle' });
        }
      },

      /**
       * Schedule the stop, and own the schedule.
       *
       * The timer is on the runtime, so navigating away from Studio mid-grace cannot cancel it.
       * That was P0-1 and it is the worst defect this screen had: the one control that ends a
       * broadcast was owned by the one screen a user leaves to go and look at something else.
       */
      requestEnd(): void {
        if (get().goLive !== 'live') return;
        const r = runtime;
        if (!r) return;
        clearGrace();
        set({ endingAt: now() });
        r.graceTimer = setTimeout(() => {
          if (runtime) runtime.graceTimer = null;
          void get().confirmEnd();
        }, END_GRACE_MS);
      },

      undoEnd(): void {
        clearGrace();
        set({ endingAt: null });
      },

      async confirmEnd(): Promise<void> {
        const r = runtime;
        if (!r) return;
        clearGrace();
        clearStartTimer();
        set({ goLive: 'stopping', endingAt: null });
        // Capture the recording before the engine tears down, so the web build has a file.
        const engine = r.engine as {
          stopRecording?: () => Promise<{ path?: string; blob?: Blob }>;
        };
        if (r.orchestrator.getProduction().recording && engine.stopRecording) {
          try {
            const result = await engine.stopRecording();
            const recId = r.recordingId;
            if (result.blob || result.path) {
              set((s) => ({
                recordings: s.recordings.map((x) =>
                  x.id === recId ? { ...x, blob: result.blob, path: result.path ?? x.path } : x,
                ),
              }));
            }
          } catch {
            // The recording event already reported the failure humanely.
          }
        }
        await r.orchestrator.stop();
        mirror();
        set({ goLive: 'idle', chat: [] });
      },

      async sendChat(text: string): Promise<void> {
        const r = runtime;
        if (!r) return;
        const targets = r.orchestrator
          .listDestinations()
          .filter(
            (d) =>
              (d.state === 'LIVE' || d.state === 'DEGRADED') &&
              PLATFORM_PROFILES[d.config.platform].capabilities.chatWrite !== 'UNAVAILABLE',
          );
        for (const target of targets) {
          try {
            await r.orchestrator.sendChat(target.config.id, text);
          } catch {
            // Capability-gated: a platform that cannot be posted to is already named in helper text.
          }
        }
      },

      dismissNotice(noticeId: string): void {
        set((s) => ({ notices: s.notices.filter((n) => n.id !== noticeId) }));
      },

      automaticProduction(): AutomaticProduction | null {
        const intent = get().intent;
        if (!intent || !INTENT_PROFILES[intent]) return null;
        const inputs: DestinationAspectInput[] = get().destinations.map((d) => ({
          id: d.config.id,
          platform: d.config.platform,
          supportedAspectRatios: PLATFORM_PROFILES[d.config.platform].supportedAspectRatios,
          preferredAspectRatio: PLATFORM_PROFILES[d.config.platform].preferredAspectRatio,
        }));
        return buildAutomaticProduction(
          intent,
          inputs,
          runtime?.orchestrator.settings ?? DEFAULT_PRODUCTION_SETTINGS,
        );
      },

      // --- Demo controls. Mock mode exists to be used; these drive the real failure paths. ---
      // Every engine in the repo is a TypedEmitter, so a demo can raise exactly the event a real
      // failure would raise. Nothing here is a UI-only simulation: the orchestrator's isolation,
      // reconnect and humanize paths all run for real.

      /**
       * The scripted drop, timed to be readable.
       *
       * With the shipping reconnect policy the demo recovered in about 1.3 s — faster than
       * anyone can read the four-field card the demo exists to show (PRODUCT_REVIEW P2-11). The
       * outage is stretched to ~4 s here, in the app, by widening the reconnect policy for the
       * one synchronous turn in which the orchestrator schedules the retry, and restoring it
       * immediately afterwards. Nothing about the failure path is faked: the orchestrator's own
       * isolation, backoff, `humanize()` and recovery all run exactly as they do for a real
       * drop, and a real drop still uses the real policy. `packages/media` is untouched — the
       * mock engine has no API for a per-event reconnect delay.
       */
      demoDropDestination(destinationId: string): void {
        const r = runtime;
        const emitter = engineEmitter(r);
        if (!r || !emitter) return;
        const policy = r.orchestrator.settings.reconnect;
        r.orchestrator.settings = {
          ...r.orchestrator.settings,
          reconnect: {
            ...policy,
            // The engine takes DEMO_CONNECT_DELAY_MS to report the output back up.
            initialDelayMs: Math.max(0, DEMO_OUTAGE_MS - DEMO_CONNECT_DELAY_MS),
            // A demo that varies by ±10% is a demo that cannot be described in a sentence.
            jitter: 0,
          },
        };
        try {
          emitter.emit('output', {
            type: 'outputLost',
            destinationId,
            code: 'INGEST_DISCONNECTED',
            technical: 'demo: scripted drop',
          });
        } finally {
          r.orchestrator.settings = { ...r.orchestrator.settings, reconnect: policy };
        }
      },

      demoDegradeDestination(destinationId: string): void {
        engineEmitter(runtime)?.emit('output', {
          type: 'outputDegraded',
          destinationId,
          technical: 'demo: scripted degradation',
        });
      },

      demoLoseCamera(): void {
        engineEmitter(runtime)?.emit('deviceLost', { kind: 'camera' });
      },

      demoCrashEncoder(): void {
        engineEmitter(runtime)?.emit('engineError', {
          code: 'ENCODER_FAILED',
          technical: 'demo: scripted encoder crash',
        });
      },

      sessionPhase(): SessionPhase {
        const s = get();
        return derivePhase({
          goLive: s.goLive,
          endingAt: s.endingAt,
          destinationCount: s.destinations.length,
          ended: s.sessionEnded,
        });
      },

      async endSession(): Promise<DestroyReport> {
        const state = get();
        /*
         * Refused while on air. `isOnAir` covers `live` AND `ending`, because END starts a grace
         * period during which the broadcast is still up and can be undone — clearing a stream key
         * in that window would leave a publisher on the wire with no way to address it.
         */
        if (isOnAir(state.sessionPhase())) {
          return {
            streamKeysForgotten: 0,
            platformsSignedOut: [],
            storageRemaining: [],
            /*
             * Not "storage is unreadable" — we refused to act and therefore never looked. Both
             * report the same thing to a caller: nothing here was observed, so nothing may be
             * claimed. `clean: false` is the only honest answer to a request that was declined.
             */
            storageReadable: false,
            clean: false,
          };
        }

        const report = await destroySession({
          destinationIds: state.destinations.map((d) => d.config.id),
          platforms: [...new Set(state.destinations.map((d) => d.config.platform))],
        });

        /*
         * Wipe the in-memory store too. `destroySession` clears what survives a reload; this
         * clears what survives a route change, which is the part the person still looking at the
         * screen can see. Destinations go last so the report above could name them.
         */
        set({
          sessionEnded: true,
          destinations: [],
          intent: null,
          onboardingDone: false,
          realBroadcastAck: false,
          pendingConfirm: false,
          mode: 'simple',
          quality: DEFAULT_SETTINGS.quality,
          recordEveryStream: DEFAULT_SETTINGS.recordEveryStream,
          aspect: DEFAULT_SETTINGS.aspect,
          notices: [],
          recordings: [],
          chat: [],
        });
        return report;
      },

      resetEverything(): void {
        persist.clearAll();
        set({
          intent: null,
          onboardingDone: false,
          realBroadcastAck: false,
          pendingConfirm: false,
          mode: 'simple',
          quality: DEFAULT_SETTINGS.quality,
          recordEveryStream: DEFAULT_SETTINGS.recordEveryStream,
          aspect: DEFAULT_SETTINGS.aspect,
          notices: [],
          recordings: [],
          chat: [],
        });
      },
    };
  });
}

/** The one store the app uses. Tests build their own with `createAppStore`. */
export const useAppStore = createAppStore();
