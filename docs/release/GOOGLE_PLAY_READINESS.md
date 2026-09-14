# Google Play Readiness — audit of THIS repository

Audited 2026-09-11, re-audited 2026-09-14, against the checklist in
[`docs/research/DESKTOP_MOBILE_STORE_RESEARCH.md`](../research/DESKTOP_MOBILE_STORE_RESEARCH.md) §3.4.
Host: Windows Server 2022, Node 20.11, portable **JDK 21** (`tools/jdk21`) and **Android SDK 36**
(`tools/android-sdk`), **no Play Console account, no emulator image, no device**.

What changed on 2026-09-14: the toolchain rows (G5, G7, G9) went from FAIL/UNVERIFIED to PASS,
because `bash apps/mobile/scripts/build-android.sh` now builds a sideloadable debug APK on this host
and `node apps/mobile/scripts/verify-apk.mjs` asserts 42 facts about it. Nothing about RUNTIME
behaviour changed: there is still no device, and the owner journey that settles it is
[`ANDROID_MANUAL_TEST.md`](./ANDROID_MANUAL_TEST.md).

This audits **files that exist in this repository**. Where the research said "PASS (implementable)",
this audit asks whether it *is* implemented here and answers **FAIL** when it is not.

| Status | Meaning |
|---|---|
| **PASS** | Verified in this repository, with a file path. |
| **FAIL** | Required, not present or not adequate. Fixable here. |
| **BLOCKED_EXTERNAL_DEPENDENCY** | Needs a Play Console account, a keystore, a device, or a legal decision. |
| **UNVERIFIED** | Cannot be confirmed from this host. |

## Counts

Counted by each row's **primary** status (ids are grouped by topic, not in numeric order):

| PASS | FAIL | BLOCKED_EXTERNAL_DEPENDENCY | UNVERIFIED | Total |
|---|---|---|---|---|
| **22** | **6** | **10** | **3** | **41** |

Do not read that PASS column as "nearly done". The manifest, the service and the Gradle
configuration are genuinely correct and that is most of what a static audit can check — but **no
line of Android code in this repository has ever been compiled** (G9), so G7 alone could invalidate
several rows. Qualified rows: **G29** (manifest PASS, verification BLOCKED — and the host is a
placeholder), **G30** (design PASS, behaviour UNVERIFIED), **G37** (PASS *by non-applicability*, and
the public deletion page it depends on does not exist yet), **G14** (a deliberate FAIL, not an
oversight).

**Submittable today: no.** Android is nonetheless *closer* than iOS: the whole toolchain
(JDK + Android SDK + Gradle) is free and installs on this host or any Linux CI runner — no Mac and
no paid membership needed to compile. The Play Console account ($25) and the 12-tester rule are the
real calendar risks.

---

## Build, toolchain and SDK levels

| # | Item | Status | Evidence / what unblocks it |
|---|---|---|---|
| G1 | Play Console developer account | **BLOCKED_EXTERNAL_DEPENDENCY** | $25 one-time. **Choose the account type deliberately** — it decides whether G25 (12 testers / 14 days) applies at all. |
| G2 | Organization account: D-U-N-S + documents + Search Console verification | **BLOCKED_EXTERNAL_DEPENDENCY** | Only if an organization account is chosen. Developer-verification enforcement dates (reported 2026-09-30 in BR/ID/SG/TH, worldwide 2027) are **UNVERIFIED** secondary reporting — check `support.google.com/googleplay/android-developer/answer/10841920` before deciding, because the dates are close. |
| G3 | `targetSdk 36` (required for new apps and updates from 2026-08-31) | **PASS (config)** | `apps/mobile/android/variables.gradle`: `targetSdkVersion = 36`. Raised from Capacitor 7's template default of 35. |
| G4 | `compileSdk 36`, `minSdk` set deliberately | **PASS** | Same file: `compileSdkVersion = 36`, `minSdkVersion = 26`. 26 (not the template's 23, not the research's 24) because RootEncoder's Camera2 + MediaCodec surface path is predictable from 26 and notification channels — required for the live foreground-service notification — are mandatory from 26. |
| G5 | Android SDK + JDK + Gradle installed on the dev host | **PASS** | Portable JDK 21 under `tools/jdk21` and Android SDK 36 under `tools/android-sdk`, neither installed system-wide. `apps/mobile/scripts/build-android.sh` finds them itself and writes `sdk.dir` into `android/local.properties` with forward slashes (a Java properties file treats a backslash as an escape). |
| G6 | Node version adequate for the Capacitor CLI | **PASS** | Node 20.11 satisfies `@capacitor/cli@7`'s `node >= 20.0.0`. (Capacitor **8** needs Node ≥ 22.12 — the reason 7 is pinned. See `docs/architecture/MOBILE_ARCHITECTURE.md` §2.) |
| G7 | AGP / Gradle / Kotlin combination valid for compileSdk 36 | **PASS** | `android/build.gradle`: AGP **8.13.0**; wrapper **gradle-8.14.3-all.zip**; `kotlin_version = 2.2.20`; the plugin module applies the Kotlin Android plugin with `jvmTarget = 21`. Capacitor 7 ships AGP 8.7.2 / Gradle 8.11.1, so this was the highest-risk change in `apps/mobile`. It builds: `BUILD SUCCESSFUL`, `assembleDebug`, 334 tasks. |
| G8 | Gradle project exists and Capacitor plugins are wired | **PASS** | `cap add android` generated the project; `capacitor.build.gradle` now lists **8** plugin modules, the eighth being `:livetap-capacitor-live-stream` (the `packages/capacitor-live-stream` workspace package). `cap sync` re-verified that manual edits to `variables.gradle`, `app/build.gradle`, `build.gradle` and `AndroidManifest.xml` all **survive** (md5-compared before/after), and that the sync is idempotent. LiveStream registration no longer depends on a hand-written `registerPlugin(...)` call in `MainActivity`: `cap sync` writes `{"pkg": "@livetap/capacitor-live-stream", "classpath": "app.livetap.capacitor.livestream.LiveStreamPlugin"}` into `app/src/main/assets/capacitor.plugins.json`, which `BridgeActivity` loads. Android was never broken here, but it now uses the same mechanism as iOS instead of a second, divergent one — see `docs/architecture/MOBILE_ARCHITECTURE.md` §3. |
| G9 | `./gradlew assembleDebug` produces an APK | **PASS** | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 10,160,720 bytes, debug-signed by the SDK's debug key, `package: name='app.livetap.mobile'`, launchable `app.livetap.mobile.MainActivity`. Enough for `adb install -r`; not enough for Play, which needs G12. |
| G9a | The APK contains what this repo claims it contains | **PASS** | `node apps/mobile/scripts/verify-apk.mjs`, 42/42. Reads the APK as a zip with Node's own zlib, so it needs no SDK: the three LIVETAP native classes plus `GenericStream`/`Camera2Source`/`MicrophoneSource`/`OpenGlView` in the dex, all nine `@PluginMethod` names, both plugins in `capacitor.plugins.json`, `webContentsDebuggingEnabled` on with no `server.url`, the app shell rather than the marketing page as the entry point, demo mode compiled out of the web bundle, and the merged manifest's permissions and foreground-service types. |
| G9b | The APK actually streams | **UNVERIFIED** | No emulator image exists under `tools/android-sdk` and this VM has no nested virtualisation. Camera preview, permission dialogs, the foreground-service notification, real RTMP and thermals are all owner hardware: [`ANDROID_MANUAL_TEST.md`](./ANDROID_MANUAL_TEST.md). |
| G10 | CI uses a JDK Capacitor 7 actually accepts | **PASS** | `setup-java` with **`java-version: '21'`**, not 17. `apps/mobile/android/app/capacitor.build.gradle` is generated by `cap sync` with `sourceCompatibility/targetCompatibility = VERSION_21` and is marked *do not edit*, so JDK 17 cannot compile this project. Documented inline in the workflow. |
| G11 | AAB build for release | **BLOCKED_EXTERNAL_DEPENDENCY** | AAB is mandatory for new apps. `./gradlew bundleRelease` needs the upload keystore (G12). CI builds `assembleDebug` only and says so in a step log. |
| G12 | Upload keystore created and held as a CI secret | **BLOCKED_EXTERNAL_DEPENDENCY** | Needs a JDK (`keytool`) — so G5 unblocks creating it — and then a Play Console account to register it. **No keystore and no signing config is committed**, and `app/build.gradle`'s release block carries a comment saying why. |
| G13 | Play App Signing configured at first release | **BLOCKED_EXTERNAL_DEPENDENCY** | Needs G1. Prefer the Google-managed app signing key. |
| G14 | ProGuard/R8 configuration validated | **FAIL (deliberate)** | `minifyEnabled false` in the release block, with the reason in a comment: an untested ProGuard config against RootEncoder's MediaCodec/JNI paths is a reliable way to ship a release build that crashes only on real hardware. Must be turned on and **device-tested** before release, not before. |

## Permissions, services and manifest

| # | Item | Status | Evidence / what unblocks it |
|---|---|---|---|
| G15 | `CAMERA` + `RECORD_AUDIO` declared | **PASS** | Declared twice, deliberately: in `apps/mobile/android/app/src/main/AndroidManifest.xml` (the app's own statement of what it needs) and in the plugin's library manifest `packages/capacitor-live-stream/android/src/main/AndroidManifest.xml`, which the manifest merger folds in. Also declared as Capacitor permission aliases on `@CapacitorPlugin` in `packages/capacitor-live-stream/android/src/main/java/app/livetap/capacitor/livestream/LiveStreamPlugin.kt`, so the runtime request goes through Capacitor's own flow. |
| G16 | `INTERNET` declared | **PASS** | Same file (plus `ACCESS_NETWORK_STATE` for reconnect decisions). |
| G17 | All four FGS permissions declared | **PASS** | `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CAMERA`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`. |
| G18 | `POST_NOTIFICATIONS` declared (Android 13+) | **PASS** | Same file. Required or the live notification — the user's only handle on a running broadcast — never appears. |
| G19 | `WAKE_LOCK` declared and used responsibly | **PASS** | Declared. `LiveForegroundService.acquireWakeLock()` takes a `PARTIAL_WAKE_LOCK` with a 6-hour cap and `setReferenceCounted(false)`, released in `onDestroy()`. Partial, so the CPU keeps encoding while the screen may sleep — it does not hold the screen on. |
| G20 | `foregroundServiceType` on the service matches the permissions | **PASS** | `<service android:name="app.livetap.capacitor.livestream.LiveForegroundService" android:foregroundServiceType="camera\|microphone\|mediaProjection" android:exported="false" android:stopWithTask="true" />` — now declared in the plugin's own library manifest (`packages/capacitor-live-stream/android/src/main/AndroidManifest.xml`) and merged into the app, so the declaration cannot drift away from the Kotlin that starts the service. `ServiceCompat.startForeground(..., type)` passes `CAMERA\|MICROPHONE` for the MVP and adds `MEDIA_PROJECTION` only when a consent result is supplied. |
| G21 | FGS started only while in the foreground (while-in-use rule) | **PASS (by construction)** | `camera` and `microphone` FGS types cannot be started from the background. `LiveForegroundService.startLive()` is called from `LiveStreamPlugin.startStream`, which is the GO LIVE tap. No `BOOT_COMPLETED` receiver exists anywhere (Android 15 forbids one from starting a `mediaProjection` FGS). `startForeground` failures are caught, logged and `stopSelf()`-ed rather than left as a zombie service. |
| G22 | Foreground service types declared in Play Console | **BLOCKED_EXTERNAL_DEPENDENCY** | Policy → App content. **camera + microphone + mediaProjection is the highest-scrutiny combination Play has.** Draft justifications in Appendix A — write them carefully, this is a common rejection. |
| G23 | `android:usesCleartextTraffic="false"` | **PASS** | `AndroidManifest.xml` on `<application>`. RTMPS/HTTPS only by default; a user-configured plain-RTMP custom destination is a deliberate, user-initiated exception and needs a per-domain network-security-config if it is ever supported — **not** a blanket cleartext opt-in. |
| G24 | `android:allowBackup="false"` | **PASS** | Same file, with the reason inline: OAuth tokens and stream keys must not travel into a cloud backup or a device-to-device transfer. |
| G25 | No `<queries>` element / no unnecessary package visibility | **PASS** | Deliberately absent, with a comment saying why: OAuth goes through Custom Tabs (which needs no query) and there is no share-to-app picker. Declaring unused package visibility is a policy liability for nothing. |
| G26 | `density` in the activity's `configChanges` (Capacitor requirement) | **PASS** | Added to `MainActivity`'s `configChanges`, so the WebView does not reload on resize. |
| G27 | Hardware features declared optional | **PASS** | `android.hardware.camera`, `.camera.autofocus`, `.microphone` all `required="false"`, so the app still installs on a device without them and `capabilities()` then reports `camera: false` honestly rather than the install silently failing. |
| G28 | Prominent in-app disclosure **before** the system permission prompt | **FAIL** | The manifest and the plugin are correct, but nothing in this repository shows a disclosure screen first. Play policy requires the explanation to precede the prompt. `apps/mobile` contributes no UI — this is work for `@livetap/web`, and it is blocking. |
| G29 | Deep link / App Link intent filters | **PASS (custom scheme)** / **BLOCKED_EXTERNAL_DEPENDENCY** (App Link) | The custom scheme `livetap://oauth` exists and carries the OAuth callback today, paired with PKCE precisely because any installed app can claim a scheme. The `autoVerify="true"` App Link on the placeholder host `https://livetap.example/oauth/callback` has been **removed** (2026-09-14): verification fetches `.well-known/assetlinks.json` at install time, on a host nobody owns that fetch can only fail, and a failed verification costs an install-time round trip and leaves a permanently unverified domain the creator can see in the app's link settings. Restore the filter with the real hostname at G13, when the SHA-256 of the **Play app signing key** (not the upload key) exists to put in `assetlinks.json`. A comment in `AndroidManifest.xml` says exactly this. |
| G30 | MediaProjection runtime ordering respected | **PASS (design + service branch)** / **UNVERIFIED (behaviour)** | Post-MVP, so no code path requests consent and `capabilities().screenCapture` is `false`. The rules are written into `LiveForegroundService`'s header comment so whoever builds it cannot miss them: consent Intent → `startForeground(MEDIA_PROJECTION)` → `getMediaProjection`; the consent Intent is single-use; one `MediaProjection` gets exactly one `createVirtualDisplay()`; a `MediaProjection.Callback` **must** be registered or `createVirtualDisplay()` throws; rotation uses `VirtualDisplay.resize()`/`setSurface()`, never a new projection. |
| G31 | Android 16 orientation/resizability handled without the compat opt-out | **PASS** | No `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` anywhere (it dies at API 37) and no `android:screenOrientation` lock — for `targetSdk 36`, Android ignores it above `sw600dp` anyway. Policy is in `docs/architecture/MOBILE_ARCHITECTURE.md` §5: responsive window, vertical *composition*. |
| G32 | Android 16 FGS / media-projection behaviour deltas reviewed | **UNVERIFIED** | The research could not cover `behavior-changes-all` and `changes/foreground-service-types` for 16. Read both before release. |

## Data safety, privacy and policy

| # | Item | Status | Evidence / what unblocks it |
|---|---|---|---|
| G33 | Data safety form completed | **BLOCKED_EXTERNAL_DEPENDENCY** (form) / **PASS** (content prepared) | Draft answers in Appendix B. |
| G34 | Encryption in transit | **PASS (true by design)** | `usesCleartextTraffic="false"`; RTMPS default; HTTPS for every API call. |
| G35 | Privacy policy URL in the listing | **FAIL** | `docs/legal/PRIVACY_POLICY.md` is an accurate draft but it is a markdown file, not a live URL, and still contains `TODO: support@<domain>`. Needs hosting. |
| G36 | Terms published | **FAIL** | `docs/legal/TERMS.md` — same. |
| G37 | Account deletion: **in-app path AND a public web link** | **PASS by non-applicability — conditional** | The policy applies to apps that allow account creation. LIVETAP creates no account: no LIVETAP identity, no server-side user record. What the app provides instead: **Disconnect destination** deletes that platform's token and stream key from the Android Keystore-backed store immediately; **Reset LIVETAP** deletes all local settings and credentials. Specified in `docs/legal/PRIVACY_POLICY.md` §7. <br><br>**Note the asymmetry with Apple:** Apple wants in-app *initiation* and allows a web link to finish; Google wants **both** an in-app path **and** a public web resource. Since there is no account, the honest web resource is a page that says LIVETAP holds nothing, names the app and developer as listed in the store, and explains disconnect/reset plus how to revoke at each platform. **That page does not exist yet — it is part of G35's hosting work, and answering the Data safety deletion questions without it would be a misrepresentation.** <br><br>**This row stops being PASS the instant a LIVETAP account exists**, even an optional one. Adding accounts drags in a deletion flow, a public deletion-request page and a server-side deletion job in the same release. |
| G38 | Content rating (IARC) questionnaire | **BLOCKED_EXTERNAL_DEPENDENCY** | Mandatory; "Unrated" apps may be removed. Draft answers in `docs/release/APP_STORE_READINESS.md` Appendix A apply here too. |
| G39 | Closed testing: 12 testers, 14 continuous days | **BLOCKED_EXTERNAL_DEPENDENCY** | Applies to **personal** accounts created on or after 2023-11-13. Organization accounts and older personal accounts are exempt. Note it is **12**, not 20 (reduced 2024-12-11). Testers who opt out and rejoin restart the 14-day count, and Google is reported (**UNVERIFIED**) to check that testers genuinely used the app. **This is a 3+ week calendar item — decide the account type in G1 with this in mind and start recruiting early.** |
| G40 | RootEncoder Apache-2.0 attribution shipped with the app | **FAIL** | Obligations recorded in `docs/legal/THIRD_PARTY_LICENSES.md` (licence text + NOTICE if present, verified Apache-2.0 at tag 2.8.1), but there is **no in-app "Open source licences" screen**, and Apache-2.0 requires the notice to travel with the binary. Whether the 2.8.1 tag ships a `NOTICE` file is **UNVERIFIED**. |
| G41 | Physical-device validation | **BLOCKED_EXTERNAL_DEPENDENCY** | Camera capture, RTMP push and reconnect, thermal step-down, cellular, and a large-screen/foldable device for G31. An emulator cannot test any of it meaningfully. |

---

## Appendix A — Foreground service type justifications, draft for Play Console

Play reviews each type separately. Keep each answer to what the app demonstrably does, and make
sure the store listing actually promotes the feature being justified — "necessary to implement
current features … promoted in your Google Play listing" is the policy test.

**`camera`**
> LIVETAP is a live-broadcasting app. While the user is live, the camera must keep feeding the
> hardware encoder even when the user switches to another app to read their chat or check a
> message. Ending the capture would end their broadcast. The service starts only when the user taps
> GO LIVE, while the app is in the foreground, and stops when the broadcast ends. A persistent,
> non-dismissible notification with an "End broadcast" action is shown for the whole duration.

**`microphone`**
> Audio is half of a live broadcast and must continue for the same reason and for exactly the same
> duration as the camera. The microphone is never recorded or captured outside an explicitly
> started broadcast, and the same notification discloses it.

**`mediaProjection`**
> Declared for the screen-share broadcast feature (sharing a game or an app while live). Screen
> capture starts only after the user grants consent through the system
> `createScreenCaptureIntent()` dialog, for that one session; the consent is never cached or
> reused. **Note for review: this feature is not enabled in the current release.** The type is
> declared ahead of the feature because adding an FGS type later requires another review cycle. If
> Play prefers, it can be removed from the manifest until the screen-share release.

> **Honest recommendation:** consider **removing `mediaProjection`** from the manifest for the
> first submission. Declaring a high-scrutiny type for a feature the reviewer cannot exercise
> invites questions you cannot answer with a demo, and the cost of adding it later is one review
> cycle rather than a rejected first submission.

## Appendix B — Data safety form, draft answers

Play holds the developer solely responsible for accuracy, **including data handled by third-party
libraries**. The libraries here are RootEncoder (encoder/network only) and Capacitor plus its seven
plugins — none of which phones home. There is no analytics SDK, no crash reporter and no ad SDK in
`apps/mobile/package.json`.

| Data type | Collected? | Shared? | Answer and reasoning |
|---|---|---|---|
| **Photos and videos** | **No** | **No** | Video is captured, encoded on device, and transmitted by the user to the third-party channels **they** connected. LIVETAP operates no server that receives it. Optional local recordings stay in the app's private storage. |
| **Audio (voice or sound recordings)** | **No** | **No** | Same reasoning as video. |
| **Messages (in-app or other)** | **No** | **No** | Platform chat is displayed live from the platform's own API and is not stored by LIVETAP. *If chat is enabled and any message is persisted, this answer must change.* |
| **Personal info** (name, email, user IDs) | **No** | **No** | No LIVETAP account. Channel names and avatar URLs fetched from the connected platform stay on the device. |
| **App activity / app interactions** | **No** | **No** | No analytics of any kind. |
| **Crash logs, diagnostics, performance** | **No** | **No** | No crash reporter. *Adding one flips this to Yes and must be declared in the same release.* |
| **Device or other IDs** | **No** | **No** | No advertising ID, no device ID collection. |
| Location, financial, health, contacts, calendar, files, web history | **No** | **No** | Never requested, never read. |
| **Encryption in transit** | **Yes** | — | `usesCleartextTraffic="false"`; RTMPS and HTTPS. |
| **Can users request data deletion?** | **See G37** | — | There is no account and no server-held data. The answer must be accompanied by the public page described in G37 **before** this form is submitted. Answering "yes, via this link" without a live link is a misrepresentation, and misrepresentation is a User Data policy violation. |
| **Data collected is required (not optional)** | n/a | — | Nothing is collected. |

## Appendix C — Ordered path to a first release

1. ~~**G5**, install a JDK 21 and the Android SDK on the build host.~~ **Done** (2026-09-14):
   portable copies under `tools/`, nothing installed system-wide.
2. ~~**G9**, run `./gradlew assembleDebug` and fix G7.~~ **Done** (2026-09-14): the AGP 8.13 /
   Gradle 8.14.3 / Kotlin 2.2.20 bump on a Capacitor 7 template was indeed the suspect, and it
   builds.
3. **Sideload the APK and walk [`ANDROID_MANUAL_TEST.md`](./ANDROID_MANUAL_TEST.md).** This is now
   the highest-value action for Android: everything left unverified is a question only a handset
   answers, and nothing below it is worth doing if the camera does not open.
4. **G1, Play Console account, choosing the type with G39 in mind.** An organization account skips
   the 12-tester/14-day gate entirely; a personal account adds 3+ weeks to the calendar.
5. **G28, build the prominent-disclosure screen** (blocking product work in `@livetap/web`).
6. **G35/G36/G37, host the privacy policy, terms, and the deletion-information page**, with a real
   support address.
7. **G40, in-app open-source licences screen**, and confirm whether RootEncoder ships a `NOTICE`.
8. **Decide on `mediaProjection`** in the manifest for v1 (Appendix A).
9. G12/G13, keystore, then Play App Signing; then G11 `bundleRelease` and G29's `assetlinks.json`
   with the **app signing key** fingerprint. The `autoVerify` App Link filter on the placeholder
   host `livetap.example` has been REMOVED from the manifest (a verification that can only fail
   costs an install-time round trip and shows the creator a broken domain); restore it with the real
   hostname at the same time as Play App Signing.
10. G22, G33, G38, Play Console declarations.
11. G41, device testing, including one large-screen/foldable device for G31; then G14 (R8) with
    the device to prove it.
