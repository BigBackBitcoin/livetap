/**
 * TEAM F (SECURITY), 2026-09-15. §23's IPC questions, answered by execution.
 *
 * Three questions, and the third has an answer the docs currently get wrong:
 *
 *   1. Enumerate EVERY channel the preload exposes. Is there a generic `invoke`?
 *   2. Does main validate every argument, on every channel, before touching it?
 *   3. Can a renderer ask main for a raw token or a raw stream key?
 *
 * The answer to 3 is YES, by design, through `vault.get`. That is not a bug -- the
 * renderer is the thing that builds an ingest target and sets an Authorization
 * header, so it has to hold the value -- but `docs/security/REAL_CREDENTIAL_SECURITY.md`
 * claimed "a token never crosses IPC in the renderer's direction", which is false.
 * SEC-F12 below is the test that keeps the document honest about it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CH } from '../shared/ipc.js';

/* ------------------------------------------------------------------ fake electron */

interface Registered {
  handlers: Map<string, (event: unknown, payload: unknown) => unknown>;
  listeners: Map<string, (event: unknown, payload: unknown) => void>;
}

const registered: Registered = { handlers: new Map(), listeners: new Map() };

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      registered.handlers.set(channel, fn);
    },
    on: (channel: string, fn: (event: unknown, payload: unknown) => void) => {
      registered.listeners.set(channel, fn);
    },
    removeHandler: (channel: string) => registered.handlers.delete(channel),
    removeAllListeners: (channel: string) => registered.listeners.delete(channel),
  },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn(async () => '') },
}));

const { registerIpcHandlers } = await import('./ipc.js');

/* ------------------------------------------------------------------- fake context */

const TRUSTED_SENDER = { id: 7 };
const trustedEvent = { sender: TRUSTED_SENDER } as unknown;
const hostileEvent = { sender: { id: 99 } } as unknown;

function makeContext(overrides: Record<string, unknown> = {}) {
  const engine = {
    capabilities: vi.fn(async () => ({})),
    start: vi.fn(async () => ({ ok: true })),
    addOutput: vi.fn(async () => ({ ok: true })),
    removeOutput: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    startRecording: vi.fn(async () => ({ ok: true })),
    stopRecording: vi.fn(() => ({ ok: true })),
    pushChunk: vi.fn(),
    endOfStream: vi.fn(),
    on: vi.fn(() => () => undefined),
  };
  const vault = {
    set: vi.fn(() => ({ ok: true })),
    get: vi.fn(() => ({ ok: true, secret: 'THE-SECRET-VALUE' })),
    delete: vi.fn(() => ({ ok: true })),
    list: vi.fn(() => ['oauth:youtube']),
  };
  const oauth = {
    start: vi.fn(async () => ({ redirectUri: 'http://127.0.0.1:1/callback', port: 1, state: 's' })),
    waitForCallback: vi.fn(async () => 'http://127.0.0.1:1/callback?code=x&state=s'),
  };
  const recovery = { read: vi.fn(() => null), clear: vi.fn(), update: vi.fn(), start: vi.fn() };
  return {
    engine,
    vault,
    oauth,
    recovery,
    recordingsDir: 'C:/recordings',
    appVersion: '0.1.0',
    getWindow: () => ({ isDestroyed: () => false, webContents: { id: 7, send: vi.fn() } }),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  } as unknown as Parameters<typeof registerIpcHandlers>[0] & {
    engine: typeof engine;
    vault: typeof vault;
    oauth: typeof oauth;
    recovery: typeof recovery;
  };
}

function register(): ReturnType<typeof makeContext> {
  registered.handlers.clear();
  registered.listeners.clear();
  const context = makeContext();
  registerIpcHandlers(context);
  return context;
}

beforeEach(() => {
  registered.handlers.clear();
  registered.listeners.clear();
});

/* ---------------------------------------------------------------------- the tests */

/**
 * The complete renderer-reachable surface, pinned. A new channel that is not in this
 * list fails the test, which is the point: the allow-list is only an allow-list while
 * something enforces its size.
 */
const EXPECTED_CHANNELS = [
  'livetap:engine:addOutput',
  'livetap:engine:capabilities',
  'livetap:engine:chunk',
  'livetap:engine:endOfStream',
  'livetap:engine:removeOutput',
  'livetap:engine:start',
  'livetap:engine:startRecording',
  'livetap:engine:stop',
  'livetap:engine:stopRecording',
  'livetap:oauth:openExternal',
  'livetap:oauth:startLoopback',
  'livetap:oauth:waitForCallback',
  'livetap:recovery:clear',
  'livetap:recovery:get',
  'livetap:recovery:update',
  'livetap:system:chooseDirectory',
  'livetap:system:info',
  'livetap:system:openPath',
  'livetap:vault:delete',
  'livetap:vault:get',
  'livetap:vault:list',
  'livetap:vault:set',
];

describe('SEC-F10 the IPC surface is exactly this and nothing more', () => {
  it('registers 22 named channels, enumerated', () => {
    register();
    const all = [...registered.handlers.keys(), ...registered.listeners.keys()].sort();
    expect(all).toEqual(EXPECTED_CHANNELS);
    expect(all).toHaveLength(22);
  });

  it('has NO generic invoke, exec, send, call or eval channel', () => {
    register();
    const all = [...registered.handlers.keys(), ...registered.listeners.keys()];
    for (const channel of all) {
      expect(channel.startsWith('livetap:'), channel).toBe(true);
      expect(/\b(invoke|exec|eval|spawn|require|command|passthrough|proxy)\b/i.test(channel), channel).toBe(false);
    }
  });

  it('the preload bakes every channel name in: nothing the renderer supplies names a channel', async () => {
    // The preload is the only file that turns a method call into a channel string. Read it
    // as text and assert that every `ipcRenderer.invoke`/`send`/`on` argument is a CH.*
    // constant rather than a parameter -- a `invoke(channel, ...)` signature is the single
    // change that would turn this allow-list into an open door.
    const { readFileSync } = await import('node:fs');
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');
    const calls = preload.match(/ipcRenderer\.(?:invoke|send|on|off)\(\s*([^,)]+)/g) ?? [];
    expect(calls.length).toBeGreaterThan(15);
    for (const call of calls) {
      const argument = call.replace(/^ipcRenderer\.\w+\(\s*/, '').trim();
      // Either a baked-in CH constant, or the `channel` parameter of the local `subscribe`
      // helper -- which is itself only ever called with a CH constant.
      expect(argument === 'channel' || argument.startsWith('CH.'), call).toBe(true);
    }
    // And the subscribe helper's callers: every call site passes a CH constant.
    const subscribeCalls = preload.match(/subscribe<[^>]*>\(\s*[^,\s][^,]*/g) ?? [];
    const callSites = subscribeCalls.filter((call) => !/channel:\s*string/.test(call));
    expect(callSites.length).toBeGreaterThan(0);
    for (const call of callSites) {
      expect(call, call).toContain('CH.');
    }
    expect(preload).not.toMatch(/invoke\s*:\s*\(\s*channel/);
  });

  it('every channel constant in CH is registered, and every registration is in CH', () => {
    register();
    const declared = new Set<string>(Object.values(CH));
    const live = new Set([...registered.handlers.keys(), ...registered.listeners.keys()]);
    for (const channel of live) expect(declared.has(channel), `${channel} not in CH`).toBe(true);
    // The two main->renderer pushes are in CH but are not ipcMain registrations.
    const mainToRenderer = new Set<string>([CH.engineEvent, CH.oauthDeepLink]);
    for (const channel of declared) {
      if (mainToRenderer.has(channel)) continue;
      expect(live.has(channel), `${channel} declared but not registered`).toBe(true);
    }
  });

  it('refuses every channel from a webContents that is not the app window', async () => {
    const context = register();
    for (const [channel, handler] of registered.handlers) {
      expect(() => handler(hostileEvent, undefined), channel).toThrow(/did not match the expected shape/);
    }
    for (const [channel, listener] of registered.listeners) {
      listener(hostileEvent, { anything: true });
      expect(context.logger.warn, channel).not.toHaveBeenCalled();
    }
    expect(context.engine.pushChunk).not.toHaveBeenCalled();
    expect(context.recovery.update).not.toHaveBeenCalled();
  });
});

describe('SEC-F11 main validates every argument before touching it', () => {
  /** Payloads no guard in this repo should ever accept, whatever the channel expects. */
  const GARBAGE: unknown[] = [
    undefined,
    null,
    42,
    true,
    [],
    { constructor: { prototype: {} } },
    { prototype: {} },
  ];

  /** Channels whose payload must be a plain object of a specific shape. */
  const STRUCTURED = [CH.engineStart, CH.engineAddOutput, CH.engineStartRecording, CH.vaultSet];

  /** Channels whose payload must be a charset-restricted id string. */
  const ID_ONLY = [CH.engineRemoveOutput, CH.vaultGet, CH.vaultDelete];

  async function expectRejected(channel: string, payload: unknown): Promise<void> {
    const handler = registered.handlers.get(channel);
    expect(handler, channel).toBeDefined();
    await expect(
      Promise.resolve().then(() => handler!(trustedEvent, payload)),
      `${channel} ACCEPTED ${JSON.stringify(payload) ?? String(payload)}`,
    ).rejects.toThrow(/did not match the expected shape/);
  }

  it('rejects garbage on every channel that takes a payload at all', async () => {
    register();
    for (const channel of [...STRUCTURED, ...ID_ONLY, CH.oauthOpenExternal, CH.systemOpenPath]) {
      for (const payload of GARBAGE) await expectRejected(channel, payload);
    }
  });

  it('rejects a wrong-shaped object on every structured channel', async () => {
    register();
    for (const channel of STRUCTURED) {
      for (const payload of [
        {},
        'a string',
        { id: 'x'.repeat(200) },
        { id: 'ok', secret: 'x'.repeat(20000) },
        { id: 'ok' },
        { source: { kind: 'exec' } },
      ]) {
        await expectRejected(channel, payload);
      }
    }
  });

  it('rejects an id that is not the restricted charset, on every id channel', async () => {
    register();
    for (const channel of ID_ONLY) {
      for (const payload of [
        '',
        'has space',
        '../../vault.bin',
        'a/b',
        'a\\b',
        'a\nb',
        'x'.repeat(129),
        'a\u0000b',
        { id: 'ok' },
      ]) {
        await expectRejected(channel, payload);
      }
      // The one shape that IS accepted, so the test above is proving a boundary and not
      // that the channel refuses everything.
      const handler = registered.handlers.get(channel)!;
      expect(() => handler(trustedEvent, 'oauth:youtube')).not.toThrow();
    }
  });

  it('prototype pollution through a payload key is refused rather than sanitised', async () => {
    register();
    // `__proto__` in an object literal sets the prototype and leaves no own key, so the
    // interesting case is the parsed-JSON shape, which DOES leave an own `__proto__` key.
    const polluting = JSON.parse('{"id":"ok","secret":"x","__proto__":{"polluted":true}}') as unknown;
    await expectRejected(CH.vaultSet, polluting);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never echoes the rejected input back, which would make the error an exfiltration channel', async () => {
    register();
    const handler = registered.handlers.get(CH.vaultSet)!;
    const canary = 'ya29.CANARY-value-that-must-not-appear-in-an-error';
    try {
      handler(trustedEvent, { id: 'bad id with spaces', secret: canary });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(canary);
      expect(String(error)).not.toContain('bad id with spaces');
    }
  });

  it('drops a malformed chunk and a malformed recovery snapshot instead of trusting them', () => {
    const context = register();
    registered.listeners.get(CH.engineChunk)!(trustedEvent, { aspectRatio: 'nope', data: 'not-a-buffer' });
    expect(context.engine.pushChunk).not.toHaveBeenCalled();
    registered.listeners.get(CH.recoveryUpdate)!(trustedEvent, { startedAt: 'soon' });
    expect(context.recovery.update).not.toHaveBeenCalled();
    expect(context.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('openExternal refuses http, file, javascript and the loopback redirect itself', async () => {
    register();
    const handler = registered.handlers.get(CH.oauthOpenExternal)!;
    const refused = [
      'http://127.0.0.1:53871/callback',
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'ms-msdt:/id',
      'smb://attacker/share',
      'livetap://oauth/callback',
      'https://example.com/\r\nX-Injected: 1',
    ];
    for (const url of refused) {
      await expect(
        Promise.resolve().then(() => handler(trustedEvent, url)),
        url,
      ).rejects.toThrow(/did not match the expected shape/);
    }
    await expect(handler(trustedEvent, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).resolves.toEqual({
      ok: true,
    });
  });

  it('the renderer cannot choose where a recording is written, even by asking politely', async () => {
    const context = register();
    await registered.handlers.get(CH.engineStartRecording)!(trustedEvent, {
      enabled: true,
      container: 'mp4',
      source: 'program',
      directory: 'C:/Windows/System32',
    });
    expect(context.engine.startRecording).toHaveBeenCalledWith(
      expect.objectContaining({ directory: 'C:/recordings' }),
    );
  });

  it('the renderer cannot ask the loopback listener to bind an arbitrary host', async () => {
    const context = register();
    const handler = registered.handlers.get(CH.oauthStartLoopback)!;
    for (const asked of ['evil.example.com', '0.0.0.0', '::', 127, null, undefined, { toString: () => 'localhost' }]) {
      await handler(trustedEvent, { host: asked });
    }
    const calls = context.oauth.start.mock.calls as unknown as Array<[{ host: string }]>;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(['127.0.0.1', 'localhost']).toContain(call[0].host);
    }
    await handler(trustedEvent, { host: 'localhost' });
    expect(context.oauth.start).toHaveBeenLastCalledWith({ host: 'localhost' });
  });
});

describe('SEC-F12 what the renderer CAN get: the honest answer', () => {
  /**
   * OPEN, ACCEPTED-BY-DESIGN, and previously MISDOCUMENTED.
   *
   * `docs/security/REAL_CREDENTIAL_SECURITY.md` said "A token never crosses IPC in the
   * renderer's direction." It does. `livetap:vault:get` returns `{ ok: true, secret }`
   * to the renderer (apps/desktop/src/main/ipc.ts:147-150), and it has to: the renderer
   * is what builds the ingest target and what sets the Authorization header, because the
   * platform adapters run there.
   *
   * What that means for the threat model, stated rather than hidden: an XSS in the
   * renderer CAN read every stored secret by id. `vault.list` even enumerates the ids for
   * it. The mitigations are the ones that stop the XSS -- `script-src 'self'` with no
   * unsafe-inline or unsafe-eval, contextIsolation, sandbox, no nodeIntegration, and a
   * navigation allow-list -- not a boundary inside the vault.
   *
   * Moving the secret behind the boundary would mean moving the whole adapter layer into
   * main, which is a real architectural option and not a small one. It is recorded as a
   * decision, with this test as its evidence.
   */
  it('DOCUMENTS: vault.get hands the raw secret to the renderer', () => {
    register();
    const result = registered.handlers.get(CH.vaultGet)!(trustedEvent, 'oauth:youtube') as {
      ok: boolean;
      secret?: string;
    };
    expect(result.ok).toBe(true);
    expect(result.secret).toBe('THE-SECRET-VALUE');
  });

  it('DOCUMENTS: vault.list enumerates the ids of everything stored', () => {
    register();
    expect(registered.handlers.get(CH.vaultList)!(trustedEvent, undefined)).toEqual(['oauth:youtube']);
  });

  it('but the ids are charset-restricted, so a stored id cannot become a path or a log injection', async () => {
    register();
    const handler = registered.handlers.get(CH.vaultGet)!;
    for (const id of ['../../vault.bin', 'a/b', 'a\\b', 'a b', 'a\nb', 'a:b:c\u0000', 'x'.repeat(129)]) {
      await expect(Promise.resolve().then(() => handler(trustedEvent, id)), id).rejects.toThrow();
    }
    // The colon IS allowed, because every id this product uses has one: `oauth:youtube`.
    expect(() => handler(trustedEvent, 'oauth:youtube')).not.toThrow();
  });

  it('system.openPath cannot escape the recordings directory', async () => {
    register();
    const handler = registered.handlers.get(CH.systemOpenPath)!;
    for (const path of [
      '../../../Windows/System32/calc.exe',
      '/etc/passwd',
      'C:/Windows/System32/calc.exe',
      '\\\\attacker\\share\\x',
      'recording.mp4:payload.exe',
      'a//b',
      './x',
    ]) {
      await expect(Promise.resolve().then(() => handler(trustedEvent, path)), path).rejects.toThrow();
    }
    await expect(handler(trustedEvent, 'live/2026-09-15.mp4')).resolves.toEqual({ ok: true });
  });
});
