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
