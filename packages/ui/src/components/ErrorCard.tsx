import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { HumaneError } from '@livetap/core';
import { AlertIcon } from './Icons.js';
import { Button } from './Button.js';

export interface ErrorCardAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
}

export interface ErrorCardProps {
  error: HumaneError;
  /**
   * The one primary action. Exactly one — a card with three equal buttons is a
   * card that has not decided what the user should do.
   */
  action?: ErrorCardAction;
  /** At most one secondary action, rendered as a ghost button. */
  secondaryAction?: ErrorCardAction;
  /**
   * Show `error.technical` behind a disclosure. Pro mode only: a Simple-mode user
   * must never meet a protocol string.
   */
  showTechnical?: boolean;
  /** Amber presentation for recoverable, non-fatal conditions. */
  tone?: 'danger' | 'warning';
  /** Extra content below YOU CAN, e.g. a link to the destination's settings. */
  children?: ReactNode;
  className?: string;
}

/**
 * The humane error card: WHAT happened, WHY, what LIVETAP IS DOING, what YOU CAN do.
 *
 * Four fields, always all four, in that order, plus one button. This is the entire
 * error vocabulary of the product — there is no `alert()`, no raw code, and no
 * "Something went wrong". See PRODUCT_SPEC.md §4.1 for the worked copy per
 * `ErrorCode`.
 */
export function ErrorCard({
  error,
  action,
  secondaryAction,
  showTechnical = false,
  tone = 'danger',
  children,
  className,
}: ErrorCardProps): ReactElement {
  /*
   * The heading id is per instance, not per error code. Two destinations failing the same way
   * produced two elements with the same `id`, so both cards' `aria-labelledby` resolved to the
   * first one and a screen reader read the wrong destination's headline on the second card.
   */
  const headingId = useId();
  const classes = [
    'lt-errorcard',
    tone === 'warning' ? 'lt-errorcard--warning' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={classes} role="alert" aria-labelledby={headingId}>
      <div className="lt-errorcard__head">
        <AlertIcon size={24} className="lt-errorcard__icon" />
        <h3 className="lt-errorcard__what" id={headingId}>
          {error.what}
        </h3>
      </div>

      <dl className="lt-errorcard__list">
        <dt className="lt-errorcard__term">Why</dt>
        <dd className="lt-errorcard__desc">{error.why}</dd>

        <dt className="lt-errorcard__term">Doing</dt>
        <dd className="lt-errorcard__desc">{error.doing}</dd>

        <dt className="lt-errorcard__term">You can</dt>
        <dd className="lt-errorcard__desc">{error.youCan}</dd>
      </dl>

      {children}

      {action || secondaryAction ? (
        <div className="lt-errorcard__actions">
          {action ? (
            <Button
              variant={tone === 'warning' ? 'primary' : 'danger'}
              onClick={action.onClick}
              loading={action.loading}
            >
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              variant="ghost"
              onClick={secondaryAction.onClick}
              loading={secondaryAction.loading}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showTechnical && error.technical ? (
        <details className="lt-errorcard__tech">
          <summary>Technical detail</summary>
          <pre>
            {error.code}
            {'\n'}
            {error.technical}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
