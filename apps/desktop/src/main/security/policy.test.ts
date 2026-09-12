import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PERMISSIONS,
  CSP_DIRECTIVES,
  cspHeaderValue,
  devCspHeaderValue,
  isExternallyOpenable,
  isInternalNavigation,
  isPermissionAllowed,
  isRequestAllowed,
  originsMatch,
} from './policy.js';

const APP_FILE_URL = 'file:///C:/Program%20Files/LIVETAP/resources/app/dist/renderer/index.html';

describe('CSP', () => {
  it('matches the agreed policy exactly', () => {
    const csp = cspHeaderValue();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https: wss:");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("media-src 'self' blob: mediastream:");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('never allows inline or eval script — the whole point of a CSP here', () => {
    const scriptSrc = CSP_DIRECTIVES.find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self'");
    expect(cspHeaderValue()).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(cspHeaderValue()).not.toContain('unsafe-eval');
  });

  it('closes the plugin, frame and base-tag holes too', () => {
    const csp = cspHeaderValue();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'none'");
  });

  it('is a single header-safe line', () => {
    expect(cspHeaderValue()).not.toMatch(/[\r\n]/);
    expect(cspHeaderValue().split('; ').length).toBe(CSP_DIRECTIVES.length);
  });

  it('only relaxes script-src in the dev policy, and only for the dev server', () => {
    const dev = devCspHeaderValue('http://localhost:5173');
    expect(dev).toContain('http://localhost:5173');
    expect(dev).toContain("'unsafe-eval'"); // Vite HMR needs it
    // The production policy must not pick it up.
    expect(cspHeaderValue()).not.toContain('localhost');
    expect(cspHeaderValue()).not.toContain('unsafe-eval');
  });
});

describe('permissions', () => {
  it('allows exactly camera/mic, screen capture and fullscreen', () => {
    expect([...ALLOWED_PERMISSIONS].sort()).toEqual(['display-capture', 'fullscreen', 'media', 'mediaKeySystem']);
  });

  it('grants media and display-capture to the app itself', () => {
    expect(isPermissionAllowed('media', APP_FILE_URL, 'file://')).toBe(true);
    expect(isPermissionAllowed('display-capture', APP_FILE_URL, 'file://')).toBe(true);
    expect(isPermissionAllowed('media', 'http://localhost:5173/', 'http://localhost:5173')).toBe(true);
  });

  it('denies everything else, including the ones that read the machine', () => {
    const denied = [
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'hid',
      'serial',
      'usb',
      'bluetooth',
      'clipboard-read',
      'clipboard-sanitized-write',
      'openExternal',
      'pointerLock',
      'idle-detection',
      'window-management',
      'fileSystem',
      'unknown-future-permission',
    ];
    for (const permission of denied) {
      expect(isPermissionAllowed(permission, APP_FILE_URL, 'file://')).toBe(false);
    }
  });

  it('denies media to any origin that is not the app', () => {
    expect(isPermissionAllowed('media', 'https://evil.example/', 'file://')).toBe(false);
    expect(isPermissionAllowed('media', 'https://evil.example/', 'http://localhost:5173')).toBe(false);
  });
});

describe('originsMatch', () => {
  it('treats the opaque file origins as one', () => {
    expect(originsMatch('null', 'file://')).toBe(true);
    expect(originsMatch('', 'file://')).toBe(true);
    expect(originsMatch(APP_FILE_URL, 'file://')).toBe(true);
  });
  it('does not conflate different http origins', () => {
    expect(originsMatch('http://localhost:5173', 'http://localhost:5174')).toBe(false);
    expect(originsMatch('https://a.example', 'https://b.example')).toBe(false);
  });
});

describe('isInternalNavigation', () => {
  it('allows the renderer bundle to navigate within itself', () => {
    expect(isInternalNavigation(APP_FILE_URL, APP_FILE_URL)).toBe(true);
    expect(
      isInternalNavigation(
        'file:///C:/Program%20Files/LIVETAP/resources/app/dist/renderer/studio.html',
        APP_FILE_URL,
      ),
    ).toBe(true);
  });

  it('refuses to walk above the renderer directory', () => {
    expect(isInternalNavigation('file:///C:/Windows/System32/drivers/etc/hosts', APP_FILE_URL)).toBe(false);
    expect(isInternalNavigation('file:///C:/Program%20Files/LIVETAP/resources/app/package.json', APP_FILE_URL)).toBe(
      false,
    );
  });

  it('refuses every remote origin, so a hostile link cannot repaint itself as the app', () => {
    for (const url of [
      'https://evil.example/phish',
      'http://evil.example/phish',
      'https://accounts.google.com/o/oauth2/auth',
      'javascript:alert(1)',
      'data:text/html,<h1>hi',
      'about:blank',
    ]) {
      expect(isInternalNavigation(url, APP_FILE_URL)).toBe(false);
    }
  });

  it('allows same-origin navigation in dev', () => {
    expect(isInternalNavigation('http://localhost:5173/studio', 'http://localhost:5173')).toBe(true);
    expect(isInternalNavigation('http://localhost:9999/', 'http://localhost:5173')).toBe(false);
  });

  it('allows devtools', () => {
    expect(isInternalNavigation('devtools://devtools/bundled/inspector.html', APP_FILE_URL)).toBe(true);
  });

  it('refuses unparseable input', () => {
    expect(isInternalNavigation('', APP_FILE_URL)).toBe(false);
    expect(isInternalNavigation('http://', APP_FILE_URL)).toBe(false);
  });
});

describe('isExternallyOpenable', () => {
  it('opens https links in the real browser', () => {
    expect(isExternallyOpenable('https://livetap.app/help')).toBe(true);
    expect(isExternallyOpenable('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(true);
  });

  it('refuses every scheme that has ever been a shell in disguise', () => {
    for (const url of [
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'smb://server/share',
      'vbscript:msgbox(1)',
      'livetap://auth/callback',
      'not a url',
      '',
    ]) {
      expect(isExternallyOpenable(url)).toBe(false);
    }
  });

  it('refuses control characters and absurd lengths', () => {
    expect(isExternallyOpenable('https://a.example/\n')).toBe(false);
    expect(isExternallyOpenable(`https://a.example/${'x'.repeat(3000)}`)).toBe(false);
  });
});

describe('isRequestAllowed', () => {
  it('allows the schemes the app genuinely needs', () => {
    expect(isRequestAllowed('https://www.googleapis.com/youtube/v3/liveBroadcasts', false)).toBe(true);
    expect(isRequestAllowed('wss://irc-ws.chat.twitch.tv/', false)).toBe(true);
    expect(isRequestAllowed(APP_FILE_URL, false)).toBe(true);
    expect(isRequestAllowed('blob:file:///abc', false)).toBe(true);
    expect(isRequestAllowed('data:image/png;base64,AAA', false)).toBe(true);
  });

  it('blocks plain http and ws in production, except the OAuth loopback', () => {
    expect(isRequestAllowed('http://tracker.example/beacon', false)).toBe(false);
    expect(isRequestAllowed('ws://evil.example/', false)).toBe(false);
    expect(isRequestAllowed('http://127.0.0.1:53871/callback', false)).toBe(true);
    expect(isRequestAllowed('http://localhost:53871/callback', false)).toBe(true);
  });

  it('allows the dev server only in dev', () => {
    expect(isRequestAllowed('http://localhost:5173/src/main.tsx', true)).toBe(true);
    expect(isRequestAllowed('http://some-other-host/x', true)).toBe(true);
    expect(isRequestAllowed('http://some-other-host/x', false)).toBe(false);
  });

  it('blocks exotic schemes outright', () => {
    for (const url of ['ftp://a/b', 'smb://a/b', 'chrome-extension://abc/x.js', 'javascript:1']) {
      expect(isRequestAllowed(url, true)).toBe(false);
    }
  });

  it('blocks unparseable urls', () => {
    expect(isRequestAllowed('::::', false)).toBe(false);
  });
});
