#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

/*
 * ObjC bridge declaration for LiveStreamPlugin.
 *
 * WHY THE CAP_PLUGIN MACRO BELOW IS DISABLED RATHER THAN USED
 * Capacitor has two ways to declare a plugin's JS-visible metadata (identifier, jsName,
 * pluginMethods):
 *
 *   (a) Swift: `class LiveStreamPlugin: CAPPlugin, CAPBridgedPlugin` with the three properties.
 *       This is the pattern every first-party Capacitor 7 plugin uses — verified by reading
 *       node_modules/@capacitor/haptics/ios/Sources/HapticsPlugin/HapticsPlugin.swift, which is
 *       exactly this shape with no .m file at all.
 *
 *   (b) ObjC: the `CAP_PLUGIN(objc_name, js_name, methods)` macro, which expands (see
 *       node_modules/@capacitor/ios/Capacitor/Capacitor/CAPBridgedPlugin.h) to a forward
 *       declaration of the class plus a `(CAPPluginCategory)` category that conforms to
 *       CAPBridgedPlugin and implements `-identifier`, `-jsName` and `-pluginMethods`.
 *
 * Using BOTH means the ObjC category implements three methods the Swift class also implements.
 * ObjC categories silently win at runtime, clang emits "category is implementing a method which
 * will also be implemented by its primary class", and the compile-time safety of the Swift
 * property list is thrown away for no gain. LIVETAP uses (a): LiveStreamPlugin.swift is the single
 * source of truth for the method list, so adding a method in Swift cannot drift from a second
 * declaration here.
 *
 * The macro is kept, disabled, because it is the exact legacy form and because anyone debugging
 * registration will look for this file first. If a future Capacitor drops CAPBridgedPlugin-in-Swift
 * support, delete the three properties from the Swift class and uncomment the block below — do not
 * enable both.
 *
 * SEPARATE ISSUE, AND THE ONE THAT ACTUALLY BREAKS THINGS: app-local iOS plugins are not
 * registered by either mechanism on its own. CapacitorBridge.registerPlugins()
 * (node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift:305) instantiates only
 * the class names listed under `packageClassList` in the bundled capacitor.config.json, and
 * `registerPluginType(_:)` returns immediately while `autoRegisterPlugins` is true. `npx cap sync`
 * regenerates that file from node_modules, so a hand-added entry does not survive.
 *
 * Fix, in order of preference (tracked in docs/architecture/MOBILE_ARCHITECTURE.md):
 *   1. Extract LiveStream into its own local Capacitor plugin package
 *      (`packages/capacitor-live-stream` via `npm init @capacitor/plugin`) and depend on it from
 *      apps/mobile. `cap sync` then writes `LiveStreamPlugin` into packageClassList itself, the
 *      pod resolves from the workspace, and the plugin can ship its own podspec and
 *      PrivacyInfo.xcprivacy.
 *   2. Stopgap: append "LiveStreamPlugin" to `packageClassList` in
 *      ios/App/App/capacitor.config.json after every `cap sync`.
 *
 * Android has no equivalent problem: MainActivity.onCreate calls
 * registerPlugin(LiveStreamPlugin.class) before super.onCreate(), and that is additive.
 */

/*
CAP_PLUGIN(LiveStreamPlugin, "LiveStream",
           CAP_PLUGIN_METHOD(capabilities, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(startPreview, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stopPreview, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(switchCamera, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(setMute, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(startStream, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stopStream, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(startRecording, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stopRecording, CAPPluginReturnPromise);
)
*/
