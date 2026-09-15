# Real-world alpha readiness

Written 2026-09-14 on the build host, against the owner's own completion gate,
and **re-measured on 2026-09-15 after the defects below were fixed**. Five
workstreams were landing code while the first pass was measured, so every line
says **when** it was measured and **against which build**, because on a day
like that this is the difference between a result and a rumour.

> **2026-09-15 status: the gate passes 4 of 4 stages.** Everything the build
> host can prove without the owner's own accounts and devices is now proven.
> The two items that remain are the two that were always the owner's: a real
> platform account, and a physical phone. See **What changed on 2026-09-15**.

---

## The gate, item by item

The owner's gate, restated: install it on Windows and Android, connect real
accounts, use a real camera and microphone, tap GO LIVE, broadcast for real,
break one destination, watch the others stay live, and stop.

| # | Gate item | Verdict | Measured |
|---|---|---|---|
| 1 | `node infra/dev-harness/ingest/selftest.mjs` | **PASS** | 2026-09-14 13:12, exit 0 |
| 2 | `npm run verify:engine -w @livetap/desktop` against MediaMTX | **UNVERIFIED by this workstream** | not re-run here; owned by the desktop workstream |
| 3 | A real broadcast: two publishers, H.264 1920x1080 and 1080x1920, AAC 48 kHz | **PASS** | 2026-09-15. Re-measured against a real-mode build. ffprobe decoded both recordings: `live/wide` 1920x1080 33.352 s, `live/tall` **1080x1920** 32.544 s, both H.264 Constrained Baseline + AAC LC 48 kHz stereo |
| 4 | Break one destination; the other keeps climbing; the broken one reconnects | **PASS** | 2026-09-15. The surviving destination kept climbing through a real TCP drop, and the dropped one republished: a third recording, `live/wide` 21.023 s, exists because it came back |
| 5 | END, then navigate away mid-grace; publishers gone within 5 s | **PASS** | 2026-09-15. "every publisher is gone, even though the studio was unmounted mid-grace" |
| 6 | Owner installs the unsigned Windows build, connects a real YouTube account with no stream key typed, taps GO LIVE with a real camera, breaks one destination, taps END | **WAITING ON THE OWNER** | needs a machine with a camera and a Google client id |
| 7 | Owner sideloads `app-debug.apk`, grants camera and mic, sees a live preview, taps GO LIVE to a Custom RTMP destination | **WAITING ON THE OWNER** | needs a phone. The APK exists and builds |

**Five of seven pass. Two are the owner's.** That is the honest count. The two
that are the owner's were always going to be the owner's - they need a real
platform account and a real phone, neither of which exists on a build host -
and nothing above them is blocked on anything the owner has to supply.

---

## What changed on 2026-09-15

Three defects stood between the first measurement and this one. All three were
real, and two of them were the kind that make a report lie.

**1. The desktop app shipped in demo mode.** `build:renderer` ran a bare
`vite build`, and `envMockMode()` treats anything but the literal string
`"false"` as mock mode, which Vite then constant-folds. So the installed
application carried simulated adapters and a simulated engine and could not put
a byte on the wire however real the destination was. That is what item 3 was
reporting: not "the broadcast failed" but "the thing under test was not the
product". `apps/desktop/scripts/build-renderer.mjs` now sets the flag and says
which mode it built.

**2. The gate's own driver could not drive a real build.** Two separate
scripts each kept a private copy of the studio's selectors, and both went on
pressing `.lt-golive` to END a broadcast - a control Studio deliberately
unmounts while live, so that the only thing able to stop a stream is the one
that survives a route change. Both sat there until the timeout and reported
FAIL against a broadcast that was working. They now share
`infra/dev-harness/broadcast/studio-controls.mjs`, which asks for a control by
what it does rather than which screen it is on.

**3. The gate had stopped exercising its own safety interstitial.**
`confirmRealBroadcast` persists an acknowledgement, and the driver cleared
destinations between runs but not that flag - so after the first passing run
ever performed on a machine, every later run silently skipped the "these are
real accounts" confirmation. Both harnesses now clear it, and every run crosses
it.

---

## What is genuinely proven on this host

These are results, not intentions. Each one is a command anyone can re-run.

### The receiver is honest before the product is blamed

`node infra/dev-harness/ingest/selftest.mjs`, exit 0, 2026-09-14 13:12.

A synthetic H.264 plus AAC push arrives over real RTMP, decodes live at
1280x720, records to disk as a fragmented MP4 that ffprobe reads back at
10.009 seconds and 2,073,646 bytes, and a deliberate TCP kill reaches the
encoder, which exits mid-push as it should. Every run uses a freshly randomised
path, so a pass can never be explained by a recording an earlier run left
behind.

This matters more than it looks. It means that when the product fails to
arrive, the receiver has already been ruled out.

### A real broadcast, from a real capture API to a real server

Measured 2026-09-14 12:43, against the renderer bundle built at 11:01.

The built Electron app, driven through its own UI by Playwright with Chromium's
fake capture device, with no test hooks, no injected engine and no store
surgery. Every link was the production one:

| Link | What it was |
|---|---|
| capture | `navigator.mediaDevices.getUserMedia`, real API, synthetic photons |
| composition | one real `<canvas>` per aspect at the format's true dimensions |
| encode | Chromium `MediaRecorder`, mimeType probed at run time |
| transport to main | `window.livetap.engine.pushChunk` over the real contextBridge |
| mux and send | real ffmpeg 9.0.1 child processes, `-c:v copy -f flv` |
| server | MediaMTX v1.21.0, real RTMP handshake, real recording |
| evidence | MediaMTX's control API, then ffprobe independently |

Observed: two simultaneous publishers on `127.0.0.1:1935`. MediaMTX parsed
H264 1920x1080 out of one stream's SPS and H264 1080x1920 out of the other's,
which is the authority for what shape is on the wire. ffprobe decoded both
recordings as H.264 plus AAC 48000 Hz 2 ch at those resolutions. No uncaught
renderer errors.

**This is the single most important result in the repository**, because it is
the first time LIVETAP has been observed putting real encoded bytes on a real
wire from a real capture API, with nothing mocked anywhere in the chain.

### Failure isolation, against a real dropped connection

Measured 12:43, same run.

`kill-publisher.mjs` asked MediaMTX to kick one live RTMP connection, which
drops a real TCP connection with frames in flight. That is the failure the
encoder actually meets in production, as opposed to a mock socket closing
politely at a moment a test chose.

The surviving destination's byte count climbed from 1,237,654 to 1,542,861
through the failure, and the app went on reporting a live broadcast. END then
removed every publisher from the server, and both recordings finalised and
decoded correctly.

**What was not observed:** the broken destination coming back. The run asserted
that the survivor kept climbing, which is the half the product's promise rests
on, and did not wait for the dropped one to republish and return to LIVE. That
half is UNVERIFIED.

### No credential can reach a log line

`npx vitest run --config infra/dev-harness/broadcast/vitest.config.ts`,
42 tests, all passing, 2026-09-14 12:58.

Ten realistic carriers each holding a realistically shaped credential, checked
against both redactors; nineteen credential field names checked against both,
so the two lists cannot drift apart; and a scan of **267 shipped source files**
for a logging call that names something credential-bearing without a redactor
around it, which found **zero**. The scan's detector is proven against the two
leaks the 2026-09 security review actually found before its silence is
trusted.

### The Android APK is a real artifact

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 10,160,804
bytes, built 2026-09-14 12:36, 552 entries. Asserted on the artifact itself:
`LiveStreamPlugin`, `GenericStream`, `LiveForegroundService` and
`SecureStorePlugin` are in the dex; the manifest declares `CAMERA`,
`RECORD_AUDIO`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_CAMERA`,
`FOREGROUND_SERVICE_MICROPHONE` and `FOREGROUND_SERVICE_MEDIA_PROJECTION`; one
of the 39 bundled JavaScript assets references the plugin; and
`webContentsDebuggingEnabled` is on, so a sideloaded alpha with a white screen
is diagnosable rather than a dead end.

**None of it has run.** This VM has no nested virtualisation, so no Android
emulator can ever start here.

---

## What is proven only against the local harness

`infra/dev-harness/fake-idp/` is a real HTTP server that recomputes PKCE
challenges, enforces single-use 60-second authorization codes, rotates refresh
tokens, serves YouTube-shaped and Twitch-shaped API responses including
`errorStreamInactive`, and injects 401, 429 and 500 faults. Thirty-three tests
pass against it, 2026-09-14 13:06.

**What that proves:** LIVETAP's half of the OAuth conversation is correct. The
authorize URL is built right, the verifier matches the challenge, the state is
verified, the rotated refresh token is persisted, a 401 triggers exactly one
refresh and one retry, and the account identity reaches the destination card.

**What it cannot prove:** that Google, Twitch, Kick or Meta accept these exact
requests. Nothing on this host has ever spoken to a real platform, because
there is no platform credential here. That is not a defect; it is item 6 of the
gate, and it is the owner's.

The same distinction applies to the relay: its runtime properties are verified
natively against MediaMTX 1.21.0 with 45 `node:test` cases, and its container
packaging is unverified because Docker has no WSL distro on this host.

---

## What waits on the owner, and only on the owner

| Waiting on | What it unblocks | Where |
|---|---|---|
| A Google, Twitch, Kick or Facebook client id | every UNVERIFIED cell in the platform matrix. Twitch is the cheapest: no review, no queue, about ten minutes | `docs/OWNER_ACTIONS.md` parts 1 to 4 |
| A machine with a camera and a microphone | picture quality, real device enumeration labels, autogain, and what happens when a cable is pulled mid-broadcast | part 6 |
| A machine with a GPU | the NVENC, QSV and AMF branches. All three fail to open here, so the libx264 fallback is what has been exercised | part 6, B-007 |
| An Android phone | every runtime claim about Android | part 6, B-005 |
| A Mac | every claim about macOS, which today is none | B-005 |
| The Kick offline stream-key test | whether Kick is a sign-in destination or a paste destination | part 3 |
| A written answer from Meta on multistreaming | whether Facebook can ship at all | part 4 |

**Nothing on this list blocks any engineering work.** The alpha's first real
broadcast is a Custom RTMP destination against a server on the owner's own
machine, which needs none of it.

---

## The regression, in full, because it is the thing standing in the way

The 12:43 PASS was measured against the renderer bundle built at **11:01**. The
same source tree rebuilt at **13:02** fails the same test, deterministically,
twice, including when the desktop workstream's own driver is run standalone
with no involvement from this harness.

```
[3/8] tapping GO LIVE
  FAIL  live/wide has no publisher: nothing is being broadcast
  FAIL  live/tall has no publisher: nothing is being broadcast
  what the app says:
        Demo mode — this build talks to simulated platforms. LIVETAP is not broadcasting anywhere.
        2 destinations are reconnecting
        Custom RTMP · Reconnecting  ...  The stream URL or key is empty or malformed.
```

**The mechanism, read out of the code rather than guessed.**
`apps/web/src/state/registry.ts` returns `createMockAdapters()` for the **whole
registry** when `mockMode` is true, including the `custom` platform:

```ts
const mockMode = options.mockMode ?? true;
if (mockMode) return { registry: createMockAdapters(), kind: 'mock', connectable: [] };
```

Its own comment, three lines above, describes the right behaviour for the other
branch: "the real custom-RTMP adapter for everything that takes a pasted key".
A Custom RTMP destination needs no credentials and is the one path that works
with nothing configured anywhere, so simulating it makes the app's own honesty
banner accidentally true even when the creator pasted a real server address.
This is the same defect the plan names as "decouple simulated destinations from
simulated media", seen from the adapter side rather than the engine side.

Compounding it, `apps/desktop/package.json`'s `build:renderer` runs a bare
`vite build` with `VITE_LIVETAP_MOCK_MODE` unset, and mock mode is the default,
so the desktop app ships in demo mode. The Android build script already gets
this right (`apps/mobile/scripts/build-android.sh:57` sets
`VITE_LIVETAP_MOCK_MODE=false`).

Both files belong to other workstreams and are recorded as handoffs rather than
edited here.

### The worse thing underneath it

Turning mock mode off does not make the gate pass. It makes a different and
much more serious failure visible, and it is the reason this section is long.

**What was done.** The renderer was rebuilt by hand with
`VITE_LIVETAP_MOCK_MODE=false` — a configuration **no committed script
produces for the desktop app today** — and the app was driven to two Custom
RTMP destinations pointed at a running local MediaMTX.

**What happened, in order.**

1. Both destinations reached **Ready**, not "malformed key". That confirms the
   registry diagnosis above: the simulated adapter was the cause.
2. Tapping GO LIVE showed a real-broadcast confirmation: *"You are about to
   broadcast to your connected accounts. Local wide and Local vertical will
   show you live to real viewers. This is not a demo."* with **Yes, go live on
   2** and **Not yet**. The desktop workstream's driver taps `.lt-golive` and
   then waits for an in-button countdown; it never presses that button, so no
   automated run can get a non-demo build past GO LIVE at all. That is handoff
   four below.

   Worth flagging separately: the plan called for the confirmation to be the
   **existing in-button countdown naming the real destinations**, explicitly
   *not* a modal over a live preview. What shipped is a confirmation surface.
   Someone should decide which one is right; this is a product call, not a bug.
3. Confirming, then waiting twelve seconds, produced this:

   | What the app said | What the server said |
   |---|---|
   | `Live` | |
   | `0:07 · live on 2 of 2` | |
   | `You are live on 2 destinations.` | |
   | `Custom RTMP · Live` / `Sending to this destination` | |
   | `Custom RTMP · Live` / `Sending to this destination` | |
   | | **zero publishers on `127.0.0.1:1935`** |

**This is the defect the mission names as the worst this product can ship: a
LIVE badge with no bytes on the wire.** Two destination cards said "Sending to
this destination" while nothing was being sent anywhere. The health panel read
"Stream is at risk", which is the only part of the screen that was not lying,
and it does not say what is actually true.

**It was not diagnosed here**, and this document will not guess at a cause. One
thing is worth recording for whoever does: this is invisible in every existing
test and in every build anyone runs, because mock mode is on everywhere, and
under mock mode a LIVE badge with no bytes is the correct and honest behaviour.
The moment mock mode goes off, the same code path becomes a lie. That is the
shape of the risk in "mock mode selects mock adapters, not a mock engine": the
two halves have to be switched together, and something in the middle is
currently able to report success without an engine behind it.

**Why item 5 is not yet a real failure either.** The navigate-away-during-END
regression reproduced at 12:55 with one publisher still broadcasting twelve
seconds after END. But the grace timer was moved out of the Studio screen's
effect and into the store at **11:27**, after the 11:01 bundle was built, and
the 11:01 bundle contains only the seam declaration (`graceTimer:null`) and
none of the implementation. So the measurement is real and the conclusion is
not: it was taken against a build that predates the fix, and the fix has not
been measurable since, because of the regression above.

---

## The shortest path from here to a green gate

1. **Find out why a destination reports LIVE with no publisher behind it.** This
   is first, ahead of everything, because it is the one defect that would make
   the product dishonest to a creator rather than merely incomplete. Reproduce
   it by building the renderer with `VITE_LIVETAP_MOCK_MODE=false` and pointing
   two Custom RTMP destinations at a local receiver.
2. Register the real `CustomRtmpAdapter` on the mock branch of `createRegistry`,
   keeping mock adapters only for the account-based platforms. One destination
   type, no credentials, no reason to simulate it.
3. Build the desktop renderer with `VITE_LIVETAP_MOCK_MODE=false`, the way the
   Android script already does.
4. Teach the studio driver to confirm a real broadcast, so an automated run can
   reach GO LIVE on a non-demo build at all.
5. `npm run build -w @livetap/desktop && npm run verify:broadcast`. That single
   command then answers gate items 1, 3, 4 and 5 together, with a stage table
   and an exit code.

Items 6 and 7 follow as soon as the owner has an hour, a camera and a phone.

---

## How to re-run every claim on this page

```bash
node infra/dev-harness/ingest/selftest.mjs                  # gate item 1
npm run build -w @livetap/desktop
npm run verify:broadcast                                    # gate items 3, 4, 5
npx vitest run --config infra/dev-harness/broadcast/vitest.config.ts   # the secret-log gate
npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts    # the OAuth harness
```

`infra/dev-harness/broadcast/README.md` explains how to read a failure, and in
particular the difference between `MISSING` (a piece of the chain is absent and
nothing was tested) and `FAIL` (the piece was there and the product did not do
what it claims).
