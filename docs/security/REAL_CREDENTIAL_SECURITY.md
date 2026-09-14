# Real credential security

Written 2026-09-14, at the point where LIVETAP stops handling simulated
credentials and starts handling real ones: real OAuth access tokens, real
refresh tokens, real client secrets and real stream keys.

A stream key is a password for somebody's channel. A YouTube refresh token is a
key to it. Neither of them has any business being in a log file, a crash
report, a diagnostics export, browser storage, a React prop, a URL, or a
screenshot. This document says where each one lives on each surface, what
protects it, and, item by item, **which of these guarantees hold today and
which do not**.

**Related.** `docs/security/THREAT_MODEL.md` is the general model.
`docs/qa/SECURITY_REVIEW.md` is the 2026-09 review and its four
release-blocking findings. This file is narrower and newer: it is only about
credentials, now that they are real.

---

## Summary: which of the owner's requirements hold today

| # | Requirement | Holds today | Where |
|---|---|---|---|
| 1 | Token storage per surface | **Yes**, on desktop and web. **Structurally, unproven at runtime** on mobile | `apps/web/src/state/tokens.ts`, `apps/desktop/src/main/vault.ts` |
| 2 | OAuth flow is authorization code with PKCE, never implicit | **Yes** where the platform supports it; Twitch uses device code because it documents no PKCE | `packages/adapters/src/oauth/`, `apps/web/src/state/oauthFlow.ts` |
| 3 | Redirect URI policy is an allow-list, not a pattern | **Yes** | `apps/web/api/_lib/broker.ts` `isAllowedRedirectUri` |
| 4 | `state` is generated, stored and verified | **Yes.** `nonce` is **not used**, and does not need to be | `oauthFlow.ts`, `apps/desktop/src/main/oauth.ts` |
| 5 | Client secrets never ship in a binary | **Yes** for Kick and Facebook. **Partially** for YouTube: Google issues a secret even to Desktop app clients and it ships obfuscated, with PKCE as the real protection |
| 6 | No credential can reach a log line | **Yes, and it is now a test that fails** | `infra/dev-harness/broadcast/secret-log.test.mjs` |
| 7 | Disconnect deletes the local credential | **Yes** | `tokens.ts` `revokeTokens` |
| 8 | Disconnect revokes at the platform | **Yes, best effort.** Facebook has no revocation endpoint | `apps/web/api/oauth/revoke.ts` |
| 9 | Nothing secret in browser storage | **Yes** | `secrets.ts`, `tokens.ts` |
| 10 | IPC is allow-listed and treats every payload as hostile | **Yes** | `apps/desktop/src/main/ipc.ts`, `shared/guards.ts` |
| 11 | The backend has no ambient authority | **Yes** | `broker.ts` |

Two things on that list are worth reading twice. Item 1's mobile half is
**structural, not proven**: `SecureStorePlugin` is in the built APK's dex, so
tokens have somewhere real to go, and no line of it has ever executed because
this host cannot run an Android emulator. Item 5's YouTube half is a compromise
Google forces on every desktop client, and the honest description is below
rather than a claim that no secret ships.

---

## 1. Token storage, per surface

The three surfaces store tokens differently because their threat models are
different. One module, `apps/web/src/state/tokens.ts`, decides which.

### Desktop

`window.livetap.vault`, which is Electron `safeStorage` on top of the OS
credential store: DPAPI on Windows, Keychain on macOS. Specifically:

- ciphertext only on disk, base64 inside a JSON file in `userData`;
- written **atomically** through a temp file, at mode `0o600`, so another local
  user cannot read the ciphertext at all;
- **refuses to store anything** when `isEncryptionAvailable()` is false, for
  example a Linux session with no keyring. It does not fall back to plaintext,
  and it does not pretend to have stored something it did not;
- keyed `oauth:<platform>:<accountId>`, so two accounts on one platform do not
  collide.

The renderer never reads a token back for display. `get` returns the value only
into the adapter call that needs it.

### Mobile

The same `VaultBridge` shape, registered by the native secure store
(`packages/capacitor-live-stream`, `SecureStorePlugin`, Android Keystore
backed). Identical TypeScript path; only what is behind `window.livetap.vault`
differs. **Never executed on a device.**

### Web

Memory, for the life of the page, and nothing else. No `localStorage`, no
`sessionStorage`, no IndexedDB, no cookie.

The reasoning is worth stating because it looks like a downgrade and is not.
Browser storage is readable by any script that ever runs on this origin,
including one that arrives through a dependency. Losing an access token on
reload costs the creator one tap. Leaking a refresh token costs them their
channel. The same trade is already made for stream keys, for the same reason,
and for Instagram, TikTok and X per-session is the only honest lifetime anyway
because those platforms issue a new key every broadcast.

### Stream keys, which are not tokens but are just as dangerous

`apps/web/src/state/secrets.ts` makes the same split: the OS vault on desktop,
an in-memory `Map` on web. A key is never rendered again after it is saved.

---

## 2. The OAuth flow

| Platform | Desktop | Web | Why |
|---|---|---|---|
| YouTube | authorization code + **PKCE S256**, loopback redirect on a random port | authorization code, secret server side | Google documents PKCE for installed apps. OOB is dead; custom schemes are deprecated |
| Twitch | **device code grant** | authorization code, secret server side | Twitch documents no PKCE anywhere. Authorization code from a binary would mean shipping a secret, and implicit returns no refresh token |
| Kick | authorization code + **mandatory PKCE**, exchange brokered | the same | Kick requires a client secret at the token endpoint and has no public-client mode |
| Facebook | loopback redirect, both exchanges server side | server-side code flow | the app secret never leaves the server |

**Implicit grant is not used anywhere, on any surface, for any platform.**

One flow, `beginAuth(platform)` in `apps/web/src/state/oauthFlow.ts`, serves all
three surfaces and branches only at the point where they genuinely differ: the
web navigates, the desktop opens a loopback listener and the system browser,
mobile opens an in-app browser and listens for the deep link.

---

## 3. Redirect URI policy

`isAllowedRedirectUri` in the broker is an allow-list with no escape hatch:

- a `livetap://` URI must equal `livetap://oauth/callback` **exactly**, not
  merely start with it;
- an `http:` URI is accepted **only** for `127.0.0.1`, `localhost` or `[::1]`.
  Literal addresses only, never a name DNS could move;
- an `https:` URI must match the deployment's own host, taken from
  `x-forwarded-host` where a custom domain sits in front of Vercel;
- everything else is refused.

Kick is the one place where the loopback spelling matters: its front end
rewrites the first `127.0.0.1` it finds in an authorize URL, so Kick redirects
must be registered and sent as `localhost`. That is a platform quirk, recorded
in `packages/adapters/src/oauth/endpoints.ts`, not a weakening of this rule.

---

## 4. `state`, and why there is no `nonce`

`state` is generated per attempt, stored alongside the PKCE verifier under
`livetap.oauth.pending`, and verified on the way back. A callback whose state
does not match is refused before the code is touched.

On desktop the **main process** generates the state, because the main process
is what checks it: the loopback listener refuses any callback whose state does
not match its own. The renderer uses the value the main process returns
(`LoopbackInfo.state`) rather than generating a second one, which is the
two-state collision this seam exists to prevent.

**`nonce` is not used, and should not be.** A nonce binds an ID token to a
request and is an OpenID Connect concept. LIVETAP does not consume ID tokens:
it uses authorization code + PKCE for access to a streaming API, and the
account identity comes from an authenticated API call, not from a JWT. Adding a
nonce would be ceremony with nothing behind it.

---

## 5. Secret handling

| Secret | Where it lives | Does it ship in a binary |
|---|---|---|
| `LIVETAP_KICK_CLIENT_SECRET` | broker environment | **no** |
| `LIVETAP_FACEBOOK_APP_SECRET` | broker environment | **no** |
| `LIVETAP_FACEBOOK_CLIENT_TOKEN` | broker environment | **no** |
| `LIVETAP_YOUTUBE_CLIENT_SECRET` | broker environment for web | **on desktop, yes, obfuscated** |
| Twitch | there is none | Twitch desktop uses device code, so no secret is created |

The YouTube desktop case needs saying plainly rather than hiding. Google issues
a client secret even for Desktop app clients, and there is no public-client mode
that omits it. Every desktop OAuth client in the world is in this position.
What actually protects the exchange is PKCE: an attacker with the obfuscated
secret still cannot exchange an intercepted authorization code without the
verifier, which never leaves the process that generated it. The secret is
obfuscated rather than printed, and it is **not** described anywhere in the
product or the docs as confidential.

Public client ids are served to every surface by `GET /api/oauth/config`, which
returns `{ configured, clientId }` per platform and **never a secret**.

---

## 6. Logging: no credential can reach a log line

This is the item that used to be a promise and is now a test.

Two redaction helpers exist. `redactSecrets` in `packages/core` is the engine's
last line of defence; `redact` in `packages/adapters/src/real/http.ts` is the
HTTP layer's. Both mask bearer tokens, the RTMP stream key path segment, URL
userinfo, and a long list of credential-bearing query and form fields.

They exist because the 2026-09 review (SEC-D3) found **two real leaks in one
file**: the FFmpeg argv was logged verbatim at `info` and the sender argv's
last element is `rtmp://host/app/<STREAM KEY>`, and FFmpeg's own stderr was
logged verbatim and it echoes the full publish URL in most connection failures.
Both wrote a live stream key into `main.log` on disk on every broadcast.

`infra/dev-harness/broadcast/secret-log.test.mjs` runs under `npm test` and
asks three questions:

1. **The corpus.** Ten realistic carriers, each holding a realistically shaped
   credential: a composed RTMP publish URL, an FFmpeg stderr line, an
   Authorization header, a token-endpoint body, a PKCE code exchange, an SRT
   passphrase, a WHIP query token, URL userinfo, and the FFmpeg WHIP muxer's
   `-authorization` flag. Each must be masked, and the result must still be
   long enough to be a diagnostic rather than a deletion.
2. **The drift.** Nineteen field names, asserted against **both** redactors.
   The HTTP redactor's own comment says the two lists must not disagree,
   because a reader who sees one of them let a value through cannot tell
   whether the other would have caught it. This makes them agree by
   construction.
3. **The call sites.** Every non-test `.ts`, `.tsx`, `.mjs` and `.cjs` file
   under `apps/`, `packages/` and `infra/` is scanned for a logging call whose
   arguments name something credential-bearing without a redactor wrapped
   around it. **267 files scanned, zero hits, 2026-09-14.** The detector is
   itself proven against the two SEC-D3 leaks before its silence is trusted, so
   a clean scan means the scan works rather than that the pattern quietly
   stopped matching.

**One known asymmetry, recorded rather than hidden.** The HTTP redactor does not
mask the `-authorization <token>` argv shape. That flag exists only in an
FFmpeg command line and never travels through the HTTP layer, so the engine
redactor owns it; the test assigns the responsibility explicitly rather than
leaving it to be discovered.

**What redaction is not.** It is a last line of defence, not a licence to pass
secrets around and clean them up later. Redact at the boundary, and still never
put a secret somewhere it does not belong.

---

## 7 and 8. Disconnect and revocation

`revokeTokens(platform)` does two things, **in this order**:

1. `POST {broker}/api/oauth/revoke`, which forwards to the platform's own
   revocation endpoint. Google, Twitch and Kick all publish one.
2. Delete the local copy from the vault.

The order matters. Deleting first and then failing to revoke would leave a live
token at the platform that LIVETAP can no longer even name, let alone
withdraw. The revoke is **best effort by design** and the local delete happens
regardless: a creator who presses Disconnect must end up disconnected locally
even when the platform is unreachable, and a revoke that failed is recoverable
from the platform's own security settings page, whereas an orphaned local token
is not.

**Facebook publishes no revocation endpoint.** Disconnecting Facebook deletes
the local token and cannot withdraw the grant; that has to be done in
Facebook's own app settings. The product should say so at the moment of
disconnect rather than implying a revocation that did not happen.

"Disconnect account" and "Remove destination" are deliberately separate
actions. Removing a destination is a layout decision; disconnecting an account
is a security one.

---

## 9. Browser storage

| Stored in the browser | What it is |
|---|---|
| `livetap.destinations` | destination configs **with the stream key stripped** |
| `livetap.oauth.pending` | the PKCE verifier and `state`, for the seconds between opening the platform's page and coming back |
| `livetap.onboarding`, `livetap.intent`, `livetap.mode`, `livetap.settings`, `livetap.moments` | preferences |

**Not stored in the browser, on any surface:** access tokens, refresh tokens,
stream keys, passphrases, client secrets.

The PKCE verifier is the one credential-shaped thing that touches storage, and
it has to: the browser navigates away to the platform and comes back to a fresh
page, so the verifier must survive that round trip. It is single use, it is
cleared on completion, and on its own it grants nothing.

One consequence the product must keep being honest about: because stream keys
are not persisted, a destination restored from a previous session comes back
needing its key again. The Destinations screen says exactly that ("is missing
something", "Paste a new key"). **The Studio screen currently says only "No
destination is ready" and offers "Add a destination"**, which points a returning
creator at the wrong action. That is a copy gap, not a security gap, and it is
recorded as a handoff.

---

## 10. IPC

The Electron renderer is a sandboxed web app. `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`,
`nodeIntegrationInSubFrames: false`, `webSecurity: true`. The renderer cannot
reach `require`, so an XSS in the renderer does not become code execution on
the machine.

Everything it can do goes through a narrow allow-listed preload bridge. Every
handler in `apps/desktop/src/main/ipc.ts` assumes its payload is hostile and
runs a hand-written guard from `shared/guards.ts` before touching it; a payload
that fails the guard is rejected with a generic error that says nothing about
why. Two examples of the pattern:

- `openExternal` is checked twice, by the guard for shape and https and by the
  policy for scheme and control characters, because it is the one call that
  hands a string to the operating system;
- recording paths are resolved and then **proved to still be inside the
  recordings directory**, so a traversal that survives the guard still cannot
  read anything else.

`will-navigate` and `setWindowOpenHandler` are both intercepted, and a CSP
header is injected on every response.

**A token never crosses IPC in the renderer's direction.** The vault bridge
returns a stream key only into the adapter call that needs it, and the engine
bridge carries encoded media chunks, never credentials.

---

## 11. Backend authorization

The token broker (`apps/web/api/`) has **no ambient authority**. There is no
cookie, no session and no server-side user. Every request must carry everything
it needs, and the broker's job is only to hold the client secret that a public
client cannot.

- **Same-origin only.** `Sec-Fetch-Site` must be `same-origin` or `none`, and
  when an `Origin` header is present its host must match the deployment's. A
  cross-site fetch is refused with 403 even if some future code path forgot a
  check.
- **Rate limited**, sharing one implementation with the early-access endpoint.
- **Input validated.** Unknown platform, malformed `codeVerifier` (it must
  match `[A-Za-z0-9._~-]{43,128}`), or a redirect URI outside the allow-list
  are all 400 before anything reaches a platform.
- **Never logs or persists a token.** The broker is a pass-through: it holds a
  secret and forwards an exchange. Nothing is stored.
- **`LIVETAP_OAUTH_BASE`**, which points every authorize, token and API URL at
  the local fake identity provider for testing, is **hard-refused when
  `NODE_ENV=production`**. A test seam that can be turned on in production is
  not a test seam.

---

## What this document does not claim

- That any of this has been observed against a real platform. It has not: there
  is no platform credential on this host. See
  `docs/qa/REAL_PLATFORM_TEST_MATRIX.md`.
- That the mobile secure store works. It has never been executed.
- That macOS Keychain behaves as Windows DPAPI does here. No Mac has run this.
- That the redaction regexes catch a credential shape nobody thought of. They
  catch the ten carriers and nineteen field names in the test, and they are a
  last line of defence rather than the first.
