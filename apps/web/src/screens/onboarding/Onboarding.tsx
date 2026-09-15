import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Banner, Button, IntentIcon, Logo, Select, Spinner, VisuallyHidden } from '@livetap/ui';
import { CONTENT_TYPES, INTENT_PROFILES } from '@livetap/core';
import type { AspectRatio, ContentType, PlatformId } from '@livetap/core';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import { NoticeCards } from '../../components/NoticeCards.js';
import { PreviewCanvas } from '../../components/PreviewCanvas.js';
import { COPY } from '../../lib/copy.js';
import { useDevices } from '../../lib/devices.js';
import { PLATFORM_ORDER, platformStatus } from '../../lib/platformStatus.js';
import { useAppStore } from '../../state/store.js';

type Step = 1 | 2 | 3;

const HEADINGS: Record<Step, string> = {
  1: 'What are you making?',
  2: 'Where are you going live?',
  3: 'Camera and mic',
};

/**
 * Intent-first onboarding.
 *
 * The written three steps in PRODUCT_SPEC §5b asked "where do you want to go live?" first.
 * That is the wrong first question: knowing *what* someone is making is what lets LIVETAP
 * choose the layout, the shape, the safe areas and the quality — so the destination step can
 * then say "YouTube 16:9 · TikTok 9:16" instead of asking. Three screens, six taps to LIVE.
 *
 * Step 3 carries both the device pickers and "Here is your setup", with one button. Splitting
 * them into a fourth screen cost one tap and bought nothing: the payoff reads better beside
 * the picture it describes, and the ≤6-tap budget is the product.
 */
export function Onboarding(): ReactElement {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const heading = useRef<HTMLHeadingElement | null>(null);

  const intent = useAppStore((s) => s.intent);
  const destinations = useAppStore((s) => s.destinations);
  const setIntent = useAppStore((s) => s.setIntent);
  const connectPlatform = useAppStore((s) => s.connectPlatform);
  const removeDestination = useAppStore((s) => s.removeDestination);
  const finishOnboarding = useAppStore((s) => s.finishOnboarding);
  const mockMode = useAppStore((s) => s.mockMode);
  const automaticProduction = useAppStore((s) => s.automaticProduction);
  // Recomputed from the two inputs that can change it. The selector itself must stay stable —
  // returning a fresh object from a zustand selector re-renders forever.
  const plan = useMemo(() => automaticProduction(), [automaticProduction, destinations, intent]);

  // Focus moves to the heading, never to the first input, so the context is heard before the task.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const chosen = destinations.filter((d) => d.config.enabled);

  return (
    <div className="lt-onboarding">
      <header className="lt-onboarding__bar">
        <Logo variant="full" size={24} />
        <Link className="lt-textlink" to="/app/studio">
          Skip setup
        </Link>
      </header>

      <p className="lt-onboarding__progress">{`Step ${step} of 3`}</p>
      <span className="lt-onboarding__dots" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? 'is-done' : ''} />
        ))}
      </span>

      {/*
        PRODUCT_SPEC §4.4 puts the honesty banner on every app route, and onboarding is the one
        route where it was missing — so the user chose YouTube and TikTok believing they had
        connected accounts, and only met the word "demo" in grey type below the grid they had
        already used. Stated here before the first choice, not after it.
      */}
      {mockMode ? (
        <div className="lt-bannerslot">
          <Banner tone="info" className="lt-mockbanner">
            Demo mode — this build simulates every destination. Nothing you connect here is
            broadcast anywhere, so you can try the whole thing safely.
          </Banner>
        </div>
      ) : null}

      <main className="lt-onboarding__main">
        <h1 className="lt-onboarding__heading" tabIndex={-1} ref={heading}>
          {HEADINGS[step]}
        </h1>
        <VisuallyHidden live="polite">{`Step ${step} of 3: ${HEADINGS[step]}`}</VisuallyHidden>

        {step === 1 ? (
          <IntentStep
            selected={intent}
            onChoose={(next) => {
              setIntent(next);
              setStep(2);
            }}
          />
        ) : null}

        {step === 2 ? (
          <PlatformStep
            mockMode={mockMode}
            chosen={chosen.map((d) => d.config.platform)}
            onPick={async (platform) => {
              await connectPlatform(platform);
            }}
            onDrop={(platform) => {
              const match = chosen.find((d) => d.config.platform === platform);
              if (match) void removeDestination(match.config.id);
            }}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        ) : null}

        {step === 3 ? (
          <DeviceStep
            intent={intent}
            explanation={plan?.explanation ?? []}
            aspects={chosen.map((d) => ({
              name: PLATFORM_PROFILES[d.config.platform].displayName,
              aspect: plan?.destinationAspects[d.config.id] ?? d.config.aspectRatio,
            }))}
            onBack={() => setStep(2)}
            onOpenStudio={async () => {
              await finishOnboarding();
              navigate('/app/studio');
            }}
          />
        ) : null}

        <NoticeCards />
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- step 1 */

function IntentStep({
  selected,
  onChoose,
}: {
  selected: ContentType | null;
  onChoose: (intent: ContentType) => void;
}): ReactElement {
  return (
    <>
      <p className="lt-onboarding__body">
        LIVETAP sets up the picture, the shape and the quality from this one answer. You can change
        any of it later.
      </p>
      <ul className="lt-intentgrid">
        {CONTENT_TYPES.map((id) => {
          const profile = INTENT_PROFILES[id];
          return (
            <li key={id}>
              <button
                type="button"
                className={['lt-intentcard', 'lt-touch', selected === id ? 'is-active' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={selected === id}
                onClick={() => onChoose(id)}
              >
                {/*
                  Glyph and title on one line.
                  The icon set, not emoji (PRODUCT_REVIEW P2-5). Emoji on the intent cards and
                  Moment cards put a second visual language next to the drawn icons in the nav,
                  and it renders differently on every platform — which for the first screen of
                  the product is the one place a glyph has to look deliberate.
                */}
                <span className="lt-intentcard__head">
                  <span className="lt-intentcard__glyph" aria-hidden="true">
                    <IntentIcon intent={id} size={24} />
                  </span>
                  <span className="lt-intentcard__title">{profile.title}</span>
                </span>
                <span className="lt-intentcard__tagline">{profile.tagline}</span>
                {/*
                  What the preset does, as one line rather than a bulleted list.

                  Six cards x three bullets is eighteen indented lines of specification on the
                  first screen anyone sees, which reads as documentation rather than as a choice
                  between six things. The facts are the same facts; separated by middots they are
                  a caption under a card instead of a list to work through, and the card goes
                  from five rows to three.
                */}
                <span className="lt-intentcard__gets">{profile.whatYouGet.join(' · ')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ---------------------------------------------------------------- step 2 */

function PlatformStep({
  mockMode,
  chosen,
  onPick,
  onDrop,
  onBack,
  onContinue,
}: {
  mockMode: boolean;
  chosen: PlatformId[];
  onPick: (platform: PlatformId) => Promise<void>;
  onDrop: (platform: PlatformId) => void;
  onBack: () => void;
  onContinue: () => void;
}): ReactElement {
  const [pending, setPending] = useState<PlatformId | null>(null);

  return (
    <>
      <p className="lt-onboarding__body">
        Pick as many as you like — LIVETAP sends to all of them at once. How you connect depends on
        what each platform actually allows, and LIVETAP says so before you spend any time on it.
      </p>

      <ul className="lt-platformgrid">
        {PLATFORM_ORDER.filter((id) => id !== 'custom').map((id) => {
          const status = platformStatus(id);
          const picked = chosen.includes(id);
          const label = status.blocked
            ? COPY.notAvailable
            : mockMode
              ? picked
                ? 'Connected'
                : status.actionLabel
              : status.actionLabel;
          return (
            <li key={id}>
              <button
                type="button"
                className={['lt-platformcard', 'lt-touch', picked ? 'is-active' : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={status.blocked ? undefined : picked}
                aria-disabled={status.blocked || undefined}
                aria-describedby={status.blocked ? `lt-why-${id}` : undefined}
                onClick={() => {
                  if (status.blocked) return;
                  if (picked) {
                    onDrop(id);
                    return;
                  }
                  setPending(id);
                  void onPick(id).finally(() => setPending(null));
                }}
              >
                <span className="lt-platformcard__name">{status.profile.displayName}</span>
                <span className="lt-platformcard__badges">
                  <Badge tone={status.tone}>{label}</Badge>
                  {mockMode && !status.blocked ? <Badge tone="info">{COPY.demo}</Badge> : null}
                  {pending === id ? <Spinner size={20} label="Connecting" /> : null}
                </span>
                <span className="lt-platformcard__summary">{status.summary}</span>
                {status.blocked ? (
                  <span className="lt-platformcard__why" id={`lt-why-${id}`}>
                    {status.blockedReason}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Demo mode is stated by the banner above the grid; this line is for a real deployment. */}
      {mockMode ? null : (
        <p className="lt-onboarding__note">
          LIVETAP never sees your password. Sign-in happens on the platform’s own page.
        </p>
      )}

      <div className="lt-onboarding__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={onContinue}
          disabled={chosen.length === 0}
        >
          Continue
        </Button>
      </div>
      {chosen.length === 0 ? (
        <p className="lt-onboarding__note">Pick one place to go live to continue.</p>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- step 3 */

function DeviceStep({
  intent,
  explanation,
  aspects,
  onBack,
  onOpenStudio,
}: {
  intent: ContentType | null;
  explanation: readonly string[];
  aspects: ReadonlyArray<{ name: string; aspect: AspectRatio }>;
  onBack: () => void;
  onOpenStudio: () => void | Promise<void>;
}): ReactElement {
  const { cameras, microphones, probed, unsupported, permission, refresh } = useDevices();
  const aspect = useAppStore((s) => s.aspect);
  const setCameraDevice = useAppStore((s) => s.setCameraDevice);
  const setMicDevice = useAppStore((s) => s.setMicDevice);
  /*
   * Blocked is not the same as absent, and neither is the same as a usable choice.
   *
   * `enumerateDevices` returns an entry per device even when the permission is refused, with no
   * label and no id, so a picker built straight from it offered "Camera 1" and "Microphone 1" as
   * though they were selectable — the app claiming a camera it could not open. Found by blocking
   * the permission and looking at the screen.
   */
  const blocked = probed && permission === 'denied';
  const noCamera = probed && (cameras.length === 0 || blocked);
  const noMic = probed && (microphones.length === 0 || blocked);

  return (
    <>
      <div className="lt-devicestep">
        <div className="lt-devicestep__preview">
          <PreviewCanvas aspect={aspect} live={false} muted={false} />
          {blocked ? (
            <p className="lt-devicestep__hint">
              Your browser is blocking the camera and microphone for LIVETAP. Allow them in the
              address bar or in your system privacy settings, then tap Look again.
            </p>
          ) : noCamera ? (
            <p className="lt-devicestep__hint">{COPY.noCamera}</p>
          ) : null}
        </div>

        <div className="lt-devicestep__pickers">
          {!probed ? (
            <p className="lt-devicestep__hint">
              <Spinner size={20} /> Looking for your camera and microphone…
            </p>
          ) : null}

          <Select
            label="Camera"
            hint={
              blocked
                ? 'Blocked by your browser, so there is nothing to choose yet.'
                : noCamera
                  ? 'Nothing to choose yet — plug a camera in and tap Look again.'
                  : 'This is your Main Camera Moment.'
            }
            onChange={(event) => setCameraDevice(event.currentTarget.value)}
            options={
              cameras.length > 0 && !blocked
                ? cameras.map((c) => ({ value: c.deviceId, label: c.label }))
                : [
                    {
                      value: 'none',
                      label: blocked ? 'Blocked' : unsupported ? 'Test pattern' : 'No camera',
                    },
                  ]
            }
          />

          <Select
            label="Microphone"
            /*
             * "Say something - the level should move" promised a level meter this screen does not
             * draw, and promised it hardest in the state where there is no microphone to move it.
             */
            hint={
              blocked
                ? 'Blocked by your browser, so there is nothing to choose yet.'
                : noMic
                  ? 'No microphone found — viewers will hear nothing.'
                  : 'Whatever you pick here is what your audience will hear.'
            }
            onChange={(event) => setMicDevice(event.currentTarget.value)}
            options={
              microphones.length > 0 && !blocked
                ? microphones.map((m) => ({ value: m.deviceId, label: m.label }))
                : [{ value: 'none', label: blocked ? 'Blocked' : 'No microphone' }]
            }
          />

          {noCamera || noMic ? (
            <Button variant="secondary" onClick={() => void refresh()}>
              Look again
            </Button>
          ) : null}
        </div>
      </div>

      <section className="lt-setup" aria-labelledby="lt-setup-heading">
        <h2 id="lt-setup-heading">Here is your setup</h2>
        <ul className="lt-setup__list">
          {explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {aspects.length > 0 ? (
            <li>{aspects.map((a) => `${a.name} ${a.aspect}`).join(' · ')}</li>
          ) : null}
          {intent ? (
            <li>{`Your Moments are laid out for ${INTENT_PROFILES[intent].title.toLowerCase()}. Tap one in Studio to switch what viewers see.`}</li>
          ) : null}
        </ul>
        <p className="lt-setup__foot">You can run this setup again from Settings.</p>
      </section>

      <div className="lt-onboarding__actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" size="lg" onClick={() => void onOpenStudio()}>
          {COPY.openStudio}
        </Button>
      </div>
    </>
  );
}
