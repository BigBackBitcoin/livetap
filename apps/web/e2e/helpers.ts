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
