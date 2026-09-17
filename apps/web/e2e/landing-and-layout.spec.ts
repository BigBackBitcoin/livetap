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
  /*
   * REPLACED THE SIX-FACTS TEST.
   *
   * That test asserted the landing was an operable replica of the product: six destinations, six
   * Moments, three shape buttons, ten scroll acts, seven copy bands. All of it was true, and all
   * of it was the reason the page carried 1,249 words and could not keep a main thread free. The
   * page is now a film, two pictures and a button, so these assert what a landing owes a visitor
   * instead of what a demo owes an inspector.
   */
  test('opens on the film, says one thing, and offers one way in', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForSelector('.lt-hero__line');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Go live.Be yourself.Anywhere.');

    /* The film is the argument, so its absence is a failure rather than a downgrade. */
    const film = page.locator('.lt-hero__film');
    await expect(film).toHaveCount(1);
    await expect(film).toHaveAttribute('poster', '/brand/creator.webp');

    /* One dominant action, above the fold, pointing at the real onboarding route. */
    const cta = page.getByRole('link', { name: 'Try it now' }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', './app/start');

    /* The honesty contract, injected at build time, still on the page a visitor reads. */
    await expect(
      page.getByText('This hosted build is a demo: every destination is simulated and nothing is broadcast anywhere.'),
    ).toBeVisible();

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
    await page.waitForSelector('.lt-hero__line');
    /*
     * The landing used to pre-answer the app's first question by guessing an intent from the
     * viewport, and carried a script to do it. A guess that is wrong costs a visitor more than
     * the tap it saved, so the way in is the onboarding route and the app asks its own question.
     */
    await expect(page.getByRole('link', { name: 'Try it now' }).first()).toHaveAttribute(
      'href',
      './app/start',
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
      await page.waitForSelector('.lt-hero__line');
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
    await page.waitForSelector('.lt-hero__line');

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
    /*
     * NO module script at all, which is stricter than the "at least one" this used to assert.
     * The landing carries one classic script of about 1 KB and nothing else: the moment a bundle
     * appears here, the page has started becoming the product again.
     */
    expect(scripts.filter((s) => s.type === 'module').length).toBe(0);
    expect(scripts.length).toBe(1);

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
    /* The statement and the honesty line, in the served document rather than built by a script. */
    expect(served).toContain('Go live.');
    expect(served).toContain('Free and open source. Runs in your browser.');
  });

  /**
   * A theme chosen inside the app is honoured on the marketing page too, and the page's own
   * toggle writes the same key.
   */
  test('carries the theme the visitor chose in the app', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    /*
     * The toggle lived on the landing when the landing was a replica of the product. It belongs
     * where someone is actually working, so the page now only CARRIES the choice. That is the
     * half that matters: a visitor who picked dark in the app must not be flashed white on the
     * way back.
     */
    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.evaluate(() => window.localStorage.setItem('livetap.theme', 'system'));
    await page.reload();
    // `system` is stored as a preference, so the attribute is absent and the OS decides.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  /*
   * CARRIED FORWARD FROM `experience.spec.ts`, which was deleted with the surface it tested.
   *
   * That file had 34 tests and every one addressed the operable replica of the product that used
   * to be embedded here. Two of its properties outlive the replica, and this is the one not
   * already covered above: a page whose argument is a looping film owes something to a visitor
   * who has asked their machine for less movement.
   *
   * CSS cannot pause a video, so `theme.js` removes `autoplay` and pauses the films. A rule in the
   * stylesheet claiming to do it would be a comment that is not true.
   */
  test('a visitor who asked for less movement gets a still picture, not a wall of type', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForSelector('.lt-hero__line');
    await page.waitForTimeout(600);

    const films = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).map((v) => ({
        paused: v.paused,
        autoplay: v.hasAttribute('autoplay'),
        poster: v.getAttribute('poster') ?? '',
      })),
    );
    expect(films.length).toBeGreaterThan(0);
    for (const film of films) {
      expect(film.paused, 'a film kept playing for a visitor who asked it not to').toBe(true);
      expect(film.autoplay).toBe(false);
      /* Paused, not hidden: the poster still carries the picture. */
      expect(film.poster).not.toBe('');
    }
    await context.close();
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
    await page.waitForSelector('.lt-hero__line');
    await page.waitForTimeout(1000);

    const offenders = await auditInteractionOwnership(page, { step: 48, scrollStep: 100 });
    expect(offenders, 'an invisible element is taking pointer events').toEqual([]);
  });

  test('the page has no accidental scroll container to swallow a wheel tick', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.lt-hero__line');
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
    await page.waitForSelector('.lt-hero__line');
    await page.waitForTimeout(800);
    /*
     * A third of the way down, computed rather than a fixed 6400px. That constant was inside a
     * 12.6-viewport-height page; on any shorter page it lands past the bottom, where every wheel
     * tick is correctly dead and the test fails for the one reason it is not looking for.
     */
    const room = await page.evaluate(() => document.body.scrollHeight - innerHeight);
    expect(room, 'the page is too short to test a wheel tick').toBeGreaterThan(400);
    await page.evaluate((r) => scrollTo({ top: Math.round(r / 3), behavior: 'instant' }), room);
    await page.waitForTimeout(300);
    await page.mouse.move(720, 450);

    const ticks = Math.min(8, Math.floor(room / 3 / 120));
    let dead = 0;
    let previous = await page.evaluate(() => scrollY);
    for (let i = 0; i < ticks; i += 1) {
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

/*
 * THE QUICK-TOUR TESTS WERE HERE, and the feature they covered has gone with its subject.
 *
 * The tour was a guided walkthrough of the operable replica of the product that used to be
 * embedded in the landing page: it pointed at that replica's rail, its destinations and its
 * Moments. Removing the replica removed everything the tour had to show, so the offer, its two
 * answers and `public/main.ts` that drove them are all unreferenced now.
 *
 * Deleted rather than repointed at the real app. A first-run tour belongs in the product, where
 * the things it points at are real and a person is actually trying to do something; a tour of a
 * simulation on a marketing page teaches the simulation. If a tour is wanted in the app it is a
 * new feature with its own tests, not these ones moved.
 */

