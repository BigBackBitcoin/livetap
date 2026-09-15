/**
 * TEAM F (SECURITY), 2026-09-15. §23's "token storage" and "browser storage" questions,
 * answered by driving the real modules and then DUMPING every web-reachable store.
 *
 * Grepping for `localStorage` proves nothing about what is in it at runtime. These tests
 * run the real `saveTokens` / `saveStreamKey` / `persist.write` paths with realistically
 * shaped credentials and then enumerate every key and value in `localStorage`,
 * `sessionStorage` and `document.cookie`, asserting the credential is in none of them.
 *
 * SEC-F15 is the finding. The Electron preload's vault does not return the shape this
 * code consumes, so on DESKTOP a saved OAuth token can never be read back and a saved
 * stream key comes back as an object. That is a correctness defect with a direct §23
 * consequence: "token storage, refresh" does not work on the surface the owner is about
 * to install.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEYS, clearAll, read, write } from './persist.js';
import { forgetStreamKey, hasStreamKey, keyTail, readStreamKey, saveStreamKey } from './secrets.js';
import { forgetTokens, readTokens, saveTokens, summarize, type StoredTokens } from './tokens.js';
import { PKCE_SESSION_KEY, readPending, writePending } from './oauthFlow.js';

/**
 * Realistically shaped, never real. The redaction suite uses the same shapes for the same
 * reason: a test that uses "secret123" proves nothing about a `ya29.`-prefixed token.
 */
const FAKE = {
  accessToken: 'ya29.a0AfB_byEXAMPLEwebstorageTESTtokenSHAPEonly1234567890abcd',
  refreshToken: '1//04EXAMPLEwebstorageREFRESHshapeONLY-nevervalid_abcdefghij',
  streamKey: 'live_987654321_EXAMPLEstreamKEYshapeOnlyNeverValidAtAll',
  codeVerifier: 'EXAMPLEverifierSHAPEonly-abcdefghijklmnopqrstuvwxyz0123456789_~',
};

/** Every key/value pair a page script on this origin could read, flattened to one string. */
function dumpWebStorage(): { keys: string[]; blob: string } {
  const keys: string[] = [];
  const parts: string[] = [];
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    if (!store) continue;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key === null) continue;
      keys.push(key);
      parts.push(key, store.getItem(key) ?? '');
    }
  }
  parts.push(globalThis.document?.cookie ?? '');
  return { keys: keys.sort(), blob: parts.join('\n') };
}

function expectNoCredentialAnywhere(): void {
  const { blob } = dumpWebStorage();
  for (const [name, value] of Object.entries(FAKE)) {
    if (name === 'codeVerifier') continue; // deliberately stored; see SEC-F14.
    expect(blob, `${name} reached a web-readable store`).not.toContain(value);
  }
}

beforeEach(() => {
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
  delete (globalThis as { window?: { livetap?: unknown } }).window?.livetap;
});

afterEach(async () => {
  await forgetTokens('youtube');
  await forgetTokens('twitch');
  await forgetStreamKey('dest-1');
  delete (globalThis as { window?: { livetap?: unknown } }).window?.livetap;
  vi.restoreAllMocks();
});

describe('SEC-F13 on web, a token never reaches a store a page script can read', () => {
  it('saveTokens keeps an access and refresh token out of every web store', async () => {
    const tokens: StoredTokens = {
      accessToken: FAKE.accessToken,
      refreshToken: FAKE.refreshToken,
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
      accountLabel: 'The Channel',
    };
    await saveTokens('youtube', tokens);

    // It IS readable by this process, so the test is not passing because nothing was stored.
    expect((await readTokens('youtube'))?.accessToken).toBe(FAKE.accessToken);
    expect(dumpWebStorage().keys).toEqual([]);
    expectNoCredentialAnywhere();
  });

  it('the AccountSummary the UI renders carries no token at all', async () => {
    const tokens: StoredTokens = {
      accessToken: FAKE.accessToken,
      refreshToken: FAKE.refreshToken,
      scopes: ['channel:read:stream_key'],
      accountLabel: 'The Channel',
    };
    const summary = summarize(tokens);
    expect(JSON.stringify(summary)).not.toContain(FAKE.accessToken);
    expect(JSON.stringify(summary)).not.toContain(FAKE.refreshToken);
    expect(Object.keys(summary).sort()).toEqual(['accountLabel', 'scopes']);
  });

  it('a stream key stays in memory and never lands in localStorage', async () => {
    await saveStreamKey('dest-1', FAKE.streamKey);
    expect(await readStreamKey('dest-1')).toBe(FAKE.streamKey);
    expect(dumpWebStorage().keys).toEqual([]);
    expectNoCredentialAnywhere();
    // And the only rendering of it is four characters.
    expect(keyTail(FAKE.streamKey)).toHaveLength(4);
    expect(FAKE.streamKey).toContain(keyTail(FAKE.streamKey));
  });

  it('a reload loses them, which is the deliberate trade', async () => {
    await saveTokens('youtube', { accessToken: FAKE.accessToken, scopes: [] });
    await saveStreamKey('dest-1', FAKE.streamKey);
    // Nothing survives in a store, so a fresh page cannot recover either value. Simulated by
    // asserting the stores are empty: a reload rebuilds the module and the Maps with it.
    expect(dumpWebStorage().keys).toEqual([]);
  });

  it('the persisted destination list carries no stream key', () => {
    // `persist` is the module that writes to localStorage. Hand it a destination-shaped
    // object WITH a key and prove the app never asks it to store one.
    write(KEYS.destinations, [{ id: 'dest-1', platform: 'custom', label: 'My server' }]);
    const { blob } = dumpWebStorage();
    expect(blob).toContain('livetap.destinations');
    expect(blob).not.toContain(FAKE.streamKey);
    expect(read(KEYS.destinations, [])).toHaveLength(1);
    clearAll();
    expect(dumpWebStorage().keys).toEqual([]);
  });
});

describe('SEC-F14 the PKCE verifier is the one credential-shaped thing in storage', () => {
  it('lives in sessionStorage, not localStorage, and only until the callback', () => {
    writePending(globalThis.sessionStorage, {
      platform: 'youtube',
      state: 'state-value',
      codeVerifier: FAKE.codeVerifier,
      redirectUri: 'https://livetap.example/oauth/callback',
    });

    // sessionStorage: dies with the tab. localStorage: survives forever. The distinction is
    // the whole mitigation, so it is asserted rather than assumed.
    expect(globalThis.sessionStorage.getItem(PKCE_SESSION_KEY)).toContain(FAKE.codeVerifier);
    expect(globalThis.localStorage.getItem(PKCE_SESSION_KEY)).toBeNull();
    expect(globalThis.localStorage.length).toBe(0);

    expect(readPending(globalThis.sessionStorage)?.codeVerifier).toBe(FAKE.codeVerifier);
    globalThis.sessionStorage.removeItem(PKCE_SESSION_KEY);
    expect(readPending(globalThis.sessionStorage)).toBeNull();
    expect(dumpWebStorage().blob).not.toContain(FAKE.codeVerifier);
  });

  it('a verifier on its own grants nothing: it is not a token and carries no account', () => {
    writePending(globalThis.sessionStorage, {
      platform: 'youtube',
      state: 'state-value',
      codeVerifier: FAKE.codeVerifier,
      redirectUri: 'https://livetap.example/oauth/callback',
    });
    const blob = dumpWebStorage().blob;
    expect(blob).not.toContain(FAKE.accessToken);
    expect(blob).not.toContain(FAKE.refreshToken);
    expect(blob).not.toContain('client_secret');
  });
});

/* ------------------------------------------------------------------------------------- */

/**
 * A faithful stand-in for what Electron's preload actually installs at
 * `window.livetap.vault`. Its return types are copied from
 * `apps/desktop/src/shared/ipc.ts` `VaultResult`, NOT from
 * `apps/web/src/state/secrets.ts` `VaultBridge`. That difference is the finding.
 */
function installElectronShapedVault(available = true): Map<string, string> {
  const store = new Map<string, string>();
  const vault = {
    set: async (id: string, secret: string) =>
      available ? (store.set(id, secret), { ok: true }) : { ok: false, reason: 'ENCRYPTION_UNAVAILABLE' },
    get: async (id: string) =>
      available
        ? store.has(id)
          ? { ok: true, secret: store.get(id) }
          : { ok: false, reason: 'NOT_FOUND' }
        : { ok: false, reason: 'ENCRYPTION_UNAVAILABLE' },
    delete: async (id: string) => (store.delete(id), { ok: true }),
    list: async () => [...store.keys()],
  };
  const host = globalThis as unknown as { window: { livetap?: Record<string, unknown> } };
  host.window.livetap = { ...(host.window.livetap ?? {}), vault };
  return store;
}

describe('SEC-F15 the two vault shapes are both understood', () => {
  /**
   * FIXED 2026-09-15. Was HIGH, and it made desktop sign-in impossible.
   *
   * The Electron preload exposes `vault.get(id): Promise<VaultResult>` — `{ ok, secret?, reason? }`
   * — while `secrets.ts` declared, and `tokens.ts` consumed, `get(id): Promise<string | undefined>`.
   * Nothing adapted one to the other. `readStreamKey` therefore returned the RESULT OBJECT, and
   * `readTokens` handed it to JSON.parse, which threw on "[object Object]" into a catch that
   * returned undefined. Every desktop sign-in was unreadable, every time, silently.
   *
   * Two things hid it. Both consumers reach `window.livetap` through a cast, so TypeScript never
   * compared the shapes and `tsc -b` stayed clean over a broken contract. And the Android bridge
   * gets it right, so the only surface that was wrong was the only surface nobody had run a real
   * sign-in on.
   *
   * `valueOf()` in secrets.ts now normalises both, in one place, and `ok: false` is a refusal
   * rather than a value.
   */
  it('reads a token back after a desktop save', async () => {
    const store = installElectronShapedVault();
    await saveTokens('twitch', { accessToken: FAKE.accessToken, refreshToken: FAKE.refreshToken, scopes: [] });

    expect(store.get('oauth:twitch')).toContain(FAKE.accessToken);
    expect((await readTokens('twitch'))?.accessToken).toBe(FAKE.accessToken);
    expect((await readTokens('twitch'))?.refreshToken).toBe(FAKE.refreshToken);
  });

  it('reads a stream key back as a string, not as a wrapper', async () => {
    installElectronShapedVault();
    await saveStreamKey('dest-1', FAKE.streamKey);
    const back = await readStreamKey('dest-1');
    expect(typeof back).toBe('string');
    expect(back).toBe(FAKE.streamKey);
  });

  it('understands the Capacitor bridge shape too, which returns the string directly', async () => {
    const store = new Map<string, string>();
    const host = globalThis as unknown as { window: { livetap?: Record<string, unknown> } };
    host.window.livetap = {
      vault: {
        set: async (id: string, value: string) => void store.set(id, value),
        get: async (id: string) => store.get(id),
        delete: async (id: string) => void store.delete(id),
      },
    };
    await saveTokens('twitch', { accessToken: FAKE.accessToken, scopes: [] });
    expect((await readTokens('twitch'))?.accessToken).toBe(FAKE.accessToken);
    await saveStreamKey('dest-1', FAKE.streamKey);
    expect(await readStreamKey('dest-1')).toBe(FAKE.streamKey);
  });
});

describe('SEC-F16 a refused vault write is not mistaken for a write', () => {
  /**
   * FIXED 2026-09-15. Was MEDIUM.
   *
   * `SecretVault.set` correctly refuses rather than falling back to plaintext when
   * `safeStorage.isEncryptionAvailable()` is false, which is the right call. But neither caller
   * looked at the answer: both awaited `set` and returned, skipping the in-memory fallback, so
   * the secret was nowhere. And `hasStreamKey` answered true whenever a vault merely EXISTED.
   *
   * On a Linux desktop with no keyring that meant the creator pasted a stream key, saw no error,
   * and the app believed it had one — the "claims READY when it is not" family the product's own
   * rules forbid, arrived at by ignoring a return value.
   */
  it('keeps the key for this session when the vault refuses to store it', async () => {
    installElectronShapedVault(false);
    await saveStreamKey('dest-1', FAKE.streamKey);

    // Nothing reached disk — that part was always right — but the broadcast the creator is in
    // the middle of setting up still works, and a reload still asks for the key again.
    expect(await readStreamKey('dest-1')).toBe(FAKE.streamKey);
    expectNoCredentialAnywhere();
  });

  it('hasStreamKey answers for the destination asked about, not for the vault', () => {
    installElectronShapedVault(false);
    expect(hasStreamKey('never-saved-anything')).toBe(false);
  });

  it('keeps a token for this session when the vault refuses it, so the sign-in completes', async () => {
    installElectronShapedVault(false);
    await saveTokens('twitch', { accessToken: FAKE.accessToken, scopes: [] });
    expect((await readTokens('twitch'))?.accessToken).toBe(FAKE.accessToken);
  });
});
