# Android manual test: the nine steps only a phone can answer

Written 2026-09-14. This is the owner's journey, not a QA plan. Everything in it is a question the
build host physically cannot answer: there is no camera, no microphone, no GPU, no emulator image
under `tools/android-sdk`, and this VM has no nested virtualisation. Everything that COULD be
answered here already has been, by `node apps/mobile/scripts/verify-apk.mjs` (42 assertions on the
artifact) and by `npx vitest run --project mobile --project capacitor-live-stream` (35 tests).

**Time: about 20 minutes.** You need one Android phone (Android 13 or newer exercises the
notification-permission path; the app installs from Android 8.0), a USB cable, and one destination
to broadcast to.

> **Read this first.** The app has never been run. If step 4 shows a black rectangle instead of your
> face, that is a known unknown, not a surprise: the preview is a native `OpenGlView` behind a
> WebView made transparent, and whether that composites correctly on YOUR screen is exactly what
> this document exists to find out. Step 4 has a diagnosis path for that case, and the debug build
> ships with remote inspection turned on so you can actually see what went wrong.

---

## Before you start: build and install

```bash
bash apps/mobile/scripts/build-android.sh
# ends with: [android] install with: adb install -r ".../app-debug.apk"
adb devices                                    # your phone should be listed and 'device', not 'unauthorized'
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

If `adb devices` says `unauthorized`, unlock the phone and accept the USB debugging prompt. If the
phone is not listed at all, enable Developer options (Settings, About phone, tap Build number seven
times) and then USB debugging.

The APK is signed with the Android SDK's debug key. That is enough for your own phone and is not
enough for Google Play, which needs an upload key this repository must never contain
(`GOOGLE_PLAY_READINESS.md` G12).

**Keep a log window open the whole time.** It is the difference between "it did not work" and a fix:

```bash
adb logcat -c                                  # clear, then in a second terminal:
adb logcat LiveStreamPlugin:V LiveForegroundService:V LivetapSecureStore:V Capacitor:V CapacitorConsole:V AndroidRuntime:E *:S
```

---

## Step 1. The app installs and its icon is LIVETAP's

**Do:** look at the home screen and the app drawer.

**Expect:** a dark, near-black rounded square with a white rounded-square outline, a red dot slightly
left of centre, and two arcs radiating right from the dot. That is the LIVETAP mark from
`docs/design/DESIGN_SYSTEM.md` section 1.2.

**If instead** you see the green-and-white Capacitor robot: the launcher icons did not rebuild. Run
`node apps/mobile/scripts/generate-launcher-icons.mjs`, then rebuild and reinstall.

---

## Step 2. It opens to the app, not to the marketing page

**Do:** tap the icon.

**Expect:** a dark splash with the same mark, then the LIVETAP studio. Not a landing page, not a
white screen.

**If instead** you get a white screen, this is the one failure the debug build is built to diagnose.
On a desktop Chrome on the same machine, open `chrome://inspect/#devices`, find the LIVETAP WebView,
click **inspect**, and read the console. `webContentsDebuggingEnabled` is on for this variant
precisely for this moment. `adb logcat` with the `CapacitorConsole:V` filter above shows the same
messages without a desktop browser.

**If instead** you get the LIVETAP marketing page, `stage-web.mjs` did not promote `app.html` to
`index.html`. Re-run the build.

---

## Step 3. It is NOT in demo mode

**Do:** look at the top of the screen.

**Expect:** **no** "Demo mode" banner, and no `(DEMO)` labels on destinations.

**Why this matters more than it looks:** a demo build simulates every destination and every byte. It
will show you LIVE and a climbing bitrate with nothing at all leaving the phone. That is the single
most dishonest state this product can reach, and `build-android.sh` sets
`VITE_LIVETAP_MOCK_MODE=false` to prevent it. If you see the banner, the web bundle was built without
that flag; `verify-apk.mjs` would also have failed its "demo mode is compiled out" check.

---

## Step 4. Camera and microphone permission, then a real picture

**Do:** go to the studio and start the preview.

**Expect, in this order:**
1. The Android permission dialog for **Camera**. Allow.
2. The Android permission dialog for **Microphone**. Allow.
3. On Android 13+, a third dialog for **Notifications**. Allow (see step 7 for why).
4. **Your face, live, filling the stage.**

**Expect in logcat:** `startPreview front=true aspect=9:16` with no exception after it.

**Diagnosis if there is no picture:**

| What you see | Most likely cause | What to check |
|---|---|---|
| An error naming camera or microphone | You denied one, or Android remembered a denial | Settings, Apps, LIVETAP, Permissions. The message names which one. |
| A **black** stage, no error | The GL surface is there but the camera did not open | logcat for `onCameraError` / `onCameraDisconnected` from `LiveStreamPlugin` |
| The app's own dark background, no error | The WebView is painting over the native preview | The preview is a `SurfaceView` BEHIND a transparent WebView. Inspect the page in `chrome://inspect` and check whether the stage element has an opaque background. This is the known cross-layer risk, recorded in `MOBILE_ARCHITECTURE.md` under "Preview compositing". |
| A stretched or squashed picture | Aspect handling on this sensor | Note the phone model and the aspect you chose. `OpenGlView` is set to `AspectRatioMode.Adjust`, which letterboxes rather than stretches, so a stretch here is a real finding. |

**Then:** tap to switch to the rear camera and back. Mute and unmute. Both should be immediate. The
camera flip is `Camera2Source.switchCamera()`, which flips the sensor in place rather than rebuilding
the encoder, so it should not stutter the preview.

---

## Step 5. Add a destination

**Do:** add one **Custom RTMP** destination and paste its server URL and stream key.

**Use a destination you control.** Any of these works: a local MediaMTX on your laptop
(`rtmp://<laptop-ip>:1935/live/phone`, with the phone on the same Wi-Fi), or a real platform's ingest
URL and key. A local server is the better first test because you can see the bytes arrive yourself.

**Expect:** the key is accepted, shown as saved, and never displayed again.

**Why the phone only offers Custom RTMP well today:** a phone encodes once, and `GenericStream` owns
one encoder and one socket, so `maxSimultaneousStreams` is 1. Two destinations from a phone belong
behind a relay (ADR-009), not behind two encodes. A second destination will be refused with a
message saying so, which is the honest behaviour and not a bug.

---

## Step 6. GO LIVE, for real

**Do:** tap GO LIVE.

**Expect:**
1. The destination goes CONNECTING, then LIVE.
2. **Verify on the other end, not in LIVETAP.** On MediaMTX, the publisher appears in its control
   API with a climbing byte count. On a platform, the broadcast appears in its own dashboard.
3. A bitrate that settles near the format's target rather than sitting at zero.

**This is the step that matters.** LIVETAP saying LIVE is a claim; the receiving end showing bytes is
the fact. If they ever disagree, the bug report is "the UI said LIVE and the server saw nothing",
and it is the most serious kind this product can have.

**If it fails:** the card should tell you why in plain words. logcat carries the technical version,
with the endpoint redacted (`rtmp://<redacted>`) because the endpoint contains your stream key.
Common real causes: a wrong key (`INGEST_INVALID_KEY`, reported from `onAuthError`), a phone on a
different network from the server (`NETWORK_OFFLINE`), or a phone whose encoder refused the
resolution, which logs `encoder refused 1080x1920@30` and rejects rather than pretending.

---

## Step 7. The notification, and the End action

**Do:** while live, pull down the notification shade.

**Expect:** an ongoing **LIVETAP is live** notification with an **End broadcast** action.

**Do:** press the home button. Wait fifteen seconds. Check the receiving end.

**Expect:** the byte count keeps climbing. Android keeps the camera and the encoder running behind a
`camera|microphone` foreground service; this is the thing iOS cannot do without an Apple-gated
entitlement.

**Do:** reopen LIVETAP from the notification, then pull the shade down again and tap **End
broadcast**.

**Expect:** the stream stops, the publisher disappears from the receiving end, **and the LIVETAP UI
stops saying LIVE.** All three. Until 2026-09-14 the action stopped the service only, leaving the
encoder running with an open socket and no foreground service, which on Android 14+ means the
broadcast dies at a moment the OS picks with nothing reaching the app. If the card still reads LIVE
after the bytes stop, that regression is back.

**If there is no notification at all** on Android 13+: you denied the notification permission. The
broadcast still runs, which is deliberate, but you have lost your handle on it. Grant it in Settings,
Apps, LIVETAP, Notifications.

---

## Step 8. END from inside the app

**Do:** go live again, then tap END in the app.

**Expect:** the destination leaves LIVE, the publisher disappears from the receiving end within a few
seconds, and the preview keeps running. The preview outliving the broadcast is deliberate: you have
just finished a stream and are still looking at yourself, ready to go again.

**Do:** then leave the studio screen and come back.

**Expect:** still stopped. Nothing republishes by itself.

---

## Step 9. Secrets survive a restart, and the camera indicator goes out

**Do:** force-stop LIVETAP (Settings, Apps, LIVETAP, Force stop), then reopen it.

**Expect:** your Custom RTMP destination is still there and still usable **without pasting the key
again**. The key is encrypted with an AES-256/GCM key generated inside the Android Keystore and
stored in the app's private `SharedPreferences` (`SecureStorePlugin.kt`).

**Do:** while NOT previewing and NOT live, look at the status bar.

**Expect:** no camera or microphone indicator dot. The whole encoder graph is released when nothing
wants the camera, so another app can use the lens.

**Do:** finally, uninstall and reinstall.

**Expect:** the stream key is gone and must be pasted again. The Keystore key is destroyed on
uninstall, so the stored ciphertext is permanently unreadable. That is the correct behaviour, not a
lost setting.

---

## What to report back

For each step, "yes" or what you saw instead. If anything failed, these three attachments make it
fixable without you present:

1. The `adb logcat` output from the filter at the top of this page.
2. A screenshot or a short screen recording of the failure.
3. The phone model and Android version (Settings, About phone).

And one number worth recording even when everything works: after ten minutes live, the phone's
temperature and whether the bitrate held. `LiveStreamPlugin` forwards the OS thermal status as a
`thermal` event, and `serious` or above is the OS warning you that it is about to throttle the
encoder. The step-down thresholds in `MOBILE_ARCHITECTURE.md` section 6 are still marked
`UNVERIFIED` for exactly one reason: nobody has had a phone that got hot.

---

## What this document does not cover, and why

- **iOS.** The Swift half has never been compiled; there is no Xcode on the build host. It is not a
  matter of testing it, it is a matter of nobody having built it once.
- **Screen sharing.** Post-MVP on both platforms. The manifest pre-declares the `mediaProjection`
  foreground-service type (adding one later costs another Play review round) but no code path
  requests consent, and `capabilities().screenCapture` reports `false`.
- **OAuth to a platform from the phone.** The `livetap://oauth` deep link is registered and the
  broker work is another workstream's. Step 5 deliberately uses Custom RTMP, which needs no account
  and no developer console, so that the camera, the encoder and the socket can be tested without
  waiting on anybody's app review.
- **Play Store anything.** See `GOOGLE_PLAY_READINESS.md`. This APK is for your phone.
