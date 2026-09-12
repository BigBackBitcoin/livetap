# HANDOFF — LIVETAP release candidate

Status: FINAL for the autonomous portion (2026-09-12). Release audit: docs/release/RELEASE_AUDIT.md. Everything below is verified on the build host
unless labelled otherwise; see IMPLEMENTATION_STATUS.md for per-area labels and BLOCKERS.md for the
human dependency queue.

## Where things are

| Item | Location |
|---|---|
| Web app (production, mock mode) | https://livetap.vercel.app |
| Source | https://github.com/BigBackBitcoin/livetap (branch `main`) |
| Desktop unsigned Windows installer | built locally at `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` (not committed; rebuild with `npm run package:win -w @livetap/desktop` using Node ≥ 20.19) |
| Mobile projects | `apps/mobile/ios`, `apps/mobile/android`, plugin `packages/capacitor-live-stream` |
| Relay | `infra/relay` (MediaMTX 1.21.0 + session API) |

## Owner-only decisions queued

1. **License**: MIT is in place; research recommends Apache-2.0 for its patent grant (ADR-013). Decide before the first tagged release while the contributor base is small.
2. **FFmpeg source offer** hosting and legal contact (B-002).
3. **LinkedIn Live**: partner terms conflict with open-source distribution; MVP ships it as unavailable (B-003).
4. **Kick launch timing**: research recommends launch+1 with a payout-policy warning for long-form multistreaming.
5. **Vertical as an intent vs. an orientation control**: switching-triggers research suggests the latter; the MVP ships six intents (cheap to change later).

## One-command human actions (from BLOCKERS.md)

- B-001 `gh auth refresh -h github.com -s workflow` then move `.github/workflows-pending/*.yml` to `.github/workflows/` → CI, macOS/Ubuntu runner builds.
- B-006 create OAuth apps and paste credentials into Vercel env → real YouTube/Twitch/Kick/Facebook go-live.
- B-004/B-005 signing certificates and store accounts → signed desktop releases, TestFlight/Play testing.
- B-007 run `npm run verify:engine -w @livetap/desktop` on a machine with a GPU and camera → hardware PASS labels.

## Public experience (2026-09-12)

https://livetap.vercel.app/ is an interactive product surface, not a marketing page: scroll operates one fixed LIVETAP console through eight acts (chaos, connect, produce, adapt, multistream, resilience, power, action). Try: tap destinations, switch 16:9 / 9:16 / 1:1, change a Moment, GO LIVE (DEMO), then drag a live tile off the stage (or focus it and press Delete) and watch it reconnect while the others stay live. The close is the app's real first question and links into `/app/start`. Design docs: docs/design/LIVETAP_*.md; build report: scrollcraft/builds/livetap-public/REPORT.md; review: docs/qa/EXPERIENCE_REVIEW.md; deployed review: docs/qa/deployed-review/.

## How to test (mock mode, no credentials)

1. Open https://livetap.vercel.app → Open LIVETAP.
2. Choose an intent (e.g. Talking), pick YouTube and TikTok, continue past camera/mic (a test pattern appears when no camera exists), Open Studio.
3. Tap GO LIVE; a 3-second cancellable countdown runs; both destination chips reach LIVE (YouTube 16:9, TikTok 9:16 from one production).
4. Pro mode → Diagnostics → demo scenarios: drop one destination and watch it go RECONNECTING → LIVE while the other stays LIVE; trigger camera-lost and encoder-crash notices (WHAT/WHY/DOING/YOU CAN cards).
5. Destinations → Add → Custom RTMP: a malformed server address is refused inline; a valid one reaches READY.

Local: `npm install && npm run dev:web` (http://localhost:5173); `npm test`; `npm run e2e -w @livetap/web`.

## Review outcomes

- Security (docs/qa/SECURITY_REVIEW.md): 4 release-blocking findings fixed with regression tests — stream keys were written to the desktop log on every go-live; relay hook quoting allowed a backslash escape; a trailing-space URL bypassed validation; relay destinations could reach internal addresses (SSRF). Subsequently narrowed: CSP now `style-src 'self'; style-src-attr 'unsafe-inline'`; relay ships an opt-in Caddy TLS profile.
- Product (docs/qa/PRODUCT_REVIEW.md): verdict was NOT-YET on first look; 7 P0 + 15 P1 fixed (END was dead while live, error cards rendered off-screen, GO LIVE below the fold, over-claiming landing, developer vocabulary, reload honesty, hidden mobile nav). All 15 P2 polish items subsequently fixed.
- Desktop smoke (Playwright Electron): the packaged shell opens in onboarding under hash routing.

## Desktop test instructions

1. `npm run build -w @livetap/desktop` then `node apps/desktop/e2e/smoke.mjs` (needs the Electron binary; on Node < 20.19 run `node node_modules/electron/install.js` with Node 22 first).
2. Unsigned installer: `npm run package:win -w @livetap/desktop` (Node ≥ 20.19) → `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe`; drop an FFmpeg binary at `apps/desktop/resources/ffmpeg/win/ffmpeg.exe` before packaging to enable streaming.
3. Engine verification on a machine with FFmpeg: `npm run verify:engine -w @livetap/desktop`.

## Known limitations (honest)

- All platform go-live behaviour is verified against mocks and recorded API fakes; no real credentials existed on the build host.
- No camera, microphone or GPU on the build host: real capture and hardware encoders are UNVERIFIED (software x264 path is PASS).
- Desktop builds are unsigned; auto-update is inert until signed.
- Mobile native code has never been compiled (no macOS/JDK/Android SDK on host); projects are structurally complete and CI-ready.
- Public page JS is 46 KB gzipped (static Live-surface experience, no React on the landing); the ≤60 KB target is met.
- Web go-live needs the self-hosted relay; browsers cannot speak RTMP. Container packaging of the relay is unverified on this host (native binary verified).
