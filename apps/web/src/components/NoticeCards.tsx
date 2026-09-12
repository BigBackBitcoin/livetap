import type { ReactElement } from 'react';
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

  return (
    <div className="lt-noticecards">
      <Card error={error} pro={mode === 'pro'} tone={warning ? 'warning' : 'danger'} action={action} />
    </div>
  );
}

function Card({
  error,
  pro,
  tone,
  action,
  onDismiss,
}: {
  error: HumaneError;
  pro: boolean;
  tone: 'danger' | 'warning';
  action?: ErrorCardAction;
  onDismiss?: () => void;
}): ReactElement {
  const plan = primaryFor(error.code);
  return (
    <ErrorCard
      error={error}
      action={action ?? { label: plan.label, onClick: () => onDismiss?.() }}
      showTechnical={pro}
      tone={tone}
    >
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
