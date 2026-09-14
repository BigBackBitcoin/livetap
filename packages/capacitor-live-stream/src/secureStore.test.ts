/**
 * Unit tests for the vault bridge.
 *
 * The Kotlin behind this cannot be run on the build host, but the wiring can: whether a secret
 * reaches the native store at all, and whether this package is polite enough never to shadow a
 * vault another shell already installed. Both of those are how a secret ends up in the wrong place
 * or nowhere, and neither needs a device.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installVaultBridge } from './secureStore.js';
import type { LivetapSecureStorePlugin, VaultBridge } from './secureStore.js';

interface VaultHost {
  livetap?: { vault?: VaultBridge };
}

function fakePlugin(initial: Record<string, string> = {}): LivetapSecureStorePlugin & {
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async set({ id, value }) {
      store.set(id, value);
    },
    async get({ id }) {
      const value = store.get(id);
      return value === undefined ? {} : { value };
    },
    async remove({ id }) {
      store.delete(id);
    },
    async clear() {
      store.clear();
    },
  };
}

function withWindow(host: VaultHost): void {
  vi.stubGlobal('window', host);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installVaultBridge', () => {
  it('installs a vault that round-trips a secret through the native store', async () => {
    const host: VaultHost = {};
    withWindow(host);
    const plugin = fakePlugin();

    installVaultBridge(plugin);

    await host.livetap?.vault?.set('destination:d1', 'a-stream-key');
    expect(plugin.store.get('destination:d1')).toBe('a-stream-key');
    await expect(host.livetap?.vault?.get('destination:d1')).resolves.toBe('a-stream-key');

    await host.livetap?.vault?.delete('destination:d1');
    await expect(host.livetap?.vault?.get('destination:d1')).resolves.toBeUndefined();
  });

  it('reports a missing secret as undefined rather than throwing', async () => {
    withWindow({});
    const bridge = installVaultBridge(fakePlugin());

    await expect(bridge?.get('destination:never-saved')).resolves.toBeUndefined();
  });

  it('never shadows a vault another shell already installed', () => {
    const electron: VaultBridge = {
      set: async () => undefined,
      get: async () => undefined,
      delete: async () => undefined,
    };
    const host: VaultHost = { livetap: { vault: electron } };
    withWindow(host);

    expect(installVaultBridge(fakePlugin())).toBe(electron);
    expect(host.livetap?.vault).toBe(electron);
  });

  it('installs nothing when there is no window to install it on', () => {
    vi.stubGlobal('window', undefined);
    expect(installVaultBridge(fakePlugin())).toBeNull();
  });

  it('keeps any other livetap bridge properties the host already exposed', () => {
    const host = { livetap: { engine: { marker: true } } } as VaultHost & {
      livetap: { engine: unknown };
    };
    withWindow(host);

    installVaultBridge(fakePlugin());

    expect(host.livetap.engine).toEqual({ marker: true });
    expect(host.livetap.vault).toBeDefined();
  });
});
