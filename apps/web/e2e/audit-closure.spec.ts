import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  ACTS,
  hasHorizontalOverflow,
  isOnTop,
  ownTheSurface,
  readScrollListeners,
  toAct,
  watchScrollListeners,
  wheelOver,
} from './helpers.js';

/**
 * The first-time-creator audit, closed item by item.
 *
 * Every test here is named after the audit finding it answers, so a failure reads as "that
 * finding is open again" rather than as a broken selector. The findings, in the audit's own
 * priority order:
 *
 *   P0  the hero said nothing a stranger could act on
 *   P0  the page could not be scrolled from over the surface
 *   P0  the stage opened empty, on a page selling a production tool
 *   P0  controls outside the chapter you were reading did nothing, silently
 *   P1  the demo went live by itself, so "you are in control" was not true
 *   P1  a Download button that downloaded nothing
 *   P1  a camera claim with no camera behind it
 *   P1  a phone got the desk, squeezed
 *   P1  reduced motion lost the content with the movement
 *   P2  the page cost more than it showed
 *
 * The fake camera device is a launch argument, and launch arguments are per worker, so it is
 * declared once for the whole file. `--use-fake-ui-for-media-stream` answers the permission
 * prompt; the denied path overrides `getUserMedia` itself and never reaches the prompt.
 */
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

const DESK = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

/**
 * The chapters whose panel sits on top of the desk.
 *
 * On a desk there are none: `.ltp-band--tall` (Outputs and Versus) grows DOWN over the monitor
 * and stops above the toolbar, and the close panel is inset by the desk's own height, so the
 * console stays operable through every chapter. On a phone both of those panels are anchored to
 * the bottom of the screen instead, which is exactly where the desk is, so three chapters bury
 * it. That difference is pinned here rather than assumed: if a chapter joins or leaves either
 * list, a test fails and somebody looks.
 */
const COVERS_THE_DESK_ON_A_DESK: readonly string[] = [];
const COVERS_THE_DESK_ON_A_PHONE: readonly string[] = ['act-outputs', 'act-versus', 'act-make'];

/** Collect console errors and uncaught exceptions for the life of a page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/* ================================================================== P0 the hero */

test.describe('P0 the hero says what this is', () => {
  test.use({ viewport: DESK });

  test('P0 hero: the statement, the picture and the demo link are above the fold and nothing covers the headline', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    const hero = page.locator('[data-lt-band="act-hero"]');
    await expect(hero).toHaveClass(/is-here/);
    await expect(hero.locator('.ltp-band__title')).toContainText('Go live everywhere.');
    await expect(hero.locator('.ltp-band__title')).toContainText(
      'Without becoming a broadcast engineer.',
    );
    await expect(hero.locator('.ltp-band__lede')).toContainText('free, open-source');

    /* Three things a stranger can act on, all of them inside the first screen. */
    const above = await page.evaluate(() => {
      const fits = (el: Element | null): boolean => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && r.width > 0;
      };
      return {
        title: fits(document.querySelector('[data-lt-band="act-hero"] .ltp-band__title')),
        picture: fits(document.querySelector('[data-lt-frame]')),
        demo: fits(document.querySelector('[data-lt-band="act-hero"] a[href="./app/start"]')),
        camera: fits(document.querySelector('[data-lt-band="act-hero"] [data-lt-camera-cta]')),
        golive: fits(document.querySelector('[data-lt-golive]')),
      };
    });
    expect(above).toEqual({
      title: true,
      picture: true,
      demo: true,
      camera: true,
      golive: true,
    });

    await expect(
      hero.getByRole('link', { name: 'Try the web demo' }),
    ).toHaveAttribute('href', './app/start');

    /* And the headline is the thing a click on the headline reaches. */
    expect(await isOnTop(page, '[data-lt-band="act-hero"] .ltp-band__title')).toBe(true);
    expect(await isOnTop(page, '[data-lt-band="act-hero"] [data-lt-camera-cta]')).toBe(true);
  });

  test('P0 hero: the honesty line is on the page before anything is tapped', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await expect(page.getByText('Demo surface. Nothing is broadcast anywhere.')).toBeVisible();
    await expect(page.getByText('Free. Open source. Runs on your machine.')).toBeVisible();
  });
});

/* ================================================================ P0 the stage */

test.describe('P0 the stage is never empty', () => {
  test.use({ viewport: DESK });

  test('P0 stage: a frame of video is on the stage from the first paint', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    /* The demo clip, decoded and running, in the layer the Moment turned on. */
    const video = page.locator('[data-lt-layer="camera"] video');
    await expect(page.locator('[data-lt-layer="camera"]')).toHaveClass(/is-on/);
    await expect(video).toHaveJSProperty('paused', false, { timeout: 5_000 });
    await page.waitForFunction(
      () => {
        const v = document.querySelector('[data-lt-layer="camera"] video') as HTMLVideoElement;
        return v.readyState >= 2 && v.videoWidth > 0;
      },
      undefined,
      { timeout: 10_000 },
    );

    /* And it is moving, not a poster frozen behind a play button. */
    const first = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
    await page.waitForTimeout(700);
    const second = await video.evaluate((v) => (v as HTMLVideoElement).currentTime);
    expect(second).toBeGreaterThan(first);

    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'demo');
    await expect(page.locator('[data-lt-shape]')).toHaveText('16:9');
  });
});

/* =============================================================== P0 the scroll */

test.describe('P0 the page scrolls', () => {
  test.use({ viewport: DESK });

  test('P0 scroll: the wheel scrolls from anywhere on the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    const spots: ReadonlyArray<readonly [string, string]> = [
      ['the middle of the surface', '[data-lt-surface]'],
      ['the picture on the stage', '[data-lt-frame]'],
      ['a destination tile', '[data-lt-dest="youtube"] [data-lt-pick]'],
      ['the toolbar', '[data-lt-golive]'],
      ['the chapter band', '[data-lt-band="act-hero"]'],
      ['the status bar', '.ltp-statusbar'],
    ];

    for (const [where, selector] of spots) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => scrollY === 0);
      await wheelOver(page, selector, 600);
      await page.waitForTimeout(250);
      const moved = await page.evaluate(() => scrollY);
      expect(moved, `the wheel over ${where} did not scroll the page`).toBeGreaterThan(100);
    }
  });

  test('P0 scroll: the keyboard scrolls the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    const start = 600;
    for (const [key, expectation] of [
      ['PageDown', 'down'],
      ['ArrowDown', 'down'],
      ['Space', 'down'],
      ['End', 'bottom'],
      ['Home', 'top'],
    ] as const) {
      await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), start);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(key);
      await page.waitForTimeout(450);
      const at = await page.evaluate(() => scrollY);
      if (expectation === 'down') expect(at, `${key} did not scroll down`).toBeGreaterThan(start);
      if (expectation === 'bottom') expect(at, `${key} did not reach the end`).toBeGreaterThan(9000);
      if (expectation === 'top') expect(at, `${key} did not reach the top`).toBe(0);
    }
  });

  test('P0 scroll: nothing on the page blocks the wheel or a touch move', async ({ page }) => {
    await watchScrollListeners(page);
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(1_500);

    const listeners = await readScrollListeners(page);
    /* Reported in full, so a new one is visible in the run log even when it is harmless. */
    console.log('wheel and touch listeners:', JSON.stringify(listeners));

    const blocking = listeners.filter(
      (l) => (l.type === 'wheel' || l.type === 'touchmove') && l.passive === false,
    );
    expect(blocking, 'a non-passive wheel or touchmove listener stops the page scrolling').toEqual(
      [],
    );

    /* A blocking listener on an element rather than on window is the worst case: it kills the
       scroll only over part of the page, which reads as a broken area rather than a bug. */
    const onElements = listeners.filter(
      (l) => l.passive === false && l.on !== 'window' && l.on !== 'document',
    );
    expect(onElements, 'an element registered a blocking wheel or touch listener').toEqual([]);
  });
});

test.describe('P0 the page scrolls on a phone', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('P0 scroll: a swipe scrolls the page on a phone', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(400);

    const client = await page.context().newCDPSession(page);
    const swipe = async (fromY: number): Promise<void> => {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 195, y: fromY }],
      });
      for (let step = 1; step <= 8; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: 195, y: fromY - step * 50 }],
        });
        await page.waitForTimeout(16);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    /* From over the picture, which is the part of a phone screen a thumb lands on. */
    await swipe(300);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => scrollY), 'a swipe over the stage did not scroll').toBeGreaterThan(
      50,
    );

    /* And from over the destinations strip, lower down. */
    const before = await page.evaluate(() => scrollY);
    await swipe(700);
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => scrollY),
      'a swipe over the lower surface did not scroll',
    ).toBeGreaterThan(before);
  });
});

/* ========================================================= P0 silent controls */

test.describe('P0 no control is silent', () => {
  test.use({ viewport: DESK });

  test('P0 silent controls: the shape control works at every chapter', async ({ page }) => {
    await ownTheSurface(page);

    for (const id of ACTS) {
      await toAct(page, id, 0.5);
      const toolbar = page.locator('.ltp-toolbar [data-lt-formats]');

      await toolbar.locator('[data-lt-format-set="9:16"]').click();
      await expect(
        page.locator('[data-lt-stage]'),
        `the shape control did nothing at ${id}`,
      ).toHaveAttribute('data-lt-format', '9:16');
      await expect(page.locator('[data-lt-shape]')).toHaveText('9:16');

      await toolbar.locator('[data-lt-format-set="16:9"]').click();
      await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '16:9');
    }
  });

  test('P0 silent controls: a Moment can be chosen at every chapter', async ({ page }) => {
    await ownTheSurface(page);

    for (const id of ACTS) {
      await toAct(page, id, 0.5);
      await page.locator('[data-lt-moments] [data-lt-moment="break"]').click();
      await expect(
        page.locator('[data-lt-stage]'),
        `the Moments strip did nothing at ${id}`,
      ).toHaveAttribute('data-lt-active-moment', 'break');

      await page.locator('[data-lt-moments] [data-lt-moment="main-camera"]').click();
      await expect(page.locator('[data-lt-stage]')).toHaveAttribute(
        'data-lt-active-moment',
        'main-camera',
      );
    }
  });

  test('P0 silent controls: GO LIVE answers at every chapter', async ({ page }) => {
    await ownTheSurface(page);
    const covered: string[] = [];

    for (const id of ACTS) {
      await toAct(page, id, 0.5);
      if (!(await isOnTop(page, '[data-lt-golive]'))) {
        covered.push(id);
        continue;
      }
      await page.locator('[data-lt-golive]').click();
      await expect(page.locator('[data-lt-golive]'), `GO LIVE did nothing at ${id}`).toHaveClass(
        /lt-golive--countdown/,
      );
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-lt-golive]')).not.toHaveClass(/lt-golive--countdown/);
    }

    expect(covered, 'a chapter now covers the desk that never used to').toEqual(
      COVERS_THE_DESK_ON_A_DESK,
    );
  });

  test('P0 silent controls: the tall chapters are panels over the monitor, not over the desk', async ({
    page,
  }) => {
    await ownTheSurface(page);
    for (const id of ['act-outputs', 'act-versus'] as const) {
      await toAct(page, id, 0.5);
      await expect(page.locator(`[data-lt-band="${id}"]`)).toHaveClass(/ltp-band--tall/);
      expect(await isOnTop(page, '[data-lt-golive]'), `GO LIVE is buried at ${id}`).toBe(true);
      expect(
        await isOnTop(page, '.ltp-toolbar [data-lt-format-set="9:16"]'),
        `the shape control is buried at ${id}`,
      ).toBe(true);
    }
  });
});

test.describe('P0 no control is silent, on a phone', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('P0 silent controls: GO LIVE answers at every chapter the desk is on screen', async ({
    page,
  }) => {
    await ownTheSurface(page);
    const covered: string[] = [];

    for (const id of ACTS) {
      await toAct(page, id, 0.5);
      if (!(await isOnTop(page, '[data-lt-golive]'))) {
        covered.push(id);
        continue;
      }
      await page.locator('[data-lt-golive]').click();
      await expect(page.locator('[data-lt-golive]'), `GO LIVE did nothing at ${id}`).toHaveClass(
        /lt-golive--countdown/,
      );
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-lt-golive]')).not.toHaveClass(/lt-golive--countdown/);
    }

    expect(covered, 'a chapter now covers the desk that never used to').toEqual(
      COVERS_THE_DESK_ON_A_PHONE,
    );
  });

  test('P0 silent controls: where a panel covers the desk on a phone, the panel is the control', async ({
    page,
  }) => {
    /*
     * Decided, not a defect (DECISIONS_LOG 2026-09-14): on a phone the Outputs and Versus panels
     * and the close grow over the desk, because a 390px-wide screen cannot hold a panel and a
     * console at once. Each of those chapters carries its own controls, and they must be the
     * thing on top; GO LIVE returns at the next chapter.
     */
    await ownTheSurface(page);
    const own: Record<string, string> = {
      'act-outputs': '[data-lt-outputs] figure',
      'act-versus': '[data-lt-versus] button',
      'act-make': '[data-lt-open]',
    };
    for (const id of COVERS_THE_DESK_ON_A_PHONE) {
      await toAct(page, id, 0.5);
      expect(await isOnTop(page, own[id]!), `${id}: its own control is not on top`).toBe(true);
    }
    await toAct(page, 'act-versus', 0.5);
    await page.getByRole('button', { name: 'Play LIVETAP' }).click();
    await expect(page.locator('[data-lt-versus]')).toHaveAttribute('data-lt-versus-state', /livetap|both/);
    await toAct(page, 'act-pro', 0.5);
    expect(await isOnTop(page, '[data-lt-golive]'), 'GO LIVE did not come back at Pro').toBe(true);
  });

  test('P0 silent controls: the shape control exists on a phone', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-shape', 0.5);
    const band = page.locator('[data-lt-band="act-shape"] [data-lt-format-set="16:9"]');
    await expect(band).toBeVisible();
    await band.click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '16:9');
    await page.locator('[data-lt-band="act-shape"] [data-lt-format-set="9:16"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '9:16');
    await toAct(page, 'act-pro', 0.5);
    const pro = page.locator('[data-lt-band="act-pro"] [data-lt-mode-set="pro"]');
    await expect(pro).toBeVisible();
    await pro.click();
    await expect(page.locator('[data-lt-surface]')).toHaveClass(/is-pro/);
  });

  test('P0 silent controls: the Moments mirror answers at its own chapter', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-moments', 0.5);

    await page.locator('[data-lt-moment-mirror="break"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-active-moment', 'break');
    await expect(page.locator('[data-lt-moment-mirror="break"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

/* ================================================= P1 nothing goes live for you */

test.describe('P1 the visitor is the one who goes live', () => {
  test.use({ viewport: DESK });

  test('P1 nothing goes live until the visitor does', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    /* Twelve seconds, no pointer, no key. The demo is two and a half times over by now. */
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      expect(
        await page.locator('[data-lt-dest][data-lt-state="LIVE"]').count(),
        'the page went live on its own',
      ).toBe(0);
      await page.waitForTimeout(500);
    }

    await expect(page.locator('[data-lt-dest][data-lt-state="STARTING"]')).toHaveCount(0);
    await expect(page.locator('[data-lt-stage-live]')).toBeHidden();
    await expect(page.locator('[data-lt-out="health"]')).toHaveText('Idle');
    await expect(page.locator('[data-lt-out="clock"]')).toHaveText('0:00');
    await expect(page.locator('[data-lt-golive-label]')).toHaveText('GO LIVE (DEMO)');
    /* What it did instead: it got three destinations Ready and asked. */
    await expect(page.locator('[data-lt-dest][data-lt-state="READY"]')).toHaveCount(3);
    await expect(page.locator('[data-lt-golive-sub]')).toHaveAttribute('data-lt-yourturn', 'true');

    /* And when the visitor does tap it, it goes. */
    await page.locator('[data-lt-golive]').click();
    await expect(page.locator('[data-lt-dest][data-lt-state="LIVE"]')).toHaveCount(3, {
      timeout: 15_000,
    });
  });

  test('P1 the demo stops the moment a visitor touches the surface', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await expect(page.locator('[data-lt-golive-sub]')).toHaveAttribute(
      'data-lt-yourturn',
      'true',
      { timeout: 10_000 },
    );

    await page.locator('[data-lt-moments] [data-lt-moment="guest"]').click();
    await expect(page.locator('[data-lt-golive-sub]')).toHaveAttribute('data-lt-yourturn', 'false');

    /* Nothing further connects on its own after the interruption. */
    const states = await page.locator('[data-lt-surface]').getAttribute('data-sc-verify-state');
    await page.waitForTimeout(3_000);
    expect(
      (await page.locator('[data-lt-surface]').getAttribute('data-sc-verify-state'))?.split('|')[1],
    ).toBe(states?.split('|')[1]);
  });
});

/* ================================================================ P1 downloads */

test.describe('P1 the page does not promise a build', () => {
  test.use({ viewport: DESK });

  test('P1 download never lies', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-make', 0.5);

    /* Not one button and not one link anywhere on the page offers a download. */
    const offers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a, button'))
        .filter((el) => /\bdownloads?\b/i.test(el.textContent ?? ''))
        .map((el) => `${el.tagName}: ${el.textContent?.trim()}`),
    );
    expect(offers).toEqual([]);

    /* What the page offers instead is the truth, in words, plus somewhere to be told. */
    await expect(page.locator('.ltp-foot__note').first()).toContainText(
      'The first Windows build exists and is not published yet',
    );
    await expect(page.locator('[data-lt-watch]')).toHaveAttribute(
      'href',
      'https://github.com/BigBackBitcoin/livetap',
    );
    await expect(page.locator('[data-lt-watch]')).toHaveText(
      'Watch on GitHub for the first build',
    );
    await expect(page.locator('[data-lt-open]')).toHaveAttribute('href', /^\.\/app\/start\?intent=/);
  });
});

/* =================================================================== P1 camera */

test.describe('P1 the camera is the visitor own', () => {
  test.use({ viewport: DESK });

  test('P1 camera: a granted camera replaces the demo picture and says so', async ({ page }) => {
    await ownTheSurface(page);
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'demo');

    await page.locator('[data-lt-band="act-hero"] [data-lt-camera-cta]').click();
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'camera', {
      timeout: 15_000,
    });
    await expect(page.locator('[data-lt-camera-label]').first()).toHaveText('Stop my camera');
    await expect(page.locator('[data-lt-camera-note]')).toContainText('Local only.');

    /* A real MediaStream, on the element the stage shows. */
    expect(
      await page
        .locator('[data-lt-layer="camera"] video')
        .evaluate((v) => !!(v as HTMLVideoElement).srcObject),
    ).toBe(true);

    /* And it can be given back, without a reload. */
    await page.locator('[data-lt-band="act-hero"] [data-lt-camera-cta]').click();
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'demo');
    await expect(page.locator('[data-lt-camera-label]').first()).toHaveText('Use my camera');
  });

  /*
   * This used to assert that the camera button ON the stage behaved like the one in the hero,
   * because there were two of them and they had to agree. There is one now, and the reason is
   * worth keeping as a test rather than as a memory: the program output carries the production
   * and nothing else, so a control cannot live on the picture - and one action gets one control,
   * so a second copy of it cannot live anywhere.
   */
  test('P1 camera: there is exactly one camera control, and it is not on the picture', async ({
    page,
  }) => {
    await ownTheSurface(page);

    const controls = page.locator('[data-lt-camera-cta]');
    await expect(controls).toHaveCount(1);

    const onThePicture = await page.evaluate(() => {
      const frame = document.querySelector('.ltp-stage__frame');
      const button = document.querySelector('[data-lt-camera-cta]');
      return !!frame && !!button && frame.contains(button);
    });
    expect(onThePicture, 'the camera control is inside the stage frame').toBe(false);

    /* And the one that exists still works. */
    await controls.click();
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'camera', {
      timeout: 15_000,
    });
    await expect(page.locator('[data-lt-camera-label]')).toHaveText('Stop my camera');
  });

  test('P1 camera: a refused camera keeps the demo picture and names the reason', async ({
    page,
    context,
  }) => {
    await context.grantPermissions([]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
        },
      });
    });

    await ownTheSurface(page);
    await page.locator('[data-lt-band="act-hero"] [data-lt-camera-cta]').click();

    await expect(page.locator('[data-lt-camera-note]')).toContainText('permission', {
      timeout: 10_000,
    });
    await expect(page.locator('[data-lt-camera-note]')).toHaveText(
      'No camera permission, so the sample picture stays. Nothing was recorded.',
    );
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute('data-lt-source', 'demo');
    await expect(page.locator('[data-lt-camera-label]').first()).toHaveText('Use my camera');
    /* The stage kept its picture: a refusal costs the visitor nothing. */
    await expect(page.locator('[data-lt-layer="camera"]')).toHaveClass(/is-on/);
    await expect(page.locator('[data-lt-layer="camera"] video')).toHaveJSProperty('paused', false);
  });
});

/* ============================================================ P1 the phone page */

test.describe('P1 a phone gets its own composition', () => {
  for (const [width, height] of [
    [375, 667],
    [390, 844],
    [412, 915],
    [768, 1024],
  ] as const) {
    test(`P1 mobile composition: the page composes for ${width}x${height}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      const errors = collectErrors(page);
      try {
        await page.goto('/');
        await page.waitForSelector('html.sc-ready');
        await page.waitForTimeout(600);

        expect(await hasHorizontalOverflow(page), 'the page scrolls sideways').toBe(false);

        const hero = page.locator('[data-lt-band="act-hero"]');
        await expect(hero).toHaveClass(/is-here/);
        await expect(hero.locator('.ltp-band__title')).toBeVisible();
        await expect(hero.locator('.ltp-band__title')).toContainText('Go live everywhere.');

        const frame = page.locator('[data-lt-frame]');
        await expect(frame).toBeVisible();
        const box = (await frame.boundingBox())!;
        if (width <= 412) {
          expect(box.height, 'the picture is too small to be a picture').toBeGreaterThanOrEqual(150);
        }

        /* A phone composes vertically by default, because a phone is a vertical platform. */
        const phone = width < 640;
        await expect(page.locator('[data-lt-stage]')).toHaveAttribute(
          'data-lt-format',
          phone ? '9:16' : '16:9',
        );
        if (phone) {
          await expect(page.locator('[data-lt-intent="vertical"]')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
        }

        await expect(page.locator('[data-lt-dests]')).toBeVisible();
        await expect(page.locator('[data-lt-dest]')).toHaveCount(6);

        /* The one dominant action is on screen and nothing is sitting on top of it. */
        await expect(page.locator('[data-lt-golive]')).toBeVisible();
        expect(await isOnTop(page, '[data-lt-golive]'), 'GO LIVE is covered').toBe(true);

        /* The touch floor, where the design system applies it. */
        const small = await page.evaluate(() => {
          const out: string[] = [];
          const sel = '[data-lt-pick], [data-lt-golive], [data-lt-moment], [data-lt-theme]';
          for (const el of document.querySelectorAll<HTMLElement>(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) continue;
            if (r.height < 43.5 || r.width < 43.5) {
              out.push(`${el.className}: ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return out;
        });
        expect(small).toEqual([]);

        expect(errors, `console errors at ${width}x${height}`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});

/* ========================================================== P1 reduced motion */

test.describe('P1 reduced motion keeps the content', () => {
  test.use({ viewport: DESK, reducedMotion: 'reduce' });

  test('P1 reduced motion: the page is fully usable, the videos hold still, and the break skips the flicker', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await ownTheSurface(page);

    /* Every video is a still frame, and the stage still shows a picture. */
    const paused = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).map((v) => v.paused),
    );
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.every(Boolean), 'a video is playing under reduced motion').toBe(true);
    await expect(page.locator('[data-lt-layer="camera"]')).toHaveClass(/is-on/);

    /* Every chapter still arrives, and every control still answers. */
    for (const id of ACTS) {
      await toAct(page, id, 0.5);
      expect(await page.evaluate(() => document.body.dataset.ltAct)).toBe(id);
    }
    await page.locator('.ltp-toolbar [data-lt-format-set="9:16"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '9:16');
    await page.locator('.ltp-toolbar [data-lt-format-set="16:9"]').click();

    /* The break is offered as a key rather than a drag, and it skips the 700ms rough state. */
    await toAct(page, 'act-break', 0.2);
    await page.locator('[data-lt-break-cta]').click();
    await expect(page.locator('[data-lt-dest][data-lt-state="LIVE"]')).toHaveCount(2, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(0);

    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 15_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="DEGRADED"]')).toHaveCount(0);
    await expect(page.locator('[data-lt-dest="youtube"] .lt-errorcard')).toBeVisible();
    await expect(page.locator('[data-lt-dest][data-lt-state="LIVE"]')).toHaveCount(2, {
      timeout: 15_000,
    });

    expect(errors, 'console errors under reduced motion').toEqual([]);
  });
});

/* ============================================================== P2 the budget */

test.describe('P2 the page costs what it shows', () => {
  test.use({ viewport: DESK });

  test('P2 performance: an idle page does almost nothing, and the frame rate holds', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    /* Measured after the guided demo has finished, so this is the resting cost. */
    await page.waitForTimeout(5_500);

    await page.evaluate(() => {
      (window as unknown as { __ltLong: number[] }).__ltLong = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as unknown as { __ltLong: number[] }).__ltLong.push(entry.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
    });
    await page.waitForTimeout(6_000);

    const long = await page.evaluate(() => (window as unknown as { __ltLong: number[] }).__ltLong);
    expect(long.length, `long tasks while idle: ${JSON.stringify(long)}`).toBeLessThan(3);

    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const started = performance.now();
          const step = (): void => {
            frames += 1;
            if (performance.now() - started < 1_000) requestAnimationFrame(step);
            else resolve(Math.round((frames * 1_000) / (performance.now() - started)));
          };
          requestAnimationFrame(step);
        }),
    );
    expect(fps, `the page ran at ${fps} fps`).toBeGreaterThanOrEqual(40);
  });

  test('P2 the page loads clean on a desk', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    /* Long enough for the guided demo to run out and for every module to have mounted. */
    await page.waitForTimeout(5_500);
    expect(errors).toEqual([]);
  });
});

test.describe('P2 the page costs what it shows, on a phone', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('P2 the page loads clean on a phone', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(5_500);
    expect(errors).toEqual([]);
  });
});
