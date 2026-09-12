import type { ReactElement } from 'react';
import type { DestinationConfig } from '@livetap/core';

/**
 * The one extra line Pro appends to a destination card.
 *
 * It lives under `screens/pro/` because it is the only place a destination card is allowed to
 * name a protocol, and because that directory is what the `no-obs-words` guard exempts.
 * The key itself is never rendered — only its last four characters, so a user with two keys
 * can tell them apart without either being readable.
 */
export function ProDestinationLine({ config }: { config: DestinationConfig }): ReactElement | null {
  const ingest = config.ingest;
  if (!ingest) return null;
  return (
    <p className="lt-destcard__pro lt-mono">
      {`${ingest.protocol} · ${hostOf(ingest.url)} · key ends in ${tailOf(ingest.streamKey)}`}
    </p>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.split('/')[2] ?? url;
  }
}

function tailOf(key: string | undefined): string {
  return key && key.length >= 4 ? key.slice(-4) : '••••';
}

/**
 * What the platform itself says about going live here, verbatim from its profile.
 *
 * Pro mode only, because these notes are the platform's own engineering language and carry the
 * vocabulary Simple mode must never show. Simple gets the derived sentence in
 * `lib/platformStatus.ts` instead — same source of truth, different reader.
 */
export function ProPlatformNotes({ notes }: { notes: readonly string[] }): ReactElement | null {
  if (notes.length === 0) return null;
  return (
    <details className="lt-pronotes">
      <summary>What this platform actually allows</summary>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  );
}
