import { useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import { Spinner } from './Spinner.js';

export type GoLiveState = 'idle' | 'countdown' | 'starting' | 'live' | 'stopping';

export interface GoLiveButtonProps {
  state: GoLiveState;
  /** Fired when an idle button is activated. The app then sets `state="countdown"`. */
  onGoLive?: () => void;
  /** Fired when the countdown is aborted — by the button, or by Escape. */
  onCancel?: () => void;
  /** Fired when the countdown reaches zero. Nothing is sent to a platform before this. */
  onCountdownComplete?: () => void;
  /** Fired when a live button is activated. */
  onEnd?: () => void;
  /** Elapsed broadcast time, used by the `live` and `stopping` states. */
  elapsedMs?: number;
  /** Countdown length. 3 by design; configurable for tests and for accessibility settings. */
  countdownSeconds?: number;
  /**
   * No destination is ready. Rendered as `aria-disabled` rather than `disabled` so
   * the control stays focusable and can explain itself.
   */
  disabled?: boolean;
  /** Why it is disabled, e.g. "Connect a destination first". Announced, not shown. */
  disabledReason?: string;
  className?: string;
}

/** `mm:ss` under an hour, `h:mm:ss` over it. Never `00:mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The one dominant action in Studio.
 *
 * There is no confirmation dialog. When at least one destination is READY, GO LIVE
 * starts a 3-second countdown *in the button itself*; activating it again, or
 * pressing Escape, cancels. Nothing reaches a platform until the countdown ends.
 * A modal asking "are you sure?" would be one more thing to dismiss at the exact
 * moment the user is least able to read.
 *
 * Live shows the elapsed time in tabular numerals beside the word END, so the
 * timer never changes the button's width.
 */
export function GoLiveButton({
  state,
  onGoLive,
  onCancel,
  onCountdownComplete,
  onEnd,
  elapsedMs = 0,
  countdownSeconds = 3,
  disabled = false,
  disabledReason,
  className,
}: GoLiveButtonProps): ReactElement {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const reasonId = useId();

  // Tick the countdown.
  useEffect(() => {
    if (state !== 'countdown') {
      setRemaining(countdownSeconds);
      return;
    }
    const id = setInterval(() => {
      setRemaining((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [state, countdownSeconds]);

  // Reaching zero is what actually starts the broadcast.
  useEffect(() => {
    if (state === 'countdown' && remaining <= 0) onCountdownComplete?.();
  }, [state, remaining, onCountdownComplete]);

  // Escape aborts the countdown. It never ends a live stream.
  useEffect(() => {
    if (state !== 'countdown') return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state, onCancel]);

  const shown = Math.max(1, remaining);
  const busy = state === 'starting' || state === 'stopping';

  const classes = ['lt-golive', `lt-golive--${state}`, 'lt-touch', className]
    .filter(Boolean)
    .join(' ');

  const handleClick = (): void => {
    if (disabled) return;
    switch (state) {
      case 'idle':
        onGoLive?.();
        break;
      case 'countdown':
        onCancel?.();
        break;
      case 'live':
        onEnd?.();
        break;
      default:
        break;
    }
  };

  const ariaLabel = ((): string => {
    switch (state) {
      case 'countdown':
        return `Going live in ${shown} ${shown === 1 ? 'second' : 'seconds'}. Activate to cancel.`;
      case 'starting':
        return 'Starting your broadcast';
      case 'live':
        return `End broadcast. Live for ${formatElapsed(elapsedMs)}.`;
      case 'stopping':
        return 'Ending your broadcast';
      default:
        return 'Go live';
    }
  })();

  return (
    <>
      <button
        type="button"
        className={classes}
        aria-label={ariaLabel}
        aria-disabled={disabled || busy || undefined}
        aria-busy={busy || undefined}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
        onClick={handleClick}
      >
        {state === 'idle' ? <span className="lt-golive__label">GO LIVE</span> : null}

        {state === 'countdown' ? (
          <>
            <span className="lt-golive__count lt-num" aria-hidden="true">
              {shown}
            </span>
            <span className="lt-golive__cancel">Cancel</span>
          </>
        ) : null}

        {state === 'starting' ? (
          <>
            <Spinner size={24} />
            <span className="lt-golive__label">Starting…</span>
          </>
        ) : null}

        {state === 'live' ? (
          <>
            <span className="lt-golive__label">END</span>
            <span className="lt-golive__timer lt-num">{formatElapsed(elapsedMs)}</span>
          </>
        ) : null}

        {state === 'stopping' ? (
          <>
            <Spinner size={24} />
            <span className="lt-golive__label">Ending…</span>
          </>
        ) : null}
      </button>
      {disabled && disabledReason ? (
        <span className="lt-sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}
