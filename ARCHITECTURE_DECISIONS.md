# ARCHITECTURE DECISIONS (ADR log)

Format: ADR-n | Status | Decision | Evidence | Consequences

## ADR-001 | ACCEPTED | Monorepo with npm workspaces
Evidence: npm 10 available; pnpm/yarn absent; Vercel supports npm workspaces natively.
Consequences: single lockfile, shared TS packages, simple CI.

## ADR-002 | ACCEPTED | Web app = React 19 + Vite 6 + TypeScript (SPA) with Vercel serverless functions under apps/web/api
Evidence: Mission requires React-based web app. Node 20.11 caps Vite at v6. SPA output is directly reusable by Electron and Capacitor (one UI codebase across web/desktop/mobile). OAuth token exchange for confidential clients must run server-side → Vercel functions.
Consequences: no SSR for landing (acceptable).

## ADR-003 | ACCEPTED | Desktop = Electron (not Tauri)
Evidence: Rust toolchain absent on build host; Electron builds with Node only; Electron provides desktopCapturer (screen/window), safeStorage (OS keychain-backed), and mature signing/update tooling. Tauri would be lighter but is unbuildable/untestable here.
Consequences: larger binary; must enforce contextIsolation, sandbox, strict CSP, no nodeIntegration, allowlisted IPC.

## ADR-004 | ACCEPTED | Mobile = Capacitor wrapping the React app + native streaming plugin contract
Evidence: Reuses the single React UI; produces real Xcode and Android Studio projects; WebView getUserMedia works on iOS 14.3+/Android. RTMP push from mobile requires a native plugin (HaishinKit / RootEncoder) — contract defined; builds BLOCKED_EXTERNAL_DEPENDENCY (no Xcode/Android SDK on host).
Consequences: mobile native builds cannot be compiled here; documented honestly.

## ADR-005 | PROPOSED (awaiting media research) | Layered media engine
BrowserEngine (getUserMedia/getDisplayMedia + Canvas compositor + MediaRecorder/WebCodecs + WHIP) for web/mobile; FFmpegEngine (spawned with argv arrays, never a shell) for desktop RTMP/SRT push and recording, using the tee muxer for single-encode fan-out; optional self-hosted relay (MediaMTX) for WHIP→RTMP.
Evidence pending: docs/research/MEDIA_ENGINE_EVALUATION.md

## ADR-006 | ACCEPTED | Destination adapters are capability-driven; UI reads capabilities, never provider specifics
Evidence: prompt pack §8, §9; platform APIs differ wildly.

## ADR-007 | ACCEPTED | Mock mode is a first-class, visibly-labelled provider set (never masquerades as production)

## ADR-008 | ACCEPTED | Destination lifecycle is an explicit state machine
States: DISCONNECTED, AUTHENTICATING, READY, STARTING, LIVE, DEGRADED, RECONNECTING, FAILED, STOPPING, ENDED. Transitions are validated in packages/core and unit-tested. One destination failing never transitions the production or sibling destinations.

## ADR-009 | ACCEPTED | LIVETAP CORE vs LIVETAP CLOUD boundary
CORE (open source, MIT): desktop-first local production, local recording, core adapters, self-hostable relay config. CLOUD (future, optional, may be paid): managed relay/transcoding, cloud recording, remote guests, CDN, analytics, AI, teams. Boundary: everything that needs a server lives behind explicit interfaces (RelayProvider, TokenBroker for OAuth secret exchange, CloudRecordingSink) with self-hosted defaults; the UI never assumes cloud exists. No monetization code in MVP.

## ADR-010 | ACCEPTED (provisional; validated by docs/research/SWITCHING_TRIGGERS.md section 6 when available) | MVP destination set
Launch set: YouTube (deep API: create/bind/transition, chat, analytics), Twitch (Helix stream key + metadata, EventSub chat; device-code auth), TikTok (USER_ASSISTED stream key from LIVE Studio; 9:16), plus Custom RTMP/RTMPS/SRT/WHIP. Kick, Facebook, Instagram, X, LinkedIn ship as honest "paste stream key"/"unavailable" cards via the same adapter contract; real API adapters for Kick/Facebook are scaffolded and tested against fakes but not enabled in the UI until credentials/app review exist.
Evidence: PLATFORM_* research - YouTube is the only full control plane; Twitch/Kick auto-start on ingest; TikTok/Instagram have no public live API; Facebook requires Business Verification for Live Video API.

## ADR-011 | ACCEPTED | Automatic Production driven by content intent
packages/core/src/production/intents.ts: six content types (talking, gaming, podcast, presentation, event, vertical). buildAutomaticProduction(intent, destinations) picks per-destination aspect (intent preference intersected with platform support), the master canvas, quality preset, audio defaults, Moment order/layout and safe areas (9:16 keeps text out of chat/action zones). Pure, deterministic, unit-tested. Onboarding asks WHAT -> WHERE -> camera/mic/screen -> GO LIVE.

## ADR-012 | ACCEPTED | Universal transport for MVP = H.264 + AAC over RTMP/RTMPS
Evidence: 2026 ingest matrix (docs/research/PLATFORM_X_LINKEDIN_OTHERS.md section 4): no major social platform accepts WHIP or SRT; HEVC/AV1 only on YouTube/Twitch via Enhanced RTMP. WHIP is used only for LIVETAP web->relay (MediaMTX) and custom destinations. HEVC/AV1 and SRT are Pro-mode, per-profile options.

## ADR-005 | ACCEPTED (2026-09-11, evidence: docs/research/MEDIA_ENGINE_EVALUATION.md sections 5, 9) | Layered media engine - confirmed
- Web/mobile WebView: BrowserEngine (getUserMedia/getDisplayMedia -> canvas compositor -> captureStream -> WHIP RFC 9725 -> self-hosted MediaMTX relay -> pass-through fan-out to RTMP/RTMPS). Browsers cannot speak RTMP; this is not fixable.
- Desktop: renderer composites; FFmpeg 9 child process (argv arrays, pipes; never linked) encodes once per aspect ratio; tee muxer with per-slave onfail=ignore + use_fifo=1 + fifo_options=attempt_recovery=1 gives per-output reconnect without disturbing siblings or the recording (VERIFIED-HOST 9.6). Rules learned by testing: an "anchor" slave (recording or [f=null]-) is mandatory because FFmpeg aborts if every slave fails to open (9.7a); hardware-encoder probes must assert packets were produced because failing h264_nvenc/qsv/amf still exit 0 (9.3). The desktop team may alternatively use an encoder -> N sender-process topology; whichever passes on-host isolation/reconnect tests ships.
- Rejected: GStreamer (dead Node bindings), libobs/obs-studio-node (GPL in-process relicenses LIVETAP; stale public releases), OvenMediaEngine (AGPL, no Windows).
- Hardware encoders: NVENC/QSV/AMF/VideoToolbox = UNVERIFIED on this host (no GPU); h264_mf (MediaFoundation) encodes on this GPU-less host (VERIFIED-HOST) - viable LGPL-profile fallback.

## ADR-013 | ACCEPTED (owner may revisit - see HANDOFF) | LIVETAP license = MIT; FFmpeg shipped as a separate GPLv3 executable
- MIT chosen for simplicity and adoption; all packages declare MIT. FFmpeg is spawned, never linked (FSF "mere aggregation"), so LIVETAP stays permissive, BUT the desktop bundle still owes GPLv3 obligations for the FFmpeg binary: license texts, build configuration, and a source offer/mirror - captured in THIRD_PARTY_NOTICES.md and required before first binary release.
- Research recommends Apache-2.0 instead (express patent grant + retaliation clause matters for H.264/HEVC/AV1-adjacent code). Because the choice is legally material and owner-only, it is recorded as a HANDOFF decision rather than changed unilaterally. Switching later is a one-file change plus package.json fields while the contributor base is small.
- An LGPL FFmpeg build profile (openh264 / MediaFoundation / VideoToolbox / hardware encoders, no libx264) is a credible escape hatch for app-store or OEM distribution (research 7.4).

## ADR-014 | ACCEPTED (VERIFIED-HOST, docs/qa/RELAY_NATIVE_VERIFICATION.md) | Web go-live relay = MediaMTX two-stage: WHIP in, one audio transcode, native fan-out
- Browser -> WHIP (H.264 + stereo Opus) -> MediaMTX path live/<session> -> runOnAvailable FFmpeg (-c:v copy -c:a aac) -> live/<session>-aac -> native `forward` (dest: rtmp(s)://host/app#streamKey) to N platforms. Verified natively on host: both receivers got H.264 + AAC, byte-identical.
- Per-destination isolation: each forward destination has its own connection and retry loop inside MediaMTX (observed). Stream keys stay in relay path config created by the session API; never in the browser.
- Docker is optional: the relay is a single binary; infra/relay documents both docker compose and native runs. 9:16 from 16:9 web productions = a second scaling hook (the only relay-side video re-encode). Desktop never needs the relay.

## ADR-015 | ACCEPTED (VERIFIED-HOST, docs/qa/DESKTOP_ENGINE_VERIFICATION.md) | Desktop output topology = encoder per aspect ratio -> TS fan-out -> one `-c copy` sender per destination
- Renderer encodes once with MediaRecorder (Chromium 140 yields `video/x-matroska;codecs=avc1`, Constrained Baseline); chunks cross IPC at ~0.35% of measured IPC capacity; FFmpeg remuxes (`-c:v copy -c:a aac`). Raw RGBA over IPC was rejected by measurement (53 ms per 1080p30 frame vs 33 ms budget). WebCodecs (`avc1.640028` supported) is the documented upgrade path for High profile.
- `tee` was rejected for the live output set because its slave list is fixed at process start: adding or reconnecting one destination would restart the encoder and blip every other destination. Verified: killing one sender leaves the others and the recording untouched; remove/re-add keeps the encoder PID unchanged. Encoder CPU 1080p30 veryfast = 66.6% of one core; each sender 5.8%.
- Recording: fragmented MP4 with `-bsf:a aac_adtstoasc`, survives truncation. Hardware encoders: nvenc/qsv/amf UNAVAILABLE on host (probe asserts packets, not exit code); libx264 PASS.
