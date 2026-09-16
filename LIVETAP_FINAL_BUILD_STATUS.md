# LIVETAP — Final Build Status

Scope: WEB + WINDOWS DESKTOP + ANDROID. One line per area. Evidence is named so
that "COMPLETE" can be checked rather than believed.

Two sessions built this. Lines marked **(2b)** are owned by session
`livetap-2b`, which is still working; everything else is this session's.

| Area | Status | Evidence / exact remaining item |
|---|---|---|
| **WEB** | COMPLETE — production path | Guest → destinations → WHIP → relay → fan-out is connected end to end. The relay session API is called at GO LIVE (`relaySession.ts`, `armRelay`), torn down at END and on a cancelled start. `verify:web` refuses a build that is secretly a demo. The grouped destination selector landed in `c1c714b` and `ded6384`; it is described under UX CONSISTENCY so it is counted once. |
| **WINDOWS** | COMPLETE | Builds from current source with mock mode OFF; reports connection health like every other surface; Bond wire protocol through `BondSink`. OAuth and multi-account complete **(2b)** — loopback and redirect tested separately, because they finish in different places and a fix to one is genuinely not a fix to the other. |
| **ANDROID** | COMPLETE | Multi-destination via the relay (`useRelaySession`), production config reaches the build, APK builds from current source and passes 49/49 `verify-apk` checks. |
| **MULTI-ACCOUNT** | COMPLETE | One vault entry per authorized account, keyed by connection id. Criteria A–J tested; every set confirmed load-bearing by reverting the fix. `1fd356e d0bb00b 52b3911 4b1a682 c1c714b 550fba5 ded6384` **(2b)**. This session proved the identity survives all the way to the relay's forward list. |
| **OAUTH** | COMPLETE — implementation. Against a real provider: EXTERNAL VALIDATION ONLY | Per-connection on desktop loopback and web redirect **(2b)**. The legacy single-connection key is still read, so nobody signed in today is signed out. No LIVETAP build has ever held a real OAuth client, and **Android could not have completed OAuth at all until `ffb12b0`** — the broker origin was never passed to the build, so a relative `/api/oauth/token` resolved to the in-APK asset server. The fix is compiled; the flow is still unexercised on a handset. |
| **RELAY FAN-OUT** | COMPLETE | One media session, N forward targets, one per selected destination id. Two accounts sharing an ingest URL with different keys are **not** deduplicated — asserted at `validateRequest` and at `buildHookCommand`, the layer where a collapse would be invisible. |
| **BOND** | COMPLETE | `BondMonitor` gives web, Windows and Android a real consumer; `@livetap/bond/browser` is a Node-free entry enforced by an import-graph test. Bond's judgment reaches the creator as health copy carrying a bitrate the network can actually hold. |
| **GUEST MODE** | COMPLETE | No LIVETAP account anywhere in the journey. Stream keys are never persisted to browser storage (`redactForStorage`). |
| **SESSION CLEANUP** | COMPLETE | `destroySession` reports what it actually observed, distinguishes "emptied" from "could not be read", sweeps LIVETAP keys nothing registered, and refuses while on air. |
| **UX CONSISTENCY** | COMPLETE | Destinations groups unconditionally; the Studio dock names the account always and groups only where a platform has several. Different on purpose — a library teaches where a second account goes, a narrow dock must not repeat a word the row already says (`ded6384` **(2b)**). All three surfaces share one mental model and one definition of connection health. Selection is per account by construction: there is no platform-level enable anywhere to collapse through, asserted end to end. |
| **PRODUCTION CONFIG** | COMPLETE | Web, staged mobile bundle and finished APK each have a gate proving demo mode is compiled out and that the relay and broker origins reached the build. Each verified in both directions. |
| **WINDOWS ARTIFACT** | COMPLETE | `LIVETAP-0.1.0-win-x64.exe`, 230,778,945 bytes, sha256 `7340dca6…`, built from current source on this host. 32/32 `verify-installer` checks, including that the installer is newer than the renderer it contains and that both witnesses agree demo mode was compiled out. Ships a verified ffmpeg 9.0.1 that actually runs and speaks rtmps. |
| **ANDROID ARTIFACT** | COMPLETE | `app-debug.apk`, 10,151,511 bytes, built from current source on this host with the portable JDK 21 + Android SDK. 49/49 checks. Debug-signed: sideloadable, not Play-ready (needs an upload key the repo must never contain). |

## What is external validation only

These are not unfinished implementation. They are things no server can show.

- A camera or microphone producing real frames.
- A real handset: permission dialogs, the live notification, thermal behaviour,
  backgrounding, and RTMP leaving the device.
- A real external broadcast arriving at YouTube, Twitch, TikTok or Kick.
- A relay reachable from the public internet accepting a real publish.
- Bond across two genuinely independent networks.
- Apple hardware, which is out of scope for this mission entirely.

## The one fact worth carrying out of this work

**The single-account assumption did not live in one place. It lived in every
seam.** It was fixed at the storage API, then found again at the adapter seam,
then again in session destroy, then again — after all of those — in the sign-in
exchange itself, which is the only path a real creator takes and the one place
mock mode can never exercise, because mock adapters never authorize.

Four layers, each individually correct, each handing a *platform* to the one
below it. Every one of those bugs was invisible from inside the layer that had
just been fixed, and two of the four were found only because the other session
asked a question about a boundary rather than about a file.

Nothing about this is finished by inspection. If a fifth seam exists, it will
look exactly like the four that did.

The tell is not an error. In every one of these the wrong answer was the
*comfortable* one: no camera reported "streaming silence", an unreadable store
reported `clean: true`, a missing `java` reported a machine that could not do the
job, and a platform-keyed token reported a working sign-in. None of them threw.
What to watch for is a cheerful answer from something that never looked — an
error gets investigated, while a confident wrong answer gets believed and built
on, which is what happened four times here. It is also why the gates caught what
they caught and missed what they missed: `tsc`, `eslint` and 1837 tests all check
that code does what it says, and every one of these bugs had code doing exactly
what it said.

## The two things worth knowing before the validation phase

**The build toolchain is here, and looked absent to both sessions.** `tools/`
holds a portable JDK 21, Android SDK and Node 22. It is gitignored, so a
worktree looks bare and nothing is on `PATH` — and both autonomous sessions
independently checked `java` / `JAVA_HOME`, found nothing, and told the user
this machine could not build Android. It can; it built both artifacts today.
That is the same error shape as the camera: an observable missing for a reason
unrelated to the question being asked. Now written down permanently in
`tools/README.md`, because the two of us reaching it separately means a third
session would too.

**Both artifacts correspond to current HEAD.** They were built after the last
code change in this branch, not carried over. The installer verifier checks that
specifically, because a packaging step that fails halfway leaves the previous
installer in place looking newly built.

**Android multi-destination is compiled, not exercised.** The device encodes
once and publishes once to the relay, which fans out. `setAuthorization` ships
in the dex and the relay URL is compiled into the bundle — both confirmed on the
finished APK. What no server can show is the relay accepting that publish.

**A relay is not optional for web, and is what lifts Android past one
destination.** A browser has no RTMP socket; a phone has one socket. Without
`VITE_LIVETAP_RELAY_URL` at build time, web reaches nothing that needs RTMP and
Android reaches exactly one destination — and because `VITE_` values are
compiled in, neither can be fixed after the build. Both gates now say so out
loud instead of failing quietly at GO LIVE.
