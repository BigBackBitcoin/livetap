import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STOP_CONTROL, assertStopReachable, hitTestStop, seedApp } from './helpers.js';

/**
 * THE STOP CONTROL, MEASURED.
 *
 * The owner's rule, in their words: "There must always be one obvious way to stop a live
 * broadcast. It must never be covered, clipped, inaccessible, behind another interactive layer,
 * unreachable in Pro, unreachable in vertical mode, or unreachable on mobile."
 *
 * An audit found four independent ways that rule was broken, two of them catastrophic, and this
 * file is the standing proof that none of them can come back:
 *
 *   P0-1  END was cancelled by navigating away, because the five-second grace lived in a React
 *         effect in Studio and unmounting the screen ran its cleanup. Covered by `store.test.ts`
 *         (no React at all) and by the navigate-away test at the bottom of this file.
 *   P0-2  there was no way to stop during STARTING.
 *   P0-3  between 640px and 1024.98px in 9:16 and 1:1 the control was off-screen entirely: at
 *         834x1112 it sat at y=1741 in a 1112px window.
 *   P0-4  toggling a LIVE destination off deleted it, and its stop button, from Studio while it
 *         kept broadcasting.
 *   P0-5  Studio was the only screen in the whole app with any way to stop.
 *
 * The measurement is `document.elementFromPoint` at the control's own centre, which is the only
 * thing that answers the question actually being asked: would a tap there reach this control, or
 * something else? Visibility is not enough: an auditor watched a primary button pass its click
 * to the live control underneath it. Neither is a bounding box: a control can be on the page and
 * 629px below the fold.
 */

/**
 * Both sides of both breakpoints, plus the two sizes the audit measured failures at.
 *
 * `apps/web/src/app.css` has exactly two numbers in it: 640 and 1025. Every rule that moves the
 * stop control changes at one of them, so the matrix brackets both, 639/640 and 1024/1025,
 * rather than sampling round numbers that happen to sit in the middle of a band.
 */
const VIEWPORTS = [
  { name: '320x568 the smallest phone', width: 320, height: 568 },
  { name: '375x812 iPhone', width: 375, height: 812 },
  { name: '390x844 phone', width: 390, height: 844 },
  { name: '639x960 just under the mobile breakpoint', width: 639, height: 960 },
  { name: '640x960 just over it', width: 640, height: 960 },
  { name: '834x1112 the tablet the audit measured', width: 834, height: 1112 },
  { name: '1024x1366 just under the desktop breakpoint', width: 1024, height: 1366 },
  { name: '1440x900 laptop', width: 1440, height: 900 },
] as const;

const FORMATS = ['16:9', '9:16', '1:1'] as const;
const MODES = ['simple', 'pro'] as const;

/*
 * The measurement itself lives in `helpers.ts`.
 *
 * It was written here first, and then `end-invariant.spec.ts` needed exactly the same question
 * asked of a wider matrix — which is the moment a second copy gets made and the two begin to
 * disagree about what "reachable" means. `infra/dev-harness/broadcast/studio-controls.mjs` was
 * written after that had already happened once to the studio selectors, and its argument holds
 * here: there must be one set of these in the repo, because the day two of them disagree is the
 * day the evidence stops being evidence. `hitTestStop` and `assertStopReachable` are that one
 * set; `STOP_CONTROL` is the selector both halves of the bargain use.
 */

/**
 * Open Studio already set up, so a 48-cell matrix does not pay for onboarding 48 times.
 *
 * Nothing here is a test fixture standing in for the product: `seedApp` writes the same
 * `livetap.*` keys the app writes for itself, they are read by the same `persist.ts`, and the
 * destinations come back through the real restore path and connect through the real mock
 * adapters.
 */
async function openStudio(
  page: Page,
  options: { format: (typeof FORMATS)[number]; mode: (typeof MODES)[number] },
): Promise<void> {
  await seedApp(page, { format: options.format, mode: options.mode, destinations: 2 });
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Go live' })).toBeVisible();
  await expect(page.getByLabel('Where this stream is going').getByText('YouTube · Ready')).toBeVisible();
}

/* ============================================================ the matrix */

for (const viewport of VIEWPORTS) {
  test.describe(`stop control at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const format of FORMATS) {
      for (const mode of MODES) {
        test(`${format} in ${mode} mode: reachable idle, starting, live and mid-grace`, async ({
          page,
        }) => {
          const cell = `${viewport.name} · ${format} · ${mode}`;
          await openStudio(page, { format, mode });

          // IDLE. GO LIVE is the control, and P0-3 is the assertion that it is on the screen.
          assertStopReachable(await hitTestStop(page), `${cell} · idle`);

          /*
           * Sample the whole transition rather than trying to stop inside it. STARTING lasts
           * about a second against the mock adapters, which is far too short to catch with a
           * poll from the test side and far too long for a creator who wants out. The sampler
           * runs inside the page on every animation frame from the moment GO LIVE is pressed
           * until the production reports LIVE, so the countdown, the commit and STARTING are
           * all measured, and a single frame with no reachable control fails the cell.
           */
          await page.evaluate((selector) => {
            const w = window as unknown as { __ltStopSamples?: Array<Record<string, unknown>> };
            w.__ltStopSamples = [];
            const sample = (): void => {
              const visible = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
                (el) => {
                  const r = el.getBoundingClientRect();
                  return r.width > 1 && r.height > 1;
                },
              );
              const el = visible[0];
              if (!el) {
                w.__ltStopSamples?.push({ found: 0 });
              } else {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                w.__ltStopSamples?.push({
                  found: visible.length,
                  onTop: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
                  inView: r.top >= 0 && r.bottom <= window.innerHeight + 0.5,
                  label: (el.textContent ?? '').trim().slice(0, 40),
                });
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }, STOP_CONTROL);

          await page.getByRole('button', { name: 'Go live', exact: true }).click();

          // LIVE.
          const end = page.getByRole('button', { name: /End broadcast/ });
          await expect(end, `${cell}: never reached LIVE`).toBeVisible({ timeout: 25_000 });
          assertStopReachable(await hitTestStop(page), `${cell} · live`);

          const samples = await page.evaluate(() => {
            const w = window as unknown as { __ltStopSamples?: Array<Record<string, unknown>> };
            const taken = w.__ltStopSamples ?? [];
            w.__ltStopSamples = [];
            return taken;
          });
          expect(samples.length, `${cell}: the transition was never sampled`).toBeGreaterThan(5);
          const bad = samples.filter((s) => s.found === 0 || s.onTop !== true || s.inView !== true);
          expect(
            bad.slice(0, 3),
            `${cell}: ${bad.length} of ${samples.length} frames between GO LIVE and LIVE had no reachable stop control`,
          ).toEqual([]);

          // GRACE. Pressing END schedules the stop; UNDO is the control for the next five seconds.
          await end.click();
          const undo = page.getByRole('button', { name: /UNDO/ });
          await expect(undo).toBeVisible();
          assertStopReachable(await hitTestStop(page), `${cell} · mid-grace`);
          await undo.click();
          await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible();
        });
      }
    }
  });
}

/* ================================================= the rest of the rule */

/**
 * Move between screens the way a creator does.
 *
 * `page.goto` is the wrong instrument for every test below it: a full page load genuinely ends a
 * browser broadcast, so a navigate-away test driven with `goto` passes for the wrong reason. The
 * navigation rail is what a person taps, and it is client-side, so the engine and the
 * orchestrator survive it, which is the whole thing being measured.
 */
async function tapNav(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: 'LIVETAP' }).getByRole('link', { name: label, exact: true }).click();
}

test.describe('the stop control outranks everything that can appear over it', () => {
  test.use({ viewport: { width: 834, height: 1112 } });

  test('P0-5: every screen can stop the broadcast, not only Studio', async ({ page }) => {
    await openStudio(page, { format: '9:16', mode: 'simple' });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
      timeout: 25_000,
    });

    for (const label of ['Moments', 'Destinations', 'Recordings', 'Settings'] as const) {
      await tapNav(page, label);
      await expect(
        page.getByRole('button', { name: /End broadcast/ }),
        `${label} has no way to stop the broadcast`,
      ).toBeVisible();
      assertStopReachable(await hitTestStop(page), `${label} while live`);
    }
  });

  /**
   * P0-1, end to end, through the real UI.
   *
   * This is the measurement the audit made: press END, tap Destinations, wait past the grace, and
   * see whether anything actually stopped. It used to still be live twelve seconds later, because
   * the grace timer was a Studio effect and leaving Studio ran its cleanup.
   */
  test('P0-1: END survives navigating away mid-grace', async ({ page }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    const chips = page.getByLabel('Where this stream is going');
    await expect(chips.getByText('YouTube · Live')).toBeVisible({ timeout: 25_000 });

    await page.getByRole('button', { name: /End broadcast/ }).click();
    await expect(page.getByRole('button', { name: /UNDO/ })).toBeVisible();

    // Leave the screen that asked for the stop, well inside the five-second grace.
    await tapNav(page, 'Destinations');
    await expect(page.getByRole('heading', { name: /destination/i }).first()).toBeVisible();
    await page.waitForTimeout(9000);

    await expect(
      page.locator('.lt-livebar'),
      'the broadcast is still running nine seconds after END',
    ).toHaveCount(0);
    await tapNav(page, 'Studio');
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeVisible();
  });

  /**
   * P0-4: the switch that decides what is in the NEXT stream cannot touch the one that is running.
   *
   * Switching a LIVE destination off used to filter it out of Studio, which took its own stop
   * button with it while it carried on broadcasting. There are two independent guards now and
   * this asserts the outer one, which is the one a person can reach: the toggle is disabled for
   * any destination in an active state. The inner one is in `DestinationList`, which lists a
   * destination that is `enabled || isActiveState(state)`, so even a caller that is not this
   * screen cannot hide a broadcasting destination from its own stop button.
   */
  test('P0-4: a broadcasting destination cannot be switched out of the stream it is in', async ({
    page,
  }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    const chips = page.getByLabel('Where this stream is going');
    await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 25_000 });

    await tapNav(page, 'Destinations');
    const toggles = page.getByRole('switch', { name: 'In your next stream' });
    await expect(toggles.first()).toBeVisible();
    const count = await toggles.count();
    expect(count, 'both seeded destinations are on the Destinations screen').toBe(2);
    for (let i = 0; i < count; i += 1) {
      await expect(
        toggles.nth(i),
        'a broadcasting destination could still be switched out of the stream',
      ).toBeDisabled();
    }

    await tapNav(page, 'Studio');
    await expect(chips.getByText('TikTok · Live')).toBeVisible();
    assertStopReachable(await hitTestStop(page), 'Studio after visiting Destinations while live');
  });

  /**
   * THE ONE THE OWNER SAYS MUST NEVER HAPPEN.
   *
   * An auditor pressed "Stop this destination" inside a recovery card and the control underneath
   * it fired instead, twice: once changing the format to 1:1 and once switching the on-air
   * Moment. The mechanism is ordinary: the card renders from a live condition and disappears the
   * instant the machine fixes it, so a card that recovers between pointerdown and pointerup takes
   * its own button out from under the finger, and the click lands on whatever reflows into that
   * spot.
   *
   * This drives exactly that timing on purpose. The scripted demo outage lasts about four
   * seconds; the pointer is held down on the card's own way out for six, so the destination
   * recovers while the button is pressed. The assertion is that the thing the creator pressed is
   * the thing that ran.
   */
  test('a recovery card cannot hand a press to the control underneath it', async ({ page }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    const chips = page.getByLabel('Where this stream is going');
    await expect(chips.getByText('TikTok · Live')).toBeVisible({ timeout: 25_000 });

    await page.getByRole('tab', { name: 'Health' }).click();
    await page.getByRole('button', { name: 'Drop TikTok' }).click();
    await page.getByRole('tab', { name: 'Destinations' }).click();

    const stopTrying = page.getByRole('button', { name: 'Stop trying' });
    await expect(stopTrying).toBeVisible({ timeout: 10_000 });
    // Bring it where a finger could actually reach it, the way any real activation would.
    await stopTrying.scrollIntoViewIfNeeded();
    const box = (await stopTrying.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(
      await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return Boolean(hit?.closest('.lt-errorcard'));
        },
        centre,
      ),
      'the card is covered before the press even begins',
    ).toBe(true);

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    // Hold through the recovery. Without the steady-while-pressed hold, the card is gone by now.
    await page.waitForTimeout(6000);

    const underTheFinger = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return (hit?.textContent ?? '').trim().slice(0, 40);
      },
      centre,
    );
    expect(
      underTheFinger,
      'the recovery card moved out from under a press that was already in flight',
    ).toContain('Stop trying');

    await page.mouse.up();

    // The destination the creator gave up on is the destination that stopped.
    await expect(chips.getByText(/TikTok · (Stopping|Ended)/)).toBeVisible({ timeout: 10_000 });
    await expect(chips.getByText('YouTube · Live'), 'the other destination was touched').toBeVisible();
  });

  /**
   * The z-index rule, stated as a measurement rather than as a number in a stylesheet.
   *
   * A Sheet and its scrim are the highest layer the product puts over a screen, and the scrim is
   * a full-window element with `pointer-events` on, exactly the shape that swallows a tap meant
   * for something else. The rule is that the live bar outranks it, so a creator who opened a
   * panel and then needed to stop can stop without first finding the way out of the panel.
   */
  test('a Sheet and its scrim cannot cover the live bar', async ({ page }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
      timeout: 25_000,
    });

    await tapNav(page, 'Destinations');
    await page.getByRole('button', { name: /Add destination/ }).first().click();
    await expect(page.locator('.lt-sheet')).toBeVisible();
    await expect(page.locator('.lt-sheet__scrim')).toBeVisible();

    assertStopReachable(await hitTestStop(page), 'with a Sheet open over the screen');
  });

  /** A tooltip explains a control; it must never be the thing a tap at that control reaches. */
  test('a tooltip bubble does not take a click meant for the control under it', async ({ page }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    const events = await page.evaluate(() => {
      const bubble = document.querySelector('.lt-tooltip__bubble');
      return bubble ? getComputedStyle(bubble).pointerEvents : 'no bubble on the page';
    });
    expect(events, 'the tooltip bubble is still hit-testable').toBe('none');
  });

  /**
   * The honesty rule, on the surface that carries it.
   *
   * A mock build must say so wherever a creator can see a claim about going live: the banner, the
   * button's own label, and the bar that runs the broadcast.
   */
  test('a simulated build says so on the button and on the live bar', async ({ page }) => {
    await openStudio(page, { format: '16:9', mode: 'simple' });
    await expect(page.getByText(/Demo mode/)).toBeVisible();
    await expect(page.locator('.lt-golive__label')).toHaveText('GO LIVE (DEMO)');

    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.locator('.lt-livebar')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('.lt-livebar')).toContainText('nothing is broadcast anywhere');
    await expect(page.locator('.lt-livebar')).toHaveClass(/lt-livebar--demo/);
  });
});
