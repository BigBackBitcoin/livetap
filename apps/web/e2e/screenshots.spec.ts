import { expect, test } from '@playwright/test';
import { Taps, freshFirstRun, reachStudio } from './helpers.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/**
 * Every screen at every breakpoint, captured into `e2e/__screenshots__/` and committed.
 *
 * The landing and Studio at desktop are additionally visual baselines (`toHaveScreenshot`), so
 * a change to either has to be looked at by a person before it ships. The rest are captured as
 * artefacts for review rather than asserted, because a product this young should not have every
 * pixel frozen — only the two surfaces a first-time creator judges it by.
 */
test.describe('screens', () => {
  // Each of these walks the whole product at one width, so it needs more than the default.
  test.setTimeout(180_000);

  for (const viewport of VIEWPORTS) {
    test(`captured at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await freshFirstRun(page);

      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.screenshot({
        path: `e2e/__screenshots__/landing-${viewport.name}.png`,
        fullPage: true,
      });

      await page.goto('/app');
      await page.getByRole('heading', { name: 'What are you making?' }).waitFor();
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-1-${viewport.name}.png`, fullPage: true });

      const taps = new Taps(page);
      await taps.click('Talking');
      await page.getByRole('heading', { name: 'Where are you going live?' }).waitFor();
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-2-${viewport.name}.png`, fullPage: true });

      await taps.click(/^YouTube/);
      await taps.click(/^TikTok/);
      await taps.click('Continue');
      await page.getByRole('heading', { name: 'Here is your setup' }).waitFor();
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-3-${viewport.name}.png`, fullPage: true });

      await taps.click('Open Studio');
      await page.getByRole('button', { name: 'Go live' }).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/__screenshots__/studio-${viewport.name}.png`, fullPage: true });

      for (const [route, name] of [
        ['/app/destinations', 'destinations'],
        ['/app/moments', 'moments'],
        ['/app/settings', 'settings'],
        ['/app/recordings', 'recordings'],
      ] as const) {
        await page.goto(route);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `e2e/__screenshots__/${name}-${viewport.name}.png`, fullPage: true });
      }

      await page.goto('/privacy');
      await page.screenshot({ path: `e2e/__screenshots__/privacy-${viewport.name}.png`, fullPage: true });
      await page.goto('/terms');
      await page.screenshot({ path: `e2e/__screenshots__/terms-${viewport.name}.png`, fullPage: true });
      await page.goto('/oauth/callback');
      await page.getByText(/not set up on this deployment/).waitFor();
      await page.screenshot({ path: `e2e/__screenshots__/oauth-callback-${viewport.name}.png`, fullPage: true });
      await page.goto('/definitely-not-a-page');
      await page.screenshot({ path: `e2e/__screenshots__/not-found-${viewport.name}.png`, fullPage: true });
    });
  }
});

test.describe('visual baselines', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('landing at desktop', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('baseline-landing-desktop.png', { fullPage: true });
  });

  test('studio at desktop', async ({ page }) => {
    await freshFirstRun(page);
    const taps = new Taps(page);
    await reachStudio(page, taps);
    await page.waitForTimeout(600);
    // The preview is a moving test pattern, so it is masked out of the comparison.
    await expect(page).toHaveScreenshot('baseline-studio-desktop.png', {
      mask: [page.locator('.lt-preview')],
    });
  });
});
