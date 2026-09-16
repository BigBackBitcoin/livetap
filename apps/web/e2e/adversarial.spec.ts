import { expect, test } from '@playwright/test';

/**
 * Whichever button currently offers the add-destination flow.
 *
 * The Destinations screen shows ONE of two: "+ Add destination" in the header once a destination
 * exists, and a larger "Add your first destination" in the empty-state card when none does. They
 * were both on screen at once until the duplicate was removed - one action gets one control - and
 * these tests matched `/Add destination/`, which the empty-state label does not contain, so they
 * began timing out on a screen that was working. Every other driver in this repo already spells
 * it this way.
 */
const ADD_DESTINATION = /Add destination|Add your first destination/i;
import type { Page } from '@playwright/test';
import {
  auditInteractionOwnership,
  hasHorizontalOverflow,
  hitTestStop,
  seedApp,
} from './helpers.js';

/**
 * THE ADVERSARIAL PASS.
 *
 * The invariants in `interaction-ownership.spec.ts` and `end-invariant.spec.ts` say what must
 * always be true. This file is the other half of the job: an attempt to make the product do
 * something it should not, through its own interface, the way a real person does it — fast,
 * impatiently, on a small screen, while something is already going wrong.
 *
 * Every test here is a scenario a creator can actually produce. Nothing reaches into the store,
 * nothing dispatches synthetic events at React, and nothing asserts an implementation detail: the
 * question each one asks is "after that, is the product still telling the truth about itself, and
 * can the creator still stop?".
 */

const PHONE = { width: 390, height: 844 };

/** The two states the product may be in, and the rule that they are the only two. */
async function coherent(page: Page): Promise<{ onAir: boolean; note: string }> {
  const onAir = (await page.locator('.lt-livebar').count()) > 0;
  const studioGoLive = await page.locator('.lt-studio__go .lt-golive').count();
  /*
   * Studio renders `{live ? null : <section className="lt-studio__go">}`, so exactly one of these
   * two is true at any moment. Both at once means two controls claiming the broadcast; neither
   * means none — and "neither" is the state in which a creator cannot stop.
   */
  expect(
    onAir === (studioGoLive === 0),
    onAir
      ? 'a broadcast is running AND Studio is still offering its own GO LIVE'
      : 'nothing is running and Studio is not offering GO LIVE either',
  ).toBe(true);
  return { onAir, note: onAir ? 'on air' : 'idle' };
}

/** Open a set-up Studio and start watching for anything the page throws. */
async function studio(
  page: Page,
  options: { destinations?: 0 | 1 | 2 | 3; mode?: 'simple' | 'pro' } = {},
): Promise<string[]> {
  const thrown: string[] = [];
  page.on('pageerror', (error) => thrown.push(error.message));
  await seedApp(page, {
    destinations: options.destinations ?? 2,
    mode: options.mode ?? 'simple',
  });
  await page.goto('/app/studio');
  await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeVisible();
  return thrown;
}

async function goLiveAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Go live', exact: true }).click();
  await expect(page.getByRole('button', { name: /End broadcast/ })).toBeVisible({ timeout: 25_000 });
}

/* =========================================================== attacking the start of a broadcast */

test.describe('the start of a broadcast, under abuse', () => {
  test.use({ viewport: PHONE });

  /**
   * An impatient tap, five times, on the one button in the product that matters.
   *
   * The documented behaviour is that activating GO LIVE during its own countdown cancels it, so an
   * odd number of taps arms it and an even number does not. Whichever way it lands, two things
   * must hold: the product must not start two broadcasts, and the screen must agree with itself
   * about which of the two states it is in.
   */
  test('five fast taps on GO LIVE start at most one broadcast, and the screen agrees', async ({
    page,
  }) => {
    const thrown = await studio(page);
    const button = page.getByRole('button', { name: 'Go live', exact: true });
    const box = (await button.boundingBox())!;
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 });
    }

    // Long enough for a 3-second countdown, a commit and a start to all have happened.
    await page.waitForTimeout(12_000);
    const { onAir } = await coherent(page);

    expect(await page.locator('.lt-livebar').count(), 'more than one live bar').toBeLessThanOrEqual(
      1,
    );
    const chips = page.getByLabel('Where this stream is going');
    expect(
      await chips.getByText(/YouTube/).count(),
      'a destination was entered into the stream twice',
    ).toBe(1);
    expect(thrown, 'the page threw while being tapped').toEqual([]);

    if (onAir) {
      const report = await hitTestStop(page);
      expect(report.onTop, `five taps left a broadcast whose stop control is under ${report.hitBy}`).toBe(
        true,
      );
      await page.locator('[data-lt-stop="end"]').click();
      await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
    }
  });

  /** The countdown is the confirmation, so the same control has to take it back. */
  test('the countdown can be stopped by the control that started it', async ({ page }) => {
    await studio(page);
    const button = page.getByRole('button', { name: 'Go live', exact: true });
    await button.click();
    await expect(page.locator('.lt-golive--countdown')).toBeVisible();

    /*
     * Past the stray-tap window first.
     *
     * `GoLiveButton` ignores a click within DOUBLE_TAP_MS (450 ms) of the countdown appearing,
     * because the Cancel control takes over the exact pixels the GO LIVE label just occupied and
     * the second tap of a nervous double-tap would otherwise land on it and silently kill the
     * broadcast - audit 3, defect 2. A cancel at fifty milliseconds is indistinguishable from
     * that second tap, so a test that cancels instantly is measuring the guard rather than the
     * cancel. What has to hold is that the control CAN stop what it started, which is what this
     * now checks.
     */
    await page.waitForTimeout(600);
    await page.locator('.lt-golive--countdown').click();
    await page.waitForTimeout(8_000);
    expect(
      await page.locator('.lt-livebar').count(),
      'cancelling the countdown still produced a broadcast',
    ).toBe(0);
    await coherent(page);
  });

  /** And by Escape, which is the gesture that takes back the most consequential action here. */
  test('Escape during the countdown takes it back', async ({ page }) => {
    await studio(page);
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.locator('.lt-golive--countdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(8_000);
    expect(await page.locator('.lt-livebar').count()).toBe(0);
    await coherent(page);
  });

  /**
   * STARTING is the window in which broadcast objects already exist on the platforms, and it used
   * to be the one state with no way out at all. Taking that way out must leave nothing running.
   */
  test('cancelling a start leaves nothing live and nothing half-started', async ({ page }) => {
    const thrown = await studio(page);
    await page.getByRole('button', { name: 'Go live', exact: true }).click();

    const cancel = page.locator('[data-lt-stop="cancel-start"]');
    await cancel.waitFor({ state: 'visible', timeout: 15_000 });
    await cancel.click();

    await expect(page.locator('.lt-livebar'), 'a cancelled start stayed on air').toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeVisible();
    await expect(
      page.getByLabel('Where this stream is going').getByText(/· Live/),
      'a destination is still reported live after the start was cancelled',
    ).toHaveCount(0);
    expect(thrown).toEqual([]);
    await coherent(page);
  });

  /**
   * DEFECT — CONFIRMED. Leaving Studio while the countdown is running arms an invisible
   * broadcast, and returning to Studio starts it without anyone pressing anything.
   *
   * Reproduction, all through the UI, no store access:
   *   1. Studio with a ready destination. Press GO LIVE. The button starts its countdown.
   *   2. Before it reaches zero, tap Destinations in the navigation rail.
   *   3. Wait. Nothing anywhere says a broadcast is about to start, and there is no control that
   *      can stop it: `[data-lt-stop]` has no matches on any screen and `.lt-livebar` is absent.
   *   4. Tap Studio again. The button remounts, counts from three, and goes live.
   *
   * Expected: leaving the screen either cancels the countdown, or takes the countdown with it —
   * `requestEnd` already sets the precedent, owning the END grace in the store precisely so that
   * a stop survives the screen that asked for it (`store.ts`, "a stop must outlive the screen").
   * Observed: the countdown is a half-owned thing. The FLAG is in the store and outlives the
   * screen; the CLOCK is in the button and does not; and nothing in the shell renders either.
   *
   * Severity: high. It is a broadcast that begins without a deliberate act at the moment it
   * begins, and for the whole gap between step 2 and step 4 §18 is false — the creator has no
   * access to any control over a broadcast the product has already decided to start.
   *
   * WHO MUST FIX IT, and where. This is not `LiveBar.tsx`, so it is not fixed here:
   *   · `apps/web/src/state/store.ts:893` `startCountdown()` sets `goLive: 'countdown'` and owns
   *     no timer, unlike `requestEnd()` further down, which owns its grace timer for exactly this
   *     reason.
   *   · `packages/ui/src/components/GoLiveButton.tsx:88` the `setInterval` that actually counts
   *     lives in the button, so it is created and destroyed with Studio.
   *   · `apps/web/src/components/LiveBar.tsx:41` `onAir` is `state !== 'IDLE' && !== 'PREVIEW'`,
   *     which is false during a countdown, so the shell shows nothing. If the decision is that
   *     the countdown should be visible and cancellable everywhere rather than cancelled on
   *     leaving, this line is the other half of the change and this team will make it.
   *
   * FIXED 2026-09-15, and the diagnosis above was right about where: the countdown was a
   * half-owned thing. The flag lived in the store and outlived the screen; the clock lived in the
   * button and did not.
   *
   * The store owns both now. `armCountdown()` sets the flag AND holds the timer that ends it, the
   * same way `requestEnd()` has always owned the END grace — an action with consequences cannot
   * be owned by a screen, because a screen can be unmounted by a tap on the nav.
   *
   * Of the two endings the rule permits, this takes CANCEL rather than carry-it-with-you. A
   * countdown is the last chance to change your mind, so leaving is treated as changing it; and
   * there is nowhere honest to show it instead, because the live bar is for a broadcast that is
   * HAPPENING and a countdown in it would be a second place to press stop for something that has
   * not started. `releaseCountdown()` says so in a notice rather than dropping it in silence,
   * which is the part that decides whether the creator trusts the button next time.
   */
  test('leaving Studio mid-countdown never leaves an armed broadcast with no control', async ({
    page,
  }) => {
    await studio(page);
    await page.getByRole('button', { name: 'Go live', exact: true }).click();
    await expect(page.locator('.lt-golive--countdown')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Destinations', exact: true })
      .click();
    await page.waitForTimeout(8_000);

    const invisible =
      (await page.locator('.lt-livebar').count()) === 0 &&
      (await page.locator('[data-lt-stop]').count()) === 0;

    // Whatever the product decided, going back to Studio must not start a broadcast by itself.
    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Studio', exact: true })
      .click();
    await page.waitForTimeout(6_000);

    const wentLive = (await page.locator('.lt-livebar').count()) > 0;
    expect(
      wentLive && invisible,
      'the countdown survived a route change with nothing on screen to stop it, and then went live on its own when the creator came back to Studio',
    ).toBe(false);
  });
});

/* ============================================================ attacking the end of a broadcast */

test.describe('the end of a broadcast, under abuse', () => {
  test.use({ viewport: PHONE });

  /**
   * A double-tap on END. FOUND HERE, AND FIXED IN `LiveBar.tsx`.
   *
   * END schedules the stop and replaces itself with the take-back, in the same place and at the
   * same size, so the second half of a double-tap landed on the control that cancels the thing
   * the first half asked for. The broadcast stayed live. Nothing was covering anything and every
   * control on the screen was perfectly reachable, which is what makes this the one way §18 can
   * be broken without breaking §17 first — and it is what people do with a button that has not
   * visibly reacted yet.
   *
   * The fix is in `LiveBar`: the take-back is rendered and reachable from the first frame, so
   * `[data-lt-stop]` is never missing while a broadcast is running, and it refuses to act for
   * `UNDO_ARM_MS` — longer than a double-tap, a tenth of the grace it sits inside. It says which
   * of the two it is rather than lying about it: "Ending in 5", then "UNDO · Ending in 4".
   */
  test('a double-tap on END does not silently keep the broadcast running', async ({ page }) => {
    await studio(page);
    await goLiveAndWait(page);

    const end = page.locator('[data-lt-stop="end"]');
    const box = (await end.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    await expect(
      page.locator('.lt-livebar'),
      'a double-tap on END left the broadcast running: the second tap landed on the take-back that replaced it',
    ).toHaveCount(0, { timeout: 20_000 });
  });

  /**
   * The same hammering, at the ONE spacing that used to defeat it.
   *
   * `3 fast taps on END still end the broadcast` failed once in a full suite run and then passed
   * six times in a row on an idle machine, because `page.mouse.click` with no delay is far faster
   * than a person and far faster than the window. The failure needs the taps to land between about
   * 275 ms and 550 ms apart — half the take-back's arming window — so the second press is
   * swallowed while inert and the third arrives armed and cancels the stop. An odd number of
   * presses, which must always leave the broadcast ending, left it running.
   *
   * 400 ms is inside that band and is also simply what tapping a slow phone looks like. The
   * window is now measured from the LAST press rather than from END, so hammering can never arm
   * the take-back.
   */
  test('three taps at the spacing that used to re-arm the take-back still end it', async ({
    page,
  }) => {
    await studio(page);
    await goLiveAndWait(page);
    const box = (await page.locator('[data-lt-stop="end"]').boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.click(centre.x, centre.y, { delay: 0 });
      if (i < 2) await page.waitForTimeout(400);
    }
    await expect(
      page.locator('.lt-livebar'),
      'three taps 400ms apart left the broadcast running: the third landed on an armed take-back',
    ).toHaveCount(0, { timeout: 20_000 });
  });

  /** Three and five taps, because a frustrated person does not stop at two. */
  for (const taps of [3, 5] as const) {
    test(`${taps} fast taps on END still end the broadcast`, async ({ page }) => {
      await studio(page);
      await goLiveAndWait(page);
      const box = (await page.locator('[data-lt-stop="end"]').boundingBox())!;
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      for (let i = 0; i < taps; i += 1) {
        await page.mouse.click(centre.x, centre.y, { delay: 0 });
      }
      await expect(
        page.locator('.lt-livebar'),
        `${taps} fast taps on END left the broadcast running`,
      ).toHaveCount(0, { timeout: 20_000 });
    });
  }

  /**
   * The other half of the same rule: the take-back has to still work when it is meant.
   *
   * A guard that stops a double-tap by making UNDO useless would be a worse bug than the one it
   * fixes, so this presses it the way a person does — a beat later, deliberately — and requires
   * the broadcast to still be running afterwards.
   */
  test('the take-back still works when it is meant, and is announced before it does', async ({
    page,
  }) => {
    await studio(page);
    await goLiveAndWait(page);
    await page.locator('[data-lt-stop="end"]').click();

    /*
     * It is on the screen and reachable immediately, and it says it is not a take-back yet.
     *
     * Read once rather than with a retrying matcher: the label changes on its own after
     * `UNDO_ARM_MS`, so a matcher that polls would be racing the thing it is measuring.
     */
    const takeBack = page.locator('[data-lt-stop="undo"]');
    await expect(takeBack).toBeVisible();
    expect(
      ((await takeBack.textContent()) ?? '').trim(),
      'the take-back offered itself as UNDO in the same instant END was pressed',
    ).toMatch(/^Ending in \d/);
    const report = await hitTestStop(page);
    expect(report.onTop, `mid-grace the control is under ${report.hitBy}`).toBe(true);

    // A beat later it arms itself, says so, and takes the ending back.
    await expect(takeBack).toHaveText(/UNDO/, { timeout: 5_000 });
    await takeBack.click();
    await expect(
      page.locator('[data-lt-stop="end"]'),
      'a deliberate UNDO did not take the ending back',
    ).toBeVisible();
    await page.waitForTimeout(8_000);
    expect(
      await page.locator('.lt-livebar').count(),
      'the broadcast ended anyway after the creator took it back',
    ).toBe(1);

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });

  /** END has to survive the creator walking around the app while the grace runs. */
  test('END survives a tour of every screen during its grace', async ({ page }) => {
    await studio(page, { destinations: 3 });
    await goLiveAndWait(page);
    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.getByRole('button', { name: /UNDO/ })).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'LIVETAP' });
    for (const label of ['Moments', 'Destinations', 'Recordings'] as const) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.lt-livebar'), 'END was cancelled by walking away').toHaveCount(0, {
      timeout: 20_000,
    });
  });

  /**
   * A reload genuinely ends a browser broadcast — there is no process left to send bytes. What
   * matters is that the product comes back honest rather than claiming a stream it no longer has.
   */
  test('a reload while live comes back honest, not claiming a stream it lost', async ({ page }) => {
    await studio(page);
    await goLiveAndWait(page);
    await expect(page.locator('.lt-livebar')).toContainText(/Live/);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeVisible({
      timeout: 25_000,
    });
    await page.waitForTimeout(1_500);

    expect(
      await page.locator('.lt-livebar').count(),
      'after a reload the app still claims to be broadcasting',
    ).toBe(0);
    await expect(
      page.getByLabel('Where this stream is going').getByText(/· Live/),
      'after a reload a destination is still shown as live',
    ).toHaveCount(0);
    /*
     * `LiveBar` writes "● LIVE mm:ss — LIVETAP" while on air, so the dot is what distinguishes a
     * claim from the product's own name. Asserting on the word alone is a test that can never
     * fail, because "LIVETAP" contains it.
     */
    expect(await page.title(), 'the tab is still announcing a broadcast that ended').not.toContain(
      '●',
    );
    await coherent(page);
  });

  /**
   * The network going away under a running broadcast.
   *
   * A mock adapter cannot notice, so this is not a test of the reconnect logic — it is a test
   * that the product does not fall over and does not lose the one control that matters when the
   * browser starts failing requests underneath it.
   */
  test('going offline while live does not take the stop control with it', async ({
    page,
    context,
  }) => {
    const thrown = await studio(page, { destinations: 2 });
    await goLiveAndWait(page);

    await context.setOffline(true);
    await page.waitForTimeout(3_000);
    const report = await hitTestStop(page);
    expect(report.found, 'offline: no stop control on the screen').toBeGreaterThan(0);
    expect(report.onTop, `offline: the stop control is under ${report.hitBy}`).toBe(true);
    expect(thrown, 'the page threw when the network went away').toEqual([]);

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
    await context.setOffline(false);
  });

  /** Twenty route changes in a row, which is what a lost creator does looking for the way out. */
  test('hammering the navigation while live never loses the stop control', async ({ page }) => {
    const thrown = await studio(page, { destinations: 2 });
    await goLiveAndWait(page);

    const nav = page.getByRole('navigation', { name: 'LIVETAP' });
    const labels = ['Moments', 'Destinations', 'Recordings', 'Settings', 'Studio'] as const;
    for (let i = 0; i < 20; i += 1) {
      await nav
        .getByRole('link', { name: labels[i % labels.length]!, exact: true })
        .click({ noWaitAfter: true });
    }
    await page.waitForTimeout(1_000);

    const report = await hitTestStop(page);
    expect(report.found, 'after twenty route changes there is no stop control').toBe(1);
    expect(report.onTop, `after twenty route changes the stop control is under ${report.hitBy}`).toBe(
      true,
    );
    expect(thrown, 'the shell threw while the navigation was hammered').toEqual([]);

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });

  /** Back, from a screen the creator navigated to while live. */
  test('the browser Back button does not take the stop control with it', async ({ page }) => {
    await studio(page);
    await goLiveAndWait(page);
    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Destinations', exact: true })
      .click();
    await expect(page.getByRole('button', { name: ADD_DESTINATION }).first()).toBeVisible();

    await page.goBack();
    await page.waitForTimeout(400);
    expect(
      (await page.locator('.lt-livebar').count()) > 0,
      'going Back ended the broadcast, or lost the bar that stops it',
    ).toBe(true);
    const report = await hitTestStop(page);
    expect(report.onTop, `after Back, the stop control is under ${report.hitBy}`).toBe(true);
    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });
});

/* ================================================================== attacking the layout */

test.describe('the layout, under abuse', () => {
  test('a broadcast survives being squeezed to 320px, and can still be stopped', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await studio(page, { destinations: 3 });
    await goLiveAndWait(page);

    for (const size of [
      { width: 320, height: 568 },
      { width: 280, height: 653 },
      { width: 390, height: 500 },
      { width: 1440, height: 400 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(400);
      const where = `${size.width}x${size.height} while live`;

      const report = await hitTestStop(page);
      expect(report.found, `${where}: no stop control on the screen`).toBeGreaterThan(0);
      expect(
        report.inView,
        `${where}: the stop control is clipped, box ${JSON.stringify(report.box)}`,
      ).toBe(true);
      expect(report.onTop, `${where}: the stop control is under ${report.hitBy}`).toBe(true);
      expect(await hasHorizontalOverflow(page), `${where}: the page scrolls sideways`).toBe(false);
      expect(
        await auditInteractionOwnership(page, { step: 40 }),
        `${where}: something invisible is taking input`,
      ).toEqual([]);
    }

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });

  /**
   * A bottom sheet and the live bar want the same twelve millimetres of a phone.
   *
   * `live-safety.spec.ts` asserts that a Sheet cannot cover the live bar at 834x1112 — where the
   * Sheet is a side panel and the two are nowhere near each other. Below 640px the Sheet becomes
   * a bottom sheet, which is exactly where `LiveBar` is pinned, so the interesting width is the
   * one that was not tested. §18 says no overlay can cover END; this is the overlay most likely
   * to try.
   */
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ] as const) {
    test(`a bottom sheet at ${size.width}px cannot take the live bar's place`, async ({ page }) => {
      await page.setViewportSize(size);
      await studio(page, { destinations: 2 });
      await goLiveAndWait(page);

      await page
        .getByRole('navigation', { name: 'LIVETAP' })
        .getByRole('link', { name: 'Destinations', exact: true })
        .click();
      await page.getByRole('button', { name: ADD_DESTINATION }).first().click();
      await expect(page.locator('.lt-sheet')).toBeVisible();
      await expect(page.locator('.lt-sheet__scrim')).toBeVisible();
      await page.waitForTimeout(400);

      const report = await hitTestStop(page);
      expect(
        report.found,
        `${size.width}px: no stop control while a bottom sheet is open`,
      ).toBeGreaterThan(0);
      expect(
        report.inView,
        `${size.width}px: the stop control is off the screen under a bottom sheet, box ${JSON.stringify(report.box)}`,
      ).toBe(true);
      expect(
        report.onTop,
        `${size.width}px: a bottom sheet took the stop control's place — a tap there reaches ${report.hitBy}`,
      ).toBe(true);

      // And it is not merely on top in a hit test: it still ends the broadcast.
      await page.locator('[data-lt-stop="end"]').click();
      await expect(
        page.locator('.lt-livebar'),
        `${size.width}px: END did nothing with a sheet open over it`,
      ).toHaveCount(0, { timeout: 20_000 });
    });
  }

  /** A modal that is opened wide and then squeezed must still block, and must still let go. */
  test('a sheet squeezed to 320px still blocks and still closes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedApp(page, { destinations: 2 });
    await page.goto('/app/destinations');
    await page.getByRole('button', { name: ADD_DESTINATION }).first().click();
    await expect(page.locator('.lt-sheet')).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(400);

    const leaks = await page.evaluate(() => {
      const out: string[] = [];
      for (let x = 8; x < innerWidth - 8; x += 40) {
        for (let y = 8; y < innerHeight - 8; y += 40) {
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest('.lt-sheet, .lt-sheet__scrim, .lt-livebar')) continue;
          out.push(
            `(${x},${y}) reaches ${hit ? hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 40) : 'nothing'}`,
          );
        }
      }
      return out;
    });
    expect(leaks, 'a squeezed sheet stopped covering the screen behind it').toEqual([]);

    const close = page.getByRole('button', { name: 'Close', exact: true });
    const report = await close.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5,
        onTop: Boolean(hit && (hit === el || el.contains(hit))),
      };
    });
    expect(report.inView, 'the way out of the sheet is off the screen at 320px').toBe(true);
    expect(report.onTop, 'the way out of the sheet is covered at 320px').toBe(true);
    await close.click();
    await expect(page.locator('.lt-sheet')).toHaveCount(0);
  });
});

/* ========================================================== attacking the destination list */

test.describe('the destinations, under abuse', () => {
  test.use({ viewport: PHONE });

  /**
   * Adding a destination to a stream that is already running.
   *
   * The screen promises "A destination added now lands ready and joins your next stream, not this
   * one." A promise on a screen is a claim the product has to keep.
   */
  test('a destination added mid-broadcast joins the next stream, not this one', async ({ page }) => {
    const thrown = await studio(page, { destinations: 1 });
    await goLiveAndWait(page);
    const chips = page.getByLabel('Where this stream is going');
    await expect(chips.getByText('YouTube · Live')).toBeVisible({ timeout: 25_000 });

    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Destinations', exact: true })
      .click();
    await expect(
      page.getByText('A destination added now lands ready and joins your next stream, not this one.'),
    ).toBeVisible();

    await page.getByRole('button', { name: ADD_DESTINATION }).first().click();
    await expect(page.locator('.lt-sheet')).toBeVisible();
    await page.locator('.lt-sheet').getByRole('button', { name: /Twitch/ }).first().click();
    await page.waitForTimeout(3_000);

    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Studio', exact: true })
      .click();
    await expect(chips.getByText('YouTube · Live')).toBeVisible();
    await expect(
      chips.getByText(/Twitch · (Live|Starting)/),
      'a destination added mid-broadcast was pushed into the stream that was already running',
    ).toHaveCount(0);

    const report = await hitTestStop(page);
    expect(report.onTop, `after adding a destination, END is under ${report.hitBy}`).toBe(true);
    expect(thrown).toEqual([]);
    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });

  /** Nothing that is broadcasting can be removed, disconnected or switched out from under itself. */
  test('a live destination cannot be removed or disconnected', async ({ page }) => {
    await studio(page, { destinations: 2 });
    await goLiveAndWait(page);
    await page
      .getByRole('navigation', { name: 'LIVETAP' })
      .getByRole('link', { name: 'Destinations', exact: true })
      .click();

    const stopFirst = page.getByRole('button', { name: 'Stop it first' });
    await expect(stopFirst.first()).toBeVisible();
    const count = await stopFirst.count();
    for (let i = 0; i < count; i += 1) {
      await expect(stopFirst.nth(i)).toBeDisabled();
    }
    for (const toggle of await page.getByRole('switch', { name: 'In your next stream' }).all()) {
      await expect(toggle).toBeDisabled();
    }

    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });

  /** The shape is locked while live, and a locked control has to actually refuse. */
  test('hammering the shape control while live changes nothing', async ({ page }) => {
    await studio(page, { destinations: 2 });
    const before = await page
      .getByRole('radio', { name: /Widescreen|Vertical|Square/ })
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-checked')).join(','));
    await goLiveAndWait(page);

    for (let i = 0; i < 6; i += 1) {
      await page.getByRole('radio', { name: 'Vertical 9 by 16' }).click({ force: true });
      await page.getByRole('radio', { name: 'Square 1 by 1' }).click({ force: true });
    }
    await page.waitForTimeout(400);

    expect(
      await page
        .getByRole('radio', { name: /Widescreen|Vertical|Square/ })
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-checked')).join(',')),
      'the stream shape changed while live; platforms cannot change format mid-stream',
    ).toBe(before);

    const report = await hitTestStop(page);
    expect(report.onTop, `after hammering the shape control, END is under ${report.hitBy}`).toBe(
      true,
    );
    await page.locator('[data-lt-stop="end"]').click();
    await expect(page.locator('.lt-livebar')).toHaveCount(0, { timeout: 20_000 });
  });
});

/* ======================================================= attacking the one control on `/` */

test.describe('the landing page, under abuse', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * "Use my camera" is the exact control the invisible band ate, so it is the control a denial is
   * tested on: the tap has to reach it, the refusal has to be said in words, and the page has to
   * be usable afterwards.
   */
  test('denying the camera says so, and leaves the button reachable and working', async ({
    page,
  }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    await page.addInitScript(() => {
      const api = navigator.mediaDevices;
      if (!api) return;
      api.getUserMedia = (): Promise<MediaStream> => {
        const error = new Error('Permission denied');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      };
    });
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(800);

    const cta = page.locator('[data-lt-camera-cta]').first();
    await cta.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const owned = await cta.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        onTop: Boolean(hit && (hit === el || el.contains(hit))),
        hitBy: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 60)}` : 'nothing',
      };
    });
    expect(owned.onTop, `a tap on "Use my camera" reaches ${owned.hitBy} instead`).toBe(true);

    await cta.click();
    await expect(page.locator('[data-lt-camera-note]')).toHaveText(
      'No camera permission, so the sample picture stays. Nothing was recorded.',
      { timeout: 10_000 },
    );
    // And it offers to try again rather than latching into the failure.
    await expect(page.locator('[data-lt-camera-label]').first()).toHaveText('Use my camera');
    expect(thrown, 'a denied camera threw').toEqual([]);
  });

  /** Fifteen taps in a row on the same control, which is what an impatient visitor does. */
  test('hammering "Use my camera" leaves the page usable', async ({ page }) => {
    const thrown: string[] = [];
    page.on('pageerror', (error) => thrown.push(error.message));
    await page.addInitScript(() => {
      const api = navigator.mediaDevices;
      if (!api) return;
      api.getUserMedia = (): Promise<MediaStream> => {
        const error = new Error('Permission denied');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      };
    });
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await page.waitForTimeout(800);

    const cta = page.locator('[data-lt-camera-cta]').first();
    await cta.scrollIntoViewIfNeeded();
    const box = (await cta.boundingBox())!;
    for (let i = 0; i < 15; i += 1) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 });
    }
    await page.waitForTimeout(1_500);

    expect(thrown, 'the landing page threw while its camera button was hammered').toEqual([]);
    expect(
      await auditInteractionOwnership(page, { step: 48 }),
      'the page was left with something invisible on top',
    ).toEqual([]);
    // The page still scrolls, which is the property the first of the three historical bugs broke.
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => scrollY), 'the page stopped scrolling').not.toBe(before);
  });
});
