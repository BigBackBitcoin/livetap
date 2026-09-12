/**
 * Stream keys, and where they live.
 *
 * WEB: a stream key typed by the user is held in this module's `Map` for the lifetime of the
 * page and **never written to localStorage, sessionStorage, IndexedDB or a cookie**. The reason
 * is that a stream key is a password for someone's channel, and browser storage is readable by
 * any script that ever manages to run on this origin — including one injected through a
 * dependency. Losing the key on reload is the correct trade: re-pasting it costs ten seconds,
 * whereas a leaked key costs someone their channel. Instagram, TikTok and X issue a new key per
 * broadcast anyway, so for three of the paste-key platforms per-session is the *only* honest
 * lifetime.
 *
 * DESKTOP: when LIVETAP runs inside its Electron shell, `window.livetap.vault` is present and
 * backed by the OS keychain (Electron `safeStorage`). We feature-detect it and hand the key over
 * so a desktop user pastes it once. The renderer still never reads it back: `get` returns the
 * value only to the adapter call that needs it, and nothing persists it in React state.
 *
 * Neither path ever renders a key again after it is saved (PRODUCT_SPEC §5d).
 */

export interface VaultBridge {
  set(id: string, value: string): Promise<void> | void;
  get(id: string): Promise<string | undefined> | string | undefined;
  delete(id: string): Promise<void> | void;
}

interface LivetapBridge {
  vault?: VaultBridge;
}

function bridge(): VaultBridge | undefined {
  const host = (globalThis as { window?: { livetap?: LivetapBridge } }).window;
  return host?.livetap?.vault;
}

/** In-memory, session-only. Cleared by a reload, by design. */
const session = new Map<string, string>();

export async function saveStreamKey(destinationId: string, key: string): Promise<void> {
  const vault = bridge();
  if (vault) {
    await vault.set(`destination:${destinationId}`, key);
    return;
  }
  session.set(destinationId, key);
}

export async function readStreamKey(destinationId: string): Promise<string | undefined> {
  const vault = bridge();
  if (vault) return (await vault.get(`destination:${destinationId}`)) ?? undefined;
  return session.get(destinationId);
}

export async function forgetStreamKey(destinationId: string): Promise<void> {
  const vault = bridge();
  if (vault) await vault.delete(`destination:${destinationId}`);
  session.delete(destinationId);
}

export function hasStreamKey(destinationId: string): boolean {
  return session.has(destinationId) || bridge() !== undefined;
}

/** The last four characters, for the "Saved · ends in 1234" display. Never the whole key. */
export function keyTail(key: string): string {
  return key.slice(-4);
}

/** True when LIVETAP is running inside its desktop shell. */
export function hasDesktopVault(): boolean {
  return bridge() !== undefined;
}
