import { describe, expect, it } from 'vitest';

import { DEEP_LINK_SCHEME, LoopbackOAuthServer, findDeepLink, isAcceptableDeepLink } from './oauth.js';

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { redirect: 'manual' });
  return { status: response.status, body: await response.text() };
}

describe('LoopbackOAuthServer', () => {
  it('binds an ephemeral loopback port and reports the redirect_uri', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      expect(info.port).toBeGreaterThan(0);
      expect(info.redirectUri).toBe(`http://127.0.0.1:${info.port}/callback`);
      // Loopback ONLY — never 0.0.0.0, which would expose the callback to the network.
      expect(info.redirectUri).toContain('127.0.0.1');
      expect(info.redirectUri).not.toContain('0.0.0.0');
      expect(info.state.length).toBeGreaterThanOrEqual(32);
    } finally {
      server.stop();
    }
  });

  it('generates a fresh, unpredictable state per flow', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const first = await server.start();
      const second = await server.start();
      expect(second.state).not.toBe(first.state);
      // base64url of 32 random bytes.
      expect(second.state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    } finally {
      server.stop();
    }
  });

  it('resolves waitForCallback with the full callback URL', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const pending = server.waitForCallback(5000);
      const response = await get(`${info.redirectUri}?code=auth-code-123&state=${encodeURIComponent(info.state)}`);
      expect(response.status).toBe(200);
      expect(response.body).toContain("You're signed in.");
      const url = await pending;
      expect(new URL(url).searchParams.get('code')).toBe('auth-code-123');
    } finally {
      server.stop();
    }
  });

  it('rejects a callback whose state does not match — the local-app race mitigation', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      let resolved = false;
      const pending = server.waitForCallback(1500).then(
        () => {
          resolved = true;
        },
        () => undefined,
      );
      const bad = await get(`${info.redirectUri}?code=attacker-code&state=not-the-right-state`);
      expect(bad.status).toBe(400);
      expect(bad.body).toContain("didn't match");
      // Still waiting: the wrong callback did not satisfy the flow.
      expect(resolved).toBe(false);
      // The real one still works.
      await get(`${info.redirectUri}?code=real&state=${encodeURIComponent(info.state)}`);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('rejects a callback with no state at all', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      expect((await get(`${info.redirectUri}?code=x`)).status).toBe(400);
    } finally {
      server.stop();
    }
  });

  it('serves 404 on every path except /callback', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const base = `http://127.0.0.1:${info.port}`;
      expect((await get(`${base}/`)).status).toBe(404);
      expect((await get(`${base}/callbackk`)).status).toBe(404);
      // `/../callback` is normalised to `/callback` by the URL parser before we see it, so it
      // reaches the state check and is refused there instead. Either way it is refused.
      expect((await get(`${base}/../callback`)).status).toBe(400);
    } finally {
      server.stop();
    }
  });

  it('sets headers that keep the authorization code out of a Referer', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const info = await server.start();
      const response = await fetch(`${info.redirectUri}?code=c&state=${encodeURIComponent(info.state)}`);
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      await response.text();
    } finally {
      server.stop();
    }
  });

  it('is single-use: the listener is closed once the callback arrives', async () => {
    const server = new LoopbackOAuthServer();
    const info = await server.start();
    const pending = server.waitForCallback(5000);
    await get(`${info.redirectUri}?code=c&state=${encodeURIComponent(info.state)}`);
    await pending;
    expect(server.listening).toBe(false);
    await expect(fetch(info.redirectUri).then((r) => r.text())).rejects.toThrow();
  });

  it('buffers a callback that arrives before the renderer waits', async () => {
    const server = new LoopbackOAuthServer();
    const info = await server.start();
    await get(`${info.redirectUri}?code=early&state=${encodeURIComponent(info.state)}`);
    const url = await server.waitForCallback(5000);
    expect(url).toContain('code=early');
    expect(server.listening).toBe(false);
  });

  it('times out and closes the port rather than listening forever', async () => {
    const server = new LoopbackOAuthServer();
    await server.start();
    await expect(server.waitForCallback(120)).rejects.toThrow(/timed out/);
    expect(server.listening).toBe(false);
  });

  it('rejects waitForCallback when no flow was started', async () => {
    const server = new LoopbackOAuthServer();
    await expect(server.waitForCallback(100)).rejects.toThrow(/No sign-in is in progress/);
  });

  it('rejects a second concurrent wait', async () => {
    const server = new LoopbackOAuthServer();
    try {
      await server.start();
      const first = server.waitForCallback(400).catch(() => undefined);
      await expect(server.waitForCallback(400)).rejects.toThrow(/Already waiting/);
      await first;
    } finally {
      server.stop();
    }
  });

  it('stop() cancels a pending wait instead of leaving a dangling promise', async () => {
    const server = new LoopbackOAuthServer();
    await server.start();
    const pending = server.waitForCallback(5000);
    server.stop();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('restarting replaces the old listener', async () => {
    const server = new LoopbackOAuthServer();
    try {
      const first = await server.start();
      const second = await server.start();
      expect(second.port).not.toBe(0);
      await expect(fetch(first.redirectUri).then((r) => r.text())).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  it('accepts an injected state generator for deterministic tests', async () => {
    const server = new LoopbackOAuthServer({ randomState: () => 'fixed-state-value' });
    try {
      const info = await server.start();
      expect(info.state).toBe('fixed-state-value');
    } finally {
      server.stop();
    }
  });
});

describe('deep links', () => {
  it('finds a livetap:// url anywhere in argv', () => {
    expect(findDeepLink(['electron.exe', '.', 'livetap://auth/callback?code=1'])).toBe('livetap://auth/callback?code=1');
    expect(findDeepLink(['LIVETAP.exe', 'LIVETAP://Auth/Callback'])).toBe('LIVETAP://Auth/Callback');
    expect(findDeepLink(['electron.exe', '--dev'])).toBeNull();
    expect(findDeepLink([])).toBeNull();
  });

  it('accepts only our scheme — any web page can navigate to a custom scheme', () => {
    expect(isAcceptableDeepLink('livetap://auth/callback?code=abc&state=xyz')).toBe(true);
    expect(isAcceptableDeepLink(`${DEEP_LINK_SCHEME}://x`)).toBe(true);
    for (const url of [
      'https://evil.example/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'livetapx://auth',
      'not a url',
      '',
    ]) {
      expect(isAcceptableDeepLink(url)).toBe(false);
    }
  });

  it('rejects control characters and absurd lengths', () => {
    expect(isAcceptableDeepLink('livetap://auth\n')).toBe(false);
    expect(isAcceptableDeepLink(`livetap://auth/${'x'.repeat(5000)}`)).toBe(false);
  });
});
