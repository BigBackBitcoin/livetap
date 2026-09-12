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

/** Compose the final publish URL for RTMP (url + '/' + key) without double slashes. */
export function composeRtmpPublishUrl(ingest: IngestTarget): string {
  if (ingest.protocol !== 'rtmp' && ingest.protocol !== 'rtmps') return ingest.url;
  const base = ingest.url.replace(/\/+$/, '');
  return ingest.streamKey ? `${base}/${ingest.streamKey}` : base;
}
