# BLOCKERS — HUMAN DEPENDENCY QUEUE

A blocker is NOT permission to stop. Everything not depending on these continues.

Format per entry: Category | Exact requirement | Why autonomous resolution failed | Already completed | Exact human action | What resumes after

## B-001 | CI/CD | GitHub token lacks `workflow` scope
- Exact requirement: push `.github/workflows/*.yml` to BigBackBitcoin/livetap.
- Why autonomous resolution failed: `gh auth refresh -s workflow` requires an interactive browser login; the session token (scopes: repo, gist, read:org) cannot grant itself scopes.
- Already completed: workflows written and validated locally under `.github/workflows-pending/` (ci.yml: typecheck/lint/test/build, audit + gitleaks, Playwright e2e, unsigned desktop packages on windows/macos runners; mobile.yml by the mobile team).
- Exact human action: run `gh auth refresh -h github.com -s workflow`, then `git mv .github/workflows-pending/*.yml .github/workflows/ && git commit -m "ci: enable workflows" && git push`.
- What resumes: CI on every push; macOS runner builds for Electron notarization and Capacitor iOS archives (free for public repos).

## B-002 | Legal / open source | FFmpeg GPLv3 source offer before first desktop binary release
- Exact requirement: publish a source mirror (or written offer) for the exact FFmpeg build bundled with the desktop app, plus GPL/LGPL license texts and the build configuration, as required by GPLv3 section 6.
- Why autonomous resolution failed: choosing where the organisation hosts the mirror and who answers source requests is an owner decision; the legal contact in SECURITY.md must be a real mailbox.
- Already completed: THIRD_PARTY_NOTICES.md drafted with the required text; ADR-013 documents mere-aggregation reasoning and the LGPL build alternative.
- Exact human action: decide mirror location (e.g. a `livetap-ffmpeg-builds` GitHub repo with tagged source + config), set the contact address, and confirm MIT vs Apache-2.0 for LIVETAP itself (HANDOFF item).
- What resumes: signed desktop releases can be published.

## B-003 | Legal / partner program | LinkedIn Live Events API terms conflict with open-source self-hosting
- Exact requirement: decide whether LIVETAP ships LinkedIn Live at all, and if so under which distribution model.
- Why autonomous resolution failed: this is a licensing and business-model decision, not an engineering one. The LinkedIn Live Events API Terms of Use state "you have no right to use any API or Data made available as part of this program unless approved by LinkedIn", forbid making LLE integrations available to other developers for resale to unaffiliated customers (a direct client relationship is required), forbid combining other LinkedIn APIs with the LLE APIs, and never contemplate open-source or self-hosted distribution. Access additionally requires Development Tier -> a certification demo video covering every Live Events test case -> Standard Tier, plus a background check via Microsoft's OneVet. No amount of engineering removes these gates.
- Already completed: full technical research in docs/research/PLATFORM_X_LINKEDIN_OTHERS.md section 2 — the complete 7-step scheduled-live flow with exact endpoints, official ingest specs (H.264/AAC, 6 Mbps, 1080p, 30 fps, 2 s keyframe, RTMP 1935/1936 and RTMPS 2935/2936), all OAuth scopes, the `contentAccess` eligibility pre-flight check, documented timeouts, and the PKCE limitation (LinkedIn enables the native-PKCE flow per application on request, so a public desktop client cannot use it unaided and auth must be brokered by a LIVETAP-operated backend — which is precisely what the terms restrict). Also documented: spontaneous live was removed on 2026-06-22, so every broadcast must now be a scheduled event.
- Exact human action: pick one — (a) run LinkedIn auth through a LIVETAP-operated hosted service holding the approved app and secret, and apply to the Live Events API Program; (b) document a bring-your-own-approved-LinkedIn-app path for self-hosters as advanced and unsupported; or (c) ship LinkedIn as UNAVAILABLE at launch. Get counsel to read the LLE terms against the chosen model before any LinkedIn code merges.
- What resumes: the LinkedIn destination adapter. Nothing else is blocked — X, custom RTMP/RTMPS/SRT/WHIP, and every other destination are independent of this decision.

## B-004 | Release / signing | Desktop code-signing identities (Windows + macOS)
- Exact requirement: Windows Authenticode (or Azure Trusted Signing) certificate; Apple Developer ID Application certificate + notarization credentials (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID).
- Why autonomous resolution failed: both require paid, identity-verified accounts owned by a legal entity/person.
- Already completed: electron-builder config, entitlements, NSIS installer, unsigned Windows package built and launched (docs/release/DESKTOP_RELEASE.md), electron-updater wiring.
- Exact human action: obtain the certificates, set CSC_LINK/CSC_KEY_PASSWORD and the Apple variables as GitHub Actions secrets.
- What resumes: signed installers, notarized DMG, auto-update channel.

## B-005 | Stores / accounts | Apple Developer Program + macOS build host; Google Play Console + Android SDK/JDK
- Exact requirement: Apple Developer account (App Store Connect, bundle id app.livetap.mobile, certificates/profiles) and a macOS machine or CI runner; Google Play developer account (12 testers / 14 days closed test for new personal accounts), JDK 21 + Android SDK 36 for local builds.
- Why autonomous resolution failed: accounts are owner-only and paid; host has no macOS, JDK or Android SDK.
- Already completed: real Xcode + Android projects, plugin package discovered by `cap sync`, privacy manifest, permissions, readiness audits (docs/release/*_READINESS.md), CI workflows for macOS/Ubuntu runners (parked, B-001).
- Exact human action: create both accounts, enable B-001 so CI compiles on GitHub runners (free for public repos), then run the first builds and fix compile findings.
- What resumes: TestFlight/internal-testing builds, store metadata submission.

## B-006 | Platform credentials | OAuth client IDs/secrets and app review for YouTube, Twitch, Kick, Facebook
- Exact requirement: Google Cloud OAuth client (web + desktop types) with YouTube Data API enabled and OAuth verification for sensitive scopes; Twitch developer application; Kick developer app; Facebook app with Live Video API review + Business Verification.
- Why autonomous resolution failed: developer consoles require the owner's accounts, phone verification, and review submissions.
- Already completed: real adapters tested against recorded fakes, token broker with env-var placeholders (apps/web/.env.example), PKCE helpers, desktop loopback + device-code flows.
- Exact human action: create the apps, set redirect URIs (https://<vercel-domain>/oauth/callback, http://127.0.0.1:<port>/callback, livetap://oauth/callback), paste credentials into Vercel env vars, set LIVETAP_MOCK_MODE=false.
- What resumes: real go-live on YouTube/Twitch/Kick/Facebook; TikTok/Instagram/X remain stream-key based by platform design.

## B-007 | Hardware verification | GPU host and a physical camera/microphone
- Exact requirement: a Windows machine with an NVIDIA/Intel/AMD GPU and a webcam + mic; a Mac for VideoToolbox.
- Why autonomous resolution failed: build host is a headless VM with no GPU or capture devices.
- Already completed: hardware-encoder probe that asserts real packets; capture code paths with injectable fakes; MockEngine test pattern for UX.
- Exact human action: run `npm run verify:engine -w @livetap/desktop` and the web app on such a machine; record results in docs/qa.
- What resumes: PASS labels for hardware encoding and real capture.

(other environment-derived candidates to be finalized: Apple Developer account + macOS/Xcode host, Google Play console + Android SDK host, platform OAuth client credentials, code-signing certificates, GPU host for hardware-encoder verification, physical camera/mic for capture verification)
