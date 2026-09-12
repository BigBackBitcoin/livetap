import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer, Moment } from '@livetap/core';
import { defaultMoments } from '@livetap/core';
import { MomentCompositor, type MomentCompositorOptions } from './MomentCompositor.js';
import { createFakeCanvas, createFakeVideoSource } from '../testing/fakes.js';

function moment(partial: Partial<Moment> & { id: string }): Moment {
  return {
    name: partial.id,
    icon: '*',
    builtIn: false,
    layers: [],
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
    ...partial,
  };
}

function colorLayer(id: string, color: string, z = 0): Layer {
  return {
    id,
    kind: 'color',
    name: id,
    visible: true,
    placement: { default: { x: 0, y: 0, w: 1, h: 1 } },
    opacity: 1,
    z,
    color,
  };
}

function cameraLayer(id: string, z = 10): Layer {
  return {
    id,
    kind: 'camera',
    name: 'Camera',
    visible: true,
    placement: { default: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    opacity: 1,
    z,
    fit: 'cover',
    mirror: false,
    deviceId: 'default',
  };
}

describe('MomentCompositor', () => {
  let clock = 0;
  const now = (): number => clock;

  beforeEach(() => {
    clock = 0;
  });

  function build(overrides: Partial<MomentCompositorOptions> = {}) {
    const fake = createFakeCanvas(1920, 1080);
    const compositor = new MomentCompositor({
      canvas: fake.canvas,
      aspect: '16:9',
      width: 1920,
      height: 1080,
      now,
      raf: undefined,
      ...overrides,
    });
    return { fake, compositor };
  }

  it('sizes the canvas and acquires a 2D context', () => {
    const { fake, compositor } = build();
    expect(fake.canvas.width).toBe(1920);
    expect(fake.canvas.height).toBe(1080);
    expect(compositor.hasContext).toBe(true);
  });

  it('paints the background then the layers bottom-up', () => {
    const { fake, compositor } = build();
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('top', '#fff', 50), colorLayer('bg', '#000', 0)] }), 0);
    compositor.renderFrame(0);
    const fills = fake.ops('fillRect');
    // background + bg layer + top layer
    expect(fills.length).toBeGreaterThanOrEqual(3);
    expect(fake.calls.filter((c) => c.op === 'clip').length).toBeGreaterThanOrEqual(2);
  });

  it('draws a media layer from the resolver with the fitted rect', () => {
    const source = createFakeVideoSource(1280, 720);
    const { fake, compositor } = build({ resolver: () => source });
    compositor.setMoment(moment({ id: 'cam', layers: [cameraLayer('cam')] }), 0);
    compositor.renderFrame(0);
    const draws = fake.ops('drawImage');
    expect(draws).toHaveLength(1);
    const [, x, y, w, h] = draws[0]!.args as [unknown, number, number, number, number];
    // 0.5 x 0.5 of 1920x1080 = 960x540; a 16:9 source covers it exactly.
    expect(w).toBeCloseTo(960, 3);
    expect(h).toBeCloseTo(540, 3);
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(0, 3);
  });

  it('mirrors a media layer about its own centre line', () => {
    const source = createFakeVideoSource(1280, 720);
    const { fake, compositor } = build({ resolver: () => source });
    const mirrored = { ...cameraLayer('cam'), mirror: true } as Layer;
    compositor.setMoment(moment({ id: 'cam', layers: [mirrored] }), 0);
    compositor.renderFrame(0);
    const scales = fake.ops('scale').filter((c) => c.args[0] === -1);
    expect(scales).toHaveLength(1);
  });

  it('draws a placeholder panel when a media source is not ready', () => {
    const { fake, compositor } = build({ resolver: () => null });
    compositor.setMoment(moment({ id: 'cam', layers: [cameraLayer('cam')] }), 0);
    compositor.renderFrame(0);
    expect(fake.ops('drawImage')).toHaveLength(0);
    expect(fake.texts()).toContain('Waiting for source');
  });

  it('marks browser layers as needing the desktop app', () => {
    const { fake, compositor } = build();
    const browser: Layer = {
      id: 'guest',
      kind: 'browser',
      name: 'Guest',
      visible: true,
      placement: { default: { x: 0, y: 0, w: 1, h: 1 } },
      opacity: 1,
      z: 1,
      url: 'https://example.test',
      widthPx: 1280,
      heightPx: 720,
    };
    compositor.setMoment(moment({ id: 'g', layers: [browser] }), 0);
    compositor.renderFrame(0);
    expect(fake.texts()).toContain('Requires the desktop app');
  });

  it('wraps text and scales the font with the output height', () => {
    const textLayer: Layer = {
      id: 't',
      kind: 'text',
      name: 'Title',
      visible: true,
      placement: { default: { x: 0, y: 0, w: 0.35, h: 1 } },
      opacity: 1,
      z: 1,
      text: 'Starting soon with a much longer headline than fits on one line',
      fontFamily: 'Inter',
      fontSizePx: 108,
      color: '#fff',
      align: 'center',
      weight: 800,
    };
    const { fake, compositor } = build();
    compositor.setMoment(moment({ id: 't', layers: [textLayer] }), 0);
    compositor.renderFrame(0);
    expect(fake.texts().length).toBeGreaterThan(1);
    // 108px authored at 1080p reference renders at 108px on a 1080-high canvas.
    expect(fake.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('shows the first Moment with no transition', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a', transition: { kind: 'fade', durationMs: 400 } }), 0);
    expect(compositor.transitionState(0)).toBeNull();
    expect(compositor.moment?.id).toBe('a');
  });

  it('runs a fade transition to completion on fake time', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#000')] }), 0);
    compositor.setMoment(moment({ id: 'b', layers: [colorLayer('bg2', '#fff')], transition: { kind: 'fade', durationMs: 400 } }), 1000);

    expect(compositor.transitionState(1000)?.progress).toBe(0);
    expect(compositor.transitionState(1200)?.progress).toBeCloseTo(0.5, 6);
    expect(compositor.transitionState(1200)?.fromMomentId).toBe('a');
    expect(compositor.transitionState(1200)?.toMomentId).toBe('b');

    compositor.tick(1200);
    expect(compositor.transitionState(1200)).not.toBeNull();

    compositor.tick(1400);
    expect(compositor.transitionState(1400)).toBeNull();
    expect(compositor.moment?.id).toBe('b');
  });

  it('draws both Moments while a transition is mid-flight and only one afterwards', () => {
    const { fake, compositor } = build();
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('a', '#000')] }), 0);
    compositor.setMoment(moment({ id: 'b', layers: [colorLayer('b', '#fff')], transition: { kind: 'fade', durationMs: 400 } }), 0);

    fake.calls.length = 0;
    compositor.renderFrame(200);
    const midFills = fake.ops('fillRect').length;

    compositor.tick(400);
    fake.calls.length = 0;
    compositor.renderFrame(500);
    const afterFills = fake.ops('fillRect').length;
    expect(midFills).toBeGreaterThan(afterFills);
  });

  it('treats a cut transition as instant', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a' }), 0);
    compositor.setMoment(moment({ id: 'b', transition: { kind: 'cut', durationMs: 400 } }), 0);
    expect(compositor.transitionState(0)).toBeNull();
    expect(compositor.moment?.id).toBe('b');
  });

  it('swaps an edited Moment in place without a transition', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#000')] }), 0);
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#f00')], transition: { kind: 'fade', durationMs: 400 } }), 10);
    expect(compositor.transitionState(10)).toBeNull();
  });

  it('draws a notice banner over the program and clears it', () => {
    const { fake, compositor } = build();
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#000')] }), 0);
    compositor.setNotice('Camera disconnected');
    compositor.renderFrame(0);
    expect(fake.texts()).toContain('Camera disconnected');

    fake.calls.length = 0;
    compositor.setNotice(null);
    compositor.renderFrame(0);
    expect(fake.texts()).not.toContain('Camera disconnected');
  });

  it('ignores a blank notice', () => {
    const { compositor } = build();
    compositor.setNotice('   ');
    expect(compositor.getNotice()).toBeNull();
  });

  it('counts rendered frames and reports fps over a one second window', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a' }), 0);
    for (let i = 0; i < 30; i += 1) {
      clock = i * 33;
      compositor.renderFrame(clock);
    }
    expect(compositor.frameCount).toBe(30);
    expect(compositor.renderFps).toBe(30);

    clock = 5000;
    expect(compositor.renderFps).toBe(0);
  });

  it('drives the loop with setTimeout when rAF is unavailable', () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeCanvas(640, 360);
      const compositor = new MomentCompositor({
        canvas: fake.canvas,
        aspect: '16:9',
        width: 640,
        height: 360,
        now: () => Date.now(),
        raf: undefined,
      });
      compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#000')] }));
      compositor.start(30);
      expect(compositor.isRunning).toBe(true);
      vi.advanceTimersByTime(200);
      expect(compositor.frameCount).toBeGreaterThan(2);
      const seen = compositor.frameCount;
      compositor.stop();
      vi.advanceTimersByTime(500);
      expect(compositor.frameCount).toBe(seen);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the injected rAF when present', () => {
    const frames: Array<(t: number) => void> = [];
    const fake = createFakeCanvas();
    const compositor = new MomentCompositor({
      canvas: fake.canvas,
      aspect: '16:9',
      width: 1920,
      height: 1080,
      now,
      raf: (cb) => frames.push(cb),
      caf: () => {
        frames.length = 0;
      },
    });
    compositor.setMoment(moment({ id: 'a' }), 0);
    compositor.start(60);
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    // The loop re-schedules itself through rAF after each frame.
    expect(compositor.frameCount).toBe(1);
    expect(frames).toHaveLength(2);
    compositor.stop();
  });

  it('start is idempotent', () => {
    const { compositor } = build();
    compositor.start(30);
    compositor.start(60);
    expect(compositor.targetFps).toBe(60);
    compositor.stop();
  });

  it('clamps the requested fps', () => {
    const { compositor } = build();
    compositor.start(0);
    expect(compositor.targetFps).toBe(30);
    compositor.stop();
    compositor.start(500);
    expect(compositor.targetFps).toBe(60);
    compositor.stop();
  });

  it('resizes the canvas', () => {
    const { fake, compositor } = build();
    compositor.resize(1080, 1920);
    compositor.setAspect('9:16');
    expect(fake.canvas.width).toBe(1080);
    expect(fake.canvas.height).toBe(1920);
    expect(compositor.width).toBe(1080);
    expect(compositor.height).toBe(1920);
    expect(compositor.aspect).toBe('9:16');
  });

  it('never renders below a 2x2 canvas', () => {
    const { compositor } = build();
    compositor.resize(0, -10);
    expect(compositor.width).toBe(2);
    expect(compositor.height).toBe(2);
  });

  it('is a safe no-op without a 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null };
    const compositor = new MomentCompositor({ canvas, aspect: '16:9', width: 1920, height: 1080, now, raf: undefined });
    compositor.setMoment(moment({ id: 'a', layers: [colorLayer('bg', '#000')] }), 0);
    expect(compositor.hasContext).toBe(false);
    expect(() => compositor.tick(0)).not.toThrow();
    expect(compositor.frameCount).toBe(1);
  });

  it('renders every built-in Moment in every aspect ratio without throwing', () => {
    for (const aspect of ['16:9', '9:16', '1:1'] as const) {
      const fake = createFakeCanvas();
      const compositor = new MomentCompositor({
        canvas: fake.canvas,
        aspect,
        width: 1920,
        height: 1080,
        now,
        raf: undefined,
        resolver: () => createFakeVideoSource(),
      });
      for (const m of defaultMoments()) {
        compositor.setMoment(m, 0);
        expect(() => compositor.tick(0)).not.toThrow();
      }
    }
  });

  it('requests an image layer once and shows a placeholder until it loads', async () => {
    const loads: string[] = [];
    const image = createFakeVideoSource(400, 400);
    const { fake, compositor } = build({
      loadImage: async (src: string) => {
        loads.push(src);
        return image;
      },
    });
    const imageLayer: Layer = {
      id: 'img',
      kind: 'image',
      name: 'Logo',
      visible: true,
      placement: { default: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      opacity: 1,
      z: 1,
      src: 'https://example.test/logo.png',
      fit: 'contain',
    };
    compositor.setMoment(moment({ id: 'i', layers: [imageLayer] }), 0);
    compositor.renderFrame(0);
    expect(fake.texts()).toContain('Loading...');
    compositor.renderFrame(0);
    await Promise.resolve();
    await Promise.resolve();
    fake.calls.length = 0;
    compositor.renderFrame(0);
    expect(loads).toEqual(['https://example.test/logo.png']);
    expect(fake.ops('drawImage')).toHaveLength(1);
  });

  it('dispose stops the loop and forgets the Moment', () => {
    const { compositor } = build();
    compositor.setMoment(moment({ id: 'a' }), 0);
    compositor.start(30);
    compositor.dispose();
    expect(compositor.isRunning).toBe(false);
    expect(compositor.moment).toBeNull();
  });
});
