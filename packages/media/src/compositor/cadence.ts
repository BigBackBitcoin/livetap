/**
 * When a composited frame is due, given what the display is actually doing.
 *
 * This is eight lines of arithmetic that took five interleaved A/B runs to get right, so the
 * reasoning is written down here rather than rediscovered.
 *
 * A compositor driven by `requestAnimationFrame` gets a callback per display refresh, which may be
 * far more often than the format needs: a 1080p30 broadcast on a 120 Hz laptop is asked to draw
 * four times for every frame the encoder can use, and `captureStream(fps)` samples the canvas at
 * the format's rate regardless, so three of those four are drawn and thrown away. Throttling is
 * therefore worth real milliseconds - on the right machine.
 *
 * The first attempt throttled with a tolerance of a quarter of the FORMAT's interval, which
 * silently assumes the display is faster than the format. On a GPU-less VM whose animation frames
 * arrive at about 31 Hz, a 30 fps format under that rule skipped roughly one frame in six, and the
 * skipped frames did not come back as headroom. They came back as more expensive remaining frames:
 * a longer gap between draws of the same `<video>` means its frame has to be converted again.
 * Measured cost per composited copy went from 8.85 ms to 12.65 ms across five interleaved pairs
 * (`apps/web/scripts/perf-ab.mjs`), with no frame rate gained - a change that was slower AND
 * delivered fewer frames to a live encoder.
 *
 * So the tolerance is half of the DISPLAY's own measured frame period. A display no faster than
 * the format can never arrive early enough to be skipped, and nothing is throttled at all; a 60 or
 * 120 Hz display skips exactly the frames that were going to be discarded anyway. The bias is
 * always towards drawing: under-delivering frames to a live encoder is a worse failure than
 * composing one more frame than was strictly owed.
 */

/** The display's measured cadence, smoothed, in milliseconds between animation frames. */
export class DisplayCadence {
  private periodMs = 0;
  private lastAt = 0;

  /**
   * Record that an animation frame arrived at `now`, and return the period to budget with.
   *
   * Returns 0 until a second frame has been seen, which makes the first frame unconditional -
   * the safe direction, because a frame drawn early costs one draw and a frame skipped early
   * costs a black preview.
   */
  observe(now: number): number {
    const last = this.lastAt;
    this.lastAt = now;
    if (last === 0) return 0;
    const delta = now - last;
    // A stall - a hidden tab, a long task, a machine that went away - says nothing about the
    // display's cadence, so it must not be allowed to widen the tolerance.
    if (delta <= 0 || delta > 250) return this.periodMs;
    this.periodMs = this.periodMs === 0 ? delta : this.periodMs * 0.8 + delta * 0.2;
    return this.periodMs;
  }

  reset(): void {
    this.periodMs = 0;
    this.lastAt = 0;
  }

  get period(): number {
    return this.periodMs;
  }
}

/**
 * Is this frame due now, or would waiting for the next animation frame still be on time?
 *
 * `dueAt` of 0 means "nothing has been drawn yet", which is always due.
 */
export function frameIsDue(now: number, dueAt: number, displayPeriodMs: number): boolean {
  return now + displayPeriodMs / 2 >= dueAt;
}

/** The next due time after drawing at `now`, without letting a backlog accumulate. */
export function nextDueAt(now: number, dueAt: number, intervalMs: number): number {
  return Math.max(now, dueAt) + intervalMs;
}

/** Frame interval in milliseconds for a format's fps, clamped to what a compositor will run at. */
export function frameIntervalMs(fps: number): number {
  return 1000 / Math.min(60, Math.max(1, Number.isFinite(fps) && fps > 0 ? fps : 30));
}
