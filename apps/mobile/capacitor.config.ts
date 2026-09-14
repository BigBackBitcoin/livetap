import type { CapacitorConfig } from '@capacitor/cli';

/**
 * LIVETAP mobile — Capacitor 7 configuration.
 *
 * Capacitor 7 (not 8) is pinned deliberately: `@capacitor/cli@8` declares `node >= 22` and the
 * build host runs Node 20.11. See docs/architecture/MOBILE_ARCHITECTURE.md §"Why Capacitor 7".
 *
 * `webDir` is `www/`, and it stays `www/`. It is NOT a placeholder for `../web/dist`: the web build
 * emits the marketing page at `index.html` and the application at `app.html`, so pointing Capacitor
 * at `dist` directly would make the phone app boot into the page that sells the phone app.
 * `apps/mobile/scripts/stage-web.mjs` is what fills `www/`: it copies the build, drops the
 * marketing files, and promotes `app.html` to `index.html`.
 */
const config: CapacitorConfig = {
  appId: 'app.livetap.mobile',
  appName: 'LIVETAP',
  webDir: 'www',
  // Never ship a live-reload `server.url` in a release build.
  server: {
    // Android serves the bundled app over https:// rather than http:// so that secure-context
    // APIs (getUserMedia, crypto.subtle, service workers) are available in the WebView.
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // Only these hosts may be navigated to inside the WebView; everything else is handed to the
    // system browser. OAuth deliberately does NOT go through the WebView (see MOBILE_ARCHITECTURE).
    allowNavigation: [],
  },
  ios: {
    // `always` keeps the WebView content clear of the notch/home indicator without the WebView
    // doing its own inset maths; LIVETAP draws its own safe-area padding from env(safe-area-inset-*).
    contentInset: 'always',
    // WKAppBoundDomains restricts the WebView to a declared domain list and is what unlocks
    // some privacy-sensitive WKWebView APIs. LIVETAP serves its UI from the bundle rather than a
    // remote origin, so there is no domain list to bind to and nothing to gain here. Left at the
    // Capacitor default; `server.allowNavigation: []` is what actually keeps external origins out
    // of the WebView.
    limitsNavigationsToAppBoundDomains: false,
    // Do not let the WebView scroll the whole document; the studio UI is fixed-viewport.
    scrollEnabled: false,
    backgroundColor: '#0B0B0F',
  },
  android: {
    /*
     * Remote debugging, for the debug variant only.
     *
     * A sideloaded alpha that boots to a white screen is undiagnosable without an inspector: there
     * is no console, no network panel and no way to tell a bundle error from a permission refusal.
     * `apps/mobile/scripts/build-android.sh` exports LIVETAP_ANDROID_VARIANT=debug before
     * `cap sync`, so this is true for exactly the build that gets sideloaded and false for anything
     * else, including a release build that forgets to think about it.
     */
    webContentsDebuggingEnabled: process.env.LIVETAP_ANDROID_VARIANT === 'debug',
    allowMixedContent: false,
    captureInput: true,
    backgroundColor: '#0B0B0F',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#0B0B0FFF',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B0B0F',
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    Preferences: {
      // Non-secret settings only. OAuth tokens and stream keys go to Keychain/Keystore via a
      // secure-storage plugin — see MOBILE_ARCHITECTURE §"Secure storage".
      group: 'LIVETAP',
    },
  },
};

export default config;
