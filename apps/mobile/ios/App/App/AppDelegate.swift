import AVFoundation
import Capacitor
import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // A call, Siri or Control Centre lands here. The capture session is about to be
        // interrupted; LiveStreamPlugin observes AVCaptureSession.wasInterruptedNotification and
        // reports it as `deviceLost`, so nothing is torn down here.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // THE iOS CONSTRAINT, IN THE PLACE PEOPLE ACTUALLY LOOK:
        // iOS does not permit camera capture in the background. AVCaptureSession is interrupted
        // with `videoDeviceNotAvailableInBackground` and the video track genuinely stops.
        //
        // `UIBackgroundModes: audio` (declared in Info.plist) keeps the AVAudioSession and the
        // RTMP socket alive, so the broadcast continues audio-only rather than dying. The UI's job
        // is to show the creator that their camera is paused; the plugin's job is to keep the
        // connection up. Do NOT try to keep the camera alive here with a background task — it will
        // not work, and pretending it might is how a broadcast silently drops.
        //
        // Camera-while-backgrounded needs the Apple-gated entitlement
        // `com.apple.developer.avfoundation.multitasking-camera-access`, which LIVETAP does not
        // hold. See docs/architecture/MOBILE_ARCHITECTURE.md "Background behaviour".
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Reactivating the audio session here is cheap insurance: an interruption that ended while
        // backgrounded can leave the session inactive.
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // The WebView UI resumes the preview itself once it sees the capture session recover.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Nothing to persist: settings are written through @capacitor/preferences as they change,
        // and secrets live in the Keychain, not in app state.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // OAuth callbacks on the custom `livetap://oauth` scheme arrive here and are forwarded to
        // the App plugin, which raises `appUrlOpen` in JavaScript.
        //
        // NOTE ON WHICH BROWSER LIVETAP USES FOR OAUTH:
        // @capacitor/browser opens SFSafariViewController on iOS, which is NOT
        // ASWebAuthenticationSession. SFSafariViewController cannot intercept the callback itself,
        // which is exactly why this delegate method has to exist, and it does not give the user the
        // OS-level "wants to use … to sign in" consent sheet. RFC 8252 wants
        // ASWebAuthenticationSession on iOS and Chrome Custom Tabs on Android.
        // LIVETAP therefore treats @capacitor/browser + this callback as the MVP path, always with
        // PKCE, and an ASWebAuthenticationSession plugin as a hardening step once one has been
        // verified for Capacitor 7 (none has been — see MOBILE_ARCHITECTURE "OAuth on mobile").
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Universal Link callbacks (https://<host>/oauth/callback) arrive here. They require the
        // Associated Domains capability and a hosted apple-app-site-association file, both of
        // which need a Team ID and a real domain — BLOCKED_EXTERNAL_DEPENDENCY today.
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
