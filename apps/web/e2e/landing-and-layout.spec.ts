import { expect, test } from '@playwright/test';
import {
  Taps,
  auditInteractionOwnership,
  freshFirstRun,
  hasHorizontalOverflow,
  reachStudio,
} from './helpers.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

test.describe('landing', () => {
  test('is the product running, with the six facts on its face', async ({ page }) => {
    /*
     * A full desk. Below 761px of height the chat panel and the Moments strip move into their
     * own chapters' bands, so the surface's own facts are counted at the width the desk is
     * composed for rather than at whatever the default device happens to be.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    /*
     * The heading order is real and the `<h1>` makes no claim: the largest type on the page is
     * either a number the surface is counting or a sentence the surface is reporting about
     * itself (LIVETAP_VISUAL_DIRECTION.md §3.2).
     */
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'LIVETAP, go live everywhere without becoming a broadcast engineer',
    );

    // Fact 6 is the only one carried by words, and it is six of them.
    await expect(page.getByText('Free. Open source. Runs on your machine.')).toBeVisible();
    // The honesty contract, non-dismissible, at first paint.
    await expect(page.getByText('Demo surface. Nothing is broadcast anywhere.')).toBeVisible();

    // Facts 1 to 4 are state on a surface: six destinations, six Moments, three shapes, one
    // dominant action. The shape control exists twice, in the toolbar and in the Shapes band,
    // and both copies are the same three buttons.
    await expect(page.locator('[data-lt-dest]')).toHaveCount(6);
    await expect(page.locator('[data-lt-moment]')).toHaveCount(6);
    await expect(page.locator('[data-lt-formats]')).toHaveCount(2);
    await expect(page.locator('.ltp-toolbar [data-lt-format-set]')).toHaveCount(3);
    await expect(page.locator('[data-lt-golive]')).toBeVisible();

    // The platform honesty nobody else in the category states out loud, in one line.
    await expect(
      page.getByText('TikTok, Instagram and X publish no live chat API, so nothing from them appears here.'),
    ).toBeVisible();

    // Eight chapters and two declared silences, all real sections with real headings.
    await expect(page.locator('[data-sc-act]')).toHaveCount(10);
    /*
     * Seven of the eight chapters carry their copy in a band inside their own act, and a band
     * is cued to opacity 0 while its chapter is off screen, so the peak's title is read off the
     * element rather than looked up by role.
     */
    await expect(page.locator('[data-lt-band]')).toHaveCount(7);
    await expect(page.locator('[data-lt-band="act-break"] .ltp-band__title')).toHaveText(
      'Break it yourself.',
    );

    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toHaveAttribute(
      'href',
      'https://github.com/BigBackBitcoin/livetap',
    );
  });

  test('hands the visitor to the real onboarding route, and every link resolves', async ({
    page,
  }) => {
    await page.goto('/');
    /*
     * The close is the app's own first question, and its answer travels with the visitor. The
     * page answers it for them at boot (Talking on a desk, Vertical Live on a phone), so the
     * link already carries an intent before anything is tapped.
     */
    await page.waitForSelector('html.sc-ready');
    await expect(page.locator('[data-lt-open]')).toHaveAttribute(
      'href',
      './app/start?intent=talking',
    );

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
    expect(hrefs).toContain('./app/start?intent=talking');
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

/**
 * The invariant that two first-time-creator audits caught and two diagnoses missed.
 *
 * A chapter band sat at `opacity: 0` with `pointer-events: auto` across the middle of the stage.
 * It captured the centre of "Use my camera" and of four destination connect buttons, and because
 * it was the document's only scroll container it swallowed the first wheel tick as well. Both
 * auditors reported it as a frozen page with a dead wheel, and it was twice written off as
 * unreproducible because no wheel listener existed: hit-testing does not need one.
 *
 * This walks the whole page rather than a chosen position, because the trap only existed across
 * two narrow scroll ranges and any single sample would have missed it.
 */
test.describe('nothing invisible is ever on top', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /*
   * The walk itself now lives in `helpers.ts`, because this page was never the only place the
   * bug could live — it had already happened on two other surfaces by the time this test was
   * written. `interaction-ownership.spec.ts` runs the same function over every app route at two
   * viewports under both motion preferences; this call is the landing page's cell of that matrix,
   * kept here because `/` is the surface all three historical failures were found on.
   *
   * The grid is denser than the six-by-five it replaced (48px rather than 200x120), and it also
   * sweeps for ghost layers a grid can step straight over, which is what two of the three
   * historical bugs were.
   */
  test('no transparent element is hit-testable anywhere on the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(1000);

    const offenders = await auditInteractionOwnership(page, { step: 48, scrollStep: 100 });
    expect(offenders, 'an invisible element is taking pointer events').toEqual([]);
  });

  test('the page has no accidental scroll container to swallow a wheel tick', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(800);

    const containers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const overflow = getComputedStyle(el).overflowY;
          return (
            (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight - el.clientHeight > 4
          );
        })
        .map((el) => `${el.tagName}.${el.className.toString().slice(0, 50)}`),
    );
    expect(containers, 'an inner scroll area eats the first wheel tick').toEqual([]);
  });

  test('a wheel tick over the stage always moves the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(800);
    await page.evaluate(() => scrollTo({ top: 6400, behavior: 'instant' }));
    await page.waitForTimeout(300);
    await page.mouse.move(720, 450);

    let dead = 0;
    let previous = await page.evaluate(() => scrollY);
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(90);
      const now = await page.evaluate(() => scrollY);
      if (now === previous) dead += 1;
      previous = now;
    }
    expect(dead, 'a wheel tick over the stage produced no movement').toBe(0);
  });
});

/**
 * `hidden` has to actually hide.
 *
 * The UA stylesheet's `[hidden] { display: none }` carries the lowest specificity there is, so any
 * component rule that sets `display` silently beats it. Nearly every component here sets `display`,
 * which meant `hidden` was doing nothing on most of them - and the resulting bugs never looked like
 * a CSS problem. A pre-flight row kept repeating a message the prompt above it had already made;
 * the first-visit tour offer could not be dismissed; the first-use hint on the break act never
 * retired. All three read as broken logic, and all three were one missing line of reset.
 *
 * So this walks the real pages and asserts the property directly, on whatever happens to be hidden
 * at the time, rather than trusting that the reset is still in the bundle.
 */
test.describe('hidden means hidden', () => {
  for (const [name, path] of [
    ['the landing page', '/'],
    ['Studio', '/app'],
    ['Destinations', '/app/destinations'],
  ] as const) {
    test(`nothing marked hidden takes up space on ${name}`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => {
        localStorage.setItem('livetap.onboarding', 'true');
        localStorage.setItem('livetap.intent', '"talking"');
        localStorage.setItem('livetap.mode', '"simple"');
      });
      await page.reload();
      await page.waitForTimeout(1500);

      const showing = await page.evaluate(() =>
        [...document.querySelectorAll('[hidden]')]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 || rect.height > 0;
          })
          .map((el) => `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 40)}`),
      );
      expect(showing, 'these carry [hidden] and still occupy space').toEqual([]);
    });
  }

  test('the reset is present, so a component cannot out-specify it', async ({ page }) => {
    await page.goto('/app');
    const beaten = await page.evaluate(() => {
      // A flex element is the exact case that used to win against the UA rule.
      const probe = document.createElement('div');
      probe.style.display = 'flex';
      probe.hidden = true;
      document.body.append(probe);
      const shown = getComputedStyle(probe).display;
      probe.remove();
      return shown;
    });
    expect(beaten, 'a display:flex element ignored its own hidden attribute').toBe('none');
  });
});

/**
 * The offer is made once.
 *
 * "Store the completion/skip state locally" is easy to write and easy to get subtly wrong, and the
 * failure mode is the one the brief is most against: a visitor who has already answered being
 * asked again, forever. Three things have to hold - it appears for someone who has not answered,
 * either answer retires it permanently, and taking the tour by any other route counts as an
 * answer - and none of them is observable without reloading the page, which is exactly why they
 * were worth testing rather than trusting.
 */
test.describe('the quick-tour offer', () => {
  test('is offered to a first-time visitor', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-lt-offer]')).toBeVisible();
  });

  test('Skip retires it, and a reload does not bring it back', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-lt-offer-no]').click();
    await expect(page.locator('[data-lt-offer]')).toBeHidden();

    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-lt-offer]')).toBeHidden();
  });

  test('taking the tour counts as an answer', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-lt-offer-yes]').click();
    await expect(page.locator('.ltp-tour')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-lt-offer]')).toBeHidden();
  });

  test('opening the tour from the rail also retires the offer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-lt-offer]')).toBeVisible();
    await page.locator('[data-lt-tour-open]').click();
    await expect(page.locator('.ltp-tour')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-lt-offer]')).toBeHidden();
  });
});
