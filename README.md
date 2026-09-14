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

## Live

Web app (mock mode, no credentials needed): **https://livetap.vercel.app**

## Status

Real-world personal alpha, in progress. `IMPLEMENTATION_STATUS.md` is the honest per-area
status (PASS / PARTIAL / SIMULATED / UNVERIFIED / EXTERNALLY BLOCKED) and every PASS on it
names the command that produced it. `BLOCKERS.md` lists the few things only a human with
accounts, certificates or hardware can do.

A real two-destination broadcast was measured on this build host on 2026-09-14: the built
desktop app, driven through its own UI, capturing through the real `getUserMedia`, publishing
two simultaneous RTMP streams at 1920x1080 and 1080x1920 that a real server accepted and
`ffprobe` decoded as H.264 plus AAC, with one destination dropped at the TCP level
mid-broadcast while the other kept climbing.
`docs/qa/REAL_WORLD_ALPHA_READINESS.md` is the item-by-item account, including what does not
reproduce yet and why.

## Prove it yourself

Nothing in this repository asks you to take a broadcast on trust.

```bash
node infra/dev-harness/ingest/selftest.mjs   # is the local RTMP receiver honest, with no product involved?
npm run build -w @livetap/desktop
npm run verify:broadcast                     # the whole chain, one exit code
```

`verify:broadcast` runs the receiver self-test, starts a real RTMP server, drives the built
desktop app to a real two-shape broadcast, asks `ffprobe` what arrived, drops one destination
at the TCP level and checks the other kept climbing, presses END and checks everything
stopped. It prints a stage table and exits non-zero on any failure, and it distinguishes a
missing piece (nothing was tested) from a failure (the product did not do what it claims).
See `infra/dev-harness/broadcast/README.md`.

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
- `docs/security/THREAT_MODEL.md`, `docs/security/REAL_CREDENTIAL_SECURITY.md` and `docs/legal/PRIVACY_ARCHITECTURE.md`
- `docs/platforms/PLATFORM_AUTH_MATRIX.md` for what connecting each platform actually costs the creator
- `docs/qa/REAL_PLATFORM_TEST_MATRIX.md` and `docs/qa/REAL_DEVICE_TEST_MATRIX.md` for what has been run, and against what
- `docs/OWNER_ACTIONS.md` if you are self-hosting: every developer-console step, in order

## License

MIT. See `THIRD_PARTY_NOTICES.md` for FFmpeg (GPL, run as a separate process) and other components.
