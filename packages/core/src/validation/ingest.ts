import type { IngestTarget } from '../types/destination.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const RTMP_RE = /^rtmps?:\/\/[^\s/]+(\/[^\s]*)?$/i;
const SRT_RE = /^srt:\/\/[^\s/]+:\d{1,5}(\?[^\s]*)?$/i;
const WHIP_RE = /^https:\/\/[^\s]+$/i;

/**
 * Validate a user-supplied ingest target. Never trusts the input; prevents URL-based injection into
 * the engine (argv arrays are used downstream, but we still refuse anything not a proper URL).
 */
export function validateIngest(ingest: Partial<IngestTarget> | undefined): ValidationResult {
  const errors: string[] = [];
  if (!ingest) return { ok: false, errors: ['No stream settings provided.'] };
  const url = (ingest.url ?? '').trim();
  if (!url) errors.push('Stream URL is required.');
  if (/[\s"'`$;|&<>]/.test(url)) errors.push('Stream URL contains characters that are not allowed.');
  switch (ingest.protocol) {
    case 'rtmp':
    case 'rtmps':
      if (url && !RTMP_RE.test(url)) errors.push('Stream URL must start with rtmp:// or rtmps://.');
      if (ingest.protocol === 'rtmps' && url && !/^rtmps:\/\//i.test(url)) errors.push('RTMPS destinations must use rtmps://.');
      if (!ingest.streamKey || !ingest.streamKey.trim()) errors.push('Stream key is required.');
      if (ingest.streamKey && /[\s"'`$;|&<>]/.test(ingest.streamKey)) errors.push('Stream key contains characters that are not allowed.');
      break;
    case 'srt':
      if (url && !SRT_RE.test(url)) errors.push('SRT URL must look like srt://host:port.');
      break;
    case 'whip':
      if (url && !WHIP_RE.test(url)) errors.push('WHIP endpoint must be an https:// URL.');
      break;
    default:
      errors.push('Unknown protocol.');
  }
  return { ok: errors.length === 0, errors };
}

/** Redact secrets from an ingest for logging/diagnostics. */
export function redactIngest(ingest: IngestTarget): IngestTarget {
  return {
    ...ingest,
    streamKey: ingest.streamKey ? '••••' + ingest.streamKey.slice(-4) : undefined,
    passphrase: ingest.passphrase ? '••••' : undefined,
  };
}

/** What a redacted secret looks like everywhere in LIVETAP. */
const MASK = '\u2022\u2022\u2022\u2022';

/**
 * Redact secret-shaped substrings from arbitrary text before it reaches a log,
 * a crash report, an error toast or a diagnostics export.
 *
 * This exists because a stream key stops being a "field" the moment it is
 * concatenated into a publish URL. Two places in the desktop engine proved that
 * in the 2026-09 security review (SEC-D3):
 *
 *  - the FFmpeg argv was logged verbatim at `info`, and the sender argv's last
 *    element is `rtmp://host/app/<STREAM KEY>`;
 *  - FFmpeg's own stderr was logged verbatim, and it echoes the full publish
 *    URL in most connection failures.
 *
 * Both wrote a live stream key into `main.log` on disk on every broadcast.
 *
 * The rules are deliberately blunt and ordered longest-match-first. This is a
 * last line of defence, NOT a licence to pass secrets around and clean them up
 * later: redact at the boundary, and still never put a secret somewhere it does
 * not belong.
 */
export function redactSecrets(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return (
    text
      // rtmp/rtmps/rtsp: the LAST path segment is the stream key.
      .replace(/(rtmps?:\/\/[^\s|'"]*\/)([^\s/|?'"]+)/gi, '$1' + MASK)
      .replace(/(rtsps?:\/\/)[^\s@|'"]*@/gi, '$1' + MASK + '@')
      // SRT / WHIP / generic query parameters that carry a credential.
      .replace(
        /((?:passphrase|streamid|stream_key|streamkey|access_token|refresh_token|id_token|token|key|secret|client_secret|code|code_verifier|password|pwd|signature|sig|auth|authorization)=)[^&\s|'"]+/gi,
        '$1' + MASK,
      )
      // Bearer tokens, including the `-authorization` argv flag the whip muxer takes.
      .replace(/(Bearer\s+)[\w.\-~+/]+=*/gi, '$1' + MASK)
      .replace(/(-authorization\s+)\S+/gi, '$1' + MASK)
  );
}

/** Redact every element of an argv array that could carry a secret. */
export function redactArgv(argv: readonly string[]): string[] {
  return argv.map((arg) => redactSecrets(arg));
}

/** Compose the final publish URL for RTMP (url + '/' + key) without double slashes. */
export function composeRtmpPublishUrl(ingest: IngestTarget): string {
  if (ingest.protocol !== 'rtmp' && ingest.protocol !== 'rtmps') return ingest.url;
  const base = ingest.url.replace(/\/+$/, '');
  return ingest.streamKey ? `${base}/${ingest.streamKey}` : base;
}
