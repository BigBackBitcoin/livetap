import { describe, expect, it } from 'vitest';
import type { AspectRatio, Layer, Moment, OutputFormat } from '@livetap/core';
import { formatForPreset } from '@livetap/core';
import { FormatRenderer } from './FormatRenderer.js';
import { createFakeCanvas, createFakeVideoSource } from '../testing/fakes.js';

function moment(id = 'main'): Moment {
  const camera: Layer = {
    id: 'cam',
    kind: 'camera',
    name: 'Camera',
    visible: true,
    // A landscape inset with a vertical override: the whole point of composing per format.
    placement: { default: { x: 0.7, y: 0.7, w: 0.25, h: 0.25 }, '9:16': { x: 0.1, y: 0.1, w: 0.8, h: 0.3 } },
    opacity: 1,
    z: 10,
    fit: 'cover',
    mirror: false,
    deviceId: 'default',
  };
  return {
    id,
    name: id,
    icon: '*',
    builtIn: false,
    layers: [camera],
    audio: {
      micDeviceId: 'default',
      micMuted: false,
      micGain: 1,
      systemAudio: false,
      systemGain: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGain: true,
      monitor: false,
    },
    transition: { kind: 'cut', durationMs: 0 },
  };
}

function build(options: { audioTracks?: () => MediaStreamTrack[] } = {}) {
  const canvases: Array<ReturnType<typeof createFakeCanvas>> = [];
  const source = createFakeVideoSource(1280, 720);
  const renderer = new FormatRenderer({
    createCanvas: (width, height) => {
      const fake = createFakeCanvas(width, height);
      canvases.push(fake);
      return fake.canvas;
    },
    resolver: () => source,
    now: () => 0,
    raf: undefined,
    caf: undefined,
    ...options,
  });
  return { renderer, canvases };
}

/**
 * A renderer whose loop and clock the test owns, so "which formats were composed in which task"
 * is an observable fact rather than a matter of timing.
 */
function buildDriven() {
  const canvases: Array<ReturnType<typeof createFakeCanvas>> = [];
  const source = createFakeVideoSource(1280, 720);
  let clock = 0;
  const pending: Array<(t: number) => void> = [];
  const renderer = new FormatRenderer({
    createCanvas: (width, height) => {
      const fake = createFakeCanvas(width, height);
      canvases.push(fake);
      return fake.canvas;
    },
    resolver: () => source,
    now: () => clock,
    raf: (cb) => {
      pending.push(cb);
      return pending.length;
    },
    caf: () => {
      pending.length = 0;
    },
  });
  /** Advance to `at` and deliver exactly one animation frame. */
  const frame = (at: number): void => {
    clock = at;
    const next = pending.pop();
    pending.length = 0;
    next?.(at);
  };
  return { renderer, canvases, frame };
}

const F: Record<AspectRatio, OutputFormat> = {
  '16:9': formatForPreset('1080p30', '16:9'),
  '9:16': formatForPreset('1080p30', '9:16'),
  '1:1': formatForPreset('1080p30', '1:1'),
};

describe('FormatRenderer', () => {
  it('composes one canvas per distinct aspect ratio at that format true dimensions', () => {
    const { renderer, canvases } = build();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '16:9', F['16:9']);

    expect(renderer.aspects).toEqual(['16:9', '9:16']);
    expect(canvases).toHaveLength(2);
    expect(renderer.compositorFor('16:9')).toMatchObject({ width: 1920, height: 1080 });
    expect(renderer.compositorFor('9:16')).toMatchObject({ width: 1080, height: 1920 });
  });

  it('always composes the master aspect even when no output asked for it', () => {
    const { renderer } = build();
    renderer.setFormats({ '9:16': F['9:16'] }, '16:9', F['16:9']);
    expect(renderer.aspects).toEqual(['16:9', '9:16']);
    expect(renderer.masterCompositor?.aspect).toBe('16:9');
  });

  it('draws each aspect with its own placement, not the master rectangle scaled', () => {
    const { renderer, canvases } = build();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0, { kind: 'cut', durationMs: 0 });
    renderer.compositorFor('16:9')?.renderFrame(0);
    renderer.compositorFor('9:16')?.renderFrame(0);

    const landscape = canvases[0]!.ops('clip').length > 0 ? canvases[0]! : canvases[1]!;
    const portrait = landscape === canvases[0] ? canvases[1]! : canvases[0]!;
    // 16:9 clips the camera to the 0.7/0.7 inset; 9:16 clips it to the 0.1/0.1 override.
    expect(landscape.ops('rect')[0]?.args.slice(0, 2)).toEqual([0.7 * 1920, 0.7 * 1080]);
    expect(portrait.ops('rect')[0]?.args.slice(0, 2)).toEqual([0.1 * 1080, 0.1 * 1920]);
  });

  it('captures each aspect at its own fps and attaches the shared audio tracks', () => {
    const audio = { kind: 'audio', id: 'mix' } as unknown as MediaStreamTrack;
    const { renderer, canvases } = build({ audioTracks: () => [audio] });
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '16:9', F['16:9']);
    renderer.start();

    const landscape = renderer.streamFor('16:9');
    const portrait = renderer.streamFor('9:16');
    expect(landscape).not.toBeNull();
    expect(portrait).not.toBeNull();
    expect(landscape).not.toBe(portrait);
    expect(canvases[0]!.captureStreamCalls).toEqual([30]);
    expect(canvases[1]!.captureStreamCalls).toEqual([30]);
    expect(landscape?.getAudioTracks()).toEqual([audio]);
    expect(portrait?.getAudioTracks()).toEqual([audio]);
  });

  it('returns the same stream on a second read rather than re-capturing the canvas', () => {
    const { renderer, canvases } = build();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.start();
    expect(renderer.streamFor('16:9')).toBe(renderer.streamFor('16:9'));
    expect(canvases[0]!.captureStreamCalls).toHaveLength(1);
  });

  it('returns null for an aspect it was never asked to compose, and never substitutes the master', () => {
    const { renderer } = build();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.start();
    expect(renderer.streamFor('1:1')).toBeNull();
    expect(renderer.compositorFor('1:1')).toBeNull();
  });

  it('refuses to start a capture while stopped, so a dead preview cannot look live', () => {
    const { renderer } = build();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    expect(renderer.streamFor('16:9')).toBeNull();
    renderer.start();
    expect(renderer.streamFor('16:9')).not.toBeNull();
    renderer.stop();
    renderer.releaseStreams();
    expect(renderer.streamFor('16:9')).toBeNull();
  });

  /**
   * The three formats of one camera frame must be composed in ONE task.
   *
   * This is a performance contract expressed as a correctness test, because it is invisible at
   * runtime and expensive when it breaks. Measured with `apps/web/scripts/perf-canvas.mjs` on a
   * GPU-less host: three draws of the same camera frame cost 10.5 ms + 8.1 ms + 8.1 ms when they
   * share a task, because the frame is converted once - and 11.4 ms each when they are scattered
   * across three animation frames. Independent per-compositor loops drift apart on their own, so
   * nothing but a single driver keeps this true.
   */
  it('composes every format of a frame inside one animation frame', () => {
    const { renderer, canvases, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'], '1:1': F['1:1'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0);
    renderer.start();

    const drawsSoFar = (): number[] => canvases.map((c) => c.ops('drawImage').length);
    frame(0);
    const afterFirst = drawsSoFar();
    expect(afterFirst).toHaveLength(3);
    // Every canvas advanced by the same single frame, in the same callback.
    expect(afterFirst.every((n) => n === afterFirst[0])).toBe(true);
    expect(afterFirst[0]).toBeGreaterThan(0);

    // A 30 fps format owes nothing 8 ms later, and nothing is what every format must draw.
    frame(8);
    expect(drawsSoFar()).toEqual(afterFirst);

    // A frame interval later they all move again, together.
    frame(34);
    const afterSecond = drawsSoFar();
    expect(afterSecond.every((n) => n === afterSecond[0])).toBe(true);
    expect(afterSecond[0]).toBe(afterFirst[0]! + 1);
    renderer.stop();
  });

  /**
   * The regression this test exists for, in one sentence: throttling a 30 fps format on a 31 Hz
   * display made the studio SLOWER.
   *
   * The first throttle used a tolerance of a quarter of the format's interval, which assumes the
   * display is the faster of the two. On a GPU-less VM whose animation frames arrive about every
   * 32 ms, a 33.3 ms interval meant roughly one frame in six was skipped - and the skipped frames
   * did not come back as headroom, they came back as more expensive remaining frames, because a
   * longer gap between draws of the same <video> means its frame is converted again. Five
   * interleaved A/B pairs put cost per composited copy at 8.85 ms before and 12.65 ms after, with
   * no frame rate gained. So: a display that is not faster than the format must never skip.
   */
  it('never skips a frame on a display no faster than the format', () => {
    const { renderer, canvases, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0);
    renderer.start();

    /*
     * A 31 Hz display against a 30 fps format - the case the first throttle got badly wrong, and
     * the case this build host actually is.
     *
     * The property is not "every animation frame composes": a 31 Hz display genuinely owes a 30 fps
     * format only about 30 of its 31 frames. The property is that the encoder is never materially
     * short-changed. 95% of target is the line, and the broken rule was nowhere near it - it threw
     * away one frame in six while making the survivors more expensive.
     */
    const period = 1000 / 31;
    const frames = 62;
    for (let i = 0; i < frames; i += 1) frame(Math.round(i * period));
    const delivered = canvases[0]!.ops('drawImage').length / ((frames * period) / 1000);
    expect(delivered).toBeGreaterThanOrEqual(30 * 0.95);
    renderer.stop();
  });

  it('skips only what captureStream would have discarded on a fast display', () => {
    const { renderer, canvases, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0);
    renderer.start();

    // A 120 Hz display against a 30 fps format: one frame in four is worth composing.
    for (let i = 0; i < 120; i += 1) frame(Math.round((i * 1000) / 120));
    const drawn = canvases[0]!.ops('drawImage').length;
    expect(drawn).toBeGreaterThanOrEqual(30);
    expect(drawn).toBeLessThanOrEqual(34);
    renderer.stop();
  });

  it('composes the master first, so the other formats reuse the frame it converted', () => {
    const { renderer, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '9:16', F['9:16']);
    renderer.setMoment(moment(), 0);
    const order: string[] = [];
    for (const aspect of ['16:9', '9:16'] as AspectRatio[]) {
      const compositor = renderer.compositorFor(aspect)!;
      const original = compositor.tick.bind(compositor);
      compositor.tick = (nowMs?: number): void => {
        order.push(aspect);
        original(nowMs);
      };
    }
    renderer.start();
    frame(0);
    expect(order).toEqual(['9:16', '16:9']);
    renderer.stop();
  });

  it('reports a driven compositor as running, because it is producing frames', () => {
    const { renderer, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0);
    renderer.start();
    frame(0);
    expect(renderer.compositorFor('16:9')?.isRunning).toBe(true);
    expect(renderer.compositorFor('16:9')?.targetFps).toBe(30);
    renderer.stop();
    expect(renderer.compositorFor('16:9')?.isRunning).toBe(false);
  });

  it('stops composing after stop, so a dead preview cannot keep painting', () => {
    const { renderer, canvases, frame } = buildDriven();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0);
    renderer.start();
    frame(0);
    const drawn = canvases[0]!.ops('drawImage').length;
    renderer.stop();
    frame(40);
    frame(80);
    expect(canvases[0]!.ops('drawImage').length).toBe(drawn);
  });

  it('drops an aspect that is no longer wanted and keeps the ones that are', () => {
    const { renderer } = build();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '16:9', F['16:9']);
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    expect(renderer.aspects).toEqual(['16:9']);
    expect(renderer.compositorFor('9:16')).toBeNull();
  });

  it('invalidates the capture when a format changes size, because a track keeps its dimensions', () => {
    const { renderer, canvases } = build();
    renderer.setFormats({ '16:9': F['16:9'] }, '16:9', F['16:9']);
    renderer.start();
    const first = renderer.streamFor('16:9');
    expect(first).not.toBeNull();
    renderer.setFormats({ '16:9': formatForPreset('720p30', '16:9') }, '16:9', formatForPreset('720p30', '16:9'));
    expect(renderer.streamFor('16:9')).not.toBeNull();
    expect(renderer.compositorFor('16:9')).toMatchObject({ width: 1280, height: 720 });
    // The old capture was stopped and a new one taken: a MediaStreamTrack keeps the size it was
    // created at, so reusing it would publish 1920x1080 out of a 1280x720 canvas.
    expect(canvases[0]!.stream.getVideoTracks().every((t) => t.readyState === 'ended')).toBe(true);
    expect(canvases[0]!.captureStreamCalls).toHaveLength(2);
  });

  it('shows the same Moment on every aspect at once', () => {
    const { renderer } = build();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'], '1:1': F['1:1'] }, '16:9', F['16:9']);
    renderer.setMoment(moment('break'), 0, { kind: 'cut', durationMs: 0 });
    for (const aspect of renderer.aspects) {
      expect(renderer.compositorFor(aspect)?.moment?.id).toBe('break');
    }
  });

  it('records an operator notice on every aspect without drawing it', () => {
    const { renderer, canvases } = build();
    renderer.setFormats({ '16:9': F['16:9'], '9:16': F['9:16'] }, '16:9', F['16:9']);
    renderer.setMoment(moment(), 0, { kind: 'cut', durationMs: 0 });
    renderer.setNotice('Camera disconnected');
    renderer.compositorFor('16:9')?.renderFrame(0);
    renderer.compositorFor('9:16')?.renderFrame(0);

    expect(renderer.getNotice()).toBe('Camera disconnected');
    for (const canvas of canvases) expect(canvas.texts()).not.toContain('Camera disconnected');
  });
});
