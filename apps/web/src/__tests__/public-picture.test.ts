import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPicture, coverCrop, drawSafeArea } from '../public/picture.js';
import type { ComposedLayer, PictureAssets } from '../public/picture.js';
import { mountOutputs } from '../public/outputs.js';
import type { OutputRow } from '../public/outputs.js';
import { DESTINATIONS, STATE_LABEL } from '../public/data.js';

/**
 * The picture engine, tested where it actually decides something.
 *
 * The audit that produced this module said the stage was "an empty grey rectangle with the word
 * Camera in the corner: I never saw a frame of video". Three of those four failures are
 * geometry, permission handling and state plumbing, so those are what is asserted here: the
 * centre crop that re-frames one production for a vertical platform, the chat-safe band that
 * makes the re-framing worth looking at, the two camera refusals that must leave the demo
 * picture standing, and the six figures the outputs view owes the page.
 */

const ASSETS: PictureAssets = {
  creator: { mp4: '/brand/creator.mp4', webm: '/brand/creator.webm', poster: '/brand/creator.webp' },
  guest: { mp4: '/brand/guest.mp4', webm: '/brand/guest.webm', poster: '/brand/guest.webp' },
  screen: '/brand/screen.svg',
};

type Call = unknown[];

interface FakeCtx {
  calls: Record<string, Call[]>;
  ctx: CanvasRenderingContext2D;
}

/** A 2D context that records rather than paints. Every method the engine can reach is here. */
function fakeCtx(): FakeCtx {
  const calls: Record<string, Call[]> = {};
  const rec =
    (name: string) =>
    (...args: Call): void => {
      (calls[name] ??= []).push(args);
    };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    clip: rec('clip'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    roundRect: rec('roundRect'),
    rect: rec('rect'),
    fillRect: rec('fillRect'),
    clearRect: rec('clearRect'),
    drawImage: rec('drawImage'),
    fillText: rec('fillText'),
    setTransform: rec('setTransform'),
    measureText: (t: string) => ({ width: t.length * 6 }),
    createLinearGradient: () => ({ addColorStop: (): void => {} }),
  } as unknown as CanvasRenderingContext2D;
  return { calls, ctx };
}

/** Give a video element the intrinsic size and readiness a decoded frame would give it. */
function decoded(v: HTMLVideoElement, w: number, h: number): void {
  Object.defineProperty(v, 'videoWidth', { value: w, configurable: true });
  Object.defineProperty(v, 'videoHeight', { value: h, configurable: true });
  Object.defineProperty(v, 'readyState', { value: 2, configurable: true });
}

const FULL: ComposedLayer = { kind: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 } };

function setSecure(on: boolean): void {
  Object.defineProperty(globalThis, 'isSecureContext', { value: on, configurable: true });
}

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator) as object,
  'mediaDevices',
);

afterEach(() => {
  vi.restoreAllMocks();
  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { ...originalMediaDevices, configurable: true });
  }
});

/* ------------------------------------------------------------------ the crop */

describe('compose() re-frames one production', () => {
  it('cover-crops a 16:9 source into 9:16 from the centre', () => {
    const picture = createPicture(ASSETS, { reduced: true });
    decoded(picture.main, 1280, 720);
    const { calls, ctx } = fakeCtx();

    picture.compose(ctx, 90, 160, [FULL]);

    const draw = calls.drawImage?.[0];
    expect(draw).toBeDefined();
    const [src, sx, sy, sw, sh, dx, dy, dw, dh] = draw as [
      unknown,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    expect(src).toBe(picture.main);
    /* 90x160 out of 1280x720: the window is 405x720, centred, so 437.5 is cut off each side. */
    expect(sw).toBeCloseTo(405, 6);
    expect(sh).toBeCloseTo(720, 6);
    expect(sx).toBeCloseTo(437.5, 6);
    expect(sy).toBeCloseTo(0, 6);
    expect([dx, dy, dw, dh]).toEqual([0, 0, 90, 160]);
  });

  it('takes the whole 16:9 frame when the output is 16:9', () => {
    const picture = createPicture(ASSETS, { reduced: true });
    decoded(picture.main, 1280, 720);
    const { calls, ctx } = fakeCtx();

    picture.compose(ctx, 176, 99, [FULL]);

    const [, sx, sy, sw, sh] = calls.drawImage?.[0] as [unknown, number, number, number, number];
    expect(sx).toBeCloseTo(0, 6);
    expect(sy).toBeCloseTo(0, 6);
    expect(sw).toBeCloseTo(1280, 6);
    expect(sh).toBeCloseTo(720, 6);
  });

  it('agrees with coverCrop, which is the only place the maths lives', () => {
    expect(coverCrop(1280, 720, 90, 160)).toEqual({ sx: 437.5, sy: 0, sw: 405, sh: 720 });
    expect(coverCrop(1280, 720, 120, 120)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
  });

  it('draws a placeholder rather than throwing when no frame has decoded yet', () => {
    const picture = createPicture(ASSETS, { reduced: true });
    const { calls, ctx } = fakeCtx();
    expect(() => picture.compose(ctx, 176, 99, [FULL])).not.toThrow();
    expect(calls.drawImage).toBeUndefined();
    expect(calls.fillRect?.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- the safe area */

describe('the chat-safe zone', () => {
  it('draws the bottom and trailing bands for 9:16, with a label', () => {
    const { calls, ctx } = fakeCtx();

    drawSafeArea(ctx, 90, 160, '9:16');

    const rects = (calls.fillRect ?? []) as number[][];
    const near = (a: number | undefined, b: number): boolean => Math.abs((a ?? NaN) - b) < 1e-6;
    /* SAFE_AREAS['9:16'] is bottom 0.28 and right 0.16: 44.8 px and 14.4 px at this size. */
    const bottom = rects.find((r) => near(r[1], 160 - 44.8) && near(r[3], 44.8));
    expect(bottom).toBeDefined();
    expect(bottom?.[0]).toBe(0);
    expect(bottom?.[2]).toBe(90);
    const right = rects.find((r) => near(r[0], 90 - 14.4) && near(r[2], 14.4));
    expect(right).toBeDefined();
    expect(calls.fillText?.[0]?.[0]).toBe('chat');
    expect(calls.stroke?.length).toBeGreaterThan(0);
  });

  it('is a smaller band for 16:9, which is the point of showing it', () => {
    const { calls, ctx } = fakeCtx();
    drawSafeArea(ctx, 176, 99, '16:9');
    const rects = (calls.fillRect ?? []) as number[][];
    const bottom = rects[0];
    expect(bottom?.[3]).toBeCloseTo(99 * 0.06, 6);
  });
});

/* ----------------------------------------------------------------- the camera */

describe('useCamera() never throws and never loses the demo picture', () => {
  it('resolves insecure when navigator.mediaDevices is absent', async () => {
    setMediaDevices(undefined);
    const picture = createPicture(ASSETS, { reduced: true });

    await expect(picture.useCamera()).resolves.toBe('insecure');
    expect(picture.source).toBe('demo');
  });

  it('resolves insecure on an insecure origin', async () => {
    setMediaDevices({ getUserMedia: () => Promise.resolve({}) });
    setSecure(false);
    const picture = createPicture(ASSETS, { reduced: true });

    await expect(picture.useCamera()).resolves.toBe('insecure');
    expect(picture.source).toBe('demo');
    setSecure(true);
  });

  it('resolves denied when getUserMedia rejects with NotAllowedError', async () => {
    setSecure(true);
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const getUserMedia = vi.fn().mockRejectedValue(err);
    setMediaDevices({ getUserMedia });
    const picture = createPicture(ASSETS, { reduced: true });
    const seen: string[] = [];
    picture.onChange((s) => seen.push(s));

    await expect(picture.useCamera()).resolves.toBe('denied');
    expect(picture.source).toBe('demo');
    expect(seen).toEqual([]);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
  });

  it('resolves unavailable when the device is simply not there', async () => {
    setSecure(true);
    const err = Object.assign(new Error('no device'), { name: 'NotFoundError' });
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(err) });
    const picture = createPicture(ASSETS, { reduced: true });

    await expect(picture.useCamera()).resolves.toBe('unavailable');
    expect(picture.source).toBe('demo');
  });

  it('switches to the camera when it is granted, and back on stopCamera()', async () => {
    setSecure(true);
    const stop = vi.fn();
    const stream = new MediaStream();
    stream.getTracks = () => [{ stop } as unknown as MediaStreamTrack];
    setMediaDevices({ getUserMedia: vi.fn().mockResolvedValue(stream) });
    const picture = createPicture(ASSETS, { reduced: true });
    const seen: string[] = [];
    picture.onChange((s) => seen.push(s));

    await expect(picture.useCamera()).resolves.toBe('granted');
    expect(picture.source).toBe('camera');
    expect(picture.main.srcObject).toBe(stream);
    expect(picture.main.querySelectorAll('source')).toHaveLength(0);
    expect(picture.main.classList.contains('is-mirrored')).toBe(true);

    picture.stopCamera();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(picture.source).toBe('demo');
    expect(picture.main.querySelectorAll('source')).toHaveLength(2);
    expect(picture.main.classList.contains('is-mirrored')).toBe(false);
    expect(seen).toEqual(['camera', 'demo']);
  });
});

/* ------------------------------------------------------------------ the layers */

describe('mount() fills the layers without touching their placement', () => {
  it('puts a video in the camera layer and leaves --lx alone', () => {
    const canvas = document.createElement('div');
    canvas.innerHTML = `
      <div class="ltp-layer" data-lt-layer="color"></div>
      <div class="ltp-layer" data-lt-layer="screen"><span>Screen</span></div>
      <div class="ltp-layer" data-lt-layer="camera"><span>Camera</span></div>
      <div class="ltp-layer" data-lt-layer="guest"><span>Guest</span></div>
      <p class="ltp-layer ltp-layer--text" data-lt-layer="text"></p>
    `;
    const cam = canvas.querySelector('[data-lt-layer="camera"]') as HTMLElement;
    cam.style.setProperty('--lx', '0.74');

    const picture = createPicture(ASSETS, { reduced: true });
    picture.mount(canvas);

    expect(cam.querySelector('video')).toBe(picture.main);
    expect(cam.textContent?.trim()).toBe('');
    expect(cam.style.getPropertyValue('--lx')).toBe('0.74');
    expect(canvas.querySelector('[data-lt-layer="guest"] video')).toBe(picture.guest);
    expect(canvas.querySelector('[data-lt-layer="screen"] img')?.getAttribute('src')).toBe(
      '/brand/screen.svg',
    );
    expect(
      (canvas.querySelector('[data-lt-layer="color"]') as HTMLElement).classList.contains(
        'ltp-layer--ground',
      ),
    ).toBe(true);
    expect(picture.videoFor('camera')).toBe(picture.main);
    expect(picture.videoFor('guest')).toBe(picture.guest);
  });
});

/* ----------------------------------------------------------------- the outputs */

function rowsFor(state: string): OutputRow[] {
  return DESTINATIONS.map((d) => ({
    id: d.id,
    name: d.name,
    format: d.preferred,
    ceilingMbps: d.ceilingMbps,
    state,
    stateLabel: STATE_LABEL[state as 'LIVE'],
    chipClass: state.toLowerCase(),
  }));
}

describe('mountOutputs() shows six outputs and keeps their state honest', () => {
  it('renders one figure per destination and updates the chips', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const picture = createPicture(ASSETS, { reduced: true });
    const outputs = mountOutputs(host, picture, { reduced: true, fps: 12 });

    outputs.update(rowsFor('DISCONNECTED'), () => [FULL]);

    const figures = host.querySelectorAll('figure.ltp-output');
    expect(figures).toHaveLength(6);
    expect(Array.from(figures).map((f) => (f as HTMLElement).dataset.ltOutput)).toEqual(
      DESTINATIONS.map((d) => d.id),
    );
    expect(host.querySelector('[data-lt-output="tiktok"] canvas')?.getAttribute('width')).toBe('90');
    expect(host.querySelector('[data-lt-output="youtube"] canvas')?.getAttribute('width')).toBe(
      '176',
    );
    const first = host.querySelector('[data-lt-output="youtube"]') as HTMLElement;
    expect(first.querySelector('[data-lt-out-chip]')?.className).toBe(
      'lt-chip lt-chip--disconnected',
    );
    expect(first.querySelector('[data-lt-out-label]')?.textContent).toBe('Not connected');
    expect(first.querySelector('[data-lt-out-meta]')?.textContent).toBe('16:9 · up to 40 Mbps');
    expect(first.classList.contains('is-off')).toBe(true);

    outputs.update(rowsFor('LIVE'), () => [FULL]);

    /* The same six figures, not six new ones: only the chips moved. */
    expect(host.querySelectorAll('figure.ltp-output')).toHaveLength(6);
    expect(host.querySelector('[data-lt-output="youtube"]')).toBe(first);
    expect(first.querySelector('[data-lt-out-chip]')?.className).toBe('lt-chip lt-chip--live');
    expect(first.querySelector('[data-lt-out-dot]')?.className).toBe('lt-dot lt-dot--pulse');
    expect(first.querySelector('[data-lt-out-label]')?.textContent).toBe('Live');
    expect(first.classList.contains('is-off')).toBe(false);

    outputs.destroy();
    expect(host.children).toHaveLength(0);
    host.remove();
  });

  it('asks for each row its own format, so one production leaves in three shapes', () => {
    /* happy-dom has no 2D context, so one is lent to every canvas for this test. Without it
       the draw path is never entered and the assertion below would pass vacuously. */
    const recorders: FakeCtx[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const f = fakeCtx();
      recorders.push(f);
      return f.ctx as unknown as RenderingContext;
    });

    const host = document.createElement('div');
    document.body.append(host);
    const picture = createPicture(ASSETS, { reduced: true });
    decoded(picture.main, 1280, 720);
    const outputs = mountOutputs(host, picture, { reduced: true });
    const asked: string[] = [];

    outputs.update(rowsFor('LIVE'), (format) => {
      asked.push(format);
      return [FULL];
    });

    /* Six destinations, and every one of them asked for the shape IT accepts. */
    expect(asked).toEqual(DESTINATIONS.map((d) => d.preferred));

    /* The vertical outputs carry the chat-safe band; the horizontal ones do not. */
    const tiktokAt = DESTINATIONS.findIndex((d) => d.id === 'tiktok');
    const youtubeAt = DESTINATIONS.findIndex((d) => d.id === 'youtube');
    expect(recorders[tiktokAt]?.calls.fillText?.some((c) => c[0] === 'chat')).toBe(true);
    expect(recorders[youtubeAt]?.calls.fillText?.some((c) => c[0] === 'chat') ?? false).toBe(false);

    /* And each one drew the same source, cropped to its own box. */
    const vertical = recorders[tiktokAt]?.calls.drawImage?.[0] as number[] | undefined;
    const horizontal = recorders[youtubeAt]?.calls.drawImage?.[0] as number[] | undefined;
    expect(vertical?.[3]).toBeCloseTo(405, 6);
    expect(horizontal?.[3]).toBeCloseTo(1280, 6);

    outputs.destroy();
    host.remove();
  });
});
