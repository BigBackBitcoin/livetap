import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  credentialFor,
  forgetTokens,
  hasTokens,
  readTokens,
  saveTokens,
  type ConnectionRef,
  type StoredTokens,
} from '../state/tokens.js';

/**
 * ONE PLATFORM IS NOT ONE ACCOUNT.
 *
 * A creator may hold Carter Gaming, Carter Live and Carter Clips on YouTube and broadcast to all
 * three at once. Until this file existed, `tokens.ts` keyed the vault by platform — `oauth:youtube`
 * — so connecting the second channel overwrote the first channel's grant, and disconnecting either
 * deleted both. Those are acceptance criteria G and F, and they were broken at the root rather
 * than in the UI.
 *
 * These tests are written against the STORAGE, not against a screen, because that is where the
 * bug was. A UI that lists three rows over one shared token is a UI that broadcasts three copies
 * of the same channel.
 */

interface FakeVault {
  entries: Map<string, string>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
}

function installVault(): FakeVault {
  const entries = new Map<string, string>();
  const vault: FakeVault = {
    entries,
    get: async (key) => entries.get(key),
    set: async (key, value) => {
      entries.set(key, value);
      return true;
    },
    delete: async (key) => entries.delete(key),
  };
  /*
   * Through `unknown`: happy-dom already declares a real `Window` here, so TypeScript will not
   * let a stub be assigned over it directly. The stub is the whole point — these tests are about
   * what reaches the vault, so the vault has to be one this test can read back.
   */
  (globalThis as unknown as { window: unknown }).window = { livetap: { vault } };
  return vault;
}

function tokensFor(label: string, accountId: string): StoredTokens {
  return { accessToken: `token-for-${accountId}`, scopes: ['stream'], accountId, accountLabel: label };
}

const gaming: ConnectionRef = { connectionId: 'conn-1', platform: 'youtube' };
const live: ConnectionRef = { connectionId: 'conn-2', platform: 'youtube' };
const tiktok: ConnectionRef = { connectionId: 'conn-3', platform: 'tiktok' };

let vault: FakeVault;

beforeEach(() => {
  vault = installVault();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('two accounts on one platform', () => {
  /** Acceptance criterion G. */
  it('does not let the second YouTube sign-in overwrite the first', async () => {
    await saveTokens(gaming, tokensFor('Carter Gaming', 'UC-gaming'));
    await saveTokens(live, tokensFor('Carter Live', 'UC-live'));

    const first = await readTokens(gaming);
    const second = await readTokens(live);

    expect(first?.accountLabel, 'the first channel was overwritten by the second').toBe('Carter Gaming');
    expect(second?.accountLabel).toBe('Carter Live');
    expect(
      first?.accessToken,
      'both channels are sharing one access token — one of them would broadcast to the other channel',
    ).not.toBe(second?.accessToken);
  });

  /** Acceptance criteria A and J: N accounts, not two. */
  it('holds as many accounts per platform as the creator connects', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ connectionId: `c${i}`, platform: 'youtube' as const }));
    for (const [i, ref] of many.entries()) await saveTokens(ref, tokensFor(`Channel ${i}`, `UC-${i}`));

    const labels = await Promise.all(many.map(async (ref) => (await readTokens(ref))?.accountLabel));
    expect(labels).toEqual(['Channel 0', 'Channel 1', 'Channel 2', 'Channel 3', 'Channel 4']);
  });

  /** Acceptance criterion F. */
  it('disconnecting one account leaves the other signed in', async () => {
    await saveTokens(gaming, tokensFor('Carter Gaming', 'UC-gaming'));
    await saveTokens(live, tokensFor('Carter Live', 'UC-live'));

    await forgetTokens(gaming);

    expect(await hasTokens(gaming), 'the disconnected account kept its token').toBe(false);
    expect(
      await hasTokens(live),
      'disconnecting one YouTube channel signed the creator out of the other one too',
    ).toBe(true);
  });

  it('keeps platforms apart as well as accounts', async () => {
    await saveTokens(gaming, tokensFor('Carter Gaming', 'UC-gaming'));
    await saveTokens(tiktok, tokensFor('@carterofficial', 'tt-1'));

    await forgetTokens(tiktok);

    expect(await hasTokens(gaming)).toBe(true);
    expect(await hasTokens(tiktok)).toBe(false);
  });

  /** Acceptance criterion D: each account is its own destination identity, all the way down. */
  it('gives each account its own credential handle', async () => {
    const a = credentialFor(gaming, tokensFor('Carter Gaming', 'UC-gaming'));
    const b = credentialFor(live, tokensFor('Carter Live', 'UC-live'));

    expect(a.platform).toBe('youtube');
    expect(b.platform).toBe('youtube');
    expect(
      a.id,
      'two connections share one credential id, so an adapter could read the other channel token',
    ).not.toBe(b.id);
    expect(a.accountId).toBe('UC-gaming');
    expect(b.accountId).toBe('UC-live');
  });
});

describe('the upgrade path for someone already signed in', () => {
  /*
   * The vault of a creator who signed in before this shipped holds `oauth:youtube` and nothing
   * else. They must not be signed out by an upgrade.
   */
  it('reads the legacy platform entry when the connection has none of its own', async () => {
    vault.entries.set('oauth:youtube', JSON.stringify(tokensFor('Carter Gaming', 'UC-gaming')));

    const found = await readTokens(gaming);

    expect(found?.accountLabel, 'an existing sign-in was lost by the upgrade').toBe('Carter Gaming');
  });

  it('does not copy the legacy entry forward, so one grant never lives under two keys', async () => {
    vault.entries.set('oauth:youtube', JSON.stringify(tokensFor('Carter Gaming', 'UC-gaming')));

    await readTokens(gaming);

    expect(
      vault.entries.has('oauth:youtube:conn-1'),
      'the legacy grant was duplicated; revoking one copy would strand the other',
    ).toBe(false);
  });

  it('prefers the connection own entry once it has one', async () => {
    vault.entries.set('oauth:youtube', JSON.stringify(tokensFor('Old Legacy', 'UC-legacy')));
    await saveTokens(gaming, tokensFor('Carter Gaming', 'UC-gaming'));

    expect((await readTokens(gaming))?.accountLabel).toBe('Carter Gaming');
  });

  it('deletes the legacy entry too, so Disconnect does not leave a token behind', async () => {
    vault.entries.set('oauth:youtube', JSON.stringify(tokensFor('Carter Gaming', 'UC-gaming')));

    await forgetTokens(gaming);

    expect(
      vault.entries.has('oauth:youtube'),
      'Disconnect said the account was gone and left its token in the keychain',
    ).toBe(false);
  });
});
