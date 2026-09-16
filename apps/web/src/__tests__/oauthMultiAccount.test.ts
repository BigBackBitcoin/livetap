import { afterEach, describe, expect, it } from 'vitest';
import { beginAuth, completeAuth, writePending, type DesktopOAuthBridge } from '../state/oauthFlow.js';
import { forgetTokens, readTokens } from '../state/tokens.js';

/**
 * ACCEPTANCE CRITERION G, THROUGH THE FLOW RATHER THAN THE API.
 *
 * `tokens.multiaccount.test.ts` proves the vault keeps two accounts apart when it is ASKED to.
 * This proves the sign-in asks. They are different claims, and the gap between them is where this
 * defect actually lived: storage was per connection, the destination model was per connection, and
 * `oauthFlow` still called `saveTokens(outcome.platform, ...)` — so the second real YouTube
 * sign-in overwrote the first at `oauth:youtube`, one function below everything that had been
 * fixed.
 *
 * Both surfaces are covered because they finish in different places. Desktop completes in process
 * against a loopback listener; web leaves the page and comes back, so the connection has to
 * survive in the pending record across a page load. A fix to one is not a fix to the other.
 */

function brokerFetch(token: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/oauth/config')) {
      return new Response(
        JSON.stringify({ platforms: { youtube: { configured: true, clientId: 'yt' } }, mockMode: false }),
        { status: 200 },
      );
    }
    if (url.endsWith('/api/oauth/token')) {
      return new Response(JSON.stringify({ accessToken: token, refreshToken: `r-${token}`, expiresIn: 3600 }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

function fakeDesktop(state: string): DesktopOAuthBridge {
  let redirectUri = '';
  return {
    async startLoopback(options) {
      redirectUri = `http://${options?.host ?? '127.0.0.1'}:53219/callback`;
      return { redirectUri, port: 53219, state };
    },
    async openExternal() {
      return { ok: true };
    },
    async waitForCallback() {
      return `${redirectUri}?code=the-code&state=${state}`;
    },
  };
}

const gaming = { connectionId: 'youtube-1-aaa', platform: 'youtube' as const };
const live = { connectionId: 'youtube-2-bbb', platform: 'youtube' as const };

afterEach(async () => {
  await forgetTokens(gaming);
  await forgetTokens(live);
  await forgetTokens('youtube');
});

describe('signing in to two accounts on one platform', () => {
  it('desktop: the second channel does not overwrite the first', async () => {
    const first = await beginAuth('youtube', {
      desktop: fakeDesktop('s1'),
      fetchImpl: brokerFetch('AT-gaming'),
      storage: null,
      connectionId: gaming.connectionId,
    });
    const second = await beginAuth('youtube', {
      desktop: fakeDesktop('s2'),
      fetchImpl: brokerFetch('AT-live'),
      storage: null,
      connectionId: live.connectionId,
    });

    expect(first.kind).toBe('connected');
    expect(second.kind).toBe('connected');

    expect((await readTokens(gaming))?.accessToken, 'the first channel grant was overwritten').toBe(
      'AT-gaming',
    );
    expect((await readTokens(live))?.accessToken).toBe('AT-live');
  });

  it('desktop: hands the connection back so the destination is built on it', async () => {
    const outcome = await beginAuth('youtube', {
      desktop: fakeDesktop('s1'),
      fetchImpl: brokerFetch('AT-gaming'),
      storage: null,
      connectionId: gaming.connectionId,
    });

    expect(outcome.kind).toBe('connected');
    if (outcome.kind !== 'connected') return;
    expect(
      outcome.connectionId,
      'the caller cannot tell which connection was authorized, so it would mint a new one',
    ).toBe(gaming.connectionId);
  });

  /*
   * The web flow is a redirect: `beginAuth` and `completeAuth` are separated by a page load, so
   * the connection can only reach the exchange through the pending record in sessionStorage.
   */
  it('web: the connection survives the redirect and the token lands on it', async () => {
    const storage = new Map<string, string>();
    const session = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };

    writePending(session, {
      platform: 'youtube',
      state: 'st-1',
      redirectUri: 'https://livetap.test/oauth/callback',
      connectionId: live.connectionId,
    });

    const outcome = await completeAuth('https://livetap.test/oauth/callback?code=c&state=st-1', {
      storage: session,
      fetchImpl: brokerFetch('AT-live'),
    });

    expect(outcome.kind).toBe('connected');
    expect(
      (await readTokens(live))?.accessToken,
      'the token went to the platform rather than the connection that asked for it',
    ).toBe('AT-live');
  });

  it('an older sign-in with no connection still works, and uses the legacy key', async () => {
    const outcome = await beginAuth('youtube', {
      desktop: fakeDesktop('s1'),
      fetchImpl: brokerFetch('AT-legacy'),
      storage: null,
    });

    expect(outcome.kind).toBe('connected');
    expect((await readTokens('youtube'))?.accessToken).toBe('AT-legacy');
  });
});
