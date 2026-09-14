# IMPLEMENTATION STATUS

Rewritten 2026-09-14 against **what the proof chain returns**, not against
intent. Every PASS on this page names the command that produced it and the time
it was run. Where nothing was run, the label is UNVERIFIED and says so.

Legend: PASS | PARTIAL | SIMULATED | UNAVAILABLE | EXTERNALLY BLOCKED | UNVERIFIED | NOT STARTED

**The three documents that hold the detail:**
`docs/qa/REAL_WORLD_ALPHA_READINESS.md` (the owner's gate, item by item),
`docs/qa/REAL_PLATFORM_TEST_MATRIX.md` (per destination),
`docs/qa/REAL_DEVICE_TEST_MATRIX.md` (per surface).

---

## The headline

**A real broadcast happened on this host on 2026-09-14 at 12:43.** The built
Electron app, driven through its own UI, captured through the real
`getUserMedia`, composed one canvas per aspect, encoded with Chromium's
`MediaRecorder`, pushed chunks over the real contextBridge, muxed with real
ffmpeg, and published **two simultaneous RTMP streams** that MediaMTX accepted
at 1920x1080 and 1080x1920 and ffprobe independently decoded as H.264 plus AAC
48 kHz stereo. One was then dropped at the TCP level with frames in flight and
the other's byte count kept climbing, 1,237,654 to 1,542,861. END cleared both.

That is the first time this product has been observed putting real bytes on a
real wire with nothing mocked anywhere in the chain.

**And it does not reproduce on a rebuild.** The same source tree rebuilt at
13:02 fails: `createRegistry` returns mock adapters for the whole registry when
`mockMode` is true, including `custom`, and the desktop renderer builds with
mock mode on by default. Both are named precisely in the readiness document.

**Behind that is something worse.** Built by hand with mock mode off, both
destinations reach Ready and the app then reports `Live`, `live on 2 of 2` and
"Sending to this destination" on both cards, while the server reports **zero
publishers**. That is a LIVE badge with no bytes on the wire, which is the one
defect this product exists not to have. Reproduced twice, not diagnosed, and
invisible in every build anyone currently runs because mock mode is on
everywhere. HANDOFF.md item zero.

---

## Per area

| Area | Status | Evidence |
|---|---|---|
| Tests, whole repo | **PASS** | `npx vitest run`: **71 files, 1293 tests, all passing, 2026-09-14 13:16**. Now includes the fake-IdP harness and the proof harness, both of which existed and were excluded from `npm test`, which is the same as not having them |
| Typecheck | **PASS** | `npx tsc -b tsconfig.json`, exit 0, 13:20 |
| Lint | **PASS** | `npx eslint`, exit 0 on the harness and configs |
| Dev ingest receiver | **PASS** | `node infra/dev-harness/ingest/selftest.mjs`, exit 0, 13:12. Real RTMP in, live decode, recording to disk at 10.009 s / 2,073,646 bytes, and a real publisher kill the encoder saw |
| Desktop broadcast, end to end | **PASS at 12:43, regressed on rebuild** | `npm run verify:broadcast`. See the headline |
| Failure isolation | **PASS** | same run, against a real dropped TCP connection rather than a mock socket |
| Reconnect and return to LIVE | **UNVERIFIED** | the run asserts the survivor keeps climbing and does not wait for the dropped destination to republish |
| END survives leaving the studio | **PARTIAL** | the store-level unit test passes ("a scheduled END stops the broadcast with no screen mounted to run the timer"). The end-to-end version failed at 12:55 against a bundle built before that fix landed, and has not been re-measurable since |
| Credential redaction | **PASS** | 42 tests, 12:58. Ten realistic credential carriers against both redactors, nineteen field names against both, and a scan of **267 shipped source files** for an unredacted logging call: zero hits. The detector is proven against the two leaks the 2026-09 security review found |
| packages/core | **PASS** | state machine, orchestrator isolation and reconnect, humane errors, health, formats, intents |
| packages/adapters, mock | **PASS** | seeded chat and analytics, scripted failures |
| packages/adapters, real | **SIMULATED** | YouTube, Twitch, Kick and Facebook adapters verified against recorded fakes and against the local identity provider. **No live credential exists on this host** |
| packages/media | **PARTIAL** | `DesktopEngine`, `FormatRenderer` and `LocalSources` exist and were exercised in a real broadcast. `BrowserEngine`'s WHIP path is unit-tested only |
| packages/ui | **PASS** | computed WCAG token tests |
| OAuth, whole flow | **SIMULATED** | 33 tests against `infra/dev-harness/fake-idp/`, a real server that recomputes PKCE challenges, enforces single-use 60-second codes, rotates refresh tokens and injects 401/429/500 faults. Proves LIVETAP's half of the conversation. Proves nothing about Google, Twitch, Kick or Meta |
| Token storage | **PASS (desktop, web)** / **UNVERIFIED (mobile)** | `safeStorage` on the OS credential store, atomic, 0600, refuses when encryption is unavailable; memory-only on web. The mobile `SecureStorePlugin` is in the APK's dex and has never executed |
| apps/web studio | **PASS (mock mode)** | real-platform go-live UNVERIFIED: no credentials |
| apps/web public page | **PASS** | https://livetap.vercel.app |
| apps/desktop | **PASS (Windows, unsigned)** / **UNVERIFIED (macOS)** | signing BLOCKED (B-004); hardware encoders UNVERIFIED (B-007), all three branches fail to open on this GPU-less host so libx264 is what every measurement used |
| apps/mobile | **BUILDS, NEVER RUN** | `app-debug.apk`, 10,160,804 bytes, 2026-09-14 12:36. Plugin classes in the dex, permissions and foreground-service types in the manifest, plugin referenced from the bundled JS, `webContentsDebuggingEnabled` on. No line of it has executed: this VM has no nested virtualisation |
| Android toolchain | **PASS** | `bash tools/acquire-android-toolchain.sh` installs a portable JDK 21 and Android SDK 36 into gitignored `tools/`. **B-005's toolchain half is resolved** |
| Relay | **PASS (native)** / **UNVERIFIED (Docker)** | 45 `node:test` against MediaMTX 1.21.0. Container packaging blocked (B-008). The browser leg is now provable here through the receiver's opt-in loopback WHIP profile |
| Security review | **PASS (post-fix)** | `docs/qa/SECURITY_REVIEW.md`: four release-blocking findings fixed with regression tests. Credential-specific model now in `docs/security/REAL_CREDENTIAL_SECURITY.md` |
| Vercel deploy | **PASS** | https://livetap.vercel.app |
| GitHub repo | **PASS** | workflows parked pending token scope (B-001) |

---

## What "SIMULATED" means on this page, precisely

It means real code ran against something that is not the real far end. It does
**not** mean a stub returning canned values.

`infra/dev-harness/fake-idp/` is 1,710 lines of real HTTP server. It recomputes
the PKCE challenge from the verifier and rejects a mismatch, enforces
single-use authorization codes with a 60-second lifetime, rotates refresh
tokens, serves YouTube-shaped and Twitch-shaped API responses including
`errorStreamInactive`, and injects 401, 429, 500 and slow responses on demand.
Passing against it is real evidence about LIVETAP. It is no evidence at all
about Google.

The same discipline applies to the word PASS: a PASS on this page means a
command was run on this host and produced that result. It never means "the code
looks right".

---

## The one command that answers most of this

```bash
npm run verify:broadcast
```

Preflight (every piece named, with the command that supplies it), the receiver
self-test, a real RTMP server, the full desktop broadcast with ffprobe
evidence, a deliberate mid-broadcast TCP kill, and the navigate-away-during-END
regression. One stage table, one exit code.
`infra/dev-harness/broadcast/README.md` explains how to read a failure.
