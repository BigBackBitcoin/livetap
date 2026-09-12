import type { ReactElement } from 'react';
import { Link } from 'react-router';

/**
 * Honest, specific, and short enough to read. Everything stated here is a property of the code
 * in this repository, not a promise about intent — see `docs/legal/PRIVACY_ARCHITECTURE.md` and
 * `apps/web/src/state/secrets.ts`.
 */
export function Privacy(): ReactElement {
  return (
    <article className="lt-legal">
      <p className="lt-legal__back">
        <Link className="lt-textlink" to="/">
          Back to LIVETAP
        </Link>
      </p>
      <h1>Privacy</h1>
      <p className="lt-legal__lede">
        LIVETAP does not have an account system, does not have a server in the path of your
        stream, and does not want your data. This page says exactly what that means.
      </p>

      <h2>What LIVETAP never collects</h2>
      <ul>
        <li>No account. There is nothing to sign up for and no profile to build.</li>
        <li>No analytics, no telemetry, no session recording, no advertising identifiers.</li>
        <li>No tracking cookies. This site sets no cookies at all, which is why it never asks.</li>
        <li>
          No copy of your video or audio. Your camera and microphone go to the destinations you
          picked and to your own recording, and nowhere else.
        </li>
      </ul>

      <h2>What stays on this device</h2>
      <ul>
        <li>
          What you are making, which destinations you added, how your Moments are arranged, your
          quality and theme choices. These are kept in your browser&rsquo;s local storage under keys
          beginning <code>livetap.</code> and never leave it.
        </li>
        <li>
          Your recordings. In the browser a recording is held in memory during the stream and handed
          to you as a file when it ends.
        </li>
      </ul>

      <h2>Stream keys and sign-ins</h2>
      <p>
        A stream key is a password for your channel. In the browser, a key you paste is held in
        memory for that browser tab only — it is never written to local storage, session storage or
        a cookie, and it is gone when you reload. That costs you ten seconds of re-pasting and it
        means a script that ever manages to run on this origin has nothing to steal. The desktop
        app stores keys in your operating system&rsquo;s keychain instead, so you paste once.
      </p>
      <p>
        Once saved, a key is never displayed again anywhere in LIVETAP — not in settings, not in
        diagnostics, not in an export. Keys and sign-in tokens never appear in the session log.
      </p>
      <p>
        When you sign in to a platform, that happens on the platform&rsquo;s own page. LIVETAP never
        sees your password. If this deployment has platform credentials configured, the code the
        platform returns is exchanged for a token by this deployment&rsquo;s own server function and
        the client secret never reaches your browser.
      </p>

      <h2>Where your stream goes</h2>
      <p>
        Straight from your device to each platform you chose, over a separate connection for each
        one. There is no LIVETAP relay in the middle, which is also why one platform having a bad
        night cannot take the others down.
      </p>

      <h2>Demo mode</h2>
      <p>
        When LIVETAP runs in demo mode every destination is simulated, nothing is broadcast
        anywhere, and the banner saying so cannot be dismissed while a demo destination is switched
        on.
      </p>

      <h2>Changes and questions</h2>
      <p>
        LIVETAP is developed in public. If this page and the code ever disagree, the code is the
        truth and the disagreement is a bug — report it at{' '}
        <a href="https://github.com/BigBackBitcoin/livetap" rel="noreferrer noopener">
          github.com/BigBackBitcoin/livetap
        </a>
        .
      </p>
    </article>
  );
}
