/**
 * OBS colour conversion.
 *
 * OBS stores every colour as one 32-bit integer in **ABGR** byte order (`0xAABBGGRR`):
 * the lowest byte is red, then green, then blue, and the highest byte is alpha.
 * LIVETAP stores colours as CSS strings, so every imported colour passes through here.
 *
 * A value we cannot read returns `undefined` — the importer then reports the source
 * instead of inventing a colour.
 */

export interface ObsColor {
  /** 0..255 */
  r: number;
  /** 0..255 */
  g: number;
  /** 0..255 */
  b: number;
  /** 0..1 */
  a: number;
}

const MAX_U32 = 0xffffffff;

/** Parse an OBS ABGR integer into channels. Accepts numbers and numeric strings. */
export function parseObsColor(value: unknown): ObsColor | undefined {
  let raw: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) raw = value;
  else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) raw = parsed;
  }
  if (raw === undefined) return undefined;
  const truncated = Math.trunc(raw);
  // OBS writes an unsigned 32-bit value; some tools write it signed (-1 === 0xFFFFFFFF).
  if (truncated > MAX_U32 || truncated < -(MAX_U32 + 1)) return undefined;
  const n = truncated >>> 0;
  return {
    r: n & 0xff,
    g: (n >>> 8) & 0xff,
    b: (n >>> 16) & 0xff,
    a: ((n >>> 24) & 0xff) / 255,
  };
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

/** `#RRGGBB` (alpha dropped), or undefined if the value is not an OBS colour. */
export function obsColorToHex(value: unknown): string | undefined {
  const c = parseObsColor(value);
  if (!c) return undefined;
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** `#RRGGBB` when fully opaque, otherwise `rgba(r, g, b, a)`. */
export function obsColorToCss(value: unknown): string | undefined {
  const c = parseObsColor(value);
  if (!c) return undefined;
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

/** Compose a CSS colour from an OBS colour integer plus a separate 0..100 opacity field. */
export function obsColorWithOpacityToCss(value: unknown, opacityPercent: number): string | undefined {
  const c = parseObsColor(value);
  if (!c) return undefined;
  const a = Math.min(1, Math.max(0, opacityPercent / 100));
  if (a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 1000) / 1000})`;
}
