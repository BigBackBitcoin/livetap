/** Number and unit formatting — PRODUCT_SPEC §6.3. All running numbers use tabular figures. */

/** `M:SS` under an hour, `H:MM:SS` over it. Never `00:mm:ss`. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `1h 04m` / `22m 10s` / `48s` — the summary form, never a running clock. */
export function durationSummary(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Decimal units. One decimal above 1 GB, none below. Never GiB. */
export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${bytes} B`;
}

/** Megabits with one decimal — the Simple-mode form inside a LIVE chip. */
export function megabits(kbps: number): string {
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}

/** `312 watching` / `12.4K watching` */
export function viewers(n: number): string {
  return n > 9999 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-GB');
}

/** One decimal below 10%, none above. */
export function percent(value: number): string {
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

/** `11 Sept 2026, 20:14` — locale-formatted at runtime, 24-hour clock. */
export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
