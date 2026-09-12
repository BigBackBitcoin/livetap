import { expect, test } from '@playwright/test';
import { Taps, freshFirstRun, reachStudio } from './helpers.js';

/**
 * The paste-a-key path is not a workaround: for four of the nine platforms it is the only path
 * that exists. It gets the same standard of error message as everything else — the mistake and
 * the fix, in that order.
 */
test('a bad server address is refused inline; a good one reaches READY', async ({ page }) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  await page.getByRole('link', { name: 'Destinations' }).first().click();
  await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();

  await page.getByRole('button', { name: /Add destination/ }).click();
  await page.getByRole('button', { name: /^Custom RTMP/ }).click();

  const url = page.getByLabel('Server address');
  const key = page.getByLabel('Stream key');

  // A web page address is the commonest mistake, and the message names the fix.
  await url.fill('https://twitch.tv/latenightbuild');
  await key.fill('live_abc_123');
  await page.getByRole('button', { name: 'Save this destination' }).click();
  await expect(page.getByText(/That looks like a web page address/)).toBeVisible();

  // A key with a space in it is the second commonest.
  await url.fill('rtmp://live.example.com/app');
  await key.fill('live_abc 123');
  await page.getByRole('button', { name: 'Save this destination' }).click();
  await expect(page.getByText(/Copy it again/)).toBeVisible();

  // A good one connects, and the card never shows the key again.
  await key.fill('live_abc_123456');
  await page.getByRole('button', { name: 'Name for this destination' }).count();
  await page.getByLabel('Name for this destination').fill('My own server');
  await page.getByRole('button', { name: 'Save this destination' }).click();

  const card = page.locator('.lt-destcard', { hasText: 'My own server' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('live_abc_123456');
});
