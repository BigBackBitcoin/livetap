# LIVETAP — Final Build Status

Scope: WEB + WINDOWS DESKTOP + ANDROID. One line per area. Evidence is named so
that "COMPLETE" can be checked rather than believed.

Two sessions built this. Lines marked **(2b)** are owned by session
`livetap-2b`, which is still working; everything else is this session's.

| Area | Status | Evidence / exact remaining item |
|---|---|---|
| **WEB** | COMPLETE | Guest → destinations → WHIP → relay → fan-out is connected end to end. The relay session API is called at GO LIVE (`relaySession.ts`, `armRelay`), torn down at END and on a cancelled start. `verify:web` refuses a build that is secretly a demo. The grouped destination selector landed in `c1c714b` and `ded6384`; it is described under UX CONSISTENCY so it is counted once. |
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
| **WINDOWS ARTIFACT** | COMPLETE | `LIVETAP-0.1.0-win-x64.exe` — **230,740,192 bytes, sha256 `d050ebbc3bbfeb3c2664a4a03d84d74262a1e6156024f878b56c2a24954174b1`**, built from `252dd32` in the `LIVETAP-build` worktree, clean tree. **33/33** `verify-installer` checks, now including the identity gate, which records the commit in the artifact rather than inferring freshness from timestamps. Ships a verified ffmpeg 9.0.1 that actually runs and speaks rtmps. |
| **ANDROID ARTIFACT** | COMPLETE | `app-debug.apk` — **10,165,196 bytes, sha256 `22434841fdd08b5f83a32298a33fbea3524183cc63f333c28086c71ce5069dc0`**, built from `252dd32` in the `LIVETAP-build` worktree with the portable JDK 21 + Android SDK. 49/49 checks, including that the relay and broker origins reached the bundle. Rebuilt after the landing rewrite, and the bytes moved: the staged web bundle is part of the APK, so changing the page changed the artifact. That is the gate working rather than noise. Debug-signed: sideloadable, not Play-ready (needs an upload key the repo must never contain). |

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

Three shapes account for every defect found on the last day of this work, and
they are worth separating because they need different fixes:

- **A cheerful answer from something that never looked.** No camera reported
  "streaming silence". An unreadable store reported `clean: true`. A missing
  `java` reported a machine that could not do the job. None of them threw.
- **A correct answer from something that was never told.** The four seams, each
  layer right about its own half; and an END take-back that armed correctly from
  the instant it knew about, never having been told a press was already
  swallowed.
- **A correct answer to a question that was asked twice.** One label meaning
  both "ask me" and "do it", so a repeated press walked through an irreversible
  confirmation — and the screen's own test performed that double press and
  asserted it succeeded.

The third is the sharpest, because nothing is missing and no information flow
fixes it. The product did exactly what was written, and what was written was
ambiguous.

None of this was caught by the gates, and the reason is the same for all three
shapes: `tsc`, `eslint` and 1838 tests all check that code does what it says, and
every one of these bugs had code doing exactly what it said. An error gets
investigated; a confident wrong answer gets believed and built on. That is why
four of them were found by one session asking another about a boundary, and one
by a single failure in a suite that had already passed the same assertion 335
times.

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

**The landing is a film, not an explanation.** It carries 173 visible words and
22 KB of html and css, down from 1,249 words and ~107 KB. The old page was a
ten-act scroll film with an operable replica of the product embedded in it; its
length was pinned by a test asserting ten acts, which is why it never shrank.
The campaign films now lead the page instead of sitting unused in the repository.

**The artifacts were rebuilt because that change reached them.** The desktop app
packages the landing document alongside the application, and the APK stages the
same web build, so rewriting the page moved both artifacts' bytes. The release
gate caught it: once the renderer was rebuilt, `verify-installer` failed with
"the installer is newer than the renderer it claims to carry" rather than anyone
having to remember.

**These artifacts do not go stale every time a commit lands.** The installer
records the commit it was built from and answers "which commit is this?", not
"is this current?" — the second has no stable answer, because HEAD moves for
reasons that have nothing to do with the artifact, including the doc commit that
records its own hashes. It verifies 33/33 today while HEAD has moved past it. A
rebuild is needed when something the artifact *contains* changes, and the gate is
what tells you that rather than anyone having to remember.

**Both artifacts were rebuilt from the pushed commit `3fd43a3`, and the first
pair were thrown away.** The first build of each was made before two commits
landed that change `apps/web/src` — an END take-back fix and an end-session
confirmation fix — and that source compiles into the desktop renderer and is
staged into the APK. The APK's hash moved by 26,590 bytes between the two
builds, so the earlier figures described a file that no longer existed anywhere.

Nothing in the pipeline would have contradicted them. `verify-installer` has two
freshness checks and both compare the artifact to the renderer **on disk**, which
catches a packaging step dying halfway and leaves the previous installer in place
looking newly built — but cannot see the renderer itself being stale. The
artifacts were internally consistent all the way down and described a tree that
had moved.

**Hash the artifact in the worktree named below, not the path alone.** There are
two `app-debug.apk` files on this machine at the same relative path in different
checkouts, with different hashes. A reader who hashes the wrong one would
conclude this document is lying, and would be reasonable to.

**A demo build must never be written to `app-debug.apk`.** Mock mode is
first-class and a demo APK is a legitimate thing to build, but it has to carry a
different filename — `app-demo-mock.apk` — because the in-app banner that makes
a demo honest is a property of the running app, not of the file. A file cannot
say what it is until it is opened, and a demo sitting at the path this document
names would both invalidate the hash above and leave the banner as the only
thing between an owner and believing they hold the real build.

**The end-session fix is not covered by the E2E run, and that is stated rather
than glossed.** The 334-test Playwright run validates the END take-back fix; the
end-session confirmation fix landed after that run started. It is a Settings
screen with no E2E coverage at all, and it carries 7 unit tests including a
regression verified by restoring the old label. Bounded and named — not
described as covered by a suite that never saw it.

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
