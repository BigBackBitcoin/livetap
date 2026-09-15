# Real-world alpha readiness

Written 2026-09-14, rewritten 2026-09-15 against the owner's **release gate**
(§41 of the ship directive) rather than against the earlier completion gate,
which it had outgrown.

Every row says what was measured and with which command, and says UNPROVEN where
nothing was. The rule this document keeps: a capability is PASS only if
something was executed that would have failed had the capability been absent. A
passing unit test of the arithmetic behind a feature is not the feature.

> **The proof harness passes 4 of 4 stages, 2026-09-15 03:53.** Three
> simultaneous publishers at 1920x1080, 1080x1920 and 1080x1080 from one
> production; a real TCP kill that the survivors rode through; the dropped
> destination back on its own 18.9 s later at the shape it left; and an END that
> clears every publisher even when the creator walks away mid-grace.

---

## The release gate, item by item

| # | Gate item | Verdict | The evidence |
|---|---|---|---|
| 1 | REAL DESKTOP APP | **PASS** | `LIVETAP-0.1.0-win-x64.exe`, 230,661,718 bytes, sha256 `52952ee8…43f65a`. `scripts/verify-installer.mjs` 30/30: the bundled ffmpeg runs and has libx264/aac/rtmp/rtmps, the asar holds the built renderer, and the renderer is the REAL build — two independent witnesses that must agree. `scripts/smoke-installed.mjs` launched the packaged app: it opened on "Step 1 of 3 — What are you making?", `isPackaged: true`, `ffmpeg.source: "bundled"` |
| 2 | REAL ANDROID APK | **PASS as an artifact, UNPROVEN on hardware** | `app-debug.apk`, 10,151,907 bytes, sha256 `0674ed32…526743`, `app.livetap.mobile` 1.0 (1), minSdk 26 / targetSdk 36, debug-signed. `verify-apk.mjs` 47/47. The real engine does reach the phone: `@livetap/mobile` is inlined into the boot chunk, and `LiveStreamPlugin`, `GenericStream`, `Camera2Source` and `MicrophoneSource` are in the dex. **No device and no emulator can exist here** — this VM reports `VMMonitorModeExtensions=False`. BLOCKERS B-005b |
| 3 | REAL SOCIAL AUTH | **PASS for the paste path, UNPROVEN against a real platform API** | Every priority platform yields a real destination with nothing registered anywhere (`packages/adapters/src/paste/`, `state/registry.ts`, 43 tests). The API path runs end to end against `infra/dev-harness/fake-idp/`, a server that genuinely verifies PKCE and rotates refresh tokens. Nothing on this host has ever spoken to a real platform's OAuth |
| 4 | REAL CAMERA | **PASS** | `navigator.mediaDevices.getUserMedia`, the production API, with Chromium's synthetic source. Every line of permission handling, track lifecycle and constraint negotiation runs for real; the photons are fake and nothing else is |
| 5 | REAL MICROPHONE | **PASS** | AAC LC 48000 Hz stereo, decoded by ffprobe off what the server recorded, on all three shapes |
| 6 | REAL BROADCAST | **PASS** | Three simultaneous RTMP publishers from one production. MediaMTX parsed H264 1920x1080, 1080x1920 and 1080x1080 out of the streams' own SPS; ffprobe decoded all three recordings back |
| 7 | REAL STOP | **PASS** | END removes every publisher, and survives the creator leaving the studio mid-grace. That stage exists because a stop a route change can cancel is a broadcast the creator cannot end |
| 8 | REAL FAILURE ISOLATION | **PASS** | A real TCP kill on one live publisher; the survivors climbed 3,195,228 → 3,529,560 bytes through it and the app went on reporting a live broadcast |
| 9 | REAL RECONNECT | **PASS** | `live/tall republished on its own 18.9s after the drop`, carried real bytes again (1,646,584 → 1,904,519), came back as H264 1080x1920 — the shape it left — and the app stopped calling it reconnecting. The first run that asserted this found it **broken**: see "What the harness caught" |
| 10 | REAL SECURITY | **PASS, with the findings listed** | `docs/security/REAL_CREDENTIAL_SECURITY.md`. 83 security assertions plus a 55-assertion secret-log harness. The HIGH finding — desktop token storage was silently unreadable — is fixed |
| 11 | NO CRITICAL CLICK-THROUGH | `apps/web/e2e/interaction-ownership.spec.ts` | A grid of points across every route and viewport, asserting nothing hit-testable is invisible. This class of bug has been found here three times |
| 12 | NO UNREACHABLE END CONTROL | `apps/web/e2e/end-invariant.spec.ts` | The stop control present, topmost at its own centre point, keyboard-reachable and functional across the state matrix |
| 13 | REAL 16:9 | **PASS** | 1920x1080, parsed from the stream's own SPS |
| 14 | REAL 9:16 | **PASS** | 1080x1920 — a true vertical composition, not a letterboxed wide one. The dimensions on the wire are the only thing that can tell those apart, which is why they are asserted there |
| 15 | REAL 1:1 | **PASS** | 1080x1080, simultaneously with the other two |
| 16 | STUDIO PARITY | **PARTIAL** | The app and the public page share the camera, media, Moments, format engine, destination model, broadcast state and output composition. The drag-off-stage signature move is now real in the app and stops an actual destination. The public page keeps playgrounds the app has no use for |
| 17 | PERFORMANCE ACCEPTABLE | **PASS on this host, with the ceiling stated** | The reported 22.5 fps and 18 canvases reproduce on the MARKETING page, which runs at 60.2 fps. The studio has three canvases, none in the DOM. The multi-second task was `localStorage.getItem` at 1017 ms, now read once. This VM's own idle rAF ceiling is 31 fps, so 60 is unreachable here regardless of code |
| 18 | UX / TYPOGRAPHY / SPACING | **PASS** | Six control heights became the three that were declared; card padding unified; the icon `size` prop fixed, having never worked anywhere in the product; clipped device labels, an 880px control around 230px of content, and a claim about a level meter this product does not draw, all gone. `packages/ui/src/scale.test.ts` fails on a spacing literal, a fourth control height or a fifth icon size |
| 19 | FIRST-TIME CREATOR EXPERIENCE | **NOT YET RETESTED** | §40 requires an independent blind audit that has not read this document. It has not been run against the final build |

---

## What the harness caught, by being asked a question nobody had asked

Every previous run asserted that the SURVIVOR kept climbing through a failure and
then went straight to END. "The failed destination reconnects independently" —
which is on the front of this product — rested entirely on a unit test of the
backoff arithmetic.

The first run that watched for it found it broken, and the cause was arithmetic
of a different kind. Chromium's MediaRecorder emits a keyframe about every 7.2
seconds (measured with ffprobe on a real recording: 2.058, 9.383, 16.620,
23.831). A reconnecting destination is a brand-new ffmpeg attached to a stream
already in flight, and it cannot write its output header until it has seen a
keyframe carrying the H.264 parameter sets. ffmpeg's default analyze window is 5
seconds. 7.2 against 5: the reconnected sender was **mathematically unable** to
lock on, and died every time with "Could not write header (incorrect codec
parameters ?)".

Both halves are fixed, because either alone is a coin toss. The recorder now asks
for a keyframe every 2 seconds — confirmed at 2.02 s in the new recordings, and
something Twitch requires anyway, since its ceiling is 4 s — and the sender gets
a 20-second analyze window so a reconnect still works on an engine that ignores
the hint.

---

## What is genuinely proven on this host

Each of these is a command anyone can re-run.

### The receiver is honest before the product is blamed

    node infra/dev-harness/ingest/selftest.mjs

A synthetic H.264 plus AAC push arrives over real RTMP, decodes live, records to
a fragmented MP4 that ffprobe reads back, and survives a deliberate TCP kill.
Every run uses a freshly randomised path, so a pass can never be explained by a
recording an earlier run left behind. It runs on its own ports, so the gate
cannot be defeated by a receiver something else left listening — which is how it
failed once, having proven nothing about the product.

### A real broadcast, three shapes, from one production

    node infra/dev-harness/broadcast/verify-desktop-broadcast.mjs

The built Electron app, driven through its own UI by Playwright, with no test
hooks, no injected engine and no store surgery. Every link is the production one:

| Link | What it was |
|---|---|
| capture | `navigator.mediaDevices.getUserMedia` |
| composition | one real canvas per aspect, at the format's true dimensions |
| encode | Chromium MediaRecorder, mimeType probed at run time, 2 s keyframes |
| transport to main | `window.livetap.engine.pushChunk` over the real contextBridge |
| mux and send | real ffmpeg 9.0.1 children, `-c copy -f flv` |
| server | MediaMTX v1.21.0, real RTMP handshake, real recording |
| evidence | MediaMTX's control API, then ffprobe independently |

### No credential can reach a log line

    npx vitest run --config infra/dev-harness/broadcast/vitest.config.ts

Realistic carriers holding realistically shaped credentials, checked against both
redactors; every credential field name checked against both, so the two lists
cannot drift apart; and a scan of the shipped source for a logging call that
names something credential-bearing with no redactor around it. The scan's
detector is proven against the two leaks a previous security review actually
found, before its silence is trusted.

---

## What waits on the owner, and only on the owner

1. **A phone.** The APK builds and verifies. No device and no emulator can exist
   on this host.
2. **OAuth client ids**, for the path where LIVETAP fetches the stream key itself
   and the creator never sees one. Not needed in order to broadcast — see
   `docs/OWNER_ACTIONS.md`, rewritten on 2026-09-15 once that stopped being true.
3. **A Mac.** Every macOS and iOS claim in this repository is unverified.
4. **Code-signing identities.** The installer is unsigned and Windows SmartScreen
   will say so; `docs/release/ALPHA_RELEASE.md` says which button to press.
