import type { AudioState, Layer, Moment, NormalizedRect } from '../types/moment.js';

const FULL: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_AUDIO: AudioState = {
  micDeviceId: 'default',
  micMuted: false,
  micGain: 1,
  systemAudio: false,
  systemGain: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGain: true,
  monitor: false,
};

function camera(id: string, placement: Layer['placement'], extra: Partial<Layer> = {}): Layer {
  return {
    id,
    kind: 'camera',
    name: 'Camera',
    visible: true,
    placement,
    opacity: 1,
    z: 10,
    fit: 'cover',
    mirror: true,
    deviceId: 'default',
    ...extra,
  } as Layer;
}

function text(id: string, value: string, placement: Layer['placement'], fontSizePx = 96): Layer {
  return {
    id,
    kind: 'text',
    name: 'Title',
    visible: true,
    placement,
    opacity: 1,
    z: 50,
    text: value,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePx,
    color: '#FFFFFF',
    align: 'center',
    weight: 800,
  };
}

function color(id: string, value: string): Layer {
  return { id, kind: 'color', name: 'Background', visible: true, placement: { default: FULL }, opacity: 1, z: 0, color: value };
}

/**
 * Six built-in Moments. Placement is normalized so every Moment works in 16:9, 9:16 and 1:1.
 */
export function defaultMoments(): Moment[] {
  return [
    {
      id: 'starting-soon',
      name: 'Starting Soon',
      icon: '⏳',
      builtIn: true,
      transition: { kind: 'fade', durationMs: 400 },
      audio: { ...DEFAULT_AUDIO, micMuted: true },
      layers: [
        color('bg', '#0B0F19'),
        text('title', 'Starting soon', { default: { x: 0.1, y: 0.38, w: 0.8, h: 0.24 } }, 120),
        camera('cam', { default: { x: 0.78, y: 0.72, w: 0.18, h: 0.24 }, '9:16': { x: 0.6, y: 0.78, w: 0.34, h: 0.18 } }, { radius: 24, visible: false }),
      ],
    },
    {
      id: 'main-camera',
      name: 'Main Camera',
      icon: '🎥',
      builtIn: true,
      transition: { kind: 'fade', durationMs: 300 },
      audio: { ...DEFAULT_AUDIO },
      layers: [camera('cam', { default: FULL })],
    },
    {
      id: 'screen-share',
      name: 'Screen Share',
      icon: '🖥️',
      builtIn: true,
      transition: { kind: 'fade', durationMs: 300 },
      audio: { ...DEFAULT_AUDIO, systemAudio: true },
      layers: [
        color('bg', '#0B0F19'),
        {
          id: 'screen',
          kind: 'screen',
          name: 'Screen',
          visible: true,
          placement: { default: FULL, '9:16': { x: 0, y: 0.2, w: 1, h: 0.4 } },
          opacity: 1,
          z: 5,
          fit: 'contain',
          sourceId: 'prompt',
          captureSystemAudio: true,
        },
        camera('cam', { default: { x: 0.74, y: 0.7, w: 0.22, h: 0.26 }, '9:16': { x: 0.1, y: 0.62, w: 0.8, h: 0.3 } }, { radius: 20 }),
      ],
    },
    {
      id: 'guest',
      name: 'Guest',
      icon: '👥',
      builtIn: true,
      transition: { kind: 'slide', durationMs: 350 },
      audio: { ...DEFAULT_AUDIO },
      layers: [
        color('bg', '#0B0F19'),
        camera('cam', { default: { x: 0.02, y: 0.15, w: 0.47, h: 0.7 }, '9:16': { x: 0.05, y: 0.06, w: 0.9, h: 0.42 } }, { radius: 20 }),
        {
          id: 'guest',
          kind: 'browser',
          name: 'Guest',
          visible: true,
          placement: { default: { x: 0.51, y: 0.15, w: 0.47, h: 0.7 }, '9:16': { x: 0.05, y: 0.52, w: 0.9, h: 0.42 } },
          opacity: 1,
          z: 10,
          radius: 20,
          url: 'https://',
          widthPx: 1280,
          heightPx: 720,
        },
      ],
    },
    {
      id: 'break',
      name: 'Break',
      icon: '☕',
      builtIn: true,
      transition: { kind: 'fade', durationMs: 500 },
      audio: { ...DEFAULT_AUDIO, micMuted: true },
      layers: [color('bg', '#101828'), text('title', 'Back in a moment', { default: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } }, 96)],
    },
    {
      id: 'ending',
      name: 'Ending',
      icon: '👋',
      builtIn: true,
      transition: { kind: 'fade', durationMs: 600 },
      audio: { ...DEFAULT_AUDIO, micMuted: false },
      layers: [color('bg', '#0B0F19'), text('title', 'Thanks for watching', { default: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 } }, 96)],
    },
  ];
}

export function findLayer<K extends Layer['kind']>(moment: Moment, kind: K): Extract<Layer, { kind: K }> | undefined {
  return moment.layers.find((l): l is Extract<Layer, { kind: K }> => l.kind === kind);
}
