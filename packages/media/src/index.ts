/**
 * @livetap/media - the browser-side media engine, the Moment compositor and a deterministic mock.
 *
 * See docs/architecture/MEDIA_ENGINE.md for the layering (BrowserEngine / FfmpegEngine / MockEngine),
 * the single-encode-per-format rule and the WHIP relay model.
 */

// Compositor
export { MomentCompositor, roundedRectPath } from './compositor/MomentCompositor.js';
export type { MomentCompositorOptions, TransitionState } from './compositor/MomentCompositor.js';
export {
  REFERENCE_HEIGHT,
  clampRadius,
  computeFitRect,
  orderLayers,
  resolvePlacement,
  scaleForHeight,
  toPixelRect,
  visibleLayers,
} from './compositor/placement.js';
export type { FitMode, HasPlacement, PixelRect } from './compositor/placement.js';
export {
  IDENTITY_TRANSFORM,
  computeTransitionFrame,
  easeInOutCubic,
  transitionProgress,
} from './compositor/transitions.js';
export type { TransitionFrame, TransitionTransform } from './compositor/transitions.js';
export { approximateWidth, wrapText } from './compositor/text.js';
export type { MeasureText, WrapOptions } from './compositor/text.js';
export { isDrawable, sourceDimensions } from './compositor/types.js';
export type { CompositorCanvas, DrawableSource, MediaSourceResolver } from './compositor/types.js';

// Browser engine
export { BrowserEngine, cloneMoment, readOutboundSample, relayEndpoint } from './browser/BrowserEngine.js';
export {
  MP4_MIME_CANDIDATES,
  WEBM_MIME_CANDIDATES,
  pickRecordingMime,
  probablySupportsDisplayAudio,
  resolveDeps,
} from './browser/deps.js';
export type {
  AudioContextCtorLike,
  AudioContextLike,
  BrowserEngineOptions,
  DisplayMediaOptions,
  GainNodeLike,
  GetDisplayMediaLike,
  MediaDevicesLike,
  MediaRecorderCtorLike,
  MediaRecorderLike,
  RelayOptions,
  ResolvedDeps,
  VideoEncoderProbeLike,
} from './browser/deps.js';

// WHIP
export { WhipClient, WhipError, buildIceFragment, codeForStatus, parseLinkIceServers, resolveLocation } from './whip/WhipClient.js';
export type {
  FetchLike,
  FetchRequestInit,
  FetchResponseLike,
  RTCPeerConnectionCtor,
  WhipClientOptions,
  WhipEvents,
} from './whip/WhipClient.js';

// Mock engine
export { MockEngine, mulberry32 } from './mock/MockEngine.js';
export type { MockEngineOptions, MockScenario } from './mock/MockEngine.js';

import type { MediaEngine } from '@livetap/core';
import { BrowserEngine } from './browser/BrowserEngine.js';
import type { BrowserEngineOptions } from './browser/deps.js';
import { MockEngine } from './mock/MockEngine.js';
import type { MockEngineOptions } from './mock/MockEngine.js';

export interface EngineEnvironmentOptions {
  /** Force the mock (demo mode, E2E, Storybook). */
  preferMock?: boolean;
  browser?: BrowserEngineOptions;
  mock?: MockEngineOptions;
}

/**
 * Pick the engine this environment can actually run.
 *
 * MockEngine when explicitly preferred, or when there is no `navigator.mediaDevices` at all
 * (SSR, a test runner, an insecure origin) - so the UI always has a working engine and never
 * has to special-case "no media".
 */
export function createEngineForEnvironment(options: EngineEnvironmentOptions = {}): MediaEngine {
  if (options.preferMock || !hasMediaDevices()) return new MockEngine(options.mock);
  return new BrowserEngine(options.browser);
}

function hasMediaDevices(): boolean {
  const nav = (globalThis as { navigator?: { mediaDevices?: { getUserMedia?: unknown } } }).navigator;
  return typeof nav?.mediaDevices?.getUserMedia === 'function';
}
