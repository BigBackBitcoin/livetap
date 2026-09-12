# DECISIONS LOG (chronological)

- 2026-09-11 Probed environment; recorded truth table in PROJECT_STATE.md.
- 2026-09-11 Moved prompt pack into docs/prompt-pack; initialized git (branch main).
- 2026-09-11 Chose npm workspaces monorepo, React+Vite web, Electron desktop, Capacitor mobile (ADR-001..004).
- 2026-09-11 Launched 7 parallel research agents: competitors A/B, platform APIs (YouTube/Twitch/Kick; TikTok/IG/FB; X/LinkedIn/others), media engine, desktop/mobile/store.
- 2026-09-11 Core domain committed (state machine, orchestrator, humane errors, health, formats, Moments) - 47 tests green.
- 2026-09-11 Launched implementation teams: adapters (profiles+mocks+real scaffolds), media (BrowserEngine/WHIP/MockEngine/compositor), UI design system + product spec, Electron desktop + FFmpeg engine with on-host verification.
- 2026-09-11 NORTH-STAR CORRECTION received and adopted: LIVETAP = easiest operating system for going live. Stored as docs/prompt-pack/09. Added ADR-009..012. Added core intent model (Automatic Production) - 57 tests green. Launched switching-triggers research. Design-team output gets a revision pass for intent-first onboarding (messaging running agents is unavailable in this session).
- 2026-09-11 Research: Trovo and DLive are dead (2026); removed. Twitch has no PKCE (device-code grant); Kick needs server-side secret; Vercel drops Node 20 on 2026-10-01 -> functions target Node 22.
