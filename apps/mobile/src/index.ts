/**
 * @livetap/mobile — public surface of the Capacitor mobile app.
 *
 * The React UI lives in @livetap/web and is loaded into the WebView; this package contributes the
 * native plugin contract and the MediaEngine implementation that sits on top of it.
 */
export { LiveStream, LiveStreamNativeOnlyError, NATIVE_ONLY_MESSAGE } from './plugins/LiveStream/index.js';
export type {
  DeviceLostEvent,
  LiveStreamAspect,
  LiveStreamCamera,
  LiveStreamCapabilities,
  LiveStreamPlugin,
  LiveStreamState,
  SetMuteOptions,
  StartPreviewOptions,
  StartRecordingResult,
  StartStreamOptions,
  StartStreamResult,
  StopRecordingResult,
  StopStreamOptions,
  StreamStateEvent,
  ThermalEvent,
} from './plugins/LiveStream/definitions.js';
export { LiveStreamWeb } from './plugins/LiveStream/web.js';
export { MobileEngine } from './MobileEngine.js';
export type { MobileEngineOptions, MobilePlatform } from './MobileEngine.js';
