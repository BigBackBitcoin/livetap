/**
 * PKCE (RFC 7636) helpers built on WebCrypto only — works unchanged in Node 20 and browsers.
 * No dependencies, and no secret ever leaves this module: the verifier is returned to the
 * caller, which is expected to hold it in memory until the callback and never persist it.
 */

/** RFC 7636 unreserved characters: ALPHA / DIGIT / "-" / "." / "_" / "~". */
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * How the challenge is encoded.
 * - `base64url` is RFC 7636 `S256` and what every platform except TikTok expects.
 * - `hex` is TikTok's documented deviation: the SHA-256 hex digest, still sent as `S256`.
 */
export type ChallengeEncoding = 'base64url' | 'hex';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  encoding: ChallengeEncoding;
}

export interface GeneratePkceOptions {
  /** 43–128 characters. Defaults to 64. */
  length?: number;
  /** Supply a verifier instead of generating one (test vectors, resumed flows). */
  verifier?: string;
  encoding?: ChallengeEncoding;
}

export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new RangeError('PKCE code_verifier must be 43–128 characters (RFC 7636).');
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    // Safe: the modulo keeps the index inside the alphabet.
    out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length] as string;
  }
  return out;
}

/** SHA-256 of the verifier, base64url-encoded (or hex for TikTok). */
export async function computeCodeChallenge(
  verifier: string,
  encoding: ChallengeEncoding = 'base64url',
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  return encoding === 'hex' ? toHex(bytes) : toBase64Url(bytes);
}

export async function generatePkce(options: GeneratePkceOptions = {}): Promise<PkcePair> {
  const encoding = options.encoding ?? 'base64url';
  const codeVerifier = options.verifier ?? generateCodeVerifier(options.length ?? 64);
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    throw new RangeError('PKCE code_verifier must be 43–128 characters (RFC 7636).');
  }
  return {
    codeVerifier,
    codeChallenge: await computeCodeChallenge(codeVerifier, encoding),
    codeChallengeMethod: 'S256',
    encoding,
  };
}

/** Opaque, URL-safe value for the OAuth `state` parameter (CSRF protection). */
export function generateState(bytes = 24): string {
  const random = new Uint8Array(bytes);
  crypto.getRandomValues(random);
  return toBase64Url(random);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}
