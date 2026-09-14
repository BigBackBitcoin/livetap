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
