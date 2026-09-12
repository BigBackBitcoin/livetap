import { expect, test } from '@playwright/test';
import { Taps, freshFirstRun, hasHorizontalOverflow, reachStudio } from './helpers.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('landing', () => {
  test('renders the promise, and every internal link resolves', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tap GO LIVE');
    await expect(page.getByText('Free. Open source. No account needed.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What LIVETAP is' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Why it is easier' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /How going live in several places/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Get LIVETAP' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Why open source matters here' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/BigBackBitcoin/livetap');

    // The diagram is a real image with a real description, not decoration.
    await expect(page.getByRole('img', { name: /LIVETAP composes your Moment/ })).toBeVisible();

    // Every internal link goes somewhere that is not the not-found page.
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
      Array.from(new Set(links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''))),
    );
    expect(hrefs.length).toBeGreaterThan(2);
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByText('That page moved')).toHaveCount(0);
      await page.goto('/');
    }
  });

  test('has no horizontal overflow at any width', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForTimeout(150);
      expect(await hasHorizontalOverflow(page), `landing overflows at ${viewport.name}`).toBe(false);
    }
  });

  test('the not-found page names itself and offers the way back', async ({ page }) => {
    await page.goto('/definitely-not-a-page');
    await expect(page.getByText('That page moved')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Studio' })).toBeVisible();
  });

  test('privacy and terms say something specific, not boilerplate', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
    await expect(page.getByText(/never written to local storage/)).toBeVisible();

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms', level: 1 })).toBeVisible();
    await expect(page.getByText(/MIT licence/)).toBeVisible();
  });
});

test.describe('layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`onboarding and studio do not scroll sideways at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await freshFirstRun(page);

      await page.goto('/app');
      await page.getByRole('heading', { name: 'What are you making?' }).waitFor();
      await page.waitForTimeout(150);
      expect(await hasHorizontalOverflow(page), `onboarding overflows at ${viewport.name}`).toBe(
        false,
      );

      const taps = new Taps(page);
      await reachStudio(page, taps);
      await page.waitForTimeout(250);
      expect(await hasHorizontalOverflow(page), `studio overflows at ${viewport.name}`).toBe(false);
    });
  }
});

test('the theme choice survives a reload', async ({ page }) => {
  await freshFirstRun(page);
  const taps = new Taps(page);
  await reachStudio(page, taps);

  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
