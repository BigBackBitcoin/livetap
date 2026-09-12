import { describe, expect, it } from 'vitest';

import type { DesktopStartRequest, RecoverySnapshot } from './ipc.js';
import {
  isAspectRatio,
  isChunkPayload,
  isDestinationId,
  isEncoderSettings,
  isEngineOutput,
  isHttpsUrl,
  isIngestTarget,
  isOutputFormat,
  isRecord,
  isRecordingSettings,
  isRecoverySnapshot,
  isSafeRelativePath,
  isStartRequest,
  isVaultId,
  isVaultSetRequest,
} from './guards.js';

/**
 * Everything that is not a plain object. An object guard must reject all of these.
 * Note `new Date()` is deliberately absent: it IS a plain-ish object and `isRecord` accepts it by
 * design — the field checks that follow are what reject it.
 */
const NON_OBJECTS: unknown[] = [
  undefined,
  null,
  0,
  1,
  -1,
  NaN,
  '',
  'string',
  true,
  false,
  [],
  [1, 2],
  () => undefined,
  Symbol('s'),
  123n,
];

/**
 * Everything that is not a string. Used for the string-shaped guards, where a bare `'string'` is a
 * perfectly legal value (it is a valid vault id) and so cannot be in the reject list.
 */
const NON_STRINGS: unknown[] = [undefined, null, 0, 1, NaN, true, false, [], [1, 2], {}, () => undefined, Symbol('s'), 123n];

describe('isRecord', () => {
  it('rejects everything that is not a plain object', () => {
    for (const value of NON_OBJECTS) expect(isRecord(value)).toBe(false);
  });

  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejects prototype-polluting own keys', () => {
    // A payload crafted to poison Object.prototype once we spread or merge it.
    expect(isRecord(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);
    expect(isRecord(JSON.parse('{"constructor":{"x":1}}'))).toBe(false);
    expect(isRecord(JSON.parse('{"prototype":{}}'))).toBe(false);
  });
});

describe('isAspectRatio', () => {
  it('accepts only the three real aspect ratios', () => {
    expect(isAspectRatio('16:9')).toBe(true);
    expect(isAspectRatio('9:16')).toBe(true);
    expect(isAspectRatio('1:1')).toBe(true);
    expect(isAspectRatio('4:3')).toBe(false);
    expect(isAspectRatio('16:9 ')).toBe(false);
    for (const value of NON_STRINGS) expect(isAspectRatio(value)).toBe(false);
  });
});

describe('isVaultId / isDestinationId', () => {
  it('accepts the ids LIVETAP generates', () => {
    expect(isVaultId('oauth:youtube:UCabc-123')).toBe(true);
    expect(isVaultId('ingest_dest-7')).toBe(true);
    expect(isDestinationId('dest-7')).toBe(true);
  });

  it('rejects anything that could become a path or a log-injection', () => {
    const bad = [
      '',
      '../../etc/passwd',
      'a/b',
      'a\\b',
      'a b',
      'a\nb',
      'a\u0000b',
      'a.b', // dots could compose a traversal in a future filename scheme
      'x'.repeat(129),
      '<script>',
      'id;rm -rf /',
    ];
    for (const value of bad) expect(isVaultId(value)).toBe(false);
    for (const value of NON_STRINGS) expect(isVaultId(value)).toBe(false);
  });
});

describe('isVaultSetRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isVaultSetRequest({ id: 'oauth:twitch:me', secret: 'refresh-token' })).toBe(true);
  });

  it('rejects a non-object, a bad id, an empty secret and an oversized secret', () => {
    for (const value of NON_OBJECTS) expect(isVaultSetRequest(value)).toBe(false);
    expect(isVaultSetRequest({ id: 'a/b', secret: 's' })).toBe(false);
    expect(isVaultSetRequest({ id: 'ok', secret: '' })).toBe(false);
    expect(isVaultSetRequest({ id: 'ok', secret: 'x'.repeat(8193) })).toBe(false);
    expect(isVaultSetRequest({ id: 'ok' })).toBe(false);
    expect(isVaultSetRequest({ secret: 's' })).toBe(false);
    expect(isVaultSetRequest({ id: 'ok', secret: 123 })).toBe(false);
  });
});

describe('isSafeRelativePath', () => {
  it('accepts a recording filename', () => {
    expect(isSafeRelativePath('LIVETAP-2026-01-01T00-00-00-000Z.mp4')).toBe(true);
    expect(isSafeRelativePath('2026/01/clip.mp4')).toBe(true);
  });

  it('rejects every traversal and absolute form', () => {
    const bad = [
      '..',
      '../secrets',
      'a/../../b',
      '/etc/passwd',
      '\\\\server\\share',
      '\\Windows\\System32',
      'C:\\Windows',
      'c:/Windows',
      './rel',
      'a//b',
      'a\u0000.mp4',
      '',
    ];
    for (const value of bad) expect(isSafeRelativePath(value)).toBe(false);
    for (const value of NON_STRINGS) expect(isSafeRelativePath(value)).toBe(false);
  });
});

describe('isHttpsUrl', () => {
  it('accepts https only', () => {
    expect(isHttpsUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).toBe(true);
  });

  it('accepts a sloppily written but genuinely https URL', () => {
    // WHATWG normalises `HTTPS:/malformed` to `https://malformed/`. That is a real https URL to a
    // (probably unresolvable) host, which is harmless to hand to the browser — so it is accepted
    // rather than refused. What must never be accepted is a different SCHEME, which is the case
    // below.
    expect(isHttpsUrl('HTTPS:/malformed')).toBe(true);
  });

  it('rejects every other scheme, including the dangerous ones', () => {
    const bad = [
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'livetap://auth',
      'ms-msdt:/id',
      'smb://server/share',
      'https://',
      'not a url',
      '',
    ];
    for (const value of bad) expect(isHttpsUrl(value)).toBe(false);
    for (const value of NON_STRINGS) expect(isHttpsUrl(value)).toBe(false);
  });
});

describe('isIngestTarget', () => {
  it('accepts each supported protocol', () => {
    expect(isIngestTarget({ protocol: 'rtmp', url: 'rtmp://a/live', streamKey: 'k' })).toBe(true);
    expect(isIngestTarget({ protocol: 'srt', url: 'srt://a:9000' })).toBe(true);
    expect(isIngestTarget({ protocol: 'whip', url: 'https://a/whip' })).toBe(true);
  });

  it('rejects an unknown protocol and a missing url', () => {
    expect(isIngestTarget({ protocol: 'gopher', url: 'gopher://a' })).toBe(false);
    expect(isIngestTarget({ protocol: 'rtmp' })).toBe(false);
    expect(isIngestTarget({ protocol: 'rtmp', url: '' })).toBe(false);
    expect(isIngestTarget({ protocol: 'rtmp', url: `rtmp://a/${'x'.repeat(3000)}` })).toBe(false);
    for (const value of NON_OBJECTS) expect(isIngestTarget(value)).toBe(false);
  });
});

const goodFormat = {
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  videoKbps: 4500,
  audioKbps: 160,
  codec: 'h264',
  keyframeIntervalSeconds: 2,
};

describe('isOutputFormat', () => {
  it('accepts a real format', () => {
    expect(isOutputFormat(goodFormat)).toBe(true);
  });

  it('rejects out-of-range and non-integer dimensions, odd fps, silly bitrates', () => {
    expect(isOutputFormat({ ...goodFormat, width: 1920.5 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, width: 99 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, height: 99_999 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, fps: 25 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, videoKbps: 0 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, videoKbps: Infinity })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, videoKbps: NaN })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, audioKbps: 4000 })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, codec: 'vp9' })).toBe(false);
    expect(isOutputFormat({ ...goodFormat, keyframeIntervalSeconds: 0 })).toBe(false);
    for (const value of NON_OBJECTS) expect(isOutputFormat(value)).toBe(false);
  });
});

describe('isEncoderSettings / isRecordingSettings', () => {
  it('accepts valid settings', () => {
    expect(isEncoderSettings({ preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' })).toBe(true);
    expect(isRecordingSettings({ enabled: true, container: 'mp4', source: 'program' })).toBe(true);
  });

  it('rejects unknown enum members', () => {
    expect(isEncoderSettings({ preference: 'magic', softwarePreset: 'veryfast', rateControl: 'cbr' })).toBe(false);
    expect(isEncoderSettings({ preference: 'auto', softwarePreset: 'placebo', rateControl: 'cbr' })).toBe(false);
    expect(isRecordingSettings({ enabled: true, container: 'avi', source: 'program' })).toBe(false);
    // `source` is 'program' only: a second encode is never allowed.
    expect(isRecordingSettings({ enabled: true, container: 'mp4', source: 'separate' })).toBe(false);
    expect(isRecordingSettings({ enabled: 'yes', container: 'mp4', source: 'program' })).toBe(false);
    for (const value of NON_OBJECTS) expect(isEncoderSettings(value)).toBe(false);
  });
});

describe('isEngineOutput', () => {
  it('accepts a valid output', () => {
    expect(
      isEngineOutput({
        destinationId: 'dest-1',
        aspectRatio: '16:9',
        ingest: { protocol: 'rtmp', url: 'rtmp://a/live', streamKey: 'k' },
      }),
    ).toBe(true);
  });

  it('rejects a bad id, aspect or ingest', () => {
    expect(isEngineOutput({ destinationId: 'a/b', aspectRatio: '16:9', ingest: { protocol: 'rtmp', url: 'rtmp://a' } })).toBe(false);
    expect(isEngineOutput({ destinationId: 'd', aspectRatio: '4:3', ingest: { protocol: 'rtmp', url: 'rtmp://a' } })).toBe(false);
    expect(isEngineOutput({ destinationId: 'd', aspectRatio: '16:9' })).toBe(false);
    for (const value of NON_OBJECTS) expect(isEngineOutput(value)).toBe(false);
  });
});

const goodRequest: DesktopStartRequest = {
  source: { kind: 'pipe', mimeType: 'video/webm;codecs=h264,opus' },
  formats: { '16:9': goodFormat as DesktopStartRequest['formats']['16:9'] },
  outputs: [
    {
      destinationId: 'dest-1',
      aspectRatio: '16:9',
      ingest: { protocol: 'rtmp', url: 'rtmp://a/live', streamKey: 'k' },
    },
  ],
  encoder: { preference: 'auto', softwarePreset: 'veryfast', rateControl: 'cbr' },
  recording: { enabled: false, container: 'mp4', source: 'program' },
};

describe('isStartRequest', () => {
  it('accepts a real start request', () => {
    expect(isStartRequest(goodRequest)).toBe(true);
  });

  it('accepts a lavfi diagnostic request', () => {
    expect(isStartRequest({ ...goodRequest, source: { kind: 'lavfi', durationSeconds: 30 } })).toBe(true);
    expect(isStartRequest({ ...goodRequest, source: { kind: 'lavfi' } })).toBe(true);
  });

  it('rejects a request with no formats — there would be nothing to encode', () => {
    expect(isStartRequest({ ...goodRequest, formats: {}, outputs: [] })).toBe(false);
  });

  it('rejects an output whose aspect ratio has no format', () => {
    expect(
      isStartRequest({
        ...goodRequest,
        outputs: [{ ...goodRequest.outputs[0], aspectRatio: '9:16' }],
      }),
    ).toBe(false);
  });

  it('rejects a format keyed under the wrong aspect ratio', () => {
    expect(isStartRequest({ ...goodRequest, formats: { '9:16': goodFormat } })).toBe(false);
  });

  it('rejects duplicate destination ids', () => {
    expect(
      isStartRequest({ ...goodRequest, outputs: [goodRequest.outputs[0], goodRequest.outputs[0]] }),
    ).toBe(false);
  });

  it('rejects an absurd number of outputs', () => {
    const many = Array.from({ length: 33 }, (_v, i) => ({
      destinationId: `dest-${i}`,
      aspectRatio: '16:9' as const,
      ingest: { protocol: 'rtmp' as const, url: 'rtmp://a/live', streamKey: 'k' },
    }));
    expect(isStartRequest({ ...goodRequest, outputs: many })).toBe(false);
  });

  it('rejects a bad source, encoder or recording block', () => {
    expect(isStartRequest({ ...goodRequest, source: { kind: 'magic' } })).toBe(false);
    expect(isStartRequest({ ...goodRequest, source: { kind: 'pipe' } })).toBe(false);
    expect(isStartRequest({ ...goodRequest, source: { kind: 'lavfi', durationSeconds: -1 } })).toBe(false);
    expect(isStartRequest({ ...goodRequest, encoder: {} })).toBe(false);
    expect(isStartRequest({ ...goodRequest, recording: {} })).toBe(false);
    expect(isStartRequest({ ...goodRequest, outputs: 'nope' })).toBe(false);
    expect(isStartRequest({ ...goodRequest, formats: [goodFormat] })).toBe(false);
  });

  it('rejects every non-object', () => {
    for (const value of NON_OBJECTS) expect(isStartRequest(value)).toBe(false);
  });
});

describe('isRecoverySnapshot', () => {
  const snapshot: RecoverySnapshot = {
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_010_000,
    destinationIds: ['dest-1', 'dest-2'],
    masterAspectRatio: '16:9',
    qualityPreset: '1080p30',
    recording: true,
    momentId: 'moment-1',
  };

  it('accepts a real snapshot, with or without an active moment', () => {
    expect(isRecoverySnapshot(snapshot)).toBe(true);
    expect(isRecoverySnapshot({ ...snapshot, momentId: null })).toBe(true);
  });

  it('rejects a hand-edited or truncated file', () => {
    expect(isRecoverySnapshot({ ...snapshot, startedAt: 'now' })).toBe(false);
    expect(isRecoverySnapshot({ ...snapshot, destinationIds: ['../../x'] })).toBe(false);
    expect(isRecoverySnapshot({ ...snapshot, destinationIds: 'dest-1' })).toBe(false);
    expect(isRecoverySnapshot({ ...snapshot, masterAspectRatio: '4:3' })).toBe(false);
    expect(isRecoverySnapshot({ ...snapshot, recording: 1 })).toBe(false);
    expect(isRecoverySnapshot({ ...snapshot, momentId: 42 })).toBe(false);
    for (const value of NON_OBJECTS) expect(isRecoverySnapshot(value)).toBe(false);
  });
});

describe('isChunkPayload', () => {
  it('accepts an ArrayBuffer and a Uint8Array', () => {
    expect(isChunkPayload({ aspectRatio: '16:9', data: new ArrayBuffer(1024) })).toBe(true);
    expect(isChunkPayload({ aspectRatio: '9:16', data: new Uint8Array(1024) })).toBe(true);
  });

  it('rejects a string, an empty buffer, and an absurdly large one', () => {
    expect(isChunkPayload({ aspectRatio: '16:9', data: 'AAAA' })).toBe(false);
    expect(isChunkPayload({ aspectRatio: '16:9', data: new ArrayBuffer(0) })).toBe(false);
    expect(isChunkPayload({ aspectRatio: '16:9', data: new ArrayBuffer(65 * 1024 * 1024) })).toBe(false);
    expect(isChunkPayload({ aspectRatio: '4:3', data: new ArrayBuffer(10) })).toBe(false);
    for (const value of NON_OBJECTS) expect(isChunkPayload(value)).toBe(false);
  });
});
