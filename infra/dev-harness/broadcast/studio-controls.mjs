/**
 * The controls the broadcast harnesses press, and the one place their names live.
 *
 * Two scripts drive the real desktop app through a real broadcast: `apps/desktop/e2e/broadcast.mjs`
 * and stage 4 of `verify-desktop-broadcast.mjs`. Both had their own copy of the selectors, and the
 * gate script carried a comment admitting it: "The few selectors below are the same ones the studio
 * driver uses and must be kept in step with it." They were not kept in step, and the way that
 * surfaced is worth writing down, because the harness was wrong in the most expensive direction.
 *
 * The product changed correctly and the harnesses did not follow:
 *
 *   1. Studio renders `{live ? null : <section className="lt-studio__go">}`. Once a broadcast is
 *      running, `.lt-golive` is not on the page at all - the control that can stop it lives in the
 *      shell's LiveBar, so that it survives a route change. Both scripts went on clicking
 *      `.lt-golive` to press END and sat there until the timeout, reporting FAIL against a
 *      broadcast that was at that moment working perfectly.
 *
 *   2. `startCountdown()` sets `pendingConfirm` on the first broadcast that can reach a real
 *      account, which REPLACES the button with a confirmation the creator has to answer. A driver
 *      that clicks once and then waits for a countdown waits forever.
 *
 * So the rule here is: ask for the control by what it DOES, never by which screen it happens to be
 * on today. LiveBar already publishes exactly that contract - `data-lt-stop` "names the control
 * that can act on the broadcast right now, in whichever state the production is in" - and this
 * module is the other half of that bargain.
 */

/** How long to wait for the real-broadcast confirmation before deciding it is not coming. */
const CONFIRM_WAIT_MS = 2500;

/**
 * Tap GO LIVE and answer the confirmation if this build asks for one.
 *
 * Returns what actually happened, so a harness can log the path it took rather than assuming one.
 * `confirmed` true means this run crossed the "these are real accounts" interstitial; false means
 * the build had nothing real to confirm, which is the correct and quiet outcome for a demo build.
 */
export async function goLive(win) {
  await win.locator('.lt-golive').click();

  const confirm = win.locator('.lt-realconfirm');
  try {
    await confirm.waitFor({ state: 'visible', timeout: CONFIRM_WAIT_MS });
  } catch {
    // No confirmation in this build or this state. The countdown is already running.
    return { confirmed: false, destinations: 0 };
  }

  /*
   * Read the count off the button rather than counting destinations ourselves. The number in
   * "Yes, go live on 2" comes from `reality.real.length`, which is the app's own answer to "how
   * many of these will genuinely receive bytes" - the single most important number in the product,
   * and the one a harness has no business recomputing.
   */
  const yes = confirm.getByRole('button', { name: /^Yes, go live on \d+/ });
  const label = (await yes.textContent()) ?? '';
  const destinations = Number(/(\d+)/.exec(label)?.[1] ?? 0);
  await yes.click();
  return { confirmed: true, destinations };
}

/**
 * Press END on a running broadcast, wherever the app is currently showing it.
 *
 * `[data-lt-stop="end"]` exists in exactly one of LiveBar's four states, which is what makes it
 * safe to wait for: pressing blind would hit "Cancel start" during a start, and cancelling a start
 * is not ending a broadcast. Waiting for this attribute means the harness presses END or it presses
 * nothing, and a timeout here is a real finding rather than a race.
 */
export async function pressEnd(win, { timeout = 15_000 } = {}) {
  const end = win.locator('[data-lt-stop="end"]');
  await end.waitFor({ state: 'visible', timeout });
  await end.click();
}

/** True while the shell is showing a live broadcast, whatever route the app is on. */
export async function isOnAir(win) {
  return (await win.locator('.lt-livebar').count()) > 0;
}
