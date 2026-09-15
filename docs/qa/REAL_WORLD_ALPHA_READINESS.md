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
| 1 | REAL DESKTOP APP | **PASS** | `LIVETAP-0.1.0-win-x64.exe`, 230,666,763 bytes, sha256 `9f148bce…d07001`. `scripts/verify-installer.mjs` 32/32: the bundled ffmpeg runs and has libx264/aac/rtmp/rtmps, the asar holds the built renderer, and the renderer is the REAL build — two independent witnesses that must agree. `scripts/smoke-installed.mjs` launched the packaged app: it opened on "Step 1 of 3 — What are you making?", `isPackaged: true`, `ffmpeg.source: "bundled"` |
| 2 | REAL ANDROID APK | **PASS as an artifact, UNPROVEN on hardware** | `app-debug.apk`, 10,196,764 bytes, sha256 `29d943b5…b1ec5e`, `app.livetap.mobile` 1.0 (1), minSdk 26 / targetSdk 36, debug-signed. `verify-apk.mjs` 47/47. The real engine does reach the phone: `@livetap/mobile` is inlined into the boot chunk, and `LiveStreamPlugin`, `GenericStream`, `Camera2Source` and `MicrophoneSource` are in the dex. **No device and no emulator can exist here** — this VM reports `VMMonitorModeExtensions=False`. BLOCKERS B-005b |
| 3 | REAL SOCIAL AUTH | **PASS through the app's own UI, UNPROVEN against a real platform** | `npm run e2e:oauth -w @livetap/desktop`, exit 0. The built desktop app signed a creator in through its own Add-destination sheet: real PKCE S256 with a 43-character challenge, a high-entropy state, an RFC 8252 loopback redirect, a consent screen, a code exchanged exactly once and bound to both the challenge and the redirect, a token in the Electron vault, the account named on the card, **no stream key ever shown** (watched by a MutationObserver for the whole run), a token the platform had already killed renewed rather than surfaced as an error, Disconnect that the identity provider agreed with, and none of the 14 credentials the broker saw in transit appearing in any console, log, page text or localStorage. The identity provider is `infra/dev-harness/fake-idp/`, which genuinely verifies PKCE and rotates refresh tokens; the one step replaced is the human opening a browser. Nothing here has spoken to a real platform. Separately, every priority platform yields a real destination with nothing registered at all — `npm run verify:paste` |
| 4 | REAL CAMERA | **PASS, and now also PASS with NO camera** | `navigator.mediaDevices.getUserMedia`, the production API, with Chromium's synthetic source. Every line of permission handling, track lifecycle and constraint negotiation runs for real; the photons are fake and nothing else is. **The absence of a camera is now tested too, and it used to fail**: `--no-fake-camera` withholds the synthetic device, and on the owner's own host — `enumerateDevices()` returns three `audiooutput` entries and nothing else — the app produced 0 of 3 publishers, three times. Fixed in `fc84167`; see `NO_CAPTURE_DEVICE_DEFECT.md` |
| 5 | REAL MICROPHONE | **PASS, and PASS with no microphone** | AAC LC 48000 Hz stereo, decoded by ffprobe off what the server recorded, on all three shapes. With NO microphone the mix now carries real silence rather than nothing: `buildAudioMix` connects a `ConstantSourceNode` at offset 0, because a WebAudio destination with no inputs never renders and `MediaRecorder` will not emit a chunk until every track has produced data. That stall was the whole of the defect in row 4 |
| 6 | REAL BROADCAST | **PASS, with and without capture devices** | Three simultaneous RTMP publishers from one production. MediaMTX parsed H264 1920x1080, 1080x1920 and 1080x1080 out of the streams' own SPS; ffprobe decoded all three recordings back. Re-proven on a host with **no camera and no microphone** after `fc84167`: `--no-fake-camera` exits 0 with 128,900 / 153,541 / 134,726 bytes decoded as H.264 + AAC on the three shapes |
| 7 | REAL STOP | **PASS** | END removes every publisher, and survives the creator leaving the studio mid-grace. That stage exists because a stop a route change can cancel is a broadcast the creator cannot end |
| 8 | REAL FAILURE ISOLATION | **PASS** | A real TCP kill on one live publisher; the survivors climbed 3,195,228 → 3,529,560 bytes through it and the app went on reporting a live broadcast |
| 9 | REAL RECONNECT | **PASS** | `live/tall republished on its own 18.9s after the drop`, carried real bytes again (1,646,584 → 1,904,519), came back as H264 1080x1920 — the shape it left — and the app stopped calling it reconnecting. The first run that asserted this found it **broken**: see "What the harness caught" |
| 10 | REAL SECURITY | **PASS, with the findings listed** | `docs/security/REAL_CREDENTIAL_SECURITY.md`. 83 security assertions plus a 55-assertion secret-log harness. The HIGH finding — desktop token storage was silently unreadable — is fixed |
| 11 | NO CRITICAL CLICK-THROUGH | **PASS** | `apps/web/e2e/interaction-ownership.spec.ts` — a grid of points across every route and viewport asserting nothing hit-testable is invisible. This class of bug has been found here **four** times, so the guard is no longer JavaScript: `.ltp-band` derives `--ltp-touchable` from the same expression as its opacity and clips itself to zero area, which holds with the main thread starved for 350 ms. The fourth instance was the guard's own OPEN end — `inset(0)` clips to the border box, which broke the one band that paints outside it — fixed in `18f7702` and pinned by a test that hit-tests both ends of the switch. The Quick Tour offer, the last surface that answered for controls it did not own, became a banner in the flow in `38ddd2b` |
| 12 | NO UNREACHABLE END CONTROL | **PASS** | `apps/web/e2e/end-invariant.spec.ts` — the stop control present, topmost at its own centre point, keyboard-reachable and functional across the state matrix. Reinforced in `de16128`: an armed countdown no longer survives a route change invisibly, because the clock moved into the store and leaving the studio cancels it audibly rather than silently going live on return |
| 13 | REAL 16:9 | **PASS** | 1920x1080, parsed from the stream's own SPS |
| 14 | REAL 9:16 | **PASS** | 1080x1920 — a true vertical composition, not a letterboxed wide one. The dimensions on the wire are the only thing that can tell those apart, which is why they are asserted there |
| 15 | REAL 1:1 | **PASS** | 1080x1080, simultaneously with the other two |
| 16 | STUDIO PARITY | **PARTIAL** | The app and the public page share the camera, media, Moments, format engine, destination model, broadcast state and output composition. The drag-off-stage signature move is now real in the app and stops an actual destination. The public page keeps playgrounds the app has no use for |
| 17 | PERFORMANCE ACCEPTABLE | **PASS on this host, with the ceiling stated** | The reported 22.5 fps and 18 canvases reproduce on the MARKETING page, which runs at 60.2 fps. The studio has three canvases, none in the DOM. The multi-second task was `localStorage.getItem` at 1017 ms, now read once. This VM's own idle rAF ceiling is 31 fps, so 60 is unreachable here regardless of code |
| 18 | UX / TYPOGRAPHY / SPACING | **PASS** | Six control heights became the three that were declared; card padding unified; the icon `size` prop fixed, having never worked anywhere in the product; clipped device labels, an 880px control around 230px of content, and a claim about a level meter this product does not draw, all gone. `packages/ui/src/scale.test.ts` fails on a spacing literal, a fourth control height or a fifth icon size |
| 19 | FIRST-TIME CREATOR EXPERIENCE | **NOT YET RETESTED** | §40 requires an independent blind audit that has not read this document. The most recent scored audit is A3 at **114/150** against `471d998`, and the defects it opened have since been fixed — but a score is not inherited by a later build, so this row stays open until an audit is run against the released artifacts |

---

## Reconciliation with the independent status audit

A second session audited this product on the same day, against `18f7702`, and
wrote `LIVETAP_100_PERCENT_PRODUCT_STATUS.md`. It scores the product at **50%
overall** and recommends **C — functional prototype**. This document is a wall of
PASS. Both are in the repository and a reader deserves to know why they disagree,
because the answer is not that one of them is wrong.

**They measure different questions.**

This document answers *"is the capability real on this host"* — the gate the
owner's §41 release list actually asks. Its rule is stated at the top: a row is
PASS only if something was executed that would have failed had the capability
been absent. By that rule REAL BROADCAST is a genuine PASS, because ffprobe
decoded H.264 at 1920x1080, 1080x1920 and 1080x1080 off a real server's disk.

The audit answers *"what can the owner do today"*. By that rule the same fact is
30%, because the only way to reach it is to build from source, on Windows, with a
pasted stream key.

Both are true at once, and the second is the one that matters to a person trying
to use this. **Where the two disagree, prefer the audit**, and treat this table as
what has been proven rather than as what is available.

**The four facts the audit is right about, which this table does not say loudly
enough:**

1. **The deployed website broadcasts nothing.** Mock mode is on, no relay is
   deployed, and a browser has no RTMP socket. The product says so itself in its
   own banner, so it is honest — but the central thesis is undelivered on the one
   surface a stranger actually visits. Deploying `infra/relay/` is the single
   change that moves it, and it is blocked here by a system Caddy on 443/80/2019
   and gated on the owner's DNS and certificates.
2. **No OAuth client is configured on any surface.** `GET /api/oauth/config`
   returns `mockMode:true` with all four platforms `configured:false`. Row 3 says
   the flow is real and it is; nobody can use it today. Owner-only dependency,
   steps in `docs/OWNER_ACTIONS.md`.
3. **A reused receiver was recorded as PASS** by the completion gate, so every
   gate run that found one listening carried unmeasured shared state. Fixed in
   `508c1a2` — it is a WARN now, it says how old the receiver is and how many
   recordings predate the run, and `--own-receiver` refuses to share one at all.
   Rows 6 through 9 rest on gate runs made before that fix.
4. **Bond is a workspace package with no dependents.** Not merely unimported:
   `grep -rn "@livetap/bond" apps packages` outside its own package returns
   nothing, and the only `package.json` hit is its own name. It carries no part
   of the shipping media path.

**One finding from that audit is open and deliberately not resolved here.** It
reported `live on 1 of 3` from one gate run and all three from another, minutes
apart on the same HEAD, and downgraded it in writing to a P0-candidate marked
CONFOUNDED once it emerged that both runs shared a receiver with a concurrent
session. It needs one isolated re-run — one session, one receiver, an empty
recordings tree — before anyone treats it as a defect or dismisses it. That run
is pending and its outcome will be recorded either way, including if it vindicates
the original instinct.

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
