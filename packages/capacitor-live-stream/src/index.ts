/**
 * @livetap/capacitor-live-stream — the LIVETAP native live-streaming Capacitor plugin.
 *
 * `registerPlugin` resolves to the native implementation on iOS/Android and to the lazily-imported
 * `LiveStreamWeb` fallback everywhere else, so importing this module is safe in a plain browser.
 *
 * NATIVE REGISTRATION IS AUTOMATIC, AND THAT IS WHY THIS IS A PACKAGE
 * This code used to live in `apps/mobile/src/plugins/LiveStream` with the native halves inside the
 * app's own Xcode and Gradle projects. That worked on Android (MainActivity called
 * `registerPlugin(LiveStreamPlugin.class)`) and was simply broken on iOS: `CapacitorBridge`
 * instantiates only the classes listed in `packageClassList` of the generated
 * `ios/App/App/capacitor.config.json`, and `cap sync` regenerates that list from node_modules — so
 * an app-local Swift plugin was unreachable from JavaScript and no hand-edit survived a sync.
 *
 * As a package with a `capacitor` block in its package.json, `npx cap sync` discovers it on both
 * platforms by itself:
 * - iOS: every `.swift`/`.m` under `ios/` is scanned for `@objc(...)`, and `LiveStreamPlugin` is
 *   written into `packageClassList`; the Podfile gains
 *   `pod 'LivetapCapacitorLiveStream', :path => '../../../../packages/capacitor-live-stream'`.
 * - Android: the `@CapacitorPlugin(name = "LiveStream")` annotation is found and written into
 *   `capacitor.plugins.json`; `capacitor.settings.gradle` includes the module.
 *
 * Verification status differs by platform and the difference matters. The Android native code
 * COMPILES on the build host and ships in the debug APK's dex, which is asserted rather than
 * claimed (`node apps/mobile/scripts/verify-apk.mjs`); it has never been RUN, because there is no
 * emulator image and no nested virtualisation here. The iOS native code has not been compiled at
 * all: there is no Xcode. See docs/architecture/MOBILE_ARCHITECTURE.md for the verification table
 * and docs/release/ANDROID_MANUAL_TEST.md for the journey that settles the Android runtime.
 */
import { registerPlugin } from '@capacitor/core';
import type { LiveStreamPlugin } from './definitions.js';

export const LiveStream = registerPlugin<LiveStreamPlugin>('LiveStream', {
  web: () => import('./web.js').then((m) => new m.LiveStreamWeb()),
});

export * from './definitions.js';
// The `import('./web.js')` above is lazy for Capacitor's benefit, but these named re-exports are
// static, so `web.js` is in the bundle either way. Saying so beats implying a tree-shake that does
// not happen; the fallback is ~100 lines of throwing stubs and costs nothing worth optimising.
export { LiveStreamNativeOnlyError, NATIVE_ONLY_MESSAGE, LiveStreamWeb } from './web.js';

// The second native class in this package: where a stream key or an OAuth token lives on Android.
// It is registered the same way (`@CapacitorPlugin(name = "LivetapSecureStore")` picked up by
// `cap sync`) and has no web implementation on purpose — a browser has no keychain, and
// `secrets.ts` already has the right browser answer, which is to keep nothing.
export { LivetapSecureStore, installVaultBridge } from './secureStore.js';
export type {
  LivetapSecureStorePlugin,
  SecureStoreGetResult,
  VaultBridge,
} from './secureStore.js';
