# HANDOFF — LIVETAP release candidate

Status: DRAFT (being finalized during Phase 11). Everything below is verified on the build host
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

## How to test (mock mode, no credentials)

1. Open https://livetap.vercel.app → Open LIVETAP.
2. Choose an intent (e.g. Talking), pick YouTube and TikTok, continue past camera/mic (a test pattern appears when no camera exists), Open Studio.
3. Tap GO LIVE; a 3-second cancellable countdown runs; both destination chips reach LIVE (YouTube 16:9, TikTok 9:16 from one production).
4. Pro mode → Diagnostics → demo scenarios: drop one destination and watch it go RECONNECTING → LIVE while the other stays LIVE; trigger camera-lost and encoder-crash notices (WHAT/WHY/DOING/YOU CAN cards).
5. Destinations → Add → Custom RTMP: a malformed server address is refused inline; a valid one reaches READY.

Local: `npm install && npm run dev:web` (http://localhost:5173); `npm test`; `npm run e2e -w @livetap/web`.

## Known limitations (honest)

- All platform go-live behaviour is verified against mocks and recorded API fakes; no real credentials existed on the build host.
- No camera, microphone or GPU on the build host: real capture and hardware encoders are UNVERIFIED (software x264 path is PASS).
- Desktop builds are unsigned; auto-update is inert until signed.
- Mobile native code has never been compiled (no macOS/JDK/Android SDK on host); projects are structurally complete and CI-ready.
- Landing JS is ~90 KB gzipped (React DOM alone is 69 KB); the ≤60 KB target needs a static landing.
- Web go-live needs the self-hosted relay; browsers cannot speak RTMP. Container packaging of the relay is unverified on this host (native binary verified).
