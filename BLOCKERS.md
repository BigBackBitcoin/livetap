# BLOCKERS — HUMAN DEPENDENCY QUEUE

A blocker is NOT permission to stop. Everything not depending on these continues.

**Status reviewed 2026-09-14** against what the proof chain actually returns.
Every entry below has been re-checked; two changed materially (B-005 is half
resolved, B-006's "already completed" was wrong and is corrected). The
consolidated, ordered version of everything the owner has to do is
**`docs/OWNER_ACTIONS.md`** — read that rather than assembling it from the
entries here.

Format per entry: Category | Exact requirement | Why autonomous resolution failed | Already completed | Exact human action | What resumes after

---

## B-001 | CI/CD | GitHub token lacks `workflow` scope — OPEN
- Exact requirement: push `.github/workflows/*.yml` to BigBackBitcoin/livetap.
- Why autonomous resolution failed: `gh auth refresh -s workflow` requires an interactive browser login; the session token (scopes: repo, gist, read:org) cannot grant itself scopes.
- Already completed: workflows written and validated locally under `.github/workflows-pending/` (ci.yml: typecheck/lint/test/build, audit + gitleaks, Playwright e2e, unsigned desktop packages on windows/macos runners; mobile.yml by the mobile team).
- **Status note, 2026-09-14:** this is a convenience, not a gate. Every check CI would run is runnable locally today, and two that CI cannot run at all — the real RTMP broadcast chain and the ffprobe evidence — are `npm run verify:broadcast`. What CI genuinely unblocks that nothing else does is the **free macOS runner**, which is the only route to a macOS build or an iOS archive without buying a Mac.
- Exact human action: `gh auth refresh -h github.com -s workflow`, then `git mv .github/workflows-pending/*.yml .github/workflows/ && git commit -m "ci: enable workflows" && git push`.
- What resumes: CI on every push; macOS runner builds for Electron notarization and Capacitor iOS archives (free for public repos).

## B-002 | Legal / open source | FFmpeg GPLv3 source offer before first desktop binary release — **DOWNGRADED 2026-09-15**, no longer blocks the alpha
- Exact requirement: publish a source mirror (or written offer) for the exact FFmpeg build bundled with the desktop app, plus GPL/LGPL license texts and the build configuration, as required by GPLv3 section 6.
- **Resolved, 2026-09-15**, now that an installer actually exists and therefore something could be conveyed. Full account in `docs/release/DESKTOP_RELEASE.md` §8. In short: the exact build is pinned mechanically (`ffmpeg 9.0.1-full_build-www.gyan.dev`, its whole `./configure` line and both binaries' SHA-256, written to `resources/ffmpeg/BUILD_INFO.txt` by `tools/acquire-ffmpeg.mjs` on every packaging run); the GPLv3 text ships **inside** the installer and `scripts/verify-installer.mjs` fails the build if it is missing; and `THIRD_PARTY_NOTICES.md` carries a written offer naming the upstream commit the build was compiled from.
- The LGPL question is answered rather than dodged: `argv.ts` uses `libx264`, which is GPL, and every hardware encoder probed UNAVAILABLE on this host, so an LGPL build would be a functional regression. The GPL build ships and the obligations are met.
- **Still the owner's, and neither blocks anything:** (1) whether to host our own source mirror rather than relying on the upstream commit staying reachable — GPLv3 §6(b)/(d) permits either, a mirror is the durable choice; (2) who answers a source request, and within what time. The offer currently names the public issue tracker, which is real but unstaffed by policy.
- What resumes: publishable desktop releases, once (1) and (2) are decided.

## B-003 | Legal / partner program | LinkedIn Live Events API terms conflict with open-source self-hosting — OPEN, and answered for the alpha
- Exact requirement: decide whether LIVETAP ships LinkedIn Live at all, and if so under which distribution model.
- Why autonomous resolution failed: this is a licensing and business-model decision, not an engineering one. The LinkedIn Live Events API Terms of Use state "you have no right to use any API or Data made available as part of this program unless approved by LinkedIn", forbid making LLE integrations available to other developers for resale to unaffiliated customers (a direct client relationship is required), forbid combining other LinkedIn APIs with the LLE APIs, and never contemplate open-source or self-hosted distribution. Access additionally requires Development Tier -> a certification demo video covering every Live Events test case -> Standard Tier, plus a background check via Microsoft's OneVet. No amount of engineering removes these gates.
- Already completed: full technical research in docs/research/PLATFORM_X_LINKEDIN_OTHERS.md section 2 — the complete 7-step scheduled-live flow with exact endpoints, official ingest specs (H.264/AAC, 6 Mbps, 1080p, 30 fps, 2 s keyframe, RTMP 1935/1936 and RTMPS 2935/2936), all OAuth scopes, the `contentAccess` eligibility pre-flight check, documented timeouts, and the PKCE limitation. Also documented: spontaneous live was removed on 2026-06-22, so every broadcast must now be a scheduled event. The classification and the reasoning are now also in `docs/platforms/PLATFORM_AUTH_MATRIX.md` as the single Level 4 platform.
- **Status note, 2026-09-14:** option (c) is taken for the alpha. LinkedIn ships as UNAVAILABLE with a plain-language card. Nothing waits on this decision being revisited.
- Exact human action: none required for the alpha. To revisit: pick (a) a LIVETAP-operated hosted service holding the approved app, or (b) a documented bring-your-own-approved-app path for self-hosters, and get counsel to read the LLE terms against the chosen model before any LinkedIn code merges.
- What resumes: the LinkedIn destination adapter. Nothing else is blocked.

## B-004 | Release / signing | Desktop code-signing identities (Windows + macOS) — OPEN, not needed for the alpha
- Exact requirement: Windows Authenticode (or Azure Trusted Signing) certificate; Apple Developer ID Application certificate + notarization credentials (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID).
- Why autonomous resolution failed: both require paid, identity-verified accounts owned by a legal entity/person. Since 2023-06-01 the CA/Browser Forum additionally requires every publicly trusted code-signing key, OV as well as EV, to be generated in non-exportable hardware.
- Already completed: electron-builder config, entitlements, NSIS installer, unsigned Windows package built and launched (docs/release/DESKTOP_RELEASE.md), electron-updater wiring.
- **Status note, 2026-09-14:** explicitly not needed. The owner installs an unsigned build on their own machine; SmartScreen will warn once and can be dismissed.
- Exact human action: obtain the certificates, set CSC_LINK/CSC_KEY_PASSWORD and the Apple variables as GitHub Actions secrets.
- What resumes: signed installers, notarized DMG, auto-update channel.

## B-005 | Stores / accounts and build hosts — **HALF RESOLVED**

### B-005a | Android toolchain — **RESOLVED 2026-09-14**
- Was: "host has no JDK or Android SDK".
- **Now:** a portable JDK 21 and Android SDK 36 install into `tools/` with one command, `bash tools/acquire-android-toolchain.sh`, and **the APK builds**: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 10,160,804 bytes, 2026-09-14 12:36. Nothing is installed system-wide and `tools/` is gitignored. Asserted on the artifact: `LiveStreamPlugin`, `GenericStream`, `LiveForegroundService` and `SecureStorePlugin` in the dex; `CAMERA`, `RECORD_AUDIO`, `POST_NOTIFICATIONS` and the three foreground-service types in the manifest; the plugin referenced from the bundled web assets; `webContentsDebuggingEnabled` on.
- No human action remains for the toolchain.

### B-005b | A physical Android device — OPEN, and it is the owner's
- Exact requirement: an Android 13+ phone with USB debugging enabled.
- Why autonomous resolution failed: no device, no emulator image under `tools/android-sdk`, and this VM reports `VMMonitorModeExtensions=False`, so no emulator can ever start here.
- Exact human action: enable USB debugging, `adb install app-debug.apk`, grant camera and microphone, report what happens.
- What resumes: every runtime claim about Android. **No Play Console account is needed for this.**

### B-005c | macOS build host and Apple Developer Program — OPEN
- Exact requirement: a Mac or a macOS CI runner, and an Apple Developer account for anything beyond a local build.
- Already completed: a real Xcode project, the plugin package discovered by `cap sync`, a privacy manifest, permissions, readiness audits.
- **Status note:** every macOS and iOS claim in this repository is unverified. Enabling B-001 gets a free macOS runner, which is the cheapest route.
- What resumes: a macOS desktop build, and TestFlight builds once an account exists.

### B-005d | Google Play Console — OPEN, not needed for the alpha
- New personal accounts need 12 testers for 14 days of closed testing before production. Sideloading needs none of it.

## B-006 | Platform credentials | OAuth client IDs and app review — OPEN, and this entry was wrong
- Exact requirement: Google Cloud OAuth client with YouTube Data API v3 enabled; Twitch developer application; Kick developer app; Facebook Business app with Live Video API review + Business Verification.
- Why autonomous resolution failed: developer consoles require the owner's accounts, 2FA, phone verification and review submissions. Nothing on this host can mint a client id.
- **Correction, 2026-09-14.** This entry previously listed "desktop loopback + device-code flows" under Already completed. **Only the loopback half existed**; `grep -rn device_code` hit two comments and no implementation. That is now fixed: `POST /api/oauth/device` exists, and so do `/api/oauth/revoke`, `apps/web/src/state/oauthFlow.ts` and `apps/web/src/state/tokens.ts`.
- Already completed, and re-checked: real YouTube/Twitch/Kick/Facebook adapters; a token broker with an allow-listed redirect policy and no ambient authority; PKCE helpers; the desktop loopback listener; the device code endpoint; per-surface token storage; revoke. All of it is exercised end to end against `infra/dev-harness/fake-idp/`, a real local identity provider that recomputes PKCE challenges, enforces single-use 60-second codes and injects 401/429/500 faults: **33 tests passing, 2026-09-14 13:06**.
- What that does and does not establish: LIVETAP's half of the OAuth conversation is correct. Nothing on this host has ever spoken to a real platform.
- Exact human action: **`docs/OWNER_ACTIONS.md`**, parts 1 to 4, in that order. Twitch first: no review, no queue, about ten minutes, and it is the fastest path from UNVERIFIED to PASS on the platform matrix.
- What resumes: real go-live on YouTube/Twitch/Kick/Facebook *without the creator ever seeing a key*. TikTok, Instagram and X stay stream-key based **by platform design**, not for want of credentials.
- **Correction, 2026-09-15: this stopped blocking the first real broadcast.** The entry assumed that with no client id a platform is unreachable, and that was true of the code, not of the platforms. Every priority platform publishes an RTMP ingest URL and a stream key in its own studio page, which the creator can copy in about thirty seconds with nothing registered anywhere. LIVETAP now offers that path for every platform whose API path is not configured (`packages/adapters/src/paste/pasteIngest.ts`, `apps/web/src/state/registry.ts`): the destination is a real destination of that real platform, wearing that platform's own profile, and it puts real bytes on a real wire. What is still waiting on this blocker is the *nicer* half — LIVETAP fetching the key itself so the creator never sees one, and setting the title, and reading health from the platform's own API. See `docs/platforms/PLATFORM_AUTH_MATRIX.md`.

## B-007 | Hardware verification | GPU host and a physical camera/microphone — OPEN, partially routed around
- Exact requirement: a Windows machine with an NVIDIA/Intel/AMD GPU and a webcam + mic; a Mac for VideoToolbox.
- Why autonomous resolution failed: build host is a headless VM with no GPU and no capture devices.
- **Status note, 2026-09-14:** the camera half is now largely routed around. Chromium's `--use-fake-device-for-media-stream` drives the genuine `getUserMedia`, permission, track-lifecycle and constraint-negotiation code, and a full two-destination broadcast was measured through it. What a synthetic source cannot prove is picture quality, real device enumeration labels, autogain, the noise floor, and what happens when a cable is pulled mid-broadcast. The GPU half is not routed around at all: all three hardware encoder branches fail to open here and the libx264 fallback is what every measurement used.
- Exact human action: run `npm run verify:broadcast` on a machine with a GPU and a camera; record results in docs/qa.
- What resumes: PASS labels for hardware encoding and real capture.

## B-008 | Infrastructure | Container packaging of the relay unverified on this host — OPEN, partially routed around
- Exact requirement: run `docker compose up` for infra/relay once on a Linux host or CI runner.
- Why autonomous resolution failed: the VM exposes no nested virtualisation (VMMonitorModeExtensions=False), so Docker Desktop's WSL2 engine can never start; native-binary verification was substituted.
- Already completed: mediamtx.yml, compose file, session API with 33 tests and E2E, native verification of every runtime property against MediaMTX 1.21.0.
- **Status note, 2026-09-14:** the *browser* half is now routed around. `infra/dev-harness/ingest/mediamtx.dev.yml` carries an opt-in WHIP profile (`LIVETAP_DEV_INGEST_WHIP=1`, verified accepting on `127.0.0.1:8889`), still loopback only with the WebRTC media port pinned and the ICE server list empty, so the browser-to-server leg can be proven here without the relay VPS or Docker. What stays blocked is *container packaging* specifically.
- **Also worth stating:** the relay is only needed for the browser surface. The desktop app and the Android app talk to platforms directly, so neither the owner's Windows alpha nor the Android sideload depends on this at all.
- Exact human action: enable B-001 (CI) or run compose on any Linux box.
- What resumes: PASS label for container packaging.

## B-009 | Growth / infrastructure | Early-access notification endpoint — RETIRED 2026-09-17
- **Not resolved. Removed, because the product it existed for no longer needs it.**
- It was built to answer the audit finding "no way to capture interest", at a time when a visitor
  could not use LIVETAP: there was nothing to download and nothing to try. A waitlist was the only
  honest thing to offer.
- Both halves of that premise have gone. The web app runs in the browser now and the Windows
  installer builds from source, so the page's answer to "can I have this" is "yes, now" rather
  than "leave your address". And the landing that carried the form was replaced: it makes no
  future promise for a waitlist to attach to.
- It also sat against the product's own thesis. LIVETAP asks for no account and forgets the
  session; an email field would have been the single place on the page that asked a visitor for an
  identity, to get something they already have.
- Removed: `apps/web/api/early-access.ts`, `apps/web/src/__tests__/early-access.test.ts`, and the
  two `docs/OWNER_ACTIONS.md` rows. The form itself (`src/public/capture.ts`) went earlier with
  the landing rewrite. The shared `_lib/broker.ts` stays -- the five OAuth routes use it, and its
  same-origin and rate-limit behaviour is covered directly by `broker.test.ts`, not through this
  endpoint.
- Anyone wanting to hear about releases has the GitHub link in the footer, which is what
  `capture.ts` itself named as the fallback.
- **Net effect on the owner: one fewer third-party service to choose and pay for before shipping.**

---

## What is NOT blocked, and never was

Written down because "blocked" was doing too much work in earlier versions of
this file.

| Thing | Why it is not blocked |
|---|---|
| A real broadcast, proven end to end | goes to a Custom RTMP destination on a local server. No account, no certificate, no review. Measured working 2026-09-14 |
| Failure isolation | proven against a real dropped TCP connection with frames in flight |
| The whole OAuth flow, built and tested | against a local identity provider that genuinely verifies PKCE |
| The Android APK | builds on this host today |
| Credential redaction | a test that scans 267 shipped source files and fails on a leak |
| The owner's own first broadcast on YouTube | Testing status plus a test user works immediately. Verification is for **other people** to use it |
| The owner's own Facebook broadcast | a role on the app works immediately. App Review is for **other people** |
