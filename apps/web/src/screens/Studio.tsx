import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Badge,
  Button,
  GoLiveButton,
  HealthPill,
  MomentCard,
  MomentIcon,
  Tabs,
  Tooltip,
  VisuallyHidden,
} from '@livetap/ui';
import { evaluateHealth } from '@livetap/core';
import type { AspectRatio, HealthAssessment, HealthLevel } from '@livetap/core';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { DestinationList, NoDestinationsPrompt } from '../components/DestinationChips.js';
import { DeviceControls } from '../components/DeviceControls.js';
import { NoticeCards } from '../components/NoticeCards.js';
import { PreviewCanvas } from '../components/PreviewCanvas.js';
import { evaluatePreflight, goLiveSubtitle } from '../components/preflight.js';
import { COPY } from '../lib/copy.js';
import { elapsed } from '../lib/format.js';
import { useDevices } from '../lib/devices.js';
import { useAppStore } from '../state/store.js';

const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1'];
const ASPECT_NAME: Record<AspectRatio, string> = {
  '16:9': 'Widescreen 16 by 9',
  '9:16': 'Vertical 9 by 16',
  '1:1': 'Square 1 by 1',
};

/** The grace period between tapping END and the stream actually ending (PRODUCT_SPEC §4.3). */
const END_GRACE_MS = 5000;

export function Studio(): ReactElement {
  const production = useAppStore((s) => s.production);
  const destinations = useAppStore((s) => s.destinations);
  const moments = useAppStore((s) => s.moments);
  const metrics = useAppStore((s) => s.metrics);
  const goLive = useAppStore((s) => s.goLive);
  const endingAt = useAppStore((s) => s.endingAt);
  const micMuted = useAppStore((s) => s.micMuted);
  const aspect = useAppStore((s) => s.aspect);
  const mode = useAppStore((s) => s.mode);

  const startCountdown = useAppStore((s) => s.startCountdown);
  const cancelCountdown = useAppStore((s) => s.cancelCountdown);
  const commitGoLive = useAppStore((s) => s.commitGoLive);
  const requestEnd = useAppStore((s) => s.requestEnd);
  const undoEnd = useAppStore((s) => s.undoEnd);
  const confirmEnd = useAppStore((s) => s.confirmEnd);
  const setAspect = useAppStore((s) => s.setAspect);
  const setMoment = useAppStore((s) => s.setMoment);

  const { cameras, microphones, unsupported } = useDevices();
  const [search] = useSearchParams();
  const mockMode = useAppStore((s) => s.mockMode);
  // Demo mode exists to be used: when this deployment is simulated, the failure demos are the
  // point of it. `?demo=1` and Pro reach them on a real deployment too.
  const showDemoPanel = mockMode || search.get('demo') === '1' || mode === 'pro';

  const live = production.state === 'LIVE' || production.state === 'STOPPING';
  const elapsedMs = useElapsed(production.startedAt, live);
  const graceLeft = useGrace(endingAt);
  const goLiveRef = useRef<HTMLDivElement | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);

  const preflight = useMemo(
    () =>
      evaluatePreflight({
        destinations,
        online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
        // A mock engine's test pattern is a real picture; treat it as one rather than
        // warning about a camera that this environment could never have had.
        hasCamera: cameras.length > 0 || unsupported,
        hasMic: microphones.length > 0 || unsupported,
        micMuted,
        recording: production.recording,
      }),
    [destinations, cameras.length, microphones.length, unsupported, micMuted, production.recording],
  );

  const destinationHealth = useMemo(
    () => ({
      reconnecting: destinations.filter((d) => d.state === 'RECONNECTING').length,
      degraded: destinations.filter((d) => d.state === 'DEGRADED').length,
      failed: destinations.filter((d) => d.state === 'FAILED').length,
    }),
    [destinations],
  );
  const health = useMemo(
    () => humaneHealth(evaluateHealth(metrics, Date.now(), destinationHealth)),
    [metrics, destinationHealth],
  );
  const allMock = destinations.length > 0 && destinations.every((d) => d.config.mock);

  /*
   * Pre-flight answers "can this stream start?", so it only means anything before one has.
   * Once destinations leave READY it necessarily reports red — and a red row beside the words
   * "Stream is excellent", on top of a GO LIVE button disabled into an END button that cannot
   * end anything, is how the single worst bug in this product happened. While live, the row is
   * driven by health instead, and the button is never disabled.
   */
  const rowLevel: 'green' | 'amber' | 'red' = live ? healthLevel(health.level) : preflight.level;
  const rowHeadline = live ? `${health.headline} — ${health.detail}` : preflight.headline;
  /*
   * Amber collapses; red never does. Red means the stream cannot start, so the reason has to be
   * on the screen without a click — and amber is the level that carries three sentences of
   * consequence and pushed the button off a phone.
   */
  const collapsible = !live && rowLevel === 'amber' && preflight.items.length > 0;

  // The END grace elapsing is what actually stops the broadcast.
  useEffect(() => {
    if (endingAt === null) return undefined;
    const timer = setTimeout(() => void confirmEnd(), END_GRACE_MS);
    return () => clearTimeout(timer);
  }, [endingAt, confirmEnd]);

  // Escape cancels the END grace. It never ends a live stream.
  useEffect(() => {
    if (endingAt === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') undoEnd();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [endingAt, undoEnd]);

  /*
   * GO LIVE holds initial focus on Studio (PRODUCT_SPEC §4.3). Without this it is the 27th tab
   * stop, which makes the product's one dominant action the least reachable control on the
   * screen for a keyboard user. It runs once, on an idle mount only, so it can never take focus
   * away from something the user is already using — and `preventScroll` keeps it from yanking
   * the page down past the preview.
   */
  useEffect(() => {
    if (goLive !== 'idle') return;
    const button = goLiveRef.current?.querySelector<HTMLButtonElement>('.lt-golive');
    button?.focus({ preventScroll: true });
    // Deliberately empty: this is a first-mount-only effect, not a reaction to `goLive`.
  }, []);

  // The tab title is the one place a backgrounded live stream can still announce itself.
  useEffect(() => {
    document.title = live ? `● LIVE ${elapsed(elapsedMs)} — LIVETAP` : 'LIVETAP';
    return () => {
      document.title = 'LIVETAP';
    };
  }, [live, elapsedMs]);

  return (
    <div className="lt-studio">
      <NoticeCards />

      <section className="lt-studio__stage" aria-label="What viewers can see">
        <PreviewCanvas aspect={aspect} live={live} muted={micMuted} />

        <div className="lt-studio__stagebar">
          <div className="lt-segmented" role="radiogroup" aria-label="Stream shape">
            {ASPECTS.map((option) => {
              const control = (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={aspect === option}
                  aria-label={ASPECT_NAME[option]}
                  className={['lt-segmented__item', 'lt-touch', aspect === option ? 'is-active' : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-disabled={live || undefined}
                  onClick={() => !live && setAspect(option)}
                >
                  {option}
                </button>
              );
              return live ? (
                <Tooltip
                  key={option}
                  label="Locked while you are live — platforms cannot change format mid-stream."
                >
                  {control}
                </Tooltip>
              ) : (
                control
              );
            })}
          </div>

          <HealthPill
            level={health.level}
            headline={health.headline}
            detail={health.detail}
            reasons={mode === 'pro' ? health.reasons : undefined}
          />

          <span className="lt-studio__rec lt-num">
            {production.recording ? `Rec ● ${elapsed(elapsedMs)}` : 'Rec off'}
          </span>
        </div>
      </section>

      <section className="lt-studio__go" aria-label="Going live">
        <NoDestinationsPrompt />

        {/*
          Amber is "expandable" in PRODUCT_SPEC §4.5, and it was always expanded — which put
          three sentences of consequence between the chips and the button and, on a phone, pushed
          GO LIVE off the screen. Collapsed by default, with the count in the headline so nothing
          is hidden; `aria-expanded` plus a caret carry the state without relying on colour.
        */}
        {/*
          The pre-flight row, the button and its subtitle travel together: on a phone they are
          pinned above the tab bar (PRODUCT_SPEC §5c, mobile: "64px, full width minus space-4,
          pinned above nav"), which is the only way the product's one dominant action is on the
          screen when Studio opens.
        */}
        <div className="lt-golivebar">
          <div
            className={['lt-preflight', `lt-preflight--${rowLevel}`].join(' ')}
            aria-live="polite"
          >
          <span className="lt-preflight__dot" aria-hidden="true" />
          {collapsible ? (
            <button
              type="button"
              className="lt-preflight__toggle lt-touch"
              aria-expanded={preflightOpen}
              onClick={() => setPreflightOpen((open) => !open)}
            >
              <span className="lt-preflight__headline">{rowHeadline}</span>
              <span className="lt-preflight__caret" aria-hidden="true">
                {preflightOpen ? '⌃' : '⌄'}
              </span>
            </button>
          ) : (
            <span className="lt-preflight__headline">{rowHeadline}</span>
          )}
          {!live && preflight.items.length > 0 && (!collapsible || preflightOpen) ? (
            <ul className="lt-preflight__items">
              {preflight.items.map((item) => (
                <li key={item.id}>
                  {item.text}
                  {item.fix ? (
                    <>
                      {' '}
                      <Link className="lt-textlink" to={item.fix.to}>
                        {item.fix.label}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {endingAt !== null ? (
          <div className="lt-endgrace">
            <Button variant="secondary" size="lg" block onClick={undoEnd}>
              {`${COPY.undo} · Ending in ${graceLeft}`}
            </Button>
            <p className="lt-endgrace__hint">Say your goodbyes.</p>
          </div>
        ) : (
          <div ref={goLiveRef}>
            <GoLiveButton
              state={goLive}
              elapsedMs={elapsedMs}
              // Never disabled while live: a stream you cannot stop is worse than no stream.
              disabled={!live && preflight.level === 'red'}
              disabledReason={
                live
                  ? undefined
                  : (preflight.items[0]?.text ??
                    'Connect a destination first — that is the one thing LIVETAP cannot do for you.')
              }
              onGoLive={startCountdown}
              onCancel={cancelCountdown}
              onCountdownComplete={() => void commitGoLive()}
              onEnd={requestEnd}
              demo={allMock}
              className={allMock ? 'lt-golive--demo' : undefined}
            />
            <p className="lt-golive__subtitle">
              {live
                ? liveSubtitle(production.liveCount, production.enabledCount, allMock)
                : allMock && preflight.readyCount > 0
                  ? `Demo — going live on ${preflight.readyCount}, and nothing is broadcast anywhere`
                  : goLiveSubtitle(preflight)}
            </p>
          </div>
        )}
        </div>
      </section>

      <section className="lt-studio__moments" aria-label="Moments">
        <h2 className="lt-sr-only">Moments</h2>
        <ul className="lt-momentstrip">
          {moments.map((moment) => (
            <li key={moment.id}>
              <MomentCard
                /*
                  The icon set, not emoji (PRODUCT_REVIEW P2-5). `MomentIcon` draws the glyph
                  for a built-in Moment and a neutral one for a Moment the user made, so an
                  imported Moment is never given a guess at its content.
                */
                icon={<MomentIcon moment={moment.id} size={32} />}
                name={moment.name}
                active={production.activeMomentId === moment.id}
                onSelect={() => void setMoment(moment.id)}
                meta={production.activeMomentId === moment.id ? 'Viewers see this' : undefined}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="lt-studio__devices" aria-label="Camera, microphone and screen">
        <h2 className="lt-sr-only">Camera, microphone and screen</h2>
        <DeviceControls live={live} />
      </section>

      <aside className="lt-studio__dock" aria-label="Chat, destinations and health">
        <StudioDock showDemoPanel={showDemoPanel} />
      </aside>
    </div>
  );
}

/**
 * `evaluateHealth`'s own copy for the `unknown` level is "Health appears once the encoder starts
 * sending" — engineering vocabulary, on the largest status line in Simple mode, which tenet 1
 * forbids. The assessment is correct; only the sentence is wrong, so the sentence is replaced
 * here rather than the measurement anywhere. (`reasons` stays untouched: it is Pro-only and is
 * meant to be technical.)
 */
export function humaneHealth(health: HealthAssessment): HealthAssessment {
  if (health.level !== 'unknown') return health;
  return {
    ...health,
    headline: 'Checking your picture and sound',
    detail: 'Quality readings appear a few seconds after you go live.',
  };
}

/**
 * The health scale collapses onto the three levels the pre-flight row can paint. `unknown` is
 * amber rather than red: "we do not know yet" is a thing to know, not a failure.
 */
function healthLevel(level: HealthLevel): 'green' | 'amber' | 'red' {
  switch (level) {
    case 'excellent':
    case 'good':
      return 'green';
    case 'poor':
    case 'critical':
      return 'red';
    default:
      return 'amber';
  }
}

/**
 * What the button says under itself while live. `liveCount` is 0 for the second or two every
 * destination spends in STARTING, and "Live on 0" during a live broadcast is a lie the user can
 * see, so that window says what is actually happening instead.
 */
export function liveSubtitle(liveCount: number, enabledCount: number, allMock: boolean): string {
  const demo = allMock ? ' · nothing is broadcast anywhere' : '';
  if (liveCount === 0) {
    return `Starting on ${enabledCount}${demo}`;
  }
  return `Live on ${liveCount}${demo}`;
}

/* ------------------------------------------------------------------ the dock */

function StudioDock({ showDemoPanel }: { showDemoPanel: boolean }): ReactElement {
  const [tab, setTab] = useState('destinations');
  const chat = useAppStore((s) => s.chat);
  const destinations = useAppStore((s) => s.destinations);
  const metrics = useAppStore((s) => s.metrics);
  const mode = useAppStore((s) => s.mode);
  const destinationHealth = useMemo(
    () => ({
      reconnecting: destinations.filter((d) => d.state === 'RECONNECTING').length,
      degraded: destinations.filter((d) => d.state === 'DEGRADED').length,
      failed: destinations.filter((d) => d.state === 'FAILED').length,
    }),
    [destinations],
  );
  const health = useMemo(
    () => humaneHealth(evaluateHealth(metrics, Date.now(), destinationHealth)),
    [metrics, destinationHealth],
  );

  const demoDrop = useAppStore((s) => s.demoDropDestination);
  const demoDegrade = useAppStore((s) => s.demoDegradeDestination);
  const demoCamera = useAppStore((s) => s.demoLoseCamera);
  const demoEncoder = useAppStore((s) => s.demoCrashEncoder);

  return (
    <Tabs
      label="Studio panels"
      value={tab}
      onValueChange={setTab}
      tabs={[
        {
          id: 'chat',
          label: 'Chat',
          content:
            chat.length === 0 ? (
              <div className="lt-dock__empty">
                <h3>No messages yet</h3>
                <p>Messages from every platform that lets us read them will appear here.</p>
              </div>
            ) : (
              <ul className="lt-chatlist">
                {chat.map((message) => (
                  <li key={message.id}>
                    <span className="lt-chatlist__author">{message.author.displayName}</span>
                    <Badge tone="info">
                      {message.mock ? COPY.demo : PLATFORM_PROFILES[message.platform].displayName}
                    </Badge>
                    {/* Chat is rendered as text. Never as markup — see SECURITY.md. */}
                    <p className="lt-chatlist__text">{message.text}</p>
                  </li>
                ))}
              </ul>
            ),
        },
        {
          id: 'destinations',
          label: 'Destinations',
          content: (
            /*
              The one destination list in Studio (PRODUCT_REVIEW P2-4). It used to be rendered
              twice: once as a chip row under the preview and once, hand-built again, here. Both
              surfaces now share `DestinationList`, and only this one is on screen.
            */
            <div className="lt-dock__dests">
              <h3>This stream</h3>
              <DestinationList />
              <Link className="lt-textlink" to="/app/destinations">
                Manage destinations
              </Link>
            </div>
          ),
        },
        {
          id: 'health',
          label: 'Health',
          content: (
            <div className="lt-dock__health">
              <HealthPill
                level={health.level}
                headline={health.headline}
                detail={health.detail}
                reasons={mode === 'pro' ? health.reasons : undefined}
                defaultExpanded
              />
              {showDemoPanel ? (
                <div className="lt-demopanel">
                  <h3>Demo failures</h3>
                  <p>
                    These raise the same events a real failure raises, so you can watch LIVETAP keep
                    the other destinations live.
                  </p>
                  <div className="lt-demopanel__buttons">
                    {destinations.map((snap) => (
                      <Button
                        key={snap.config.id}
                        variant="secondary"
                        size="sm"
                        onClick={() => demoDrop(snap.config.id)}
                      >
                        {`Drop ${PLATFORM_PROFILES[snap.config.platform].displayName}`}
                      </Button>
                    ))}
                    {destinations.map((snap) => (
                      <Button
                        key={`deg-${snap.config.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => demoDegrade(snap.config.id)}
                      >
                        {`Make ${PLATFORM_PROFILES[snap.config.platform].displayName} rough`}
                      </Button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={demoCamera}>
                      Unplug the camera
                    </Button>
                    <Button variant="ghost" size="sm" onClick={demoEncoder}>
                      Break the picture
                    </Button>
                  </div>
                </div>
              ) : null}
              <VisuallyHidden>{`${health.headline}. ${health.detail}`}</VisuallyHidden>
            </div>
          ),
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ timers */

/** Ticks once a second while live. The value is never announced — a clock that speaks is unusable. */
function useElapsed(startedAt: number | undefined, live: boolean): number {
  const [ms, setMs] = useState(0);
  const start = useRef<number | undefined>(startedAt);
  start.current = startedAt;

  useEffect(() => {
    if (!live || startedAt === undefined) {
      setMs(0);
      return undefined;
    }
    const tick = (): void => setMs(Date.now() - (start.current ?? Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live, startedAt]);

  return ms;
}

/** 5 → 1, counting down the END grace. */
function useGrace(endingAt: number | null): number {
  const [left, setLeft] = useState(5);
  useEffect(() => {
    if (endingAt === null) {
      setLeft(5);
      return undefined;
    }
    const tick = (): void =>
      setLeft(Math.max(1, Math.ceil((END_GRACE_MS - (Date.now() - endingAt)) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [endingAt]);
  return left;
}
