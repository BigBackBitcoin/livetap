/**
 * Web fallback for the LiveStream plugin.
 *
 * There is deliberately no browser implementation. A browser cannot open an RTMP socket, and
 * pretending otherwise would violate ADR-007 (never masquerade as production). The web app uses
 * `BrowserEngine` from @livetap/media, which publishes via WHIP to a relay instead.
 *
 * Every method throws the same explicit error so that a mis-wired build fails loudly in the
 * browser rather than silently doing nothing.
 */
import { WebPlugin } from '@capacitor/core';
import type {
  DeviceLostEvent,
  LiveStreamCapabilities,
  LiveStreamPlugin,
  SetMuteOptions,
  StartPreviewOptions,
  StartRecordingResult,
  StartStreamOptions,
  StartStreamResult,
  StopRecordingResult,
  StopStreamOptions,
  StreamStateEvent,
  ThermalEvent,
} from './definitions.js';
import type { PluginListenerHandle } from '@capacitor/core';

export const NATIVE_ONLY_MESSAGE =
  'LiveStream is native-only: a browser cannot publish RTMP. ' +
  'On the web LIVETAP uses BrowserEngine (getUserMedia + WHIP to a relay). ' +
  'See docs/architecture/MOBILE_ARCHITECTURE.md.';

export class LiveStreamNativeOnlyError extends Error {
  override readonly name = 'LiveStreamNativeOnlyError';
  readonly method: string;

  constructor(method: string) {
    super(`${NATIVE_ONLY_MESSAGE} (called ${method}())`);
    this.method = method;
  }
}

export class LiveStreamWeb extends WebPlugin implements LiveStreamPlugin {
  /**
   * The one method that answers instead of throwing: callers are supposed to ask "can this
   * environment stream natively?" and get an honest `false` rather than an exception.
   */
  async capabilities(): Promise<LiveStreamCapabilities> {
    return {
      camera: false,
      microphone: false,
      rtmp: false,
      rtmps: false,
      srt: false,
      hevc: false,
      recording: false,
      backgroundCamera: false,
      backgroundAudio: false,
      screenCapture: false,
      maxSimultaneousStreams: 0,
      verification: 'UNAVAILABLE',
      platformNote: NATIVE_ONLY_MESSAGE,
    };
  }

  async startPreview(_options: StartPreviewOptions): Promise<void> {
    throw new LiveStreamNativeOnlyError('startPreview');
  }

  async stopPreview(): Promise<void> {
    throw new LiveStreamNativeOnlyError('stopPreview');
  }

  async switchCamera(): Promise<void> {
    throw new LiveStreamNativeOnlyError('switchCamera');
  }

  async setMute(_options: SetMuteOptions): Promise<void> {
    throw new LiveStreamNativeOnlyError('setMute');
  }

  async startStream(_options: StartStreamOptions): Promise<StartStreamResult> {
    throw new LiveStreamNativeOnlyError('startStream');
  }

  async stopStream(_options: StopStreamOptions): Promise<void> {
    throw new LiveStreamNativeOnlyError('stopStream');
  }

  async startRecording(): Promise<StartRecordingResult> {
    throw new LiveStreamNativeOnlyError('startRecording');
  }

  async stopRecording(): Promise<StopRecordingResult> {
    throw new LiveStreamNativeOnlyError('stopRecording');
  }

  override addListener(
    eventName: 'streamState',
    listener: (event: StreamStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  override addListener(
    eventName: 'deviceLost',
    listener: (event: DeviceLostEvent) => void,
  ): Promise<PluginListenerHandle>;
  override addListener(
    eventName: 'thermal',
    listener: (event: ThermalEvent) => void,
  ): Promise<PluginListenerHandle>;
  override addListener(
    _eventName: string,
    _listener: (event: never) => void,
  ): Promise<PluginListenerHandle> {
    // Listening is harmless and never fires on web; throwing here would break UI that subscribes
    // defensively before checking capabilities().
    return Promise.resolve({ remove: async () => undefined });
  }
}
