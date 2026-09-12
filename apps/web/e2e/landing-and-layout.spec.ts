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

    // The diagram is a real image with a real description, not decoration. There are two
    // drawings (wide and tall) and CSS shows one, so exactly one is in the accessibility tree.
    await expect(page.getByRole('img', { name: /LIVETAP composes your Moment/ })).toHaveCount(1);
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

  /**
   * The landing carries no framework.
   *
   * This is the assertion behind the budget in `docs/qa/FRICTION_BENCHMARK.md` §6: a React
   * landing cannot meet 60 KB gzipped however well it is split, because React 19's DOM renderer
   * alone is 69.2 KB. If a script ever creeps back onto `/`, the page has quietly lost its
   * budget again and this fails rather than a number in a document going stale.
   */
  test('ships no framework: one 1 KB script, and nothing rendered by JavaScript', async ({
    page,
  }) => {
    await page.goto('/');
    const scripts = await page
      .locator('script')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          src: (node as HTMLScriptElement).getAttribute('src') ?? '',
          type: (node as HTMLScriptElement).getAttribute('type') ?? '',
          inline: ((node as HTMLScriptElement).textContent ?? '').trim().length,
        })),
      );
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe('/theme.js');
    // Not a module: it has to run before first paint so a chosen theme never flashes.
    expect(scripts[0]?.type).toBe('');
    // Inline script would be blocked by the deployed CSP (`script-src 'self'`).
    expect(scripts[0]?.inline).toBe(0);

    // The whole page is in the served HTML, not built by a renderer.
    const served = await (await page.request.get('/')).text();
    expect(served).toContain('Connect your accounts.');
    expect(served).toContain('Why open source matters here');
    expect(served).not.toContain('id="root"');
  });

  /**
   * A theme chosen inside the app is honoured on the marketing page too — the one thing on `/`
   * that needs a script, and the reason `theme.js` exists.
   */
  test('carries a theme the visitor chose in the app', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'system'));
    await page.reload();
    // `system` is stored as a preference, so the attribute is absent and the OS decides.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('the not-found page names itself, offers the way back, and returns a real 404', async ({
    page,
  }) => {
    /*
     * PRODUCT_REVIEW P2-9: this used to come back 200, because a catch-all rewrite handed every
     * unmatched address to the SPA. The rewrites are a list of the application's own route
     * prefixes now, and everything else is served as `404.html` with the status to match.
     */
    const response = await page.goto('/definitely-not-a-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('There is nothing at this address')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Studio' })).toBeVisible();

    // A known application route is still a 200, at every prefix the app owns.
    for (const route of ['/app', '/privacy', '/terms', '/oauth/callback']) {
      const ok = await page.goto(route);
      expect(ok?.status(), `${route} should be rewritten to the application document`).toBe(200);
    }
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
