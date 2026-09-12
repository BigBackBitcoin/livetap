import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { MultistreamDiagram } from '../components/MultistreamDiagram.js';

/**
 * The marketing page.
 *
 * It is deliberately the only screen imported eagerly, and it imports nothing from
 * `@livetap/core`, `@livetap/adapters` or `@livetap/media` — a visitor who reads this page and
 * leaves never downloads the orchestrator, the adapters or the media engine. The one thing it
 * borrows from the design system is the stylesheet.
 *
 * It never shows a dashboard screenshot with invented metrics, never claims a platform
 * capability the product does not have, and has no cookie banner because it sets no cookies.
 */
export function Landing(): ReactElement {
  return (
    <div className="lt-landing">
      <a className="lt-skip-link" href="#lt-get">
        Skip to download
      </a>

      <header className="lt-landing__bar">
        <Link to="/" className="lt-landing__brand" aria-label="LIVETAP home">
          <Mark />
          <span className="lt-landing__wordmark">LIVETAP</span>
        </Link>
        <nav aria-label="Sections">
          <a href="#lt-how">How it works</a>
          <a href="#lt-open">Open source</a>
          <Link className="lt-btn lt-btn--live lt-btn--md" to="/app">
            Open LIVETAP
          </Link>
        </nav>
      </header>

      <section className="lt-hero" aria-labelledby="lt-hero-heading">
        <img
          className="lt-hero__plate"
          src="/brand/hero-a.webp"
          alt=""
          width={1536}
          height={864}
          loading="eager"
          decoding="async"
        />
        <div className="lt-hero__copy">
          <h1 id="lt-hero-heading">
            Connect your accounts.
            <br />
            Pick where you want to go live.
            <br />
            Tap GO LIVE.
          </h1>
          <p className="lt-hero__sub">
            That is the whole product. LIVETAP is the easiest way to go live — not a prettier
            version of broadcasting software, but a shorter road to being on air.
          </p>
          <div className="lt-hero__actions">
            <Link className="lt-btn lt-btn--live lt-btn--lg" to="/app">
              Open LIVETAP
            </Link>
            <a className="lt-textlink" href="#lt-get">
              Desktop and mobile
            </a>
          </div>
          <p className="lt-hero__note">Free. Open source. No account needed.</p>
        </div>
      </section>

      <section className="lt-section" aria-labelledby="lt-what">
        <h2 id="lt-what">What LIVETAP is</h2>
        <div className="lt-cols">
          <article>
            <h3>One app</h3>
            <p>
              Camera, screen, microphone, overlays and recording in one place. Nothing to install
              on top of it, and no plugin to keep alive between updates.
            </p>
          </article>
          <article>
            <h3>Every destination</h3>
            <p>
              Go live on several places at the same time. LIVETAP makes the picture once and opens
              a separate connection to each one, so they cannot take each other down.
            </p>
          </article>
          <article>
            <h3>Yours</h3>
            <p>
              Free forever, open source, and it runs on your machine. Your stream never passes
              through our servers, because we do not have any in the path.
            </p>
          </article>
        </div>
      </section>

      <section className="lt-section" aria-labelledby="lt-why">
        <h2 id="lt-why">Why it is easier</h2>
        <div className="lt-pairs">
          <article>
            <h3>Nothing to configure</h3>
            <p>
              LIVETAP measures your connection and your computer, picks the settings, and keeps
              adjusting while you stream. You will never meet a quality field unless you go looking
              for one.
            </p>
          </article>
          <article>
            <h3>Six Moments, not a tree of panels</h3>
            <p>
              Starting Soon, Main Camera, Screen Share, Guest, Break, Ending. Tap one to change what
              viewers see. There is one thing to name and one thing to switch.
            </p>
          </article>
          <article>
            <h3>Errors that tell you what to do</h3>
            <p>
              When something breaks, LIVETAP says what happened, why, what it is already doing about
              it, and the one thing you can do. No codes, no log files to upload to a second website.
            </p>
          </article>
          <article>
            <h3>It tells you the truth about each platform</h3>
            <p>
              Some platforms let an app go live for you. Some only accept a key you paste. One does
              not allow third-party apps at all. LIVETAP says which before you spend an hour finding
              out, and never pretends to a capability it does not have.
            </p>
          </article>
          <article>
            <h3>One destination failing is one destination&rsquo;s problem</h3>
            <p>
              Each place you send to has its own connection, its own state and its own reconnect. A
              platform having a bad night does not end your show everywhere else.
            </p>
          </article>
          <article>
            <h3>Nothing is paywalled</h3>
            <p>
              Streaming to several places at once, 1080p, unlimited destinations and unlimited
              recording are all in the free app. There is no paid tier to find.
            </p>
          </article>
        </div>
      </section>

      <section className="lt-section" aria-labelledby="lt-how-heading" id="lt-how">
        <h2 id="lt-how-heading">How going live in several places at once works</h2>
        <p className="lt-section__lede">
          Your camera and screen go into LIVETAP. LIVETAP composes your Moment and makes the picture
          once for each shape you need. Then it opens a separate connection to each destination you
          picked and sends the same show to all of them.
        </p>
        <MultistreamDiagram />
      </section>

      <section className="lt-section" aria-labelledby="lt-get-heading" id="lt-get">
        <h2 id="lt-get-heading">Get LIVETAP</h2>
        <p className="lt-section__lede">Free, no account, and no tracking by default.</p>
        <div className="lt-cols">
          <article className="lt-getcard">
            <h3>In your browser</h3>
            <p>Nothing to install. This is the build you are one tap away from right now.</p>
            <Link className="lt-btn lt-btn--live lt-btn--md" to="/app">
              Open LIVETAP
            </Link>
          </article>
          <article className="lt-getcard">
            <h3>Desktop</h3>
            <p>
              Windows, macOS and Linux builds are coming soon — they are not published yet, so there
              is nothing to download here today.
            </p>
            <a
              className="lt-btn lt-btn--secondary lt-btn--md"
              href="https://github.com/BigBackBitcoin/livetap/releases"
              rel="noreferrer noopener"
            >
              Watch for releases
            </a>
          </article>
          <article className="lt-getcard">
            <h3>Phone</h3>
            <p>
              iOS and Android are in preparation. There is no store listing yet, and we would rather
              say so than collect an email address about it.
            </p>
          </article>
        </div>
      </section>

      <section className="lt-section" aria-labelledby="lt-open-heading" id="lt-open">
        <h2 id="lt-open-heading">Why open source matters here</h2>
        <p className="lt-section__lede">
          You are about to hand a piece of software your streaming accounts. You should be able to
          read what it does with them. LIVETAP is MIT-licensed, developed in public, and its
          credential handling is documented line by line. If we ever stopped working on it, you
          would still have it — unlike the simple streaming tools that have been switched off before.
        </p>
        <ul className="lt-linklist">
          <li>
            <a href="https://github.com/BigBackBitcoin/livetap" rel="noreferrer noopener">
              Read the code
            </a>
          </li>
          <li>
            <a
              href="https://github.com/BigBackBitcoin/livetap/blob/main/SECURITY.md"
              rel="noreferrer noopener"
            >
              Security policy
            </a>
          </li>
          <li>
            <Link to="/privacy">What LIVETAP never collects</Link>
          </li>
        </ul>
      </section>

      <footer className="lt-landing__foot">
        <div className="lt-landing__brand">
          <Mark />
          <span className="lt-landing__wordmark">LIVETAP</span>
        </div>
        <nav aria-label="Footer">
          <a href="https://github.com/BigBackBitcoin/livetap" rel="noreferrer noopener">
            GitHub
          </a>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
        <p>No tracking cookies. Nothing to accept. Built in public.</p>
      </footer>
    </div>
  );
}

/**
 * The logo mark, inlined here rather than imported from `@livetap/ui` so the marketing page
 * pulls in no component code at all. Geometry is DESIGN_SYSTEM §1.2, verbatim.
 */
function Mark(): ReactElement {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="27" height="27" rx="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12.5" cy="16" r="3" fill="var(--lt-accent-live-solid)" />
      <path
        d="M15.94 20.91A6 6 0 0 0 15.94 11.09"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17.95 23.78A9.5 9.5 0 0 0 17.95 8.22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
