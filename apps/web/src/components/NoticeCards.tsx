import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { Banner, ErrorCard } from '@livetap/ui';
import type { ErrorCardAction } from '@livetap/ui';
import type { DestinationSnapshot, HumaneError } from '@livetap/core';
import { useAppStore } from '../state/store.js';

/**
 * Every user-facing failure in LIVETAP is one `HumaneError` rendered by one component
 * (PRODUCT_SPEC §4.1): WHAT, WHY, what LIVETAP IS DOING, what YOU CAN do, and exactly one
 * primary action. Never a modal — a modal over a live preview is a lost stream.
 *
 * The primary action is chosen from `error.code`, which is itself never rendered.
 */
export function NoticeCards(): ReactElement | null {
  const notices = useAppStore((s) => s.notices);
  const mode = useAppStore((s) => s.mode);
  const dismiss = useAppStore((s) => s.dismissNotice);

  const production = notices.filter((n) => n.destinationId === undefined && n.error);
  /*
   * A production notice without a HumaneError used to render nowhere at all: `NoticeCards`
   * required `error`, and the only other consumer is a screen-reader-only live region. So a
   * sighted user was told nothing. Anything addressed to the whole production gets a Banner.
   */
  const plain = notices.filter((n) => n.destinationId === undefined && !n.error);
  if (production.length === 0 && plain.length === 0) return null;

  return (
    <div className="lt-noticecards">
      {production.map((notice) => (
        <Card
          key={notice.id}
          error={notice.error as HumaneError}
          pro={mode === 'pro'}
          tone={notice.level === 'error' ? 'danger' : 'warning'}
          onDismiss={() => dismiss(notice.id)}
        />
      ))}
      {plain.map((notice) => (
        <Banner
          key={notice.id}
          tone={notice.level === 'info' ? 'info' : 'warning'}
          action={
            <button type="button" className="lt-textlink" onClick={() => dismiss(notice.id)}>
              Hide this message
            </button>
          }
        >
          {notice.message}
        </Banner>
      ))}
    </div>
  );
}

/**
 * Hold a value steady for as long as a finger or a pointer is down on the thing showing it.
 *
 * This is the fix for the worst interaction defect an auditor found in this product: pressing
 * "Stop this destination" inside a recovery card fired the control underneath it instead. The
 * mechanism is ordinary and it is why it is so easy to ship: a card that renders from a live
 * condition disappears the instant the machine fixes that condition, and if it disappears
 * between pointerdown and pointerup the click event has no common target left except an
 * ancestor, so it lands on whatever has reflowed into that spot. When the thing that reflows
 * into that spot is a live control, the user has pressed something they never aimed at.
 *
 * Freezing the rendered value for the ~150 ms of a press is honest: the condition is restated a
 * moment later, and the action the creator pressed is the action that runs. Release is deferred
 * by one macrotask because `click` is dispatched after `pointerup` in the same turn, and
 * releasing synchronously would put the unmount back in front of the click.
 */
export function useSteadyWhilePressed<T>(value: T): {
  steady: T;
  onPointerDown: (event: ReactPointerEvent) => void;
} {
  const [pressed, setPressed] = useState(false);
  const frozen = useRef(value);
  if (!pressed) frozen.current = value;

  useEffect(() => {
    if (!pressed) return undefined;
    const release = (): void => {
      window.setTimeout(() => setPressed(false), 0);
    };
    const cancel = (): void => setPressed(false);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', cancel);
    };
  }, [pressed]);

  return {
    steady: pressed ? frozen.current : value,
    onPointerDown: () => setPressed(true),
  };
}

/**
 * One destination's card.
 *
 * The source of truth is the destination's own snapshot, not a notice feed — so a card is on
 * screen for exactly as long as the condition is, and it disappears by itself when the machine
 * fixes the problem (tenet 7).
 */
export function DestinationErrorCard({
  snapshot,
}: {
  snapshot: DestinationSnapshot;
}): ReactElement | null {
  const mode = useAppStore((s) => s.mode);
  const retry = useAppStore((s) => s.retry);
  const reconnect = useAppStore((s) => s.reconnect);
  const remove = useAppStore((s) => s.removeDestination);
  const stopOne = useAppStore((s) => s.stopOne);

  const error = snapshot.error;
  if (!error) return null;
  const warning =
    snapshot.state === 'RECONNECTING' || snapshot.state === 'DEGRADED' || snapshot.state === 'LIVE';

  const plan = primaryFor(error.code);
  const id = snapshot.config.id;
  const action: ErrorCardAction = {
    label: plan.label,
    onClick: () => {
      if (plan.kind === 'retry') void retry(id);
      else if (plan.kind === 'reconnect') void reconnect(id);
      else if (plan.kind === 'remove') void remove(id);
    },
  };

  /*
   * PRODUCT_SPEC §4.1: `INGEST_DISCONNECTED`'s primary action is deliberately the thing already
   * happening ("Keep trying"), and the *only* other affordance the card is allowed is one footer
   * text link — "Stop trying". Without it the card offered no way out of a reconnect loop at all:
   * the one button confirmed the machine's behaviour and there was nothing that stopped it.
   */
  const canStopTrying = stopTryingApplies(snapshot.state, error.code);

  return (
    <div className="lt-noticecards">
      <Card error={error} pro={mode === 'pro'} tone={warning ? 'warning' : 'danger'} action={action}>
        {canStopTrying ? (
          <p className="lt-errorcard__foot">
            <button type="button" className="lt-textlink" onClick={() => void stopOne(id)}>
              Stop trying
            </button>
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/**
 * "Stop trying" is offered exactly where stopping is the alternative to waiting: a destination
 * LIVETAP is currently reconnecting, or a lost-connection card. It is never offered on a card
 * whose condition the user cannot end by giving up on that destination.
 */
export function stopTryingApplies(state: DestinationSnapshot['state'], code: string): boolean {
  const reconnecting = state === 'RECONNECTING';
  const lostConnection =
    code === 'INGEST_DISCONNECTED' || code === 'INGEST_TIMEOUT' || code === 'INGEST_REFUSED';
  return reconnecting || lostConnection;
}

function Card({
  error,
  pro,
  tone,
  action,
  onDismiss,
  children,
}: {
  error: HumaneError;
  pro: boolean;
  tone: 'danger' | 'warning';
  action?: ErrorCardAction;
  onDismiss?: () => void;
  /** Footer text links only (§4.1): never a second button. */
  children?: ReactNode;
}): ReactElement {
  const plan = primaryFor(error.code);
  return (
    <ErrorCard
      error={error}
      action={action ?? { label: plan.label, onClick: () => onDismiss?.() }}
      showTechnical={pro}
      tone={tone}
    >
      {children}
      {/*
        Dismissal hides the card, never the condition: the chip keeps its real state and the
        card comes back on the next state change. Cards for unrecoverable errors cannot be
        dismissed at all (PRODUCT_SPEC §4.1).
      */}
      {onDismiss && error.recoverable ? (
        <button type="button" className="lt-textlink" onClick={onDismiss}>
          Hide this message
        </button>
      ) : null}
    </ErrorCard>
  );
}

type PrimaryKind = 'retry' | 'reconnect' | 'remove' | 'acknowledge';

/** PRODUCT_SPEC §4.1 — `code` chooses the one button's label, and is never displayed. */
export function primaryFor(code: string): { label: string; kind: PrimaryKind } {
  switch (code) {
    case 'AUTH_EXPIRED':
    case 'AUTH_REVOKED':
    case 'AUTH_MISSING_SCOPE':
    case 'AUTH_FAILED':
      return { label: 'Sign in again', kind: 'reconnect' };
    case 'INGEST_INVALID_KEY':
    case 'CONFIG_INVALID':
      return { label: 'Paste a new key', kind: 'reconnect' };
    case 'INGEST_DISCONNECTED':
    case 'INGEST_TIMEOUT':
    case 'INGEST_REFUSED':
      return { label: 'Keep trying', kind: 'retry' };
    case 'NETWORK_DEGRADED':
      return { label: 'Keep the lower quality', kind: 'acknowledge' };
    case 'ENCODER_OVERLOADED':
    case 'ENCODER_FAILED':
      return { label: 'Lower quality now', kind: 'acknowledge' };
    case 'CAMERA_LOST':
      return { label: 'Choose a camera', kind: 'acknowledge' };
    case 'MIC_LOST':
      return { label: 'Choose a microphone', kind: 'acknowledge' };
    case 'SCREEN_DENIED':
      return { label: 'Try again', kind: 'acknowledge' };
    case 'NOT_ELIGIBLE':
      return { label: 'Remove this destination', kind: 'remove' };
    case 'RATE_LIMITED':
      return { label: 'Got it', kind: 'acknowledge' };
    default:
      return { label: 'Try again', kind: 'retry' };
  }
}
