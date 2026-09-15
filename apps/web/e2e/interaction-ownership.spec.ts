import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  auditInteractionOwnership,
  focusableInsideAriaHidden,
  hitTestStop,
  seedApp,
  unreachableControls,
} from './helpers.js';

/**
 * §17 ONE REGION = ONE INTERACTION OWNER, as a standing measurement.
 *
 * Two audits of this product found the same class of bug three separate times, and each time the
 * diagnosis was different and each time the mechanism was identical: the region a person was
 * looking at was not the region that owned the input at that point.
 *
 *   1. A chapter band at `opacity: 0` with `pointer-events: auto` lay across the middle of the
 *      stage. It captured the centre of "Use my camera" and of four Connect buttons, and because
 *      it was the document's only scroll container it swallowed the first wheel tick as well.
 *      Twice written off as unreproducible, because no wheel listener existed — hit-testing does
 *      not need one.
 *   2. A decorative guides overlay, which nobody could see and everybody's clicks could.
 *   3. The inverse: a fully visible band left untouchable by a frame race.
 *
 * Everything the product had asked "is the control visible?". None of it asked the only question
 * that matters — "is the control the thing a tap there would reach?" — so none of it could see
 * any of the three. `landing-and-layout.spec.ts` grew the first version of the right measurement,
 * pinned to one page at one viewport with a grid of hard-coded pixel offsets. This file is that
 * measurement generalised to every route the product has, at the two viewports that matter, under
 * both motion preferences, sharing one implementation in `helpers.ts` with the landing test.
 *
 * Nothing here is exempt. The `ignore` option exists in the helper and is deliberately unused:
 * an exemption with no written reason is how this bug came back the second time.
 *
 * Two defects are carried here as `test.fail()` reproductions rather than fixed, because neither
 * is in this team's files: the landing page's band trap, which is the original bug reached by a
 * dropped frame (`public/main.ts`), and the Quick Tour offer answering for controls it promises
 * to leave alone (`components/Tour.tsx`, `components/tour.css`). Both name the line that has to
 * change, and both turn green the moment it does.
 */

/** Every address the application answers on, plus the marketing document. */
const ROUTES = [
  { path: '/', anchor: 'html.sc-ready', name: 'the landing page' },
  { path: '/app', anchor: '.lt-studio', name: '/app (which decides, and lands on Studio)' },
  { path: '/app/start', anchor: '.lt-onboarding', name: 'onboarding' },
  { path: '/app/studio', anchor: '.lt-studio', name: 'Studio' },
  { path: '/app/destinations', anchor: '.lt-shell__main', name: 'Destinations' },
  { path: '/app/moments', anchor: '.lt-shell__main', name: 'Moments' },
  { path: '/app/settings', anchor: '.lt-shell__main', name: 'Settings' },
  { path: '/app/recordings', anchor: '.lt-shell__main', name: 'Recordings' },
] as const;

const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'phone 390x844', width: 390, height: 844 },
] as const;

/**
 * Both motion preferences, because `prefers-reduced-motion` changes which layers exist.
 *
 * A transition that is skipped under `reduce` can leave an element parked at the opacity it was
 * animating from — which is precisely the ghost layer this file is about — and a transition that
 * runs under `no-preference` can leave one hit-testable for the frames it is fading through.
 */
const MOTION = ['no-preference', 'reduce'] as const;

/** Let the route paint, the canvas start, and any entrance transition finish. */
async function settle(page: Page, anchor: string): Promise<void> {
  await page.waitForSelector(anchor, { timeout: 30_000 });
  await page.waitForTimeout(900);
}

for (const motion of MOTION) {
  for (const viewport of VIEWPORTS) {
    test.describe(`one interaction owner · ${viewport.name} · motion ${motion}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: motion,
      });

      for (const route of ROUTES) {
        test(`${route.name} has one interaction owner at every point`, async ({ page }) => {
          await seedApp(page, { destinations: 2 });
          await page.goto(route.path);
          await settle(page, route.anchor);

          /*
           * The landing page is asked a different form of the same question, and the difference
           * is worth the branch.
           *
           * An app route is a document that sits still, so "let it settle, then look" is the
           * whole question. `/` is eight chapters of scroll-driven reveal whose interactive
           * classes are recomputed a frame or two after each scroll, so looking immediately
           * catches layers mid-handover: the useful question there is not "is anything wrong at
           * this instant" but "did anything stay wrong", which is what `framesOpen` answers and
           * what separates a handover from a trap. The trap that `/` does have is not found by
           * either form reliably — it needs a busy main thread — so it has its own deterministic
           * reproduction further down, under "the landing page layers".
           */
          if (route.path === '/') {
            const transients = await auditInteractionOwnership(page, {
              step: 48,
              scrollStep: 100,
              measureFramesToClear: true,
            });
            expect(
              transients.filter((v) => v.framesOpen === -1),
              `${route.path} at ${viewport.name} (${motion}): an invisible layer never stopped taking input`,
            ).toEqual([]);
            expect(
              transients.reduce((a, v) => Math.max(a, v.framesOpen ?? 0), 0),
              `${route.path} at ${viewport.name} (${motion}): an invisible layer stayed interactive for ${JSON.stringify(transients.slice(0, 2))}`,
            ).toBeLessThanOrEqual(15);
            return;
          }

          expect(
            await auditInteractionOwnership(page, { step: 48, scrollStep: 200 }),
            `${route.path} at ${viewport.name} (${motion}): something that cannot be seen is taking input`,
          ).toEqual([]);
        });

        test(`${route.name} has no control that another element would answer for`, async ({
          page,
        }) => {
          await seedApp(page, { destinations: 2, tourAnswered: true });
          await page.goto(route.path);
          await settle(page, route.anchor);

          expect(
            await unreachableControls(page),
            `${route.path} at ${viewport.name} (${motion}): these controls are covered wherever the page is scrolled, so a tap at their own centre never reaches them`,
          ).toEqual([]);
        });

        test(`${route.name} hides nothing focusable from a screen reader`, async ({ page }) => {
          await seedApp(page, { destinations: 2 });
          await page.goto(route.path);
          await settle(page, route.anchor);

          expect(
            await focusableInsideAriaHidden(page),
            `${route.path} at ${viewport.name}: a keyboard can land on something marked aria-hidden`,
          ).toEqual([]);
        });
      }
    });
  }
}

/**
 * The instrument, tested.
 *
 * A green invariant is worth exactly as much as its ability to go red, and this one has a long
 * history of being green while the bug was on the screen. So the three historical shapes are
 * rebuilt on a real page and the detector is asked to find each of them: the transparent band
 * with `pointer-events: auto`, the decorative overlay that is `visibility: hidden` from a
 * parent and hit-testable from a child, and a full-window layer at an opacity nobody can see.
 */
test.describe('the detector detects', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an invisible band over the stage is reported, with the element that has to change', async ({
    page,
  }) => {
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/studio');
    await page.waitForSelector('.lt-studio');
    await page.waitForTimeout(600);

    expect(await auditInteractionOwnership(page, { step: 48 })).toEqual([]);

    await page.evaluate(() => {
      const band = document.createElement('div');
      band.id = 'lt-test-ghost';
      band.setAttribute('style', [
        'position: fixed',
        'left: 0',
        'right: 0',
        'top: 30%',
        'height: 140px',
        'opacity: 0',
        'pointer-events: auto',
        'z-index: 99999',
      ].join(';'));
      document.body.append(band);
    });

    const found = await auditInteractionOwnership(page, { step: 48 });
    expect(found.length, 'the detector missed a transparent band across the stage').toBeGreaterThan(
      0,
    );
    expect(
      found.every((v) => v.culprit.includes('lt-test-ghost')),
      `the detector blamed the wrong element: ${JSON.stringify(found)}`,
    ).toBe(true);
    expect(found.map((v) => v.kind).sort()).toContain('transparent');

    await page.evaluate(() => document.getElementById('lt-test-ghost')?.remove());
    expect(await auditInteractionOwnership(page, { step: 48 })).toEqual([]);
  });

  test('a child made visible inside a hidden parent is reported', async ({ page }) => {
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/studio');
    await page.waitForSelector('.lt-studio');
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'lt-test-hidden-host';
      host.setAttribute(
        'style',
        'position: fixed; inset: 20% 10%; visibility: hidden; z-index: 99999',
      );
      const child = document.createElement('button');
      child.type = 'button';
      child.textContent = 'invisible but clickable';
      child.setAttribute('style', 'visibility: visible; width: 100%; height: 100%; opacity: 1');
      host.append(child);
      document.body.append(host);
    });

    const found = await auditInteractionOwnership(page, { step: 48 });
    expect(
      found.some((v) => v.kind === 'invisible' && v.culprit.includes('lt-test-hidden-host')),
      `the detector missed a visible child inside a hidden parent: ${JSON.stringify(found)}`,
    ).toBe(true);

    await page.evaluate(() => document.getElementById('lt-test-hidden-host')?.remove());
  });

  test('a control covered at every scroll position is reported, and a pinned bar is not', async ({
    page,
  }) => {
    // The Quick Tour offer has a standing defect of its own, below; this is about the detector.
    await seedApp(page, { destinations: 2, tourAnswered: true });
    await page.goto('/app/studio');
    await page.waitForSelector('.lt-studio');
    await page.waitForTimeout(600);

    await page.evaluate(() => {
      const lid = document.createElement('div');
      lid.id = 'lt-test-lid';
      lid.setAttribute(
        'style',
        'position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 99999',
      );
      document.body.append(lid);
    });
    const lost = await unreachableControls(page);
    expect(lost.length, 'the detector missed a lid over the whole window').toBeGreaterThan(0);
    expect(
      lost.every((c) => c.covered.includes('lt-test-lid')),
      `the detector blamed the wrong element: ${JSON.stringify(lost.slice(0, 2))}`,
    ).toBe(true);

    await page.evaluate(() => document.getElementById('lt-test-lid')?.remove());
    expect(await unreachableControls(page)).toEqual([]);
  });

  test('a focusable control marked aria-hidden is reported', async ({ page }) => {
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/studio');
    await page.waitForSelector('.lt-studio');
    await page.waitForTimeout(400);

    expect(await focusableInsideAriaHidden(page)).toEqual([]);
    await page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.id = 'lt-test-aria';
      wrap.setAttribute('aria-hidden', 'true');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'a control nobody is told about';
      wrap.append(button);
      document.body.append(wrap);
    });
    expect(
      await focusableInsideAriaHidden(page),
      'the detector missed a focusable control inside aria-hidden',
    ).not.toEqual([]);
    await page.evaluate(() => document.getElementById('lt-test-aria')?.remove());
  });
});

/**
 * The same walk, over a Studio that is actually broadcasting.
 *
 * The live state adds the one layer in the product that is pinned over everything else, and the
 * live state is the one in which an ownership failure costs the most.
 */
test.describe('one interaction owner while live', () => {
  for (const viewport of VIEWPORTS) {
    test(`nothing invisible takes input during a broadcast at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedApp(page, { destinations: 2 });
      await page.goto('/app/studio');
      await page.getByRole('button', { name: 'Go live', exact: true }).click();
      await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
        timeout: 25_000,
      });
      await page.waitForTimeout(800);

      expect(
        await auditInteractionOwnership(page, { step: 48, scrollStep: 200 }),
        `Studio while live at ${viewport.name}: something invisible is taking input`,
      ).toEqual([]);

      // And the one control that must never lose ownership still has it.
      const stop = await hitTestStop(page);
      expect(stop.onTop, `the END control is covered by ${stop.hitBy}`).toBe(true);
    });
  }

  /**
   * The live bar is pinned over every screen, so it is the product's own best candidate for
   * covering something. `AppShell` puts `is-onair` on the shell to end the scrolling column above
   * it; this is the measurement that says the padding is enough, on every route, while live.
   */
  for (const viewport of VIEWPORTS) {
    test(`the live bar covers no control on any route at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedApp(page, { destinations: 3 });
      await page.goto('/app/studio');
      await page.getByRole('button', { name: 'Go live', exact: true }).click();
      await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
        timeout: 25_000,
      });

      const nav = page.getByRole('navigation', { name: 'LIVETAP' });
      for (const label of ['Moments', 'Destinations', 'Recordings', 'Settings', 'Studio'] as const) {
        await nav.getByRole('link', { name: label, exact: true }).click();
        await page.waitForTimeout(500);
        expect(
          await unreachableControls(page),
          `${label} while live at ${viewport.name}: these controls are covered at every scroll position`,
        ).toEqual([]);
      }

      await page.locator('[data-lt-stop="end"]').click();
      await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
    });
  }
});

/* ============================================== the layer that started all of this, bounded */

/**
 * The landing page's scroll-driven layers, and the window in which the original bug still exists.
 *
 * `acts.css` states the invariant in its own words — "a band that cannot be seen cannot be
 * touched" — and enforces it with `visibility` rather than `pointer-events` alone, because
 * `visibility` also removes the element from hit-testing for the wheel and both failures were
 * real. The class that grants `visibility: visible; pointer-events: auto` is `is-here`, and
 * `syncBandHits` in `public/main.ts` derives it from the band's own rendered opacity precisely so
 * that "the class can never disagree with what is on screen".
 *
 * It can, briefly. `syncBandHits` runs from a `scroll` listener through `requestAnimationFrame`,
 * and once more on the following frame, so the class trails the opacity — and under
 * `prefers-reduced-motion: reduce`, where the opacity steps rather than eases, the trailing is
 * maximal. Two layers do it, both measured here, both reproducible by walking `/` in 100px steps:
 *
 *   · 1440x900, scrollY 7200. `div.ltp-band.ltp-band--tall.is-here` is at `opacity: 0` with
 *     `pointer-events: auto`, over `li.ltp-dest.is-suggested.is-mine` — a destination tile, which
 *     is one of the exact controls the original band ate.
 *   · 390x844, scrollY 7100. `section.ltv-lane` is `visibility: hidden` while its own chips are
 *     `visibility: visible`, so the chips are hit-testable and they sit over `div.ltp-stagewrap`.
 *
 * FINDING, severity LOW. `apps/web/src/public/main.ts:2225` `syncBandHits`, and whatever writes
 * the versus lane's visibility beside it. Both close well inside 250 ms — parked at either
 * position the page is correct at +250 ms, +1 s and +3 s — so the exposure is the tail of an
 * active scroll rather than a state a reader sits in, the panel no longer has `overflow-y: auto`
 * so the swallowed-wheel half of the original bug is gone, and a click that lands inside the
 * window is possible rather than likely. It is reported because the mechanism is the mechanism,
 * and because the distance between "a few frames" and "until the next scroll event" is one
 * missing call.
 *
 * This test is the guard on that distance. It does not demand zero frames: that would mean
 * computing the class in the same pass that writes the opacity, which is a change to the engine's
 * contract and not this team's call. It demands that the window stay a window — `framesOpen` of
 * `-1` means it never closed, which is the original bug, back.
 */
test.describe('the landing page layers', () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.name}`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      });

      test('nothing invisible stays interactive for longer than a scroll takes', async ({
        page,
      }) => {
        await page.goto('/');
        await page.waitForSelector('html.sc-ready');
        await page.waitForTimeout(1200);

        const transients = await auditInteractionOwnership(page, {
          step: 48,
          scrollStep: 100,
          measureFramesToClear: true,
        });

        const permanent = transients.filter((v) => v.framesOpen === -1);
        expect(
          permanent,
          'these never stopped taking input: an invisible layer is permanently on top, which is the bug this whole file exists for',
        ).toEqual([]);

        const worst = transients.reduce((a, v) => Math.max(a, v.framesOpen ?? 0), 0);
        expect(
          worst,
          `an invisible layer stayed interactive for ${worst} frames at ${viewport.name}: ${JSON.stringify(transients.slice(0, 2))}`,
        ).toBeLessThanOrEqual(15);
      });

    });
  }
});

/**
 * The deterministic reproduction of the landing page's own trap, at the width it was measured at.
 *
 * Kept out of the viewport loop above on purpose: the scroll offsets below are the act boundary
 * at 1440x900 and nowhere else, and a reproduction that guesses at a coordinate is a
 * reproduction that will one day pass for the wrong reason. The mechanism is not
 * width-specific; the numbers are.
 */
test.describe('the landing page, with a frame dropped', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

    /**
     * DEFECT — CONFIRMED, and this is the original bug, back, for the third time.
     *
     * The handover above is harmless while the main thread is free, because `syncBandHits` gets
     * its two frames and the class catches up. Take those two frames away and the class never
     * catches up at all, because nothing else ever calls it: `syncBandHits` runs only from the
     * `scroll` listener's `requestAnimationFrame` and from the one `settle()` frame after it.
     * Miss both and the band keeps `is-here` — `visibility: visible; pointer-events: auto` —
     * while its own opacity finishes falling to 0, and it keeps it until the next scroll event,
     * which on a page a reader has stopped scrolling is never.
     *
     * Reproduction, deterministic, 1440x900 under `prefers-reduced-motion: reduce`:
     *   1. Walk `/` from the top to scrollY 7100 in 100px steps, settling at each.
     *   2. Scroll one more notch, to 7200 — the step that changes which band is showing.
     *   3. Hold the main thread for 350 ms across that step. A `while` loop here; in the
     *      product, the 3402 ms task the performance workstream is chasing, or the 22.5 fps
     *      the same page reports with a camera live.
     *   4. Wait. `div.ltp-band.ltp-band--tall.is-here` is at `opacity: 0`,
     *      `visibility: visible`, `pointer-events: auto`, over the destination column — at
     *      +1.5 s, at +5.5 s, and for as long as nobody scrolls again.
     *
     * The audit finds 27 sampled points where it answers for `li.ltp-dest.is-suggested.is-mine`.
     * That is the same element class the first audit reported as "four Connect buttons refused
     * my clicks", and this is the same invisible band, reached by a different route.
     *
     * Severity: HIGH on `/`. It is the product's front door, the trigger is a slow frame rather
     * than anything unusual, and the symptom is the one two first-time-creator audits already
     * reported and two diagnoses already missed.
     *
     * WHO MUST FIX IT: not this team — `apps/web/src/public/main.ts` is not ours.
     *   · `apps/web/src/public/main.ts:2225` `syncBandHits()` is correct and is called from
     *     one place that can be starved. `apply()` at :2232 is `requestAnimationFrame`-driven
     *     from the `scroll` listener at :2284, and `settle()` at :2279 adds exactly one more
     *     frame. Both can land before the engine writes the act's progress, and then nothing
     *     calls it again.
     *   · The shape of the fix is the one the file already argues for elsewhere: derive the
     *     interactive state from the rendered opacity in the same pass that renders it, or keep
     *     re-checking until the two agree, rather than sampling twice and hoping.
     *
     * FIXED 2026-09-15, and the fix is not a better sampler — it is to stop sampling.
     *
     * Measured first: the stuck band had NO inline styles at all. Its `opacity: 0` came from CSS
     * and its `pointer-events: auto` came from the stale class alone. So:
     *
     *   `.ltp-band--tall` declares its fade ONCE, as `--ltp-vis`, and uses it for its opacity.
     *   `.ltp-band` derives `--ltp-touchable` from that same variable as a near-step and clips
     *   itself to zero area when it reaches 0. A zero-area clip is out of hit-testing and out of
     *   the wheel, and it is a pure function of `--sc-p` — so there is no frame, no sampler and
     *   no class between the opacity and the guard. One expression, used twice.
     *
     *   The class still owns `visibility`, because CSS cannot take an element out of the tab
     *   order from a number, so `main.ts` reconciles it on a 250 ms interval too — a dead-man's
     *   switch rather than a render loop, four calls a second that do nothing when they agree.
     *
     * This test asserts the invariant now instead of reproducing its absence.
     */
    test('an invisible band does not stay interactive when a frame is dropped', async ({
      page,
    }) => {
      await page.goto('/');
      await page.waitForSelector('html.sc-ready');
      await page.waitForTimeout(1200);

      const stuck = await page.evaluate(async () => {
        const open = (): string[] => {
          const out: string[] = [];
          for (const band of Array.from(document.querySelectorAll('.ltp-band'))) {
            const cs = getComputedStyle(band);
            if (cs.pointerEvents === 'none' && cs.visibility === 'hidden') continue;
            if (Number.parseFloat(cs.opacity) > 0.05) continue;
            out.push(
              band.className +
                ' at opacity ' +
                cs.opacity +
                ', visibility ' +
                cs.visibility +
                ', pointer-events ' +
                cs.pointerEvents,
            );
          }
          return out;
        };

        for (let y = 0; y <= 7100; y += 100) {
          scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          await new Promise((r) => setTimeout(r, 120));
        }

        scrollTo({ top: 7200, behavior: 'instant' });
        const until = performance.now() + 350;
        while (performance.now() < until) {
          /* Hold the main thread across the frames that would have fixed the class. */
        }

        await new Promise((r) => setTimeout(r, 1500));
        const afterASecondAndAHalf = open();
        await new Promise((r) => setTimeout(r, 4000));
        return { afterASecondAndAHalf, afterFiveAndAHalf: open() };
      });

      expect(
        stuck.afterFiveAndAHalf,
        `an invisible band was still taking input five seconds after the scroll that hid it: ${stuck.afterASecondAndAHalf.join('; ')}`,
      ).toEqual([]);
    });
});

/* ========================================== a defect found here, and whose it is to fix */

/**
 * DEFECT — CONFIRMED. The Quick Tour offer covers the controls behind it, at every width.
 *
 * `Tour.tsx` states its own contract in its header comment: "It is an offer, not an interruption.
 * There is no scrim. The positioning layer is `pointer-events: none` and only the card itself
 * takes clicks, so the page behind is fully usable while the tour is up." The layer is indeed
 * `pointer-events: none`. The card is not, and the card is parked exactly where other controls
 * already are.
 *
 * Measured, on a first visit — which is every visit that sees the offer:
 *   · desk, 1440x900. The card's box is [1172, 16, 252, 110]. The demo banner's own
 *     "Manage demo destinations" link is at [1215, 53, 160, 18] — entirely inside it. The link is
 *     covered on `/app`, `/app/studio`, `/app/destinations`, `/app/moments`, `/app/settings` and
 *     `/app/recordings`, at both motion settings, and at every scroll position, because both the
 *     card and the banner sit at the top.
 *   · phone, 390x844. `tour.css:69` makes the card full width, so the band it takes across the
 *     top of the viewport also covers the three stream-shape radios ("Widescreen 16 by 9",
 *     "Vertical 9 by 16", "Square 1 by 1"), the health pill, the microphone picker and the MUTE
 *     toggle, depending on scroll position.
 *
 * Expected: the page behind an offer that is explicitly not a modal is usable, which is what the
 * component says it is for. Observed: a first-time creator's taps on those controls reach the
 * tour card. Mute in particular is the control the product's own spec calls the most common
 * silent failure in the category.
 *
 * Severity: medium on a desk (one secondary link), high on a phone (the shape control and MUTE).
 * It clears the moment the offer is answered, so it is bounded to the first visit — but the first
 * visit is the one this product is built around.
 *
 * WHO MUST FIX IT: stream A5, in its own files.
 *   · `apps/web/src/components/tour.css:52` the card is `inset-block-start: space-4;
 *     inset-inline-end: space-4`, the same corner `MockBanner`'s action link occupies.
 *   · `apps/web/src/components/tour.css:69` at phone widths `inset-inline: space-4` widens it to
 *     the full column, which is what pulls the shape control and MUTE under it.
 *   · `apps/web/src/components/Tour.tsx:20` the comment that has to become true again.
 *
 * Not fixed here: `Tour.tsx` and `tour.css` are not this team's files. `test.fail()` so the
 * reproduction stands and turns green the moment the card stops landing on other controls.
 */
test.describe('the Quick Tour offer', () => {
  for (const viewport of VIEWPORTS) {
    test(`does not cover the controls behind it at ${viewport.name}`, async ({ page }) => {
      test.fail();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedApp(page, { destinations: 2 });
      await page.goto('/app/studio');
      await page.waitForSelector('.lt-studio');
      await page.waitForTimeout(900);

      // If the offer is not showing, there is nothing to measure and nothing to claim.
      expect(await page.locator('.lt-tour__card').count(), 'the tour offer did not appear').toBe(1);

      /*
       * The right question for a card pinned to the viewport is not "is some control covered
       * everywhere" — a reader can always scroll a control out from under a pinned thing, and on
       * a phone they can here. It is "is there a place the reader can be, looking at a control,
       * where the card answers for it". So the page is walked and the union is taken: every
       * control that at some scroll position is on screen, looks tappable, and is not.
       */
      const shadowed = await page.evaluate(async () => {
        const SELECTOR =
          'button, a[href], input, select, textarea, [role="switch"], [role="radio"], [role="tab"]';
        const describe = (node: Element): string => {
          const raw = typeof node.className === 'string' ? node.className.trim() : '';
          return (node.tagName.toLowerCase() + (raw ? '.' + raw.split(/\s+/).join('.') : '')).slice(
            0,
            80,
          );
        };
        const seen = new Map<string, string>();
        const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        for (let y = 0; y <= max; y += 100) {
          scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
            if (el.closest('.lt-tour')) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (!hit?.closest('.lt-tour')) continue;
            seen.set(
              describe(el),
              (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) +
                ' (at scrollY ' +
                Math.round(scrollY) +
                ')',
            );
          }
        }
        scrollTo({ top: 0, behavior: 'instant' });
        return Array.from(seen, ([control, label]) => control + ' — ' + label);
      });
      expect(
        shadowed,
        `the Quick Tour offer is covering controls that its own header comment promises stay usable`,
      ).toEqual([]);
    });
  }
});

/* ======================================================= §17 modal surfaces must block */

/**
 * A modal that does not block is worse than no modal: it teaches a creator that the thing behind
 * it is unreachable and then lets a mis-aimed tap reach it anyway.
 *
 * `Sheet` is the only true modal surface in the product — `role="dialog"`, `aria-modal="true"`,
 * a focus trap, Escape, a scrim. It is mounted from two places, with different content and
 * different footers, so both are driven here rather than testing the component in isolation:
 *
 *   - Destinations → "Add destination"
 *   - Moments in Pro → the OBS import report
 *
 * The other two things that look like modals are deliberately not modals, and that is asserted
 * rather than assumed further down: the §37 real-broadcast confirmation is a step in the column
 * the creator is already reading, and the Remove / Disconnect confirmations are inline in the
 * card they act on.
 */
/**
 * The smallest file `importObsSceneCollection` accepts: one scene, one camera in it.
 *
 * Shaped like the real thing — a flat `sources` list where a scene is a source with `id: "scene"`
 * whose settings hold the items — because the importer reads that shape and a hand-waved
 * `{ scenes: [...] }` is silently rejected, which would make this test pass for the wrong reason.
 */
const OBS_COLLECTION = {
  name: 'QA collection',
  scene_order: [{ name: 'Talk' }],
  sources: [
    {
      id: 'scene',
      versioned_id: 'scene',
      name: 'Talk',
      settings: {
        items: [
          {
            name: 'Cam',
            id: 1,
            visible: true,
            pos: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            bounds: { x: 0, y: 0 },
            bounds_type: 'OBS_BOUNDS_NONE',
            alignment: 5,
          },
        ],
      },
    },
    { id: 'av_capture_input', versioned_id: 'av_capture_input', name: 'Cam', settings: {} },
  ],
};

/**
 * Every point in the viewport that a modal has left reachable.
 *
 * "Modal" is a claim about the whole window, not about the rectangle the panel happens to
 * occupy, so the measurement is the whole window: a grid of points, each hit-tested, each
 * required to land on the dialog or its scrim. The one exception written into the assertion is
 * the live bar, which outranks a Sheet on purpose — a creator who opened a panel and then needs
 * to stop must be able to stop without first finding the way out of the panel.
 */
async function pointsLeftReachable(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const leaks: string[] = [];
    for (let x = 8; x < innerWidth - 8; x += 60) {
      for (let y = 8; y < innerHeight - 8; y += 60) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) {
          leaks.push(`(${x},${y}) reaches nothing at all`);
          continue;
        }
        if (hit.closest('.lt-sheet, .lt-sheet__scrim, .lt-livebar')) continue;
        leaks.push(
          `(${x},${y}) reaches ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 50)}`,
        );
      }
    }
    return leaks;
  });
}

test.describe('a modal surface blocks what is behind it', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openAddDestinationSheet(page: Page): Promise<void> {
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/destinations');
    await page.getByRole('switch', { name: 'In your next stream' }).first().waitFor();
    await page.getByRole('button', { name: /Add destination/ }).first().click();
    await expect(page.locator('.lt-sheet')).toBeVisible();
  }

  test('a click over the content behind the sheet does not reach it', async ({ page }) => {
    await openAddDestinationSheet(page);

    /*
     * The toggle is the right probe: it is the most consequential control on the screen behind
     * (it decides what is in the next stream) and its state is readable, so "the click did not
     * get through" is measured on the product rather than on the hit test alone.
     */
    const toggle = page.getByRole('switch', { name: 'In your next stream' }).first();
    const before = await toggle.getAttribute('aria-pressed');
    const box = (await toggle.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const reached = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return {
          isTheToggle: Boolean(hit?.closest('[role="switch"]')),
          blockedBy: hit
            ? `${hit.tagName.toLowerCase()}.${typeof hit.className === 'string' ? hit.className : ''}`
            : 'nothing',
        };
      },
      centre,
    );
    expect(
      reached.isTheToggle,
      `a tap behind the sheet reaches the toggle; only ${reached.blockedBy} should be there`,
    ).toBe(false);

    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(250);
    expect(
      await toggle.getAttribute('aria-pressed'),
      'a click through the scrim changed what is in the next stream',
    ).toBe(before);
  });

  test('nothing anywhere in the window behind it is reachable', async ({ page }) => {
    await openAddDestinationSheet(page);
    expect(
      await pointsLeftReachable(page),
      'these points behind an aria-modal dialog still reach the screen underneath',
    ).toEqual([]);
  });

  test('Escape closes it, and so does the explicit dismiss', async ({ page }) => {
    await openAddDestinationSheet(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.lt-sheet'), 'Escape did not close the sheet').toHaveCount(0);

    await page.getByRole('button', { name: /Add destination/ }).first().click();
    await expect(page.locator('.lt-sheet')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.lt-sheet'), 'the close button did not close the sheet').toHaveCount(
      0,
    );
  });

  test('focus is trapped inside it, forwards and backwards', async ({ page }) => {
    await openAddDestinationSheet(page);

    // Focus is moved in when it opens, not left on the button that is now behind a scrim.
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('.lt-sheet'))),
      'opening the sheet left focus outside it',
    ).toBe(true);

    const escaped: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (el?.closest('.lt-sheet')) return null;
        return el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}` : 'nothing';
      });
      if (where !== null) escaped.push(`Tab #${i + 1} landed on ${where}`);
    }
    expect(escaped.slice(0, 3), 'Tab walked out of an aria-modal dialog').toEqual([]);

    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const out = await page.evaluate(() => !document.activeElement?.closest('.lt-sheet'));
      expect(out, `Shift+Tab #${i + 1} walked out of an aria-modal dialog`).toBe(false);
    }
  });

  test('the sheet declares itself a modal, and its scrim is not a control', async ({ page }) => {
    await openAddDestinationSheet(page);
    const sheet = page.locator('.lt-sheet');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    // A scrim that announces itself is a control with no name; it is decoration that happens to
    // be convenient, so it is hidden from assistive technology and reachable only by pointer.
    await expect(page.locator('.lt-sheet__scrim')).toHaveAttribute('aria-hidden', 'true');
    expect(
      await page.locator('.lt-sheet__scrim').evaluate((el) => el.matches('button, a, [role]')),
      'the scrim is exposed as a control',
    ).toBe(false);
  });

  /**
   * The second mounting of the same component, reached the way a Pro creator reaches it.
   *
   * A component tested once in one place is a component tested in one place. This one opens from
   * a file the user picks, carries a footer with two actions, and sits inside a Card rather than
   * at the top level of the screen.
   */
  test('the OBS import report blocks the screen it opened from', async ({ page }) => {
    await seedApp(page, { mode: 'pro', destinations: 2 });
    await page.goto('/app/moments');
    const picker = page.getByLabel('Choose an OBS scene collection file');
    await picker.setInputFiles({
      name: 'collection.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(OBS_COLLECTION)),
    });

    const sheet = page.locator('.lt-sheet');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet).toHaveAttribute('aria-modal', 'true');

    expect(
      await pointsLeftReachable(page),
      'the import report left part of the screen behind it reachable',
    ).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  /**
   * The two surfaces that look like modals and are deliberately not, stated so a later change
   * cannot quietly turn one into a modal without answering for it.
   */
  test('the confirmations that are deliberately inline stay inline', async ({ page }) => {
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/destinations');
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click();

    await expect(page.getByText(/Its stream key is deleted from this device/)).toBeVisible();
    expect(
      await page.locator('[role="dialog"]').count(),
      'the Remove confirmation became a modal; §37 says a confirmation belongs in the column being read',
    ).toBe(0);
    expect(await page.locator('.lt-sheet__scrim').count()).toBe(0);

    // "Keep" leaves everything exactly as it was, which is the point of an inline confirmation.
    await page.getByRole('button', { name: 'Keep', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove', exact: true }).first()).toBeVisible();
  });

  /**
   * A mock build must never show the real-broadcast confirmation.
   *
   * `.lt-realconfirm` is raised by `startCountdown` only when `broadcastReality(...).real` is
   * non-empty, and on a mock registry it never is. That makes the interstitial unreachable from
   * this build — so rather than pretend to drive it, the honest assertion is the honesty rule
   * itself: a build that can reach nothing must never claim it is about to.
   */
  test('a simulated build never raises the real-broadcast confirmation', async ({ page }) => {
    await seedApp(page, { destinations: 2, ack: false });
    await page.goto('/app/studio');
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.locator('.lt-livebar')).toBeVisible({ timeout: 25_000 });
    expect(
      await page.locator('.lt-realconfirm').count(),
      'a demo build told the creator their real accounts were about to carry a broadcast',
    ).toBe(0);
  });
});
