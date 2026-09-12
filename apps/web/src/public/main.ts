/**
 * The public experience's own logic.
 *
 * Two motion systems and one boundary between them (`LIVETAP_MOTION_SYSTEM.md` §2):
 *
 *   Scroll Craft is the only thing that reads scroll position. It pins the acts, publishes
 *   `--sc-p`, runs the cues, the `pan` travel, the `reveal` wipe, the `count` bloom, the
 *   `parallax` rate and the ground drift, and it owns the reduced-motion floor.
 *
 *   Anime.js owns everything on a clock or on a pointer: the hero story, every state-change
 *   transition, the countdowns, the path draws, chat arrival, the Pro reveal and the drag. It
 *   never reads scroll except through a `ScrollObserver` threshold, and `sync` on this page
 *   only ever carries playback-method names.
 *
 * Everything the page paints is computed from `./data.ts`, whose every array names its source
 * in `packages/*` and is covered by a drift test. Nothing here invents a state, a capability,
 * a placement or a number.
 */

/* The engine, vendored verbatim and imported for its one side effect: `window.ScrollCraft`. */
import './scrollcraft.js';

import { animate } from 'animejs/animation';
import { createDraggable } from 'animejs/draggable';
import { onScroll } from 'animejs/events';
import { createTimer } from 'animejs/timer';
import { createSeededRandom, set as animeSet } from 'animejs/utils';
import { spring } from 'animejs/easings/spring';
import { engine } from 'animejs/engine';

import {
  CHAT_BADGES,
  CHAT_MESSAGES,
  CHAT_NAMES,
  CHAT_PLATFORMS,
  DEFAULT_HEIGHT,
  DEFAULT_QUALITY_LABEL,
  DEMO_TARGET,
  DESTINATIONS,
  DOT,
  FORMATS,
  INTENTS,
  MAX_ATTEMPTS,
  METHOD_LABEL,
  METHOD_TONE,
  MOMENTS,
  RENAME,
  RETRY_SECONDS,
  SAFE_AREAS,
  STATE_CODE,
  STATE_LABEL,
  chooseAspect,
  insetToSafeArea,
  nextState,
} from './data.js';
import type { Format, IntentDef, MomentDef, Rect, State } from './data.js';

/* ============================================================== the engine floor */

engine.fps = 30;
engine.pauseOnDocumentHidden = true;
engine.precision = 2;
engine.defaults.ease = 'outQuad';
engine.defaults.duration = 200;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = matchMedia('(max-width: 639.98px)');
const wide = matchMedia('(min-width: 1025px)');

/** One seed for the whole page, so every run of it is identical and the shots compare. */
const rng = createSeededRandom(20260912);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rng(0, list.length - 1, 0))] as T;

/* ==================================================================== the DOM */

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

const surface = $('[data-lt-surface]')!;
const stage = $('[data-lt-stage]')!;
const frame = $('[data-lt-frame]')!;
const canvas = $('[data-lt-canvas]')!;
const guides = $('[data-lt-guides]')!;
const guidesBox = $('.ltp-guides__box')!;
const shapeBadge = $('[data-lt-shape]')!;
const stateLine = $('[data-lt-stateline]')!;
const stateDetail = $('[data-lt-statedetail]')!;
const signal = $<SVGSVGElement>('[data-lt-signal]')!;
const destList = $('[data-lt-dests]')!;
const momentStrip = $('[data-lt-moments]')!;
const shelf = $('[data-lt-shelf]')!;
const intentGrid = $('[data-lt-intents]')!;
const openLink = $<HTMLAnchorElement>('[data-lt-open]')!;
const interaction = $('[data-lt-interaction]')!;
const lattice = $('[data-lt-lattice]')!;

const golive = $<HTMLButtonElement>('[data-lt-golive]')!;
const goliveLabel = $('[data-lt-golive-label]')!;
const goliveCount = $('[data-lt-golive-count]')!;
const goliveCancel = $('[data-lt-golive-cancel]')!;
const goliveSub = $('[data-lt-golive-sub]')!;

const outDests = $('[data-lt-out="dests"]')!;
const outFormats = $('[data-lt-out="formats"]')!;
const outHealth = $('[data-lt-out="health"]')!;
const outClock = $('[data-lt-out="clock"]')!;
const healthPill = $('[data-lt-health]')!;

const chatLog = $('[data-lt-chatlog]')!;
const chatEmpty = $('[data-lt-chatempty]')!;
const chatPanel = $('[data-lt-chat]')!;

const proToggle = $<HTMLButtonElement>('[data-lt-pro-toggle]')!;
const proLayers = $('[data-lt-prolayers]')!;

const sayDest = $('[data-lt-say="dest"]')!;
const sayBroadcast = $('[data-lt-say="broadcast"]')!;
const sayTour = $('[data-lt-say="tour"]')!;

const formatTable = $('[data-lt-formattable]')!;

/* ================================================================== page state */

interface DestRow {
  id: string;
  name: string;
  state: State;
  attempt: number;
  /** The li, its tile button, and every part of it the page repaints. */
  li: HTMLElement;
  tile: HTMLButtonElement;
  chip: HTMLElement;
  dot: HTMLElement;
  label: HTMLElement;
  status: HTMLElement;
  method: HTMLElement;
  fmt: HTMLElement;
  slot: HTMLElement;
  grip: HTMLElement;
  ring: HTMLElement;
  digit: HTMLElement;
  arc: SVGCircleElement;
  errorslot: HTMLElement;
  keyrow: HTMLElement;
  path: SVGPathElement;
  hint: HTMLElement;
  drag: ReturnType<typeof createDraggable> | null;
  nudge: { x: number; y: number };
  tension: number;
}

const rows: DestRow[] = [];
let format: Format = '16:9';
let momentId = 'main-camera';
let intent: IntentDef = INTENTS[0]!;
let pro = false;
const inputs = { camera: false, mic: false, screen: false };
let liveAt = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const log: string[] = [];

const RING_R = 10;
const RING_C = 2 * Math.PI * RING_R;

/* ============================================================= small utilities */

function icon(id: string, size: 20 | 24 = 20): string {
  return `<svg class="lt-icon lt-icon--${size}" aria-hidden="true" focusable="false"><use href="#${id}" /></svg>`;
}

function say(region: HTMLElement, text: string): void {
  region.textContent = '';
  // A live region only announces a change, so the text has to land after the clear.
  requestAnimationFrame(() => {
    region.textContent = text;
  });
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function note(line: string): void {
  log.unshift(`${mmss(liveAt ? Date.now() - liveAt : 0)}  ${line}`);
  log.length = Math.min(log.length, 6);
  if (pro) paintPro();
}

/**
 * The two-system contract, enforced in development rather than trusted.
 *
 * Scroll Craft writes `transform` and `opacity` on anything carrying a cue, a pan or a
 * parallax rate. Anime.js must never write the same property on the same node, so this fails
 * loudly in `vite dev` and compiles out of the production bundle.
 */
function ownsTransform(el: Element): void {
  if (!import.meta.env.DEV) return;
  if (el.closest('[data-sc-cue],[data-sc-pan],[data-sc-parallax]')) {
    console.warn('[livetap] two systems on one transform', el);
  }
}

/* =============================================================== layout + paths */

/**
 * One measurement pass. It writes the frame's box, the visible canvas's box and the signal
 * layer's own coordinate system, then redraws every path. Called on mount, on resize and on a
 * format change, never per frame.
 */
function layout(): void {
  const box = stage.getBoundingClientRect();
  const wrap = (stage.parentElement as HTMLElement).getBoundingClientRect();
  /* Reserve exactly what the two state lines take rather than a guessed constant, so the stage
     is as large as the composition actually allows at every viewport. */
  const reserve = stateLine.offsetHeight + stateDetail.offsetHeight + 16;
  const maxH = Math.max(120, wrap.height - reserve);
  const maxW = Math.max(200, box.width);
  let w = maxW;
  let h = w / (16 / 9);
  if (h > maxH) {
    h = maxH;
    w = h * (16 / 9);
  }
  frame.style.setProperty('--ltp-frame-w', `${Math.round(w)}px`);
  frame.style.setProperty('--ltp-frame-h', `${Math.round(h)}px`);

  const ar = format === '16:9' ? 16 / 9 : format === '9:16' ? 9 / 16 : 1;
  let cw = w;
  let ch = w / ar;
  if (ch > h) {
    ch = h;
    cw = h * ar;
  }
  canvas.style.setProperty('--ltp-canvas-w', `${Math.round(cw)}px`);
  canvas.style.setProperty('--ltp-canvas-h', `${Math.round(ch)}px`);

  const s = surface.getBoundingClientRect();
  signal.setAttribute('viewBox', `0 0 ${Math.round(s.width)} ${Math.round(s.height)}`);
  drawPaths();
}

interface Point {
  x: number;
  y: number;
}

/** The stage's port for a destination: three down each side on desktop, six along the lower
 *  edge on a phone, allocated in the destinations' own order and never re-sorted. */
function port(i: number): Point {
  const s = surface.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  if (!wide.matches) {
    return { x: c.left - s.left + (c.width * (i + 0.5)) / 6, y: c.bottom - s.top };
  }
  const slot = [0.25, 0.5, 0.75][i % 3] as number;
  return { x: (i < 3 ? c.left : c.right) - s.left, y: c.top - s.top + c.height * slot };
}

/** The tile's own port, on its leading edge. */
function tilePort(row: DestRow, i: number): Point {
  const s = surface.getBoundingClientRect();
  const t = row.tile.getBoundingClientRect();
  if (!wide.matches) return { x: t.left - s.left + t.width / 2, y: t.top - s.top };
  return { x: (i < 3 ? t.right : t.left) - s.left, y: t.top - s.top + t.height / 2 };
}

/**
 * A cubic bezier with slack, so the line reads as a cable rather than a leader line. The
 * perpendicular offset collapses toward a straight line as the drag's tension rises, which is
 * the only thing on the page tension drives.
 */
function pathD(a: Point, b: Point, tension = 0): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 24 * (1 - tension);
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  const c1 = { x: a.x + dx * 0.4 + nx, y: a.y + dy * 0.4 + ny };
  const c2 = { x: a.x + dx * 0.6 + nx, y: a.y + dy * 0.6 + ny };
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

const PHASE: Partial<Record<State, string>> = {
  AUTHENTICATING: 'authenticating',
  READY: 'ready',
  STARTING: 'ready',
  LIVE: 'live',
  DEGRADED: 'strain',
};

function drawPath(row: DestRow, i: number, animateDraw = false): void {
  const phase = PHASE[row.state];
  if (!phase) {
    row.path.removeAttribute('data-lt-phase');
    row.path.removeAttribute('d');
    return;
  }
  row.path.setAttribute('d', pathD(port(i), tilePort(row, i), row.tension));
  row.path.setAttribute('data-lt-phase', phase);
  if (row.tension > 0) {
    row.path.style.strokeWidth = (2 - 1.25 * row.tension).toFixed(2);
    row.path.setAttribute('data-lt-phase', row.tension > 0.6 ? 'strain' : phase);
  } else {
    row.path.style.strokeWidth = '';
  }
  if (animateDraw && !reduced) {
    const len = row.path.getTotalLength();
    animeSet(row.path, { strokeDasharray: len, strokeDashoffset: len });
    animate(row.path, {
      strokeDashoffset: 0,
      duration: 420,
      ease: 'outQuart',
      onComplete: () => {
        row.path.style.strokeDasharray = '';
        row.path.style.strokeDashoffset = '';
      },
    });
  }
}

function drawPaths(): void {
  rows.forEach((row, i) => drawPath(row, i));
}

/* ============================================================ building the DOM */

function buildTiles(): void {
  DESTINATIONS.forEach((d, i) => {
    const li = document.createElement('li');
    li.className = 'ltp-dest';
    li.dataset.ltDest = d.id;
    li.innerHTML = `
      <span class="ltp-dest__grip" data-lt-grip aria-hidden="true"><i></i><i></i><i></i></span>
      <button class="ltp-tile lt-touch lt-focus-inset" type="button" aria-pressed="false" data-lt-pick="${d.id}">
        <span class="ltp-tile__name">${d.name}</span>
        <span class="ltp-tile__meta">
          <span data-lt-method>${METHOD_LABEL[d.method]}</span>
          <span class="ltp-tile__sep" aria-hidden="true">·</span>
          <span class="lt-num" data-lt-fmt>${d.preferred}</span>
        </span>
        <span class="lt-chip lt-chip--disconnected" data-lt-chip>
          <span class="lt-dot lt-dot--ring" data-lt-dot aria-hidden="true"></span>
          <span class="lt-chip__text">
            <span class="lt-chip__label" data-lt-label>${STATE_LABEL.DISCONNECTED}</span>
            <span class="lt-chip__status" data-lt-status>${METHOD_LABEL[d.method]}</span>
          </span>
        </span>
        <span class="ltp-tile__hint" data-lt-hint></span>
      </button>
      <span class="ltp-dest__slot" data-lt-slot></span>
      <span class="ltp-dest__ring" data-lt-ring>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="${RING_R}" data-lt-arc />
        </svg>
        <span class="ltp-dest__digit lt-num" data-lt-digit>${RETRY_SECONDS}</span>
      </span>
      <div class="ltp-keyrow" data-lt-keyrow hidden></div>
      <div class="ltp-errorslot" data-lt-errorslot></div>
    `;
    destList.append(li);

    const row: DestRow = {
      id: d.id,
      name: d.name,
      state: 'DISCONNECTED',
      attempt: 0,
      li,
      tile: $<HTMLButtonElement>('[data-lt-pick]', li)!,
      chip: $('[data-lt-chip]', li)!,
      dot: $('[data-lt-dot]', li)!,
      label: $('[data-lt-label]', li)!,
      status: $('[data-lt-status]', li)!,
      method: $('[data-lt-method]', li)!,
      fmt: $('[data-lt-fmt]', li)!,
      hint: $('[data-lt-hint]', li)!,
      slot: $('[data-lt-slot]', li)!,
      grip: $('[data-lt-grip]', li)!,
      ring: $('[data-lt-ring]', li)!,
      digit: $('[data-lt-digit]', li)!,
      arc: $<SVGCircleElement>('[data-lt-arc]', li)!,
      errorslot: $('[data-lt-errorslot]', li)!,
      keyrow: $('[data-lt-keyrow]', li)!,
      path: $<SVGPathElement>(`[data-lt-path="${d.id}"]`, signal)!,
      drag: null,
      nudge: { x: 0, y: 0 },
      tension: 0,
    };
    rows.push(row);

    row.tile.addEventListener('click', () => {
      interrupt();
      toggleDest(i);
    });
    row.tile.addEventListener('keydown', (e) => onTileKey(e, i));
  });
}

function buildShelf(): void {
  const trail = $('.ltp-shelf__trail', shelf)!;
  DESTINATIONS.forEach((d, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ltp-shelfcard lt-touch';
    card.setAttribute('aria-pressed', 'false');
    card.dataset.ltShelfpick = d.id;
    card.innerHTML = `
      <span class="ltp-shelfcard__name">${d.name}</span>
      <span class="lt-badge lt-badge--${METHOD_TONE[d.method]}">${METHOD_LABEL[d.method]}</span>
      <span class="lt-chip lt-chip--disconnected" data-lt-shelfchip>
        <span class="lt-dot lt-dot--ring" aria-hidden="true"></span>
        <span class="lt-chip__text"><span class="lt-chip__label">${STATE_LABEL.DISCONNECTED}</span></span>
      </span>
      ${d.note ? `<span class="ltp-shelfcard__note">${d.note}</span>` : ''}
    `;
    card.addEventListener('click', () => {
      interrupt();
      toggleDest(i);
    });
    shelf.insertBefore(card, trail);
  });
}

function momentName(m: MomentDef): string {
  return RENAME[intent.id]?.[m.id] ?? m.name;
}

function buildMoments(): void {
  MOMENTS.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lt-moment lt-touch';
    b.setAttribute('aria-pressed', String(m.id === momentId));
    b.dataset.ltMoment = m.id;
    const glyph =
      m.id === 'main-camera'
        ? 'i-camera'
        : m.id === 'screen-share'
          ? 'i-screen'
          : m.id === 'guest'
            ? 'i-users'
            : `m-${m.id}`;
    b.innerHTML = `
      <span class="lt-moment__icon lt-moment__icon--glyph">${icon(glyph, 24)}</span>
      <span class="lt-moment__name" data-lt-moment-name>${momentName(m)}</span>
      <span class="lt-moment__meta" data-lt-moment-meta>${i + 1}</span>
    `;
    b.addEventListener('click', () => {
      interrupt();
      setMoment(m.id);
    });
    momentStrip.append(b);
  });
}

function buildIntents(): void {
  INTENTS.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ltp-intent lt-touch';
    b.setAttribute('aria-pressed', 'false');
    b.dataset.ltIntent = it.id;
    b.dataset.scTilt = '5';
    b.innerHTML = `
      <span class="ltp-intent__head">${icon(`n-${it.id}`, 24)}<span class="ltp-intent__title">${it.title}</span></span>
      <span class="ltp-intent__tag">${it.tagline}</span>
      <ul class="ltp-intent__gets">${it.whatYouGet.map((g) => `<li>${g}</li>`).join('')}</ul>
    `;
    b.addEventListener('click', () => {
      interrupt();
      setIntent(it);
    });
    intentGrid.append(b);
  });
}

/** Six copies of each duplicated control, so "six of everything" is literal rather than said. */
function buildLattice(): void {
  $$('.ltp-dup', lattice).forEach((dup) => {
    const first = $('.ltp-dup__copy', dup)!;
    first.style.setProperty('--i', '0');
    for (let i = 1; i < 6; i++) {
      const copy = first.cloneNode(true) as HTMLElement;
      copy.style.setProperty('--i', String(i));
      $$('input', copy).forEach((input) => input.setAttribute('tabindex', '-1'));
      $$('button', copy).forEach((b) => b.setAttribute('tabindex', '-1'));
      dup.insertBefore(copy, first);
    }
  });
}

/* ================================================================ the surface */

const HEALTH: Record<string, string> = {
  Idle: 'unknown',
  Excellent: 'excellent',
  Fair: 'fair',
};

function statusFor(row: DestRow, d: (typeof DESTINATIONS)[number]): string {
  switch (row.state) {
    case 'DISCONNECTED':
      return METHOD_LABEL[d.method];
    case 'AUTHENTICATING':
      return `Waiting for ${d.name}`;
    case 'READY':
      return 'Goes live when you tap GO LIVE';
    case 'STARTING':
      return `Telling ${d.name} you are live`;
    case 'LIVE':
      return `${DEFAULT_HEIGHT}, ${aspectFor(d)}`;
    case 'DEGRADED':
      return 'The picture is arriving rough';
    case 'RECONNECTING':
      return `Attempt ${row.attempt} of ${MAX_ATTEMPTS}, retrying in ${RETRY_SECONDS} s`;
    case 'ENDED':
      return liveAt ? `Streamed ${mmss(Date.now() - liveAt)}` : 'Ended';
    default:
      return '';
  }
}

function aspectFor(d: (typeof DESTINATIONS)[number]): Format {
  return chooseAspect(intent.preference, d);
}

const CHIP_CLASS: Record<State, string> = {
  DISCONNECTED: 'disconnected',
  AUTHENTICATING: 'authenticating',
  READY: 'ready',
  STARTING: 'starting',
  LIVE: 'live',
  DEGRADED: 'degraded',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed',
  STOPPING: 'stopping',
  ENDED: 'ended',
};

/**
 * Paint one destination, and only that one.
 *
 * The peak's whole claim is that a break touches nothing else, so there is deliberately no
 * "repaint everything" path through the break sequence: a sibling's chip class, dot class and
 * pulse animation are never rewritten, so its halo never restarts and stays out of phase with
 * its neighbours exactly as it was.
 */
function paintDest(i: number): void {
  const row = rows[i]!;
  const d = DESTINATIONS[i]!;
  const chipClass = `lt-chip lt-chip--${CHIP_CLASS[row.state]}`;
  if (row.chip.className !== chipClass) row.chip.className = chipClass;

  const dotKind = DOT[row.state];
  const dotClass = `lt-dot${dotKind === 'ring' ? ' lt-dot--ring' : dotKind === 'pulse' ? ' lt-dot--pulse' : ''}`;
  if (row.dot.className !== dotClass) row.dot.className = dotClass;

  const label = STATE_LABEL[row.state];
  if (row.label.textContent !== label) row.label.textContent = label;

  const status = statusFor(row, d);
  if (row.status.textContent !== status) row.status.textContent = status;
  row.status.title = status;

  const fmt = aspectFor(d);
  if (row.fmt.textContent !== fmt) row.fmt.textContent = fmt;

  /* The state is published on the tile as well as drawn, so a test and a screen reader read
     the same thing the eye does. */
  row.li.dataset.ltState = row.state;
  const mine = row.state !== 'DISCONNECTED';
  row.li.classList.toggle('is-mine', mine);
  row.li.classList.toggle('is-reconnecting', row.state === 'RECONNECTING');
  row.tile.setAttribute('aria-pressed', String(mine));
  row.tile.setAttribute(
    'aria-label',
    `${d.name}, ${label}, ${METHOD_LABEL[d.method]}, demo destination`,
  );

  const shelfCard = $(`[data-lt-shelfpick="${d.id}"]`, shelf);
  if (shelfCard) {
    shelfCard.setAttribute('aria-pressed', String(mine));
    const chip = $('[data-lt-shelfchip]', shelfCard);
    if (chip) {
      chip.className = chipClass;
      const l = $('.lt-chip__label', chip);
      if (l) l.textContent = label;
      const dot = $('.lt-dot', chip);
      if (dot) dot.className = dotClass;
    }
  }

  drawPath(row, i);
}

function paintAll(): void {
  rows.forEach((_, i) => paintDest(i));
  paintReadouts();
  publish();
}

function liveCount(): number {
  return rows.filter((r) => r.state === 'LIVE' || r.state === 'DEGRADED' || r.state === 'RECONNECTING')
    .length;
}

function connected(): DestRow[] {
  return rows.filter((r) => r.state !== 'DISCONNECTED' && r.state !== 'ENDED');
}

function producedFormats(): Format[] {
  const set = new Set<Format>();
  connected().forEach((r) => {
    const d = DESTINATIONS.find((x) => x.id === r.id)!;
    set.add(aspectFor(d));
  });
  return Array.from(set);
}

function paintReadouts(): void {
  const n = connected().length;
  outDests.textContent = `${n} destination${n === 1 ? '' : 's'}`;
  const f = Math.max(1, producedFormats().length);
  outFormats.textContent = `${f} format${f === 1 ? '' : 's'}`;

  const anyLive = liveCount() > 0;
  const rough = rows.some((r) => r.state === 'DEGRADED' || r.state === 'RECONNECTING');
  const word = !anyLive ? 'Idle' : rough ? 'Fair' : 'Excellent';
  if (outHealth.textContent !== word) {
    outHealth.textContent = word;
    healthPill.className = `lt-pill lt-pill--${HEALTH[word]}`;
  }

  const ready = rows.filter((r) => r.state === 'READY' || r.state === 'ENDED').length;
  goliveSub.textContent = anyLive
    ? `Live on ${liveCount()}`
    : ready
      ? `Going live on ${ready}`
      : 'No destination is ready';
  if (!countdown) {
    goliveLabel.textContent = anyLive ? 'END' : 'GO LIVE (DEMO)';
    golive.classList.toggle('ltp-golive--end', anyLive);
    golive.setAttribute(
      'aria-label',
      anyLive
        ? `END the demo on ${liveCount()} destinations`
        : ready
          ? `GO LIVE on ${ready} demo destinations`
          : 'GO LIVE, no destination is ready yet',
    );
  }
  golive.setAttribute('aria-disabled', String(!ready && !anyLive));

  updateCounters();
  paintStateLine();
  paintFormatTable();
  if (pro) paintPro();
}

/** The largest type on the page is a sentence the surface is reporting about itself. */
function paintStateLine(): void {
  const live = rows.filter(
    (r) => r.state === 'LIVE' || r.state === 'DEGRADED' || r.state === 'RECONNECTING',
  );
  const ready = rows.filter((r) => r.state === 'READY');
  let line: string;
  if (live.length) line = `Live on ${names(live.map((r) => r.name))}`;
  else if (ready.length) line = `Ready on ${names(ready.map((r) => r.name))}`;
  else line = 'Nothing is connected yet.';
  if (stateLine.textContent !== line) stateLine.textContent = line;

  let detail: string;
  if (format === '1:1') {
    detail =
      'Square is the canvas you compose in. No destination here asks for it, so LIVETAP sends each one the shape it accepts.';
  } else if (connected().length) {
    detail = `${intent.title}. ${intent.tagline} ${producedFormats().join(' and ')} from one production.`;
  } else {
    detail = 'Tap a destination to open its own connection.';
  }
  if (stateDetail.textContent !== detail) stateDetail.textContent = detail;
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function paintFormatTable(): void {
  formatTable.textContent = DESTINATIONS.map((d) => `${d.name} ${aspectFor(d)}`).join('  ·  ');
}

/** The compact signature of what actually paints, for the verification harness. */
function publish(): void {
  const states = rows.map((r) => STATE_CODE[r.state]).join('');
  surface.dataset.scVerifyState = [
    format,
    states,
    momentId,
    chatLog.querySelectorAll('li:not(.ltp-chat__empty)').length,
    pro ? 'pro' : 'simple',
  ].join('|');
}

const holds = new Set<string>();
function hold(key: string, on: boolean): void {
  if (on) holds.add(key);
  else holds.delete(key);
  if (holds.size) surface.dataset.scVerifyHold = 'true';
  else delete surface.dataset.scVerifyHold;
}

/* ============================================================ format + Moments */

function setFormat(next: Format, announce = true): void {
  if (!FORMATS.includes(next)) return;
  format = next;
  $$('[data-lt-format-set]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.ltFormatSet === next)),
  );
  stage.dataset.ltFormat = next;
  shapeBadge.textContent = next;
  const sa = SAFE_AREAS[next];
  guidesBox.style.setProperty('--sa-t', String(sa.top));
  guidesBox.style.setProperty('--sa-r', String(sa.right));
  guidesBox.style.setProperty('--sa-b', String(sa.bottom));
  guidesBox.style.setProperty('--sa-l', String(sa.left));
  layout();
  paintGuides();
  applyMoment(true);
  paintReadouts();
  publish();
  note(`Shape ${next}`);
  if (announce) {
    const n = connected().length;
    say(
      sayDest,
      `Composing in ${next}. ${n} destination${n === 1 ? '' : 's'}, ${producedFormats().length || 1} format${producedFormats().length === 1 ? '' : 's'}.`,
    );
  }
}

/**
 * The safe-area guides.
 *
 * They are on while ADAPT is the act on screen, and they stay on in any shape but 16:9, which
 * is where the bottom 28% and the right 16% are the whole point. Everything they carry is also
 * in text, so they are `aria-hidden` decoration.
 */
let guidesAct = false;
function paintGuides(): void {
  guides.classList.toggle('is-on', guidesAct || format !== '16:9');
}

function setMoment(id: string, announce = true): void {
  const m = MOMENTS.find((x) => x.id === id);
  if (!m) return;
  if (m.id === 'screen-share' && !inputs.screen) {
    say(sayDest, 'Screen Share needs the screen switched on first.');
    return;
  }
  momentId = id;
  stage.dataset.ltActiveMoment = id;
  $$('[data-lt-moment]', momentStrip).forEach((b) => {
    const on = b.dataset.ltMoment === id;
    b.setAttribute('aria-pressed', String(on));
    const meta = $('[data-lt-moment-meta]', b);
    if (meta) {
      const i = MOMENTS.findIndex((x) => x.id === b.dataset.ltMoment);
      meta.textContent = on && liveCount() ? 'Live now' : String(i + 1);
    }
  });
  applyMoment();
  setInput('mic', !m.micMuted, false);
  publish();
  note(`Moment ${momentName(m)}`);
  if (announce) say(sayDest, `Moment: ${momentName(m)}.`);
}

/**
 * Where a layer sits, for the shape the stage is currently in.
 *
 * This mirrors `applyIntentToLayer()`: a text layer is always pushed inside the safe area, and
 * a camera layer is only pushed inside it where the product pushes it, which is the vertical
 * screen-share inset. Insetting a full-frame camera would letterbox a picture the product
 * deliberately re-crops, and it is how the stage came to render a pale rectangle with a border
 * on the first verification pass.
 */
function placement(layer: MomentDef['layers'][number]): Rect {
  const at = layer.at ?? { default: { x: 0, y: 0, w: 1, h: 1 } };
  const base = (format === '9:16' && at['9:16']) || at.default;
  if (layer.kind === 'text') return insetToSafeArea(base, format);
  if (layer.kind === 'camera' && momentId === 'screen-share' && format === '9:16') {
    return insetToSafeArea(base, format);
  }
  return base;
}

/**
 * The Moment's layers, placed for the current format through the product's own maths.
 *
 * The placement itself lands in one frame, because it is a layout change and layout changes are
 * not animated on this page. The motion is a transform-and-opacity settle staggered from the
 * middle outward, so the picture re-composes rather than sweeping.
 */
function applyMoment(reflow = false): void {
  const m = MOMENTS.find((x) => x.id === momentId)!;
  const live = new Map(m.layers.map((l) => [l.kind, l] as const));
  const active: HTMLElement[] = [];

  for (const kind of ['color', 'screen', 'camera', 'guest', 'text'] as const) {
    const el = $(`[data-lt-layer="${kind}"]`, canvas)!;
    const layer = live.get(kind);
    const on = !!layer && layer.visible !== false && hasInput(kind);
    el.classList.toggle('is-on', on);
    if (!on) continue;
    const r = placement(layer!);
    el.style.setProperty('--lx', String(r.x));
    el.style.setProperty('--ly', String(r.y));
    el.style.setProperty('--lw', String(r.w));
    el.style.setProperty('--lh', String(r.h));
    el.style.setProperty('--lr', String(layer!.radius ?? 0));
    if (kind === 'text') el.textContent = layer!.text ?? '';
    active.push(el);
  }

  if (reduced || !active.length) return;
  active.forEach((el) => ownsTransform(el));
  const mid = (active.length - 1) / 2;
  active.forEach((el, i) => {
    animate(el, {
      opacity: [0.4, 1],
      scale: [0.98, 1],
      duration: reflow ? 320 : m.ms,
      delay: Math.abs(i - mid) * 40,
      ease: 'cubicBezier(0.2, 0, 0, 1)',
      composition: 'none',
      onComplete: () => {
        el.style.opacity = '';
        el.style.scale = '';
        el.style.transform = '';
      },
    });
  });
}

function hasInput(kind: string): boolean {
  if (kind === 'camera') return inputs.camera;
  if (kind === 'screen') return inputs.screen;
  return true;
}

function setInput(which: 'camera' | 'mic' | 'screen', on: boolean, announce = true): void {
  inputs[which] = on;
  const word = which === 'mic' ? (on ? 'On' : 'Muted') : on ? 'On' : 'Off';
  const rowBtn = $(`[data-lt-input="${which}"]`);
  if (rowBtn) {
    rowBtn.setAttribute('aria-pressed', String(on));
    const s = $('[data-lt-input-state]', rowBtn);
    if (s) s.textContent = word;
  }
  const ind = $(`[data-lt-indicator="${which}"]`);
  if (ind) {
    ind.classList.toggle('is-on', on);
    const s = $('[data-lt-indicator-state]', ind);
    if (s) s.textContent = word;
  }
  if (which === 'mic') meter(on);
  applyMoment();
  publish();
  if (announce) say(sayDest, `${which === 'mic' ? 'Microphone' : which === 'camera' ? 'Camera' : 'Screen'} ${word.toLowerCase()}.`);
}

/* ================================================================= the meter */

let meterTimer: ReturnType<typeof setInterval> | null = null;
function meter(on: boolean): void {
  const fill = $('[data-lt-meter-fill]');
  const peakEl = $('[data-lt-meter-peak]');
  const wrap = $('[data-lt-meter]');
  if (!fill || !peakEl || !wrap) return;
  if (meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
  if (!on) {
    fill.style.inlineSize = '0%';
    wrap.setAttribute('role', 'meter');
    wrap.setAttribute('aria-valuenow', '0');
    return;
  }
  let peak = 0;
  wrap.setAttribute('role', 'meter');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  meterTimer = setInterval(() => {
    if (document.hidden) return;
    const v = Math.round(rng(28, 74, 0));
    peak = Math.max(peak * 0.96, v);
    fill.style.inlineSize = `${v}%`;
    peakEl.style.insetInlineStart = `${Math.min(99, peak)}%`;
    wrap.setAttribute('aria-valuenow', String(v));
  }, 220);
}

/* ================================================= the destination state machine */

/**
 * Every state change on this page goes through the product's own transition table.
 *
 * The table is mirrored in `data.ts` from `packages/core/src/destination/stateMachine.ts`, so a
 * move the product would refuse is refused here too, and the mirror is load-bearing rather than
 * decorative: a drift in the copy shows up as a demo that stops working, not as a comment that
 * stopped being true.
 */
function advance(i: number, event: string): boolean {
  const row = rows[i]!;
  const next = nextState(row.state, event);
  if (!next) return false;
  row.state = next;
  return true;
}


function toggleDest(i: number): void {
  const row = rows[i]!;
  const d = DESTINATIONS[i]!;
  if (row.state === 'DISCONNECTED') {
    if (d.method === 'key' && row.keyrow.hidden) {
      openKeyRow(row, d, i);
      return;
    }
    connect(i);
  } else if (row.state === 'READY' || row.state === 'AUTHENTICATING' || row.state === 'ENDED') {
    if (!advance(i, 'DISCONNECT')) return;
    row.keyrow.hidden = true;
    row.keyrow.replaceChildren();
    paintDest(i);
    paintReadouts();
    publish();
    note(`${d.name} not connected`);
    say(sayDest, `${d.name} is not connected.`);
  }
}

/** The app's own paste-a-key flow, one row tall, opened in place. */
function openKeyRow(row: DestRow, d: (typeof DESTINATIONS)[number], i: number): void {
  row.keyrow.hidden = false;
  const id = `key-${d.id}`;
  row.keyrow.innerHTML = `
    <span class="lt-field">
      <label class="lt-field__label" for="${id}">Stream key</label>
      <input class="lt-input lt-input--mono lt-touch" id="${id}" value="${DEMO_TARGET}" aria-describedby="${id}-hint" />
      <span class="lt-field__hint" id="${id}-hint">A demo value. ${d.note}</span>
      <span class="lt-field__error" data-lt-keyerror hidden>${icon('i-alert', 20)}Paste the key from ${d.name} first.</span>
    </span>
    <button class="lt-btn lt-btn--secondary lt-btn--sm lt-touch" type="button" data-lt-keygo>Use this key</button>
  `;
  const input = $<HTMLInputElement>('input', row.keyrow)!;
  const err = $('[data-lt-keyerror]', row.keyrow)!;
  $('[data-lt-keygo]', row.keyrow)!.addEventListener('click', () => {
    if (!input.value.trim()) {
      err.hidden = false;
      input.classList.add('lt-input--invalid');
      return;
    }
    row.keyrow.hidden = true;
    row.keyrow.replaceChildren();
    connect(i);
  });
  input.focus();
}

function connect(i: number): void {
  const row = rows[i]!;
  const d = DESTINATIONS[i]!;
  if (!advance(i, 'CONNECT')) return;
  paintDest(i);
  paintReadouts();
  publish();
  note(`${d.name} signing in`);
  window.setTimeout(
    () => {
      if (row.state !== 'AUTHENTICATING') return;
      advance(i, 'AUTH_OK');
      paintDest(i);
      drawPath(row, i, true);
      paintReadouts();
      publish();
      note(`${d.name} ready`);
      say(sayDest, `${d.name} is ready.`);
      tourCheck();
    },
    d.method === 'connect' ? 900 : 1400,
  );
}

/* ================================================================== GO LIVE */

let countdown: ReturnType<typeof createTimer> | null = null;

function goLive(): void {
  if (countdown) {
    cancelGoLive();
    return;
  }
  if (liveCount() > 0) {
    endAll();
    return;
  }
  const ready = rows.filter((r) => r.state === 'READY' || r.state === 'ENDED');
  if (!ready.length) {
    say(sayBroadcast, 'No destination is ready. Pick one first.');
    return;
  }
  golive.classList.add('lt-golive--countdown');
  goliveCount.hidden = false;
  goliveCancel.hidden = false;
  goliveLabel.hidden = true;
  say(sayBroadcast, 'Going live in 3 seconds. Press Escape to cancel.');

  let shown = 0;
  countdown = createTimer({
    duration: 3000,
    onUpdate: (self) => {
      const left = Math.ceil((3000 - self.currentTime) / 1000);
      if (left !== shown && left > 0) {
        shown = left;
        goliveCount.textContent = String(left);
      }
    },
    onComplete: () => {
      countdown = null;
      golive.classList.remove('lt-golive--countdown');
      goliveCount.hidden = true;
      goliveCancel.hidden = true;
      goliveLabel.hidden = false;
      startAll();
    },
  });
}

function cancelGoLive(): void {
  if (!countdown) return;
  countdown.revert();
  countdown = null;
  golive.classList.remove('lt-golive--countdown');
  goliveCount.hidden = true;
  goliveCancel.hidden = true;
  goliveLabel.hidden = false;
  say(sayBroadcast, 'Cancelled. You are not live.');
  note('Countdown cancelled');
}

function startAll(): void {
  const ready = rows
    .map((r, i) => [r, i] as const)
    .filter(([r]) => r.state === 'READY' || r.state === 'ENDED');
  ready.forEach(([r, i]) => {
    if (r.state === 'ENDED') advance(i, 'RESET');
    advance(i, 'START');
    paintDest(i);
  });
  paintReadouts();
  publish();
  say(sayBroadcast, `Going live on ${ready.length} destinations.`);
  window.setTimeout(() => {
    /* Every path lights in the same frame: a coordinated broadcast is the claim, so staggering
       them would say the opposite. */
    ready.forEach(([, i]) => {
      advance(i, 'STREAM_UP');
      paintDest(i);
    });
    if (!liveAt) startClock();
    paintReadouts();
    publish();
    startChat();
    setMoment(momentId, false);
    note('Live');
    say(sayBroadcast, `You are live on ${names(ready.map(([r]) => r.name))}.`);
    tourCheck();
  }, 600);
}

/** END stops the demo session honestly: every live destination goes through STOPPING. */
function endAll(): void {
  const live = rows
    .map((r, i) => [r, i] as const)
    .filter(([r]) => r.state === 'LIVE' || r.state === 'DEGRADED' || r.state === 'RECONNECTING');
  if (!live.length) return;
  live.forEach(([, i]) => {
    advance(i, 'STOP');
    paintDest(i);
  });
  paintReadouts();
  publish();
  say(sayBroadcast, 'Ending on every destination.');
  window.setTimeout(() => {
    live.forEach(([r, i]) => {
      advance(i, 'STOPPED');
      r.errorslot.replaceChildren();
      paintDest(i);
    });
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    chatOn = false;
    paintReadouts();
    publish();
    note('Ended');
    say(sayBroadcast, 'You are not live any more.');
  }, 600);
}

function startClock(): void {
  liveAt = Date.now();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const t = mmss(Date.now() - liveAt);
    outClock.textContent = t;
    outClock.setAttribute('aria-label', `Live for ${Math.floor((Date.now() - liveAt) / 60000)} minutes`);
  }, 1000);
}

/* ========================================== the signature move: drag to disconnect */

function threshold(): number {
  return 168 * Math.min(1, innerWidth / 1440);
}

function setTension(row: DestRow, i: number, t: number): void {
  row.tension = Math.max(0, Math.min(1, t));
  row.li.style.setProperty('--lt-tension', row.tension.toFixed(3));
  drawPath(row, i);
}

let peakArmed = false;

function armPeak(on: boolean): void {
  peakArmed = on;
  rows.forEach((row, i) => {
    const live = row.state === 'LIVE';
    const armed = on && live;
    row.li.classList.toggle('is-armed', armed);
    row.li.classList.toggle('is-draggable', armed && !reduced);
    if (armed && !row.slot.firstChild) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lt-iconbtn lt-iconbtn--md lt-iconbtn--secondary lt-touch';
      b.setAttribute('aria-label', `Drop ${row.name} from the stage`);
      b.innerHTML = icon('i-x', 20);
      b.addEventListener('click', () => {
        interrupt();
        breakDest(i);
      });
      row.slot.append(b);
      row.hint.textContent = reduced
        ? 'Press Delete to drop it'
        : wide.matches
          ? 'Drag me off the stage'
          : 'Drag me off';
      row.tile.setAttribute('aria-keyshortcuts', 'Delete');
    }
    if (!armed) {
      row.slot.replaceChildren();
      row.hint.textContent = '';
      row.tile.removeAttribute('aria-keyshortcuts');
    }
    if (armed && !reduced && !row.drag) {
      /* Only the 44px grip starts a drag, so the rest of the tile stays a normal button, and
         anime's own 7px of touch slop keeps a vertical flick scrolling the page. */
      row.drag = createDraggable(row.li, {
        trigger: row.grip,
        container: surface as HTMLElement,
        containerFriction: 0.35,
        containerPadding: 0,
        dragSpeed: 0.92,
        releaseEase: spring({ stiffness: 150, damping: 18 }),
        velocityMultiplier: 1,
        onGrab: () => {
          row.li.style.willChange = 'transform';
          row.li.style.zIndex = '5';
        },
        onDrag: (self) => {
          const d = Math.hypot(self.x, self.y);
          setTension(row, i, d / threshold());
          if (row.tension >= 1 && row.state === 'LIVE') {
            row.drag?.disable();
            breakDest(i);
          }
        },
        onRelease: () => {
          if (row.tension < 1) say(sayDest, `${row.name} held on. Still live.`);
        },
        onSettle: () => {
          row.li.style.willChange = '';
          row.li.style.zIndex = '';
          setTension(row, i, 0);
        },
      });
    }
    if ((!armed || reduced) && row.drag) {
      row.drag.revert();
      row.drag = null;
    }
  });
}

function onTileKey(e: KeyboardEvent, i: number): void {
  const row = rows[i]!;
  if (row.state !== 'LIVE') return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    interrupt();
    breakDest(i);
    return;
  }
  if (e.key === 'Escape') {
    row.nudge = { x: 0, y: 0 };
    row.li.style.translate = '';
    setTension(row, i, 0);
    return;
  }
  const step = 24;
  const move: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = move[e.key];
  if (!delta) return;
  e.preventDefault();
  interrupt();
  row.nudge.x += delta[0];
  row.nudge.y += delta[1];
  row.li.style.translate = `${row.nudge.x}px ${row.nudge.y}px`;
  const d = Math.hypot(row.nudge.x, row.nudge.y);
  setTension(row, i, d / threshold());
  if (d >= threshold()) breakDest(i);
}

/**
 * The break, and the four things that happen.
 *
 * Nothing in here touches a sibling. There is no repaint-everything call, no re-sort and no
 * re-layout of the destination row, which is what makes the claim the act exists to make
 * checkable rather than merely intended.
 */
function breakDest(i: number, degradeMs = 700): void {
  const row = rows[i]!;
  const d = DESTINATIONS[i]!;
  if (row.state !== 'LIVE' && row.state !== 'DEGRADED') return;
  row.drag?.disable();
  note(`${d.name} lost the connection`);
  say(sayBroadcast, `${d.name} stopped accepting the picture. Your other destinations are not affected.`);

  const toReconnecting = (): void => {
    if (!advance(i, 'STREAM_LOST')) return;
    row.attempt = 1;
    paintDest(i);
    paintReadouts();
    publish();
    openErrorCard(row, d, i);
    countRing(row, () => heal(row, i));
  };

  if (reduced) {
    /* `DEGRADED` is skipped: a 700ms intermediate state with no motion is a flicker. */
    toReconnecting();
    return;
  }

  advance(i, 'STREAM_DEGRADED');
  paintDest(i);
  paintReadouts();
  publish();
  snapPath(row, i);
  window.setTimeout(toReconnecting, degradeMs);
}

/** The path is cut at the tension point: the stage-side segment recoils, the tile side goes. */
function snapPath(row: DestRow, i: number): void {
  const len = row.path.getTotalLength();
  animeSet(row.path, { strokeDasharray: `${len}`, strokeDashoffset: 0 });
  animate(row.path, {
    strokeDashoffset: [0, len * 0.92],
    duration: 220,
    ease: 'outQuart',
  });
  const p = port(i);
  const ring = document.createElement('span');
  ring.className = 'ltp-portflash';
  ring.style.setProperty('--px', `${p.x}px`);
  ring.style.setProperty('--py', `${p.y}px`);
  interaction.append(ring);
  animate(ring, {
    opacity: [1, 0],
    scale: [1, 1.6],
    duration: 120,
    onComplete: () => ring.remove(),
  });
}

function countRing(row: DestRow, done: () => void): void {
  row.arc.style.strokeDasharray = String(RING_C);
  let announced = false;
  if (reduced) {
    row.arc.style.strokeDashoffset = '0';
  } else {
    animate(row.arc, {
      strokeDashoffset: [0, RING_C],
      duration: RETRY_SECONDS * 1000,
      ease: 'linear',
    });
  }
  createTimer({
    duration: RETRY_SECONDS * 1000,
    onUpdate: (self) => {
      const left = Math.max(0, Math.ceil(RETRY_SECONDS - self.currentTime / 1000));
      if (row.digit.textContent !== String(left)) row.digit.textContent = String(left);
      if (!announced) {
        announced = true;
        say(sayDest, `Reconnecting. Attempt 1 of ${MAX_ATTEMPTS}, retrying in ${RETRY_SECONDS} seconds.`);
      }
    },
    onComplete: done,
  });
}

function heal(row: DestRow, i: number): void {
  advance(i, 'STREAM_UP');
  row.attempt = 0;
  row.nudge = { x: 0, y: 0 };
  paintDest(i);
  paintReadouts();
  publish();
  row.errorslot.replaceChildren();
  drawPath(row, i, true);
  const home = (): void => {
    row.drag?.revert();
    row.drag = null;
    row.li.style.translate = '';
    row.li.style.transform = '';
    drawPath(row, i);
    if (peakArmed) armPeak(true);
  };
  if (!reduced) {
    animate(row.li, {
      x: 0,
      y: 0,
      duration: 420,
      ease: spring({ stiffness: 150, damping: 18 }),
      onComplete: home,
    });
  } else {
    home();
  }
  note(`${row.name} live again`);
  say(sayBroadcast, `${row.name} is live again.`);
  tourDone('break');
}

/** The app's four fields, one primary action, beside the tile it belongs to. */
function openErrorCard(row: DestRow, d: (typeof DESTINATIONS)[number], i: number): void {
  row.errorslot.innerHTML = `
    <div class="lt-errorcard lt-errorcard--warning">
      <div class="lt-errorcard__head">
        <span class="lt-errorcard__icon">${icon('i-alert', 24)}</span>
        <p class="lt-errorcard__what" role="alert">${d.name} stopped accepting the picture.</p>
      </div>
      <dl class="lt-errorcard__list">
        <dt class="lt-errorcard__term">Why</dt>
        <dd class="lt-errorcard__desc">The connection to ${d.name} dropped. Your other destinations are not affected.</dd>
        <dt class="lt-errorcard__term">Doing</dt>
        <dd class="lt-errorcard__desc">LIVETAP is reconnecting on its own. Attempt 1 of ${MAX_ATTEMPTS}.</dd>
        <dt class="lt-errorcard__term">You can</dt>
        <dd class="lt-errorcard__desc">Wait for it, or stop this destination and keep the others live.</dd>
      </dl>
      <div class="lt-errorcard__actions">
        <button class="lt-btn lt-btn--secondary lt-btn--sm lt-touch" type="button" data-lt-stopone>Stop this destination</button>
      </div>
    </div>
  `;
  $('[data-lt-stopone]', row.errorslot)!.addEventListener('click', () => {
    advance(i, 'STOP');
    advance(i, 'STOPPED');
    paintDest(i);
    paintReadouts();
    publish();
    row.errorslot.replaceChildren();
    note(`${d.name} stopped`);
    say(sayBroadcast, `${d.name} stopped. The others are still live.`);
  });
}

/* ===================================================================== chat */

let chatOn = false;
let chatVisible = true;
let chatTimer: ReturnType<typeof setTimeout> | null = null;

function startChat(): void {
  if (chatOn) return;
  chatOn = true;
  chatEmpty.remove();
  for (let i = 0; i < 4; i++) addMessage(i * (reduced ? 0 : 60));
  scheduleChat();
}

function scheduleChat(): void {
  if (chatTimer) clearTimeout(chatTimer);
  if (!chatOn) return;
  const wait = reduced ? 2600 : Math.round(rng(1400, 3200, 0));
  chatTimer = setTimeout(() => {
    if (chatOn && chatVisible && !document.hidden) addMessage(0);
    scheduleChat();
  }, wait);
}

function addMessage(delay: number): void {
  const withChat = connected().filter((r) => CHAT_PLATFORMS.includes(r.id));
  const from = withChat.length ? pick(withChat).name : pick(['YouTube', 'Twitch', 'Facebook']);
  const badge = pick(CHAT_BADGES);
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="ltp-chat__who">
      <span class="ltp-chat__name">${pick(CHAT_NAMES)}</span>
      <span class="lt-badge lt-badge--neutral">${from}</span>
      ${badge ? `<span class="lt-badge lt-badge--neutral">${badge}</span>` : ''}
      <span class="lt-badge lt-badge--info">Demo</span>
    </span>${pick(CHAT_MESSAGES)}
  `;
  chatLog.append(li);
  while (chatLog.children.length > 40) chatLog.firstElementChild?.remove();
  const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
  if (!reduced) {
    animate(li, {
      opacity: [0, 1],
      translateY: [6, 0],
      duration: 200,
      delay,
      ease: 'cubicBezier(0.2, 0, 0, 1)',
      onComplete: () => {
        li.style.opacity = '';
        li.style.transform = '';
      },
    });
  }
  if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  publish();
}

/* ==================================================================== Pro mode */

function paintPro(): void {
  const conn = connected();
  const m = MOMENTS.find((x) => x.id === momentId)!;
  const rowsOut: Array<[string, string, string[]]> = [
    [
      'quality',
      'Quality',
      [DEFAULT_QUALITY_LABEL, 'Derived from your connection and your machine. Never asked.'],
    ],
    [
      'ceiling',
      'What each platform accepts',
      (conn.length ? conn : rows).map((r) => {
        const d = DESTINATIONS.find((x) => x.id === r.id)!;
        return `${d.name} ${d.ceilingMbps} Mbps at ${aspectFor(d)}`;
      }),
    ],
    [
      'audio',
      'Audio',
      [
        `Microphone ${inputs.mic ? 'on' : 'muted'}`,
        `Computer audio ${m.id === 'screen-share' ? 'on, balanced under your mic' : 'off'}`,
      ],
    ],
    ['log', 'This session', log.length ? log : ['Nothing has happened yet.']],
  ];
  rowsOut.forEach(([key, title, lines]) => {
    const el = $(`[data-lt-prorow="${key}"]`);
    if (!el) return;
    el.innerHTML = `
      <span class="ltp-prorow__title">${title}</span>
      <div class="ltp-prorow__lines">${lines
        .map((l) => `<span class="${key === 'log' ? 'lt-mono' : ''}">${l}</span>`)
        .join('')}</div>
    `;
  });
}

function setPro(on: boolean): void {
  pro = on;
  proToggle.setAttribute('aria-checked', String(on));
  proLayers.hidden = !on;
  if (on) {
    paintPro();
    const panels = $$('[data-lt-prorow]', proLayers).filter(
      (p) => getComputedStyle(p).display !== 'none',
    );
    if (!reduced) {
      panels.forEach((p, i) =>
        animate(p, {
          opacity: [0, 1],
          duration: 200,
          delay: i * 60,
          ease: 'cubicBezier(0.2, 0, 0, 1)',
          onComplete: () => {
            p.style.opacity = '';
          },
        }),
      );
    }
    say(sayDest, `Pro shown. ${panels.length} panel${panels.length === 1 ? '' : 's'} added. Nothing moved.`);
    tourDone('pro');
  } else {
    say(sayDest, 'Pro hidden.');
  }
  publish();
}

/* ================================================================= the intent */

function setIntent(next: IntentDef): void {
  intent = next;
  $$('[data-lt-intent]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.ltIntent === next.id)),
  );
  $$('[data-lt-moment]', momentStrip).forEach((b) => {
    const m = MOMENTS.find((x) => x.id === b.dataset.ltMoment);
    const nameEl = $('[data-lt-moment-name]', b);
    if (m && nameEl) nameEl.textContent = momentName(m);
  });
  openLink.href = `./app/start?intent=${next.id}`;
  setFormat(next.master, false);
  if (next.firstMoment !== 'screen-share' || inputs.screen) setMoment(next.firstMoment, false);
  paintAll();
  note(`${next.title} chosen`);
  say(sayDest, `${next.title}. ${next.tagline} Composing in ${format}.`);
  tourDone('intent');
}

/* ===================================================================== counters */

/**
 * The two counters carry real, computed values.
 *
 * The engine reads `data-sc-count` once at mount, so the targets are updated through the
 * instance API it publishes for exactly this kind of page rather than by editing the engine or
 * by re-mounting it.
 */
function updateCounters(): void {
  const n = connected().length;
  const f = producedFormats().length;
  const wrap = $('[data-lt-countwrap]');
  if (wrap) wrap.classList.toggle('is-empty', n === 0);
  const inst = window.ScrollCraft?.instances?.[0] as
    | { acts: Array<{ counts?: Array<{ el: HTMLElement; b: number; tpl: string }> }> }
    | undefined;
  if (!inst) return;
  for (const act of inst.acts) {
    for (const k of act.counts ?? []) {
      const which = k.el.dataset.ltCount;
      const target = which === 'dests' ? n : f;
      k.b = target;
      k.tpl = String(target);
    }
  }
}

/* ================================================================ the atmosphere */

function mountAtmosphere(): void {
  const el = $<HTMLCanvasElement>('[data-lt-atmos]');
  if (!el) return;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const bands = Array.from({ length: 9 }, (_, i) => ({ y: rng(0, 1, 3), s: 0.5 + i * 0.06 }));
  const carriers = Array.from({ length: 24 }, () => ({ t: rng(0, 1, 3), lane: Math.floor(rng(0, 5, 0)) }));
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;
  const ink = getComputedStyle(document.body).color;

  const size = (): void => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = el.getBoundingClientRect();
    w = Math.round(r.width);
    h = Math.round(r.height);
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frameFn = (t: number): void => {
    raf = requestAnimationFrame(frameFn);
    if (t - last < 33) return; /* 30 fps cap, by an accumulator rather than by hope */
    const dt = (t - last) / 1000;
    last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.025;
    ctx.fillStyle = ink;
    for (const b of bands) {
      b.y -= (4 / Math.max(h, 1)) * dt * b.s;
      if (b.y < 0) b.y += 1;
      ctx.fillRect(0, Math.round(b.y * h), w, 1);
    }
    ctx.globalAlpha = 0.03;
    for (const c of carriers) {
      c.t += (12 / Math.max(w, 1)) * dt;
      if (c.t > 1) c.t -= 1;
      const y = h * (0.2 + c.lane * 0.15);
      ctx.fillRect(Math.round(c.t * w), Math.round(y), 2, 2);
    }
    ctx.globalAlpha = 1;
  };

  const start = (): void => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frameFn);
  };
  const stop = (): void => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  size();
  start();
  new IntersectionObserver((e) => (e[0]?.isIntersecting ? start() : stop())).observe(surface);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  let deb = 0;
  addEventListener(
    'resize',
    () => {
      clearTimeout(deb);
      deb = window.setTimeout(size, 150);
    },
    { passive: true },
  );
}

/* ====================================================== the hero automatic story */

type Step = [number, () => void];

let storyTimer: ReturnType<typeof createTimer> | null = null;
let storyDead = false;
let lastAction = Date.now();

function storySteps(): Step[] {
  const ids = phone.matches ? ['youtube', 'twitch'] : ['youtube', 'twitch', 'tiktok'];
  const at = (id: string) => rows.findIndex((r) => r.id === id);
  const full: Step[] = [
    [0, () => setMoment('main-camera', false)],
    [900, () => setInput('camera', true, false)],
    [1600, () => setInput('mic', true, false)],
    [2300, () => setInput('screen', true, false)],
    ...ids.map((id, k): Step => [3000 + k * 700, () => storyConnect(at(id))]),
    [5400, () => paintReadouts()],
    [6200, () => paintReadouts()],
    [7000, () => goLive()],
    [10600, () => paintReadouts()],
    [11400, () => startChat()],
    /* Step 14 to 17: one destination degrades, the others hold for 3 s, then it reconnects on
       a visible countdown and comes back. The DEGRADED beat is longer here than a visitor's own
       break, because step 15's content is the ABSENCE of change on the other two. */
    [14000, () => storyDegrade(at(ids[0]!))],
  ];
  return full;
}

function storyConnect(i: number): void {
  if (i < 0) return;
  const row = rows[i]!;
  if (row.state !== 'DISCONNECTED') return;
  advance(i, 'CONNECT');
  advance(i, 'AUTH_OK');
  paintDest(i);
  drawPath(row, i, true);
  paintReadouts();
  publish();
}

function storyDegrade(i: number): void {
  if (i < 0) return;
  breakDest(i, 3000);
}

const STORY_END = 22400;
const STORY_LOOP_FROM = 3000;

function mountStory(): void {
  const steps = storySteps();
  let fired = new Set<number>();
  let base = 0;
  storyTimer = createTimer({
    duration: 1e7,
    onUpdate: (self) => {
      if (storyDead) return;
      const local = self.currentTime - base;
      steps.forEach(([t, fn], k) => {
        if (!fired.has(k) && local >= t) {
          fired.add(k);
          fn();
        }
      });
      if (local >= STORY_END + 6000) {
        /* Hold the resolved state for six seconds, then resume from the destinations rather
           than from the camera: re-running the switch-on would look like a reboot. */
        if (Date.now() - lastAction > 45000) {
          storyDead = true;
          return;
        }
        base = self.currentTime - STORY_LOOP_FROM;
        fired = new Set(steps.map((_, k) => k).filter((k) => steps[k]![0] < STORY_LOOP_FROM));
        rows.forEach((r, i) => {
          if (r.state === 'LIVE' || r.state === 'DEGRADED' || r.state === 'RECONNECTING') {
            advance(i, 'STOP');
            advance(i, 'STOPPED');
            advance(i, 'DISCONNECT');
            paintDest(i);
          }
        });
        paintReadouts();
      }
    },
  });

  new IntersectionObserver((e) => {
    if (storyDead) return;
    if (e[0]?.isIntersecting) storyTimer?.play();
    else storyTimer?.pause();
  }).observe(surface);
}

/** Any visitor action cancels the story immediately and permanently. */
function interrupt(): void {
  lastAction = Date.now();
  if (storyDead) return;
  storyDead = true;
  storyTimer?.pause();
}

/* ====================================================================== the tour */

const TOUR: Array<{ key: string; prompt: string; target: string }> = [
  { key: 'pick', prompt: 'Pick two destinations.', target: '#act-connect' },
  { key: 'moment', prompt: 'Switch what viewers see.', target: '#act-produce' },
  { key: 'shape', prompt: 'Change the shape.', target: '#act-formats' },
  { key: 'live', prompt: 'Go live.', target: '#act-live' },
  { key: 'break', prompt: 'Break it. Drag a live destination off the stage.', target: '#act-break' },
  { key: 'pro', prompt: 'Look underneath.', target: '#act-pro' },
  { key: 'intent', prompt: 'Tell LIVETAP what you are making.', target: '#act-start' },
];

const tourDoneKeys = new Set<string>();
let tourPanel: HTMLElement | null = null;

function openTour(): void {
  if (tourPanel) {
    closeTour();
    return;
  }
  tourPanel = document.createElement('section');
  tourPanel.className = 'ltp-tour';
  tourPanel.setAttribute('role', 'region');
  tourPanel.setAttribute('aria-label', 'Guided tour');
  tourPanel.innerHTML = `
    <div class="ltp-tour__head">
      <span class="ltp-tour__title">See how LIVETAP works</span>
      <button class="lt-iconbtn lt-iconbtn--md lt-touch" type="button" aria-label="Close the guided tour" data-lt-tour-close>${icon('i-x', 20)}</button>
    </div>
    <ul class="ltp-tour__list" data-lt-tour-list>
      ${TOUR.map(
        (s) => `<li class="ltp-tour__step" data-lt-step="${s.key}">
          ${icon('i-check', 20)}
          <span>${s.prompt}<a class="ltp-tour__go" href="${s.target}">Take me there</a></span>
        </li>`,
      ).join('')}
    </ul>
  `;
  interaction.append(tourPanel);
  $('[data-lt-tour-close]', tourPanel)!.addEventListener('click', closeTour);
  $('[data-lt-tour-open]')!.setAttribute('aria-expanded', 'true');
  paintTour();
}

function closeTour(): void {
  tourPanel?.remove();
  tourPanel = null;
  const opener = $<HTMLButtonElement>('[data-lt-tour-open]');
  opener?.setAttribute('aria-expanded', 'false');
  opener?.focus();
}

function paintTour(): void {
  if (!tourPanel) return;
  $$('[data-lt-step]', tourPanel).forEach((li) =>
    li.classList.toggle('is-done', tourDoneKeys.has(li.dataset.ltStep ?? '')),
  );
}

function tourDone(key: string): void {
  if (tourDoneKeys.has(key)) return;
  tourDoneKeys.add(key);
  paintTour();
  const step = TOUR.find((s) => s.key === key);
  if (step) say(sayTour, `Done: ${step.prompt}`);
}

function tourCheck(): void {
  if (rows.filter((r) => r.state !== 'DISCONNECTED').length >= 2) tourDone('pick');
  if (momentId !== 'main-camera') tourDone('moment');
  if (format !== '16:9') tourDone('shape');
  if (liveCount() > 0) tourDone('live');
}

/* ============================================================ wiring, then mount */

function wire(): void {
  golive.addEventListener('click', () => {
    interrupt();
    goLive();
  });

  $$('[data-lt-format-set]').forEach((b) => {
    b.addEventListener('click', () => {
      interrupt();
      const next = b.dataset.ltFormatSet as Format;
      /* The tour step is "change the shape", so re-selecting the shape that is already on does
         not complete it. A tour that ticks itself off is a funnel, not a description. */
      const changed = next !== format;
      setFormat(next);
      if (changed) tourDone('shape');
    });
    b.addEventListener('keydown', (e) => {
      const order = FORMATS;
      const at = order.indexOf(b.dataset.ltFormatSet as Format);
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % order.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at + order.length - 1) % order.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = order.length - 1;
      if (next < 0) return;
      e.preventDefault();
      interrupt();
      const changed = order[next] !== format;
      setFormat(order[next]!);
      $<HTMLButtonElement>(`[data-lt-format-set="${order[next]}"]`)?.focus();
      if (changed) tourDone('shape');
    });
  });

  $$('[data-lt-input]').forEach((b) =>
    b.addEventListener('click', () => {
      interrupt();
      const which = b.dataset.ltInput as 'camera' | 'mic' | 'screen';
      setInput(which, b.getAttribute('aria-pressed') !== 'true');
    }),
  );

  proToggle.addEventListener('click', () => {
    interrupt();
    setPro(proToggle.getAttribute('aria-checked') !== 'true');
  });

  $('[data-lt-tour-open]')!.addEventListener('click', () => openTour());

  /* The six duplicated GO LIVE buttons can be pressed, and they report what they cannot do. */
  const dupSay = $('[data-lt-dupsay]')!;
  lattice.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-lt-dupgolive]');
    if (!b) return;
    dupSay.textContent = 'This one is not connected to anything.';
  });

  /* The theme toggle, the app's own key. */
  const theme = $<HTMLButtonElement>('[data-lt-theme]')!;
  const paintTheme = (): void => {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    theme.classList.toggle('is-light', !dark);
    theme.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  };
  theme.addEventListener('click', () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'dark' : 'light');
    try {
      localStorage.setItem('livetap.theme', light ? 'dark' : 'light');
    } catch {
      /* Private mode. The choice holds for this visit and nothing is stored. */
    }
    paintTheme();
  });
  paintTheme();

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (countdown) cancelGoLive();
      else if (tourPanel) closeTour();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key >= '1' && e.key <= '6') {
      interrupt();
      setMoment(MOMENTS[Number(e.key) - 1]!.id);
    }
    if (e.key === 'm' || e.key === 'M') {
      interrupt();
      setInput('mic', !inputs.mic);
    }
  });

  addEventListener('scroll', () => {
    lastAction = Date.now();
  }, { passive: true });

  let deb = 0;
  addEventListener(
    'resize',
    () => {
      clearTimeout(deb);
      deb = window.setTimeout(layout, 120);
    },
    { passive: true },
  );

  new IntersectionObserver((e) => {
    chatVisible = !!e[0]?.isIntersecting;
  }).observe(chatPanel);
}

function closing(on: boolean): void {
  hold('close', on);
  surface.classList.toggle('is-closing', on);
}

/** Scroll thresholds, the one way Anime.js is allowed to know about scroll on this page. */
function observeActs(): void {
  const act1 = $('#act-stage')!;
  const span1 = Number(act1.dataset.scSpan) || 1.3;
  const pctOf = (span: number, p: number) => (((span - 1) * p) / span) * 100;

  onScroll({
    target: act1,
    enter: `top ${pctOf(span1, 0.35).toFixed(2)}%`,
    leave: 'top 100%',
    repeat: true,
    onEnterForward: () => lattice.classList.add('is-settled'),
    onLeaveBackward: () => lattice.classList.remove('is-settled'),
  });

  onScroll({
    target: act1,
    enter: `top ${pctOf(span1, 0.82).toFixed(2)}%`,
    leave: 'top 100%',
    repeat: true,
    onEnterForward: () => {
      lattice.classList.add('is-gone');
      surface.classList.remove('is-collapsing');
    },
    onLeaveBackward: () => {
      lattice.classList.remove('is-gone');
      surface.classList.add('is-collapsing');
    },
  });

  /* Scrolling into CONNECT hands the surface over: whatever the story made is kept. */
  onScroll({
    target: $('#act-connect')!,
    enter: 'center top',
    leave: 'start end',
    repeat: false,
    onEnter: () => interrupt(),
  });

  onScroll({
    target: $('#act-formats')!,
    enter: 'center top',
    leave: 'start end',
    repeat: true,
    onEnter: () => {
      guidesAct = true;
      paintGuides();
    },
    onLeave: () => {
      guidesAct = false;
      paintGuides();
    },
  });

  /*
   * The peak arms as ACT 6's own travel begins, not when its stage becomes visible.
   *
   * A pinned stage is on screen for a viewport before its progress leaves 0, and that viewport
   * is REST B: arming on visibility would put "Drag me off the stage" into the page's authored
   * silence, which is the one act whose content is the absence of anything happening.
   */
  const act6 = $('#act-break')!;
  const span6 = Number(act6.dataset.scSpan) || 2.8;
  onScroll({
    target: act6,
    enter: `top ${pctOf(span6, 0.02).toFixed(2)}%`,
    leave: 'start end',
    repeat: true,
    onEnterForward: () => armPeak(true),
    onEnterBackward: () => armPeak(true),
    onLeaveForward: () => armPeak(false),
    onLeaveBackward: () => armPeak(false),
  });

  onScroll({
    target: act6,
    enter: `top ${pctOf(span6, 0.82).toFixed(2)}%`,
    leave: 'top 100%',
    repeat: true,
    onEnterForward: () => hold('peak', true),
    onLeaveBackward: () => hold('peak', false),
    onLeaveForward: () => hold('peak', false),
  });

  $$('[data-lt-rest]').forEach((rest) =>
    onScroll({
      target: rest,
      enter: 'center top',
      leave: 'center bottom',
      repeat: true,
      onEnter: () => hold(`rest-${rest.dataset.ltRest}`, true),
      onLeave: () => hold(`rest-${rest.dataset.ltRest}`, false),
    }),
  );

  /*
   * The console recedes when the question actually arrives.
   *
   * Tied to the close's own cue rather than to the act becoming visible: a half-viewport early
   * left the monitor faded with the close not yet cued in, which is a near-empty screen for a
   * whole viewport of scroll. The fixed surface is the ground for the entry slide.
   */
  const act8 = $('#act-start')!;
  const span8 = Number(act8.dataset.scSpan) || 1.2;
  onScroll({
    target: act8,
    enter: `top ${pctOf(span8, 0.04).toFixed(2)}%`,
    leave: 'start end',
    repeat: true,
    onEnterForward: () => closing(true),
    onEnterBackward: () => closing(true),
    onLeaveForward: () => closing(false),
    onLeaveBackward: () => closing(false),
  });

  /* The rail's active item. Four targets, four thresholds, no progress readout. */
  $$<HTMLAnchorElement>('.ltp-rail__nav .ltp-rail__item').forEach((item) => {
    const target = $(item.getAttribute('href') ?? '');
    if (!target) return;
    onScroll({
      target,
      enter: 'center top',
      leave: 'center bottom',
      repeat: true,
      onEnter: () => {
        $$('.ltp-rail__item').forEach((x) => x.classList.remove('is-here'));
        item.classList.add('is-here');
      },
      onLeave: () => item.classList.remove('is-here'),
    });
  });
}

/* The mobile span rewrite has to happen before the engine reads the attribute once. */
function rewriteSpans(): void {
  if (!phone.matches) return;
  $$('[data-sc-span]').forEach((act) => {
    const v = Number(act.dataset.scSpan) * 0.85;
    act.dataset.scSpan = String(Math.max(1.2, Math.round(v * 100) / 100));
  });
}

async function boot(): Promise<void> {
  buildTiles();
  buildShelf();
  buildMoments();
  buildIntents();
  buildLattice();
  wire();

  surface.classList.add('is-collapsing');
  setFormat('16:9', false);
  setMoment('main-camera', false);
  setInput('camera', false, false);
  setInput('mic', false, false);
  setInput('screen', false, false);
  paintAll();

  rewriteSpans();
  if (document.fonts?.ready) await document.fonts.ready;
  window.ScrollCraft?.mount(document.body);
  layout();
  observeActs();
  updateCounters();

  if (!reduced && !phone.matches) mountAtmosphere();
  mountStory();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
