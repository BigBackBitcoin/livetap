/**
 * @livetap/mobile — public surface of the Capacitor mobile app.
 *
 * The React UI lives in @livetap/web and is loaded into the WebView. What this package contributes
 * is `MobileEngine`, the `MediaEngine` implementation that adapts the native plugin to core's
 * contract.
 *
 * The plugin itself is no longer here: it is the workspace package
 * `@livetap/capacitor-live-stream`, so `cap sync` discovers and registers it on both platforms
 * (docs/architecture/MOBILE_ARCHITECTURE.md §3). Its surface is re-exported below so that existing
 * `@livetap/mobile` importers keep working and there is still one import path for "the mobile
 * streaming API".
 */
export {
  LiveStream,
  LiveStreamNativeOnlyError,
  LiveStreamWeb,
  NATIVE_ONLY_MESSAGE,
} from '@livetap/capacitor-live-stream';
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
} from '@livetap/capacitor-live-stream';
export { MobileEngine } from './MobileEngine.js';
export type { MobileEngineOptions, MobilePlatform } from './MobileEngine.js';
