/**
 * The comparison band: two lanes, one claim each, every number traceable.
 *
 * The first-time-creator audit of the deployed page asked for two things this module exists to
 * answer: name the incumbent out loud, and show the setup difference as something you can press
 * rather than a table you skim. So the band plays. Lane A reveals the concepts the OBS Quick
 * Start Guide names before a first stream; lane B reveals the six taps the golden path measures.
 *
 * Provenance, because the release gate is an anti-fabrication gate:
 *
 *   - Every LIVETAP number is from `docs/qa/FRICTION_BENCHMARK.md` section 2, where each one is
 *     asserted by a test rather than estimated by a person: 6 taps, 2 questions, 0 broadcasting
 *     words, 16:9 and 9:16 from one production, 0 actions to recover a dropped destination.
 *   - Every OBS number is from `docs/qa/FRICTION_BENCHMARK.md` section 3, which cites
 *     `docs/research/SWITCHING_TRIGGERS.md` T6 and T1: 14 concepts named before a first stream
 *     (the list below is that list, in that order), 1,443 localised strings, and multistreaming
 *     that is not in the product.
 *   - No tap count and no minutes figure is printed for OBS. Section 3 of the benchmark says a
 *     tap-for-tap count is deliberately not asserted, because the research contains no
 *     instrumented click count and inventing one would be exactly the kind of number this
 *     project refuses to publish. This module honours that: it counts concepts, not clicks.
 *   - Every competitor line in the closing strip is one sentence carried over from
 *     `docs/research/COMPETITOR_FAILURE_DATABASE_A.md`, and carries the section it came from in
 *     `data-lt-source`, so a reviewer can check it without reading this file.
 *
 * The stylesheet is `./versus.css`. It is deliberately not imported here: `versus.ts` stays a
 * pure module so the landing page keeps its single stylesheet, and the page picks the file up
 * with one line in `apps/web/src/landing.css`:
 *
 *     @import './public/versus.css';
 *
 * Motion: opacity and transform only, never a layout property, and the whole reveal is skipped
 * when the host passes `reduced`. Every chip is in the DOM from the moment the band mounts, so
 * the reveal is decoration over content assistive technology can already read, not a gate in
 * front of it.
 */

import { animate } from 'animejs/animation';
import { createTimer } from 'animejs/timer';

/** Which lane. */
export type VersusSide = 'obs' | 'livetap';

export interface VersusOptions {
  /** True when the visitor asked for reduced motion. Everything lands at its final value. */
  reduced: boolean;
  /** Called every time lane B plays, so the page can move its own surface in step. */
  onPlayLivetap?: () => void;
}

export interface VersusHandle {
  /** Play one lane. Playing a lane that has already played replays it. */
  play(side: VersusSide): void;
  /** Back to the unplayed state, both lanes. */
  reset(): void;
  /** Stop everything, drop the listener, empty the host. */
  destroy(): void;
}

/**
 * The concepts the OBS Quick Start Guide names before a first stream, in the guide's own order.
 * FRICTION_BENCHMARK.md section 3, quoting SWITCHING_TRIGGERS.md T6.
 */
const OBS_CONCEPTS = [
  'Auto-Configuration Wizard',
  'Scene',
  'Source',
  'Display Capture',
  'Window Capture',
  'macOS Screen Capture',
  'Game Capture',
  'Video Capture',
  'Sources Dock',
  'Audio Mixer',
  'Settings → Audio',
  'Settings → Output',
  'Controls Dock',
  'Start Streaming',
] as const;

/** The six measured taps, in order. FRICTION_BENCHMARK.md section 2. */
const LIVETAP_TAPS = ['Talking', 'YouTube', 'TikTok', 'Continue', 'Open Studio', 'GO LIVE'] as const;

/**
 * The closing strip. One line each, and not one word beyond what the research states.
 *
 * Ecamm, Twitch Studio, vMix and the rest are left out for the same reason a fifth line is left
 * out: the strip answers "why not the others", and four named products answer it.
 */
const OTHERS = [
  {
    name: 'Restream',
    line: 'Adding one more platform is a billing decision, not a UI action.',
    source: 'COMPETITOR_FAILURE_DATABASE_A.md §2.3 Setup friction',
  },
  {
    name: 'StreamYard',
    line: 'Echo is the signature beginner failure, and the fix is a switch matrix that contradicts the setting names.',
    source: 'COMPETITOR_FAILURE_DATABASE_A.md §2.4 Beginner complaints',
  },
  {
    name: 'Streamlabs',
    line: 'Multistreaming, the single most common creator intent, is a paid-tier feature.',
    source: 'COMPETITOR_FAILURE_DATABASE_A.md §2.2 Pricing friction',
  },
  {
    name: 'Riverside',
    line: 'Chrome or Edge only on desktop, so a guest on Safari or Firefox is a hard blocker.',
    source: 'COMPETITOR_FAILURE_DATABASE_A.md §2.5 Weaknesses',
  },
] as const;

/** One chip per 90 ms, the cadence the band was specified at. */
const STEP_MS = 90;
/** How long a single chip takes to arrive once its turn comes. */
const CHIP_MS = 320;
/** How far a chip travels in, in pixels. Transform only. */
const CHIP_RISE = 10;

type Reveal = ReturnType<typeof animate>;
type Tick = ReturnType<typeof createTimer>;

interface Lane {
  readonly side: VersusSide;
  readonly track: HTMLElement;
  readonly chips: HTMLElement[];
  readonly count: HTMLElement;
  readonly total: number;
  played: boolean;
  reveal: Reveal | null;
  tick: Tick | null;
}

const chipList = (items: readonly string[]): string =>
  items.map((label) => `<li class="lt-chip ltv-chip">${label}</li>`).join('');

const otherList = (): string =>
  OTHERS.map(
    (other) =>
      `<li class="ltv-other" data-lt-source="${other.source}">` +
      `<b class="ltv-other__name">${other.name}</b> ` +
      `<span class="ltv-other__line">${other.line}</span></li>`,
  ).join('');

/**
 * The whole band, as one string.
 *
 * Both counters are written at their final values rather than at zero, because the markup is the
 * resting state: a visitor who never presses a button, or whose JavaScript never arrives, still
 * reads two true sentences. Playing a lane sets its counter to zero and counts it back up.
 */
const MARKUP =
  '<div class="ltv-lanes">' +
  '<section class="ltv-lane" data-lt-lane="obs">' +
  '<div class="ltv-head">' +
  '<h3 class="ltv-title">The usual way</h3>' +
  '<span class="lt-badge lt-badge--neutral">OBS Studio</span>' +
  '</div>' +
  '<button type="button" class="lt-btn lt-btn--md lt-btn--secondary lt-touch ltv-play" ' +
  'data-lt-play="obs">Play the usual setup</button>' +
  '<ol class="ltv-track" data-lt-track="obs" ' +
  `aria-label="Concepts named before a first stream">${chipList(OBS_CONCEPTS)}</ol>` +
  '<p class="ltv-count"><b class="lt-num ltv-figure" data-lt-count="obs">14</b> concepts named ' +
  'before your first stream</p>' +
  '<p class="ltv-note"><b class="lt-num">1,443</b> localised strings in the front end.</p>' +
  '<p class="ltv-note">Multistreaming: not in the product; needs a third-party plugin, one click ' +
  'per destination.</p>' +
  '<p class="ltv-source">Counted from the OBS Quick Start Guide. ' +
  'See docs/qa/FRICTION_BENCHMARK.md</p>' +
  '</section>' +
  '<section class="ltv-lane ltv-lane--ours" data-lt-lane="livetap">' +
  '<div class="ltv-head">' +
  '<h3 class="ltv-title">LIVETAP</h3>' +
  '<span class="lt-badge lt-badge--success">Measured</span>' +
  '</div>' +
  '<button type="button" class="lt-btn lt-btn--md lt-btn--primary lt-touch ltv-play" ' +
  'data-lt-play="livetap">Play LIVETAP</button>' +
  '<ol class="ltv-track" data-lt-track="livetap" ' +
  `aria-label="Taps from the first screen to live">${chipList(LIVETAP_TAPS)}</ol>` +
  '<p class="ltv-count"><b class="lt-num ltv-figure" data-lt-count="livetap">6</b> taps · ' +
  '<b class="lt-num">2</b> questions · <b class="lt-num">0</b> broadcasting words</p>' +
  '<p class="ltv-note">One production, 16:9 and 9:16 at once. A dropped destination reconnects ' +
  'itself: 0 actions.</p>' +
  '<p class="ltv-source">Measured by the golden-path tests. ' +
  'See docs/qa/FRICTION_BENCHMARK.md</p>' +
  '</section>' +
  '</div>' +
  '<section class="ltv-others">' +
  '<h4 class="ltv-others__title">Why not the others?</h4>' +
  `<ul class="ltv-others__list">${otherList()}</ul>` +
  '<p class="ltv-source">One line each, from docs/research/COMPETITOR_FAILURE_DATABASE_A.md. ' +
  'Every line carries its own section.</p>' +
  '</section>';

/**
 * Mount the comparison band into an empty host.
 *
 * The host carries `data-lt-versus-state` at `idle`, `obs`, `livetap` or `both` throughout, which
 * is the attribute a verification pass reads to know what it is looking at.
 */
export function mountVersus(host: HTMLElement, opts: VersusOptions): VersusHandle {
  const reduced = opts.reduced;
  host.innerHTML = MARKUP;

  const find = (selector: string): HTMLElement => {
    const found = host.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`versus: missing ${selector}`);
    return found;
  };

  const makeLane = (side: VersusSide, total: number): Lane => {
    const track = find(`[data-lt-track="${side}"]`);
    return {
      side,
      track,
      chips: Array.from(track.querySelectorAll<HTMLElement>('.ltv-chip')),
      count: find(`[data-lt-count="${side}"]`),
      total,
      played: false,
      reveal: null,
      tick: null,
    };
  };

  const lanes: Record<VersusSide, Lane> = {
    obs: makeLane('obs', OBS_CONCEPTS.length),
    livetap: makeLane('livetap', LIVETAP_TAPS.length),
  };
  const both = [lanes.obs, lanes.livetap];

  const paint = (lane: Lane, value: number): void => {
    lane.count.textContent = String(value);
  };

  /** Stop whatever a lane is doing, and put its inline styles back the way they were found. */
  const stop = (lane: Lane): void => {
    lane.reveal?.revert();
    lane.reveal = null;
    lane.tick?.cancel();
    lane.tick = null;
  };

  const syncState = (): void => {
    const played = both.filter((lane) => lane.played).map((lane) => lane.side);
    host.dataset.ltVersusState =
      played.length === 2 ? 'both' : (played[0] ?? 'idle');
  };

  const run = (lane: Lane): void => {
    stop(lane);
    lane.played = true;
    lane.track.dataset.ltShown = 'true';
    syncState();

    if (reduced) {
      paint(lane, lane.total);
      return;
    }

    paint(lane, 0);
    lane.reveal = animate(lane.chips, {
      opacity: [0, 1],
      translateY: [CHIP_RISE, 0],
      duration: CHIP_MS,
      ease: 'outQuad',
      delay: (_target?: unknown, index?: number) => (index ?? 0) * STEP_MS,
    });
    lane.tick = createTimer({
      duration: lane.total * STEP_MS,
      onUpdate: (self) => paint(lane, Math.round(Math.min(1, self.progress) * lane.total)),
      onComplete: () => paint(lane, lane.total),
    });
  };

  const handle: VersusHandle = {
    play(side) {
      run(lanes[side]);
      if (side === 'livetap') opts.onPlayLivetap?.();
    },
    reset() {
      for (const lane of both) {
        stop(lane);
        lane.played = false;
        delete lane.track.dataset.ltShown;
        paint(lane, lane.total);
      }
      syncState();
    },
    destroy() {
      for (const lane of both) stop(lane);
      host.removeEventListener('click', onClick);
      host.innerHTML = '';
      delete host.dataset.ltVersusState;
    },
  };

  /** One listener on the host rather than two on the buttons: one thing to remove on destroy. */
  function onClick(event: Event): void {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-lt-play]');
    const side = button?.dataset.ltPlay;
    if (side === 'obs' || side === 'livetap') handle.play(side);
  }

  host.addEventListener('click', onClick);
  syncState();
  return handle;
}
