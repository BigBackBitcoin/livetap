/**
 * Non-secret app state, persisted under `livetap.*` keys.
 *
 * What is here: the intent, the destination configs *without* their stream keys, the Moments,
 * the Simple settings, the mode and whether setup has been done. What is never here: a stream
 * key, an access token, a refresh token or an account secret of any kind (see `secrets.ts`).
 */
import type { AspectRatio, DestinationConfig, Moment, QualityPreset } from '@livetap/core';
import type { ContentType } from '@livetap/core';

export const KEYS = {
  intent: 'livetap.intent',
  onboarding: 'livetap.onboarding',
  mode: 'livetap.mode',
  settings: 'livetap.settings',
  destinations: 'livetap.destinations',
  moments: 'livetap.moments',
  /**
   * The creator has been told, once, that GO LIVE reaches their real accounts (§37).
   *
   * Non-secret and deliberately per-browser-profile: it records that a sentence was read, not
   * anything about the accounts themselves.
   */
  realBroadcastAck: 'livetap.realBroadcastAck',
} as const;

export interface PersistedSettings {
  quality: QualityPreset;
  recordEveryStream: boolean;
  aspect: AspectRatio;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  quality: 'auto',
  recordEveryStream: false,
  aspect: '16:9',
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): StorageLike | null {
  try {
    const host = (globalThis as { localStorage?: StorageLike }).localStorage;
    return host ?? null;
  } catch {
    // Private mode or storage disabled. Persistence is a convenience, never a requirement.
    return null;
  }
}

export function read<T>(key: string, fallback: T): T {
  const s = store();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a locked store. Nothing user-facing depends on this succeeding.
  }
}

export function clearAll(): void {
  const s = store();
  if (!s) return;
  for (const key of Object.values(KEYS)) {
    try {
      s.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }
  /*
   * Keys owned by something other than `KEYS`, and therefore easy to forget here. A reset that
   * leaves the tour dismissed is a reset that does not give the creator back the first run, which
   * is the only reason anyone presses it.
   */
  for (const key of ['livetap.theme', 'livetap.tour.answered', 'livetap.tour.step']) {
    try {
      s.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }
}

/** Strip every secret before a destination config touches storage. */
export function redactForStorage(config: DestinationConfig): DestinationConfig {
  if (!config.ingest) return config;
  const { streamKey: _key, passphrase: _pass, ...ingest } = config.ingest;
  return { ...config, ingest: { ...ingest } };
}

export function readDestinations(): DestinationConfig[] {
  const list = read<DestinationConfig[]>(KEYS.destinations, []);
  return Array.isArray(list) ? list.filter((c) => typeof c?.id === 'string' && typeof c?.platform === 'string') : [];
}

export function writeDestinations(configs: DestinationConfig[]): void {
  write(KEYS.destinations, configs.map(redactForStorage));
}

export function readIntent(): ContentType | null {
  return read<ContentType | null>(KEYS.intent, null);
}

export function readMoments(): Moment[] | null {
  const list = read<Moment[] | null>(KEYS.moments, null);
  return Array.isArray(list) && list.length > 0 ? list : null;
}
