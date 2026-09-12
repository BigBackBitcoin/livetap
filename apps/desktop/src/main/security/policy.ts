/**
 * The desktop security policy, in one place, as pure data + pure functions so it can be unit-tested
 * without launching Electron.
 *
 * Electron's default posture is a browser with Node in it. Every rule here exists to walk that back
 * to "a sandboxed web app that may talk to streaming platforms and nothing else":
 *
 *  - contextIsolation + sandbox + no nodeIntegration: the renderer cannot reach `require`, so an XSS
 *    in the studio UI is an XSS, not a remote shell.
 *  - a strict CSP applied to responses by main, not just a meta tag, so it also covers what the
 *    renderer loads at runtime and cannot be removed by injected markup.
 *  - permissions are DENIED by default with a short allow-list (media + display capture). Notably
 *    denied: geolocation, midi, hid, serial, usb, bluetooth, notifications, clipboard-read,
 *    openExternal, pointerLock and idle-detection.
 *  - navigation is pinned to the app's own origin; anything else opens in the user's real browser
 *    (https only) so a hostile link cannot repaint itself as the app.
 */

/**
 * Content-Security-Policy for the renderer.
 *
 *  - `default-src 'self'` — nothing loads from anywhere by default.
 *  - `connect-src 'self' https: wss:` — platform APIs, ingest health endpoints and chat sockets.
 *    Cannot be narrowed to a fixed host list: users add arbitrary custom RTMP/WHIP providers and
 *    each platform uses several API/CDN hostnames.
 *  - `img-src` allows data: and blob: for avatars, thumbnails and canvas snapshots.
 *  - `media-src 'self' blob: mediastream:` — mediastream: is what a <video> preview of a
 *    getUserMedia/getDisplayMedia track needs; blob: is for local recordings played back.
 *  - `script-src 'self'` — NO 'unsafe-inline' and NO 'unsafe-eval': the Vite production build emits
 *    external scripts only, so this holds.
 *  - `style-src 'self' 'unsafe-inline'` — unavoidable while the UI uses inline styles for layer
 *    transforms; it is a far smaller risk than inline script.
 *  - the last four directives are not in the brief but cost nothing and close real holes:
 *    `object-src 'none'` (no plugins), `frame-src 'none'`, `base-uri 'self'` (stops a <base> tag
 *    redirecting every relative URL) and `form-action 'none'` (nothing to post to).
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: mediastream:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

export function cspHeaderValue(): string {
  return CSP_DIRECTIVES.join('; ');
}

/**
 * In `--dev` the renderer is served by Vite on localhost:5173 with HMR over a websocket and an
 * inline preamble, so the production CSP would break it. This is a deliberately separate, clearly
 * labelled relaxation that never ships: `isDev` is derived from the packaged flag, not a setting.
 */
export function devCspHeaderValue(devServerOrigin: string): string {
  return [
    `default-src 'self' ${devServerOrigin}`,
    `connect-src 'self' ${devServerOrigin} ws://localhost:5173 ws://127.0.0.1:5173 https: wss:`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: mediastream:",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${devServerOrigin}`,
    `style-src 'self' 'unsafe-inline' ${devServerOrigin}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** Extra response headers worth setting on the app's own documents. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

/**
 * The ONLY permissions the renderer may be granted.
 *
 * `media` covers camera and microphone; `display-capture` covers getDisplayMedia. Electron also
 * asks for `mediaKeySystem` on some pages and `fullscreen` when the studio goes full screen, both
 * of which are harmless and required for the product to work, so they are allowed explicitly rather
 * than left to leak through.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'media',
  'display-capture',
  'fullscreen',
  'mediaKeySystem',
]);

/** Decide a `session.setPermissionRequestHandler` / `setPermissionCheckHandler` call. */
export function isPermissionAllowed(permission: string, requestingOrigin: string, appOrigin: string): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  // Only the app's own pages may hold camera/mic/screen. A permission request from any other
  // origin (an iframe that slipped through, a dev-tools page) is denied.
  return originsMatch(requestingOrigin, appOrigin);
}

/**
 * Compare origins for navigation and permission decisions. `file:` documents report an opaque
 * origin (`null` or `file://`), so the production build — which loads `dist/renderer/index.html`
 * from disk — is matched by comparing the resolved URL prefix instead.
 */
export function originsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const normalise = (value: string): string => {
    if (value === 'null' || value === '') return 'file://';
    try {
      const url = new URL(value);
      return url.protocol === 'file:' ? 'file://' : url.origin;
    } catch {
      return value;
    }
  };
  return normalise(a) === normalise(b);
}

/**
 * Should this navigation be allowed to happen inside the app window?
 * Only the app's own document. Everything else is cancelled (and, if https, handed to the browser).
 */
export function isInternalNavigation(targetUrl: string, appUrl: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(targetUrl);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (target.protocol === 'file:' && app.protocol === 'file:') {
    // Same directory tree as the renderer bundle, nothing above it.
    const appDir = app.pathname.slice(0, app.pathname.lastIndexOf('/') + 1);
    return decodeURIComponent(target.pathname).startsWith(decodeURIComponent(appDir));
  }
  if (target.protocol === 'devtools:') return true;
  // `about:blank`, `data:` and `javascript:` URLs all report the opaque origin "null", which would
  // compare equal to a file: document's own opaque origin and sail straight through the check below.
  // Only real http(s) origins are eligible for the origin comparison.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (target.origin === 'null' || target.origin === '') return false;
  return target.origin === app.origin;
}

/**
 * Should `shell.openExternal` be called for this URL? https only.
 * http:, file:, javascript:, data:, smb:, ms-msdt: and every other scheme are refused — the last
 * two are how "open a link" has historically turned into "run a program".
 */
export function isExternallyOpenable(targetUrl: string): boolean {
  if (typeof targetUrl !== 'string' || targetUrl.length === 0 || targetUrl.length > 2048) return false;
  if (/[\r\n\0]/.test(targetUrl)) return false;
  try {
    return new URL(targetUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Web requests the renderer is allowed to make. The renderer talks to platform APIs over https and
 * to chat over wss; it has no business fetching over plain http, and `ws:` would leak chat tokens.
 * `devtools:`, `file:` (its own bundle) and `blob:`/`data:` are internal.
 */
export function isRequestAllowed(url: string, isDev: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  switch (parsed.protocol) {
    case 'https:':
    case 'wss:':
    case 'file:':
    case 'devtools:':
    case 'blob:':
    case 'data:':
      return true;
    case 'http:':
    case 'ws:':
      // Vite's dev server and its HMR socket, plus the OAuth loopback listener.
      return isDev || parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    default:
      return false;
  }
}
