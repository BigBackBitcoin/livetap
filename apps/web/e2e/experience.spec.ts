import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { hasHorizontalOverflow } from './helpers.js';

/**
 * The public experience, operated.
 *
 * `/` is not a document with pictures of a product: it is the product's own surface running on
 * sample data, and every claim it makes is demonstrated by something a visitor can do. So this
 * file does those things: it waits for the hero story to take three destinations live on its
 * own clock, connects one by hand, re-flows the stage into a vertical shape, recomposes it with
 * a Moment, and then breaks the stream twice, once with the pointer and once from the keyboard,
 * asserting each time that exactly one destination fell over and the others never moved.
 *
 * That last assertion is the page's whole argument, which is why it is a test and not a hope.
 */

const LIVE = '[data-lt-dest][data-lt-state="LIVE"]';
const READY = '[data-lt-dest][data-lt-state="READY"]';

/**
 * Stop the automatic story before it has done anything, so every test below starts from the
 * same surface. Re-selecting the shape that is already selected is a no-op on the composition
 * and the page's own "any visitor action ends the story" rule does the rest.
 */
async function ownTheSurface(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('html.sc-ready');
  await page.evaluate(() => {
    (document.querySelector('[data-lt-format-set="16:9"]') as HTMLElement).click();
  });
  await expect(page.locator('[data-lt-dest][data-lt-state="DISCONNECTED"]')).toHaveCount(6);
}

/** Park the page at a fraction of one act's own travel, the way a reader would arrive at it. */
async function toAct(page: Page, id: string, p = 0.5): Promise<void> {
  const y = await page.evaluate(
    ([actId, at]) => {
      const el = document.getElementById(actId as string)!;
      const top = el.getBoundingClientRect().top + scrollY;
      return Math.round(top + Math.max(el.offsetHeight - innerHeight, 1) * (at as number));
    },
    [id, p] as [string, number],
  );
  await page.evaluate((to) => scrollTo({ top: to, behavior: 'instant' }), y);
  await page.waitForTimeout(450);
}

/** Three connect-account destinations, then GO LIVE, the way a visitor gets there. */
async function goLiveOnThree(page: Page): Promise<void> {
  for (const id of ['youtube', 'twitch', 'facebook']) {
    await page.locator(`[data-lt-dest="${id}"] [data-lt-pick]`).click();
  }
  await expect(page.locator(READY)).toHaveCount(3);
  await page.locator('[data-lt-golive]').click();
  await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 15_000 });
}

/** Every part of a tile a sibling-isolation claim covers. */
async function tileState(page: Page, id: string) {
  return page.evaluate((destId) => {
    const li = document.querySelector(`[data-lt-dest="${destId}"]`) as HTMLElement;
    const tile = li.querySelector('[data-lt-pick]') as HTMLElement;
    const chip = li.querySelector('[data-lt-chip]') as HTMLElement;
    const path = document.querySelector(`[data-lt-path="${destId}"]`) as SVGPathElement;
    const cs = getComputedStyle(tile);
    return {
      state: li.dataset.ltState,
      chip: chip.className,
      label: (li.querySelector('[data-lt-label]') as HTMLElement).textContent,
      transform: cs.transform,
      opacity: cs.opacity,
      scale: cs.scale,
      box: JSON.stringify(tile.getBoundingClientRect()),
      d: path.getAttribute('d'),
      strokeWidth: getComputedStyle(path).strokeWidth,
      phase: path.getAttribute('data-lt-phase'),
    };
  }, id);
}

test.describe('the surface tells its own story', () => {
  test('reaches LIVE on three destinations inside thirty seconds, with nothing tapped', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 30_000 });

    // Three lit signal paths, which is the fact the first fifteen seconds exist to deliver.
    const lit = await page.locator('[data-lt-path][data-lt-phase="live"]').count();
    expect(lit).toBe(3);
    await expect(page.locator('[data-lt-out="dests"]')).toHaveText('3 destinations');
    await expect(page.locator('[data-lt-out="formats"]')).toHaveText('2 formats');
  });

  test('degrades one destination and brings it back, without touching the others', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 30_000 });
    // Step 14 to 17: one goes rough, then reconnects, then everything is healthy again.
    await expect(page.locator('[data-lt-dest][data-lt-state="DEGRADED"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-lt-dest][data-lt-state="RECONNECTING"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 20_000 });
  });
});

test.describe('the playgrounds', () => {
  test('a destination the visitor taps signs in, turns Ready and draws its own path', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);

    const li = page.locator('[data-lt-dest="facebook"]');
    await expect(page.locator('[data-lt-path="facebook"]')).not.toHaveAttribute('d', /./);

    await li.locator('[data-lt-pick]').click();
    await expect(li).toHaveAttribute('data-lt-state', 'AUTHENTICATING');
    await expect(li).toHaveAttribute('data-lt-state', 'READY', { timeout: 5_000 });
    await expect(li.locator('[data-lt-label]')).toHaveText('Ready');

    const d = await page.locator('[data-lt-path="facebook"]').getAttribute('d');
    expect(d).toMatch(/^M[\d.]+ [\d.]+ C/);
    await expect(page.locator('[data-lt-path="facebook"]')).toHaveAttribute(
      'data-lt-phase',
      'ready',
    );
    await expect(page.locator('[data-lt-out="dests"]')).toHaveText('1 destination');
  });

  test('a paste-key destination asks for the key first, in place', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);

    const li = page.locator('[data-lt-dest="tiktok"]');
    await li.locator('[data-lt-pick]').click();
    const key = li.locator('[data-lt-keyrow]');
    await expect(key).toBeVisible();
    await expect(key.locator('label')).toHaveText('Stream key');
    await key.locator('[data-lt-keygo]').click();
    await expect(li).toHaveAttribute('data-lt-state', 'READY', { timeout: 5_000 });
    // TikTok accepts one shape, and the tile says which.
    await expect(li.locator('[data-lt-fmt]')).toHaveText('9:16');
  });

  test('the shape control physically re-flows the stage', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-formats', 0.4);

    const canvas = page.locator('[data-lt-canvas]');
    const wide = (await canvas.boundingBox())!;

    await page.locator('[data-lt-format-set="9:16"]').click();
    await page.waitForTimeout(500);
    const tall = (await canvas.boundingBox())!;
    expect(tall.width).toBeLessThan(wide.width * 0.5);
    expect(tall.height).toBeGreaterThan(wide.height * 0.9);
    await expect(page.locator('[data-lt-shape]')).toHaveText('9:16');

    await page.locator('[data-lt-format-set="1:1"]').click();
    await page.waitForTimeout(500);
    const square = (await canvas.boundingBox())!;
    expect(Math.abs(square.width - square.height)).toBeLessThan(4);

    // No platform here asks for a square, and the surface says so rather than faking one.
    await expect(page.locator('[data-lt-statedetail]')).toContainText(
      'No destination here asks for it',
    );
  });

  test('a Moment recomposes the stage without moving the frame', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.6);

    // The camera has to be on before a Moment that uses it can compose anything.
    await page.locator('[data-lt-input="camera"]').click();
    await expect(page.locator('[data-lt-layer="camera"]')).toBeVisible();

    const frameBefore = (await page.locator('[data-lt-frame]').boundingBox())!;
    const cameraBefore = (await page.locator('[data-lt-layer="camera"]').boundingBox())!;

    await page.locator('[data-lt-moment="guest"]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-lt-moment="guest"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-lt-layer="guest"]')).toBeVisible();
    const cameraAfter = (await page.locator('[data-lt-layer="camera"]').boundingBox())!;
    const frameAfter = (await page.locator('[data-lt-frame]').boundingBox())!;

    // The contents cross over; the frame itself holds. That is the difference between a Moment
    // and a page transition.
    expect(cameraAfter.width).toBeLessThan(cameraBefore.width * 0.6);
    expect(frameAfter.width).toBeCloseTo(frameBefore.width, 0);
    expect(frameAfter.y).toBeCloseTo(frameBefore.y, 0);
  });

  test('Pro adds panels and moves nothing the visitor already learned', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-pro', 0.4);

    const frameBefore = (await page.locator('[data-lt-frame]').boundingBox())!;
    await expect(page.locator('[data-lt-prolayers]')).toBeHidden();

    await page.locator('[data-lt-pro-toggle]').click();
    await expect(page.locator('[data-lt-pro-toggle]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-lt-prorow="log"]')).toBeVisible();
    await expect(page.locator('[data-lt-prolayers]')).toContainText('This session');

    const frameAfter = (await page.locator('[data-lt-frame]').boundingBox())!;
    expect(frameAfter).toEqual(frameBefore);
  });

  test('the close is the real first question, and it carries the answer into the app', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-start', 0.5);

    await expect(page.getByRole('heading', { name: 'What are you making?' })).toBeVisible();
    await expect(page.locator('[data-lt-intent]')).toHaveCount(6);
    await expect(page.locator('[data-lt-open]')).toHaveAttribute('href', './app/start');

    await page.locator('[data-lt-intent="vertical"]').click();
    await expect(page.locator('[data-lt-intent="vertical"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-lt-open]')).toHaveAttribute(
      'href',
      './app/start?intent=vertical',
    );
    // Vertical Live composes in 9:16, and the stage adopts it.
    await expect(page.locator('[data-lt-shape]')).toHaveText('9:16');
  });
});

test.describe('the signature move: break it yourself', () => {
  test('dragging a live destination off the stage breaks exactly that one', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);
    await goLiveOnThree(page);

    await toAct(page, 'act-break', 0.2);
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(3);

    const before = {
      twitch: await tileState(page, 'twitch'),
      facebook: await tileState(page, 'facebook'),
    };

    const grip = page.locator('[data-lt-dest="youtube"] [data-lt-grip]');
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(box.x + box.width / 2 + step * 26, box.y + box.height / 2 + step * 6);
      await page.waitForTimeout(40);
    }

    // The break fires while the tile is still held: a stream does not wait for you to let go.
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      /DEGRADED|RECONNECTING/,
      { timeout: 4_000 },
    );
    await page.mouse.up();

    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 4_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="RECONNECTING"]')).toHaveCount(1);
    await expect(page.locator(LIVE)).toHaveCount(2);

    // The card says what happened, why, what LIVETAP is doing and what you can do.
    const card = page.locator('[data-lt-dest="youtube"] .lt-errorcard');
    await expect(card).toBeVisible();
    await expect(card).toContainText('YouTube stopped accepting the picture.');
    await expect(card).toContainText('Your other destinations are not affected.');
    await expect(card).toContainText(`Attempt 1 of 10`);

    // Not one thing about a sibling changed while the broken one fell over.
    expect(await tileState(page, 'twitch')).toEqual(before.twitch);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);

    // Then it pulls itself back in, on its own.
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 12_000 });
    expect(await tileState(page, 'twitch')).toEqual(before.twitch);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);
  });

  test('the keyboard does the same thing, on the same element', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    const before = {
      youtube: await tileState(page, 'youtube'),
      facebook: await tileState(page, 'facebook'),
    };

    const tile = page.locator('[data-lt-dest="twitch"] [data-lt-pick]');
    await tile.focus();
    await expect(tile).toHaveAttribute('aria-keyshortcuts', 'Delete');
    await page.keyboard.press('Delete');

    await expect(page.locator('[data-lt-dest="twitch"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 4_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="RECONNECTING"]')).toHaveCount(1);
    await expect(page.locator(LIVE)).toHaveCount(2);
    expect(await tileState(page, 'youtube')).toEqual(before.youtube);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);

    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 12_000 });
  });

  test('an arrow nudge under the threshold strains the path and changes nothing', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    const tile = page.locator('[data-lt-dest="youtube"] [data-lt-pick]');
    await tile.focus();
    // Six presses is 144px, under the 168px threshold. The stream never broke.
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute('data-lt-state', 'LIVE');
    const tension = await page.locator('[data-lt-dest="youtube"]').evaluate((el) =>
      Number(getComputedStyle(el).getPropertyValue('--lt-tension')),
    );
    expect(tension).toBeGreaterThan(0.6);
    expect(tension).toBeLessThan(1);

    // Escape returns it to its port with no state change, exactly like a release under it.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute('data-lt-state', 'LIVE');
    await expect(page.locator(LIVE)).toHaveCount(3);
  });
});

test.describe('reduced motion loses movement and nothing else', () => {
  test.use({ reducedMotion: 'reduce' });

  test('offers no grip, breaks from the keyboard, and never moves the tile', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-produce', 0.5);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    // The drag apparatus is not constructed at all, so no grip is offered.
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(0);
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-grip]')).toBeHidden();
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-hint]')).toHaveText(
      'Press Delete to drop it',
    );

    const boxBefore = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    const twitchBefore = await tileState(page, 'twitch');

    await page.locator('[data-lt-dest="youtube"] [data-lt-pick]').focus();
    await page.keyboard.press('Delete');

    // DEGRADED is skipped, because a 700ms intermediate state with no motion is a flicker.
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 2_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="DEGRADED"]')).toHaveCount(0);
    await expect(page.locator(LIVE)).toHaveCount(2);

    // No positional animation: the tile is where it was, to the pixel.
    const boxDuring = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    expect(boxDuring).toEqual(boxBefore);
    expect(await tileState(page, 'twitch')).toEqual(twitchBefore);

    // The countdown is text, and the information is identical to the full-motion page.
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-status]')).toContainText(
      'Attempt 1 of 10, retrying in 4 s',
    );

    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 12_000 });
    const boxAfter = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    expect(boxAfter).toEqual(boxBefore);
  });

  test('holds the chaos prologue still and still collapses it', async ({ page }) => {
    await ownTheSurface(page);
    const translate = await page
      .locator('.ltp-dup')
      .first()
      .evaluate((el) => getComputedStyle(el).translate);
    expect(translate).toBe('none');

    // Present at the act's start, gone by a fifth of the way in, by opacity only.
    const early = await page.locator('[data-lt-lattice]').evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(early)).toBeGreaterThan(0.9);
    await toAct(page, 'act-stage', 0.5);
    const late = await page.locator('[data-lt-lattice]').evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(late)).toBe(0);
  });
});

test.describe('the tour is operated, never played', () => {
  test('opens, never advances by itself, and strikes a step through when it is done', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await page.locator('[data-lt-tour-open]').click();
    const tour = page.getByRole('region', { name: 'Guided tour' });
    await expect(tour).toBeVisible();
    await expect(tour.locator('[data-lt-step]')).toHaveCount(7);
    await expect(tour.locator('[data-lt-step].is-done')).toHaveCount(0);
    // No progress counter, ever.
    await expect(tour).not.toContainText('/ 7');

    await toAct(page, 'act-produce', 0.5);
    await page.locator('[data-lt-dest="youtube"] [data-lt-pick]').click();
    await page.locator('[data-lt-dest="twitch"] [data-lt-pick]').click();
    await expect(page.locator(READY)).toHaveCount(2);
    await expect(tour.locator('[data-lt-step="pick"]')).toHaveClass(/is-done/);
    // Steps complete out of order: going live before switching a Moment leaves step 2 open.
    await expect(tour.locator('[data-lt-step="moment"]')).not.toHaveClass(/is-done/);

    await page.keyboard.press('Escape');
    await expect(tour).toBeHidden();
  });
});

test.describe('the composition holds at every width', () => {
  for (const [name, width, height] of [
    ['mobile', 375, 812],
    ['tablet', 834, 1112],
    ['desktop', 1440, 900],
  ] as const) {
    test(`is operable and does not scroll sideways at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await ownTheSurface(page);

      for (const id of ['act-stage', 'act-connect', 'act-produce', 'act-break', 'act-start']) {
        await toAct(page, id, 0.5);
        expect(await hasHorizontalOverflow(page), `${id} overflows at ${name}`).toBe(false);
      }

      // Every interactive element clears the 44px floor at every breakpoint.
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel =
          '[data-lt-pick], [data-lt-format-set], [data-lt-moment], [data-lt-intent], [data-lt-golive], [data-lt-input], [data-lt-tour-open], [data-lt-theme], [data-lt-pro-toggle]';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 && r.height < 1) continue;
          if (r.height < 43.5 || r.width < 43.5) {
            out.push(`${el.dataset.ltPick ?? el.className}: ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  }
});
