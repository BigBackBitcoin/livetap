# LIVETAP — PROJECT STATE

> Persistent memory for the autonomous build. Recover from this file first.
> Mission source: docs/prompt-pack/00_LIVETAP_CONTROL_PROMPT_01.md

## Mission
Build LIVETAP: open-source, free, professional live broadcasting.
"Connect your accounts. Pick where you want to go live. Tap GO LIVE."

## STRATEGIC PRINCIPLE (north-star correction, 2026-09-11 - docs/prompt-pack/09_LIVETAP_NORTH_STAR_CORRECTION.md)
**LIVETAP is an easy live-production operating system, not merely an OBS replacement.**
Journey: "I want to go live" -> What am I making? -> Where do I want to broadcast? -> Here is the best setup -> GO LIVE -> LIVE.
Rules: better workflow > more features; better reliability > more integrations; better automation > more configuration; better hierarchy > decoration.
Forbidden: "OBS but prettier". Simple Mode never exposes scenes/sources/bitrate/RTMP/codecs.
Product review at every milestone: could a first-timer do it? would an expert trust it? faster? power only when needed? different from OBS? would someone switch?

## Environment truth (probed 2026-09-11)
| Item | Status |
|---|---|
| OS | Windows Server 2022 (Vultr VM), 4 vCPU AMD EPYC, 12 GB RAM, 92 GB free |
| GPU | NONE (Microsoft Basic Display Adapter) → NVENC/QSV/AMF = UNVERIFIED |
| Camera | NONE physical → camera capture = SIMULATED/UNVERIFIED |
| Audio | Remote Audio endpoint only |
| Node | 20.11.1 (Vite 7 needs 20.19+ → use Vite 6) |
| npm / bun | 10.2.4 / 1.4.0 (no pnpm/yarn) |
| FFmpeg | 9.0.1 full build (gyan.dev, GPL) — libx264, rtmp/rtmps/srt protocols confirmed; nvenc/qsv/amf encoders compiled in but no GPU |
| Docker | 29.6.2 available |
| Python | 3.13.3 |
| Rust/Cargo | NOT installed → Tauri not buildable here → Electron chosen for desktop |
| Java/Android SDK | **INSTALLED 2026-09-14** via `bash tools/acquire-android-toolchain.sh` (portable JDK 21 + Android SDK 36 into gitignored `tools/`). The debug APK builds. No emulator: this VM reports VMMonitorModeExtensions=False, so nothing Android can ever RUN here |
| MediaMTX | `tools/mediamtx/mediamtx.exe` v1.21.0, native Windows binary. The dev ingest receiver and the relay's native verification both use it |
| Playwright + Electron | installed; `_electron` launches the built desktop app with `--use-fake-device-for-media-stream`, which drives the real getUserMedia path with a synthetic source |
| Xcode | N/A (Windows) → iOS native build = BLOCKED_EXTERNAL_DEPENDENCY |
| GitHub CLI | Logged in (account BigBackBitcoin, scopes: repo, gist, read:org) → can create/push repo |
| Vercel CLI | Logged in (cryptojam876-8414) → can deploy |
| Media generation | Higgsfield-class MCP available (generate_image/video) |
| Scroll Craft | skill available (nateherk-design:scrollcraft) |
| Firecrawl CLI | installed 1.19.24 but no API key → use WebSearch/WebFetch |

## Repository layout (target)
```
apps/web        React + Vite + TS web app (landing + studio), deployed to Vercel
apps/desktop    Electron shell (Windows/macOS), FFmpeg sidecar engine
apps/mobile     Capacitor iOS/Android wrappers + native streaming plugin contract
packages/core   Domain: orchestrator, destination state machine, Moments, health
packages/adapters  Destination adapters (mock + real)
packages/media  Media engine abstraction (browser engine, FFmpeg engine)
packages/ui     Design system
docs/           research, architecture, release, legal, security, qa, prompt-pack
```

## Phase status
**2026-09-14: REAL-WORLD PERSONAL ALPHA.** A real broadcast was observed on this
host for the first time: the built desktop app, driven through its own UI,
capturing through the real getUserMedia, publishing two simultaneous RTMP
streams at 1920x1080 and 1080x1920 that a real server accepted and ffprobe
decoded as H.264 plus AAC, with failure isolation proven against a real dropped
TCP connection. It does not reproduce on a rebuild; the two lines responsible
are named in docs/qa/REAL_WORLD_ALPHA_READINESS.md. See CURRENT_PHASE.md.

Earlier that day: first-time creator audit closed on the public page (ADR-017).

## The gate, as a command
```
npm run verify:broadcast
```
Preflight, receiver self-test, a real RTMP server, the full desktop broadcast
with ffprobe evidence, a deliberate mid-broadcast TCP kill, and the
navigate-away-during-END regression. One stage table, one exit code. Read
infra/dev-harness/broadcast/README.md for how to read a failure, and in
particular the difference between MISSING (a piece of the chain is absent and
nothing was tested) and FAIL (the piece was there and the product did not do
what it claims).

## Recovery instructions
1. Read CURRENT_PHASE.md, then docs/qa/REAL_WORLD_ALPHA_READINESS.md, then
   IMPLEMENTATION_STATUS.md and BLOCKERS.md.
2. Run `npm run verify:broadcast` before believing any claim about broadcasting.
3. Do not redo research listed in RESEARCH_INDEX.md.
4. Do not re-decide anything in ARCHITECTURE_DECISIONS.md without new evidence.
5. Everything the owner has to do is consolidated, once, in docs/OWNER_ACTIONS.md.
   Do not ask them for things one at a time.
