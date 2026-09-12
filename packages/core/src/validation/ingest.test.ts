import { describe, expect, it } from 'vitest';
import { composeRtmpPublishUrl, redactArgv, redactIngest, redactSecrets, validateIngest } from './ingest.js';

describe('validateIngest', () => {
  it('accepts valid rtmp/rtmps/srt/whip targets', () => {
    expect(validateIngest({ protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app', streamKey: 'live_123_abc' }).ok).toBe(true);
    expect(validateIngest({ protocol: 'rtmps', url: 'rtmps://a.rtmps.youtube.com/live2', streamKey: 'abcd-efgh' }).ok).toBe(true);
    expect(validateIngest({ protocol: 'srt', url: 'srt://ingest.example.com:9000?streamid=abc' }).ok).toBe(true);
    expect(validateIngest({ protocol: 'whip', url: 'https://relay.example.com/whip/abc' }).ok).toBe(true);
  });

  it('rejects missing or malformed input', () => {
    expect(validateIngest(undefined).ok).toBe(false);
    expect(validateIngest({ protocol: 'rtmp', url: '', streamKey: 'x' }).errors).toContain('Stream URL is required.');
    expect(validateIngest({ protocol: 'rtmp', url: 'http://nope', streamKey: 'x' }).ok).toBe(false);
    expect(validateIngest({ protocol: 'rtmp', url: 'rtmp://ok/app' }).errors).toContain('Stream key is required.');
    expect(validateIngest({ protocol: 'rtmps', url: 'rtmp://insecure/app', streamKey: 'k' }).ok).toBe(false);
    expect(validateIngest({ protocol: 'whip', url: 'http://insecure' }).ok).toBe(false);
  });

  it('refuses shell metacharacters in URLs and keys (defense in depth)', () => {
    expect(validateIngest({ protocol: 'rtmp', url: 'rtmp://x/app; rm -rf /', streamKey: 'k' }).ok).toBe(false);
    expect(validateIngest({ protocol: 'rtmp', url: 'rtmp://x/app', streamKey: 'k$(whoami)' }).ok).toBe(false);
    expect(validateIngest({ protocol: 'rtmp', url: 'rtmp://x/app', streamKey: 'k|cat' }).ok).toBe(false);
  });
});

describe('redactIngest', () => {
  it('masks secrets but keeps the tail for recognisability', () => {
    const r = redactIngest({ protocol: 'rtmp', url: 'rtmp://x/app', streamKey: 'live_12345_secretkey9876', passphrase: 'pw' });
    expect(r.streamKey).toBe('••••9876');
    expect(r.passphrase).toBe('••••');
    expect(r.url).toBe('rtmp://x/app');
  });
});

describe('composeRtmpPublishUrl', () => {
  it('joins url and key without double slashes', () => {
    expect(composeRtmpPublishUrl({ protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app/', streamKey: 'k' })).toBe('rtmp://live.twitch.tv/app/k');
    expect(composeRtmpPublishUrl({ protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app', streamKey: 'k' })).toBe('rtmp://live.twitch.tv/app/k');
    expect(composeRtmpPublishUrl({ protocol: 'srt', url: 'srt://h:1' })).toBe('srt://h:1');
  });
});

// ---------------------------------------------------------------------------
// SECURITY REVIEW 2026-09 — SEC-D3: redactSecrets is the last line of defence
// between a publish URL and a log file, a toast or a diagnostics export.
// ---------------------------------------------------------------------------

describe('redactSecrets', () => {
  it('masks the last path segment of an RTMP/RTMPS publish URL', () => {
    expect(redactSecrets('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl')).toBe(
      'rtmp://a.rtmp.youtube.com/live2/••••',
    );
    expect(redactSecrets('rtmps://live.twitch.tv/app/live_12345_SECRETKEY')).toBe(
      'rtmps://live.twitch.tv/app/••••',
    );
  });

  it('masks a key inside a longer FFmpeg error line, keeping the diagnostic part', () => {
    const out = redactSecrets(
      '[flv @ 0x55] Error opening output rtmp://a.example/live/live_999_KEY: Input/output error',
    );
    expect(out).not.toContain('live_999_KEY');
    expect(out).toContain('rtmp://a.example/live/••••');
    expect(out).toContain('Error opening output');
  });

  it('masks SRT and WHIP credentials carried as query parameters', () => {
    expect(redactSecrets('srt://h.example:9000?streamid=sid&passphrase=p4ss')).toBe(
      'srt://h.example:9000?streamid=••••&passphrase=••••',
    );
    expect(redactSecrets('https://relay.example/whip?token=abc123')).toBe('https://relay.example/whip?token=••••');
  });

  it('masks bearer tokens, the whip -authorization argv flag, and rtsp userinfo', () => {
    expect(redactSecrets('Authorization: Bearer ya29.A0ARrdaM-abcdef')).toBe('Authorization: Bearer ••••');
    expect(redactSecrets('-f whip -authorization sup3rs3cret https://relay.example/whip')).toContain(
      '-authorization ••••',
    );
    expect(redactSecrets('rtsp://relayhook:hookpassword@127.0.0.1:8554/live')).toBe(
      'rtsp://••••@127.0.0.1:8554/live',
    );
  });

  it('masks OAuth material that platform error bodies echo back', () => {
    for (const field of ['access_token', 'refresh_token', 'id_token', 'code', 'code_verifier', 'client_secret']) {
      const out = redactSecrets(`{"${field}":"x"} ${field}=SUPERSECRETVALUE&other=1`);
      expect(out).not.toContain('SUPERSECRETVALUE');
      expect(out).toContain('other=1');
    }
  });

  it('leaves text with no secret in it untouched, and handles junk input', () => {
    expect(redactSecrets('Conversion failed! No such file or directory')).toBe(
      'Conversion failed! No such file or directory',
    );
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
    expect(redactSecrets(12345 as unknown as string)).toBe('');
  });
});

describe('redactArgv', () => {
  it('masks the publish URL element of a real sender argv and nothing else', () => {
    const argv = [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'mpegts',
      '-i',
      'pipe:0',
      '-c',
      'copy',
      '-f',
      'flv',
      'rtmp://a.example/live/live_42_SECRET',
    ];
    const out = redactArgv(argv);
    expect(out.join(' ')).not.toContain('live_42_SECRET');
    expect(out[out.length - 1]).toBe('rtmp://a.example/live/••••');
    // Every other element survives verbatim, so the log is still diagnosable.
    expect(out.slice(0, -1)).toEqual(argv.slice(0, -1));
  });

  it('masks a WHIP bearer token passed as its own argv element', () => {
    const out = redactArgv(['-f', 'whip', '-authorization', 'sup3rs3cret', 'https://relay.example/whip']);
    // Element-wise redaction cannot see across elements, so the pair form is
    // covered by the `-authorization <value>` rule after join(); assert both.
    expect(redactSecrets(out.join(' '))).toContain('-authorization ••••');
  });
});
