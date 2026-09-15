# HANDOFF — LIVETAP

Status: **REAL-WORLD ALPHA SHIP, in progress (2026-09-15).** The completion gate
proves a real three-shape broadcast with failure isolation and a clean END; its
newest assertion, that a dropped destination comes BACK, found that feature
broken and the fix is not yet re-verified end to end. Everything below is
verified on the build host unless labelled otherwise; see IMPLEMENTATION_STATUS.md for
per-area labels and BLOCKERS.md for the human dependency queue. Release audit:
docs/release/RELEASE_AUDIT.md.

## Read these first

| Document | What it answers |
|---|---|
| `docs/qa/REAL_WORLD_ALPHA_READINESS.md` | the owner's completion gate, item by item, with what is proven, what is proven only against the local harness, and what waits on the owner |
| `docs/OWNER_ACTIONS.md` | **everything the owner has to do, once, in order.** Do not ask them for things one at a time |
| `docs/platforms/PLATFORM_AUTH_MATRIX.md` | why each platform is Level 1, 2, 3 or 4, and the exact console steps per platform |
| `docs/qa/UX_POLISH_PASS.md` | the 2026-09-15 polish pass: what the copy audit found, the type system, the `hidden` bug class, and the measured 23.9 -> 44.1 fps |
| `docs/qa/REAL_PLATFORM_TEST_MATRIX.md` | per destination: what has actually been run against the real platform (today: almost nothing, and it says so) |
| `docs/qa/REAL_DEVICE_TEST_MATRIX.md` | per surface: Windows, macOS, Android, iOS |
| `docs/security/REAL_CREDENTIAL_SECURITY.md` | where every token and stream key lives now that they are real, and which guarantees hold today |
| `docs/architecture/REAL_BROADCAST_PIPELINE.md` | the path from a lens to a platform, on each surface |
| `infra/dev-harness/broadcast/README.md` | the completion gate as one command, and how to read a failure |

## The state of the broadcast, in two sentences

The built desktop app captures through the real `getUserMedia`, composes one
canvas per aspect ratio, encodes with Chromium, muxes with real ffmpeg and
publishes **three simultaneous RTMP streams at 1920x1080, 1080x1920 and
1080x1080** that a real server accepts and ffprobe decodes as H.264 plus AAC.
One is dropped at the TCP level mid-broadcast and the others keep climbing; END
clears every publisher, even if the creator leaves the studio mid-grace.

Nothing in that chain is mocked, and it reproduces from a clean build:
`npm run verify:broadcast`.

## Resolved since 2026-09-14

Every item that was open on this page a day ago, and what happened to it.

0. **"A destination reports LIVE with no publisher behind it" — RESOLVED, and it
   was two separate faults wearing one symptom.** The desktop renderer was being
   built without `VITE_LIVETAP_MOCK_MODE=false`, so the app the owner would have
   installed was a demo of itself; that is fixed and asserted on the artifact.
   Underneath it sat a real one: the production reached LIVE when `engine.start()`
   resolved, which means the encoder started, not that a byte arrived anywhere.
   The production now becomes LIVE on the first `outputUp`, which every engine
   emits only on evidence, and the clock starts with it.
1. **Custom RTMP simulated when it need not be — RESOLVED**, and gone much
   further: every platform whose API path is not configured now gets the real
   paste adapter wearing its own profile.
2. **The desktop app builds in demo mode — RESOLVED** (`scripts/build-renderer.mjs`).
3. **Studio points a returning creator at the wrong action — RESOLVED.** Stream
   keys are deliberately not persisted, so yesterday's destinations come back
   listed and unusable, and Studio answered that with "add a destination". It now
   names the destination whose key did not survive.
4. **The `-authorization` redactor asymmetry — DECIDED.** `packages/core` owns it.
   The asymmetry that actually mattered ran the other way and is fixed: core
   masked URL userinfo for rtsp alone while the adapters' redactor covered rtsp,
   srt, http(s) and ws(s) — and core is the one guarding the main-process log.
5. **The driver cannot drive a non-demo build — RESOLVED**, and the coupling that
   caused it is gone: both harnesses now ask `studio-controls.mjs` for controls
   by what they do, and the product publishes `data-lt-stop` and `data-lt-connect`
   to answer.
6. **Reconnect-and-return-to-LIVE unverified — NOW VERIFIED AS BROKEN, AND FIXED.**
   The gate watches for it now. Chromium emits a keyframe every 7.2 s and ffmpeg
   gives a late joiner 5 s to learn the stream, so the reconnecting sender was
   mathematically unable to lock on and died every time with "Could not write
   header". The recorder now asks for a 2 s keyframe interval — which Twitch
   requires anyway — and the sender gets a 20 s analyze window.

## Open handoffs, 2026-09-15

1. **The web surface cannot broadcast without a relay, and should say so louder.**
   `BrowserEngine` honestly refuses RTMP with no WHIP relay configured, which is
   correct, but the deployed site is where a curious visitor lands first.
2. **Two `useElapsed` implementations** exist, in `Studio.tsx` and `LiveBar.tsx`.
   They agree today. They are one edit from disagreeing about how long a
   broadcast has been running.
3. **macOS and iOS remain entirely unverified.** No Mac exists on this host.

## Where things are

| Item | Location |
|---|---|
| Web app (production, mock mode) | https://livetap.vercel.app |
| Source | https://github.com/BigBackBitcoin/livetap (branch `main`) |
| Desktop unsigned Windows installer | built locally at `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` (not committed; rebuild with `npm run package:win -w @livetap/desktop` using Node ≥ 20.19) |
| Mobile projects | `apps/mobile/ios`, `apps/mobile/android`, plugin `packages/capacitor-live-stream` |
| Relay | `infra/relay` (MediaMTX 1.21.0 + session API) |

## Owner-only decisions queued

1. **License**: MIT is in place; research recommends Apache-2.0 for its patent grant (ADR-013). Decide before the first tagged release while the contributor base is small.
2. **FFmpeg source offer** hosting and legal contact (B-002).
3. **LinkedIn Live**: partner terms conflict with open-source distribution; MVP ships it as unavailable (B-003).
4. **Kick launch timing**: research recommends launch+1 with a payout-policy warning for long-form multistreaming.
5. **Vertical as an intent vs. an orientation control**: switching-triggers research suggests the latter; the MVP ships six intents (cheap to change later).

## One-command human actions (from BLOCKERS.md)

- B-001 `gh auth refresh -h github.com -s workflow` then move `.github/workflows-pending/*.yml` to `.github/workflows/` → CI, macOS/Ubuntu runner builds.
- B-006 **`docs/OWNER_ACTIONS.md`** is the whole list, in order, with every redirect URI and scope → real YouTube/Twitch/Kick/Facebook go-live. Start with Twitch: ten minutes, no review, no queue.
- B-004/B-005c/B-005d signing certificates and store accounts → signed desktop releases, TestFlight/Play testing. **B-005's Android toolchain half is resolved**: `bash tools/acquire-android-toolchain.sh` installs a portable JDK 21 and Android SDK 36 and the debug APK builds. What remains is a physical phone (B-005b).
- B-007 run `npm run verify:engine -w @livetap/desktop` on a machine with a GPU and camera → hardware PASS labels.

## Public experience (rebuilt 2026-09-14 for the first-time creator audit)

https://livetap.vercel.app/ is an interactive product surface: one fixed LIVETAP console, operated through eight chapters (hero, break it, shapes, moments, outputs, versus, pro, make). What changed on 2026-09-14 (audit docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md, closure docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md, retest docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_RETEST.md): the stage shows real footage from first paint and "Use my camera" puts the visitor's own camera on it (local only); the statement is above the fold; chapter copy lives in one fixed band layer; the guided demo stops at READY and hands over ("Your turn"); break-it is chapter two with a one-tap path; six platform-shaped outputs are drawn from the same production; Simple/Pro is a labelled control; the intents change the stage; an OBS comparison with measured numbers only; no Download while nothing ships; phones open vertical.

Deploying: prebuilt from the workspace. `cd apps/web && npx vercel build --prod && npx vercel deploy --prebuilt --prod`. vercel.json's installCommand is deliberately a no-op echo: `vercel build` otherwise runs `npm ci` under the host's Node 20 and wipes node_modules (it did, once). Reinstall with the portable Node 22: `PATH=tools/node22:$PATH npm ci && node node_modules/electron/install.js`.

Regenerating the sample footage: `apps/web/public/brand/creator.*` and `guest.*` were generated (Higgsfield, seedance 2.5) and encoded with ffmpeg (960x540, h264 crf 27 / vp9 crf 36, poster webp). Replace them with real footage the owner licenses whenever available; the page reads them only through picture.ts.

## How to test (mock mode, no credentials)

0. First-time creator path, on the public page itself: load https://livetap.vercel.app, watch three destinations turn Ready in four seconds, tap GO LIVE, scroll to "Break it yourself" and press "Break YouTube for me" (or drag a live tile off the stage), then tap "Use my camera".
1. Open https://livetap.vercel.app → Open LIVETAP.
2. Choose an intent (e.g. Talking), pick YouTube and TikTok, continue past camera/mic (a test pattern appears when no camera exists), Open Studio.
3. Tap GO LIVE; a 3-second cancellable countdown runs; both destination chips reach LIVE (YouTube 16:9, TikTok 9:16 from one production).
4. Pro mode → Diagnostics → demo scenarios: drop one destination and watch it go RECONNECTING → LIVE while the other stays LIVE; trigger camera-lost and encoder-crash notices (WHAT/WHY/DOING/YOU CAN cards).
5. Destinations → Add → Custom RTMP: a malformed server address is refused inline; a valid one reaches READY.

Local: `npm install && npm run dev:web` (http://localhost:5173); `npm test`; `npm run e2e -w @livetap/web`.

## Review outcomes

- Security (docs/qa/SECURITY_REVIEW.md): 4 release-blocking findings fixed with regression tests — stream keys were written to the desktop log on every go-live; relay hook quoting allowed a backslash escape; a trailing-space URL bypassed validation; relay destinations could reach internal addresses (SSRF). Subsequently narrowed: CSP now `style-src 'self'; style-src-attr 'unsafe-inline'`; relay ships an opt-in Caddy TLS profile.
- Product (docs/qa/PRODUCT_REVIEW.md): verdict was NOT-YET on first look; 7 P0 + 15 P1 fixed (END was dead while live, error cards rendered off-screen, GO LIVE below the fold, over-claiming landing, developer vocabulary, reload honesty, hidden mobile nav). All 15 P2 polish items subsequently fixed.
- Desktop smoke (Playwright Electron): the packaged shell opens in onboarding under hash routing.

## Desktop test instructions

1. `npm run build -w @livetap/desktop` then `node apps/desktop/e2e/smoke.mjs` (needs the Electron binary; on Node < 20.19 run `node node_modules/electron/install.js` with Node 22 first).
2. Unsigned installer: `npm run package:win -w @livetap/desktop` (Node ≥ 20.19) → `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe`; drop an FFmpeg binary at `apps/desktop/resources/ffmpeg/win/ffmpeg.exe` before packaging to enable streaming.
3. Engine verification on a machine with FFmpeg: `npm run verify:engine -w @livetap/desktop`.

## Known limitations (honest)

- All platform go-live behaviour is verified against mocks and recorded API fakes; no real credentials existed on the build host.
- No camera, microphone or GPU on the build host: real capture and hardware encoders are UNVERIFIED (software x264 path is PASS).
- Desktop builds are unsigned; auto-update is inert until signed.
- Mobile native code has never been compiled (no macOS/JDK/Android SDK on host); projects are structurally complete and CI-ready.
- Public page JS is 46 KB gzipped (static Live-surface experience, no React on the landing); the ≤60 KB target is met.
- Web go-live needs the self-hosted relay; browsers cannot speak RTMP. Container packaging of the relay is unverified on this host (native binary verified).
