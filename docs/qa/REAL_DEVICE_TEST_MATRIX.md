# Real device test matrix

Written 2026-09-14 on the build host: a headless Windows Server 2022 VM, four
vCPU, no GPU, no camera, no microphone, no nested virtualisation, no macOS and
no physical phone. Android section rebuilt and re-verified 2026-09-15 against
the current tree (see that section for the fresh SHA-256 and the emulator
feasibility check).

Four surfaces down the side, ten capabilities across. Every cell says what was
actually run, on what, and when. Where the answer is "nothing was run", the
cell says so and names what would have to exist first.

---

## Status vocabulary

| Status | Means |
|---|---|
| **PASS** | run on this host and observed working |
| **PASS (synthetic source)** | the real code path ran; the photons and the sound were generated rather than captured. Chromium's `--use-fake-device-for-media-stream` drives the genuine `getUserMedia`, permission, track-lifecycle and constraint-negotiation code. Only the image itself is synthetic |
| **PARTIAL** | part of the cell ran. The cell says which part |
| **ASSERTED ON THE ARTIFACT** | nothing was executed; a claim was verified by inspecting the built binary |
| **EXTERNALLY BLOCKED** | needs owner hardware or an owner account. The cell names it |
| **UNVERIFIED** | code exists, nothing was run |
| **UNAVAILABLE** | no mechanism exists on this surface |

The difference between PASS and PASS (synthetic source) is the whole reason
this file exists. A synthetic source proves the pipeline. It cannot prove the
picture, the exposure, the autogain, the noise floor, or what happens when
somebody pulls the USB cable out.

---

## Windows (Electron desktop)

Everything in this column was run today. This is the only surface with real
results.

| Capability | Status | What was run |
|---|---|---|
| Camera | **PASS (synthetic source)** | `navigator.mediaDevices.getUserMedia` inside the packaged renderer under Playwright with `--use-fake-device-for-media-stream`. The device picker enumerated `fake_device_0` |
| Microphone | **PASS (synthetic source)** | three fake inputs enumerated; AAC 48 kHz stereo arrived at the server on both destinations |
| Screen share | **UNVERIFIED** | the source resolver implements it; no screen-capture run has been driven end to end |
| Format (16:9, 9:16, 1:1) | **PASS** for 16:9 and 9:16 | two simultaneous encodes at genuinely different shapes. MediaMTX parsed 1920x1080 from one stream's SPS and 1080x1920 from the other's, and ffprobe decoded the recordings at those resolutions. **1:1 is UNVERIFIED**: no square destination has been driven |
| Moments | **UNVERIFIED** | the compositor renders them and has unit tests; no Moment switch has been performed mid-broadcast against a real server |
| Authentication | **EXTERNALLY BLOCKED** | no platform client id exists on this host. The flow runs end to end against the local identity provider (33 tests) |
| Broadcast | **PASS** | measured 12:43. Two real RTMP publishers, H.264 + AAC, accepted by MediaMTX, recorded, decoded by ffprobe |
| Reconnect | **PASS** | a real TCP connection was dropped with frames in flight by `kill-publisher.mjs`. The surviving destination climbed from 1,237,654 to 1,542,861 bytes through the failure and the app went on reporting a live broadcast |
| Stop | **PARTIAL** | END removed every publisher from the server. **The navigate-away-during-grace case has not been observed passing**: see the two open items below |
| Recording | **PASS** | MediaMTX wrote fragmented MP4 for both shapes and ffprobe decoded them as H.264 + AAC at 1920x1080 and 1080x1920 |

**Two open items on this column, both measured, neither mine to fix.**

1. **The 12:43 PASS was against the renderer bundle built at 11:01.** A rebuild
   of the same source tree at 13:02 fails: both destinations enter RECONNECTING
   with "The stream URL or key is empty or malformed" and no publisher
   connects. The mechanism is in `apps/web/src/state/registry.ts`: with
   `mockMode` true, `createRegistry` returns mock adapters for the **whole**
   registry including `custom`, and `apps/desktop/package.json`'s
   `build:renderer` leaves `VITE_LIVETAP_MOCK_MODE` unset so the desktop app
   builds in mock mode by default.
2. **Stop, navigate away, and the publisher is still broadcasting 12 seconds
   later.** Measured at 12:55 against the 11:01 bundle, before the grace timer
   was moved into the store. It has not been re-measured against a build that
   contains that move, because of item 1.

| Not testable here | Why |
|---|---|
| Hardware encoders (NVENC, QSV, AMF) | no GPU. All three branches fail to open and the libx264 fallback is what was exercised |
| A real lens and a real microphone | none attached |
| A device unplugged mid-broadcast | no device to unplug |
| Multi-hour thermal and memory behaviour | not run |

---

## macOS (Electron desktop)

| Capability | Status |
|---|---|
| Every capability | **EXTERNALLY BLOCKED** |

There is no macOS machine and no macOS CI runner. The Electron main process, the
FFmpeg engine, the compositor and the renderer are the same code as Windows and
their unit tests run here, but **nothing about macOS has been executed**: not
the camera and microphone TCC permission prompts, not `VideoToolbox`, not the
packaged `.dmg`, not notarization, not the screen-recording permission, not the
entitlements file. Treat every macOS claim in this repository as unverified
until one runs on a Mac.

Unblocked by: any Mac, or enabling CI (BLOCKERS.md B-001) so the free macOS
GitHub runner can build.

---

## Android (Capacitor + native RootEncoder plugin)

**Rebuilt and re-verified 2026-09-15**, from a clean invocation of
`bash apps/mobile/scripts/build-android.sh` against the real media engine and
real adapters (`VITE_LIVETAP_MOCK_MODE=false`, confirmed on the artifact, not
the build log — see "demo mode is compiled out" below). Built from git
`HEAD` `3ec7f8f` with an uncommitted, actively-changing working tree (five
other workstreams were mid-edit in `apps/web`, `packages/ui`,
`packages/adapters` and `apps/desktop` at build time; none of those paths are
in this app's dependency graph except `apps/web`, which is what was actually
built into the bundle below). Re-run the same command to reproduce.

- **APK:** `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- **SHA-256:** `29d943b535ed33c0a3a9a85bc34d7976782a85114f9f96582d67e56615b1ec5e`
- **Size:** 10,196,764 bytes (9.68 MiB)
- **Package id:** `app.livetap.mobile`
- **Version:** versionName `1.0`, versionCode `1`
- **SDK range:** minSdkVersion 26 (Android 8.0), targetSdkVersion 36 (Android 16), compileSdk 36
- **Signing:** debug-signed only — `CN=Android Debug, O=Android, C=US`, cert SHA-256
  `39c76531aaa4332addb64352e4f90b46bb7b9ba61b6cac8bc4983471927d44d2` (via
  `apksigner verify --print-certs`). This is the Android SDK's auto-generated
  debug key, fine for sideloading, **not valid for Play** (BLOCKERS.md B-005).

**Nothing in it has ever been executed.** There is no emulator image under
`tools/android-sdk` (no `system-images` directory), and an emulator cannot be
installed to any effect on this host: `Get-WindowsOptionalFeature -Online
-FeatureName HypervisorPlatform` reports `Disabled`, and `systeminfo` reports
"a hypervisor has been detected" for this VM itself, i.e. this is already a
guest and nested virtualisation is not exposed to it — matching BLOCKERS.md
B-005b's `VMMonitorModeExtensions=False`. Enabling Windows Hypervisor Platform
would also be a system-settings change, which is out of scope here regardless.
Everything below that is not EXTERNALLY BLOCKED was verified by
`node apps/mobile/scripts/verify-apk.mjs`, which reads the APK as a zip and the
Gradle-merged manifest as text — **47/47 checks passed**, including four added
in this pass (package id, versionCode, versionName, minSdk/targetSdk against
the artifact rather than against `build.gradle`'s own claim about itself).

| Capability | Status | What was checked |
|---|---|---|
| Camera | **EXTERNALLY BLOCKED** | `android.permission.CAMERA` and `FOREGROUND_SERVICE_CAMERA` are declared in the built manifest; `GenericStream`, `Camera2Source` and `LiveStreamPlugin` are present in the dex. Whether a camera opens is owner hardware |
| Microphone | **EXTERNALLY BLOCKED** | `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` declared; `MicrophoneSource` is in the dex |
| Screen share | **EXTERNALLY BLOCKED** | `FOREGROUND_SERVICE_MEDIA_PROJECTION` declared; the native code marks this post-MVP (`LiveForegroundService.kt`) — not wired to any UI control |
| Format | **UNVERIFIED** | `MobileEngine` refuses an aspect mismatch in its own 26 unit tests (all pass, 2026-09-15). No native encode has run |
| Moments | **UNVERIFIED** | `MobileEngine.setMoment` updates camera/mute only, by design (a phone has no layer compositor) |
| Authentication | **EXTERNALLY BLOCKED** | `SecureStorePlugin` is present in the dex, so tokens have somewhere real to live. No OAuth has run on a device, and there is no client id to run it with |
| **Broadcast (does the phone get the real engine?)** | **ASSERTED ON THE ARTIFACT — yes, confirmed; running it is EXTERNALLY BLOCKED** | See "The engine-wiring question" below. This is not a guess: `loadMobileEngine()`'s dynamic `import('@livetap/mobile')` is resolved and inlined by Rollup at build time (confirmed by grep on the shipped chunk, not by reading the source), so there is no code path where it silently falls back to the browser engine on a real device. Whether bytes actually leave a phone over RTMP is owner hardware |
| Reconnect | **UNVERIFIED** | |
| Stop | **UNVERIFIED** | `LiveForegroundService` is in the dex; `ACTION_STOP` tears down the encoder before `stopSelf()` (source-read, not executed) |
| Recording | **UNVERIFIED** | |
| Diagnosability | **ASSERTED ON THE ARTIFACT** | `assets/capacitor.config.json` has `webContentsDebuggingEnabled: true`, so a sideloaded alpha with a white screen can be inspected over `chrome://inspect` rather than being undiagnosable |
| `POST_NOTIFICATIONS` | **ASSERTED ON THE ARTIFACT** | declared, which is what Android 13+ needs for the foreground-service notification |

### The engine-wiring question, answered plainly

`apps/web/src/state/engine.ts` (owned by the integrator, read only here) picks
the mobile engine like this: on a Capacitor host it calls `loadMobileEngine()`,
which does `await import('@livetap/mobile')` inside a `try { … } catch {
return null }`. A silently-failing import here would mean the phone shows a
camera preview through the browser engine, never calls RootEncoder, and never
sends a byte — while looking identical in the UI to a real broadcast. That is
the failure mode this whole task exists to rule out.

**It does not happen, and here is the artifact evidence, not the source
reading:**

1. Building `@livetap/web` with Rollup emits a diagnostic tracing the exact
   graph: `apps/web/src/state/engine.ts` → `apps/mobile/src/MobileEngine.ts` →
   `packages/capacitor-live-stream/src/index.ts`. That graph only exists if the
   dynamic import target is real and resolvable at build time.
2. Because `@livetap/mobile` is a workspace package Rollup can see statically,
   it **inlined** the module rather than code-splitting it into a lazily-fetched
   chunk. Grepping the staged bundle confirms this: `registerPlugin`, the
   literal string `'LiveStream'`, `LivetapSecureStore`, and every
   `LiveStreamPlugin` method name (`startPreview`, `startStream`, `setMute`,
   `switchCamera`, …) all live in `assets/index-eDm-JTpb.js` — no file named
   `@livetap/mobile` appears anywhere in the shipped JavaScript because there
   is nothing left to fetch; it is already there. That means there is no
   network-style failure mode (a missing chunk, a 404) that `loadMobileEngine`
   could be catching on a real device — the only way it returns `null` now is
   if `mod.MobileEngine` were literally absent from the bundle, and it is not.
3. `index-eDm-JTpb.js` is not orphaned: `store--k7hPjFv.js` imports it, and
   `store` is in `app-8DI9ueJD.js`'s own dependency map (`__vite__mapDeps`)
   alongside `AppBoot`, meaning it loads on app start, not behind a route the
   user might never hit.
4. On the native side, `verify-apk.mjs` confirms the other half of the
   handshake: `app.livetap.capacitor.livestream.LiveStreamPlugin` is
   registered in `assets/capacitor.plugins.json` (what Capacitor's bridge reads
   at boot to resolve `registerPlugin('LiveStream', …)` to the native class
   instead of the web stub), and `LiveStreamPlugin.class`,
   `GenericStream.class`, `Camera2Source.class` and `MicrophoneSource.class`
   are all present in the dex.

So: JS calls the real plugin name, the native class that name resolves to is
shipped and registered, and the classes that class depends on to touch the
camera, the microphone and an RTMP socket are shipped too. Every link in that
chain is CONFIRMED present in this artifact. What is **not** confirmed, because
nothing here can run it, is that `Camera2Source` actually opens a real sensor
and `GenericStream` actually completes a TLS handshake to a real ingest
server — that is exactly B-005b, the owner's phone.

### What the owner has to do to move this column

Enable USB debugging on an Android 13+ phone, `adb install -r app-debug.apk`,
grant camera and microphone when asked, and report what happened. That is the
whole list. No Play Console, no signing certificate, no account.

### Sideloading the APK — exact steps

**"Install from unknown sources" on a modern Android (13/14/15/16):** there is
no longer a single global toggle. The permission is granted per source app.
When the owner opens the APK file (from Files, a downloads notification, or a
file sent to the phone), Android shows a per-app prompt: **"Install unknown
apps"** → **Allow from this source**, scoped to whichever app opened the file
(Chrome, Files, Gmail, etc.). This appears once per source app, not once per
device, so a second APK from the same source will not prompt again.

**The ordered test, exactly as the owner should run it:**

1. Copy `app-debug.apk` to the phone (USB transfer, a cloud drive link, or
   `adb push`/`adb install` directly — `adb install -r app-debug.apk` is the
   simplest single command and skips the file-manager step entirely).
2. Open the file. Allow the "install unknown apps" prompt for whichever app
   is opening it. Tap **Install**.
3. Open **LIVETAP** from the app drawer.
4. The app requests camera, then microphone, on first use — allow both.
   Denying either leaves `capabilities()` reporting them false and no preview
   will start; there is no separate settings toggle inside the app to retry
   short of Android's own App Info → Permissions screen.
5. Add a destination: paste an RTMP/RTMPS ingest URL and stream key copied
   from a platform's own studio/creator dashboard (no OAuth login is required
   for this path — see BLOCKERS.md B-006 and `docs/OWNER_ACTIONS.md`).
6. Confirm the camera preview is live behind the UI before going live.
7. Tap **GO LIVE**. A persistent notification ("LIVETAP is live") should
   appear immediately — this is the Android 14+ foreground-service
   requirement, not a bug; see "Where Android differs from desktop" below.
8. Verify on the platform side: open the platform's own live dashboard (or
   its public viewer page) and confirm video and audio are actually arriving,
   not just that LIVETAP's UI says LIVE.
9. Tap **Stop**. Confirm the foreground notification disappears and the
   platform's dashboard shows the stream ended within a few seconds.

Report which of these nine steps failed, and the on-screen or logcat text at
that point (`adb logcat` while the app is foregrounded, or
`chrome://inspect` on a desktop Chrome plugged into the same phone over USB —
available specifically because this is a debug build with
`webContentsDebuggingEnabled: true`).

### Where Android differs from desktop — do not assume parity

- **Background streaming survives; desktop's does not need to fight for it.**
  Android aggressively kills background work, so LIVETAP's Android build runs
  the encoder inside `LiveForegroundService`, a `camera|microphone` foreground
  service. This is why step 7 above must show a notification — its absence
  would mean the stream is one app-switch away from being silently killed by
  the OS, not evidence of a quieter implementation.
- **The foreground-service notification is not optional chrome.** It is the
  owner's only handle on a broadcast once they leave the app (there is no
  desktop-style always-visible window), and Android 14+ throws at
  `startForeground()` if the declared service type does not match the held
  permissions — `verify-apk.mjs` asserts the manifest carries
  `camera|microphone` on this service for exactly that reason.
- **Revoking camera or microphone mid-stream does not behave like unplugging
  a desktop webcam.** The native plugin has an `onCameraDisconnected` path and
  emits a `deviceLost` event (`recoverable` flag included) rather than
  crashing, per its source — this has not been exercised on a device, so
  treat the graceful-recovery claim as UNVERIFIED, not PASS.
- **`POST_NOTIFICATIONS` is advisory, not a gate.** On Android 13+ it is a
  real runtime permission; below 13 it does not exist. Denying it costs the
  owner the notification (their handle on the broadcast) but the plugin
  contract does not block `startStream` on it — do not expect GO LIVE itself
  to be refused.
- **Screen share is declared but not wired.** The manifest carries
  `FOREGROUND_SERVICE_MEDIA_PROJECTION` and the service has a
  `mediaProjection` branch, but nothing in the UI calls it. Do not test it;
  there is nothing to test yet.

---

## iOS (Capacitor)

| Capability | Status |
|---|---|
| Every capability | **EXTERNALLY BLOCKED** |

A real Xcode project exists and the plugin package is discovered by `cap sync`,
but the native code has never been compiled: that needs macOS and Xcode, and
distribution needs an Apple Developer account. Recorded as BLOCKERS.md B-005.
Nothing about iOS in this repository is a measurement.

---

## The whole grid, at a glance

| | Windows | macOS | Android | iOS |
|---|---|---|---|---|
| Camera | PASS (synthetic) | BLOCKED | BLOCKED | BLOCKED |
| Microphone | PASS (synthetic) | BLOCKED | BLOCKED | BLOCKED |
| Screen | UNVERIFIED | BLOCKED | BLOCKED | BLOCKED |
| Format | PASS 16:9 + 9:16, UNVERIFIED 1:1 | BLOCKED | UNVERIFIED | BLOCKED |
| Moments | UNVERIFIED | BLOCKED | UNVERIFIED | BLOCKED |
| Authentication | BLOCKED (no client id) | BLOCKED | BLOCKED | BLOCKED |
| Broadcast | PASS | BLOCKED | wiring ASSERTED ON ARTIFACT, running BLOCKED | BLOCKED |
| Reconnect | PASS | BLOCKED | UNVERIFIED | BLOCKED |
| Stop | PARTIAL | BLOCKED | UNVERIFIED | BLOCKED |
| Recording | PASS | BLOCKED | UNVERIFIED | BLOCKED |

One surface has real results. That is the honest summary of where the alpha is
on 2026-09-14, and the one surface that does have them is the one the owner
will install first.

## How to re-run the Windows column

```bash
npm run build -w @livetap/desktop
npm run verify:broadcast
```

One command, one exit code, and a stage-by-stage table at the end.
`infra/dev-harness/broadcast/README.md` explains how to read a failure.
