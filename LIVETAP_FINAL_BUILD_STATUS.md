# LIVETAP — Final Build Status

Scope: WEB + WINDOWS DESKTOP + ANDROID. One line per area. Evidence is named so
that "COMPLETE" can be checked rather than believed.

Two sessions built this. Lines marked **(2b)** are owned by session
`livetap-2b`, which is still working; everything else is this session's.

| Area | Status | Evidence / exact remaining item |
|---|---|---|
| **WEB** | COMPLETE — production path | Guest → destinations → WHIP → relay → fan-out is connected end to end. The relay session API is called at GO LIVE (`relaySession.ts`, `armRelay`), torn down at END and on a cancelled start. `verify:web` refuses a build that is secretly a demo. The one outstanding web item is the grouped GO LIVE selector, listed under UX CONSISTENCY so it is counted once. |
| **WINDOWS** | COMPLETE | Builds from current source with mock mode OFF; reports connection health like every other surface; Bond wire protocol through `BondSink`; loopback OAuth is per connection **(2b)**, tested separately from the web redirect because the two finish in different places and a fix to one is not a fix to the other. |
| **ANDROID** | COMPLETE | Multi-destination via the relay (`useRelaySession`), production config reaches the build, APK builds from current source and passes 49/49 `verify-apk` checks. |
| **MULTI-ACCOUNT** | COMPLETE | One vault entry per authorized account keyed by connection id, never by platform. Legacy `oauth:${platform}` is read as a fallback and never copied forward, so nobody signed in today is signed out. One shared adapter per platform tells its accounts apart via `CredentialRef.connectionId`. **(2b)** for the model and UI; this session proved it survives to the relay. |
| **OAUTH** | COMPLETE — implementation. Real platform credentials: EXTERNAL VALIDATION ONLY | Authorization, refresh, revoke, disconnect and duplicate detection all keyed per connection, on both the loopback and redirect paths **(2b)**. Duplicate detection runs *after* validate, because nothing knows which account a token belongs to until the platform says. Android's `livetap://` callback is registered and verified in the APK. No LIVETAP build has ever held a real OAuth client, so two real YouTube channels have never been exercised against Google. |
| **RELAY FAN-OUT** | COMPLETE | One media session, N forward targets, one per selected destination id. Two accounts sharing an ingest URL with different keys are **not** deduplicated — asserted at `validateRequest` and at `buildHookCommand`, the layer where a collapse would be invisible. |
| **BOND** | COMPLETE | `BondMonitor` gives web, Windows and Android a real consumer; `@livetap/bond/browser` is a Node-free entry enforced by an import-graph test. Bond's judgment reaches the creator as health copy carrying a bitrate the network can actually hold. |
| **GUEST MODE** | COMPLETE | No LIVETAP account anywhere in the journey. Stream keys are never persisted to browser storage (`redactForStorage`). |
| **SESSION CLEANUP** | COMPLETE | `destroySession` reports what it actually observed, distinguishes "emptied" from "could not be read", sweeps LIVETAP keys nothing registered, and refuses while on air. |
| **UX CONSISTENCY** | COMPLETE | Destinations read as accounts under platforms — one section per platform, one card per account, "Add another YouTube account" at the foot of each group **(2b)**. All three surfaces share one mental model and one definition of connection health. Selection is per account by construction: there is no platform-level enable anywhere, asserted end to end. |
| **PRODUCTION CONFIG** | COMPLETE | Web, staged mobile bundle and finished APK each have a gate proving demo mode is compiled out and that the relay and broker origins reached the build. Each verified in both directions. |
| **WINDOWS ARTIFACT** | _pending this run_ | — |
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

## The two things worth knowing before the validation phase

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
