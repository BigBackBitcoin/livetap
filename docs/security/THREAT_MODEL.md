# LIVETAP Threat Model

Scope: web app (Vercel), desktop app (Electron, Windows/macOS), mobile apps (Capacitor iOS/Android),
optional self-hosted relay (MediaMTX). Method: STRIDE per trust boundary.

## Assets

| Asset | Why it matters |
|---|---|
| Platform OAuth tokens (YouTube, Twitch, Kick, Facebook) | Full control of a creator's channel: start/stop broadcasts, read chat, change metadata |
| Stream keys / SRT passphrases / WHIP bearer tokens | Anyone holding them can broadcast as the creator |
| Live media (camera, mic, screen) | Privacy; screen capture can expose other apps |
| Recordings on disk | Private content |
| Update channel | Code execution on every desktop install |

## Trust boundaries

1. Renderer (untrusted UI, Chromium sandbox) ↔ Electron main (trusted, has Node, filesystem, keychain).
2. App ↔ platform APIs (external, authenticated with bearer tokens).
3. App ↔ ingest servers (RTMP/RTMPS/SRT/WHIP).
4. Web app ↔ Vercel serverless token broker (holds client secrets).
5. Browser ↔ self-hosted relay (WHIP over HTTPS).
6. Desktop app ↔ update server (GitHub Releases).

## Threats and mitigations

| ID | Threat (STRIDE) | Boundary | Mitigation | Status |
|---|---|---|---|---|
| T1 | Renderer compromise (XSS via chat message content) escalates to Node (E) | 1 | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; allow-listed typed IPC only; CSP `script-src 'self'`; chat text rendered as text nodes, never HTML | Implemented in desktop main/preload; UI must never `dangerouslySetInnerHTML` chat |
| T2 | Command injection through stream URL/key into FFmpeg (T, E) | 1→OS | `child_process.spawn` with argv arrays, `shell: false`; `validateIngest` rejects whitespace and shell metacharacters as defence in depth | Implemented in core + desktop engine; unit-tested |
| T3 | Token theft from disk (I) | 1 | Tokens encrypted with `safeStorage` (Keychain/DPAPI/libsecret); refuse to store if encryption unavailable; iOS Keychain / Android Keystore on mobile; web keeps tokens in memory only | Desktop vault implemented; mobile contract documented |
| T4 | Stream key leak via logs, error toasts, crash reports, screenshots (I) | all | `redactIngest`, `safeMessage()` strips keys from error text; keys masked in UI fields; diagnostics export redacts | Implemented in core; UI rule |
| T5 | OAuth authorization-code interception (S) | 2 | PKCE (S256) where the platform supports it; loopback `127.0.0.1` redirect on desktop with random port + `state`; custom scheme only as fallback; `state` verified; one-time verifier | Adapters helpers implemented; desktop loopback implemented |
| T6 | Client secret exposure for confidential clients (Kick, Facebook, YouTube web) (I) | 4 | Secrets live only in Vercel env vars; broker exchanges code→token and returns tokens over HTTPS to the same origin; broker validates `state`/origin, rate-limits, never logs tokens | To implement in apps/web/api |
| T7 | CSRF on the broker (S) | 4 | Broker requires `state` bound to a per-session nonce in an HttpOnly, SameSite=Strict cookie; POST only; origin check | To implement |
| T8 | Open redirect / arbitrary URL open (S, T) | 1 | `shell.openExternal` only for `https:` URLs after allow-list; `will-navigate` blocked; `setWindowOpenHandler` denies | Implemented in desktop main |
| T9 | Malicious browser source (E) | 1 | Browser layers restricted to `https:`; loaded in isolated `<webview>`/BrowserView with no preload and no Node; post-MVP feature, UNVERIFIED in web | Validation in core types; desktop UNVERIFIED |
| T10 | Update tampering (T, E) | 6 | electron-updater verifies signature against the publisher certificate; HTTPS only; no update if unsigned build | BLOCKED_EXTERNAL_DEPENDENCY (certificates) |
| T11 | Supply-chain compromise (T) | build | Lockfile committed; `npm audit` in CI; secret scanning; minimal dependencies (core/adapters/media are zero-dependency); pinned GitHub Actions | CI implemented; audit results in docs/qa |
| T12 | Denial of service by a destination (D) | 3 | Per-destination sender processes; failure isolation; bounded reconnect with backoff; one dead output never blocks the encoder | Implemented in core orchestrator; desktop engine topology |
| T13 | Unwanted screen capture (I) | OS | OS permission prompts (macOS TCC, Windows picker, mobile MediaProjection); screen layers off by default; visible "sharing screen" indicator required in UI | UI rule |
| T14 | Recording written to attacker-chosen path (T) | 1 | Recording directory chosen via native dialog; paths validated to stay under the chosen directory; no path from renderer text input | Desktop IPC guard |
| T15 | Mock mode mistaken for production (R) | UI | Persistent banner; `mock: true` on every profile/config/message; separate registry | Implemented in adapters + UI rule |
| T16 | Relay abuse (someone else publishes to the user's relay) (S) | 5 | WHIP bearer token per publish path; relay listens on localhost or behind TLS; documented in relay compose | Relay docs |
| T17 | Sensitive data in URL query strings (I) | 4 | Tokens only in Authorization headers / POST bodies; never in `?token=` | Rule; broker design |

## Residual risks (MVP)

- Unsigned desktop builds until certificates exist (users must trust the download source).
- Browser-source layers are post-MVP because sandboxing arbitrary web content inside the compositor is not yet verified.
- Twitch device-code tokens live 4 hours and refresh tokens are single-use: token rotation must be atomic in the vault (documented in adapters).

## Security tests

- `packages/core/src/validation/ingest.test.ts` — metacharacter refusal.
- `packages/core/src/orchestrator/BroadcastOrchestrator.test.ts` — no secrets in snapshots.
- `apps/desktop` tests — argv builder refusal, IPC payload guards, vault round-trip.
- CI: `npm audit --audit-level=high`, secret scan (gitleaks), lint rule against `dangerouslySetInnerHTML`.
