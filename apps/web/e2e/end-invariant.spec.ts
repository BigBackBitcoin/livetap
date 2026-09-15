import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STOP_CONTROL, assertStopReachable, hitTestStop, seedApp, tabsToReach } from './helpers.js';

/**
 * §18 THE CREATOR MUST ALWAYS HAVE ACCESS TO END — as a matrix, measured automatically.
 *
 * The directive: "No matter: Simple, Pro, 16:9, 9:16, 1:1, camera state, destination count, error
 * state, reconnect state, Android, desktop. No overlay can cover it. No destination card can
 * intercept it. No hidden layer can capture it. Test this automatically."
 *
 * Four things are asserted of the stop control in every cell, because three of them have each
 * been false in this product at some point and the fourth is the only one that matters:
 *
 *   (a) it is in the DOM;
 *   (b) it is the topmost element at its own centre point, per `document.elementFromPoint` —
 *       visibility is not enough, an auditor watched a primary button hand its click to the live
 *       control underneath it, and a bounding box is not enough either, the control was once
 *       measurably 629px below the fold;
 *   (c) a keyboard can reach it from the top of the document in a bounded number of Tabs;
 *   (d) pressing it actually stops the broadcast.
 *
 * ---------------------------------------------------------------- what is real, and what is not
 *
 * REAL, driven entirely through the product's own UI:
 *   · Simple and Pro                — the shell's own Pro-mode toggle, via the stored `livetap.mode`
 *   · 16:9, 9:16 and 1:1            — the stored `livetap.settings.aspect`, the same key Settings writes
 *   · 1 and 3 destinations          — the stored `livetap.destinations`, restored through `persist.ts`
 *                                     and connected through the real mock adapters
 *   · 0 destinations                — the same, empty
 *   · camera absent                 — the runner has no camera, so `enumerateDevices` genuinely
 *                                     returns no `videoinput`. Nothing is stubbed at all.
 *   · live                          — a real GO LIVE through the real orchestrator
 *   · reconnecting                  — the demo failure panel, which raises the same `outputLost`
 *                                     event a real drop raises. The orchestrator's isolation,
 *                                     backoff and recovery all run for real.
 *   · one destination in trouble while the others stay live — the demo panel's "Make X rough",
 *     which raises `outputDegraded` and leaves that destination at "Live, rough" until something
 *     else moves it
 *   · error state                   — a camera-lost notice and an encoder-crash notice stacked
 *                                     over the column, raised as real engine events
 *
 * CONSTRUCTED, and said so rather than hidden:
 *   · The seeded destinations are written into `localStorage` rather than connected by hand
 *     through the Destinations sheet. The keys, the shapes and the restore path are the
 *     product's own; only the clicking is skipped, and 24 cells of onboarding would otherwise
 *     cost more than the matrix is worth.
 *   · camera present. Chromium's `--use-fake-device-for-media-stream` is the honest way to get
 *     one, but Playwright refuses `launchOptions` inside a `describe` — it forces a new worker —
 *     and hoisting it to the top of the file would make every cell camera-on. So the browser's
 *     `enumerateDevices` is wrapped to add one `videoinput`. The stub stops at the browser API:
 *     `useDevices` runs unchanged, `hasCamera` is computed by the product, and the resulting
 *     pre-flight row and Camera picker are the product's own. Nothing else in this build touches
 *     a camera — LIVETAP never calls `getUserMedia` on mount, by design — so this is the whole
 *     surface, and every cell verifies which side of it the page actually landed on.
 *
 * NOT REACHABLE from this build, and not faked:
 *   · A destination in `FAILED`. `onOutputLost` gives up immediately only for
 *     `INGEST_INVALID_KEY`, `AUTH_EXPIRED` and `AUTH_REVOKED`, and otherwise only after
 *     `reconnect.maxAttempts` (10) consecutive failures. The demo panel raises
 *     `INGEST_DISCONNECTED`, which recovers, and no surface in the product can raise the other
 *     three. The two nearest reachable states are driven above instead: RECONNECTING, and
 *     DEGRADED, which is the steady one — a destination in trouble while the rest carry on. Both
 *     exercise the branch that matters here, `production.liveCount < production.enabledCount` in
 *     Studio and in `LiveBar`. This is a gap in the product's own failure surface, not in this
 *     test: there is no way for a creator to see a FAILED destination in a demo build either.
 *   · The §37 real-broadcast confirmation. `startCountdown` raises it only when
 *     `broadcastReality(...).real` is non-empty, which a mock registry can never make true.
 *     `interaction-ownership.spec.ts` asserts the honesty rule instead: a build that can reach
 *     nothing must never claim it is about to.
 *
 * ------------------------------------------------------------------------------ why one viewport
 *
 * The live half of the matrix runs at 390x844. `live-safety.spec.ts` already walks eight widths
 * (both sides of both breakpoints, plus the two the audit measured failures at) across format and
 * mode, so re-running those here would buy nothing; what it does not vary is destination count,
 * camera state or error state, which is what this file adds. The phone is the width the control
 * was historically off the bottom of, so it is the width the new axes are varied at, and a
 * desktop pass at the end confirms the same on a full desk.
 */

const FORMATS = ['16:9', '9:16', '1:1'] as const;
const MODES = ['simple', 'pro'] as const;
const LIVE_COUNTS = [1, 3] as const;

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

/**
 * Give this browser a camera, at the browser API and nowhere above it.
 *
 * `useDevices` calls `navigator.mediaDevices.enumerateDevices()` and nothing else — LIVETAP never
 * calls `getUserMedia` on mount, so the OS prompt is never a surprise. Wrapping that one call is
 * therefore the entire camera surface of this build: everything the product then does with the
 * answer, from `hasCamera` through the pre-flight row to the Camera picker, runs untouched.
 */
async function giveThisBrowserACamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const api = navigator.mediaDevices;
    if (!api?.enumerateDevices) return;
    const original = api.enumerateDevices.bind(api);
    api.enumerateDevices = async (): Promise<MediaDeviceInfo[]> => {
      const real = await original();
      if (real.some((d) => d.kind === 'videoinput')) return real;
      const fake = {
        deviceId: 'qa-camera',
        groupId: 'qa-group',
        kind: 'videoinput' as MediaDeviceKind,
        label: 'QA camera',
        toJSON() {
          return this;
        },
      };
      return [...real, fake as MediaDeviceInfo];
    };
  });
}

/** The order `seedApp` hands them out in. */
const PLATFORM_NAMES = ['YouTube', 'TikTok', 'Twitch'] as const;

/**
 * The invariant in one call: either there is no broadcast, or there is one reachable way to stop.
 *
 * Stated as a disjunction on purpose. "END is always on the screen" is false and should be — it
 * is not on the screen when nothing is running — and a test that asserts the strong form has to
 * be weakened somewhere, which is how the weakening ends up in the wrong place.
 */
async function assertStopInvariant(page: Page, where: string): Promise<void> {
  const onAir = (await page.locator('.lt-livebar').count()) > 0;
  if (!onAir) {
    await expect(
      page.getByRole('button', { name: 'Go live', exact: true }),
      `${where}: no broadcast is running and Studio offers no way to start one either`,
    ).toBeVisible();
    return;
  }
  const report = await hitTestStop(page);
  expect(
    report.found,
    `${where}: a broadcast is running and there are ${report.found} visible stop controls`,
  ).toBe(1);
  assertStopReachable(report, where);
}

/** Open a set-up Studio and confirm out loud which cell of the matrix this actually is. */
async function openStudio(
  page: Page,
  cell: {
    format: (typeof FORMATS)[number];
    mode: (typeof MODES)[number];
    destinations: 0 | 1 | 3;
    camera: boolean;
  },
): Promise<void> {
  if (cell.camera) await giveThisBrowserACamera(page);
  await seedApp(page, {
    format: cell.format,
    mode: cell.mode,
    destinations: cell.destinations,
  });
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeVisible();

  /*
   * The cell is verified, not assumed. A matrix whose axes do not actually move is a matrix that
   * runs the same test 24 times, which is worse than running it once because it reads as coverage.
   *
   * Polled rather than read once, because `useDevices` enumerates in an effect and resolves a
   * promise: reading the picker the instant GO LIVE appears is reading it before the browser has
   * answered, and on a loaded machine that is most of the time. The first version of this did
   * read it once, passed twenty-four times, and then failed ten cells out of eighteen when the
   * machine got busy — which is a test that measures the machine rather than the product.
   */
  await expect
    .poll(
      async () => {
        const options = await page
          .getByLabel('Camera', { exact: true })
          .locator('option')
          .allTextContents();
        return !options.some((o) => o === 'No camera' || o === 'Test pattern');
      },
      {
        message: `this cell wanted camera=${cell.camera} and the page's own picker never said so`,
        timeout: 15_000,
      },
    )
    .toBe(cell.camera);
  expect(
    await page.locator('html').getAttribute('data-density'),
    'the stored mode did not reach the document',
  ).toBe(cell.mode === 'pro' ? 'pro' : 'simple');
  expect(
    await page.locator('[data-lt-stop], .lt-golive').count(),
    'the format cell could not be confirmed: Studio rendered no control at all',
  ).toBeGreaterThan(0);
  const shape = page.getByRole('radio', { name: new RegExp(cell.format.replace(':', ' by ')) });
  if ((await shape.count()) > 0) {
    await expect(
      shape.first(),
      'the stored aspect ratio did not reach the shape control',
    ).toHaveAttribute('aria-checked', 'true');
  }
}

/**
 * Sample the stop control on every animation frame between GO LIVE and LIVE.
 *
 * STARTING lasts about a second against the mock adapters — far too short to catch with a poll
 * from the test side, and far too long for a creator who wants out. A single frame with no
 * reachable control fails the cell.
 */
async function sampleTheTransition(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as unknown as { __ltEndSamples?: Array<Record<string, unknown>> };
    w.__ltEndSamples = [];
    const sample = (): void => {
      const visible = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      const el = visible[0];
      if (!el) {
        w.__ltEndSamples?.push({ found: 0 });
      } else {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        w.__ltEndSamples?.push({
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
}

async function readTransition(page: Page, cell: string, what: string): Promise<void> {
  const samples = await page.evaluate(() => {
    const w = window as unknown as { __ltEndSamples?: Array<Record<string, unknown>> };
    const taken = w.__ltEndSamples ?? [];
    w.__ltEndSamples = [];
    return taken;
  });
  expect(samples.length, `${cell}: ${what} was never sampled`).toBeGreaterThan(5);
  const bad = samples.filter((s) => s.found === 0 || s.onTop !== true || s.inView !== true);
  expect(
    bad.slice(0, 3),
    `${cell}: ${bad.length} of ${samples.length} frames ${what} had no reachable stop control`,
  ).toEqual([]);
}

/**
 * Put one destination into a real reconnect, and stay there long enough to see it.
 *
 * The scripted outage is stretched to about four seconds in the app precisely so a person can
 * read the card — which is generous for a person and tight for a test that has to press a tab,
 * press a button and press another tab first. On a loaded machine the whole outage could pass
 * inside those three renders, and the first run of this matrix lost a cell to exactly that.
 *
 * So the drop is retried rather than hoped for, and the stop control is sampled on every frame
 * of the outage rather than at one instant after it. Each attempt is a real `outputLost` through
 * the real orchestrator; nothing is faked to make it land.
 */
async function dropDestination(page: Page, name: string, cell: string): Promise<void> {
  const chips = page.getByLabel('Where this stream is going');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByRole('tab', { name: 'Health' }).click();
    await sampleTheTransition(page);
    await page.getByRole('button', { name: `Drop ${name}`, exact: true }).click();
    await page.getByRole('tab', { name: 'Destinations' }).click();
    const caught = await chips
      .getByText(/Reconnecting/)
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    await readTransition(page, cell, 'during a destination outage');
    if (caught) return;
  }
  throw new Error(
    `${cell}: three scripted drops of ${name} all recovered before the screen could show a reconnect`,
  );
}

/**
 * How far into the tab order the stop control sits.
 *
 * `LiveBar` is deliberately the last thing in the shell's DOM — outside `<main>`, so a route
 * change cannot unmount it — which means a keyboard user reaches it last. That is the right
 * trade for a control that must survive navigation, and it is exactly why the number needs a
 * ceiling rather than a shrug: "last" must mean last in a screen's worth of controls, not last
 * in an unbounded list.
 */
const TAB_BUDGET = 40;

/* ====================================================== the live matrix, at the hard viewport */

for (const camera of [false, true] as const) {
  test.describe(`END is always reachable · camera ${camera ? 'on' : 'off'}`, () => {
    test.use({ viewport: PHONE });

    for (const mode of MODES) {
      for (const format of FORMATS) {
        for (const destinations of LIVE_COUNTS) {
          test(`${mode} · ${format} · ${destinations} destination${destinations === 1 ? '' : 's'}`, async ({
            page,
          }) => {
            const cell = `${mode}/${format}/${destinations} dest/camera ${camera ? 'on' : 'off'}`;
            await openStudio(page, { format, mode, destinations, camera });

            // IDLE. GO LIVE is the control that can act on the broadcast now.
            await assertStopInvariant(page, `${cell} · idle`);

            await sampleTheTransition(page);
            await page.getByRole('button', { name: 'Go live', exact: true }).click();

            const end = page.getByRole('button', { name: /End broadcast/ });
            await expect(end, `${cell}: never reached LIVE`).toBeVisible({ timeout: 25_000 });
            await readTransition(page, cell, 'between GO LIVE and LIVE');

            // LIVE.
            await assertStopInvariant(page, `${cell} · live`);
            const tabs = await tabsToReach(page, '[data-lt-stop]', TAB_BUDGET + 20);
            expect(
              tabs,
              `${cell} · live: END is not in the tab order at all within ${TAB_BUDGET + 20} presses`,
            ).toBeGreaterThan(0);
            expect(
              tabs,
              `${cell} · live: END is ${tabs} Tab presses from the top of the document`,
            ).toBeLessThanOrEqual(TAB_BUDGET);

            // RECONNECTING. A real `outputLost`, a real backoff, a real recovery card on screen.
            await dropDestination(page, PLATFORM_NAMES[0], cell);
            await assertStopInvariant(page, `${cell} · one destination reconnecting`);

            /*
             * ERROR STATE. Two real engine events, stacked as notice cards at the top of the
             * column the stop control used to live at the bottom of. This is the shape of the
             * failure §18 is about: the screen fills with things that arrived by themselves.
             */
            await page.getByRole('tab', { name: 'Health' }).click();
            await page.getByRole('button', { name: 'Unplug the camera' }).click();
            await page.getByRole('button', { name: 'Break the picture' }).click();
            await page.getByRole('tab', { name: 'Destinations' }).click();
            await page.waitForTimeout(400);
            await assertStopInvariant(page, `${cell} · camera lost and encoder crashed`);

            if (destinations === 3) {
              /*
               * One destination in trouble while the others carry on, in a state that stays put.
               *
               * The first draft of this used the recovery card's own "Stop trying", which is the
               * closest this build comes to a FAILED destination — and it was unrunnable: the
               * card is rendered from a live condition and the scripted outage recovers after
               * about four seconds, so the click raced the unmount and half the matrix timed out
               * waiting for a button that had already gone. DEGRADED has no timer on it: the
               * destination sits at "Live, rough" until something else moves it, which is what a
               * measurement of a steady state needs.
               */
              await page.getByRole('tab', { name: 'Health' }).click();
              await page
                .getByRole('button', { name: `Make ${PLATFORM_NAMES[2]} rough`, exact: true })
                .click();
              await page.getByRole('tab', { name: 'Destinations' }).click();
              await expect(
                page.getByLabel('Where this stream is going').getByText(/Live, rough/),
                `${cell}: the degrade never landed`,
              ).toBeVisible({ timeout: 10_000 });
              await assertStopInvariant(page, `${cell} · one destination live but rough`);
            }

            // GRACE. Pressing END schedules the stop; UNDO is the control for five seconds.
            await page.locator('[data-lt-stop="end"]').click();
            const undo = page.getByRole('button', { name: /UNDO/ });
            await expect(undo, `${cell}: END did not start the grace`).toBeVisible();
            await assertStopInvariant(page, `${cell} · mid-grace`);
            await undo.click();
            await expect(page.locator('[data-lt-stop="end"]')).toBeVisible();

            // (d) AND IT ACTUALLY STOPS.
            await page.locator('[data-lt-stop="end"]').click();
            await expect(
              page.locator('.lt-livebar'),
              `${cell}: the broadcast was still running after END and the full grace`,
            ).toHaveCount(0, { timeout: 20_000 });
            await expect(
              page.getByRole('button', { name: 'Go live', exact: true }),
              `${cell}: the broadcast stopped but Studio never offered a way to start again`,
            ).toBeVisible();
          });
        }
      }
    }
  });
}

/* ================================================ nothing to stop: the zero-destination cells */

/**
 * With nothing connected there is no broadcast to end, so §18 is vacuous — and a vacuous rule is
 * where a real bug hides. The two things that must be true instead are asserted directly: the
 * control that would stop is on the screen and reachable, and the product cannot be talked into a
 * live state with nowhere to send it.
 */
for (const camera of [false, true] as const) {
  test.describe(`nothing connected · camera ${camera ? 'on' : 'off'}`, () => {
    test.use({ viewport: PHONE });

    for (const mode of MODES) {
      for (const format of FORMATS) {
        test(`${mode} · ${format} · 0 destinations`, async ({ page }) => {
          const cell = `${mode}/${format}/0 dest/camera ${camera ? 'on' : 'off'}`;
          await openStudio(page, { format, mode, destinations: 0, camera });

          const report = await hitTestStop(page);
          expect(report.present, `${cell}: there is no GO LIVE control at all`).toBe(true);
          assertStopReachable(report, `${cell} · idle`);

          const tabs = await tabsToReach(page, STOP_CONTROL, TAB_BUDGET);
          expect(tabs, `${cell}: GO LIVE is not in the tab order`).toBeGreaterThan(0);

          /*
           * It refuses, in words, and it stays focusable so it can say why — `aria-disabled`,
           * never `disabled`, because a control that cannot be reached cannot explain itself.
           * `force` is required for exactly that reason: Playwright's actionability check treats
           * `aria-disabled` as not enabled and would wait sixty seconds rather than deliver the
           * tap, and the tap is the whole point. This is a real press on a real control.
           */
          const button = page.getByRole('button', { name: 'Go live', exact: true });
          await expect(button).toHaveAttribute('aria-disabled', 'true');
          await button.click({ force: true });
          await page.waitForTimeout(1200);
          expect(
            await page.locator('.lt-livebar').count(),
            `${cell}: the product went live with nowhere to send it`,
          ).toBe(0);
        });
      }
    }
  });
}

/* ================================================================== the same, on a full desk */

/**
 * The desk pass. `live-safety.spec.ts` covers eight widths across format and mode at two
 * destinations; this confirms the axes this file adds behave the same when there is room for
 * everything on one screen, which is the case in which a layout bug is least likely and a
 * stacking bug is most.
 */
test.describe('END is always reachable on a desk', () => {
  test.use({ viewport: DESK });

  for (const mode of MODES) {
    test(`${mode} · 3 destinations · live, reconnecting, and after two engine failures`, async ({
      page,
    }) => {
      const cell = `desk/${mode}/3 dest`;
      await openStudio(page, { format: '16:9', mode, destinations: 3, camera: false });
      await assertStopInvariant(page, `${cell} · idle`);

      await page.getByRole('button', { name: 'Go live', exact: true }).click();
      await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
        timeout: 25_000,
      });
      await assertStopInvariant(page, `${cell} · live`);

      const tabs = await tabsToReach(page, '[data-lt-stop]', TAB_BUDGET + 20);
      expect(tabs, `${cell}: END is not in the tab order`).toBeGreaterThan(0);
      expect(tabs, `${cell}: END is ${tabs} Tab presses away`).toBeLessThanOrEqual(TAB_BUDGET);

      await dropDestination(page, PLATFORM_NAMES[1], cell);
      await assertStopInvariant(page, `${cell} · reconnecting`);

      await page.getByRole('tab', { name: 'Health' }).click();
      await page.getByRole('button', { name: 'Unplug the camera' }).click();
      await page.getByRole('button', { name: 'Break the picture' }).click();
      await page.getByRole('tab', { name: 'Destinations' }).click();
      await assertStopInvariant(page, `${cell} · after two engine failures`);

      await page.locator('[data-lt-stop="end"]').click();
      await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
    });
  }
});

/* ===================================================== END on every route, not only on Studio */

/**
 * The broadcast outlives the screen that started it, so the stop control has to as well. This is
 * the same rule `live-safety.spec.ts` asserts at 834x1112; it is repeated on a phone because the
 * bottom of a 390x844 window is where a tab bar, a notice stack and a live bar all want to be.
 */
test.describe('END on every route', () => {
  test.use({ viewport: PHONE });

  test('every screen can stop the broadcast, with a camera lost and a destination reconnecting', async ({
    page,
  }) => {
    await openStudio(page, { format: '9:16', mode: 'simple', destinations: 3, camera: false });
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({
      timeout: 25_000,
    });

    await dropDestination(page, PLATFORM_NAMES[2], 'every route while live');
    await page.getByRole('tab', { name: 'Health' }).click();
    await page.getByRole('button', { name: 'Unplug the camera' }).click();

    for (const label of ['Moments', 'Destinations', 'Recordings', 'Settings', 'Studio'] as const) {
      await page
        .getByRole('navigation', { name: 'LIVETAP' })
        .getByRole('link', { name: label, exact: true })
        .click();
      await page.waitForTimeout(250);
      await assertStopInvariant(page, `${label} while live, mid-reconnect, with no camera`);
    }

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });
});
