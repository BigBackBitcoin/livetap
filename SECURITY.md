# Security Policy

## Reporting a vulnerability

Please do not open public issues for security problems. Use GitHub's private vulnerability
reporting on this repository ("Security" tab → "Report a vulnerability"). You will get an
acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## What we protect

LIVETAP handles credentials that give access to creators' social accounts and to live streams.
The security model is documented in `docs/security/THREAT_MODEL.md` and
`docs/legal/PRIVACY_ARCHITECTURE.md`. In short:

- **Credentials** — OAuth tokens live only in the OS credential store (Electron `safeStorage`
  backed by Keychain / DPAPI / libsecret; iOS Keychain; Android Keystore). The web app keeps
  short-lived tokens in memory and relies on a server-side token broker for confidential clients.
  Long-lived tokens are never written to `localStorage`.
- **Stream keys** — treated as secrets: redacted in logs and error messages, validated before use,
  never placed in URLs that are logged.
- **Process boundaries** — the desktop renderer is sandboxed with `contextIsolation`, no Node
  integration, a strict CSP and an allow-listed IPC surface. FFmpeg is spawned with argument
  arrays; user input never reaches a shell.
- **Network** — HTTPS/RTMPS/WSS by default. Plain RTMP is allowed only for custom destinations the
  user explicitly configures.
- **Updates** — desktop updates are signed and verified (electron-updater) once signing
  certificates are configured; see `docs/release/DESKTOP_RELEASE.md`.

## Supported versions

Only the latest release on `main` receives security fixes during the MVP period.

## Dependency hygiene

`npm audit --audit-level=high` runs in CI. Secret scanning runs on every push. Dependencies are
pinned via the lockfile and reviewed for license compatibility (see `THIRD_PARTY_NOTICES.md`).
