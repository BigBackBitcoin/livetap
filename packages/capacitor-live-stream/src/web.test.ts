/**
 * Unit tests for the web fallback.
 *
 * There is nothing native to test on this host, but there IS a contract worth protecting: the web
 * build must fail loudly rather than silently pretending to stream. Every method that DOES
 * something throws; the two that only ANSWER something, `capabilities()` and `checkPermissions()`,
 * return honest negatives, because a UI is supposed to ask those before it commits to anything; and
 * `addListener` resolves so that UI which subscribes defensively does not blow up.
 */
import { describe, expect, it } from 'vitest';
import {
  LiveStreamNativeOnlyError,
  LiveStreamWeb,
  NATIVE_ONLY_MESSAGE,
} from './web.js';

const THROWING_METHODS = [
  'startPreview',
  'stopPreview',
  'switchCamera',
  'setMute',
  'startStream',
  'stopStream',
  'startRecording',
  'stopRecording',
] as const;

describe('LiveStreamWeb', () => {
  it('reports every capability as false and verification UNAVAILABLE', async () => {
    const caps = await new LiveStreamWeb().capabilities();

    expect(caps.verification).toBe('UNAVAILABLE');
    expect(caps.maxSimultaneousStreams).toBe(0);
    expect(caps.platformNote).toBe(NATIVE_ONLY_MESSAGE);
    for (const [key, value] of Object.entries(caps)) {
      if (typeof value === 'boolean') {
        expect(value, `${key} must be false on web`).toBe(false);
      }
    }
  });

  it('throws LiveStreamNativeOnlyError from every streaming method, naming the method', async () => {
    const web = new LiveStreamWeb() as unknown as Record<
      string,
      (arg?: unknown) => Promise<unknown>
    >;

    for (const method of THROWING_METHODS) {
      const error = await web[method]?.({ muted: false }).catch((e: unknown) => e);
      expect(error, `${method} must reject`).toBeInstanceOf(LiveStreamNativeOnlyError);
      expect((error as LiveStreamNativeOnlyError).method).toBe(method);
      expect((error as Error).message).toContain(NATIVE_ONLY_MESSAGE);
    }
  });

  it('never leaks a stream key in the native-only error, because it never receives one it keeps', async () => {
    const web = new LiveStreamWeb();
    let message = '';
    try {
      await web.startStream({
        url: 'rtmps://a.rtmps.youtube.com/live2',
        streamKey: 'super-secret-key',
        videoKbps: 4500,
        audioKbps: 128,
        width: 1080,
        height: 1920,
        fps: 30,
        keyframeSeconds: 2,
      });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('startStream');
    expect(message).not.toContain('super-secret-key');
  });

  it('answers the permission questions with an honest denial instead of throwing', async () => {
    const web = new LiveStreamWeb();

    // A UI that asks before previewing has to get a usable answer in a browser too. `denied` sends
    // it down the "this needs the app" path; throwing would send it down an error path that is not
    // what happened.
    await expect(web.checkPermissions()).resolves.toEqual({
      camera: 'denied',
      microphone: 'denied',
      notifications: 'denied',
    });
    await expect(web.requestPermissions({ permissions: ['camera'] })).resolves.toEqual({
      camera: 'denied',
      microphone: 'denied',
      notifications: 'denied',
    });
  });

  it('resolves addListener with a removable handle instead of throwing', async () => {
    const handle = await new LiveStreamWeb().addListener('streamState', () => undefined);

    expect(typeof handle.remove).toBe('function');
    await expect(handle.remove()).resolves.toBeUndefined();
  });
});
