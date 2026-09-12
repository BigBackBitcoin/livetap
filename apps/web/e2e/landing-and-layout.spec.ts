import { expect, test } from '@playwright/test';
import { Taps, freshFirstRun, hasHorizontalOverflow, reachStudio } from './helpers.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('landing', () => {
  test('is the product running, with the six facts on its face', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    /*
     * The heading order is real and the `<h1>` makes no claim: the largest type on the page is
     * either a number the surface is counting or a sentence the surface is reporting about
     * itself (LIVETAP_VISUAL_DIRECTION.md §3.2).
     */
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'LIVETAP, a live production surface you can operate',
    );

    // Fact 6 is the only one carried by words, and it is six of them.
    await expect(page.getByText('Free. Open source. Runs on your machine.')).toBeVisible();
    // The honesty contract, non-dismissible, at first paint.
    await expect(page.getByText('Demo surface. Nothing is broadcast anywhere.')).toBeVisible();

    // Facts 1 to 4 are state on a surface: six destinations, six Moments, three shapes, one
    // dominant action.
    await expect(page.locator('[data-lt-dest]')).toHaveCount(6);
    await expect(page.locator('[data-lt-moment]')).toHaveCount(6);
    await expect(page.locator('[data-lt-format-set]')).toHaveCount(3);
    await expect(page.locator('[data-lt-golive]')).toBeVisible();

    // The platform honesty nobody else in the category states out loud, in one line.
    await expect(
      page.getByText('TikTok, Instagram and X publish no live chat API, so nothing from them appears here.'),
    ).toBeVisible();

    // Eight acts and two declared silences, all real sections with real headings.
    await expect(page.locator('[data-sc-act]')).toHaveCount(10);
    await expect(page.getByRole('heading', { name: 'Break it yourself' })).toBeAttached();

    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toHaveAttribute(
      'href',
      'https://github.com/BigBackBitcoin/livetap',
    );
  });

  test('hands the visitor to the real onboarding route, and every link resolves', async ({
    page,
  }) => {
    await page.goto('/');
    // ACT 8 is the app's own first question, and its answer travels with the visitor.
    await expect(page.locator('[data-lt-open]')).toHaveAttribute('href', './app/start');

    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) =>
        Array.from(
          new Set(
            links
              .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
              .filter((h) => h && !h.startsWith('#')),
          ),
        ),
      );
    expect(hrefs).toContain('./app/start');
    expect(hrefs.length).toBeGreaterThan(4);

    for (const href of hrefs) {
      if (href.startsWith('http')) continue; // third-party, not ours to assert
      const response = await page.request.get(new URL(href, 'http://localhost:4173/').toString());
      expect(response.status(), `${href} should resolve`).toBe(200);
    }
  });

  test('has no horizontal overflow at any width', async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForSelector('html.sc-ready');
      await page.waitForTimeout(300);
      expect(await hasHorizontalOverflow(page), `landing overflows at ${viewport.name}`).toBe(false);
    }
  });

  /**
   * The page's budget, asserted rather than recorded in a document that can go stale.
   *
   * `/` carries two scripts and no framework: the classic pre-paint theme carrier, and the
   * page's own module. React 19's DOM renderer alone is 69.2 KB gzipped
   * (`docs/qa/FRICTION_BENCHMARK.md` §6), so the 60 KB budget is only reachable without it.
   */
  test('ships two scripts, no framework, and stays inside the JavaScript budget', async ({
    page,
  }) => {
    const transferred = new Map<string, number>();
    page.on('response', async (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('javascript')) return;
      try {
        transferred.set(new URL(response.url()).pathname, (await response.body()).length);
      } catch {
        /* A response with no body is not a cost. */
      }
    });

    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    const scripts = await page.locator('script').evaluateAll((nodes) =>
      nodes.map((node) => ({
        src: (node as HTMLScriptElement).getAttribute('src') ?? '',
        type: (node as HTMLScriptElement).getAttribute('type') ?? '',
        inline: ((node as HTMLScriptElement).textContent ?? '').trim().length,
      })),
    );
    // Inline script would be blocked by the deployed CSP (`script-src 'self'`).
    expect(scripts.every((s) => s.inline === 0)).toBe(true);
    // The theme carrier is a classic script in `<head>`, so a chosen theme never flashes.
    expect(scripts.find((s) => s.src === '/theme.js')?.type).toBe('');
    expect(scripts.filter((s) => s.type === 'module').length).toBeGreaterThan(0);

    const raw = Array.from(transferred.values()).reduce((a, b) => a + b, 0);
    /*
     * The served bytes are uncompressed here (the preview server does not gzip), so this guards
     * the raw figure at roughly three times the gzipped budget. The exact gzipped number comes
     * from `vite build --reportCompressedSize`, which is what the build report quotes.
     */
    expect(raw, `JS transferred on / was ${raw} bytes`).toBeLessThan(180_000);
    expect(page.url()).toBe('http://localhost:4173/');

    // No React on the marketing document, and nothing built by a renderer.
    const served = await (await page.request.get('/')).text();
    expect(served).not.toContain('id="root"');
    expect(served).toContain('What are you making?');
    expect(served).toContain('Free. Open source. Runs on your machine.');
  });

  /**
   * A theme chosen inside the app is honoured on the marketing page too, and the page's own
   * toggle writes the same key.
   */
  test('carries a theme the visitor chose in the app, and can change it', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.waitForSelector('html.sc-ready');
    await page.locator('[data-lt-theme]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

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
    for (const route of ['/app', '/app/start', '/privacy', '/terms', '/oauth/callback']) {
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
