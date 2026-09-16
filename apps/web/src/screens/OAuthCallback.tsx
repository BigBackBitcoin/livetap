import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Card, Spinner } from '@livetap/ui';
import { PLATFORM_PROFILES } from '@livetap/adapters';
import type { PlatformId } from '@livetap/core';
import {
  completeAuth,
  missingScopes,
  readPending,
  resolveCallback,
  PKCE_SESSION_KEY,
} from '../state/oauthFlow.js';
import type { PendingAuth, CallbackOutcome } from '../state/oauthFlow.js';
import { useAppStore } from '../state/store.js';

/*
 * Re-exported so this screen stays the one place a reader looks for "what happens when the
 * platform sends the browser back", while the logic itself lives in `state/oauthFlow.ts` where
 * the desktop and mobile surfaces can reach it without importing React.
 */
export { PKCE_SESSION_KEY, readPending, resolveCallback };
export type { PendingAuth, CallbackOutcome };

type Status =
  | { kind: 'working' }
  | { kind: 'unconfigured' }
  | { kind: 'failed'; what: string; why: string; youCan: string }
  | { kind: 'done'; platform: PlatformId; label: string; avatarUrl?: string; partial?: string };

/**
 * The last step of a sign-in, and the first moment the creator sees their own name.
 *
 * What this used to do: POST the code to the broker, check `response.ok`, drop the token set on
 * the floor, and render "You are signed in. LIVETAP can now go live on youtube for you." Nothing
 * was stored, no destination was created, and the claim was false in every particular. What it
 * does now is exchange the code, store the token where that surface stores tokens, create the
 * destination, let the adapter ask the platform who this is, and only then say anything.
 */
export function OAuthCallback(): ReactElement {
  const [status, setStatus] = useState<Status>({ kind: 'working' });
  const connectPlatform = useAppStore((s) => s.connectPlatform);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const storage = typeof sessionStorage === 'undefined' ? null : sessionStorage;
      const pending = readPending(storage);

      // Nobody started a sign-in from this browser and nothing came back with a code: this is
      // someone opening the callback URL directly, which on a demo deployment is the normal
      // case because there is no platform client configured to sign in with.
      const hasCode = new URLSearchParams(window.location.search).has('code');
      if (!pending && !hasCode) {
        if (!cancelled) setStatus({ kind: 'unconfigured' });
        return;
      }

      const outcome = await completeAuth(window.location.href);
      if (cancelled) return;

      if (outcome.kind === 'denied') {
        setStatus({
          what: 'The platform did not sign you in.',
          why: outcome.reason,
          youCan: 'Try again from Destinations, or connect with a stream key instead.',
          kind: 'failed',
        });
        return;
      }
      if (outcome.kind === 'failed') {
        setStatus({ kind: 'failed', what: outcome.what, why: outcome.why, youCan: outcome.youCan });
        return;
      }
      if (outcome.kind !== 'connected') {
        setStatus({ kind: 'unconfigured' });
        return;
      }

      /*
       * The token is stored, so the destination can now be created and connected: `connect()`
       * calls the adapter's `validate()`, which asks the platform who this token belongs to and
       * comes back with the channel name and picture. That answer is what the card shows, and it
       * is why this screen waits for it rather than declaring success on the exchange alone.
       */
      /*
       * Created with the connection the SIGN-IN used, carried across the redirect in the pending
       * record. A fresh id here would address a vault entry the exchange never wrote.
       */
      const snapshot = await connectPlatform(
        outcome.platform,
        undefined,
        outcome.kind === 'connected' ? outcome.connectionId : undefined,
      );
      if (cancelled) return;

      const profile = PLATFORM_PROFILES[outcome.platform];
      const account = snapshot?.account ?? outcome.account;
      const missing = missingScopes(outcome.platform, account.scopes);
      const done: Status = {
        kind: 'done',
        platform: outcome.platform,
        label: account.accountLabel ?? profile.displayName,
      };
      if (account.avatarUrl) done.avatarUrl = account.avatarUrl;
      if (missing.length > 0) {
        /*
         * Kick's consent screen has a tick box per permission, so a creator can authorize
         * successfully and still have withheld the one permission that lets LIVETAP fetch a
         * stream key. Saying so here, in the creator's terms, is the difference between a
         * five second fix now and a failure at GO LIVE later.
         */
        done.partial = `${profile.displayName} did not give LIVETAP everything it asked for, so you may still be asked to paste a stream key.`;
      }
      setStatus(done);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [connectPlatform]);

  return (
    <div className="lt-screen lt-screen--centred">
      {status.kind === 'working' ? (
        <Card title="Finishing your sign-in">
          <p>
            <Spinner size={24} /> LIVETAP is finishing the sign-in and checking which account it
            just connected. This takes a moment.
          </p>
        </Card>
      ) : null}

      {status.kind === 'unconfigured' ? (
        <Card title="Sign-in is not set up on this deployment">
          <p>
            This build of LIVETAP has no platform sign-in configured, so there is nothing for this
            page to finish. That is expected in demo mode: every destination here is simulated.
          </p>
          <p>
            To go live for real, run LIVETAP with your own platform credentials, or connect a
            destination with a stream key.
          </p>
          <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/destinations">
            Back to destinations
          </Link>
        </Card>
      ) : null}

      {status.kind === 'failed' ? (
        <Card title={status.what}>
          <p>{status.why}</p>
          <p>LIVETAP did not connect anything, so nothing else is affected.</p>
          <p>{status.youCan}</p>
          <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/destinations">
            Back to destinations
          </Link>
        </Card>
      ) : null}

      {status.kind === 'done' ? (
        <Card title={`Connected as ${status.label}`}>
          {status.avatarUrl ? (
            <img
              className="lt-account__avatar"
              src={status.avatarUrl}
              alt=""
              width={48}
              height={48}
            />
          ) : null}
          <p>
            {`LIVETAP will go live on ${PLATFORM_PROFILES[status.platform].displayName} as ${status.label}. You will never be asked for a stream key for it.`}
          </p>
          {status.partial ? <p>{status.partial}</p> : null}
          <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/studio">
            Open Studio
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
