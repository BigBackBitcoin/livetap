import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Logo } from '@livetap/ui';

/**
 * The one screen a user reaches by accident.
 *
 * It says what is true — the address does not match anything, which is not the same as "this
 * moved" — carries the wordmark so the page still looks like LIVETAP rather than a blank error,
 * and offers exactly one primary way on with the marketing site as a quiet second.
 */
export function NotFound(): ReactElement {
  return (
    <main className="lt-notfound">
      <div className="lt-screen lt-screen--centred">
        <Logo variant="full" size={24} />
        <h1>There is nothing at this address</h1>
        <p>
          The link may be mistyped, or it may point at something LIVETAP never had. Nothing is
          wrong with your account or your stream.
        </p>
        <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/studio">
          Go to Studio
        </Link>
        <p>
          {/* `/` is a separate document (the static marketing page), so this is a real link. */}
          <a className="lt-textlink" href="/">
            Or read what LIVETAP is
          </a>
        </p>
      </div>
    </main>
  );
}
