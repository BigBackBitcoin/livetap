import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Card, Spinner } from '@livetap/ui';
import { parseCallback } from '@livetap/adapters';
import type { PlatformId } from '@livetap/core';

/** Where the PKCE verifier and the state live between opening the platform's page and coming back. */
export const PKCE_SESSION_KEY = 'livetap.oauth.pending';

export interface PendingAuth {
  platform: PlatformId;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
}

export type CallbackOutcome =
  | { kind: 'ok'; platform: PlatformId; code: string; codeVerifier?: string; redirectUri: string }
  | { kind: 'denied'; reason: string }
  | { kind: 'mismatch' }
  | { kind: 'missing' };

/**
 * Resolve a callback URL against the request we started.
 *
 * The `state` check is not a formality: without it, anyone who can make the user's browser open
 * this URL can trade an attacker's authorization code for a token bound to the user's session.
 * A mismatched or absent state is refused outright — never "tried anyway".
 */
export function resolveCallback(url: string, pending: PendingAuth | null): CallbackOutcome {
  const parsed = parseCallback(url);
  if (parsed.error) {
    return { kind: 'denied', reason: parsed.errorDescription ?? parsed.error };
  }
  if (!pending) return { kind: 'missing' };
  if (!parsed.state || parsed.state !== pending.state) return { kind: 'mismatch' };
  if (!parsed.code) return { kind: 'missing' };
  const outcome: CallbackOutcome = {
    kind: 'ok',
    platform: pending.platform,
    code: parsed.code,
    redirectUri: pending.redirectUri,
  };
  if (pending.codeVerifier) outcome.codeVerifier = pending.codeVerifier;
  return outcome;
}

export function readPending(storage: Pick<Storage, 'getItem' | 'removeItem'> | null): PendingAuth | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PKCE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAuth;
    return typeof parsed?.state === 'string' && typeof parsed?.platform === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

type Status =
  | { kind: 'working' }
  | { kind: 'unconfigured' }
  | { kind: 'failed'; what: string; why: string; youCan: string }
  | { kind: 'done'; platform: PlatformId };

export function OAuthCallback(): ReactElement {
  const [status, setStatus] = useState<Status>({ kind: 'working' });

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

      const outcome = resolveCallback(window.location.href, pending);
      if (outcome.kind === 'mismatch') {
        if (!cancelled) {
          setStatus({
            kind: 'failed',
            what: 'LIVETAP did not finish signing you in.',
            why: 'The reply did not match the sign-in this device started, so it was refused.',
            youCan: 'Start the sign-in again from Destinations.',
          });
        }
        return;
      }
      if (outcome.kind === 'denied') {
        if (!cancelled) {
          setStatus({
            kind: 'failed',
            what: 'The platform did not sign you in.',
            why: outcome.reason,
            youCan: 'Try again from Destinations, or connect with a stream key instead.',
          });
        }
        return;
      }
      if (outcome.kind === 'missing') {
        if (!cancelled) {
          setStatus({
            kind: 'failed',
            what: 'LIVETAP did not finish signing you in.',
            why: 'The reply from the platform had no sign-in code in it.',
            youCan: 'Start the sign-in again from Destinations.',
          });
        }
        return;
      }

      storage?.removeItem(PKCE_SESSION_KEY);
      try {
        const body: Record<string, string> = {
          platform: outcome.platform,
          code: outcome.code,
          redirectUri: outcome.redirectUri,
        };
        if (outcome.codeVerifier) body.codeVerifier = outcome.codeVerifier;
        const response = await fetch('/api/oauth/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          if (!cancelled) setStatus({ kind: 'unconfigured' });
          return;
        }
        if (!cancelled) setStatus({ kind: 'done', platform: outcome.platform });
      } catch {
        if (!cancelled) setStatus({ kind: 'unconfigured' });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="lt-screen lt-screen--centred">
      {status.kind === 'working' ? (
        <Card title="Finishing your sign-in">
          <p>
            <Spinner size={24} /> LIVETAP is exchanging the reply from the platform for a key it can
            stream with. This takes a moment.
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
        <Card title="You are signed in">
          <p>{`LIVETAP can now go live on ${status.platform} for you.`}</p>
          <Link className="lt-btn lt-btn--primary lt-btn--md" to="/app/studio">
            Open Studio
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
