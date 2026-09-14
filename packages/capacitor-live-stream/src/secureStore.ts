/**
 * The native secure store, and the `window.livetap.vault` bridge the web app already looks for.
 *
 * `apps/web/src/state/secrets.ts` feature-detects `window.livetap.vault` and, when it finds one,
 * hands stream keys to it instead of keeping them in an in-memory `Map` that dies with the process.
 * Electron injects that bridge from its preload. Nothing injected it on Android, so a sideloaded
 * build asked the creator to paste their stream key again after every cold start, and the
 * `AndroidManifest.xml` comment promising "OAuth tokens live in the Android Keystore-backed secure
 * store" described something that did not exist.
 *
 * `installVaultBridge()` is that injection. It is idempotent, it never overwrites a bridge another
 * shell already installed (Electron wins on desktop, where its `safeStorage` vault is the right
 * one), and on web it installs nothing at all so `secrets.ts` keeps its deliberate
 * session-only behaviour.
 *
 * VERIFICATION: the TypeScript is unit-tested against a fake plugin. The Kotlin behind it
 * (`SecureStorePlugin.kt`) compiles and ships in the dex but has never been run; see
 * docs/release/ANDROID_MANUAL_TEST.md step 9.
 */
import { registerPlugin } from '@capacitor/core';

export interface SecureStoreGetResult {
  /** Absent when nothing is stored under that id, which is an answer and not an error. */
  value?: string;
}

export interface LivetapSecureStorePlugin {
  set(options: { id: string; value: string }): Promise<void>;
  get(options: { id: string }): Promise<SecureStoreGetResult>;
  remove(options: { id: string }): Promise<void>;
  clear(): Promise<void>;
}

export const LivetapSecureStore = registerPlugin<LivetapSecureStorePlugin>('LivetapSecureStore');

/** Exactly the shape `apps/web/src/state/secrets.ts` feature-detects. */
export interface VaultBridge {
  set(id: string, value: string): Promise<void>;
  get(id: string): Promise<string | undefined>;
  delete(id: string): Promise<void>;
}

interface VaultHost {
  livetap?: { vault?: VaultBridge };
}

/**
 * Install the native store as `window.livetap.vault`.
 *
 * Returns the bridge that is in place afterwards, or null when there is nothing to install (no
 * window, or no native plugin because this is a browser). Callers do not need the return value;
 * it exists so a test can assert what happened without reading globals.
 */
export function installVaultBridge(
  plugin: LivetapSecureStorePlugin = LivetapSecureStore,
): VaultBridge | null {
  const host = (globalThis as { window?: VaultHost }).window;
  if (!host) return null;
  const existing = host.livetap?.vault;
  // Another shell got here first (Electron's preload). Its vault is backed by the OS keychain of
  // the platform actually running, so it is the right one and this must not shadow it.
  if (existing) return existing;

  const bridge: VaultBridge = {
    async set(id, value) {
      await plugin.set({ id, value });
    },
    async get(id) {
      const result = await plugin.get({ id });
      return result.value;
    },
    async delete(id) {
      await plugin.remove({ id });
    },
  };

  const livetap = host.livetap ?? {};
  livetap.vault = bridge;
  host.livetap = livetap;
  return bridge;
}
