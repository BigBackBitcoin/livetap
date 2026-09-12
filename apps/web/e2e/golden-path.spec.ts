import { expect, test } from '@playwright/test';
import { PROTOCOL_WORDS, Taps, freshFirstRun, reachStudio } from './helpers.js';

/**
 * THE GOLDEN PATH.
 *
 * This is the product's only real quality bar: a first-time creator reaches LIVE in six taps
 * from the app's first screen, and meets no protocol vocabulary on the way. If this test starts
 * failing, LIVETAP has become a prettier version of what it was built to replace.
 */
test('a first-time creator reaches LIVE in six taps and never meets a protocol word', async ({
  page,
}) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  const seen: string[] = [];

  await page.goto('/app');

  // Step 1 — what are you making?
  await expect(page.getByRole('heading', { name: 'What are you making?' })).toBeVisible();
  seen.push((await page.locator('body').innerText()) ?? '');
  await taps.click('Talking');

  // Step 2 — where are you going live?
  await expect(page.getByRole('heading', { name: 'Where are you going live?' })).toBeVisible();
  seen.push(await page.locator('body').innerText());
  await taps.click(/^YouTube/);
  await taps.click(/^TikTok/);
  await taps.click('Continue');

  // Step 3 — camera and mic, and the setup LIVETAP chose.
  await expect(page.getByRole('heading', { name: 'Camera and mic' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Here is your setup' })).toBeVisible();
  await expect(page.getByText('YouTube 16:9')).toBeVisible();
  await expect(page.getByText('TikTok 9:16')).toBeVisible();
  await expect(page.getByText('No camera found — using a test pattern')).toBeVisible();
  seen.push(await page.locator('body').innerText());
  await taps.click('Open Studio');

  // Studio.
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible();
  seen.push(await page.locator('body').innerText());

  // GO LIVE — the sixth tap. The countdown wait afterwards is not a tap.
  await taps.click('Go live');
  await expect(page.getByText('Cancel')).toBeVisible();

  const chips = page.getByLabel('Where this stream is going');
  await expect(chips.getByText('YouTube · Live')).toBeVisible({ timeout: 25_000 });
  await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 25_000 });
  seen.push(await page.locator('body').innerText());

  // THE MEASUREMENT.
  expect(taps.taps, `taps from /app to LIVE: ${taps.taps}`).toBeLessThanOrEqual(6);

  // THE OTHER MEASUREMENT: zero protocol words on any screen of the path.
  for (const [index, text] of seen.entries()) {
    const match = PROTOCOL_WORDS.exec(text);
    expect(match?.[0], `screen ${index + 1} leaked "${match?.[0]}"`).toBeUndefined();
  }

  // Five screens seen from first launch to on air, including Studio twice (idle and live).
  expect(seen.length).toBe(5);

  // Demo mode is impossible to mistake for a real broadcast.
  await expect(page.getByText(/Demo mode/)).toBeVisible();
});

test('the countdown is cancellable, and cancelling tells no platform anything', async ({ page }) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  await page.getByRole('button', { name: 'Go live' }).click();
  await expect(page.getByText('Cancel')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible();
  await expect(page.getByLabel('Where this stream is going').getByText('YouTube · Ready')).toBeVisible();
});

test('keyboard only: tab to GO LIVE and press Enter', async ({ page }) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  const goLive = page.getByRole('button', { name: 'Go live' });
  await expect(goLive).toBeVisible();

  // Walk the tab order until GO LIVE takes focus. If it is unreachable, this loop ends and the
  // assertion below fails — which is exactly the bug it is guarding against.
  let focused = false;
  for (let i = 0; i < 60 && !focused; i += 1) {
    await page.keyboard.press('Tab');
    focused = await goLive.evaluate((el) => el === document.activeElement);
  }
  expect(focused, 'GO LIVE is reachable by keyboard alone').toBe(true);

  await page.keyboard.press('Enter');
  await expect(page.getByText('Cancel')).toBeVisible();
  await expect(
    page.getByLabel('Where this stream is going').getByText('YouTube · Live'),
  ).toBeVisible({ timeout: 25_000 });
});
