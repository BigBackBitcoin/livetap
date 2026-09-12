import { describe, expect, it } from 'vitest';
import { composeRtmpPublishUrl, redactIngest, validateIngest } from './ingest.js';

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
