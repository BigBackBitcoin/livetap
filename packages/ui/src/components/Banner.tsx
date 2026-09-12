import type { ReactElement, ReactNode } from 'react';
import { AlertIcon, GlobeIcon, XIcon } from './Icons.js';
import { IconButton } from './IconButton.js';

export type BannerTone = 'info' | 'warning';

export interface BannerProps {
  tone?: BannerTone;
  /** Short bold lead, e.g. "Mock mode". */
  title?: string;
  children: ReactNode;
  /** Replace the default tone icon. */
  icon?: ReactNode;
  /** Trailing action, e.g. a "Learn more" link or "Switch to real accounts" button. */
  action?: ReactNode;
  /**
   * Dismiss handler. Omit to make the banner permanent — the mock-mode banner is
   * never dismissible while a mock destination is enabled.
   */
  onDismiss?: () => void;
  className?: string;
}

/**
 * A persistent, inline notice. Not a toast: banners do not disappear on their own.
 *
 * The canonical use is mock mode, where the banner is the product's promise that it
 * will never pretend a fake destination is real.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  icon,
  action,
  onDismiss,
  className,
}: BannerProps): ReactElement {
  const classes = ['lt-banner', `lt-banner--${tone}`, className].filter(Boolean).join(' ');
  const defaultIcon = tone === 'warning' ? <AlertIcon size={20} /> : <GlobeIcon size={20} />;
  return (
    <div className={classes} role={tone === 'warning' ? 'alert' : 'status'}>
      {icon ?? defaultIcon}
      <div className="lt-banner__body">
        {title ? <strong className="lt-banner__title">{title}</strong> : null}
        {children}
      </div>
      {action}
      {onDismiss ? (
        <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
          <XIcon size={20} />
        </IconButton>
      ) : null}
    </div>
  );
}
