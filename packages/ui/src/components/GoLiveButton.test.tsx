import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, pressKey, render, text } from '../testing/render.js';
import { GoLiveButton, formatElapsed } from './GoLiveButton.js';

describe('formatElapsed', () => {
  it('uses mm:ss under an hour and h:mm:ss over it', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(9_000)).toBe('00:09');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5)).toBe('00:00');
  });
});

describe('GoLiveButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the app to start a countdown when idle', () => {
    const onGoLive = vi.fn();
    const { container, unmount } = render(<GoLiveButton state="idle" onGoLive={onGoLive} />);
    const button = container.querySelector('button');
    expect(text(button)).toBe('GO LIVE');
    click(button);
    expect(onGoLive).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('counts 3 -> 2 -> 1 and only then reports completion', () => {
    const onCountdownComplete = vi.fn();
    const { container, unmount } = render(
      <GoLiveButton state="countdown" onCountdownComplete={onCountdownComplete} />,
    );
    const count = (): string => text(container.querySelector('.lt-golive__count'));

    expect(count()).toBe('3');
    expect(onCountdownComplete).not.toHaveBeenCalled();

    flush(() => void vi.advanceTimersByTime(1000));
    expect(count()).toBe('2');
    expect(onCountdownComplete).not.toHaveBeenCalled();

    flush(() => void vi.advanceTimersByTime(1000));
    expect(count()).toBe('1');
    expect(onCountdownComplete).not.toHaveBeenCalled();

    flush(() => void vi.advanceTimersByTime(1000));
    expect(onCountdownComplete).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('offers a Cancel affordance, and activating it aborts before anything is sent', () => {
    const onCancel = vi.fn();
    const onCountdownComplete = vi.fn();
    const mounted = render(
      <GoLiveButton state="countdown" onCancel={onCancel} onCountdownComplete={onCountdownComplete} />,
    );
    expect(text(mounted.container.querySelector('.lt-golive__cancel'))).toBe('Cancel');

    flush(() => void vi.advanceTimersByTime(1000));
    click(mounted.container.querySelector('button'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // The app responds by returning to idle; the countdown must not fire afterwards.
    mounted.rerender(
      <GoLiveButton state="idle" onCancel={onCancel} onCountdownComplete={onCountdownComplete} />,
    );
    flush(() => void vi.advanceTimersByTime(10_000));
    expect(onCountdownComplete).not.toHaveBeenCalled();
    expect(text(mounted.container.querySelector('button'))).toBe('GO LIVE');
    mounted.unmount();
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    const { unmount } = render(<GoLiveButton state="countdown" onCancel={onCancel} />);
    pressKey('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('restarts the countdown from 3 on the next attempt', () => {
    const mounted = render(<GoLiveButton state="countdown" />);
    flush(() => void vi.advanceTimersByTime(1000));
    expect(text(mounted.container.querySelector('.lt-golive__count'))).toBe('2');

    mounted.rerender(<GoLiveButton state="idle" />);
    mounted.rerender(<GoLiveButton state="countdown" />);
    expect(text(mounted.container.querySelector('.lt-golive__count'))).toBe('3');
    mounted.unmount();
  });

  it('shows END plus the elapsed timer when live, and ends on activation', () => {
    const onEnd = vi.fn();
    const { container, unmount } = render(
      <GoLiveButton state="live" elapsedMs={125_000} onEnd={onEnd} />,
    );
    const button = container.querySelector('button');
    expect(text(container.querySelector('.lt-golive__label'))).toBe('END');
    expect(text(container.querySelector('.lt-golive__timer'))).toBe('02:05');
    expect(button?.getAttribute('aria-label')).toContain('02:05');
    click(button);
    expect(onEnd).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('marks starting and stopping as busy and swallows clicks', () => {
    const onEnd = vi.fn();
    const onGoLive = vi.fn();
    for (const state of ['starting', 'stopping'] as const) {
      const { container, unmount } = render(
        <GoLiveButton state={state} onEnd={onEnd} onGoLive={onGoLive} />,
      );
      const button = container.querySelector('button');
      expect(button?.getAttribute('aria-busy'), state).toBe('true');
      click(button);
      unmount();
    }
    expect(onEnd).not.toHaveBeenCalled();
    expect(onGoLive).not.toHaveBeenCalled();
  });

  it('stays focusable while disabled and explains why', () => {
    const onGoLive = vi.fn();
    const { container, unmount } = render(
      <GoLiveButton state="idle" disabled disabledReason="Connect a destination first" onGoLive={onGoLive} />,
    );
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.hasAttribute('disabled')).toBe(false);
    const describedBy = button?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const reason = container.querySelector('.lt-sr-only');
    expect(reason?.id).toBe(describedBy);
    expect(text(reason)).toBe('Connect a destination first');
    click(button);
    expect(onGoLive).not.toHaveBeenCalled();
    unmount();
  });
});

/**
 * A double-tap must not cancel the stream it just started.
 *
 * GO LIVE turns into Cancel in the same pixels, which is the right design — the way out is where
 * the way in was. It also means an anxious first-timer who taps twice cancels their own broadcast:
 * measured at 150 ms, `elementFromPoint` at that pixel already returns the cancel label, the second
 * tap lands on it, and ten seconds later everything is back to Ready with nothing on the page
 * saying why. Found by a first-time-creator audit doing what first-time creators do.
 */
describe('the double-tap that cancelled the stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores a second tap that arrives too fast to have been aimed at Cancel', () => {
    const onCancel = vi.fn();
    const { container, unmount } = render(
      <GoLiveButton state="countdown" countdownSeconds={5} onCancel={onCancel} />,
    );
    const button = container.querySelector('button');

    vi.advanceTimersByTime(150);
    click(button);
    expect(onCancel).not.toHaveBeenCalled();

    unmount();
  });

  it('still cancels on a deliberate tap a moment later', () => {
    const onCancel = vi.fn();
    const { container, unmount } = render(
      <GoLiveButton state="countdown" countdownSeconds={5} onCancel={onCancel} />,
    );
    const button = container.querySelector('button');

    // Inside act, so the settle timer's setState is applied before the click reads it.
    flush(() => vi.advanceTimersByTime(900));
    click(button);
    expect(onCancel).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('never delays Escape, which is the unambiguous way out', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <GoLiveButton state="countdown" countdownSeconds={5} onCancel={onCancel} />,
    );

    vi.advanceTimersByTime(50);
    pressKey('Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);

    unmount();
  });
});
