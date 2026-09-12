import type { ReactElement } from 'react';

export type LogoVariant = 'mark' | 'full';
export type LogoSize = 20 | 24 | 32 | 40;

export interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  /** Monochrome: the live dot becomes `currentColor`. For favicon masks and print. */
  monochrome?: boolean;
  className?: string;
}

/** Stroke weight scales with the mark so it never looks heavy when small. */
const STROKE: Record<LogoSize, number> = { 20: 1.25, 24: 1.5, 32: 2, 40: 2.5 };

/** Wordmark cap size paired with each mark size. */
const WORDMARK: Record<LogoSize, string> = {
  20: 'var(--lt-text-14)',
  24: 'var(--lt-text-16)',
  32: 'var(--lt-text-22)',
  40: 'var(--lt-text-28)',
};

/**
 * The LIVETAP mark: a rounded square (the screen you tap), a live dot left of
 * centre, and two decaying ripple arcs — the tap propagating to every destination.
 *
 * Frame and ripples are `currentColor`; only the dot is red, so the red in the
 * product always means LIVE. See DESIGN_SYSTEM.md §1.2.
 */
export function Logo({
  variant = 'full',
  size = 32,
  monochrome = false,
  className,
}: LogoProps): ReactElement {
  const stroke = STROKE[size];
  const dotFill = monochrome ? 'currentColor' : 'var(--lt-accent-live-solid, #FF4D3F)';

  const mark = (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable={false}
    >
      <rect x="2.5" y="2.5" width="27" height="27" rx="8.5" stroke="currentColor" strokeWidth={stroke} />
      <circle cx="12.5" cy="16" r="3" fill={dotFill} />
      <path
        d="M15.94 20.91A6 6 0 0 0 15.94 11.09"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <path
        d="M17.95 23.78A9.5 9.5 0 0 0 17.95 8.22"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        opacity={monochrome ? 0.4 : 0.55}
      />
    </svg>
  );

  return (
    <span
      className={['lt-logo', className].filter(Boolean).join(' ')}
      role="img"
      aria-label="LIVETAP"
    >
      {mark}
      {variant === 'full' ? (
        <span className="lt-logo__wordmark" style={{ fontSize: WORDMARK[size] }} aria-hidden="true">
          LIVETAP
        </span>
      ) : null}
    </span>
  );
}
