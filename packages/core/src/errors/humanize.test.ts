import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../types/destination.js';
import { classifyFailure, humanize } from './humanize.js';

describe('humanize', () => {
  it('produces all four humane fields for every error code', () => {
    for (const code of ERROR_CODES) {
      const e = humanize(code, { target: 'Twitch · mychannel', platform: 'Twitch' });
      expect(e.code).toBe(code);
      for (const field of ['what', 'why', 'doing', 'youCan'] as const) {
        expect(e[field].length, `${code}.${field}`).toBeGreaterThan(10);
        expect(e[field]).not.toMatch(/rtmp error|errno|undefined/i);
      }
    }
  });

  it('names the destination and reassures about isolation on ingest loss', () => {
    const e = humanize('INGEST_DISCONNECTED', { target: 'Twitch · mychannel', platform: 'Twitch', autoReconnect: true });
    expect(e.what).toBe('Twitch · mychannel stopped receiving your stream.');
    expect(e.doing).toContain('reconnecting automatically');
    expect(e.doing).toContain('other destinations keep streaming');
  });

  it('explains paused reconnect when auto-reconnect is disabled', () => {
    const e = humanize('INGEST_TIMEOUT', { platform: 'YouTube', autoReconnect: false });
    expect(e.doing).toContain('paused');
  });

  it('carries technical detail for Pro diagnostics', () => {
    const e = humanize('UNKNOWN', { technical: 'ECONNRESET' });
    expect(e.technical).toBe('ECONNRESET');
  });
});

describe('classifyFailure', () => {
  it('maps HTTP statuses', () => {
    expect(classifyFailure({ status: 401 })).toBe('AUTH_EXPIRED');
    expect(classifyFailure({ status: 403, message: 'quotaExceeded' })).toBe('QUOTA_EXCEEDED');
    expect(classifyFailure({ status: 403, message: 'insufficient scope' })).toBe('AUTH_MISSING_SCOPE');
    expect(classifyFailure({ status: 403, message: 'live streaming not enabled' })).toBe('NOT_ELIGIBLE');
    expect(classifyFailure({ status: 403 })).toBe('AUTH_REVOKED');
    expect(classifyFailure({ status: 429 })).toBe('RATE_LIMITED');
    expect(classifyFailure({ status: 503 })).toBe('PLATFORM_ERROR');
  });

  it('maps transport messages', () => {
    expect(classifyFailure({ message: 'connect ECONNREFUSED 1.2.3.4:1935' })).toBe('INGEST_REFUSED');
    expect(classifyFailure({ message: 'Connection timed out' })).toBe('INGEST_TIMEOUT');
    expect(classifyFailure({ message: 'Broken pipe' })).toBe('INGEST_DISCONNECTED');
    expect(classifyFailure({ message: 'NetStream.Publish.BadName' })).toBe('INGEST_INVALID_KEY');
    expect(classifyFailure({ message: 'getaddrinfo ENOTFOUND a.rtmp.youtube.com' })).toBe('NETWORK_OFFLINE');
    expect(classifyFailure({ message: 'No space left on device ENOSPC' })).toBe('DISK_FULL');
    expect(classifyFailure({ message: 'what' })).toBe('UNKNOWN');
  });
});
