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

/**
 * What a vault answers, on the two shells that have one — and they do not agree.
 *
 * Electron's preload returns `{ ok, secret?, reason? }` so a refusal can be told apart from an
 * absence. The Capacitor bridge returns the string, and throws on failure. Both are reasonable
 * and neither was being handled: `get` was typed as returning a string, so on desktop
 * `readStreamKey` returned the RESULT OBJECT, `String(it)` was `'[object Object]'`, and
 * `readTokens` handed that to `JSON.parse`, which threw into a catch that returned undefined.
 * Every desktop sign-in was unreadable, silently, for as long as the code has existed. It
 * type-checked because both consumers reach `window.livetap` through a cast, and it was never
 * caught because the only surface anyone had signed in on was the one that works.
 *
 * So both shapes are accepted here, in one place, and normalised. `ok: false` is a refusal and
 * is never mistaken for a value.
 */
export interface VaultOutcome {
  ok: boolean;
  secret?: string;
  reason?: string;
}

export type VaultAnswer = VaultOutcome | string | undefined | void;

export interface VaultBridge {
  set(id: string, value: string): Promise<VaultAnswer> | VaultAnswer;
  get(id: string): Promise<VaultAnswer> | VaultAnswer;
  delete(id: string): Promise<VaultAnswer> | VaultAnswer;
}

interface LivetapBridge {
  vault?: VaultBridge;
}

function bridge(): VaultBridge | undefined {
  const host = (globalThis as { window?: { livetap?: LivetapBridge } }).window;
  return host?.livetap?.vault;
}

function outcome(answer: VaultAnswer): VaultOutcome | undefined {
  return answer && typeof answer === 'object' && 'ok' in answer ? answer : undefined;
}

/** The secret a vault handed back, or undefined for an absence OR a refusal. */
export function valueOf(answer: VaultAnswer): string | undefined {
  if (typeof answer === 'string') return answer.length > 0 ? answer : undefined;
  const result = outcome(answer);
  if (!result) return undefined;
  return result.ok && typeof result.secret === 'string' && result.secret.length > 0 ? result.secret : undefined;
}

/**
 * Did a write land?
 *
 * A bridge that reports nothing threw nothing, so it succeeded. A bridge that reports `ok: false`
 * did not — `ENCRYPTION_UNAVAILABLE` on a Linux box with no keyring, say — and the caller must
 * keep the secret somewhere rather than believing it is safe.
 */
export function wrote(answer: VaultAnswer): boolean {
  return outcome(answer)?.ok !== false;
}

/** In-memory, session-only. Cleared by a reload, by design. */
const session = new Map<string, string>();

export async function saveStreamKey(destinationId: string, key: string): Promise<void> {
  const vault = bridge();
  if (vault) {
    /*
     * Keep the session copy when the vault refuses. Returning as though it had been stored left
     * the creator with a key they had pasted, no error, and a destination that could not
     * broadcast — and `hasStreamKey` said yes the whole time.
     */
    if (wrote(await vault.set(`destination:${destinationId}`, key))) {
      noteStreamKey(destinationId, true);
      return;
    }
  }
  session.set(destinationId, key);
  noteStreamKey(destinationId, true);
}

export async function readStreamKey(destinationId: string): Promise<string | undefined> {
  const vault = bridge();
  if (vault) {
    const stored = valueOf(await vault.get(`destination:${destinationId}`));
    noteStreamKey(destinationId, stored !== undefined);
    if (stored !== undefined) return stored;
  }
  return session.get(destinationId);
}

export async function forgetStreamKey(destinationId: string): Promise<void> {
  const vault = bridge();
  if (vault) await vault.delete(`destination:${destinationId}`);
  session.delete(destinationId);
  noteStreamKey(destinationId, false);
}

/**
 * Do we have a key for this destination, as far as this page can tell without asking?
 *
 * It used to answer `true` for every destination whenever a vault merely EXISTED, which meant a
 * fresh destination with nothing saved reported that it had a key. The vault's own answer is
 * asynchronous and this is not, so what is tracked instead is what this session has actually put
 * there or read back. A key stored by a previous run reads as absent until something reads it,
 * which is the safe direction to be wrong in: the creator is asked to paste a key they already
 * have, rather than told they have one they do not.
 */
const known = new Set<string>();

export function hasStreamKey(destinationId: string): boolean {
  return session.has(destinationId) || known.has(destinationId);
}

/** Called by the paths that learn the answer, so `hasStreamKey` stops guessing. */
export function noteStreamKey(destinationId: string, present: boolean): void {
  if (present) known.add(destinationId);
  else known.delete(destinationId);
}

/** The last four characters, for the "Saved · ends in 1234" display. Never the whole key. */
export function keyTail(key: string): string {
  return key.slice(-4);
}

/** True when LIVETAP is running inside its desktop shell. */
export function hasDesktopVault(): boolean {
  return bridge() !== undefined;
}
