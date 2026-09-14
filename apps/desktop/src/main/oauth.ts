/**
 * Desktop OAuth plumbing: two redirect mechanisms, because the platforms disagree.
 *
 *  1. Loopback (`http://127.0.0.1:<ephemeral>/callback`) — what Google/YouTube requires for
 *     installed apps, and what RFC 8252 §7.3 recommends generally. A private-use URI scheme is
 *     explicitly NOT accepted by Google for desktop clients, so this is mandatory, not a nicety.
 *  2. Private-use URI scheme (`livetap://auth/callback`) — for platforms that only allow a fixed
 *     redirect. Registered with `app.setAsDefaultProtocolClient` and routed to the renderer.
 *
 * Hardening applied here:
 *  - the listener binds to 127.0.0.1 ONLY (never 0.0.0.0, never ::), so nothing off-box can reach it;
 *  - the port is ephemeral and the server is single-use: it stops on the first valid callback;
 *  - a CSPRNG `state` is generated per flow and the callback is rejected unless it matches, which is
 *     the documented mitigation for another local app racing the loopback redirect;
 *  - only the exact path `/callback` answers; everything else gets 404;
 *  - the authorization code is handed to the renderer and never written to a log;
 *  - the flow times out (default 5 minutes) and the socket is closed, so an abandoned sign-in does
 *     not leave a listening port open for the life of the app.
 *
 * The token EXCHANGE does not happen here: PKCE is used so no client secret is on the device, and
 * confidential-client exchanges go through the web app's server function (ADR-002).
 */

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { LoopbackInfo } from '../shared/ipc.js';

/**
 * The two spellings of loopback, and why both are needed.
 *
 * RFC 8252 says a native app should bind the loopback IP, and Google requires exactly that: a
 * literal 127.0.0.1 or [::1], never the name. Kick's developer documentation registers the
 * redirect as `http://localhost:<port>` instead, and a provider compares the redirect_uri as a
 * STRING, so the two are not interchangeable however identical they resolve. The socket is bound
 * to the loopback address either way; only the spelling in the URL changes.
 */
const LOOPBACK_IP = '127.0.0.1';
export type LoopbackHost = 'localhost' | '127.0.0.1';
const CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const RESPONSE_OK = `<!doctype html><meta charset="utf-8"><title>LIVETAP</title>
<body style="font:16px system-ui;padding:3rem;text-align:center">
<h1>You're signed in.</h1><p>You can close this tab and go back to LIVETAP.</p></body>`;

const RESPONSE_BAD = `<!doctype html><meta charset="utf-8"><title>LIVETAP</title>
<body style="font:16px system-ui;padding:3rem;text-align:center">
<h1>That sign-in didn't match.</h1><p>Close this tab and start the connection again in LIVETAP.</p></body>`;

export interface LoopbackOptions {
  timeoutMs?: number;
  /** Injected in tests. */
  randomState?: () => string;
}

export class LoopbackOAuthServer {
  private server: Server | null = null;
  private state = '';
  private port = 0;
  private pending: {
    resolve: (url: string) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  /** Set when the callback arrives before the renderer asked to wait for it. */
  private buffered: string | null = null;
  private readonly options: LoopbackOptions;

  constructor(options: LoopbackOptions = {}) {
    this.options = options;
  }

  /** Bind an ephemeral loopback port and return the redirect_uri to send to the provider. */
  async start(options: { host?: LoopbackHost } = {}): Promise<LoopbackInfo> {
    const host: LoopbackHost = options.host === 'localhost' ? 'localhost' : LOOPBACK_IP;
    this.stop();
    this.state = (this.options.randomState ?? defaultState)();
    this.buffered = null;

    const server = createServer((req, res) => this.handle(req, res));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // Port 0 = let the OS pick a free ephemeral port. The socket is always bound to the
      // loopback IP; `host` only decides how the redirect_uri spells it for the provider.
      server.listen(0, LOOPBACK_IP, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (address === null || typeof address === 'string') {
      this.stop();
      throw new Error('Could not determine the loopback port.');
    }
    this.port = address.port;
    return {
      redirectUri: `http://${host}:${this.port}${CALLBACK_PATH}`,
      port: this.port,
      state: this.state,
    };
  }

  /** Resolve with the full callback URL. Rejects on timeout or if no flow was started. */
  waitForCallback(timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS): Promise<string> {
    if (this.buffered !== null) {
      const url = this.buffered;
      this.buffered = null;
      this.stop();
      return Promise.resolve(url);
    }
    if (!this.server) return Promise.reject(new Error('No sign-in is in progress.'));
    if (this.pending) return Promise.reject(new Error('Already waiting for a sign-in callback.'));

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.stop();
        reject(new Error('Sign-in timed out.'));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const rawUrl = req.url ?? '/';
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, `http://${LOOPBACK_IP}:${this.port}`);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    if (parsed.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    // The state check is what stops another local process from feeding us its own callback.
    const state = parsed.searchParams.get('state');
    if (state === null || state !== this.state) {
      res.writeHead(400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      res.end(RESPONSE_BAD);
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Keeps the authorization code out of any outgoing Referer header.
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(RESPONSE_OK);

    const url = parsed.toString();
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      this.stop();
      pending.resolve(url);
    } else {
      this.buffered = url;
    }
  }

  get listening(): boolean {
    return this.server !== null;
  }

  get activePort(): number {
    return this.port;
  }

  stop(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Sign-in was cancelled.'));
      this.pending = null;
    }
    if (this.server) {
      this.server.close();
      this.server.closeAllConnections?.();
      this.server = null;
    }
    this.port = 0;
  }
}

function defaultState(): string {
  return randomBytes(32).toString('base64url');
}

/** The custom scheme LIVETAP registers for OAuth callbacks on platforms that need a fixed URI. */
export const DEEP_LINK_SCHEME = 'livetap';

/** Pick a `livetap://` URL out of an argv array (Windows/Linux deliver deep links that way). */
export function findDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) return arg;
  }
  return null;
}

/**
 * A deep link is attacker-reachable: any web page can navigate to `livetap://…`. So we only forward
 * URLs that parse, use our scheme, and are short enough to be a real OAuth callback.
 */
export function isAcceptableDeepLink(url: string): boolean {
  if (url.length === 0 || url.length > 4096) return false;
  if (/[\r\n\0]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${DEEP_LINK_SCHEME}:`;
  } catch {
    return false;
  }
}
