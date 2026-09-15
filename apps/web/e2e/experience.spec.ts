import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  BANDED_ACTS,
  hasHorizontalOverflow,
  ownTheSurface,
  toAct,
  tileState,
  verifyState,
} from './helpers.js';

/**
 * The public experience, operated.
 *
 * `/` is not a document with pictures of a product: it is the product's own surface running on
 * sample data, and every claim it makes is demonstrated by something a visitor can do. So this
 * file does those things. It lets the guided five seconds bring three destinations to Ready and
 * then stop, connects one by hand, goes live from an empty surface, re-flows the stage into a
 * vertical shape, recomposes it with a Moment, switches to Pro, plays the comparison, answers
 * the closing question, and then breaks the stream twice, once with the pointer and once from
 * the keyboard, asserting each time that exactly one destination fell over and the others never
 * moved.
 *
 * That last assertion is the page's whole argument, which is why it is a test and not a hope.
 *
 * Everything here runs at 1440x900 unless a block says otherwise. Below 761px of height and
 * below 1025px of width the surface recomposes on purpose (the Moments strip, the chat and the
 * shape control move into their chapters' bands), and a test that silently straddles those
 * lines is a test that measures the wrong page.
 */

const DESK = { width: 1440, height: 900 } as const;

const LIVE = '[data-lt-dest][data-lt-state="LIVE"]';
const READY = '[data-lt-dest][data-lt-state="READY"]';

/** The signature the guided demo stops at on a desk: YouTube, Twitch and TikTok all Ready. */
const AFTER_THE_DEMO = 'rrrxxx';

/** Connect three destinations by hand, then GO LIVE, the way a visitor gets there. */
async function goLiveOnThree(page: Page): Promise<void> {
  for (const id of ['youtube', 'twitch', 'facebook']) {
    await page.locator(`[data-lt-dest="${id}"] [data-lt-pick]`).click();
  }
  await expect(page.locator(READY)).toHaveCount(3, { timeout: 10_000 });
  await page.locator('[data-lt-golive]').click();
  await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 15_000 });
}

test.describe('the guided five seconds', () => {
  test.use({ viewport: DESK });

  test('brings three destinations to Ready on its own clock, and then hands over', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');

    /* Mic first, then two destinations, then TikTok: the demo's own order, published as state. */
    await expect(page.locator('[data-lt-surface]')).toHaveAttribute(
      'data-sc-verify-state',
      `16:9|${AFTER_THE_DEMO}|main-camera|0|simple`,
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-lt-input="mic"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-lt-path][data-lt-phase="ready"]')).toHaveCount(3);

    /* The hand-over, at 4.2s: one invitation, written under the one button it points at. */
    const sub = page.locator('[data-lt-golive-sub]');
    await expect(sub).toHaveAttribute('data-lt-yourturn', 'true', { timeout: 10_000 });
    await expect(sub).toHaveText(/^Your turn\./);
    await expect(page.locator('[data-lt-golive]')).toHaveClass(/is-turn/);

    /* And it stops there. The demo never goes live for you. */
    await expect(page.locator(LIVE)).toHaveCount(0);
    await expect(page.locator('[data-lt-out="dests"]')).toHaveText('3 destinations');
    await expect(page.locator('[data-lt-out="formats"]')).toHaveText('2 formats');
    await expect(page.locator('[data-lt-out="health"]')).toHaveText('Idle');
  });

  test('a tap on the surface takes the invitation down', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    const sub = page.locator('[data-lt-golive-sub]');
    await expect(sub).toHaveAttribute('data-lt-yourturn', 'true', { timeout: 10_000 });

    await page.locator('[data-lt-dest="facebook"] [data-lt-pick]').click();
    await expect(sub).toHaveAttribute('data-lt-yourturn', 'false');
    await expect(page.locator('[data-lt-golive]')).not.toHaveClass(/is-turn/);
  });

  test('scrolling past the hero takes the invitation down', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html.sc-ready');
    const sub = page.locator('[data-lt-golive-sub]');
    await expect(sub).toHaveAttribute('data-lt-yourturn', 'true', { timeout: 10_000 });

    await toAct(page, 'act-break', 0.1);
    await expect(sub).toHaveAttribute('data-lt-yourturn', 'false');
  });
});

test.describe('the destinations', () => {
  test.use({ viewport: DESK });

  test('a connect-account destination signs in, turns Ready and draws its own path', async ({
    page,
  }) => {
    await ownTheSurface(page);
    const li = page.locator('[data-lt-dest="facebook"]');
    await expect(page.locator('[data-lt-path="facebook"]')).not.toHaveAttribute('d', /./);
    /* A tile with no connection has no picture to show, so it shows none. */
    await expect(li.locator('[data-lt-thumb]')).toBeHidden();

    await li.locator('[data-lt-pick]').click();
    await expect(li).toHaveAttribute('data-lt-state', 'AUTHENTICATING');
    await expect(li.locator('[data-lt-status]')).toHaveText('Waiting for Facebook');
    await expect(li).toHaveAttribute('data-lt-state', 'READY', { timeout: 6_000 });
    await expect(li.locator('[data-lt-label]')).toHaveText('Ready');
    await expect(li.locator('[data-lt-status]')).toHaveText('Goes live when you tap GO LIVE');

    const d = await page.locator('[data-lt-path="facebook"]').getAttribute('d');
    expect(d).toMatch(/^M[\d.]+ [\d.]+ C/);
    await expect(page.locator('[data-lt-path="facebook"]')).toHaveAttribute(
      'data-lt-phase',
      'ready',
    );
    await expect(page.locator('[data-lt-out="dests"]')).toHaveText('1 destination');
    /* The tile's own picture arrives with the connection, in the destination's own shape. */
    await expect(li.locator('[data-lt-thumb]')).not.toHaveAttribute('hidden', /.*/);
  });

  test('a paste-key destination asks for the key first, in place', async ({ page }) => {
    await ownTheSurface(page);
    const li = page.locator('[data-lt-dest="tiktok"]');
    await li.locator('[data-lt-pick]').click();

    const key = li.locator('[data-lt-keyrow]');
    await expect(key).toBeVisible();
    await expect(key.locator('label')).toHaveText('Stream key');
    await expect(key.locator('.lt-field__hint')).toContainText('You start and end the broadcast');
    await key.locator('[data-lt-keygo]').click();
    await expect(li).toHaveAttribute('data-lt-state', 'READY', { timeout: 6_000 });
    /* TikTok accepts one shape, and the tile says which. */
    await expect(li.locator('[data-lt-fmt]')).toHaveText('9:16');
  });

  test('an empty key is refused in place, and says what to do', async ({ page }) => {
    await ownTheSurface(page);
    const li = page.locator('[data-lt-dest="instagram"]');
    await li.locator('[data-lt-pick]').click();
    await li.locator('[data-lt-keyrow] input').fill('');
    await li.locator('[data-lt-keygo]').click();

    await expect(li.locator('[data-lt-keyerror]')).toBeVisible();
    await expect(li.locator('[data-lt-keyerror]')).toContainText(
      'Paste the key from Instagram first.',
    );
    await expect(li).toHaveAttribute('data-lt-state', 'DISCONNECTED');
  });

  test('GO LIVE from an empty surface connects two for you, and says which two', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await page.locator('[data-lt-golive]').click();

    const sub = page.locator('[data-lt-golive-sub]');
    await expect(sub).toHaveClass(/is-warning/);
    await expect(sub).toHaveText('Nothing was picked, so LIVETAP connected YouTube and Twitch.');

    await expect(page.locator(LIVE)).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('[data-lt-golive-label]')).toHaveText('END');
    await expect(page.locator('[data-lt-stage-live]')).toBeVisible();
    await expect(page.locator('[data-lt-out="health"]')).toHaveText('Excellent');
    await expect(page.locator('[data-lt-stateline]')).toHaveText('Live on YouTube and Twitch');
  });

  test('the countdown can be cancelled, and cancelling leaves nobody live', async ({ page }) => {
    await ownTheSurface(page);
    await page.locator('[data-lt-dest="youtube"] [data-lt-pick]').click();
    await expect(page.locator(READY)).toHaveCount(1, { timeout: 6_000 });

    await page.locator('[data-lt-golive]').click();
    await expect(page.locator('[data-lt-golive]')).toHaveClass(/lt-golive--countdown/);
    await expect(page.locator('[data-lt-golive-cancel]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lt-golive]')).not.toHaveClass(/lt-golive--countdown/);
    await expect(page.locator(LIVE)).toHaveCount(0);
    await expect(page.locator(READY)).toHaveCount(1);
  });

  test('END takes every destination down through Stopping', async ({ page }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);

    await page.locator('[data-lt-golive]').click();
    await expect(page.locator('[data-lt-dest][data-lt-state="ENDED"]')).toHaveCount(3, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-lt-golive-label]')).toHaveText('GO LIVE (DEMO)');
    await expect(page.locator('[data-lt-stage-live]')).toBeHidden();
    await expect(page.locator('[data-lt-out="health"]')).toHaveText('Idle');
  });
});

test.describe('one production, every shape', () => {
  test.use({ viewport: DESK });

  test('the shape control exists twice and the two copies stay in step', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-shape', 0.4);

    const toolbar = page.locator('.ltp-toolbar [data-lt-formats]');
    const band = page.locator('[data-lt-band="act-shape"] [data-lt-formats]');
    await expect(page.locator('[data-lt-formats]')).toHaveCount(2);

    await band.locator('[data-lt-format-set="1:1"]').click();
    await expect(toolbar.locator('[data-lt-format-set="1:1"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(toolbar.locator('[data-lt-format-set="16:9"]')).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await toolbar.locator('[data-lt-format-set="16:9"]').click();
    await expect(band.locator('[data-lt-format-set="16:9"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('the shape control physically re-flows the stage, and 9:16 draws the reserved space', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-shape', 0.4);

    const canvas = page.locator('[data-lt-canvas]');
    const wide = (await canvas.boundingBox())!;

    await page.locator('.ltp-toolbar [data-lt-format-set="9:16"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '9:16');
    await expect(page.locator('[data-lt-shape]')).toHaveText('9:16');
    await page.waitForTimeout(400);

    const tall = (await canvas.boundingBox())!;
    expect(tall.width).toBeLessThan(wide.width * 0.5);
    expect(tall.height).toBeGreaterThan(wide.height * 0.9);

    /* The space the platform keeps for chat and buttons, drawn on the picture. */
    await expect(page.locator('[data-lt-guides]')).toHaveClass(/is-on/);
    await expect(page.locator('.ltp-guides__zone--bottom')).toBeVisible();
    await expect(page.locator('.ltp-guides__zone--right')).toBeVisible();

    await page.locator('.ltp-toolbar [data-lt-format-set="1:1"]').click();
    await page.waitForTimeout(400);
    const square = (await canvas.boundingBox())!;
    expect(Math.abs(square.width - square.height)).toBeLessThan(4);

    /* No platform here asks for a square, and the surface says so rather than faking one. */
    await expect(page.locator('[data-lt-statedetail]')).toContainText(
      'No destination here asks for square',
    );
  });

  test('the Shapes band prints what each destination will be sent', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-shape', 0.4);
    await expect(page.locator('[data-lt-formattable]')).toHaveText(
      'YouTube 16:9  ·  Twitch 16:9  ·  TikTok 9:16  ·  Instagram 9:16  ·  X 16:9  ·  Facebook 16:9',
    );
  });
});

test.describe('the Moments', () => {
  test.use({ viewport: DESK });

  test('a Moment recomposes the stage without moving the frame, and the mirror agrees', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-moments', 0.5);

    await expect(page.locator('[data-lt-layer="camera"]')).toHaveClass(/is-on/);
    const frameBefore = (await page.locator('[data-lt-frame]').boundingBox())!;
    const cameraBefore = (await page.locator('[data-lt-layer="camera"]').boundingBox())!;

    await page.locator('[data-lt-moment-mirror="guest"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-active-moment', 'guest');
    await page.waitForTimeout(600);

    await expect(page.locator('[data-lt-moment="guest"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-lt-moment-mirror="guest"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-lt-layer="guest"]')).toHaveClass(/is-on/);
    expect((await verifyState(page)).moment).toBe('guest');

    const cameraAfter = (await page.locator('[data-lt-layer="camera"]').boundingBox())!;
    const frameAfter = (await page.locator('[data-lt-frame]').boundingBox())!;

    /* The contents cross over; the frame itself holds. That is the difference between a Moment
       and a page transition. */
    expect(cameraAfter.width).toBeLessThan(cameraBefore.width * 0.6);
    expect(frameAfter.width).toBeCloseTo(frameBefore.width, 0);
    expect(frameAfter.y).toBeCloseTo(frameBefore.y, 0);
  });

  test('Screen Share turns the screen on instead of refusing', async ({ page }) => {
    await ownTheSurface(page);
    await expect(page.locator('[data-lt-input="screen"]')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('[data-lt-moment="screen-share"]').click();
    await expect(page.locator('[data-lt-input="screen"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-lt-layer="screen"]')).toHaveClass(/is-on/);
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute(
      'data-lt-active-moment',
      'screen-share',
    );
  });

  test('a Moment that mutes the microphone says so on the control', async ({ page }) => {
    await ownTheSurface(page);
    await page.locator('[data-lt-moment="main-camera"]').click();
    await expect(page.locator('[data-lt-input="mic"] [data-lt-input-state]')).toHaveText('On');

    await page.locator('[data-lt-moment="break"]').click();
    await expect(page.locator('[data-lt-input="mic"] [data-lt-input-state]')).toHaveText('Muted');
    await expect(page.locator('[data-lt-layer="text"]')).toHaveText('Back in a moment');
  });

  test('the number keys switch Moments, the way the product does', async ({ page }) => {
    await ownTheSurface(page);
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('1');
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute(
      'data-lt-active-moment',
      'starting-soon',
    );
    await page.keyboard.press('6');
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-active-moment', 'ending');
  });
});

test.describe('the outputs', () => {
  test.use({ viewport: DESK });

  test('six outputs, each in its own platform shape, counted by the lede', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-outputs', 0.5);

    const outputs = page.locator('[data-lt-outputs] figure.ltp-output');
    await expect(outputs).toHaveCount(6);
    await expect(page.locator('[data-lt-outputs] canvas')).toHaveCount(6);
    for (const [id, shape] of [
      ['youtube', '16:9'],
      ['tiktok', '9:16'],
      ['x', '16:9'],
    ] as const) {
      await expect(page.locator(`[data-lt-output="${id}"] .ltp-output__meta`)).toContainText(shape);
    }
    /* With nothing picked the counters step aside for a sentence that says so. */
    await expect(page.locator('[data-lt-countwrap]')).toHaveClass(/is-empty/);
    await expect(page.locator('.ltp-band__nocounts')).toContainText('Nothing is picked yet.');
  });

  test('an output lights up with the destination it belongs to', async ({ page }) => {
    await ownTheSurface(page);
    /*
     * Connected first, then read. The Outputs band is one of the two tall bands, and a tall
     * band is a panel over the surface: while it is on screen the tiles underneath it are not
     * reachable by a pointer. See `audit-closure.spec.ts` for that finding stated on its own.
     */
    await page.locator('[data-lt-dest="youtube"] [data-lt-pick]').click();
    await expect(page.locator(READY)).toHaveCount(1, { timeout: 6_000 });

    await toAct(page, 'act-outputs', 0.5);
    await expect(page.locator('[data-lt-output="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'READY',
    );
    await expect(page.locator('[data-lt-output="youtube"] .lt-chip__label')).toHaveText('Ready');
    await expect(page.locator('[data-lt-output="tiktok"]')).toHaveAttribute(
      'data-lt-state',
      'DISCONNECTED',
    );
    /* The numbers are the engine's counters, re-targeted from the visitor's own picks. */
    await expect(page.locator('[data-lt-countwrap]')).not.toHaveClass(/is-empty/);
    await expect(page.locator('[data-lt-outputs-lede]')).toContainText('16:9. Each platform gets what it accepts.');
  });
});

test.describe('instead of OBS', () => {
  test.use({ viewport: DESK });

  test('the two lanes play, and playing ours moves the surface behind it', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-versus', 0.4);

    const versus = page.locator('[data-lt-versus]');
    await expect(versus).toHaveAttribute('data-lt-versus-state', 'idle');
    await expect(page.locator('[data-lt-track="obs"] li')).toHaveCount(14);
    await expect(page.locator('[data-lt-track="livetap"] li')).toHaveCount(6);

    await page.getByRole('button', { name: 'Play the usual setup' }).click();
    await expect(versus).toHaveAttribute('data-lt-versus-state', 'obs');
    await expect(page.locator('[data-lt-count="obs"]')).toHaveText('14', { timeout: 6_000 });

    await page.getByRole('button', { name: 'Play LIVETAP' }).click();
    await expect(versus).toHaveAttribute('data-lt-versus-state', 'both');
    /* Lane B is not a picture of the product: it connects two destinations on the real surface
       and goes live, which is the only honest way to claim six taps. */
    await expect(page.locator('[data-lt-dest="youtube"]')).not.toHaveAttribute(
      'data-lt-state',
      'DISCONNECTED',
    );
    await expect(page.locator('[data-lt-dest="tiktok"]')).not.toHaveAttribute(
      'data-lt-state',
      'DISCONNECTED',
    );
    /* Talking suggests YouTube and Twitch, and the lane adds TikTok, so three go live. */
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 25_000 });
  });
});

test.describe('Simple by default, Pro when you want it', () => {
  test.use({ viewport: DESK });

  test('Pro adds four rows, says so in the signature, and takes nothing away', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-pro', 0.4);

    await expect(page.locator('[data-lt-prolayers]')).toBeHidden();
    expect((await verifyState(page)).mode).toBe('simple');
    const controlsBefore = await page.locator('.ltp-toolbar button').count();

    await page.locator('[data-lt-band="act-pro"] [data-lt-mode-set="pro"]').click();
    await expect(page.locator('[data-lt-prolayers]')).toBeVisible();
    await expect(page.locator('[data-lt-prorow]')).toHaveCount(4);
    await expect(page.locator('[data-lt-prorow="log"]')).toContainText('This session');
    await expect(page.locator('[data-lt-prorow="ceiling"]')).toContainText('Mbps');
    await expect(page.locator('[data-lt-surface]')).toHaveClass(/is-pro/);
    expect((await verifyState(page)).mode).toBe('pro');

    /* Both copies of the control agree, and the desk keeps every button it had. */
    await expect(page.locator('.ltp-toolbar [data-lt-mode-set="pro"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await page.locator('.ltp-toolbar button').count()).toBe(controlsBefore);

    await page.locator('.ltp-toolbar [data-lt-mode-set="simple"]').click();
    await expect(page.locator('[data-lt-prolayers]')).toBeHidden();
    expect((await verifyState(page)).mode).toBe('simple');
  });

  test('Simple never shows a number Pro is there to show', async ({ page }) => {
    await ownTheSurface(page);
    await expect(page.locator('[data-lt-prolayers]')).toBeHidden();
    await expect(page.locator('.ltp-toolbar')).not.toContainText('Mbps');
  });
});

test.describe('the close is the app first question', () => {
  test.use({ viewport: DESK });

  test('the intent chips change the production and carry the answer into the app', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-make', 0.5);

    await expect(page.locator('.ltp-close__q')).toHaveText('What are you making?');
    await expect(page.locator('[data-lt-intent]')).toHaveCount(6);
    await expect(page.locator('[data-lt-open]')).toHaveAttribute(
      'href',
      './app/start?intent=talking',
    );

    await page.locator('[data-lt-intent="vertical"]').click();
    await expect(page.locator('[data-lt-intent="vertical"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('[data-lt-open]')).toHaveAttribute(
      'href',
      './app/start?intent=vertical',
    );
    await expect(page.locator('[data-lt-open]')).toHaveText('Open LIVETAP for Vertical Live');
    /* Vertical Live composes in 9:16, and the stage adopts it. */
    await expect(page.locator('[data-lt-shape]')).toHaveText('9:16');
    await expect(page.locator('[data-lt-intent-answer]')).toContainText(
      'Vertical Live: Built for phones, first. Composing in 9:16',
    );
    /* Its two suggested destinations are the two that accept it. */
    await expect(page.locator('[data-lt-dest="tiktok"]')).toHaveClass(/is-suggested/);
    await expect(page.locator('[data-lt-dest="instagram"]')).toHaveClass(/is-suggested/);
  });

  test('an intent renames the Moments it renames, in both places', async ({ page }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-make', 0.5);

    await page.locator('[data-lt-intent="gaming"]').click();
    await expect(
      page.locator('[data-lt-moment="screen-share"] [data-lt-moment-name]'),
    ).toHaveText('Gameplay');
    await expect(
      page.locator('[data-lt-moment-mirror="screen-share"] [data-lt-moment-name]'),
    ).toHaveText('Gameplay');
  });
});

test.describe('the signature move: break it yourself', () => {
  test.use({ viewport: DESK });

  test('dragging a live destination off the stage breaks exactly that one', async ({ page }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);
    await expect(page.locator('[data-lt-dest].is-armed')).toHaveCount(3);
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(3);
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-slot] button')).toBeVisible();

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

    /* The break fires while the tile is still held: a stream does not wait for you to let go. */
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      /DEGRADED|RECONNECTING/,
      { timeout: 4_000 },
    );
    await page.mouse.up();

    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 6_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="RECONNECTING"]')).toHaveCount(1);
    await expect(page.locator(LIVE)).toHaveCount(2);

    /* The card says what happened, why, what LIVETAP is doing and what you can do. */
    const card = page.locator('[data-lt-dest="youtube"] .lt-errorcard');
    await expect(card).toBeVisible();
    await expect(card).toContainText('YouTube stopped accepting the picture.');
    await expect(card).toContainText('Your other destinations are not affected.');
    await expect(card).toContainText('Attempt 1 of 10');
    await expect(card.getByRole('button', { name: 'Stop this destination' })).toBeVisible();
    /* And a ring counts the four seconds down beside the tile. */
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-digit]')).toHaveText(/^[0-4]$/);

    /* Not one thing about a sibling changed while the broken one fell over. */
    expect(await tileState(page, 'twitch')).toEqual(before.twitch);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);

    /* Then it pulls itself back in, on its own, with nothing asked of the visitor. */
    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 15_000 });
    expect(await tileState(page, 'twitch')).toEqual(before.twitch);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);
  });

  test('the keyboard does the same thing, on the same element', async ({ page }) => {
    await ownTheSurface(page);
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
      { timeout: 6_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="RECONNECTING"]')).toHaveCount(1);
    await expect(page.locator(LIVE)).toHaveCount(2);
    expect(await tileState(page, 'youtube')).toEqual(before.youtube);
    expect(await tileState(page, 'facebook')).toEqual(before.facebook);

    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 15_000 });
  });

  test('an arrow nudge under the threshold strains the path and changes nothing', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    const tile = page.locator('[data-lt-dest="youtube"] [data-lt-pick]');
    await tile.focus();
    /* Six presses is 144px, under the 168px threshold. The stream never broke. */
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute('data-lt-state', 'LIVE');
    const tension = await page
      .locator('[data-lt-dest="youtube"]')
      .evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--lt-tension')));
    expect(tension).toBeGreaterThan(0.6);
    expect(tension).toBeLessThan(1);

    /* Escape returns it to its port with no state change, exactly like a release under it. */
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute('data-lt-state', 'LIVE');
    await expect(page.locator(LIVE)).toHaveCount(3);
  });

  test('the chapter button does the whole thing, and its label says what it will do', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await toAct(page, 'act-break', 0.3);

    const cta = page.locator('[data-lt-break-cta]');
    await expect(cta).toHaveText('Go live, then break YouTube');
    await cta.click();

    await expect(page.locator(LIVE)).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 15_000 },
    );
    await expect(cta).toHaveText('Breaking. Watch the tile');
    await expect(page.locator('[data-lt-dest="twitch"]')).toHaveAttribute('data-lt-state', 'LIVE');

    await expect(page.locator(LIVE)).toHaveCount(2, { timeout: 15_000 });
    await expect(cta).toHaveText('Break YouTube for me');
  });

  test('stopping the broken one keeps the others live', async ({ page }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    await page.locator('[data-lt-dest="facebook"] [data-lt-pick]').focus();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-lt-dest="facebook"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 6_000 },
    );

    await page
      .locator('[data-lt-dest="facebook"]')
      .getByRole('button', { name: 'Stop this destination' })
      .click();
    await expect(page.locator('[data-lt-dest="facebook"]')).toHaveAttribute(
      'data-lt-state',
      'ENDED',
    );
    await expect(page.locator(LIVE)).toHaveCount(2);
    await expect(page.locator('[data-lt-dest="facebook"] .lt-errorcard')).toHaveCount(0);
  });

  test('leaving the peak disarms the tiles again', async ({ page }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);
    await expect(page.locator('[data-lt-dest].is-armed')).toHaveCount(3);

    await toAct(page, 'act-shape', 0.4);
    await expect(page.locator('[data-lt-dest].is-armed')).toHaveCount(0);
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(0);
    await expect(page.locator(LIVE)).toHaveCount(3);
  });
});

test.describe('the chapters own the scroll', () => {
  test.use({ viewport: DESK });

  test('each chapter lights its own band, and only its own', async ({ page }) => {
    await ownTheSurface(page);
    for (const id of BANDED_ACTS) {
      await toAct(page, id, 0.5);
      expect(await page.evaluate(() => document.body.dataset.ltAct)).toBe(id);
      await expect(page.locator('[data-lt-band].is-here')).toHaveCount(1);
      await expect(page.locator(`[data-lt-band="${id}"]`)).toHaveClass(/is-here/);
      await expect(page.locator(`[data-lt-band="${id}"] .ltp-band__title`)).toBeVisible();
    }
    /* The close has no band: it is the only chapter whose copy is inside the act. */
    await toAct(page, 'act-make', 0.5);
    expect(await page.evaluate(() => document.body.dataset.ltAct)).toBe('act-make');
    await expect(page.locator('[data-lt-band].is-here')).toHaveCount(0);
    await expect(page.locator('.ltp-close')).toBeVisible();
    await expect(page.locator('[data-lt-surface]')).toHaveClass(/is-closing/);
  });
});

test.describe('the tour is operated, never played', () => {
  test.use({ viewport: DESK });

  test('opens, never advances by itself, and strikes a step through when it is done', async ({
    page,
  }) => {
    await ownTheSurface(page);
    await page.locator('[data-lt-tour-open]').click();

    const tour = page.getByRole('region', { name: 'Guided tour' });
    await expect(tour).toBeVisible();
    await expect(tour.locator('[data-lt-step]')).toHaveCount(7);
    await expect(tour.locator('[data-lt-step].is-done')).toHaveCount(0);
    /* No progress counter, ever. */
    await expect(tour).not.toContainText('/ 7');

    await page.locator('.ltp-toolbar [data-lt-format-set="9:16"]').click();
    await expect(tour.locator('[data-lt-step="shape"]')).toHaveClass(/is-done/);
    /* Steps complete out of order: changing the shape leaves every other step open. */
    await expect(tour.locator('[data-lt-step="break"]')).not.toHaveClass(/is-done/);

    await page.keyboard.press('Escape');
    await expect(tour).toBeHidden();
  });
});

test.describe('reduced motion loses movement and nothing else', () => {
  test.use({ viewport: DESK, reducedMotion: 'reduce' });

  test('offers no grip, breaks from the keyboard, and never moves the tile', async ({ page }) => {
    await ownTheSurface(page);
    await goLiveOnThree(page);
    await toAct(page, 'act-break', 0.2);

    /* The drag apparatus is not constructed at all, so no grip is offered. */
    await expect(page.locator('[data-lt-dest].is-draggable')).toHaveCount(0);
    await expect(page.locator('[data-lt-dest].is-armed')).toHaveCount(3);
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-hint]')).toHaveText(
      'Press Delete to drop it',
    );

    const boxBefore = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    const twitchBefore = await tileState(page, 'twitch');

    await page.locator('[data-lt-dest="youtube"] [data-lt-pick]').focus();
    await page.keyboard.press('Delete');

    /* DEGRADED is skipped, because a 700ms intermediate state with no motion is a flicker. */
    await expect(page.locator('[data-lt-dest="youtube"]')).toHaveAttribute(
      'data-lt-state',
      'RECONNECTING',
      { timeout: 2_000 },
    );
    await expect(page.locator('[data-lt-dest][data-lt-state="DEGRADED"]')).toHaveCount(0);
    await expect(page.locator(LIVE)).toHaveCount(2);

    /* No positional animation: the tile is where it was, to the pixel. */
    const boxDuring = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    expect(boxDuring).toEqual(boxBefore);
    expect(await tileState(page, 'twitch')).toEqual(twitchBefore);

    /* The countdown is text, and the information is identical to the full-motion page. */
    await expect(page.locator('[data-lt-dest="youtube"] [data-lt-status]')).toContainText(
      'Attempt 1 of 10, retrying in 4 s',
    );

    await expect(page.locator(LIVE)).toHaveCount(3, { timeout: 15_000 });
    const boxAfter = (await page.locator('[data-lt-dest="youtube"]').boundingBox())!;
    expect(boxAfter).toEqual(boxBefore);
  });

  test('holds the picture still and keeps every chapter usable', async ({ page }) => {
    await ownTheSurface(page);
    await expect(page.locator('[data-lt-layer="camera"] video')).toHaveJSProperty('paused', true);

    for (const id of BANDED_ACTS) {
      await toAct(page, id, 0.5);
      await expect(page.locator(`[data-lt-band="${id}"]`)).toHaveClass(/is-here/);
    }
    await page.locator('.ltp-toolbar [data-lt-format-set="9:16"]').click();
    await expect(page.locator('[data-lt-stage]')).toHaveAttribute('data-lt-format', '9:16');
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

      for (const id of ['act-hero', 'act-break', 'act-shape', 'act-outputs', 'act-make']) {
        await toAct(page, id, 0.5);
        expect(await hasHorizontalOverflow(page), `${id} overflows at ${name}`).toBe(false);
      }

      /*
       * The 44px touch floor, where the design system applies it.
       *
       * `packages/ui/src/global.css` scopes `.lt-touch` to `(max-width: 639.98px), (pointer:
       * coarse)`, so a mouse-driven desk deliberately carries smaller chips for the three input
       * toggles. Asserting 44px there would be asserting something the product never claimed.
       */
      const small = await page.evaluate(() => {
        const out: string[] = [];
        if (!matchMedia('(max-width: 639.98px), (pointer: coarse)').matches) return out;
        const sel =
          '[data-lt-pick], [data-lt-format-set], [data-lt-moment], [data-lt-intent], [data-lt-golive], [data-lt-input], [data-lt-tour-open], [data-lt-theme], [data-lt-mode-set]';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 && r.height < 1) continue;
          if (r.height < 43.5 || r.width < 43.5) {
            out.push(
              `${el.dataset.ltPick ?? el.className}: ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      });
      expect(small).toEqual([]);
    });
  }
});
