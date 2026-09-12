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
| Java/Android SDK | NOT installed → Android native build = BLOCKED_EXTERNAL_DEPENDENCY |
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
See CURRENT_PHASE.md. Implementation detail in IMPLEMENTATION_STATUS.md.

## Recovery instructions
1. Read CURRENT_PHASE.md, IMPLEMENTATION_STATUS.md, BLOCKERS.md.
2. Do not redo research listed in RESEARCH_INDEX.md.
3. Do not re-decide anything in ARCHITECTURE_DECISIONS.md without new evidence.
