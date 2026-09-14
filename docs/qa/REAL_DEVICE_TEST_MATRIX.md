# Real device test matrix

Written 2026-09-14 on the build host: a headless Windows Server 2022 VM, four
vCPU, no GPU, no camera, no microphone, no nested virtualisation, no macOS and
no physical phone.

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

A debug APK builds on this host. **Nothing in it has ever been executed**:
there is no emulator image under `tools/android-sdk`, and this VM has no nested
virtualisation, so no emulator can ever start here. Everything below that is
not EXTERNALLY BLOCKED was verified by inspecting the built APK
(`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 10,160,804
bytes, built 2026-09-14 12:36, 552 entries).

| Capability | Status | What was checked |
|---|---|---|
| Camera | **EXTERNALLY BLOCKED** | `android.permission.CAMERA` and `FOREGROUND_SERVICE_CAMERA` are declared in the built manifest; `GenericStream` and `LiveStreamPlugin` are present in the dex. Whether a camera opens is owner hardware |
| Microphone | **EXTERNALLY BLOCKED** | `RECORD_AUDIO` and `FOREGROUND_SERVICE_MICROPHONE` declared |
| Screen share | **EXTERNALLY BLOCKED** | `FOREGROUND_SERVICE_MEDIA_PROJECTION` declared |
| Format | **UNVERIFIED** | `MobileEngine` refuses an aspect mismatch in unit tests. No native encode has run |
| Moments | **UNVERIFIED** | |
| Authentication | **EXTERNALLY BLOCKED** | `SecureStorePlugin` is present in the dex, so tokens have somewhere real to live. No OAuth has run on a device, and there is no client id to run it with |
| Broadcast | **EXTERNALLY BLOCKED** | one of the 39 bundled JavaScript assets references the plugin, so the web layer can reach the native one. Whether RTMP leaves a phone is owner hardware |
| Reconnect | **UNVERIFIED** | |
| Stop | **UNVERIFIED** | `LiveForegroundService` is in the dex |
| Recording | **UNVERIFIED** | |
| Diagnosability | **ASSERTED ON THE ARTIFACT** | `assets/capacitor.config.json` has `webContentsDebuggingEnabled: true`, so a sideloaded alpha with a white screen can be inspected over adb rather than being undiagnosable |
| `POST_NOTIFICATIONS` | **ASSERTED ON THE ARTIFACT** | declared, which is what Android 13+ needs for the foreground-service notification |

**What the owner has to do to move this column:** enable USB debugging on an
Android 13 or newer phone, `adb install` the APK, grant camera and microphone
when asked, and report what happened. That is the whole list. No Play Console,
no signing certificate, no account.

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
| Broadcast | PASS | BLOCKED | BLOCKED | BLOCKED |
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
