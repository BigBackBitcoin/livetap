import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A click counter.
 *
 * The friction benchmark is a number, and a number nobody measures is a number nobody keeps.
 * Every tap a first-time creator makes on the path from `/app` to LIVE goes through here, so
 * the count in `docs/qa/FRICTION_BENCHMARK.md` is measured rather than asserted by a human.
 */
export class Taps {
  private count = 0;

  constructor(private readonly page: Page) {}

  async click(name: string | RegExp, options: { exact?: boolean } = {}): Promise<void> {
    const locator = this.page.getByRole('button', { name, exact: options.exact ?? false }).first();
    await locator.waitFor({ state: 'visible' });
    await locator.click();
    this.count += 1;
  }

  get taps(): number {
    return this.count;
  }
}

/** The words a Simple-mode user must never meet, anywhere on the path to LIVE. */
export const PROTOCOL_WORDS = /rtmp|bitrate|codec|keyframe|scene|source/i;

/** Start from a clean first run: no intent, no destinations, no setup done. */
export async function freshFirstRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

/** Walk the golden path: intent, two destinations, open Studio. Returns the taps used. */
export async function reachStudio(page: Page, taps: Taps): Promise<void> {
  await page.goto('/app');
  await page.getByRole('heading', { name: 'What are you making?' }).waitFor();
  await taps.click('Talking');
  await page.getByRole('heading', { name: 'Where are you going live?' }).waitFor();
  await taps.click(/^YouTube/);
  await taps.click(/^TikTok/);
  await taps.click('Continue');
  await page.getByRole('heading', { name: 'Here is your setup' }).waitFor();
  await taps.click('Open Studio');
  await page.getByRole('button', { name: 'Go live' }).waitFor();
}

/** No page in LIVETAP may ever scroll sideways. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

/* ======================================================== the public experience */

/**
 * The eight chapters of `/`, in document order.
 *
 * `#act-make` is the only one with no band: its copy is the `.ltp-close` panel inside the act
 * itself. Every other chapter carries its words in the fixed band layer.
 */
export const ACTS = [
  'act-hero',
  'act-break',
  'act-shape',
  'act-moments',
  'act-outputs',
  'act-versus',
  'act-pro',
  'act-make',
] as const;

export type ActId = (typeof ACTS)[number];

/** The chapters whose copy lives in the fixed band layer, one band each. */
export const BANDED_ACTS = ACTS.filter((id) => id !== 'act-make');

/**
 * Stop the guided demo where it stands and hand every destination back.
 *
 * The page's own rule is that any visitor action ends the demo (`interrupt()` in `main.ts`), so
 * the honest way to take the surface over is to do something a visitor does. Re-selecting the
 * shape that is already selected is exactly that, and it changes nothing about the composition,
 * which matters on a phone where the shape starts at 9:16 rather than 16:9.
 */
export async function ownTheSurface(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('html.sc-ready');
  await page.evaluate(() => {
    const stage = document.querySelector('[data-lt-stage]') as HTMLElement;
    const here = stage.dataset.ltFormat ?? '16:9';
    const seg = document.querySelector(
      '.ltp-toolbar [data-lt-format-set="' + here + '"]',
    ) as HTMLElement;
    seg.click();
    /* Whatever the demo connected in the milliseconds before this, give it back. */
    document
      .querySelectorAll<HTMLElement>(
        '[data-lt-dest]:not([data-lt-state="DISCONNECTED"]) [data-lt-pick]',
      )
      .forEach((tile) => tile.click());
  });
  await expect(page.locator('[data-lt-dest][data-lt-state="DISCONNECTED"]')).toHaveCount(6);
  await expect(page.locator('[data-lt-golive-sub]')).toHaveAttribute('data-lt-yourturn', 'false');
}

/**
 * Park the page at a fraction of one chapter's own travel, the way a reader arrives at it, and
 * wait until the page agrees that chapter is the one on screen.
 */
export async function toAct(page: Page, id: string, p = 0.5): Promise<void> {
  const y = await page.evaluate(
    ([actId, at]) => {
      const el = document.getElementById(actId as string)!;
      const top = el.getBoundingClientRect().top + scrollY;
      return Math.round(top + Math.max(el.offsetHeight - innerHeight, 1) * (at as number));
    },
    [id, p] as [string, number],
  );
  await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
  await page.waitForFunction((want) => document.body.dataset.ltAct === want, id);
  /* One beat for watchActs' side effects: the band swap, the guides, arming the peak. */
  await page.waitForTimeout(250);
}

/**
 * Every part of a tile that the page's central claim covers.
 *
 * "Breaking one destination touches nothing else" is the argument the whole peak exists to make,
 * so a sibling is compared on its state, its chip, its words, its box on screen and its signal
 * path, before and after. Anything less would let a repaint through.
 */
export async function tileState(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate((destId) => {
    const li = document.querySelector(`[data-lt-dest="${destId}"]`) as HTMLElement;
    const tile = li.querySelector('[data-lt-pick]') as HTMLElement;
    const chip = li.querySelector('[data-lt-chip]') as HTMLElement;
    const path = document.querySelector(`[data-lt-path="${destId}"]`) as SVGPathElement;
    const cs = getComputedStyle(tile);
    return {
      state: li.dataset.ltState,
      chip: chip.className,
      label: (li.querySelector('[data-lt-label]') as HTMLElement).textContent,
      transform: cs.transform,
      opacity: cs.opacity,
      scale: cs.scale,
      box: JSON.stringify(tile.getBoundingClientRect()),
      d: path.getAttribute('d'),
      strokeWidth: getComputedStyle(path).strokeWidth,
      phase: path.getAttribute('data-lt-phase'),
    };
  }, id);
}

/** The compact signature the surface publishes for a verification pass. */
export interface VerifyState {
  format: string;
  states: string;
  moment: string;
  chat: number;
  mode: string;
}

export async function verifyState(page: Page): Promise<VerifyState> {
  const raw = (await page.locator('[data-lt-surface]').getAttribute('data-sc-verify-state')) ?? '';
  const [format = '', states = '', moment = '', chat = '0', mode = ''] = raw.split('|');
  return { format, states, moment, chat: Number(chat), mode };
}

/** Is this element the thing a click at its own centre would actually reach? */
export async function isOnTop(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > innerHeight) return false;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit?.closest(sel);
  }, selector);
}

/** Put the pointer over the middle of an element and turn the wheel. */
export async function wheelOver(page: Page, selector: string, by = 600): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, by);
}

/**
 * Every wheel and touch listener the page registers, with its passive flag.
 *
 * A non-passive `wheel` or `touchmove` listener is the classic way a scroll-driven page stops
 * being scrollable, and it fails silently: nothing throws, the page simply refuses to move. The
 * wrapper has to be installed before the document's own scripts run.
 */
export interface ScrollListener {
  type: string;
  passive: boolean | 'default';
  on: string;
}

export async function watchScrollListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Array<{ type: string; passive: boolean | 'default'; on: string }> = [];
    (
      window as unknown as {
        __ltListeners: Array<{ type: string; passive: boolean | 'default'; on: string }>;
      }
    ).__ltListeners = seen;
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type === 'wheel' || type === 'touchmove' || type === 'touchstart') {
        const passive: boolean | 'default' =
          typeof options === 'object' && options !== null && 'passive' in options
            ? Boolean(options.passive)
            : 'default';
        const node = this as unknown as { tagName?: string; nodeName?: string };
        seen.push({
          type,
          passive,
          on:
            this === window
              ? 'window'
              : this === document
                ? 'document'
                : (node.tagName ?? node.nodeName ?? 'unknown'),
        });
      }
      original.call(this, type, listener, options as AddEventListenerOptions);
    };
  });
}

export async function readScrollListeners(page: Page): Promise<ScrollListener[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __ltListeners?: ScrollListener[] }).__ltListeners ??
      ([] as ScrollListener[]),
  );
}

/* ============================================ §17 ONE REGION = ONE INTERACTION OWNER */

/**
 * The generalised form of the bug this product has now shipped three times.
 *
 * Once it was a chapter band at `opacity: 0` with `pointer-events: auto` lying across the middle
 * of the stage, which ate "Use my camera", four Connect buttons and the first wheel tick. Once it
 * was a decorative guides overlay. Once it was the inverse: a fully visible band left untouchable
 * because a frame race put something over it. All three have the same shape — the region a person
 * is looking at is not the region that owns the input at that point — and all three were invisible
 * to every test the product had, because every one of them asked "is the control visible?" rather
 * than "is the control the thing a tap there would reach?".
 *
 * `landing-and-layout.spec.ts` had the first version of this walk, hard-coded to `/` at one
 * viewport with a 6x5 grid of fixed pixel offsets. This is that measurement generalised: any page,
 * any viewport, a grid derived from the viewport rather than from one page's layout, and a static
 * sweep for ghost layers that a grid can step straight over.
 */
export interface OwnershipViolation {
  /**
   * - `transparent`  something at or above the hit point has `opacity <= 0.05`
   * - `invisible`    something at or above it is `visibility: hidden`
   * - `ghost-layer`  a sizeable invisible element is hit-testable inside its own box
   */
  kind: 'transparent' | 'invisible' | 'ghost-layer';
  /** Where it was seen: scroll offset and viewport point. */
  at: { scrollY: number; x: number; y: number };
  /** What `elementFromPoint` actually reached there. */
  hit: string;
  /** The invisible element that is taking the input — the one that has to change. */
  culprit: string;
  /**
   * What it is taking the input FROM: the nearest thing underneath it that it neither contains
   * nor sits inside. Without a victim there is no theft, only a fade in progress.
   */
  intercepts: string;
  detail: string;
  /** How many sampled points reached this same culprit. */
  count: number;
  /**
   * Frames this violation stayed open at the position it was found, when the audit was asked to
   * measure it. `-1` means it never closed inside the cap, which is the permanent case.
   */
  framesOpen?: number;
}

export interface OwnershipOptions {
  /** Grid spacing in CSS pixels. Smaller finds thinner bands and costs more. */
  step?: number;
  /** Inset from the viewport edge, so a scrollbar is never the thing under test. */
  inset?: number;
  /** When above zero, walk the document's whole scroll range in these increments. */
  scrollStep?: number;
  /**
   * How long to let the page settle at each scroll position before sampling, in milliseconds.
   *
   * An app route is a document that sits still, and for one of those "settle, then look" is the
   * whole question. A scroll-driven page is different: on `/` the class that makes a band
   * interactive is recomputed from the band's own rendered opacity a frame or two AFTER the
   * scroll that changed it (`syncBandHits` in `public/main.ts`), so a sample taken on the frame
   * the scroll landed on catches layers in the middle of a handover rather than layers that are
   * wrong. A wall clock rather than a frame count, because the lag is scheduled by the engine.
   */
  settleMs?: number;
  /**
   * Instead of settling, measure how long each violation stays open.
   *
   * Every scroll position is sampled immediately and then re-sampled frame by frame until it
   * comes back clean; `framesOpen` carries the answer, and `-1` means it never did. That turns
   * "is this page safe" into "and for how long was it not", which is the difference that matters:
   * a handover that resolves on the next frame is not the bug that has shipped three times. The
   * bug is a layer that stays wrong until something else happens to the page, and on `/` that is
   * exactly what a dropped frame produces — see "the landing page, with a frame dropped" in
   * `interaction-ownership.spec.ts`, which reproduces it deterministically.
   */
  measureFramesToClear?: boolean;
  /**
   * Subtrees that are exempt. Every entry needs a written reason at the call site: an exemption
   * with no reason is how this class of bug came back the second time.
   */
  ignore?: readonly string[];
}

/**
 * Sample a grid of points and, for each, ask who owns the input there.
 *
 * Two refinements over the first version of this walk, both learned by running it.
 *
 * The first is the ancestor chain. A control is untouchable not only when it is itself
 * transparent but when anything it sits inside is, and in all three historical bugs the culprit
 * was an ancestor rather than the element the hit test named.
 *
 * The second is interception, and it is what makes the measurement mean something on a page that
 * animates. `/` is eight chapters of scroll-driven reveal, so at any parked scroll position some
 * element is part way through a fade, and a rule that flags "invisible and hit-testable" flags
 * every one of them. A heading at opacity 0.013 with nothing under it but its own ancestors
 * steals nothing from anybody; that is a reveal in progress, not a trap. The band that started
 * all of this was a trap for one specific reason: underneath it were "Use my camera" and four
 * Connect buttons, and it took their input. So the question asked here is the one that separates
 * those two cases — is there anything UNDER this invisible thing that it is answering for?
 */
export async function auditInteractionOwnership(
  page: Page,
  options: OwnershipOptions = {},
): Promise<OwnershipViolation[]> {
  return page.evaluate(
    async ({ step, inset, scrollStep, settleMs, measureFramesToClear, ignore }) => {
      const describe = (node: Element | null): string => {
        if (!node) return 'nothing';
        const id = node.id ? '#' + node.id : '';
        const raw = typeof node.className === 'string' ? node.className.trim() : '';
        const cls = raw ? '.' + raw.split(/\s+/).join('.') : '';
        return (node.tagName.toLowerCase() + id + cls).slice(0, 120);
      };
      const exempt = (node: Element): boolean =>
        ignore.some((selector) => node.closest(selector) !== null);

      /**
       * What `ghost` is answering for at this point, or null if it is answering only for itself.
       *
       * `elementsFromPoint` returns the whole hit-test stack, topmost first, and that stack
       * contains the ghost's own ancestors — which are not victims: a faint element sitting
       * inside its own section, over nothing but that section, intercepts nothing. Anything in
       * the stack that is neither an ancestor nor a descendant of the ghost is genuinely
       * underneath it and is genuinely being answered for.
       */
      const intercepted = (ghost: Element, x: number, y: number): Element | null => {
        const stack = document.elementsFromPoint(x, y);
        const from = stack.indexOf(ghost);
        const below = from === -1 ? stack : stack.slice(from + 1);
        for (const node of below) {
          if (node === ghost) continue;
          if (node.contains(ghost) || ghost.contains(node)) continue;
          if (node === document.documentElement || node === document.body) continue;
          return node;
        }
        return null;
      };

      const found = new Map<string, OwnershipViolation>();
      const add = (v: Omit<OwnershipViolation, 'count'>): void => {
        const key = v.kind + '|' + v.culprit;
        const seen = found.get(key);
        if (seen) seen.count += 1;
        else found.set(key, { ...v, count: 1 });
      };

      const collect = (): Array<Omit<OwnershipViolation, 'count'>> => {
        const here: Array<Omit<OwnershipViolation, 'count'>> = [];
        const add = (v: Omit<OwnershipViolation, 'count'>): void => void here.push(v);
        /* The grid comes from the viewport, so 390x844 is sampled as densely as 1440x900. */
        for (let x = inset; x < innerWidth - inset; x += step) {
          for (let y = inset; y < innerHeight - inset; y += step) {
            const el = document.elementFromPoint(x, y);
            if (!el || exempt(el)) continue;
            for (
              let node: Element | null = el;
              node && node !== document.documentElement;
              node = node.parentElement
            ) {
              const cs = getComputedStyle(node);
              const faint = Number.parseFloat(cs.opacity) <= 0.05;
              const gone = cs.visibility === 'hidden' || cs.visibility === 'collapse';
              if (!faint && !gone) continue;
              const victim = intercepted(node, x, y);
              if (victim) {
                add({
                  kind: faint ? 'transparent' : 'invisible',
                  at: { scrollY: Math.round(scrollY), x, y },
                  hit: describe(el),
                  culprit: describe(node),
                  intercepts: describe(victim),
                  detail: faint
                    ? 'opacity ' +
                      cs.opacity +
                      ' and still hit-testable (pointer-events: ' +
                      cs.pointerEvents +
                      ')'
                    : 'visibility: ' + cs.visibility + ' and still hit-testable',
                });
              }
              break;
            }
          }
        }

        /*
         * A grid can step straight over a 40px band, and two of the three historical bugs were
         * bands. So every element big enough to matter is also checked directly: its effective
         * opacity (its own times every ancestor's), then points across its own box, asking the
         * same interception question at each.
         */
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const r = el.getBoundingClientRect();
          if (r.width * r.height < 2500) continue;
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
          if (exempt(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.pointerEvents === 'none') continue;
          let effective = 1;
          for (let node: Element | null = el; node; node = node.parentElement) {
            effective *= Number.parseFloat(getComputedStyle(node).opacity) || 0;
          }
          if (effective > 0.05) continue;
          for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
            const px = Math.min(innerWidth - 1, Math.max(0, r.left + r.width * fx));
            const py = Math.min(innerHeight - 1, Math.max(0, r.top + r.height * 0.5));
            const hit = document.elementFromPoint(px, py);
            if (!hit || !(hit === el || el.contains(hit))) continue;
            const victim = intercepted(el, px, py);
            if (!victim) continue;
            add({
              kind: 'ghost-layer',
              at: { scrollY: Math.round(scrollY), x: Math.round(px), y: Math.round(py) },
              hit: describe(hit),
              culprit: describe(el),
              intercepts: describe(victim),
              detail:
                'effective opacity ' +
                effective.toFixed(3) +
                ', ' +
                Math.round(r.width) +
                'x' +
                Math.round(r.height) +
                ', pointer-events: ' +
                cs.pointerEvents,
            });
            break;
          }
        }
        return here;
      };

      /** One position: settle and take it, or take it now and time how long it stays wrong. */
      const sample = async (): Promise<void> => {
        if (!measureFramesToClear) {
          if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
          for (const v of collect()) add(v);
          return;
        }
        const here = collect();
        if (here.length === 0) return;
        let frames = 0;
        const CAP = 120;
        while (frames < CAP) {
          await new Promise((r) => requestAnimationFrame(r));
          frames += 1;
          if (collect().length === 0) break;
        }
        for (const v of here) add({ ...v, framesOpen: frames >= CAP ? -1 : frames });
      };

      if (scrollStep > 0) {
        const max = document.documentElement.scrollHeight - innerHeight;
        for (let y = 0; y <= max; y += scrollStep) {
          scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await sample();
        }
        scrollTo({ top: 0, behavior: 'instant' });
      } else {
        await sample();
      }
      return Array.from(found.values());
    },
    {
      step: options.step ?? 64,
      inset: options.inset ?? 6,
      scrollStep: options.scrollStep ?? 0,
      settleMs: options.settleMs ?? 250,
      measureFramesToClear: options.measureFramesToClear ?? false,
      ignore: [...(options.ignore ?? [])],
    },
  );
}

/**
 * Anything an assistive technology is told does not exist, that a keyboard can still land on.
 *
 * §17's "decorative elements must not receive input" has a half a hit test cannot see: a
 * decorative wrapper marked `aria-hidden="true"` around something focusable is a control that
 * exists for a mouse and does not exist for a screen reader. It is a static property of the
 * document, so it is measured as one.
 */
export async function focusableInsideAriaHidden(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
    const describe = (node: Element): string => {
      const id = node.id ? '#' + node.id : '';
      const raw = typeof node.className === 'string' ? node.className.trim() : '';
      return (node.tagName.toLowerCase() + id + (raw ? '.' + raw.split(/\s+/).join('.') : '')).slice(
        0,
        120,
      );
    };
    const bad: string[] = [];
    for (const host of Array.from(document.querySelectorAll('[aria-hidden="true"]'))) {
      const cs = getComputedStyle(host);
      // Genuinely removed from the page is fine: nothing can be focused inside `display: none`.
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      for (const control of Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE))) {
        if (control.offsetParent === null && getComputedStyle(control).position !== 'fixed') continue;
        bad.push(describe(control) + ' inside aria-hidden ' + describe(host));
      }
    }
    return bad;
  });
}

/* ================================================================= §18 the END invariant */

/** Every control that can act on the broadcast, in whichever state the production is in. */
export const STOP_CONTROL = '[data-lt-stop], .lt-golive';

export interface StopReport {
  /** How many candidate controls have a real box on the screen. Exactly one is correct. */
  found: number;
  /** Is any candidate in the DOM at all, box or no box? */
  present: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  /** Is the element at the centre of that box this control? */
  onTop: boolean;
  /** Is the whole control inside the window, not merely intersecting it? */
  inView: boolean;
  /** What the hit test actually reached, so a failure names the culprit. */
  hitBy: string;
  /** Which control it is: `end`, `undo`, `cancel-start`, or Studio's own `go-live`. */
  which: string;
  label: string;
}

/**
 * Hit-test the one control that can act on the broadcast right now.
 *
 * `elementFromPoint` at the control's own centre is the only measurement that answers the question
 * actually being asked. Visible is not enough: an auditor watched a primary button hand its click
 * to the live control underneath it. A bounding box is not enough either: a control can be on the
 * page and 629px below the fold, which is exactly where this one was at 834x1112.
 */
export async function hitTestStop(page: Page): Promise<StopReport> {
  return page.evaluate((selector) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
    const el = visible[0];
    if (!el) {
      return {
        found: 0,
        present: all.length > 0,
        box: null,
        onTop: false,
        inView: false,
        hitBy: 'nothing',
        which: 'none',
        label: '',
      };
    }
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const describe = (node: Element | null): string => {
      if (!node) return 'nothing (the centre is outside the window)';
      const id = node.id ? '#' + node.id : '';
      const raw = typeof node.className === 'string' ? node.className.trim() : '';
      return node.tagName.toLowerCase() + id + (raw ? '.' + raw.split(/\s+/).join('.') : '');
    };
    return {
      found: visible.length,
      present: true,
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      onTop: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
      inView:
        r.top >= 0 &&
        r.left >= 0 &&
        r.bottom <= window.innerHeight + 0.5 &&
        r.right <= window.innerWidth + 0.5,
      hitBy: describe(hit),
      which: el.getAttribute('data-lt-stop') ?? (el.closest('.lt-golive') ? 'go-live' : 'unknown'),
      label: (el.textContent ?? '').trim().slice(0, 48),
    };
  }, STOP_CONTROL);
}

/** The three things §18 asks of the stop control, in one assertion each. */
export function assertStopReachable(report: StopReport, where: string): void {
  expect(report.found, `${where}: no stop control is on the screen at all`).toBeGreaterThan(0);
  expect(
    report.inView,
    `${where}: the stop control is clipped or off-screen, box ${JSON.stringify(report.box)}`,
  ).toBe(true);
  expect(
    report.onTop,
    `${where}: a tap at the centre of the stop control reaches ${report.hitBy} instead`,
  ).toBe(true);
}

/**
 * How many Tab presses from the top of the document it takes to land on `selector`.
 *
 * Returns `-1` when the control is not in the tab order at all, which is the failure that
 * matters: a stop control a mouse can reach and a keyboard cannot is not "always available". The
 * walk starts from a blurred document, so the first Tab lands on the page's first focusable
 * element exactly as it does for a person who has just arrived.
 */
export async function tabsToReach(page: Page, selector: string, max = 60): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(
      (sel) => Boolean(document.activeElement?.closest(sel)),
      selector,
    );
    if (landed) return i;
  }
  return -1;
}

/* ============================================================== seeding a set-up app */

export type SeedFormat = '16:9' | '9:16' | '1:1';
export type SeedMode = 'simple' | 'pro';

export interface SeedOptions {
  format?: SeedFormat;
  mode?: SeedMode;
  /** How many mock destinations to hand the app, 0 to 3. */
  destinations?: 0 | 1 | 2 | 3;
  /** Record that the §37 real-broadcast sentence has been read. Harmless on a mock build. */
  ack?: boolean;
  /**
   * Answer the Quick Tour offer before the page opens.
   *
   * Left alone this is a first visit, offer and all, which is the state most worth testing. Set
   * it when the measurement is about the product at rest and the offer would be a confound —
   * `interaction-ownership.spec.ts` has one such case, and names the defect it is working around
   * in its own test rather than hiding it here.
   */
  tourAnswered?: boolean;
}

const SEED_PLATFORMS = [
  { id: 'yt-seed', platform: 'youtube', label: 'YouTube' },
  { id: 'tt-seed', platform: 'tiktok', label: 'TikTok' },
  { id: 'tw-seed', platform: 'twitch', label: 'Twitch' },
];

/**
 * Open the application already set up, so a large matrix does not pay for onboarding every cell.
 *
 * Nothing here is a fixture standing in for the product: these are the same `livetap.*` keys the
 * app writes for itself, read back by the same `persist.ts`, and the destinations come back
 * through the real restore path and connect through the real mock adapters.
 */
export async function seedApp(page: Page, options: SeedOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ aspect, density, howMany, ack, tourAnswered, seeds }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem('livetap.intent', JSON.stringify('talking'));
      window.localStorage.setItem('livetap.onboarding', JSON.stringify(true));
      window.localStorage.setItem('livetap.mode', JSON.stringify(density));
      if (ack) window.localStorage.setItem('livetap.realBroadcastAck', JSON.stringify(true));
      // The same key `Tour.tsx` writes when the offer is answered either way.
      if (tourAnswered) window.localStorage.setItem('livetap.tour.answered', 'true');
      window.localStorage.setItem(
        'livetap.settings',
        JSON.stringify({ quality: 'auto', recordEveryStream: false, aspect }),
      );
      window.localStorage.setItem(
        'livetap.destinations',
        JSON.stringify(
          seeds.slice(0, howMany).map((seed) => ({
            id: seed.id,
            platform: seed.platform,
            label: seed.label,
            aspectRatio: aspect,
            enabled: true,
            mock: true,
          })),
        ),
      );
    },
    {
      aspect: options.format ?? '16:9',
      density: options.mode ?? 'simple',
      howMany: options.destinations ?? 2,
      ack: options.ack ?? true,
      tourAnswered: options.tourAnswered ?? false,
      seeds: SEED_PLATFORMS,
    },
  );
}

/**
 * An interactive control that a tap at its own centre would not actually reach.
 *
 * §17's first sentence is "interactive controls must never overlap accidentally", and the audit
 * that produced §17 found every overlap by hand, one control at a time: a primary button handing
 * its click to the live control underneath it, four Connect buttons under an invisible band, a
 * "Stop this destination" that fired the format control instead. {@link unreachableControls} asks
 * that question of every control on the screen at once.
 */
export interface CoveredControl {
  control: string;
  label: string;
  covered: string;
  at: { x: number; y: number };
}

/**
 * Controls that are covered wherever the creator scrolls — the ones that are genuinely lost.
 *
 * "Is this control reachable right now" is the right question for a fixed moment — a modal is
 * open, a broadcast is running — and the wrong one for a page at rest, which is why the answer is
 * given over a whole page rather than at one position. Every pinned bar in this product covers
 * whatever is under it at the scroll
 * position it happens to be at, and that is not a defect: `.lt-shell__main` reserves
 * `--lt-golivebar-reserve` below the column precisely so the Moment strip and the dock can be
 * scrolled clear of the pinned GO LIVE bar. Reporting those would be reporting the design.
 *
 * What is a defect is a control that is covered at EVERY scroll position it can be seen at,
 * because then there is no gesture that reaches it. So the page is walked, each control is
 * judged at every position where its whole box is on screen, and only the ones that are never
 * free are returned.
 */
export async function unreachableControls(
  page: Page,
  options: { scrollStep?: number } = {},
): Promise<CoveredControl[]> {
  return page.evaluate(async (scrollStep) => {
    const SELECTOR =
      'button, a[href], input, select, textarea, summary, [role="switch"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const describe = (node: Element | null): string => {
      if (!node) return 'nothing';
      const id = node.id ? '#' + node.id : '';
      const raw = typeof node.className === 'string' ? node.className.trim() : '';
      return (node.tagName.toLowerCase() + id + (raw ? '.' + raw.split(/\s+/).join('.') : '')).slice(
        0,
        100,
      );
    };

    const seen = new Map<Element, { free: boolean; worst: CoveredControl | null }>();
    const start = scrollY;
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    /*
     * `scrollStep` of zero means "here, where the page is": the right question when the subject
     * is the moment a creator arrives rather than the page as a whole.
     */
    const stops: number[] = [];
    if (scrollStep > 0) {
      for (let y = 0; y <= max; y += scrollStep) stops.push(y);
      if (stops[stops.length - 1] !== max) stops.push(max);
    } else {
      stops.push(start);
    }
    for (const y of stops) {
      if (scrollStep > 0) {
        scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') {
          continue;
        }
        const x = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, cy);
        const free = Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
        const rec = seen.get(el) ?? { free: false, worst: null };
        if (free) rec.free = true;
        else if (!rec.worst) {
          rec.worst = {
            control: describe(el),
            label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
            covered: describe(hit),
            at: { x: Math.round(x), y: Math.round(cy) },
          };
        }
        seen.set(el, rec);
      }
    }
    if (scrollStep > 0) scrollTo({ top: start, behavior: 'instant' });

    const lost: CoveredControl[] = [];
    for (const rec of seen.values()) if (!rec.free && rec.worst) lost.push(rec.worst);
    return lost;
  }, options.scrollStep ?? 150);
}
