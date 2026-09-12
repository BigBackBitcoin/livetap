/**
 * LiveStream plugin registration.
 *
 * `registerPlugin` resolves to the native implementation on iOS/Android and to the lazily-imported
 * `LiveStreamWeb` fallback everywhere else, so importing this module is safe in a plain browser.
 *
 * Native registration is NOT automatic for an app-local plugin:
 * - Android: `MainActivity.onCreate` calls `registerPlugin(LiveStreamPlugin.class)` before
 *   `super.onCreate()`. See android/app/src/main/java/app/livetap/mobile/MainActivity.java.
 * - iOS: the bridge registers only classes listed in `packageClassList` of the generated
 *   `ios/App/App/capacitor.config.json`, which `cap sync` rewrites. Until LiveStream is extracted
 *   into its own local Capacitor plugin package, the class name has to be appended after each
 *   sync. This is a known gap, tracked in docs/architecture/MOBILE_ARCHITECTURE.md.
 */
import { registerPlugin } from '@capacitor/core';
import type { LiveStreamPlugin } from './definitions.js';

export const LiveStream = registerPlugin<LiveStreamPlugin>('LiveStream', {
  web: () => import('./web.js').then((m) => new m.LiveStreamWeb()),
});

export * from './definitions.js';
export { LiveStreamNativeOnlyError, NATIVE_ONLY_MESSAGE } from './web.js';
