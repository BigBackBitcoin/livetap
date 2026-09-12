import { expect, test } from '@playwright/test';
import { Taps, freshFirstRun, reachStudio } from './helpers.js';

/**
 * Tenet 7: one destination's failure is that destination's problem.
 *
 * This is the differentiator that is hardest to claim and easiest to check. The demo control
 * raises the *same* engine event a real dropped connection raises, so what this test watches is
 * the orchestrator's real isolation and reconnect logic, not a UI simulation.
 */
test('one destination drops, reconnects and comes back — while the other never leaves LIVE', async ({
  page,
}) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  await page.getByRole('button', { name: 'Go live' }).click();
  // One list, in the dock's Destinations tab, which is the tab Studio opens on (§5c revision).
  const chips = page.getByLabel('Where this stream is going');
  await expect(chips.getByText('YouTube · Live')).toBeVisible({ timeout: 25_000 });
  await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 25_000 });

  // Watch YouTube for the whole episode: it must never stop being live.
  const youtubeLive = chips.getByText('YouTube · Live');

  await page.getByRole('tab', { name: 'Health' }).click();
  await page.getByRole('button', { name: 'Drop TikTok' }).click();
  await page.getByRole('tab', { name: 'Destinations' }).click();

  // TikTok goes RECONNECTING…
  await expect(chips.getByText('TikTok · Reconnecting')).toBeVisible({ timeout: 10_000 });
  await expect(youtubeLive).toBeVisible();

  // …and the humane error card shows all four fields, with one primary action.
  const card = page.locator('.lt-errorcard').first();
  await expect(card).toBeVisible();
  const cardText = await card.innerText();
  expect(cardText).toContain('stopped receiving your stream');
  expect(cardText.toLowerCase()).toContain('dropped');
  expect(cardText).toContain('LIVETAP');
  expect(cardText).toMatch(/You can/i);
  await expect(card.getByRole('button', { name: 'Keep trying' })).toBeVisible();

  /*
   * The card's one footer affordance (PRODUCT_SPEC §4.1): the primary button confirms what the
   * machine is already doing, and "Stop trying" is the only way out of it.
   */
  await expect(card.getByRole('button', { name: 'Stop trying' })).toBeVisible();

  /*
   * The outage is scripted to last about four seconds so the card above can actually be read
   * (PRODUCT_REVIEW P2-11), and the chip counts the wait down in words while it lasts.
   */
  await expect(chips.getByText(/Trying again in \d+ s \(attempt 1 of 10\)/)).toBeVisible({
    timeout: 10_000,
  });

  // …then it comes back on its own, and YouTube still never moved.
  await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 30_000 });
  await expect(youtubeLive).toBeVisible();
});

test('a degraded destination says what viewers will notice, and stays live', async ({ page }) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  await page.getByRole('button', { name: 'Go live' }).click();
  const chips = page.getByLabel('Where this stream is going');
  await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 25_000 });

  await page.getByRole('tab', { name: 'Health' }).click();
  await page.getByRole('button', { name: 'Make TikTok rough' }).click();
  await page.getByRole('tab', { name: 'Destinations' }).click();

  await expect(chips.getByText('TikTok · Live, rough')).toBeVisible({ timeout: 10_000 });
  await expect(chips.getByText('YouTube · Live')).toBeVisible();
  // Still live: a rough destination is not a stopped one.
  await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible();
});
