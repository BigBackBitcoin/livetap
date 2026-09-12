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

(other environment-derived candidates to be finalized: Apple Developer account + macOS/Xcode host, Google Play console + Android SDK host, platform OAuth client credentials, code-signing certificates, GPU host for hardware-encoder verification, physical camera/mic for capture verification)
