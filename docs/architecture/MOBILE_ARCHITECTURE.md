# LIVETAP Mobile Architecture

Scope: `apps/mobile` — the iOS and Android apps. Written 2026-09-11 on a Windows Server 2022 host
with Node 20.11, **no Java/Android SDK and no Xcode**. Every claim about native behaviour in this
document is therefore either read from a primary source (linked) or marked `UNVERIFIED`. Nothing
native has been compiled or run here.

Status vocabulary: `PASS` | `FAIL` | `SIMULATED` | `UNVERIFIED` | `BLOCKED_EXTERNAL_DEPENDENCY`.

---

## 1. What actually happened when the projects were created

| Command | Result | Detail |
|---|---|---|
| `npm install` (repo root, once) | **PASS** | Added 65 packages. `EBADENGINE` warnings for transitive npm-internal packages wanting Node ≥ 22; no Capacitor package warned. |
| `npx cap add android` | **PASS** | Full Gradle project generated in `apps/mobile/android`, 7 Capacitor plugins detected, Gradle sync step ran. |
| `npx cap add ios` | **PASS (with two expected skips)** | Full Xcode project generated in `apps/mobile/ios` — `App.xcodeproj/project.pbxproj`, `App.xcworkspace`, `AppDelegate.swift`, `Info.plist`, `Podfile`, asset catalogues, storyboards. Capacitor printed `Skipping pod install because CocoaPods is not installed` and `Unable to find "xcodebuild". Skipping xcodebuild clean step...`. |
| `npx cap sync` (after all manual edits) | **PASS** | Re-verified by md5: `variables.gradle`, `app/build.gradle`, `AndroidManifest.xml`, `Info.plist`, `Podfile` and root `build.gradle` are **all preserved**. Only `capacitor.config.json`, `capacitor.plugins.json`, `capacitor.build.gradle` and the copied web assets are regenerated. |
| `./gradlew assembleDebug` | **BLOCKED_EXTERNAL_DEPENDENCY** | `java: command not found`. No JDK and no Android SDK on the host. Runs in CI (`.github/workflows/mobile.yml`, `android` job). |
| `pod install` + `xcodebuild` | **BLOCKED_EXTERNAL_DEPENDENCY** | Requires macOS. Runs in CI (`ios` job) on `macos-latest`. |

The brief anticipated that `cap add ios` might refuse on Windows and asked for a hand-written
fallback. It did **not** refuse: the Xcode project itself exists and is real. What is missing is
the `Pods/` directory and the `Podfile.lock`, both of which `pod install` creates on macOS.
**The Xcode project is `PASS`; compiling it is `BLOCKED_EXTERNAL_DEPENDENCY`.**

---

## 2. Why Capacitor, and why Capacitor **7**

**Why Capacitor at all** (ADR-004): LIVETAP's competitive claim is one experience everywhere, and
the UI is where that experience lives. Capacitor loads the same React SPA that `apps/web` builds
and that `apps/desktop` embeds, so a change to the GO LIVE flow ships to five surfaces at once.
Unlike a WebView wrapper, `cap add` produces a **real Xcode project and a real Gradle project** —
checked into this repository, editable, with native targets we own. That is what makes the native
streaming plugin possible at all: React Native/Expo would have given the same reuse of *logic* but
not of the *UI*, and would have meant maintaining a second component library.

**Why 7 and not 8.** Capacitor 8's own upgrade guide requires **Node ≥ 22**
(`docs/research/DESKTOP_MOBILE_STORE_RESEARCH.md` §2.1); `npm view @capacitor/cli@8 engines`
confirms `node >= 22.12.0`. The build host is Node **20.11**, so the Capacitor 8 CLI will not run
here. Capacitor 7's CLI declares `node >= 20.0.0`. Pinned versions (latest 7.x as of 2026-09-11,
verified with `npm view`):

| Package | Version |
|---|---|
| `@capacitor/core`, `cli`, `ios`, `android` | 7.6.9 |
| `@capacitor/app` | 7.1.2 |
| `@capacitor/browser` | 7.0.5 |
| `@capacitor/preferences` | 7.0.4 |
| `@capacitor/status-bar` | 7.0.6 |
| `@capacitor/splash-screen` | 7.0.5 |
| `@capacitor/keyboard` | 7.0.6 |
| `@capacitor/haptics` | 7.0.5 |

**What staying on 7 costs, honestly:**

1. Capacitor 7's template sets `minSdk 23 / compileSdk 35 / targetSdk 35`, AGP 8.7.2, Gradle
   8.11.1. Google Play requires **targetSdk 36** for new apps from 2026-08-31, so
   `android/variables.gradle` is raised to **minSdk 26 / compileSdk 36 / targetSdk 36** and the
   root `build.gradle` to **AGP 8.13.0** with the wrapper at **Gradle 8.14.3** — the combination
   the research records as validated against API 36. This is a deliberate deviation from the
   template and the single most likely thing to break in CI. `UNVERIFIED` until the `android` job
   goes green.
2. Capacitor 7's iOS projects use **CocoaPods**; Capacitor 8 defaults to Swift Package Manager.
   CocoaPods trunk's newest **HaishinKit is 2.0.9** (verified: 123 published versions, newest
   2.0.9, and no `HaishinKit.podspec` on the repo's `main` branch — 404). HaishinKit's actual
   latest release is **2.2.5** (2026-03-28), SPM-only, and it is 2.2.5 that fixes Xcode 26.4
   compilation and adds multitasking-camera support. **So the CocoaPods path pins us one minor
   line behind and excludes those two fixes.**
3. Apple requires builds made with **Xcode 26 / iOS 26 SDK** from 2026-04-28. Xcode 26 is the
   compiler, not the deployment target, so a Capacitor 7 project can be built with it — but
   HaishinKit 2.0.9 predates that toolchain and is `UNVERIFIED` against it.

**Migration trigger:** install Node 22 LTS on the build host, then move to Capacitor 8 + SPM +
HaishinKit 2.2.x. That single change resolves (2) and (3) and drops the manual SDK-level overrides
in (1). It is the highest-value unblocking action for mobile and it is entirely local.

`webDir` is `www` (a placeholder shell explaining itself) because `apps/web/dist` does not exist on
this host yet. **Switch to `../web/dist` and delete `apps/mobile/www/` as soon as the web team's
build lands** — one line in `apps/mobile/capacitor.config.ts`. CI already builds the web app before
`cap sync` and logs which `webDir` it is about to use.

---

## 3. The native plugin contract

`apps/mobile/src/plugins/LiveStream/definitions.ts` defines `LiveStreamPlugin`. It is the **output
side** of `packages/core`'s `MediaEngine`: the native layer owns capture, encode and the RTMP
socket; the WebView owns only the UI.

**A WebView cannot do this job.** It has no RTMP socket, and WKWebView's `getUserMedia`
microphone has been reported to mute when the app backgrounds — so a WebView-owned capture path
cannot survive a phone call. On mobile, LIVETAP therefore **never calls `getUserMedia`**.

| Method | Purpose |
|---|---|
| `capabilities()` | What this device can actually do, including `backgroundCamera` and `maxSimultaneousStreams`. Ask before showing any streaming UI. |
| `startPreview({camera, aspect})` / `stopPreview()` | Camera + mic capture with a native preview behind the WebView. |
| `switchCamera()` / `setMute({muted})` | The only two live controls a phone build needs. |
| `startStream({url, streamKey, videoKbps, audioKbps, width, height, fps, keyframeSeconds})` | **One output per call.** Returns `{id}`. |
| `stopStream({id})` | Stops one output; siblings, preview and recording keep running. |
| `startRecording()` / `stopRecording()` | Records to the **app sandbox** only. |
| `addListener('streamState', …)` | `{id, state, code?, bitrateKbps?, droppedFrames?, technical?}` where state is `connecting \| connected \| degraded \| disconnected \| failed`. |
| `addListener('deviceLost', …)` | `{kind, recoverable, technical?}` — the OS took the camera or mic. |
| `addListener('thermal', …)` | `{level}` — `nominal \| fair \| serious \| critical`. |

**Design rules the contract enforces:**

- **Failures are events, never throws.** Only argument/permission errors reject the promise. A
  destination that dies mid-broadcast arrives as `streamState`, so one failing destination can
  never take out a sibling or the production (ADR-008).
- **`code` is a core `ErrorCode`.** The React layer reuses `humanizeError` untouched.
- **Stream keys never come back out.** Both native implementations redact anything matching
  `rtmps?://\S+` before a message crosses into JavaScript, because RootEncoder's failure strings
  and HaishinKit's status codes can contain the endpoint — and the endpoint contains the key.

### One output per call — and why mobile multi-destination is a lie without a relay

`maxSimultaneousStreams` is **1** in both native skeletons, pending device measurement.

A phone can encode once. The cost of a second destination is not a second encode — it is a second
TLS socket, a second packetiser, a second congestion controller, and roughly a doubling of radio
airtime, all inside a thermal budget that a 1080p30 H.264 encode already half-consumes. Field
reality for mobile RTMP is **1 comfortable push, 2 on a flagship in a cool room**, and the failure
mode is not a dropped destination, it is the OS throttling the encoder and *every* destination
going soft at once.

**LIVETAP's answer is the relay, not more sockets.** Per ADR-009, multi-destination from a phone
belongs behind a `RelayProvider`: the phone pushes **one** stream to a relay (self-hosted MediaMTX
today, LIVETAP CLOUD later) and the relay fans out. That keeps the phone's job constant no matter
how many destinations the creator picks, and it is the honest architecture. Until the relay exists,
the mobile UI must say "one destination at a time on this phone" rather than offering a multi-select
that thermally cannot work.

### Native implementations

| | iOS | Android |
|---|---|---|
| Library | **HaishinKit.swift 2.0.9** | **RootEncoder 2.8.1** |
| License | **BSD-3-Clause** ("New BSD" in the podspec) | **Apache-2.0** |
| Verified how | `HaishinKit.podspec` at tag 2.0.9: version, `swift_version 5.10`, `ios.deployment_target 13.0`, dependency `Logboard ~> 2.5.0`. CocoaPods trunk API for the version list. | `github.com/pedroSG94/RootEncoder` LICENSE.txt + latest release 2.8.1. Source read at tag 2.8.1. |
| Entry points | `MediaMixer`, `RTMPConnection` (actor: `connect`, `close`, `status: AsyncStream<RTMPStatus>`), `RTMPStream` (actor: `init(connection:)`, `publish(_:type:)`, `close()`, `setVideoSettings`, `setAudioSettings`) | `GenericStream(context, ConnectChecker, Camera2Source, MicrophoneSource)`, `prepareVideo`, `prepareAudio`, `startStream(endPoint)`, `stopStream()`, `startRecord/stopRecord`, `setVideoBitrateOnFly` |
| Camera flip | re-`attachVideo` on track 0 | `Camera2Source.switchCamera()` |
| Mute | detach audio (`attachAudio(nil)`) | `MicrophoneSource.mute()` / `unMute()` |
| Health | `RTMPStream.status` stream | `ConnectChecker.onNewBitrate` + `StreamBaseClient.getDroppedVideoFrames()` |
| Attribution obligation | copyright notice + no-endorsement clause | license text + NOTICE if present |
| Files | `ios/App/App/LiveStreamPlugin.swift`, `.m` | `android/app/src/main/java/app/livetap/mobile/LiveStreamPlugin.kt` |

Both licenses are permissive and fine for an MIT product and for both stores. Obligations recorded
in `docs/legal/THIRD_PARTY_LICENSES.md`.

Every place a decision needs hardware carries a `TODO(device)` comment rather than a guess. The
three biggest are: the preview surface wiring (an `MTHKView` / `OpenGlView` behind a transparent
WebView), HaishinKit's recorder API, and the real value of `maxSimultaneousStreams`.

### Plugin registration — a real gap, documented

| Platform | Mechanism | Status |
|---|---|---|
| Android | `MainActivity.onCreate` calls `registerPlugin(LiveStreamPlugin.class)` **before** `super.onCreate()`. Verified against `BridgeActivity.java` (`initialPlugins` is consumed in `onCreate`). Additive; survives `cap sync`. | **PASS (by construction)** |
| iOS | **Broken for an app-local plugin.** `CapacitorBridge.registerPlugins()` (`node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift:305`) instantiates only the class names in `packageClassList` of the bundled `capacitor.config.json`, and `registerPluginType(_:)` returns immediately while `autoRegisterPlugins` is true. `cap sync` regenerates that file from `node_modules`, so a hand-added entry does not survive. Confirmed: after `cap sync`, `packageClassList` contains the 7 npm plugins and **not** `LiveStreamPlugin`. | **FAIL (known, with a fix)** |

**Fix, in order of preference:**

1. **Extract the plugin into its own local package** — `packages/capacitor-live-stream` via
   `npm init @capacitor/plugin`, depended on by `apps/mobile`. `cap sync` then writes
   `LiveStreamPlugin` into `packageClassList` itself, the pod resolves from the workspace, and the
   plugin can ship its own podspec and `PrivacyInfo.xcprivacy`. This is the right end state and
   should happen before any device testing.
2. Stopgap: append `"LiveStreamPlugin"` to `packageClassList` in
   `ios/App/App/capacitor.config.json` after every `cap sync`.

The Swift class conforms to `CAPBridgedPlugin` (the Capacitor 7 pattern — verified against
`@capacitor/haptics@7.0.5`, which uses exactly this shape with no `.m` file). `LiveStreamPlugin.m`
exists and carries the legacy `CAP_PLUGIN` macro **commented out**: enabling both would make an
ObjC category re-implement `identifier`/`jsName`/`pluginMethods` that the Swift class already
implements, which clang warns about and which silently discards the compile-time safety of the
Swift method list. One source of truth, in Swift.

### `MobileEngine`

`apps/mobile/src/MobileEngine.ts` implements core's `MediaEngine` with `kind: 'native'` on top of
the plugin. It is the only mobile code with unit tests (22, against a fake plugin — the native side
underneath is `UNVERIFIED`).

What it deliberately refuses rather than fakes:

- `maxFormats: 1`. An output whose aspect ratio is not the master aspect gets `outputLost` with
  `CONFIG_INVALID`. A phone encodes once; two aspect ratios would mean two encodes.
- `srt`/`whip` ingest targets get `CONFIG_INVALID` with a message pointing at the desktop app or a
  relay.
- Outputs past `maxSimultaneousStreams` get `CONFIG_INVALID` citing ADR-009.
- `whip: false`, `screen: false`, `window: false`, `systemAudio: false`.
- `setMoment` honours only camera choice and mute, and says so: a phone has no Moment compositor.
- Metrics report `encoderDroppedPct: 0` because neither library reports an encoder-lag
  percentage. Reporting a real zero beats inventing a plausible number.

---

## 4. Background behaviour — the platforms are not equal, and the UI must not pretend they are

### iOS: the camera stops. Full stop.

iOS does not permit camera capture in the background. Backgrounding interrupts `AVCaptureSession`
with `videoDeviceNotAvailableInBackground`; starting a session in the background yields
`AVError.Code.deviceIsNotAvailableInBackground`.

`UIBackgroundModes: audio` is declared in `Info.plist`, and it does exactly one useful thing: it
keeps the `AVAudioSession` and therefore the RTMP socket alive, so the broadcast **continues
audio-only** instead of dying. It is not a keep-alive switch, Apple reviews its use, and LIVETAP's
use is genuine (a live audio path).

Consequences the product must own:

- The UX is **"your camera is paused"**, not a silent freeze. The native encoder should push a
  slate frame so viewers see an explanation rather than a stalled last frame.
- `capabilities().backgroundCamera` returns **false** on iOS. The UI reads this and says so *before*
  the creator goes live, not after they lose their shot.
- Camera-while-backgrounded requires the Apple-gated entitlement
  `com.apple.developer.avfoundation.multitasking-camera-access`.
  **`BLOCKED_EXTERNAL_DEPENDENCY`** — it must be requested from Apple, with unknown lead time.
  Apply early if this ever becomes a product requirement.
- The sanctioned way to keep streaming while the creator uses other apps is **screen broadcast**
  (ReplayKit), which is post-MVP (§8).

### Android: a foreground service, and it works

`LiveForegroundService` (`android/app/src/main/java/app/livetap/mobile/LiveForegroundService.kt`)
holds the broadcast up. It encodes the Android 14+ rules:

- manifest `foregroundServiceType="camera|microphone|mediaProjection"`, and the same types
  declared in Play Console (a **high-scrutiny** combination — see
  `docs/release/GOOGLE_PLAY_READINESS.md` G13);
- `ServiceCompat.startForeground(service, id, notification, type)` with the bitmask matching the
  permissions actually held — a mismatch throws `MissingForegroundServiceTypeException` or
  `SecurityException`;
- `camera` and `microphone` FGS types are **while-in-use**: the service can only be started while
  the app is foregrounded, so `startLive()` is called from the GO LIVE tap and never from a
  background callback. Android 15 additionally forbids a `BOOT_COMPLETED` receiver from starting a
  `mediaProjection` FGS;
- a `PARTIAL_WAKE_LOCK` (6-hour cap, released in `onDestroy`) keeps the CPU encoding with the screen
  off, without keeping the screen on;
- the notification is `IMPORTANCE_LOW`, ongoing, and carries an **End broadcast** action, because
  it is the creator's only handle on a running broadcast when the app is not visible.

`capabilities().backgroundCamera` returns **true** on Android.

---

## 5. Orientation policy — vertical-first, and an Android 16 trap

LIVETAP mobile is **vertical-first** (prompt pack §09): the phone is where 9:16 content is made, so
`startPreview` defaults to `aspect: '9:16'` and the Vertical Live intent is the first-class path.

- **iOS phone: portrait-locked.** `UISupportedInterfaceOrientations` is `Portrait` only, so the
  capture UI, the 9:16 safe areas and the preview can never disagree. iPad keeps all four
  orientations because iPad multitasking ignores a single-orientation app and App Review expects
  an iPad build to rotate.
- **Android: cannot be locked, and must not try.** For apps targeting API 36, on displays with
  smallest width ≥ 600dp, Android **ignores** `android:screenOrientation`,
  `setRequestedOrientation()`, `minAspectRatio`/`maxAspectRatio` and `resizableActivity`. A
  "portrait-locked broadcaster" therefore breaks on tablets and foldables — exactly the
  configuration `targetSdk 36` gives us. The temporary
  `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` opt-out **stops working at API 37** and is
  deliberately **not** used.
  The manifest also adds `density` to the activity's `configChanges` so the WebView does not reload
  on resize.

**So the design rule is: the capture UI is genuinely responsive, and the *composition* is
vertical.** A 9:16 master canvas rendered inside whatever window the OS gives us, with letterboxing
that LIVETAP controls — never an orientation lock we do not actually own.

---

## 6. Thermal and battery policy

Sustained 1080p encoding plus a radio is the hottest thing a phone does. Left alone, the OS
throttles the encoder mid-broadcast and the stream degrades where the creator cannot see why.

**Policy: subscribe to thermal state and step down before the OS does.**

| Level | Source | LIVETAP response |
|---|---|---|
| `nominal` / `fair` | iOS `ProcessInfo.thermalState`; Android `PowerManager.getCurrentThermalStatus()` | none |
| `serious` | same | 1080p → **720p**, 60 fps → **30 fps**, bitrate to the platform's minimum recommendation. `MobileEngine` raises `engineError` with `ENCODER_OVERLOADED` so the orchestrator drives the change through `degradeFormat` in `packages/core`. |
| `critical` | same | as above, plus a visible warning; the creator decides whether to end the broadcast. |

Baseline defaults for a phone are therefore **1080p30, not 1080p60**: 60 fps roughly doubles encode
cost for a format most vertical destinations downscale anyway.

Status: iOS thermal observation is wired (`ProcessInfo.thermalStateDidChangeNotification`). Android
reads `currentThermalStatus` for `capabilities().platformNote`, but the
`OnThermalStatusChangedListener` registration is a `TODO(device)` — the thresholds need a device
that actually gets hot to calibrate, and the research marks battery/thermal behaviour `UNVERIFIED`
against primary docs. **`UNVERIFIED`.**

---

## 7. OAuth, deep links and secure storage on mobile

### The flow

System browser → authorization code + **PKCE** → callback into the app → token exchange.

LIVETAP uses `@capacitor/browser` (7.0.5) plus `App.addListener('appUrlOpen', …)`. Two callbacks
are registered:

| Callback | Where | Strength |
|---|---|---|
| `livetap://oauth` | iOS `CFBundleURLTypes`; Android `<intent-filter>` | Weaker — any installed app can claim a custom scheme. Only ever used **with PKCE**. |
| `https://livetap.example/oauth/callback` | iOS Universal Link; Android App Link (`autoVerify="true"`) | Stronger — cannot be hijacked. **`BLOCKED_EXTERNAL_DEPENDENCY`**: needs a real domain, an `apple-app-site-association` file with the Team ID, and an `assetlinks.json` carrying the **Play app signing key** SHA-256 (not the upload key — that mismatch is the classic cause of App Links silently falling back to the browser). The hostname in the manifest is a placeholder and must be replaced. |

### The honest limitation: this is not `ASWebAuthenticationSession`

`@capacitor/browser` opens **`SFSafariViewController`** on iOS (per its own docs), and Custom Tabs
is the expectation on Android (`UNVERIFIED` — the plugin's page does not state the engine).
`SFSafariViewController` is **not** `ASWebAuthenticationSession`: it cannot intercept the callback
itself (which is why `AppDelegate.application(_:open:options:)` has to exist), it offers no
ephemeral session, and it does not give the user the OS-level "wants to use … to sign in" consent
sheet that RFC 8252 expects.

**No ASWebAuthenticationSession plugin has been verified for Capacitor 7**, so none is adopted.
Candidates to evaluate — checking maintenance, Capacitor 7 support and license before adopting:
`@byteowls/capacitor-oauth2`, Capawesome's social-login/OAuth offerings, community
`capacitor-native-*` wrappers. Until one is verified: `@capacitor/browser` + PKCE + the callback
above is the MVP path, and hardening to `ASWebAuthenticationSession` is a tracked follow-up.
**`UNVERIFIED`.**

### Per-platform auth shape

| Platform | Mobile approach |
|---|---|
| **YouTube** | PKCE public client using the **iOS** and **Android** OAuth client types in Google Cloud (they take no client secret, which is exactly right for a phone). Full control plane: create/bind/transition, chat, analytics. |
| **Twitch** | **Device code flow** — the user authorises on another screen; nothing secret is ever on the phone. The best fit of the three. |
| **TikTok** | `USER_ASSISTED`: the user pastes a stream key from LIVE Studio. No OAuth on mobile. |
| **Kick / Facebook** | Require a confidential-client secret exchange, which must never be on a device. **Blocked on the `TokenBroker`** (ADR-009) — a server-side endpoint LIVETAP CORE does not have yet. Surfaced as honest "unavailable"/"paste stream key" cards, per ADR-010. |
| **Custom RTMP/RTMPS** | No auth. Works today. |

### Secure storage — recommended, deliberately **not installed**

Tokens and stream keys must never sit in `@capacitor/preferences`, which is `UserDefaults` /
`SharedPreferences` — readable on a rooted device and (on iOS) carried into backups.

**Recommendation: `@aparajita/capacitor-secure-storage`** — iOS Keychain, Android Keystore-generated
AES-GCM key with ciphertext in SharedPreferences.

Verified with `npm view` on 2026-09-11:

| Candidate | License | Capacitor 7 support | Verdict |
|---|---|---|---|
| `@aparajita/capacitor-secure-storage` | **MIT** (verified for 7.1.6) | **7.1.6 is the last 7.x line**; 8.0.0 is current and requires Capacitor 8 | **Recommended.** Pin `^7.1.6` while on Capacitor 7. |
| `capacitor-secure-storage-plugin` (martinkasa) | `UNVERIFIED` | **Rejected**: 0.13.0 declares `@capacitor/core >= 8.0.0` | Not usable on Capacitor 7. |
| Capawesome Secure Preferences | `UNVERIFIED` (partly commercial) | `UNVERIFIED` | Evaluate only if (1) fails. |
| Ionic Secure Storage | Commercial, **sunsets 2027-12-31** | — | Do not adopt. |

**It is not added to `package.json`.** Adding a native dependency that cannot be compiled or run
here would put an unverifiable pod and Gradle module into the build on the word of an `npm view`
alone. The decision is recorded; installing it is the first task of whoever has a device.

Policy when it lands: OAuth refresh tokens and stream keys in the secure store only; iOS Keychain
accessibility no looser than `WhenUnlockedThisDeviceOnly` for anything stream-key-shaped (exact
option name `UNVERIFIED`); `android:allowBackup="false"` (already set) so nothing leaks through a
device transfer.

---

## 8. Screen broadcast — post-MVP on both platforms

**iOS: ReplayKit Broadcast Upload Extension. `BLOCKED_EXTERNAL_DEPENDENCY`.**
Needs a second Xcode target, an App Group shared with the host app, its own provisioning profile,
and it counts in the App Store submission. The publisher should run **inside** the extension
(HaishinKit supports ReplayKit capture directly) rather than shuttling frames over the App Group.
The binding constraint is a **~50 MB hard memory limit** — community-established, not documented by
Apple — which forces 720p, the hardware H.264 encoder, and 15–30 fps, and which must be measured on
**iPad** specifically, where the same pipeline that fits on iPhone has been reported to blow it.
None of this can start without Xcode.

**Android: MediaProjection. Post-MVP, plumbing pre-declared.**
The manifest already declares `FOREGROUND_SERVICE_MEDIA_PROJECTION` and the `mediaProjection` FGS
type (adding an FGS type later costs another Play Console review round), and
`LiveForegroundService` has the branch. No code path requests consent yet, so
`capabilities().screenCapture` is **false**. When it is built, the Android 14+ ordering is
unforgiving: consent Intent → `startForeground` with the mediaProjection type → `getMediaProjection`;
the consent Intent is **single-use** (caching and replaying it throws), one `MediaProjection` gets
exactly one `createVirtualDisplay()`, a `MediaProjection.Callback` **must** be registered or
`createVirtualDisplay()` throws `IllegalStateException`, and rotation is handled with
`VirtualDisplay.resize()`/`setSurface()`, never a new projection.

---

## 9. Honest verification table

Everything native is `UNVERIFIED` on this host. That is the whole point of this section.

| Item | Status | Evidence / what would change it |
|---|---|---|
| `apps/mobile` TypeScript typechecks | **PASS** | `npx tsc -p apps/mobile/tsconfig.json --noEmit` — clean. |
| `MobileEngine` event mapping | **PASS** | 22 vitest tests against a fake plugin (`npx vitest run --project mobile`). |
| ESLint | **PASS** | `npx eslint apps/mobile` — clean. `ios/` and `android/` are ignored in `eslint.config.mjs`. |
| Android Gradle project generated | **PASS** | `cap add android` output; files on disk. |
| Xcode project generated | **PASS** | `cap add ios` output; `App.xcodeproj/project.pbxproj` present and structurally valid (46 object ids, all defined exactly once, balanced delimiters). |
| `cap sync` preserves manual native edits | **PASS** | md5 comparison before/after, 6 files. |
| Manifest / Info.plist / privacy manifest are well-formed XML | **PASS** | Parsed with an XML parser. |
| `pod install` | **BLOCKED_EXTERNAL_DEPENDENCY** | Needs macOS. CI `ios` job. |
| `xcodebuild` (simulator, unsigned) | **UNVERIFIED** | Never run. CI `ios` job is the first test. |
| `./gradlew assembleDebug` | **UNVERIFIED** | `java: command not found`. CI `android` job is the first test. |
| AGP 8.13 / Gradle 8.14.3 / Kotlin 2.2.20 on a Capacitor 7 template | **UNVERIFIED** | Highest-risk change in this deliverable. |
| HaishinKit 2.0.9 compiles under Xcode 26 | **UNVERIFIED** | 2.2.5's changelog implies ≤ 2.2.4 had Xcode 26.4 problems. Watch the CI `ios` job. |
| iOS plugin registration | **FAIL (known)** | `packageClassList` does not include `LiveStreamPlugin`. Fix in §3. |
| Camera capture, RTMP push, reconnect | **UNVERIFIED** | Needs a physical device and an ingest server. A simulator cannot test camera or cellular. |
| Background audio continuation | **UNVERIFIED** | Declaration is written; behaviour needs a device. |
| Thermal step-down thresholds | **UNVERIFIED** | Needs a device that gets hot. |
| Preview surface behind the WebView | **UNVERIFIED** | `TODO(device)` in both native files. |
| HaishinKit recorder API | **UNVERIFIED** | `TODO(device)`; guessed instead of verified would be worse. |
| `maxSimultaneousStreams` = 1 | **UNVERIFIED** | Conservative placeholder pending measurement. |
| Secure storage plugin | **UNVERIFIED** (described, not installed) | See §7. |
| Screen broadcast, both platforms | **BLOCKED_EXTERNAL_DEPENDENCY** | See §8. |
| Signing, both platforms | **BLOCKED_EXTERNAL_DEPENDENCY** | Apple Developer Program; Play upload keystore. |

## 10. Next actions, ordered by unblocking value

1. **Install Node 22 LTS** on the build host → Capacitor 8 + SPM + HaishinKit 2.2.x. Fixes the
   CocoaPods version cap, the Xcode 26 risk and the manual SDK overrides at once.
2. **Extract `packages/capacitor-live-stream`** → fixes iOS plugin registration properly.
3. Run CI once and treat the AGP/Gradle/Kotlin bump as the prime suspect for the first red build.
4. Switch `webDir` to `../web/dist` when the web build exists.
5. Install and verify `@aparajita/capacitor-secure-storage@^7.1.6`; move tokens off Preferences.
6. Get one iPhone and one Android phone. Everything in §9 marked `UNVERIFIED` needs them, and the
   iPad matters specifically for the ReplayKit memory limit later.
