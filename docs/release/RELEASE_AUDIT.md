# LIVETAP MVP — Release Audit (2026-09-12)

Labels: PASS = executed on the build host with evidence in this repo · SIMULATED = verified against
mocks/fakes · UNVERIFIED = could not be exercised here · EXTERNALLY BLOCKED = needs a human-only
dependency (BLOCKERS.md). No claim below is asserted from reasoning alone.

## 1. Release condition checklist (prompt pack §34 / §15)

| Condition | Status | Evidence |
|---|---|---|
| Web deployed | PASS | https://livetap.vercel.app — routes 200, `/api/oauth/config` 200 JSON, `/api/oauth/token` 501/403/405 as designed, CSP/HSTS/X-Frame/Permissions-Policy headers present (curl, 2026-09-12) |
| Repo committed | PASS | https://github.com/BigBackBitcoin/livetap, branch `main`, every change pushed |
| Tests passing | PASS | `npx vitest run` → 56 files / 996 tests; `npm run test:relay` → 45; `npx playwright test` (apps/web) → 20/20; Electron smoke → PASS; `tsc -b` clean; `eslint .` clean |
| Security reviewed | PASS (post-fix) | docs/qa/SECURITY_REVIEW.md — 4 release-blocking findings fixed with regression tests (80 added); `npm audit` 0 high/critical (4 dev-only moderate/low in vitest/esbuild); secrets scan clean |
| Major UX flows tested | PASS (mock) | E2E: golden path (6 taps to 2-platform LIVE), END, failure isolation with reconnect, stream-key validation, keyboard-only, theme persistence, mobile overflow, visual baselines; docs/qa/PRODUCT_REVIEW.md 7 P0 + 15 P1 fixed |
| Platform truth documented | PASS | docs/research/PLATFORM_CAPABILITY_MATRIX.md (19 capabilities × 9 platforms, 67 footnotes, 39 UNVERIFIED items listed, not hidden) |
| Desktop status documented | PASS | docs/architecture/DESKTOP_ARCHITECTURE.md, docs/qa/DESKTOP_ENGINE_VERIFICATION.md (9/9), docs/release/DESKTOP_RELEASE.md |
| Mobile status documented | PASS | docs/architecture/MOBILE_ARCHITECTURE.md; native compile EXTERNALLY BLOCKED |
| Store readiness audited | PASS (audit) | docs/release/APP_STORE_READINESS.md, GOOGLE_PLAY_READINESS.md — item-by-item with evidence |
| External dependencies consolidated | PASS | BLOCKERS.md B-001..B-008; HANDOFF.md |

## 2. Feature verification matrix

| Capability | Web (mock) | Desktop (Windows) | Mobile | Notes |
|---|---|---|---|---|
| Intent-first onboarding → Automatic Production | PASS | PASS (same bundle; smoke opens onboarding) | UNVERIFIED (WebView) | core intents 10 tests |
| Multistream, one encode per format | SIMULATED | PASS (encoder per format → TS fan-out → N senders, byte-identical) | UNVERIFIED | ADR-015 |
| Destination failure isolation + reconnect | PASS (E2E) | PASS (kill sender B; A + recording untouched; encoder PID stable) | UNVERIFIED | core orchestrator 14 tests |
| 16:9 / 9:16 / 1:1 | PASS (compositor + per-destination aspect) | PASS (two encoders) / relay scaling hook PASS | UNVERIFIED | |
| Humane errors (WHAT/WHY/DOING/YOU CAN) | PASS | PASS (same core) | same | 23 error codes |
| Camera / mic / screen capture | UNVERIFIED (no devices; test pattern) | UNVERIFIED (no devices) | UNVERIFIED | B-007 |
| Hardware encoding | n/a | UNVERIFIED (nvenc/qsv/amf absent; probe asserts packets); libx264 PASS 66.6% of one core at 1080p30 | UNVERIFIED | B-007 |
| Recording | SIMULATED (MediaRecorder with fakes) | PASS (fMP4, survives truncation) | UNVERIFIED | |
| Chat aggregation | SIMULATED (mock chat) | same | same | real transports implemented against recorded fakes (YouTube polling, Twitch EventSub) |
| Web go-live via relay | PASS transport (native MediaMTX; WHIP→AAC→2 RTMP receivers) | n/a | n/a | B-008 for Docker |
| OAuth (YouTube/Twitch/Kick/Facebook) | SIMULATED (broker tested with fakes; live endpoint returns NOT_CONFIGURED) | SIMULATED (loopback + device code tested) | UNVERIFIED | B-006 |
| TikTok / Instagram / X | PASS (honest USER_ASSISTED stream-key path) | same | same | platforms have no public live API |
| Kick / LinkedIn | Kick scaffolded (launch+1); LinkedIn unavailable (B-003) | | | |
| Credential storage | PASS (memory only in web; nothing in localStorage — verified by grep + tests) | PASS (safeStorage vault; refuses if unavailable) | documented (Keychain/Keystore) | |
| OBS scene-collection import | PASS (28 tests) | same | same | not yet surfaced in UI (P2) |

## 3. Quality gates run at audit time

```
npx tsc -b tsconfig.json        → clean
npx eslint .                    → clean
npx vitest run                  → 56 files, 996 tests passed
npm run test:relay              → 45 passed
npx playwright test (apps/web)  → 20 passed
node apps/desktop/e2e/smoke.mjs → PASS (window title LIVETAP, route #/app/start, onboarding text present)
node apps/desktop/scripts/asar-check.cjs → PASS (33 renderer assets in app.asar)
npm audit                       → 0 high / 0 critical
```

## 4. Known limitations

- Everything platform-facing is verified against mocks and recorded API fakes; no credentials existed.
- No camera/mic/GPU on the host; capture and hardware encoders are UNVERIFIED (software path PASS).
- Desktop builds are unsigned; the guarded update check fails closed until certificates exist.
- Mobile native code has never been compiled; projects are CI-ready (workflows parked, B-001).
- Landing JS ≈ 90 KB gzipped vs the 60 KB target (React DOM alone is 69 KB).
- 15 P2 polish items remain open in docs/qa/PRODUCT_REVIEW.md; `style-src 'unsafe-inline'` remains in the CSP; relay defaults to cleartext behind a reverse proxy.
- Vertical-as-intent vs orientation control, and Kick launch timing, are owner decisions (HANDOFF.md).

## 5. Verdict

The autonomous portion of the mission is exhausted: every remaining item is gated on an
owner-only dependency (accounts, certificates, credentials, hardware, a Linux/macOS host) or is
polish. The release candidate is RESEARCHED → ARCHITECTED → IMPLEMENTED → TESTED → SECURED →
DEPLOYED → COMMITTED → RELEASE-AUDITED, with the honest labels above.

## Addendum 2026-09-12 — Public experience redesign (directive docs/prompt-pack/10)

| Check | Result | Evidence |
|---|---|---|
| Grammar / structure | Live surface, 8 acts + 2 rests, 12.8 viewport-heights, signature move (drag-to-disconnect) | scrollcraft/builds/livetap-public/REPORT.md, docs/design/LIVETAP_SCROLL_STORY.md |
| Budget | JS 46.0 KB gz (engine + anime.js + page), CSS 14.4 KB gz, one 28.9 KB font, one 8.5 KB plate | vite build output; deployed transfer JS 48.3 KB |
| Deployed review (desktop 1440, mobile 390, reduced motion) | PASS: 0 console errors, 0 failed requests, no horizontal overflow, all internal links 200, `/nope` 404 | docs/qa/deployed-review/review.json + screenshots |
| CLS | 0.005 desktop, 0.002 reduced (was 0.30 before pre-sizing pinned acts) | apps/web/scripts/cls-trace.mjs against production |
| LCP element | stage plate image (`img.ltp-stage__plate`); 364 ms warm, 1.76 s on a cold CDN fetch | same trace |
| E2E | 40/40 Playwright incl. 17 experience specs | `npm run e2e -w @livetap/web` |
| Scroll Craft harness | 3 passes x 61 samples: no dead scroll, every cue peaks, contrast >= 4.5:1 at worst frame | scrollcraft/builds/livetap-public/REPORT.md |
| 15-second test / cheap-website tests / category test | answered with screenshot evidence | docs/qa/EXPERIENCE_REVIEW.md |
| Not verified | throttled LCP/INP on a real device; Windows High Contrast; atmosphere canvas profiled against its 2 ms ceiling | - |
