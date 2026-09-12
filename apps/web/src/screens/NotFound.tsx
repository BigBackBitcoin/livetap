import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function NotFound(): ReactElement {
  return (
    <div className="lt-screen lt-screen--centred">
      <h1>That page moved</h1>
      <p>The link you followed is not part of LIVETAP any more.</p>
      <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/studio">
        Go to Studio
      </Link>
    </div>
  );
}
