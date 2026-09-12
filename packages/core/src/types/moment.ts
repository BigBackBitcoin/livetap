/**
 * Moments: the beginner-friendly abstraction over scenes.
 * A Moment is a named arrangement of layers plus an audio state.
 * Pro Mode exposes the underlying layer (scene/source) graph.
 */

import type { AspectRatio } from './destination.js';

export type LayerKind =
  | 'camera'
  | 'screen'
  | 'window'
  | 'image'
  | 'video'
  | 'text'
  | 'browser'
  | 'overlay'
  | 'color';

/** Normalized rectangle in 0..1 canvas space so a Moment adapts to any aspect ratio. */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerBase {
  id: string;
  kind: LayerKind;
  name: string;
  visible: boolean;
  /** Placement per aspect ratio; `default` applies when a specific ratio is absent. */
  placement: Partial<Record<AspectRatio, NormalizedRect>> & { default: NormalizedRect };
  opacity: number;
  /** Z-order; higher renders on top. */
  z: number;
  /** Rounded corners in px at 1080p reference. */
  radius?: number;
  /** Object-fit behaviour for media layers. */
  fit?: 'cover' | 'contain' | 'fill';
  /** Mirror horizontally (selfie cams). */
  mirror?: boolean;
}

export interface CameraLayer extends LayerBase {
  kind: 'camera';
  /** Device id, or 'default'. */
  deviceId: string;
}

export interface ScreenLayer extends LayerBase {
  kind: 'screen' | 'window';
  /** Source id from the capture provider, or 'prompt' to ask the OS. */
  sourceId: string;
  captureSystemAudio: boolean;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  src: string;
}

export interface VideoLayer extends LayerBase {
  kind: 'video';
  src: string;
  loop: boolean;
  muted: boolean;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  background?: string;
  align: 'left' | 'center' | 'right';
  weight: 400 | 500 | 600 | 700 | 800;
}

export interface BrowserLayer extends LayerBase {
  kind: 'browser';
  /** Restricted to https: URLs; validated by the engine before loading. */
  url: string;
  widthPx: number;
  heightPx: number;
}

export interface OverlayLayer extends LayerBase {
  kind: 'overlay';
  /** Built-in overlay preset id (lower-third, frame, badge...). */
  preset: string;
  props: Record<string, string | number | boolean>;
}

export interface ColorLayer extends LayerBase {
  kind: 'color';
  color: string;
}

export type Layer =
  | CameraLayer
  | ScreenLayer
  | ImageLayer
  | VideoLayer
  | TextLayer
  | BrowserLayer
  | OverlayLayer
  | ColorLayer;

export interface AudioState {
  micDeviceId: string | 'default' | 'none';
  micMuted: boolean;
  micGain: number; // 0..2
  systemAudio: boolean;
  systemGain: number;
  /** Basic processing toggles (Pro can tune parameters). */
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGain: boolean;
  monitor: boolean;
}

export type TransitionKind = 'cut' | 'fade' | 'slide' | 'zoom';

export interface Moment {
  id: string;
  name: string;
  /** Emoji or icon key used in the Moment strip. */
  icon: string;
  layers: Layer[];
  audio: AudioState;
  transition: { kind: TransitionKind; durationMs: number };
  /** Optional hotkey (Pro). */
  hotkey?: string;
  /** Built-in Moments cannot be deleted, only edited/reset. */
  builtIn: boolean;
}
