import { describe, expect, it } from 'vitest';
import { getProfile } from '../profiles/index.js';
import {
  PASTE_CAPABLE_PLATFORMS,
  PASTE_INGEST_DEFAULTS,
  PASTE_KEY_LOCATIONS,
  pasteIngestDefault,
  pasteLimitsLine,
  splitCombinedIngest,
} from './pasteIngest.js';

describe('paste-path facts', () => {
  it('covers every platform LIVETAP can reach by pasting, and not LinkedIn', () => {
    expect([...PASTE_CAPABLE_PLATFORMS].sort()).toEqual(
      ['facebook', 'instagram', 'kick', 'tiktok', 'twitch', 'x', 'youtube'].sort(),
    );
    // LinkedIn never shows a member a stream key, so there is nothing to paste. Listing it
    // would offer a path that cannot exist.
    expect(PASTE_CAPABLE_PLATFORMS).not.toContain('linkedin');
  });

  it('pre-fills only the two addresses that are documented, and guesses nothing else', () => {
    expect(pasteIngestDefault('youtube')).toEqual({
      protocol: 'rtmp',
      url: 'rtmp://a.rtmp.youtube.com/live2',
    });
    expect(pasteIngestDefault('facebook')).toEqual({
      protocol: 'rtmps',
      url: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    });
    // Twitch's ingest is regional and comes from its own published list at paste time; the
    // rest are per-channel or per-session. An empty field is the honest default.
    for (const platform of ['twitch', 'kick', 'tiktok', 'instagram', 'x'] as const) {
      expect(pasteIngestDefault(platform), platform).toBeUndefined();
    }
    expect(pasteIngestDefault(undefined)).toBeUndefined();
    expect(Object.keys(PASTE_INGEST_DEFAULTS).sort()).toEqual(['facebook', 'youtube']);
  });

  it('knows where to look on every platform, including the one with nowhere to look', () => {
    for (const platform of PASTE_CAPABLE_PLATFORMS) {
      expect(PASTE_KEY_LOCATIONS[platform].length, platform).toBeGreaterThan(0);
    }
    expect(PASTE_KEY_LOCATIONS.custom.length).toBeGreaterThan(0);
    expect(PASTE_KEY_LOCATIONS.linkedin).toContain('does not show you one');
  });
});

describe('splitCombinedIngest', () => {
  it('leaves two properly separated values alone', () => {
    expect(splitCombinedIngest('rtmp://a.rtmp.youtube.com/live2', 'abcd-efgh-ijkl-mnop')).toEqual({
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'abcd-efgh-ijkl-mnop',
      split: false,
      moved: false,
    });
  });

  it('takes the key off the end of a joined address when the key field is empty', () => {
    expect(splitCombinedIngest('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl-mnop', '')).toEqual({
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'abcd-efgh-ijkl-mnop',
      split: true,
      moved: false,
    });
    expect(
      splitCombinedIngest('rtmps://live-api-s.facebook.com:443/rtmp/FB-1234567890-0-Ab', ''),
    ).toEqual({
      url: 'rtmps://live-api-s.facebook.com:443/rtmp',
      streamKey: 'FB-1234567890-0-Ab',
      split: true,
      moved: false,
    });
    expect(
      splitCombinedIngest('rtmps://ingest.global-contribute.live-video.net/app/live_1_SECRET', ''),
    ).toEqual({
      url: 'rtmps://ingest.global-contribute.live-video.net/app',
      streamKey: 'live_1_SECRET',
      split: true,
      moved: false,
    });
  });

  it('keeps a query string with the key, where a key legitimately carries one', () => {
    const result = splitCombinedIngest('rtmp://host.example/live2/key-12345?backup=1', '');
    expect(result.url).toBe('rtmp://host.example/live2');
    expect(result.streamKey).toBe('key-12345?backup=1');
  });

  it('never splits a bare ingest address, because its one segment is the application', () => {
    for (const url of [
      'rtmp://a.rtmp.youtube.com/live2',
      'rtmps://live-api-s.facebook.com:443/rtmp/',
      'rtmps://fa723fc1b171.global-contribute.live-video.net/app/',
      'rtmp://b.rtmp.youtube.com/live2?backup=1',
    ]) {
      const result = splitCombinedIngest(url, '');
      expect(result.split, url).toBe(false);
      expect(result.streamKey, url).toBe('');
    }
  });

  it('refuses to invent a key out of a short trailing segment', () => {
    // `rtmp://host/live/app` is two segments and neither is a key. Failing validation with
    // "a stream key is required" is a question the creator can answer; guessing is not.
    expect(splitCombinedIngest('rtmp://host.example/live/app', '').split).toBe(false);
  });

  it('never overwrites a key the creator actually typed', () => {
    const result = splitCombinedIngest('rtmp://host.example/live2/looks-like-a-key', 'mine');
    expect(result).toEqual({
      url: 'rtmp://host.example/live2/looks-like-a-key',
      streamKey: 'mine',
      split: false,
      moved: false,
    });
  });

  it('moves a whole address pasted into the key field, and then splits it', () => {
    expect(splitCombinedIngest('', 'rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl')).toEqual({
      url: 'rtmp://a.rtmp.youtube.com/live2',
      streamKey: 'abcd-efgh-ijkl',
      split: true,
      moved: true,
    });
    // Only when the address field is still empty: a creator who filled both meant it.
    const both = splitCombinedIngest('rtmp://host.example/app', 'rtmp://other.example/app/key123456');
    expect(both.moved).toBe(false);
  });

  it('trims, and survives anything that is not an address at all', () => {
    expect(splitCombinedIngest('  rtmp://host.example/app  ', '  k  ')).toEqual({
      url: 'rtmp://host.example/app',
      streamKey: 'k',
      split: false,
      moved: false,
    });
    expect(splitCombinedIngest('', '')).toEqual({ url: '', streamKey: '', split: false, moved: false });
    expect(splitCombinedIngest('not a url', '')).toEqual({
      url: 'not a url',
      streamKey: '',
      split: false,
      moved: false,
    });
    expect(splitCombinedIngest('rtmp://hostonly', '').split).toBe(false);
  });
});

describe('pasteLimitsLine', () => {
  it('names the platform and never claims LIVETAP can do what it cannot', () => {
    const line = pasteLimitsLine(getProfile('youtube'));
    expect(line).toContain('YouTube');
    expect(line).toContain('cannot set the title');
  });

  it('says who presses the button, read off the profile rather than listed here', () => {
    // Twitch and Kick publish the moment video arrives.
    expect(pasteLimitsLine(getProfile('twitch'))).toContain('goes live when LIVETAP starts sending');
    expect(pasteLimitsLine(getProfile('kick'))).toContain('goes live when LIVETAP starts sending');
    // YouTube, Instagram, TikTok and X do not: a human presses Go live on the platform.
    for (const platform of ['youtube', 'instagram', 'tiktok', 'x'] as const) {
      expect(pasteLimitsLine(getProfile(platform)), platform).toContain('You press Go live in');
    }
  });

  it('claims nothing about a far end LIVETAP cannot see', () => {
    // A generic destination may be a platform that publishes on ingest or one that waits for a
    // human. Asserting either would be a claim about somebody else's server.
    const line = pasteLimitsLine(getProfile('custom'));
    expect(line).not.toContain('goes live when LIVETAP starts sending');
    expect(line).not.toContain('You press Go live in');
    expect(line).toContain('up to the far end');
  });

  it('never says demo, mock or simulated about a destination that puts real bytes on a wire', () => {
    for (const platform of PASTE_CAPABLE_PLATFORMS) {
      expect(pasteLimitsLine(getProfile(platform)).toLowerCase(), platform).not.toMatch(
        /demo|mock|simulat/,
      );
    }
  });
});
