/**
 * The public experience's own logic.
 *
 * Two motion systems and one boundary between them (`LIVETAP_MOTION_SYSTEM.md` §2):
 *
 *   Scroll Craft is the only thing that reads scroll position. It pins the acts, publishes
 *   `--sc-p`, runs the cues and owns the reduced-motion floor.
 *
 *   Anime.js owns everything on a clock or on a pointer: the five-second guided demo, every
 *   state-change transition, the countdowns, the path draws, chat arrival and the drag. It never
 *   reads scroll except through a `ScrollObserver` threshold.
 *
 * Everything the page paints is computed from `./data.ts`, whose every array names its source in
 * `packages/*` and is covered by a drift test. Nothing here invents a state, a capability, a
 * placement or a number.
 *
 * The first-time-creator audit (docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md) is the reason
 * for most of the shape of this file: the picture is real from the first frame, nothing goes live
 * until the visitor does, every control works at every scroll position, and a control that cannot
 * do something says why in words next to itself.
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
import { createPicture } from './picture.js';
import type { ComposedLayer } from './picture.js';
import { mountOutputs } from './outputs.js';
import type { OutputRow } from './outputs.js';
import { mountVersus } from './versus.js';
import { mountCapture } from './capture.js';

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
const stageLive = $('[data-lt-stage-live]')!;
const stateLine = $('[data-lt-stateline]')!;
const stateDetail = $('[data-lt-statedetail]')!;
const signal = $<SVGSVGElement>('[data-lt-signal]')!;
const destList = $('[data-lt-dests]')!;
const momentStrip = $('[data-lt-moments]')!;
const momentRail = $('[data-lt-moment-rail]')!;
const intentGrid = $('[data-lt-intents]')!;
const intentAnswer = $('[data-lt-intent-answer]')!;
const openLink = $<HTMLAnchorElement>('[data-lt-open]')!;
const interaction = $('[data-lt-interaction]')!;
const breakCta = $<HTMLButtonElement>('[data-lt-break-cta]')!;
const outputsHost = $('[data-lt-outputs]')!;
const outputsLede = $('[data-lt-outputs-lede]')!;
const versusHost = $('[data-lt-versus]')!;
const captureHost = $('[data-lt-capture]')!;
const cameraNote = $('[data-lt-camera-note]')!;

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
  thumb: HTMLCanvasElement;
  drag: ReturnType<typeof createDraggable> | null;
  nudge: { x: number; y: number };
  tension: number;
}

const rows: DestRow[] = [];
let format: Format = phone.matches ? '9:16' : '16:9';
let momentId = 'main-camera';
let intent: IntentDef = phone.matches
  ? (INTENTS.find((i) => i.id === 'vertical') ?? INTENTS[0]!)
  : INTENTS[0]!;
let pro = false;
const inputs = { camera: false, mic: false, screen: false };
let liveAt = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const log: string[] = [];

const RING_R = 10;
const RING_C = 2 * Math.PI * RING_R;

/** The picture engine: a sample creator until the visitor lends their own camera. */
const picture = createPicture(
  {
    creator: { mp4: '/brand/creator.mp4', webm: '/brand/creator.webm', poster: '/brand/creator.webp' },
    guest: { mp4: '/brand/guest.mp4', webm: '/brand/guest.webm', poster: '/brand/guest.webp' },
    screen: '/brand/screen.svg',
  },
  { reduced },
);

let outputs: ReturnType<typeof mountOutputs> | null = null;

/* ============================================================= small utilities */

function icon(id: string, size: 20 | 24 = 20): string {
  return `<svg class="lt-icon lt-icon--${size}" aria-hidden="true" focusable="false"><use href="#${id}" /></svg>`;
}

function say(region: HTMLElement, text: string): void {
  region.textContent = '';
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

function ownsTransform(el: Element): void {
  if (!import.meta.env.DEV) return;
  if (el.closest('[data-sc-cue],[data-sc-pan],[data-sc-parallax]')) {
    console.warn('[livetap] two systems on one transform', el);
  }
}

/* =============================================================== layout + paths */

/**
 * One measurement pass. On desktop the frame is a constant 16:9 box and the canvas re-flows
 * inside it. On a phone the frame IS the canvas, so a vertical production stands tall instead of
 * sitting letterboxed inside a landscape box built for a desk.
 */
function layout(): void {
  const box = stage.getBoundingClientRect();
  const wrap = (stage.parentElement as HTMLElement).getBoundingClientRect();
  const reserve = stateLine.offsetHeight + stateDetail.offsetHeight + 16;
  const maxH = Math.max(120, wrap.height - reserve);
  const maxW = Math.max(200, box.width);
  const ar = format === '16:9' ? 16 / 9 : format === '9:16' ? 9 / 16 : 1;

  let w: number;
  let h: number;
  if (wide.matches) {
    w = maxW;
    h = w / (16 / 9);
    if (h > maxH) {
      h = maxH;
      w = h * (16 / 9);
    }
  } else {
    w = maxW;
    h = w / ar;
    if (h > maxH) {
      h = maxH;
      w = h * ar;
    }
  }
  frame.style.setProperty('--ltp-frame-w', `${Math.round(w)}px`);
  frame.style.setProperty('--ltp-frame-h', `${Math.round(h)}px`);

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

function port(i: number): Point {
  const s = surface.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  if (!wide.matches) {
    return { x: c.left - s.left + (c.width * (i + 0.5)) / 6, y: c.bottom - s.top };
  }
  const slot = [0.25, 0.5, 0.75][i % 3] as number;
  return { x: (i < 3 ? c.left : c.right) - s.left, y: c.top - s.top + c.height * slot };
}

function tilePort(row: DestRow, i: number): Point {
  const s = surface.getBoundingClientRect();
  const t = row.tile.getBoundingClientRect();
  if (!wide.matches) return { x: t.left - s.left + t.width / 2, y: t.top - s.top };
  return { x: (i < 3 ? t.right : t.left) - s.left, y: t.top - s.top + t.height / 2 };
}

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
        <span class="ltp-tile__row">
          <canvas class="ltp-tile__thumb" data-lt-thumb width="176" height="88" hidden aria-hidden="true"></canvas>
          <span class="lt-chip lt-chip--disconnected" data-lt-chip>
            <span class="lt-dot lt-dot--ring" data-lt-dot aria-hidden="true"></span>
            <span class="lt-chip__text">
              <span class="lt-chip__label" data-lt-label>${STATE_LABEL.DISCONNECTED}</span>
              <span class="lt-chip__status" data-lt-status>${METHOD_LABEL[d.method]}</span>
            </span>
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
      thumb: $<HTMLCanvasElement>('[data-lt-thumb]', li)!,
      drag: null,
      nudge: { x: 0, y: 0 },
      tension: 0,
    };
    rows.push(row);
    watchThumb(row.thumb);

    row.tile.addEventListener('click', () => {
      interrupt();
      toggleDest(i);
    });
    row.tile.addEventListener('keydown', (e) => onTileKey(e, i));
  });
}

/** One line per look, in the product's words: what the viewer sees, never how it is built. */
const MOMENT_MEANING: Record<string, string> = {
  'starting-soon': 'A held card before you begin',
  'main-camera': 'You, full frame',
  'screen-share': 'Your screen, you in the corner',
  guest: 'Two people, side by side',
  break: 'A quiet card while you step away',
  ending: 'A thank-you and the sign-off',
};

function momentName(m: MomentDef): string {
  return RENAME[intent.id]?.[m.id] ?? m.name;
}

function momentGlyph(m: MomentDef): string {
  return m.id === 'main-camera'
    ? 'i-camera'
    : m.id === 'screen-share'
      ? 'i-screen'
      : m.id === 'guest'
        ? 'i-users'
        : `m-${m.id}`;
}

function buildMoments(): void {
  MOMENTS.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lt-moment lt-touch';
    b.setAttribute('aria-pressed', String(m.id === momentId));
    b.dataset.ltMoment = m.id;
    b.innerHTML = `
      <span class="lt-moment__icon lt-moment__icon--glyph">${icon(momentGlyph(m), 24)}</span>
      <span class="lt-moment__name" data-lt-moment-name>${momentName(m)}</span>
      <span class="lt-moment__meta" data-lt-moment-meta>${i + 1}</span>
    `;
    b.addEventListener('click', () => {
      interrupt();
      setMoment(m.id);
    });
    momentStrip.append(b);

    /* The same six as rail cards in the Moments chapter, each with a live picture of that look. */
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'ltp-railcard lt-touch';
    card.setAttribute('aria-pressed', String(m.id === momentId));
    card.dataset.ltMomentMirror = m.id;
    card.style.setProperty('--i', String(i));
    card.innerHTML = `
      <canvas class="ltp-railcard__thumb" width="352" height="198" aria-hidden="true" data-lt-railthumb></canvas>
      <span class="ltp-railcard__name">${icon(momentGlyph(m), 20)}<span data-lt-moment-name>${momentName(m)}</span></span>
      <span class="ltp-railcard__meta">${MOMENT_MEANING[m.id] ?? ''}</span>
    `;
    card.addEventListener('click', () => {
      interrupt();
      setMoment(m.id);
    });
    const railThumb = $<HTMLCanvasElement>('[data-lt-railthumb]', card);
    if (railThumb) watchThumb(railThumb);
    momentRail.insertBefore(card, $('.ltp-lane__trail', momentRail));
  });
}

function buildIntents(): void {
  INTENTS.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ltp-intentchip lt-touch';
    b.setAttribute('aria-pressed', String(it.id === intent.id));
    b.dataset.ltIntent = it.id;
    b.dataset.scTilt = '5';
    b.innerHTML = `${icon(`n-${it.id}`, 24)}<span class="ltp-intentchip__title">${it.title}</span><span class="ltp-intentchip__tag">${it.tagline}</span>`;
    b.addEventListener('click', () => {
      interrupt();
      setIntent(it);
    });
    intentGrid.append(b);
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
 * Paint one destination, and only that one. The peak's whole claim is that a break touches
 * nothing else, so there is deliberately no "repaint everything" path through the break.
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

  row.li.dataset.ltState = row.state;
  const mine = row.state !== 'DISCONNECTED';
  row.li.classList.toggle('is-mine', mine);
  row.li.classList.toggle('is-reconnecting', row.state === 'RECONNECTING');
  row.tile.setAttribute('aria-pressed', String(mine));
  row.tile.setAttribute(
    'aria-label',
    `${d.name}, ${label}, ${METHOD_LABEL[d.method]}, demo destination`,
  );
  /* The tile's own picture, in the destination's own shape, appears once it is connected. */
  row.thumb.hidden = !mine || row.state === 'ENDED';
  if (!row.thumb.hidden) sizeThumb(row, fmt);

  /* An armed tile says how to break it; a disconnected one says how to start. */
  if (!peakArmed || row.state !== 'LIVE') {
    const hint =
      row.state === 'DISCONNECTED'
        ? d.method === 'key'
          ? 'Tap to paste a key'
          : 'Tap to connect'
        : peakArmed && row.state !== 'LIVE'
          ? 'Go live to break it'
          : '';
    if (row.hint.textContent !== hint) row.hint.textContent = hint;
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
  stageLive.hidden = !anyLive;

  const ready = rows.filter((r) => r.state === 'READY' || r.state === 'ENDED').length;
  if (!goliveSub.classList.contains('is-warning') && goliveSub.dataset.ltYourturn !== 'true') {
    goliveSub.textContent = anyLive
      ? `Live on ${liveCount()}`
      : ready
        ? `Going live on ${ready}`
        : 'Pick a destination, or tap GO LIVE and LIVETAP picks two';
  }
  if (!countdown) {
    goliveLabel.textContent = anyLive ? 'END' : 'GO LIVE (DEMO)';
    golive.classList.toggle('ltp-golive--end', anyLive);
    golive.setAttribute(
      'aria-label',
      anyLive
        ? `END the demo on ${liveCount()} destinations`
        : ready
          ? `GO LIVE on ${ready} demo destinations`
          : 'GO LIVE, LIVETAP connects two demo destinations first',
    );
  }

  paintBreakCta();
  paintStateLine();
  paintFormatTable();
  paintOutputs();
  drawThumbs(true);
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
  guides.style.setProperty('--sa-r', String(sa.right));
  guides.style.setProperty('--sa-b', String(sa.bottom));
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

/** The safe-area guides: on while SHAPES is the chapter on screen, and in any shape but 16:9. */
let guidesAct = false;
function paintGuides(): void {
  guides.classList.toggle('is-on', guidesAct || format !== '16:9');
}

/**
 * A Moment never refuses. Screen Share needs the screen, so choosing it switches the screen on
 * and says so, instead of declining in silence.
 */
function setMoment(id: string, announce = true): void {
  const m = MOMENTS.find((x) => x.id === id);
  if (!m) return;
  let extra = '';
  if (m.id === 'screen-share' && !inputs.screen) {
    setInput('screen', true, false);
    extra = ' Screen switched on for it.';
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
  $$('[data-lt-moment-mirror]', momentRail).forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.ltMomentMirror === id)),
  );
  applyMoment();
  setInput('mic', !m.micMuted, false);
  publish();
  note(`Moment ${momentName(m)}`);
  if (announce) say(sayDest, `Moment: ${momentName(m)}.${extra}`);
}

/** Where a layer sits, for a given shape. Mirrors the product's applyIntentToLayer(). */
function placementFor(layer: MomentDef['layers'][number], fmt: Format, mid: string = momentId): Rect {
  const at = layer.at ?? { default: { x: 0, y: 0, w: 1, h: 1 } };
  const base = (fmt === '9:16' && at['9:16']) || at.default;
  if (layer.kind === 'text') return insetToSafeArea(base, fmt);
  if (layer.kind === 'camera' && mid === 'screen-share' && fmt === '9:16') {
    return insetToSafeArea(base, fmt);
  }
  return base;
}

/** A Moment's active layers, placed for a shape, for the composer. Defaults to the current Moment. */
function layersFor(fmt: Format, mid: string = momentId): ComposedLayer[] {
  const m = MOMENTS.find((x) => x.id === mid)!;
  const out: ComposedLayer[] = [];
  for (const layer of m.layers) {
    /* A rail card previews the look as it would be with every input on. */
    const present = mid === momentId ? hasInput(layer.kind) : true;
    if (layer.visible === false || !present) continue;
    const l: ComposedLayer = { kind: layer.kind, rect: placementFor(layer, fmt, mid) };
    if (layer.radius !== undefined) l.radius = layer.radius;
    if (layer.text !== undefined) l.text = layer.text;
    out.push(l);
  }
  return out;
}

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
    const r = placementFor(layer!, format);
    el.style.setProperty('--lx', String(r.x));
    el.style.setProperty('--ly', String(r.y));
    el.style.setProperty('--lw', String(r.w));
    el.style.setProperty('--lh', String(r.h));
    el.style.setProperty('--lr', String(layer!.radius ?? 0));
    if (kind === 'text') el.textContent = layer!.text ?? '';
    active.push(el);
  }
  drawThumbs(true);

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
  $$(`[data-lt-input="${which}"]`).forEach((b) => {
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-on', on);
    const s = $('[data-lt-input-state]', b);
    if (s) s.textContent = word;
  });
  if (which === 'mic') meter(on);
  if (which === 'camera' && !on && picture.source === 'camera') picture.stopCamera();
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

/* ================================================================= the camera */

let cameraBusy = false;

async function useCamera(): Promise<void> {
  if (cameraBusy) return;
  interrupt();
  if (picture.source === 'camera') {
    picture.stopCamera();
    paintCamera('Camera stopped. Back to the sample picture.');
    return;
  }
  cameraBusy = true;
  $$('[data-lt-camera-label]').forEach((l) => (l.textContent = 'Asking your browser'));
  const outcome = await picture.useCamera();
  cameraBusy = false;
  if (outcome === 'granted') {
    setInput('camera', true, false);
    setMoment('main-camera', false);
    paintCamera('Your camera is on the stage. It stays in this tab and is never uploaded.');
    tourDone('camera');
  } else if (outcome === 'denied') {
    paintCamera('No camera permission, so the sample picture stays. Nothing was recorded.');
  } else if (outcome === 'insecure') {
    paintCamera('A camera needs a secure page. The sample picture stays.');
  } else {
    paintCamera('No camera was found, so the sample picture stays.');
  }
}

function paintCamera(line: string): void {
  const on = picture.source === 'camera';
  surface.dataset.ltSource = picture.source;
  $$('[data-lt-camera-label]').forEach((l) => (l.textContent = on ? 'Stop my camera' : 'Use my camera'));
  $$('[data-lt-camera-cta]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  cameraNote.textContent = on ? 'Live from your camera. Local only, never uploaded.' : line;
  say(sayDest, line);
  publish();
}

/* ================================================= the destination state machine */

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
  } else if (row.state === 'LIVE' || row.state === 'DEGRADED') {
    /* A live tile tapped is not a refusal: it says what a tap cannot do and what can. */
    say(sayDest, `${d.name} is live. Use END to stop everything, or drag this tile off the stage to break just this one.`);
    row.hint.textContent = 'Live. END stops it, or drag it off';
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

/** Connect without the sign-in wait: for the guided demo and for "do it for me" buttons. */
function connectNow(i: number): void {
  if (i < 0) return;
  const row = rows[i]!;
  if (row.state !== 'DISCONNECTED') return;
  advance(i, 'CONNECT');
  advance(i, 'AUTH_OK');
  paintDest(i);
  drawPath(row, i, true);
  paintReadouts();
  publish();
  note(`${row.name} ready`);
}

/** The two destinations an intent suggests: the first two whose own shape is the intent's. */
function suggestedFor(it: IntentDef): number[] {
  const out: number[] = [];
  DESTINATIONS.forEach((d, i) => {
    if (out.length < 2 && d.preferred === it.master) out.push(i);
  });
  if (out.length < 2) DESTINATIONS.forEach((_, i) => out.length < 2 && !out.includes(i) && out.push(i));
  return out;
}

/* ================================================================== GO LIVE */

let countdown: ReturnType<typeof createTimer> | null = null;

/**
 * GO LIVE works from any state. With nothing connected it connects the two destinations the
 * chosen intent suggests, says so under the button, and then counts down. A button that only
 * explains why it did nothing is the thing the audit called a trust killer.
 */
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
    const pending = rows.some((r) => r.state === 'AUTHENTICATING');
    if (pending) {
      warnGoLive('Still signing in. GO LIVE is a tap away once a destination is Ready.');
      return;
    }
    const picks = suggestedFor(intent);
    picks.forEach((i) => connectNow(i));
    warnGoLive(`Nothing was picked, so LIVETAP connected ${names(picks.map((i) => rows[i]!.name))}.`);
    window.setTimeout(() => goLive(), 700);
    return;
  }
  goliveSub.classList.remove('is-warning');
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

let warnTimer = 0;
function warnGoLive(text: string): void {
  goliveSub.textContent = text;
  goliveSub.classList.add('is-warning');
  say(sayBroadcast, text);
  clearTimeout(warnTimer);
  warnTimer = window.setTimeout(() => {
    goliveSub.classList.remove('is-warning');
    paintReadouts();
  }, 4000);
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
    if (peakArmed) armPeak(true);
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
      row.tile.removeAttribute('aria-keyshortcuts');
      paintDest(i);
    }
    if (armed && !reduced && !row.drag) {
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
  paintBreakCta();
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

/** The break, and the four things that happen. Nothing in here touches a sibling. */
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
  if (row.state !== 'RECONNECTING') return;
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

/**
 * The chapter's own button: one press does whatever is needed to show the break, and its
 * label says exactly what that will be.
 */
function paintBreakCta(): void {
  const live = rows.find((r) => r.state === 'LIVE');
  const ready = rows.some((r) => r.state === 'READY' || r.state === 'ENDED');
  const busy = rows.some((r) => r.state === 'RECONNECTING' || r.state === 'DEGRADED' || r.state === 'STARTING');
  let label: string;
  if (busy) label = 'Breaking. Watch the tile';
  else if (live) label = `Break ${live.name} for me`;
  else if (ready) label = 'Go live, then break the first one';
  else label = `Go live, then break ${rows[suggestedFor(intent)[0]!]!.name}`;
  if (breakCta.textContent !== label) breakCta.textContent = label;
  breakCta.setAttribute('aria-disabled', String(busy));
}

function breakForMe(): void {
  interrupt();
  const live = rows.findIndex((r) => r.state === 'LIVE');
  if (live >= 0) {
    if (!peakArmed) armPeak(true);
    breakDest(live);
    return;
  }
  if (rows.some((r) => r.state === 'RECONNECTING' || r.state === 'DEGRADED')) return;
  const ready = rows.filter((r) => r.state === 'READY' || r.state === 'ENDED');
  if (!ready.length) suggestedFor(intent).forEach((i) => connectNow(i));
  paintReadouts();
  startAll();
  window.setTimeout(() => {
    const first = rows.findIndex((r) => r.state === 'LIVE');
    if (first >= 0) {
      if (!peakArmed) armPeak(true);
      breakDest(first);
    }
  }, 1600);
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
    ['quality', 'Quality', [DEFAULT_QUALITY_LABEL, 'Derived from your connection and your machine.']],
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

function setPro(on: boolean, announce = true): void {
  pro = on;
  $$('[data-lt-mode-set]').forEach((b) =>
    b.setAttribute('aria-checked', String((b.dataset.ltModeSet === 'pro') === on)),
  );
  surface.classList.toggle('is-pro', on);
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
    if (announce) say(sayDest, `Pro. ${panels.length} panel${panels.length === 1 ? '' : 's'} added above the desk. Nothing moved.`);
    tourDone('pro');
  } else if (announce) {
    say(sayDest, 'Simple. The numbers are put away.');
  }
  layout();
  publish();
}

/* ================================================================= the intent */

/**
 * The app's first question, answered on this stage: the shape, the first Moment and the
 * destinations change to match, and the sentence under the chips says what changed.
 */
function setIntent(next: IntentDef, announce = true): void {
  intent = next;
  $$('[data-lt-intent]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.ltIntent === next.id)),
  );
  $$('[data-lt-moment], [data-lt-moment-mirror]').forEach((b) => {
    const id = b.dataset.ltMoment ?? b.dataset.ltMomentMirror;
    const m = MOMENTS.find((x) => x.id === id);
    const nameEl = $('[data-lt-moment-name]', b);
    if (m && nameEl) nameEl.textContent = momentName(m);
  });
  openLink.href = `./app/start?intent=${next.id}`;
  openLink.textContent = `Open LIVETAP for ${next.title}`;

  const picks = suggestedFor(next);
  rows.forEach((row, i) => row.li.classList.toggle('is-suggested', picks.includes(i)));
  if (!connected().length) picks.forEach((i) => connectNow(i));

  setFormat(next.master, false);
  setMoment(next.firstMoment, false);
  paintAll();
  const pickNames = names(picks.map((i) => rows[i]!.name));
  intentAnswer.textContent = `${next.title}: ${next.tagline} Composing in ${next.master}, ${momentName(MOMENTS.find((m) => m.id === next.firstMoment)!)} first, ${pickNames} suggested.`;
  note(`${next.title} chosen`);
  if (announce) say(sayDest, intentAnswer.textContent);
  tourDone('intent');
}

/* =============================================================== the outputs */

function outputRows(): OutputRow[] {
  return DESTINATIONS.map((d, i) => {
    const row = rows[i]!;
    return {
      id: d.id,
      name: d.name,
      format: aspectFor(d),
      ceilingMbps: d.ceilingMbps,
      state: row.state,
      stateLabel: STATE_LABEL[row.state],
      chipClass: `lt-chip lt-chip--${CHIP_CLASS[row.state]}`,
    };
  });
}

function paintOutputs(): void {
  outputs?.update(outputRows(), (fmt) => layersFor(fmt));
  const f = producedFormats();
  outputsLede.textContent = f.length
    ? `${f.join(' and ')}. Each platform gets what it accepts.`
    : 'Each platform gets what it accepts.';
  updateCounters();
}

/* ---- the tiles' own pictures ------------------------------------------------ */

const THUMB: Record<Format, [number, number]> = { '16:9': [176, 99], '9:16': [56, 99], '1:1': [99, 99] };

function sizeThumb(row: DestRow, fmt: Format): void {
  const [w, h] = THUMB[fmt];
  if (row.thumb.width !== w * 2 || row.thumb.height !== h * 2) {
    row.thumb.width = w * 2;
    row.thumb.height = h * 2;
  }
  row.thumb.style.aspectRatio = `${w} / ${h}`;
}

let thumbRaf = 0;
let thumbLast = 0;

/*
 * Which thumbnails are actually on screen.
 *
 * `hidden` was the only cull here, and `hidden` answers "is this row switched off", not "can
 * anyone see it". A profile of the page at four-times CPU slowdown - a mid-range laptop, or any
 * laptop that is also encoding video - put 55.7% of ALL main-thread time in `drawImage`, at
 * 10.6 ms per call, while nine of the eighteen canvases on the page were scrolled out of sight
 * and being composited ten times a second for nobody.
 *
 * An IntersectionObserver rather than `getBoundingClientRect`: the rect would be read twelve
 * times per pass and each read flushes layout, which is trading one waste for another.
 */
const onScreenThumbs = new WeakSet<Element>();
const thumbWatcher =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) onScreenThumbs.add(entry.target);
            else onScreenThumbs.delete(entry.target);
          }
        },
        /* A margin of one viewport, so a thumbnail is already painted when it scrolls in. */
        { rootMargin: '100% 0px' },
      )
    : null;

/** True when a canvas is worth the 10 ms. With no observer, everything is: never draw less than before. */
function worthDrawing(canvas: HTMLCanvasElement): boolean {
  if (!thumbWatcher) return true;
  return onScreenThumbs.has(canvas);
}

function watchThumb(canvas: HTMLCanvasElement): void {
  thumbWatcher?.observe(canvas);
}

function drawThumbs(once = false): void {
  const due = performance.now() - thumbLast > 1000 / 10;
  if (!once && !due) return;
  thumbLast = performance.now();
  // One downscale of the camera for this pass, shared by every thumbnail in it.
  picture.beginFrame();
  rows.forEach((row, i) => {
    if (row.thumb.hidden) return;
    if (!once && !worthDrawing(row.thumb)) return;
    const ctx = row.thumb.getContext('2d');
    if (!ctx) return;
    picture.compose(ctx, row.thumb.width, row.thumb.height, layersFor(aspectFor(DESTINATIONS[i]!)));
  });
  if (railVisible || once) {
    $$<HTMLCanvasElement>('[data-lt-railthumb]', momentRail).forEach((c) => {
      if (!once && !worthDrawing(c)) return;
      const ctx = c.getContext('2d');
      const mid = (c.parentElement as HTMLElement).dataset.ltMomentMirror ?? momentId;
      if (ctx) picture.compose(ctx, c.width, c.height, layersFor('16:9', mid));
    });
  }
}

let railVisible = false;

function thumbLoop(): void {
  thumbRaf = requestAnimationFrame(thumbLoop);
  if (document.hidden || reduced) return;
  if (!railVisible && !rows.some((r) => !r.thumb.hidden)) return;
  drawThumbs();
}

/**
 * The two counters carry real, computed values. The engine reads `data-sc-count` once at
 * mount, so the targets are updated through the instance API it publishes for exactly this
 * kind of page, never by editing the engine or re-mounting it.
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

/* ====================================================== the guided five seconds */

let storyTimer: ReturnType<typeof createTimer> | null = null;
let storyDead = false;

/**
 * Five seconds, then the visitor's. The demo switches the microphone on, connects the two
 * destinations the intent suggests plus TikTok on a desk, and stops at READY with the one
 * invitation on the page pointing at GO LIVE. It never goes live by itself.
 */
function mountStory(): void {
  const picks = suggestedFor(intent);
  const extra = phone.matches ? -1 : rows.findIndex((r) => r.id === 'tiktok' && !picks.includes(rows.indexOf(r)));
  const steps: Array<[number, () => void]> = [
    [500, () => setInput('mic', true, false)],
    [1100, () => connectNow(picks[0]!)],
    [1800, () => connectNow(picks[1]!)],
    [2500, () => connectNow(extra)],
    [3300, () => paintReadouts()],
    [4200, () => yourTurn(true)],
  ];
  const fired = new Set<number>();
  storyTimer = createTimer({
    duration: 5000,
    onUpdate: (self) => {
      if (storyDead) return;
      steps.forEach(([t, fn], k) => {
        if (!fired.has(k) && self.currentTime >= t) {
          fired.add(k);
          fn();
        }
      });
    },
    onComplete: () => {
      storyDead = true;
    },
  });
}

/** The hand-over: written under GO LIVE, where the button already explains itself. */
function yourTurn(on: boolean): void {
  goliveSub.dataset.ltYourturn = String(on);
  golive.classList.toggle('is-turn', on);
  if (on) {
    goliveSub.textContent = 'Your turn. Tap GO LIVE. Nothing is broadcast from this page.';
    say(sayTour, 'Your turn. Tap GO LIVE. Nothing is broadcast from this page.');
  }
}

/** Any visitor action ends the demo and takes the invitation down. */
function interrupt(): void {
  if (goliveSub.dataset.ltYourturn === 'true') {
    yourTurn(false);
    paintReadouts();
  }
  if (storyDead) return;
  storyDead = true;
  storyTimer?.pause();
}

/* ====================================================================== the tour */

const TOUR: Array<{ key: string; prompt: string; target: string }> = [
  { key: 'camera', prompt: 'Put your own camera on the stage.', target: '#act-hero' },
  { key: 'live', prompt: 'Go live.', target: '#act-hero' },
  { key: 'break', prompt: 'Break it. Drag a live destination off the stage.', target: '#act-break' },
  { key: 'shape', prompt: 'Change the shape.', target: '#act-shape' },
  { key: 'moment', prompt: 'Switch what viewers see.', target: '#act-moments' },
  { key: 'pro', prompt: 'Look underneath.', target: '#act-pro' },
  { key: 'intent', prompt: 'Tell LIVETAP what you are making.', target: '#act-make' },
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
  if (momentId !== 'main-camera') tourDone('moment');
  if (format !== (phone.matches ? '9:16' : '16:9')) tourDone('shape');
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
      const group = b.parentElement ?? document;
      $<HTMLButtonElement>(`[data-lt-format-set="${order[next]}"]`, group)?.focus();
      if (changed) tourDone('shape');
    });
  });

  $$('[data-lt-mode-set]').forEach((b) =>
    b.addEventListener('click', () => {
      interrupt();
      setPro(b.dataset.ltModeSet === 'pro');
    }),
  );

  $$('[data-lt-input]').forEach((b) =>
    b.addEventListener('click', () => {
      interrupt();
      const which = b.dataset.ltInput as 'camera' | 'mic' | 'screen';
      setInput(which, b.getAttribute('aria-pressed') !== 'true');
    }),
  );

  $$('[data-lt-camera-cta]').forEach((b) => b.addEventListener('click', () => void useCamera()));
  breakCta.addEventListener('click', breakForMe);

  $('[data-lt-tour-open]')!.addEventListener('click', () => openTour());

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

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(thumbRaf);
      thumbRaf = 0;
    } else if (!thumbRaf) {
      thumbLoop();
    }
  });
}

function closing(on: boolean): void {
  surface.classList.toggle('is-closing', on);
}

/**
 * Which chapter owns the viewport.
 *
 * The act whose box contains the point 45% down the viewport is the active one. Its band is
 * shown, its rail item is lit, and its side effects run: the peak arms the tiles, SHAPES draws
 * the guides, the close dims the monitor. One passive scroll listener, one rAF, no thresholds
 * to tune and nothing that can be missed by a fast flick.
 */
let activeAct = '';
let actRaf = 0;

function watchActs(): void {
  const acts = $$<HTMLElement>('main.ltp-acts > [id^="act-"]');
  const bands = $$('[data-lt-band]');
  const items = $$<HTMLAnchorElement>('.ltp-rail__nav .ltp-rail__item');

  /**
   * Keep hit-testing honest: a band is `is-here`, and therefore visible and touchable, only while
   * it is actually rendering something.
   *
   * Being the active chapter is NOT the same thing. A pinned act owns the viewport for a whole
   * screen of scroll before its own progress leaves 0, and its band is transparent for all of it.
   * Marking that band interactive put an invisible panel over the middle of the stage, where it
   * ate clicks meant for "Use my camera" and for the destination Connect buttons, and swallowed
   * the first wheel tick. Reading the rendered opacity rather than inferring it means the class
   * cannot drift from what the visitor can see, whatever a future cue window does.
   */
  const syncBandHits = (): void => {
    for (const band of bands) {
      const visible = Number.parseFloat(getComputedStyle(band).opacity) > 0.05;
      band.classList.toggle('is-here', visible && band.dataset.ltBand === activeAct);
    }
  };

  const apply = (): void => {
    actRaf = 0;
    const probe = scrollY + innerHeight * 0.45;
    let here = acts[0]!;
    for (const act of acts) {
      const top = act.offsetTop;
      if (probe >= top) here = act;
    }
    syncBandHits();
    if (here.id === activeAct) {
      settle();
      return;
    }
    const prev = activeAct;
    activeAct = here.id;
    document.body.dataset.ltAct = activeAct;
    syncBandHits();
    settle();
    items.forEach((it) => it.classList.toggle('is-here', it.getAttribute('href') === `#${activeAct}`));

    if (activeAct === 'act-break') {
      interrupt();
      armPeak(true);
    } else if (prev === 'act-break') {
      armPeak(false);
    }
    guidesAct = activeAct === 'act-shape';
    paintGuides();
    closing(activeAct === 'act-make');
    hold('peak', activeAct === 'act-break');
    hold('close', activeAct === 'act-make');
    if (activeAct !== 'act-hero') interrupt();
  };

  const schedule = (): void => {
    if (!actRaf) actRaf = requestAnimationFrame(apply);
  };

  /*
   * One more sync on the following frame.
   *
   * A band's opacity can change in the same frame this reads it: the engine writes the act's
   * progress and the CSS derives opacity from it, and whether that lands before or after this
   * callback depends on ordering the page does not control. Sampling once left a band at full
   * opacity and not marked interactive, which is the same class of mismatch in the other
   * direction: visible and untouchable rather than invisible and touchable.
   */
  const settle = (): void => {
    requestAnimationFrame(() => {
      syncBandHits();
    });
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  apply();

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
  buildMoments();
  buildIntents();
  wire();

  picture.mount(canvas);
  picture.onChange(() => {
    surface.dataset.ltSource = picture.source;
    setInput('camera', picture.source !== 'none', false);
  });

  /* The picture is on from the first frame: a stage with nothing on it is the one thing the
     audit said a production tool cannot open with. */
  setFormat(format, false);
  setInput('camera', true, false);
  setInput('mic', false, false);
  setInput('screen', false, false);
  setMoment('main-camera', false);
  setPro(false, false);
  setIntentQuiet(intent);
  paintAll();

  outputs = mountOutputs(outputsHost, picture, { reduced });
  paintOutputs();
  outputs.start();

  mountVersus(versusHost, {
    reduced,
    onPlayLivetap: () => {
      interrupt();
      const talking = INTENTS.find((i) => i.id === 'talking') ?? INTENTS[0]!;
      setIntent(talking, false);
      connectNow(rows.findIndex((r) => r.id === 'youtube'));
      connectNow(rows.findIndex((r) => r.id === 'tiktok'));
      if (!liveCount() && !countdown) window.setTimeout(() => goLive(), 400);
    },
  });

  void mountCapture(captureHost);

  rewriteSpans();
  if (document.fonts?.ready) await document.fonts.ready;
  window.ScrollCraft?.mount(document.body);
  layout();
  watchActs();
  updateCounters();
  new IntersectionObserver((e) => {
    railVisible = !!e[0]?.isIntersecting;
  }).observe(momentRail);
  drawThumbs(true);
  thumbLoop();
  mountStory();
}

/** The intent at boot: chips, link, suggestions and names, without connecting anything. */
function setIntentQuiet(it: IntentDef): void {
  intent = it;
  $$('[data-lt-intent]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ltIntent === it.id)));
  openLink.href = `./app/start?intent=${it.id}`;
  openLink.textContent = `Open LIVETAP for ${it.title}`;
  const picks = suggestedFor(it);
  rows.forEach((row, i) => row.li.classList.toggle('is-suggested', picks.includes(i)));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
