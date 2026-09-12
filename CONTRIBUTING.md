# Contributing to LIVETAP

Thanks for helping make going live easier. This document is the short version; the
persistent project state files in the repo root (`PROJECT_STATE.md`, `ARCHITECTURE_DECISIONS.md`)
explain the why.

## The one rule

**LIVETAP is the easiest operating system for going live, not a prettier OBS.**
Every change must reduce friction or add meaningful production capability. If a PR adds a
setting, a panel, or a term (scene, source, bitrate, RTMP, codec) to Simple Mode, it will be
asked to justify itself or move to Pro Mode.

## Repository layout

```
apps/web        React + Vite web app (landing + studio) — deployed to Vercel
apps/desktop    Electron shell (Windows/macOS) + FFmpeg output engine
apps/mobile     Capacitor iOS/Android projects + native streaming plugin
packages/core   Domain: orchestrator, destination state machine, Moments, intents, health
packages/adapters  Destination adapters (mock + real) and platform profiles
packages/media  Browser media engine, WHIP client, Moment compositor, mock engine
packages/ui     Design system (tokens, components)
docs/           research, architecture, design, release, legal, security, qa
```

## Getting started

```bash
npm install
npm run dev:web        # http://localhost:5173 (mock mode, no credentials needed)
npm test               # all vitest projects
npm run typecheck
npm run lint
npm run build:web
```

Desktop: `npm run dev -w @livetap/desktop` (needs Electron downloaded and `ffmpeg` on PATH).
Mobile: see `docs/architecture/MOBILE_ARCHITECTURE.md`.

## Ground rules for code

- TypeScript strict. No `any`. Type-only imports use `import type`.
- Platform specifics live in `packages/adapters`. The UI reads capabilities; it never branches on
  a platform name to decide what a button does.
- Media engines never receive shell strings. FFmpeg is spawned with argument arrays only.
- Never log tokens, stream keys or passphrases. Use `redactIngest` from `@livetap/core`.
- Every user-facing error goes through `humanize()` — WHAT / WHY / WHAT LIVETAP IS DOING / WHAT YOU CAN DO.
- One destination failing must never change another destination's state (see the orchestrator tests).
- Mock mode is real code with a visible banner; mocks never masquerade as production.

## Tests

- Unit tests next to the code (`*.test.ts` / `*.test.tsx`), run with vitest.
- E2E tests in `apps/web/e2e` run with Playwright against mock mode.
- A PR that changes behaviour without a test is asked for one.

## Research and decisions

New platform capabilities must cite official documentation and be classified in
`docs/research/PLATFORM_CAPABILITY_MATRIX.md` as NATIVE_API / RTMP_DESTINATION / OAUTH_API /
USER_ASSISTED / PARTNER_APPROVAL_REQUIRED / EXPERIMENTAL / UNAVAILABLE. Never invent an endpoint.

Architecture changes get an ADR entry in `ARCHITECTURE_DECISIONS.md`.

## Licensing

LIVETAP is MIT. Do not add copyleft dependencies (GPL/AGPL) that link into the app. FFmpeg is
used as a separate process only; see `THIRD_PARTY_NOTICES.md`. Do not copy code, UI, branding or
assets from proprietary products.

## Commit style

`type(scope): summary` — types: feat, fix, docs, test, chore, refactor, perf, ci.
