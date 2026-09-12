import type { ReactElement } from 'react';
import { Link } from 'react-router';

export function Terms(): ReactElement {
  return (
    <article className="lt-legal">
      <p className="lt-legal__back">
        {/* `/` is a separate document (the static marketing page), so this is a real link. */}
        <a className="lt-textlink" href="/">
          Back to LIVETAP
        </a>
      </p>
      <h1>Terms</h1>
      <p className="lt-legal__lede">
        LIVETAP is free, open-source software. You may use it, read it, change it and run your own
        copy. These terms are short because there is very little between you and the software.
      </p>

      <h2>The licence</h2>
      <p>
        LIVETAP is released under the MIT licence. The full text ships with the source at{' '}
        <a href="https://github.com/BigBackBitcoin/livetap" rel="noreferrer noopener">
          github.com/BigBackBitcoin/livetap
        </a>
        . In plain words: do what you like with it, keep the copyright notice, and it comes with no
        warranty.
      </p>

      <h2>No warranty, and what that means in practice</h2>
      <p>
        LIVETAP is provided as is. Live broadcasting depends on your device, your connection and
        each platform&rsquo;s own service, none of which LIVETAP controls. It will tell you honestly
        when something is wrong and what it is doing about it, but it cannot promise a stream will
        not drop. For anything where a failure would be costly, test first and have a fallback.
      </p>

      <h2>The platforms are not ours</h2>
      <p>
        YouTube, Twitch, Kick, Facebook, Instagram, TikTok, X and LinkedIn are independent services
        with their own terms, their own eligibility rules and their own decisions about what
        third-party software may do. Using LIVETAP does not change any of that, and LIVETAP is not
        affiliated with, endorsed by or a partner of any of them. Platform names and logos are their
        owners&rsquo; trademarks. Where a platform does not allow an app like LIVETAP to do
        something, LIVETAP says so instead of working around it.
      </p>

      <h2>Your content and your accounts</h2>
      <p>
        What you broadcast is yours and stays your responsibility, including complying with each
        platform&rsquo;s rules and the law where you are. You are responsible for keeping your own
        stream keys and sign-ins safe; LIVETAP handles them as described in{' '}
        <Link className="lt-textlink" to="/privacy">
          Privacy
        </Link>
        .
      </p>

      <h2>No accounts, no payments</h2>
      <p>
        LIVETAP has no accounts, no subscription and nothing to buy. Nobody can suspend your access
        to it, and if this project ever stopped, the copy you have would keep working.
      </p>
    </article>
  );
}
