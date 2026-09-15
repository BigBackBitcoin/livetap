import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Icons, IconButton, useReducedMotion } from '@livetap/ui';
import { useAppStore } from '../state/store.js';
import './tour.css';

/**
 * QUICK TOUR — seven beats, twenty-eight seconds, and then never again.
 *
 * The directive (§26) names the whole syllabus: CONNECT, CAMERA, MOMENT, DESTINATION, GO LIVE,
 * BREAK IT, RECOVER. Seven things, a maximum of thirty seconds, skippable, and after it is
 * finished or skipped the product stops explaining itself. Everything below is that sentence
 * turned into constraints.
 *
 * **It points at the product rather than replacing it.** Each beat rings a control that is
 * already on the screen and says one short thing about it. That is why there are no pictures and
 * no pages: a slideshow teaches the slideshow, and the creator has to find the real control
 * afterwards anyway. The ring is drawn from the target's own bounding box, so it is right at
 * every width and in both densities without the tour knowing anything about the layout.
 *
 * **It is an offer, not an interruption.** There is no scrim. The positioning layer is
 * `pointer-events: none` and only the card itself takes clicks, so the page behind is fully
 * usable while the tour is up — a first-time creator who wants to press GO LIVE this second can,
 * and pressing it simply ends the tour. A tour a person has to escape from is a modal wearing a
 * costume.
 *
 * **It can never cover the stop control.** §18 says END is always reachable, and a tour overlay
 * is exactly the kind of thing that quietly breaks that. Three independent guarantees, because
 * one of them will eventually be edited by someone who does not know about the other two:
 *   1. It does not render at all unless the production is IDLE or PREVIEW, which is precisely
 *      when `LiveBar` does not exist.
 *   2. Its layer sits at `--lt-z-golive` (40), far below `--lt-z-livebar` (900).
 *   3. The card is pinned to the TOP of the viewport at every width. The stop control and the
 *      pinned GO LIVE bar both live at the bottom.
 *
 * **Its memory has two halves**, which is the bug the landing page's tour already found and
 * fixed. `answered` records that the OFFER was answered — true for someone who said "No thanks"
 * and never took a beat — and is what stops the product asking again. `step` records how far
 * through the beats a person got, so a reload resumes instead of restarting. Collapsing the two
 * is how a tour that was dismissed comes back.
 */

/* ------------------------------------------------------------------ the beats */

interface Beat {
  /** The idea, in one or two words. The noun the creator will use for this later. */
  readonly title: string;
  /** One short sentence. Never two. */
  readonly line: string;
  /**
   * Where to draw the ring, in order of preference. The first selector that matches a visible
   * box wins; if none do — a beat about a control this screen does not have right now — the card
   * still shows and simply does not ring anything. Selectors are the product's own class names
   * rather than `data-lt-tour` hooks, so adding the tour changed no other component's markup.
   */
  readonly target: readonly string[];
}

export const BEATS: readonly Beat[] = [
  {
    title: 'Connect',
    line: 'Sign in to a platform once; it is the one thing LIVETAP cannot do for you.',
    target: ['.lt-chiprow--empty .lt-btn', 'a[href="/app/destinations"]', '.lt-shell__navlist'],
  },
  {
    title: 'Camera',
    line: 'Your camera and microphone, with a mute that stays reachable while you are live.',
    target: ['.lt-devices', '.lt-studio__devices'],
  },
  {
    title: 'Moment',
    line: 'A Moment is one thing viewers see; tap another and they see that instead.',
    target: ['.lt-momentstrip', '.lt-studio__moments'],
  },
  {
    title: 'Destination',
    line: 'Everywhere this stream is going at once, listed here while it runs.',
    target: ['.lt-studio__dock', '.lt-dock__dests'],
  },
  {
    title: 'Go live',
    line: 'One button, with a countdown you cancel by pressing it again.',
    target: ['.lt-golive', '.lt-golivebar'],
  },
  {
    title: 'Break it',
    line: 'If one platform fails this turns amber, and the rest keep broadcasting.',
    target: ['.lt-pill', '.lt-studio__stagebar'],
  },
  {
    title: 'Recover',
    line: 'LIVETAP reconnects the one that dropped, and END stays on screen throughout.',
    target: ['.lt-studio__dock', '.lt-preflight'],
  },
];

/** Four seconds a beat: seven beats is 28 seconds, inside the thirty the directive allows. */
export const BEAT_MS = 4000;

/* ------------------------------------------------------------------ the memory */

const ANSWERED_KEY = 'livetap.tour.answered';
const STEP_KEY = 'livetap.tour.step';

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Private mode, or storage disabled. The tour still works; it is just not remembered.
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* As above: the worst case is that the offer is made once more. */
  }
}

function removeLocal(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Has the offer been answered, either way? This is what "never show it again" reads. */
export function tourAnswered(): boolean {
  return readLocal(ANSWERED_KEY) === 'true';
}

/**
 * Put the tour back on offer. Settings calls this, and it is the only way back in — which is the
 * point: a creator who has answered once is never asked again unless they ask to be.
 */
export function replayTour(): void {
  removeLocal(ANSWERED_KEY);
  removeLocal(STEP_KEY);
  window.dispatchEvent(new CustomEvent('livetap:tour-replay'));
}

/* ------------------------------------------------------------------ the component */

type Phase = 'offer' | 'running' | 'done';

export function Tour(): ReactElement | null {
  const productionState = useAppStore((s) => s.production.state);
  const onboardingDone = useAppStore((s) => s.onboardingDone);
  const reducedMotion = useReducedMotion();

  /*
   * The two halves of the memory, read back in the one order that is correct.
   *
   * `answered` alone is not enough to decide the phase, and reading it as though it were is the
   * bug this product has already shipped once: someone three beats into the tour reloads, the
   * offer has been answered, and the tour vanishes with four beats unseen. Answered-and-mid-way
   * resumes; answered-and-finished is done, because finishing clears the step.
   */
  const [step, setStep] = useState<number>(() => {
    const stored = Number.parseInt(readLocal(STEP_KEY) ?? '', 10);
    return Number.isInteger(stored) && stored > 0 && stored < BEATS.length ? stored : 0;
  });
  const [phase, setPhase] = useState<Phase>(() => {
    if (!tourAnswered()) return 'offer';
    return readLocal(STEP_KEY) === null ? 'done' : 'running';
  });
  /*
   * Auto-advance stops for good the moment the creator takes the wheel.
   *
   * The first version paused on hover and on focus, and both deadlocked for the same reason:
   * clicking "Show me" or "Next" leaves the pointer over the card and the focus inside it, so
   * the tour paused itself on the beat it had just reached and stayed there. Measured: an
   * unattended run never finished in sixty seconds. "Has this person pressed a button yet" is
   * the signal that actually distinguishes reading from driving, it cannot deadlock, and it is
   * predictable in a way a hover timer never is — left alone the tour runs its 28 seconds and
   * ends; touched once, it never moves on its own again.
   */
  const [manual, setManual] = useState(false);
  const [ring, setRing] = useState<DOMRect | null>(null);

  /*
   * "Not live" is the whole safety condition, and it is the same test `AppShell` and `LiveBar`
   * use for the same reason. STARTING has already created broadcast objects and STOPPING is
   * still sending frames, so both count as live and neither may carry an overlay.
   */
  const live = productionState !== 'IDLE' && productionState !== 'PREVIEW';

  /* Settings can put the offer back without a reload. */
  useEffect(() => {
    const replay = (): void => {
      setStep(0);
      setManual(false);
      setPhase('offer');
    };
    window.addEventListener('livetap:tour-replay', replay);
    return () => window.removeEventListener('livetap:tour-replay', replay);
  }, []);

  const answer = useCallback((next: Phase) => {
    writeLocal(ANSWERED_KEY, 'true');
    setPhase(next);
  }, []);

  const finish = useCallback(() => {
    removeLocal(STEP_KEY);
    setPhase('done');
    setRing(null);
  }, []);

  const goTo = useCallback((next: number) => {
    if (next >= BEATS.length) {
      removeLocal(STEP_KEY);
      setPhase('done');
      setRing(null);
      return;
    }
    const index = Math.max(0, next);
    writeLocal(STEP_KEY, String(index));
    setStep(index);
  }, []);

  /*
   * Escape ends it from anywhere, permanently, which is the same gesture that dismisses every
   * other transient surface in this product. A tour that has to be clicked shut is a tour that
   * gets clicked shut by accident on the control behind it.
   */
  useEffect(() => {
    if (phase === 'done') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      writeLocal(ANSWERED_KEY, 'true');
      removeLocal(STEP_KEY);
      setPhase('done');
      setRing(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase]);

  /* Four seconds a beat, until the creator presses something. */
  useEffect(() => {
    if (phase !== 'running' || manual) return undefined;
    const timer = setTimeout(() => goTo(step + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [phase, manual, step, goTo]);

  const beat = BEATS[step];

  /*
   * The ring is measured, not styled onto the target.
   *
   * Drawing it as a box of our own means the tour never adds a class to another component, never
   * fights that component's own `overflow` or `border-radius`, and cannot leave a highlight
   * behind if it unmounts mid-beat. It re-measures on scroll and resize because the page stays
   * live and scrollable underneath.
   */
  useEffect(() => {
    if (phase !== 'running' || beat === undefined) {
      setRing(null);
      return undefined;
    }
    let raf = 0;
    const find = (): Element | null => {
      for (const selector of beat.target) {
        const found = document.querySelector(selector);
        if (found && found.getBoundingClientRect().height > 0) return found;
      }
      return null;
    };
    const measure = (): void => {
      const target = find();
      setRing(target ? target.getBoundingClientRect() : null);
    };
    const target = find();
    target?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    measure();
    // A smooth scroll is still travelling when it returns, so track it for a beat.
    const track = (): void => {
      measure();
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    const stop = setTimeout(() => cancelAnimationFrame(raf), reducedMotion ? 0 : 600);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      window.removeEventListener('resize', measure);
    };
  }, [phase, step, beat, reducedMotion]);

  /*
   * The ring sits OUTSIDE the target, by four pixels on every side.
   *
   * Drawn on the target's exact box it lands on the control's own border, and beat one rings
   * "Add destination" — a solid blue button — so a blue ring on its blue edge was invisible at
   * tablet width. Four pixels of page colour between the control and the ring is what makes it
   * read as a ring rather than as part of the button.
   */
  const ringStyle = useMemo(() => {
    if (!ring) return undefined;
    const gap = 4;
    return {
      transform: `translate(${Math.round(ring.left - gap)}px, ${Math.round(ring.top - gap)}px)`,
      inlineSize: `${Math.round(ring.width + gap * 2)}px`,
      blockSize: `${Math.round(ring.height + gap * 2)}px`,
    };
  }, [ring]);

  /*
   * Four reasons nothing renders, and the first two are the safety ones:
   *  - the production is not idle, so `LiveBar` owns the screen and nothing may be over it;
   *  - setup has not been done, so the creator is still inside onboarding, which teaches already;
   *  - the offer has been answered and the beats are finished — the "never repeatedly show
   *    instructional text" half of the directive;
   *  - there is no beat to show.
   */
  if (live || !onboardingDone || phase === 'done') return null;

  if (phase === 'offer') {
    return (
      <div className="lt-tour" data-lt-tour="offer" aria-live="polite">
        <div className="lt-tour__card" role="region" aria-label="Quick tour">
          <p className="lt-tour__offer">Thirty seconds on how this works?</p>
          <div className="lt-tour__actions">
            <button
              type="button"
              className="lt-btn lt-btn--primary lt-btn--sm lt-touch"
              onClick={() => {
                // The step is written now, not on the first Next: a reload one second into the
                // tour must resume at beat one, not decide the whole thing was already done.
                writeLocal(STEP_KEY, '0');
                setStep(0);
                setManual(false);
                answer('running');
              }}
            >
              <span className="lt-btn__label">Show me</span>
            </button>
            <button
              type="button"
              className="lt-btn lt-btn--ghost lt-btn--sm lt-touch"
              onClick={() => answer('done')}
            >
              <span className="lt-btn__label">No thanks</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (beat === undefined) return null;

  return (
    <div className="lt-tour" data-lt-tour="running">
      {ringStyle ? <div className="lt-tour__ring" style={ringStyle} aria-hidden="true" /> : null}

      <div className="lt-tour__card" role="region" aria-label="Quick tour">
        <div className="lt-tour__head">
          {/*
            The count is the honest version of a progress bar: it says how much is left in a
            number a person can read in one glance, and it does not animate.
          */}
          <span className="lt-tour__count lt-type-status">{`${step + 1} of ${BEATS.length}`}</span>
          <IconButton
            label="Close the quick tour"
            size="sm"
            variant="ghost"
            onClick={() => {
              writeLocal(ANSWERED_KEY, 'true');
              finish();
            }}
          >
            <Icons.x size={20} />
          </IconButton>
        </div>

        {/*
          One live region for the whole beat, so a screen reader hears "Moment. A Moment is one
          thing viewers see…" as one announcement rather than two interrupting each other.
        */}
        <div className="lt-tour__beat" aria-live="polite" aria-atomic="true">
          <p className="lt-tour__title">{beat.title}</p>
          <p className="lt-tour__line">{beat.line}</p>
        </div>

        <div className="lt-tour__actions">
          <button
            type="button"
            className="lt-btn lt-btn--ghost lt-btn--sm lt-touch"
            onClick={() => {
              writeLocal(ANSWERED_KEY, 'true');
              finish();
            }}
          >
            <span className="lt-btn__label">Skip</span>
          </button>
          <button
            type="button"
            className="lt-btn lt-btn--secondary lt-btn--sm lt-touch"
            onClick={() => {
              setManual(true);
              goTo(step - 1);
            }}
            disabled={step === 0}
          >
            <span className="lt-btn__label">Back</span>
          </button>
          <button
            type="button"
            className="lt-btn lt-btn--primary lt-btn--sm lt-touch"
            onClick={() => {
              setManual(true);
              goTo(step + 1);
            }}
          >
            <span className="lt-btn__label">{step === BEATS.length - 1 ? 'Done' : 'Next'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
