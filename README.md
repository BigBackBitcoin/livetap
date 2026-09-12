# LIVETAP

**Connect your accounts. Pick where you want to go live. Tap GO LIVE.**

LIVETAP is an open-source, local-first live-production app for creators. It is built to be the
easiest operating system for going live, not a prettier OBS. You say what you are making and
where it should go; LIVETAP builds the production, formats it for every destination, keeps each
destination isolated so one failure never kills the rest, and explains problems in plain language.

| | |
|---|---|
| Web app | React + Vite, deployed to Vercel (mock mode works with no credentials) |
| Desktop | Electron for Windows and macOS with an FFmpeg output engine |
| Mobile | Capacitor iOS/Android projects with a native streaming plugin contract |
| Core | TypeScript domain: destination state machine, orchestrator, Moments, Automatic Production |

## Status

Release-candidate work in progress. `IMPLEMENTATION_STATUS.md` is the honest per-area status
(PASS / SIMULATED / UNVERIFIED / EXTERNALLY BLOCKED). `BLOCKERS.md` lists the few things only a
human with accounts, certificates or hardware can do.

## Run it

```bash
npm install
npm run dev:web
```

Open http://localhost:5173. Mock mode gives you realistic YouTube/Twitch/TikTok destinations,
chat and health without any account.

```bash
npm test          # unit + integration tests
npm run typecheck
npm run lint
npm run e2e       # Playwright, mock mode
```

## Documents

- `PROJECT_STATE.md`, `ARCHITECTURE_DECISIONS.md`, `DECISIONS_LOG.md` for how and why
- `docs/research/PLATFORM_CAPABILITY_MATRIX.md` for what each platform really allows (never invented)
- `docs/research/COMPETITOR_FAILURE_DATABASE.md` for what the category gets wrong
- `docs/architecture/` for media engine, destination adapters, desktop, mobile, relay
- `docs/design/` for the design system and product spec
- `docs/release/` for desktop, App Store and Google Play readiness audits
- `docs/security/THREAT_MODEL.md` and `docs/legal/PRIVACY_ARCHITECTURE.md`

## License

MIT. See `THIRD_PARTY_NOTICES.md` for FFmpeg (GPL, run as a separate process) and other components.
