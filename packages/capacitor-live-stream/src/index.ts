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
 * The native code itself is still UNVERIFIED — there is no Xcode, Android SDK or device on the
 * build host. See docs/architecture/MOBILE_ARCHITECTURE.md for the verification table.
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
