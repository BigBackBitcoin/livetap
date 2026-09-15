import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Taps, freshFirstRun, reachStudio } from './helpers.js';

/**
 * The paste-a-key path is not a workaround: for four of the nine platforms it is the only path
 * that exists, and per the alpha plan it is the one path that can reach a real platform tonight
 * with no OAuth client and no review queue. It gets the same standard of error message as
 * everything else — the mistake and the fix, in that order — and, which is the part this file
 * now also measures, it has to still work after it has said no.
 *
 * The submit control is asked for by `[data-lt-connect]`, never by its label. `StreamKeyForm.tsx`
 * publishes that attribute for the same reason `LiveBar` publishes `data-lt-stop`, and says so in
 * its own comment: the label has already been "Save this destination" and is now "Connect", and
 * each time it changed, everything that asked for the words stopped being able to add a
 * destination and reported the product broken. This file was one of the things that broke. Ask
 * for the control that DOES the thing.
 */

/** Open the paste-key form on a clean install, with the two fields and the submit in hand. */
async function openPasteKeyForm(page: Page): Promise<{
  url: ReturnType<Page['getByLabel']>;
  key: ReturnType<Page['getByLabel']>;
  name: ReturnType<Page['getByLabel']>;
  save: ReturnType<Page['locator']>;
}> {
  await freshFirstRun(page);
  await reachStudio(page, new Taps(page));
  await page.getByRole('link', { name: 'Destinations' }).first().click();
  await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();
  await page.getByRole('button', { name: /Add destination/ }).click();
  await page.getByRole('button', { name: /^Custom RTMP/ }).click();
  return {
    url: page.getByLabel('Server address'),
    key: page.getByLabel('Stream key'),
    name: page.getByLabel('Name for this destination'),
    save: page.locator('[data-lt-connect]'),
  };
}

test('a bad server address and a spaced key are each refused inline, with the fix named', async ({
  page,
}) => {
  const { url, key, save } = await openPasteKeyForm(page);

  // A web page address is the commonest mistake, and the message names the fix.
  await url.fill('https://twitch.tv/latenightbuild');
  await key.fill('live_abc_123');
  await save.click();
  await expect(page.getByText(/That looks like a web page address/)).toBeVisible();

  // A key with a space in it is the second commonest.
  await url.fill('rtmp://live.example.com/app');
  await key.fill('live_abc 123');
  await save.click();
  await expect(page.getByText(/Copy it again/)).toBeVisible();
});

test('a good key reaches READY, and the card never shows the key again', async ({ page }) => {
  const { url, key, name, save } = await openPasteKeyForm(page);

  await url.fill('rtmp://live.example.com/app');
  await key.fill('live_abc_123456');
  await name.fill('My own server');
  await save.click();

  const card = page.locator('.lt-destcard', { hasText: 'My own server' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Ready')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('live_abc_123456');
});

/**
 * DEFECT — CONFIRMED. Once the paste-key form has refused a submission, correcting it and
 * submitting again does nothing at all, silently.
 *
 * Reproduction, `/app/destinations` → Add destination → Custom RTMP, on a clean install:
 *   1. Address `https://twitch.tv/latenightbuild`, key `live_abc_123`, Connect.
 *      Refused: "That looks like a web page address…". Correct, and the message is good.
 *   2. Address `rtmp://live.example.com/app`, key `live_abc 123`, Connect.
 *      Refused: "That key has a space in it. Copy it again…". Correct, and the message is good.
 *   3. Fix the key to `live_abc_123456`, give the destination the name it is asking for, and
 *      Connect. Every field is now valid and the form agrees — all three inline messages clear.
 *
 * Expected: the sheet closes and a `Custom RTMP · My own server` card appears, READY. That is
 * exactly what the test above this one does, in the same build, with the same three values —
 * the only difference is that it was never refused first.
 *
 * Observed: nothing happens. The sheet stays open, every field keeps its value, all three error
 * messages are gone so the form is not saying why, no destination is created, and the page throws
 * nothing. The creator is left with a form that looks correct and a button that does not work,
 * and the only way out is Cancel and start again.
 *
 * Severity: HIGH. This is the one path in the product that reaches a real platform without an
 * OAuth client, and the two mistakes above it are the two a first-timer actually makes — the
 * form's own copy says so. Getting it right on the third try is the normal case, not the corner.
 *
 * FIXED, and the cause was neither the form's guard nor the store — the submit event never fired
 * at all. `click` is dispatched to the common ancestor of where the pointer went DOWN and where it
 * came UP, and blurring a field to reach Connect adds an error line ABOVE the button: the button
 * moves a few pixels while the pointer is still travelling, mouseup lands on whatever took its
 * place, and no click is ever dispatched. Instrumenting the handler is what showed it — the probe
 * fired on the first press and on nothing after it.
 *
 * The fix is in `packages/ui/src/components/Button.tsx`: every button captures the pointer on
 * pointerdown, so a press is judged on where it started and a reflow cannot steal it. That is the
 * same invariant `useSteadyWhilePressed` keeps for a destination row, applied to every button in
 * the product at once.
 */
test('a corrected submission after a refusal still creates the destination', async ({ page }) => {
  const { url, key, name, save } = await openPasteKeyForm(page);

  await url.fill('https://twitch.tv/latenightbuild');
  await key.fill('live_abc_123');
  await save.click();
  await expect(page.getByText(/That looks like a web page address/)).toBeVisible();

  await url.fill('rtmp://live.example.com/app');
  await key.fill('live_abc 123');
  await save.click();
  await expect(page.getByText(/Copy it again/)).toBeVisible();

  await key.fill('live_abc_123456');
  await name.fill('My own server');
  await save.click();

  await expect(
    page.locator('.lt-destcard', { hasText: 'My own server' }),
    'a corrected paste-key submission produced no destination and no explanation',
  ).toBeVisible({ timeout: 15_000 });
});
