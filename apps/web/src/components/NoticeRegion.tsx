import type { ReactElement } from 'react';
import { useAppStore } from '../state/store.js';

/**
 * The two live regions for the whole application (DESIGN_SYSTEM §10.1 rule 6).
 *
 * A destination reaching FAILED and going offline are assertive, because a sighted user
 * notices them instantly and a screen-reader user must too. Everything else is polite.
 * The regions are always mounted and always empty-or-one-sentence: a live region that is
 * added to the DOM at the moment it has something to say is a live region that says nothing.
 */
export function NoticeRegion(): ReactElement {
  const notices = useAppStore((s) => s.notices);
  const production = useAppStore((s) => s.production);

  const assertive = notices.filter((n) => n.level === 'error').at(-1);
  const polite = notices.filter((n) => n.level !== 'error').at(-1);

  const liveLine =
    production.state === 'LIVE'
      ? `You are live on ${production.liveCount} ${production.liveCount === 1 ? 'destination' : 'destinations'}.`
      : '';

  return (
    <>
      <div className="lt-sr-only" role="alert" aria-live="assertive">
        {assertive?.message ?? liveLine}
      </div>
      <div className="lt-sr-only" role="status" aria-live="polite">
        {polite?.message ?? ''}
      </div>
    </>
  );
}
