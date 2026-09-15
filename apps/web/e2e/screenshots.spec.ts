import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Taps, freshFirstRun, reachStudio } from './helpers.js';

/**
 * Hold the page still, then let it be photographed.
 *
 * Twenty-one of the screenshots committed to this directory were BLANK - every `destinations`,
 * `moments`, `not-found`, `privacy`, `recordings`, `settings` and `terms` at all three widths -
 * and had been for as long as anyone had been looking at them. Nothing caught it, because these
 * captures are artefacts rather than assertions: nothing compares them to anything, so a picture
 * of an empty page passes exactly as well as a picture of the product.
 *
 * The cause is that `page.goto()` resolves on `load`, and these are client-rendered routes, so
 * `load` fires before React has put anything on the screen. Four of the routes had a 300 ms sleep
 * that was sometimes enough; `/privacy`, `/terms` and the 404 had no wait at all and were
 * photographed mid-navigation.
 *
 * Every screen captured here has exactly one `<h1>`, so a visible `h1` is the honest signal that
 * this route has rendered. `document.fonts.ready` matters for the same reason: a capture taken
 * before the typeface arrives is a picture of the fallback, which is not what this product looks
 * like and which also made these files churn on every run.
 *
 * Pausing the video is what makes the rest of it repeatable. The landing stage plays a clip, and
 * every destination thumbnail composites from that same clip, so one paused source freezes the
 * whole page. The seek is guarded because a MediaStream-backed element has no seekable timeline
 * and throws.
 */
async function frozen(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const video of Array.from(document.querySelectorAll('video'))) {
      video.pause();
      try {
        video.currentTime = 1;
      } catch {
        /* A live MediaStream cannot be sought. Pausing it is enough. */
      }
    }
    await document.fonts.ready;
  });
}

/**
 * `frozen`, plus the wait that says this route has rendered at all.
 *
 * Only for the screens that had no readiness signal of their own. Studio and the onboarding steps
 * already wait on something real - a named heading, the Go live button - and Studio's own heading
 * is screen-reader-only, so asking for a visible `h1` there would time out on a page that is
 * perfectly ready.
 */
async function still(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
  await frozen(page);
}

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

  /*
   * These rewrite files that are committed, so they do not run unless asked.
   *
   * Measured, twice, from a clean tree: with every capture waiting for a rendered page and the
   * demo clip paused, 14 of 41 files still differed between two consecutive runs. Under reduced
   * motion as well, 11 still did. The survivors are every screen carrying the engine's preview -
   * Studio, Moments, the third onboarding step - and that canvas is a test pattern drawn on
   * `requestAnimationFrame`, so a still photograph of it is a photograph of whatever millisecond
   * the shutter opened on. Nothing short of masking the product's own picture, or changing the
   * product to hold it still, makes those bytes repeatable.
   *
   * So they are not made repeatable; they are made deliberate. Nothing asserts on these files -
   * they are artefacts for review - which is the whole reason it was possible for twenty-one of
   * them to sit in the repository completely blank without anyone noticing. Regenerating them is
   * now something a person chooses to do and then looks at:
   *
   *     LIVETAP_CAPTURE=1 npx playwright test screenshots
   *
   * The two visual BASELINES below are unaffected and still run on every `npx playwright test`.
   * They are the ones that assert, they tolerate the moving parts with a pixel budget and a mask,
   * and they are what actually stops a visual regression shipping.
   */
  test.skip(
    process.env.LIVETAP_CAPTURE !== '1',
    'Documentation captures rewrite committed files. Run with LIVETAP_CAPTURE=1 to regenerate.',
  );

  for (const viewport of VIEWPORTS) {
    test(`captured at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await freshFirstRun(page);

      /*
       * The landing is a fixed live surface driven by scroll, so a full-page capture of an
       * 11,500px document is mostly empty. One viewport is the frame a person actually judges
       * the page by, and the frame that is captured is the one the guided five seconds stops
       * at: every destination it was going to connect is Ready and the hand-over line is under
       * GO LIVE. Waiting for that attribute rather than for a duration is what makes the shot
       * the same shot every run.
       */
      await page.goto('/');
      await page.waitForSelector('html.sc-ready');
      await page.waitForSelector('[data-lt-golive-sub][data-lt-yourturn="true"]');
      await still(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/__screenshots__/landing-${viewport.name}.png` });

      await page.goto('/app');
      await page.getByRole('heading', { name: 'What are you making?' }).waitFor();
      await frozen(page);
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-1-${viewport.name}.png`, fullPage: true });

      const taps = new Taps(page);
      await taps.click('Talking');
      await page.getByRole('heading', { name: 'Where are you going live?' }).waitFor();
      await frozen(page);
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-2-${viewport.name}.png`, fullPage: true });

      await taps.click(/^YouTube/);
      await taps.click(/^TikTok/);
      await taps.click('Continue');
      await page.getByRole('heading', { name: 'Here is your setup' }).waitFor();
      await frozen(page);
      await page.screenshot({ path: `e2e/__screenshots__/onboarding-3-${viewport.name}.png`, fullPage: true });

      await taps.click('Open Studio');
      await page.getByRole('button', { name: 'Go live' }).waitFor();
      await frozen(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/__screenshots__/studio-${viewport.name}.png`, fullPage: true });

      for (const [route, name] of [
        ['/app/destinations', 'destinations'],
        ['/app/moments', 'moments'],
        ['/app/settings', 'settings'],
        ['/app/recordings', 'recordings'],
      ] as const) {
        await page.goto(route);
        await still(page);
        await page.screenshot({ path: `e2e/__screenshots__/${name}-${viewport.name}.png`, fullPage: true });
      }

      await page.goto('/privacy');
      await still(page);
      await page.screenshot({ path: `e2e/__screenshots__/privacy-${viewport.name}.png`, fullPage: true });
      await page.goto('/terms');
      await still(page);
      await page.screenshot({ path: `e2e/__screenshots__/terms-${viewport.name}.png`, fullPage: true });
      await page.goto('/oauth/callback');
      await page.getByText(/not set up on this deployment/).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `e2e/__screenshots__/oauth-callback-${viewport.name}.png`, fullPage: true });
      await page.goto('/definitely-not-a-page');
      await still(page);
      await page.screenshot({ path: `e2e/__screenshots__/not-found-${viewport.name}.png`, fullPage: true });
    });
  }
});

test.describe('visual baselines', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * The landing's baseline is shot under reduced motion at the moment the guided five seconds
   * hands over, because the page is a running surface: without a state to wait on, the baseline
   * would be a different frame every run. Reduced motion holds the demo clip on one frame and
   * stops the output previews looping, and it is also the accessibility path, so the frame that
   * is frozen here is the one that has to keep working.
   */
  test('landing at desktop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await expect(page.locator('[data-lt-golive-sub]')).toHaveAttribute(
      'data-lt-yourturn',
      'true',
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="READY"]')).toHaveCount(3);
    /* The one thing still moving is the microphone meter, so it is masked out. */
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('baseline-landing-desktop.png', {
      mask: [page.locator('[data-lt-meter]')],
    });
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
