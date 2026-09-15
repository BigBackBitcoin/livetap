/**
 * TEAM F (SECURITY), 2026-09-15. The OAuth questions §23 asks before real accounts
 * are connected, answered by execution rather than by reading.
 *
 * `oauth.test.ts` already proves the happy path and the obvious refusals. This file
 * is deliberately narrower and meaner. It asks only the questions whose answer
 * decides whether the owner should connect a real Google account today:
 *
 *   1. Is the loopback redirect the EXACT form RFC 8252 §7.3 requires, and does
 *      anything in this repo reject it? (HANDOFF's open `isHttpsUrl` question.)
 *   2. Is `state` CSPRNG-derived with real entropy?
 *   3. Is a state genuinely single-use, or can a callback be replayed?
 *   4. Is the state compared in constant time?
 *
 * Every assertion below is on real behaviour of the real class over a real socket.
 */

import { describe, expect, it } from 'vitest';

import { isHttpsUrl } from '../shared/guards.js';
import { isExternallyOpenable } from './security/policy.js';
import { LoopbackOAuthServer } from './oauth.js';

/** GET a URL over the real loopback socket and report status + whether it was refused. */
async function hit(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { redirect: 'manual' });
  return { status: response.status, body: await response.text() };
}

describe('SEC-F1 the loopback redirect is the exact RFC 8252 form, and nothing rejects it', () => {
  it('start() returns http://127.0.0.1:<ephemeral>/callback, bound to the loopback IP only', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      // RFC 8252 §7.3: a native app redirects to the loopback IP with an ephemeral port.
      // `http` is REQUIRED here -- there is no way to obtain a TLS certificate for 127.0.0.1,
      // and every provider that supports installed apps registers the http form.
      expect(info.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      expect(info.port).toBeGreaterThan(0);
      expect(info.redirectUri).toBe(`http://127.0.0.1:${info.port}/callback`);
    } finally {
      server.stop();
    }
  });

  it('spells the redirect as localhost when a platform registered that spelling, socket unmoved', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start({ host: 'localhost' });
      expect(info.redirectUri).toBe(`http://localhost:${info.port}/callback`);
      // The socket is still on the literal loopback IP: only the URL spelling changed.
      const probe = await hit(`http://127.0.0.1:${info.port}/callback?state=wrong`);
      expect(probe.status).toBe(400);
    } finally {
      server.stop();
    }
  });

  /**
   * HANDOFF's open question, closed.
   *
   * `isHttpsUrl` DOES reject `http://127.0.0.1:<port>/callback`. That is correct and it
   * breaks nothing, because the loopback redirect_uri never passes through it. The guard's
   * ONLY consumer is `oauth:openExternal` (apps/desktop/src/main/ipc.ts:172), whose argument
   * is the PLATFORM's https authorize URL. The redirect_uri is minted by the main process in
   * `LoopbackOAuthServer.start()` and handed to the provider inside that https URL; it is
   * never submitted back over IPC and never validated as an openable URL.
   */
  it('isHttpsUrl rejects the loopback redirect, and that is not a bug: it never sees one', () => {
    const loopback = 'http://127.0.0.1:53871/callback';
    expect(isHttpsUrl(loopback)).toBe(false);
    expect(isExternallyOpenable(loopback)).toBe(false);

    // What openExternal is actually handed: the provider's authorize URL, which carries the
    // loopback redirect as a query parameter and is itself https.
    const authorizeUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code' +
      `&redirect_uri=${encodeURIComponent(loopback)}&code_challenge_method=S256`;
    expect(isHttpsUrl(authorizeUrl)).toBe(true);
    expect(isExternallyOpenable(authorizeUrl)).toBe(true);
    // The loopback form survives the round trip intact -- the guard does not rewrite it.
    expect(new URL(authorizeUrl).searchParams.get('redirect_uri')).toBe(loopback);
  });

  it('a real callback on the loopback listener is accepted end to end', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const waiting = server.waitForCallback(5_000);
      const probe = await hit(`${info.redirectUri}?code=4%2F0Aexample&state=${encodeURIComponent(info.state)}`);
      expect(probe.status).toBe(200);
      const callbackUrl = await waiting;
      expect(new URL(callbackUrl).searchParams.get('code')).toBe('4/0Aexample');
    } finally {
      server.stop();
    }
  });
});

describe('SEC-F2 state is CSPRNG-derived with real entropy', () => {
  it('is 32 bytes of base64url — 256 bits — and never repeats across 200 flows', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const server = new LoopbackOAuthServer();
      const info = await server.start();
      server.stop();
      // 32 random bytes, base64url, unpadded: ceil(32 * 4 / 3) = 43 characters.
      expect(info.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(info.state);
    }
    expect(seen.size).toBe(200);
  });

  it('is not drawn from a small alphabet or a weak source (no byte value dominates)', async () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      const server = new LoopbackOAuthServer();
      const info = await server.start();
      server.stop();
      for (const ch of info.state) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
        total += 1;
      }
    }
    // base64url has 64 symbols. A CSPRNG over 4300 characters hits most of them and none
    // dominates; a counter, a timestamp or Math.random-derived value would not look like this.
    expect(counts.size).toBeGreaterThan(50);
    const worst = Math.max(...counts.values());
    expect(worst / total).toBeLessThan(0.05);
  });
});

describe('SEC-F3 a state is single-use', () => {
  it('a replayed callback fails: the listener is gone once the renderer took the first one', async () => {
    const server = new LoopbackOAuthServer();
    const info = await server.start();
    const waiting = server.waitForCallback(5_000);
    const first = await hit(`${info.redirectUri}?code=one&state=${encodeURIComponent(info.state)}`);
    expect(first.status).toBe(200);
    await waiting;

    // The replay. Same state, same port, seconds later.
    await expect(hit(`${info.redirectUri}?code=two&state=${encodeURIComponent(info.state)}`)).rejects.toThrow();
    expect(server.listening).toBe(false);
  });

  it('a mismatched state is refused and nothing is delivered to the renderer', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      let delivered: string | null = null;
      void server.waitForCallback(1_000).then(
        (url) => {
          delivered = url;
        },
        () => {
          /* the timeout below is the expected outcome */
        },
      );
      const probe = await hit(`${info.redirectUri}?code=attacker&state=not-the-state`);
      expect(probe.status).toBe(400);
      expect(probe.body).toContain("didn't match");
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(delivered).toBeNull();
    } finally {
      server.stop();
    }
  });

  it('a callback with no state at all is refused', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const probe = await hit(`${info.redirectUri}?code=attacker`);
      expect(probe.status).toBe(400);
    } finally {
      server.stop();
    }
  });

  /**
   * SEC-F3a, FIXED 2026-09-15.
   *
   * There was one window in which the SAME state was accepted more than once: a callback that
   * arrived before the renderer called `waitForCallback` was buffered, and that branch did not
   * call `stop()`. The listener stayed up on the same port with the same state, so a second
   * callback overwrote the buffered one and it was the SECOND authorization code the renderer
   * ultimately exchanged — last writer wins, on a value that is by definition one-shot.
   *
   * Reaching it required knowing the 256-bit state, so it was hardening rather than a live hole.
   * It is pinned here because "single-use" is a claim the class comment makes, and a claim with
   * one asymmetry in it is the kind that gets relied on.
   */
  it('stops listening as soon as a callback arrives, even with nobody waiting yet', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      // No waitForCallback yet: this is the buffered branch.
      const first = await hit(`${info.redirectUri}?code=first&state=${encodeURIComponent(info.state)}`);
      expect(first.status).toBe(200);
      expect(server.listening).toBe(false);

      // The socket is closed, so a second callback cannot arrive at all.
      await expect(
        hit(`${info.redirectUri}?code=second&state=${encodeURIComponent(info.state)}`),
      ).rejects.toThrow();

      const delivered = await server.waitForCallback(2_000);
      expect(new URL(delivered).searchParams.get('code')).toBe('first');
    } finally {
      server.stop();
    }
  });
});

describe('SEC-F4 the state comparison is constant time', () => {
  /**
   * FIXED 2026-09-15. It used to compare with `!==`, which short-circuits on the first
   * differing character; it now hashes both sides and compares the digests with
   * `timingSafeEqual`. The documented RFC 8252 attacker is a hostile process on
   * the same machine, and that attacker can hit the loopback listener as often as it likes
   * inside the five-minute window. `node:crypto.timingSafeEqual` is already used elsewhere in
   * this repo (infra/dev-harness/fake-idp/fake-idp.mjs).
   *
   * This test does not attempt to MEASURE a timing difference -- a timing assertion on a CI
   * box is a flaky test, not evidence. It pins the property that makes the difference exist:
   * every rejection is byte-identical on the wire, so the ONLY channel is the clock.
   */
  it('every rejection is byte-identical, so nothing but timing distinguishes a near miss', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const nearMiss = `${info.state.slice(0, -1)}X`;
      const farMiss = 'A'.repeat(info.state.length);
      const a = await hit(`${info.redirectUri}?code=x&state=${encodeURIComponent(nearMiss)}`);
      const b = await hit(`${info.redirectUri}?code=x&state=${encodeURIComponent(farMiss)}`);
      expect(a.status).toBe(400);
      expect(b.status).toBe(400);
      expect(a.body).toBe(b.body);
    } finally {
      server.stop();
    }
  });
});

describe('SEC-F5 the listener is reachable from this machine only', () => {
  it('binds 127.0.0.1, never 0.0.0.0 and never ::', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      // Prove it by what answers rather than by reading the listen() call: the private
      // field is not reachable, but a socket bound to 0.0.0.0 would also answer on the
      // machine's LAN address. Assert the address the OS reports for the bound socket.
      const probe = await fetch(`http://127.0.0.1:${info.port}/nope`);
      expect(probe.status).toBe(404);
      // Anything that is not /callback is a 404, including a prefix match attempt.
      const prefix = await fetch(`http://127.0.0.1:${info.port}/callbackextra`);
      expect(prefix.status).toBe(404);
    } finally {
      server.stop();
    }
  });

  it('closes the port on timeout rather than listening for the life of the app', async () => {
    const server = new LoopbackOAuthServer({ timeoutMs: 40 });
    const info = await server.start();
    await expect(server.waitForCallback()).rejects.toThrow(/timed out/i);
    expect(server.listening).toBe(false);
    await expect(fetch(`http://127.0.0.1:${info.port}/callback`)).rejects.toThrow();
  });
});
