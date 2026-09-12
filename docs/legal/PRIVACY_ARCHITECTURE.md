# LIVETAP Privacy Architecture

LIVETAP is local-first. There is no LIVETAP account, no LIVETAP server that sees your video, and
no analytics or telemetry in the open-source core.

## Data collection

| Data | Collected by LIVETAP? | Where it lives | Retention |
|---|---|---|---|
| Camera, microphone, screen | Processed locally to produce the stream and optional recording | Device memory; recordings on the user's disk / app sandbox | Until the user deletes recordings |
| Platform OAuth tokens | Yes, to act on the user's behalf | OS credential store (Keychain / DPAPI / libsecret / iOS Keychain / Android Keystore); web: memory only | Until the user disconnects the destination or the platform revokes |
| Stream keys entered by the user | Yes | Same secure store as tokens | Until the destination is removed |
| Destination metadata (channel name, avatar URL, broadcast ids) | Yes (non-secret) | Local app storage | Until the destination is removed |
| Chat messages from platforms | Displayed live; not stored by LIVETAP | Memory | Session only |
| Production settings, Moments | Yes | Local app storage (desktop `userData`, browser IndexedDB/localStorage for non-secrets, mobile Preferences) | Until reset |
| Crash reports / analytics | **No** in the open-source core | — | — |
| LIVETAP CLOUD (future, optional) | Only if the user opts in | Documented separately when it exists | — |

## Credential storage

- Desktop: `safeStorage.encryptString` → `vault.bin` under `app.getPath('userData')`. If the OS
  cannot provide encryption, LIVETAP refuses to store tokens and tells the user.
- Mobile: native Keychain / Keystore through a secure-storage plugin. Never `Preferences` for secrets.
- Web: tokens obtained through the token broker are held in memory for the session. A page reload
  requires reconnecting. No long-lived tokens in `localStorage`, `sessionStorage` or cookies
  readable by JavaScript.

## Network flows

| Flow | Protocol | Purpose |
|---|---|---|
| App → platform OAuth endpoints | HTTPS | Sign-in (PKCE where supported) |
| Web app → Vercel token broker (`/api/oauth/*`) | HTTPS, same origin | Exchange authorization code for tokens for confidential clients |
| App → platform APIs (YouTube Data API, Twitch Helix, Kick, Facebook Graph) | HTTPS bearer | Create/control broadcasts, chat, analytics |
| App → platform ingest | RTMPS (default), RTMP (custom only), SRT, WHIP over HTTPS | Live video/audio |
| Web app → self-hosted relay | WHIP over HTTPS | Browser publishing when no desktop app |
| Desktop app → GitHub Releases | HTTPS | Signed updates |

No flow sends data to LIVETAP-operated servers in the open-source core.

## Local vs cloud processing

All capture, compositing, encoding and recording happen on the user's device. The optional relay
(self-hosted MediaMTX, or a future LIVETAP CLOUD service) only forwards already-encoded media to
platforms; it is never required for the desktop app.

## Deletion and revocation

- **Disconnect a destination** deletes its token and stream key from the secure store immediately.
- **Reset LIVETAP** (Settings → Advanced) deletes all local settings, Moments and the vault.
- Users can additionally revoke LIVETAP at the platform: Google Account → Third-party access;
  Twitch Settings → Connections; Kick Settings → Connected apps; Facebook Settings → Business
  integrations. LIVETAP detects revocation (401/403) and shows the AUTH_REVOKED humane error.
- Because LIVETAP has no accounts, there is no LIVETAP-side data to delete; the app-store
  "account deletion" requirement is satisfied by the absence of accounts plus the in-app
  disconnect/reset actions (see `docs/release/APP_STORE_READINESS.md`).

## Platform data use

Platform data (channel names, chat, viewer counts) is used only to render the LIVETAP UI for the
signed-in user. LIVETAP complies with the YouTube API Services Terms (data is not stored beyond
the session except non-secret identifiers, and is refreshed on each use), Twitch Developer
Agreement, Kick Developer Terms and Meta Platform Terms. A limited-use disclosure for Google
user data will be included in the published privacy policy before OAuth verification.
