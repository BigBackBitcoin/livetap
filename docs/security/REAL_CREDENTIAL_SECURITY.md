# Real credential security

**Re-verified 2026-09-15 by execution.** Written 2026-09-14, at the point where LIVETAP
stopped handling simulated credentials and started handling real ones: real OAuth access
tokens, real refresh tokens, real client secrets and real stream keys.

A stream key is a password for somebody's channel. A YouTube refresh token is a key to it.
Neither has any business being in a log file, a crash report, a diagnostics export, browser
storage, a React prop, a URL, or a screenshot. This document says where each one lives on
each surface, what protects it, and — item by item — **which guarantees hold today, which
do not, and what was actually run to find out.**

## How to read the labels

| Label | Means |
|---|---|
| **CONFIRMED** | a command was run on this host and its output is quoted or its test is named. A reader can re-run it. |
| **PLAUSIBLE** | derived from reading the code. Nobody executed it. A code reading is an opinion. |
| **OPEN** | a defect, with the file and line. Severity stated. Not fixed here: Team F writes tests and reports; the integrator fixes. |
| **UNPROVEN** | nobody has run it and nobody can on this host (no Mac, no phone, no real platform credential). |

**Related.** `docs/security/THREAT_MODEL.md` is the general model.
`docs/qa/SECURITY_REVIEW.md` is the 2026-09 review and its four release-blocking findings.
`infra/dev-harness/secret-scan/README.md` is the three commands that reproduce this page.

---

## The commands this page rests on

Everything labelled CONFIRMED below was produced by one of these, on this host, on
2026-09-15.

```
npx vitest run --config infra/dev-harness/broadcast/vitest.config.ts
    55 tests. 52 pass, 3 fail. The three failures are SEC-F17 and are a real defect.

npx vitest run --project desktop  src/main/oauth.security.test.ts     13 pass
npx vitest run --project desktop  src/main/ipc.security.test.ts       18 pass
npx vitest run --project adapters src/oauth/pkce.security.test.ts     13 pass
npx vitest run --project adapters src/oauth/scopes.security.test.ts   26 tests, 25 pass,
                                                                      1 fails (SEC-F18)
npx vitest run --project web src/state/credentialStorage.security.test.ts  13 pass

node infra/dev-harness/secret-scan/browser-storage-dump.mjs
    Drives the real production build in a real Chromium, pastes a stream key, dumps
    localStorage + sessionStorage + IndexedDB + Cache Storage + cookies.  PASS.

node node_modules/electron/cli.js infra/dev-harness/secret-scan/safestorage-probe.cjs
    PASS on win32 / Electron 44.3.0.

git rev-list --all --objects | ... | git cat-file --batch | grep -cF "$TOKEN"
    0 blobs in the entire object graph contain the live Vercel OIDC token.
```

---

## Summary: the owner's requirements, as of 2026-09-15

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Token storage, web | **CONFIRMED: holds** | `credentialStorage.security.test.ts` SEC-F13 + the browser dump |
| 1b | Token storage, desktop | **OPEN, HIGH — broken** | SEC-F15. The preload vault returns a shape the renderer does not consume |
| 1c | Token storage, mobile | **UNPROVEN** | the TypeScript bridge is right (SEC-F15 third case); the Kotlin behind it has never run |
| 2 | PKCE is S256, never `plain` | **CONFIRMED: holds** | `pkce.security.test.ts` SEC-F6 |
| 2b | PKCE cannot be silently dropped | **OPEN, MEDIUM** | SEC-F7. `buildAuthorizeUrl` omits PKCE rather than refusing. Not reachable from the product today |
| 2c | Verifier entropy | **CONFIRMED, with a note** | SEC-F8. ~386 bits. A measurable modulo bias exists and costs <0.01 bits/char |
| 3 | Redirect URI is an exact allow-list | **CONFIRMED: holds** | `broker.test.ts` + SEC-F1. The `isHttpsUrl` question is closed: see §3 |
| 4 | `state` is CSPRNG, verified, single-use | **CONFIRMED: holds, with one window** | SEC-F2, SEC-F3. The buffered-callback branch leaves a state reusable |
| 4b | `state` compared in constant time | **OPEN, LOW — it is not** | SEC-F4. `oauth.ts:148` uses `!==` |
| 5 | Client secrets never ship in a binary | **PLAUSIBLE** for Kick/Facebook/Twitch; **compromised by design** for YouTube desktop | §5 |
| 6 | No credential can reach a log line | **CONFIRMED for 256 shipped files**; one redactor gap **OPEN, MEDIUM** | SEC-F17 |
| 7 | Disconnect deletes the local credential | **CONFIRMED** | `oauthCallback.test.ts` "disconnect" |
| 8 | Disconnect revokes at the platform | **CONFIRMED (best effort)**; Facebook has no RFC 7009 endpoint | same |
| 9 | Nothing secret in browser storage | **CONFIRMED by a real browser** | the storage dump |
| 10 | IPC is allow-listed, every payload hostile | **CONFIRMED** | `ipc.security.test.ts` SEC-F10, SEC-F11 |
| 10b | "a token never crosses IPC to the renderer" | **was FALSE; corrected** | SEC-F12. It does, by design. See §10 |
| 11 | The backend has no ambient authority | **PLAUSIBLE** (unit tested, never deployed with real secrets) | `broker.test.ts` |
| 12 | Scopes are minimal | **CONFIRMED for 3 of 4 platforms**; Kick asks for one it cannot use | SEC-F18 |
| 13 | The one live secret on this disk is not in git | **CONFIRMED** | §12 |

---

## 1. Token storage, per surface

One module, `apps/web/src/state/tokens.ts`, decides which store each surface uses.

### Web — CONFIRMED

Memory, for the life of the page, and nothing else. No `localStorage`, no `sessionStorage`,
no IndexedDB, no cookie.

`apps/web/src/state/credentialStorage.security.test.ts` SEC-F13 saves a `ya29.`-shaped
access token and a `1//04`-shaped refresh token through the real `saveTokens`, reads them
back to prove something really was stored, then enumerates every key and value in
`localStorage` and `sessionStorage` plus `document.cookie` and asserts neither value is in
any of them. The stores come back empty.

The reasoning looks like a downgrade and is not. Browser storage is readable by any script
that ever runs on this origin, including one that arrives through a dependency. Losing an
access token on reload costs the creator one tap. Leaking a refresh token costs them their
channel. Instagram, TikTok and X issue a new stream key per broadcast anyway, so per-session
is the only honest lifetime there regardless.

### Desktop — OPEN, HIGH. This does not work today

> **SEC-F15. The vault bridge is not the shape the renderer consumes.**
>
> `apps/desktop/src/preload/index.ts:116-125` exposes
> `vault.get(id): Promise<VaultResult>` — an object, `{ ok, secret?, reason? }`.
> `apps/web/src/state/secrets.ts:21-25` declares, and `apps/web/src/state/tokens.ts:58`
> consumes, `VaultBridge.get(id): Promise<string | undefined>` — a bare string.
>
> Nothing adapts one to the other.
>
> **Consequences, executed rather than reasoned** (SEC-F15 in
> `apps/web/src/state/credentialStorage.security.test.ts`):
> - `readTokens()` receives `{ ok: true, secret: '…' }`, which is truthy, hands it to
>   `JSON.parse`, which throws on `"[object Object]"`, which the `catch` at `tokens.ts:95`
>   swallows and returns `undefined`. **A desktop OAuth sign-in can never be read back.**
>   Every call to `tokenProviderFor` therefore throws "LIVETAP is not signed in".
> - `readStreamKey()` returns the wrapper object. `String(it)` is `'[object Object]'`.
>
> **Why `tsc -b` is clean over it:** both consumers reach `window.livetap` through a cast
> (`secrets.ts:32`, `tokens.ts:59`), so TypeScript never compares the two declarations.
>
> **Why nobody noticed:** the Android bridge gets it RIGHT —
> `packages/capacitor-live-stream/src/secureStore.ts:68-71` unwraps `result.value` and
> returns `string | undefined`. The only surface with the wrong shape is the only surface
> nobody has yet run a real sign-in on.
>
> **The fix is one adapter**, in the preload or in `secrets.ts`. Team F does not own either
> file. The test that proves it is written and green-as-a-documentation-of-the-defect.

What is *correct* about the desktop vault, independently CONFIRMED:

- `apps/desktop/src/main/vault.ts` writes **ciphertext only**, base64 inside a JSON file in
  `userData`, **atomically** (temp + rename) at mode `0o600` — `vault.test.ts` asserts the
  plaintext is never on disk, and that no temp file is left behind.
- It **refuses to store anything** when `isEncryptionAvailable()` is false. No plaintext
  fallback, no hardcoded key. `vault.test.ts` "refuses everything when OS encryption is
  unavailable, rather than falling back to plaintext".
- On **this host**, encryption is genuinely available and genuinely encrypts —
  `node node_modules/electron/cli.js infra/dev-harness/secret-scan/safestorage-probe.cjs`:

  ```
  { "platform": "win32", "electron": "44.3.0",
    "isEncryptionAvailable": true,
    "backend": "n/a (not Linux; Windows uses DPAPI, macOS uses Keychain)",
    "cipherIsBuffer": true, "cipherBytes": 65,
    "cipherContainsPlaintext": false, "roundTripEqualsPlaintext": true }
  PASS
  ```

  On Linux with no keyring this returns false, and the vault correctly refuses. Which leads
  directly to the second finding:

> **SEC-F16, OPEN, MEDIUM. A refused vault write is silent, and the secret is lost.**
>
> `SecretVault.set` returns `{ ok: false, reason: 'ENCRYPTION_UNAVAILABLE' }`. Neither
> caller looks:
> - `apps/web/src/state/secrets.ts:41-44` awaits `vault.set(...)` and **returns**, skipping
>   the in-memory fallback. The key is now nowhere.
> - `apps/web/src/state/tokens.ts:79-83` does the same for a token set.
> - `apps/web/src/state/secrets.ts:60-62` `hasStreamKey()` answers **`true` whenever a vault
>   exists**, without asking whether anything is in it.
>
> On a Linux desktop with no keyring the creator pastes a key, sees no error, and the app
> believes it has one. That is the "claims READY when it is not" family the project's own
> rules forbid. And it is worse than a missing key: `readStreamKey` returns the truthy
> error object, so `if (key)` in any caller is satisfied by a failure.
>
> Executed as SEC-F16 in `credentialStorage.security.test.ts`.

**Key naming, corrected.** The previous version of this document said vault entries are
keyed `oauth:<platform>:<accountId>`. They are not: `tokens.ts:71-73` keys them
`oauth:<platform>`, one account per platform, and the file says why.

### Mobile — UNPROVEN

`packages/capacitor-live-stream/src/secureStore.ts` installs the right bridge shape (proven
by SEC-F15's third case, which drives the mobile shape and shows the round trip works). The
Kotlin `SecureStorePlugin` behind it compiles into the dex and **has never executed**; no
Android device or emulator exists on this host.

### Stream keys

`apps/web/src/state/secrets.ts` makes the same split. Web: an in-memory `Map`. Desktop:
the vault (subject to SEC-F15/SEC-F16 above). A key is never rendered again after it is
saved — only `keyTail()`, four characters.

---

## 2. The OAuth flow

| Platform | Desktop | Web | Why |
|---|---|---|---|
| YouTube | authorization code + **PKCE S256**, loopback redirect on an ephemeral port | authorization code, secret server side | Google documents PKCE for installed apps. OOB is dead; custom schemes are deprecated |
| Twitch | **device code grant** | authorization code, secret server side | Twitch documents no PKCE anywhere |
| Kick | authorization code + **mandatory PKCE**, exchange brokered | the same | Kick requires a client secret at the token endpoint and has no public-client mode |
| Facebook | loopback redirect, both exchanges server side | server-side code flow | the app secret never leaves the server |

**Implicit grant is not used anywhere, on any surface, for any platform.** CONFIRMED:
SEC-F6 asserts `response_type=code` and the absence of `token` in every authorize URL this
repo can build, for every PKCE platform.

### PKCE — CONFIRMED

`packages/adapters/src/oauth/pkce.security.test.ts`:

- `codeChallengeMethod` is the literal `'S256'` and the type is the literal union `'S256'`.
  There is no `plain` member of `ChallengeEncoding`; the two members are the two digest
  **encodings** (`base64url`, and `hex` for TikTok's documented deviation), not two methods.
- The digest is really SHA-256: the test includes RFC 7636 §4.6's own vector.
- No authorize URL this repo can build contains the string `plain`.
- The verifier never appears in an authorize URL; only its digest does.
- 64 characters over the RFC's unreserved alphabet, never repeating across 500 draws.

> **SEC-F7, OPEN, MEDIUM. PKCE can be silently DROPPED.**
>
> `packages/adapters/src/oauth/index.ts:37`:
> `const usePkce = config.pkce !== 'none' && Boolean(input.codeChallenge);`
> When `codeChallenge` is absent, `buildAuthorizeUrl` emits a URL with **no**
> `code_challenge` at all rather than refusing. For Kick and TikTok, which document PKCE as
> mandatory, that is the authorization-code-interception attack PKCE exists to stop.
>
> It is **not reachable from the product today**: `apps/web/src/state/oauthFlow.ts:166`
> always generates a pair when `config.pkce !== 'none'`, and SEC-F7's second test pins that.
> It is one refactor away from being reachable, and a silent omission is the worst shape
> for that to take.
>
> **Fix:** throw in `buildAuthorizeUrl` when `config.pkce !== 'none'` and no challenge was
> supplied.

> **SEC-F8a, OPEN, INFORMATIONAL. A real but negligible modulo bias.**
>
> `packages/adapters/src/oauth/pkce.ts:41` maps a uniform byte through
> `byte % VERIFIER_ALPHABET.length`. The alphabet is RFC 7636's full unreserved set — **66**
> characters — and 256 = 3×66 + 58, so 58 symbols are drawn at 4/256 and 8 at 3/256.
>
> Measured, not asserted: the entropy cost is **under 0.01 bits per character**. A
> 64-character verifier still carries ~386 bits against RFC 7636 §7.1's 256-bit
> recommendation. Fix it with rejection sampling or a 64-symbol alphabet when convenient.
> This is a tidiness item, not a reason to delay connecting an account.

### Where the verifier goes

- **Desktop**: generated in the renderer, held in a local `const` for the length of
  `beginAuth`, posted once to `{broker}/api/oauth/token`, never persisted. CONFIRMED by
  `oauthCallback.test.ts` "beginAuth on desktop".
- **Web**: written to `sessionStorage` under `livetap.oauth.pending`, because the browser
  navigates away to the platform and comes back to a fresh page. It cannot be avoided; see
  §9. Cleared before the exchange (`oauthFlow.ts:293`), so a page refresh cannot replay it.
- It is sent to LIVETAP's own broker, not directly to the platform, because the brokered
  platforms all require a client secret at the token endpoint. The broker forwards it and
  keeps nothing (`broker.ts` `exchangeCode`).

---

## 3. Redirect validation — and the `isHttpsUrl` question, closed

**The HANDOFF question was: is `isHttpsUrl` rejecting `http://127.0.0.1`, which RFC 8252
requires for a native app? Answer: it rejects it, and that is correct, because it never
sees one. Desktop OAuth is not broken by this.** CONFIRMED, SEC-F1.

The reasoning, with the evidence:

1. `isHttpsUrl` (`apps/desktop/src/shared/guards.ts:101`) has exactly **one** consumer:
   `oauth:openExternal` at `apps/desktop/src/main/ipc.ts:172`. A repo-wide grep finds no
   other. The test re-asserts it.
2. `openExternal`'s argument is the **platform's authorize URL**, which is https. The
   loopback redirect rides inside it as a `redirect_uri` query parameter, url-encoded, and
   comes out the other side byte-identical.
3. The loopback `redirect_uri` is minted by the **main process** in
   `LoopbackOAuthServer.start()` and returned as `LoopbackInfo.redirectUri`. It is never
   submitted back over IPC and never validated as an openable URL.

SEC-F1 runs the real class and asserts `start()` returns exactly
`http://127.0.0.1:<ephemeral>/callback`, that a real callback on that socket is accepted end
to end, and that the same string is rejected by `isHttpsUrl` and by `isExternallyOpenable`
while the https authorize URL carrying it passes both.

### The broker's allow-list — CONFIRMED

`isAllowedRedirectUri` in `apps/web/api/_lib/broker.ts:228` is an allow-list with no escape
hatch:

- a `livetap://` URI must equal `livetap://oauth/callback` **exactly**, not merely start
  with it;
- an `http:` URI is accepted **only** for `127.0.0.1`, `localhost` or `[::1]`. Literal
  addresses only, never a name DNS could move;
- an `https:` URI must match the deployment's own host, taken from `x-forwarded-host` where
  a custom domain sits in front of Vercel;
- everything else is refused.

Kick is the one place the loopback **spelling** matters: its front end rewrites the first
`127.0.0.1` it finds in an authorize URL, so Kick redirects are registered and sent as
`localhost`. Recorded at `packages/adapters/src/oauth/endpoints.ts:124`. The socket is bound
to the literal loopback IP either way — SEC-F1 proves that by hitting `127.0.0.1` on a
listener whose redirect says `localhost`.

---

## 4. `state`, and why there is no `nonce`

### CONFIRMED

- **CSPRNG.** `randomBytes(32).toString('base64url')` — 256 bits. SEC-F2 starts 200 real
  listeners, asserts every state matches `^[A-Za-z0-9_-]{43}$`, asserts all 200 differ, and
  asserts over 4,300 characters that more than 50 of the 64 base64url symbols appear and
  none takes more than 5% of the draw. A counter, a timestamp or `Math.random` would not
  look like that.
- **Verified.** A callback with a mismatched state gets 400 and nothing reaches the
  renderer; a callback with no state at all gets 400. SEC-F3.
- **Owned by main.** On desktop the main process generates the state, because the main
  process is what checks it. The renderer uses `LoopbackInfo.state` rather than generating a
  second one — `oauthCallback.test.ts` "uses the state the main process generated".
- **Single-use in the normal path.** Once `waitForCallback` has taken a callback, `stop()`
  closes the socket, and SEC-F3's replay test gets a connection refusal.

> **SEC-F3a, OPEN, LOW. One window where a state is reusable.**
>
> If a callback arrives **before** the renderer called `waitForCallback`,
> `apps/desktop/src/main/oauth.ts:174-176` buffers it and does **not** call `stop()`. The
> listener stays up, on the same port, with the same state. SEC-F3 drives exactly that and
> shows the **second** authorization code overwrites the first and is the one the renderer
> ultimately exchanges.
>
> Reaching it needs the 256-bit state, so this is hardening, not a live hole. But the class
> comment says "single-use" and in that branch it is not.

> **SEC-F4, OPEN, LOW. The state comparison is not constant time.**
>
> `apps/desktop/src/main/oauth.ts:148` is `state !== this.state`, which short-circuits at
> the first differing character. RFC 8252's documented attacker is a hostile process on the
> same machine, and that process can hit the loopback listener as often as it likes inside
> the five-minute window. `node:crypto.timingSafeEqual` is already used in this repo
> (`infra/dev-harness/fake-idp/fake-idp.mjs`), so the fix is a one-line import plus a
> length check.
>
> SEC-F4 does not try to *measure* a timing difference — a timing assertion on a CI box is a
> flaky test, not evidence. It pins the property that makes the channel exist: every
> rejection is byte-identical on the wire, so the only thing that distinguishes a near miss
> from a far miss is the clock.

The web-side comparison in `oauthFlow.ts:241` is also `!==`, and there it does not matter:
both sides of that comparison are already in the attacker-visible page.

### `nonce` is not used, and should not be

A nonce binds an ID token to a request and is an OpenID Connect concept. LIVETAP does not
consume ID tokens: it uses authorization code + PKCE for access to a streaming API, and the
account identity comes from an authenticated API call, not from a JWT. Adding a nonce would
be ceremony with nothing behind it. **PLAUSIBLE** — this is an argument, not a measurement,
and it is the right one.

---

## 5. Client secrets

| Secret | Where it lives | Does it ship in a binary |
|---|---|---|
| `LIVETAP_KICK_CLIENT_SECRET` | broker environment | **no** |
| `LIVETAP_FACEBOOK_APP_SECRET` | broker environment | **no** |
| `LIVETAP_FACEBOOK_CLIENT_TOKEN` | broker environment | **no** |
| `LIVETAP_YOUTUBE_CLIENT_SECRET` | broker environment for web | **on desktop, yes, obfuscated** |
| Twitch | there is none | Twitch desktop uses the device code grant, so no secret is created |

All **PLAUSIBLE**: no deployment on this host has ever held a real value for any of them,
so nothing here has been observed. What *is* CONFIRMED is the structure: `broker.ts`
`credentials()` is the only function that reads a `*_CLIENT_SECRET` variable, and
`GET /api/oauth/config` returns `{ configured, clientId }` and never a secret
(`configuredPlatforms`, `broker.ts:152`).

The YouTube desktop case needs saying plainly rather than hiding. Google issues a client
secret even for Desktop app clients and offers no public-client mode that omits it. Every
desktop OAuth client in the world is in this position. What actually protects the exchange
is PKCE: an attacker holding the obfuscated secret still cannot exchange an intercepted
authorization code without the verifier. The secret is obfuscated rather than printed, and
it is **not** described anywhere in the product as confidential.

`LIVETAP_OAUTH_BASE` — the seam that points every authorize, token and API URL at the local
fake identity provider — is **hard-refused when `NODE_ENV=production`** (`broker.ts:116`),
and refused for any scheme but `http:` on a loopback host. A test seam that can be switched
on in production is not a test seam.

---

## 6. Logging: no credential can reach a log line

This item used to be a promise. It is now 55 assertions in
`infra/dev-harness/broadcast/secret-log.test.mjs`, which runs under `npm test`.

Two redaction helpers exist. `redactSecrets` in
`packages/core/src/validation/ingest.ts:74` is the desktop engine's last line of defence —
the thing standing between `main.log` and an ffmpeg argv. `redact` in
`packages/adapters/src/real/http.ts:70` is the HTTP layer's — the thing standing between an
error toast and a platform API response.

They exist because the 2026-09 review (SEC-D3) found **two real leaks in one file**: the
FFmpeg argv was logged verbatim at `info` and the sender argv's last element is
`rtmp://host/app/<STREAM KEY>`, and FFmpeg's own stderr was logged verbatim and it echoes
the full publish URL on most connection failures. Both wrote a live stream key into
`main.log` on disk on every broadcast.

The suite asks four questions:

1. **The corpus.** Ten realistic carriers, each holding a realistically shaped credential: a
   composed RTMP publish URL, an FFmpeg stderr line, an Authorization header, a
   token-endpoint body, a PKCE code exchange, an SRT passphrase, a WHIP query token, URL
   userinfo, and the FFmpeg WHIP muxer's `-authorization` flag. Each must be masked, and the
   result must still be long enough to be a diagnostic rather than a deletion.
2. **The drift.** Nineteen field names, asserted against **both** redactors.
3. **The call sites.** Every non-test `.ts`, `.tsx`, `.mjs` and `.cjs` file under `apps/`,
   `packages/` and `infra/` is scanned for a logging call whose arguments name something
   credential-bearing without a redactor wrapped around it. **256 files scanned, zero hits,
   2026-09-15.** The detector is itself proven against the two SEC-D3 leaks before its
   silence is trusted, so a clean scan means the scan works rather than that the pattern
   quietly stopped matching. (It earns its keep: it caught a `console.log` in Team F's own
   new harness script during this pass.)
4. **Ownership** — new on 2026-09-15, and the answer to HANDOFF item 4.

### The ownership decision

The two redactors guard different doors, so they do not need identical rule sets. They need
identical rule sets **for the shapes that can reach them**.

- `redactSecrets` guards the **log file**. Everything the desktop engine writes goes through
  it. It therefore owns every shape that can appear in an **ffmpeg command line or in
  ffmpeg's output** — which is a superset of what travels over HTTP, because ffmpeg also
  speaks rtmp, rtmps, rtsp, srt and whip-over-https.
- `redact` guards an **HTTP error message**: platform API URLs, response bodies, status
  text. It owns what can appear there.

Applying that to the two asymmetries:

**Asymmetry 1 — `-authorization <token>`.** The ffmpeg WHIP muxer's flag, and nothing else.
Argv only. **`packages/core` owns it; `packages/adapters` does not need it.** The
integrator changes **nothing**. This confirms what HANDOFF item 4 guessed, and it is now a
decision with a test under it, including a scan proving `redact` has only two call sites
and neither can be handed an argv.

**Asymmetry 2 — URL userinfo. This one was not recorded, and it is the one that matters.**

> **SEC-F17, OPEN, MEDIUM. `packages/core` masks userinfo for `rtsp` only.**
>
> `packages/core/src/validation/ingest.ts:80`:
> `.replace(/(rtsps?:\/\/)[^\s@|'"]*@/gi, '$1' + MASK + '@')`
>
> `packages/adapters/src/real/http.ts:79` covers `rtsp`, `srt`, `http`, `https`, `ws` and
> `wss`.
>
> So the module with the **wider** exposure has the **narrower** rule. A WHIP target is an
> https URL that ffmpeg receives as an argv element; an SRT target can carry userinfo too.
> Both are exactly the log file's problem, and `redactSecrets` lets both through today.
>
> Executed. Three tests in `secret-log.test.mjs` are **failing on purpose** rather than
> being softened:
> ```
> × packages/core MUST mask https userinfo … — it does not today
> × packages/core MUST mask srt userinfo — it does not today
> × packages/core MUST mask wss userinfo … — it does not today
> ```
>
> **The fix, for the integrator: widen that one regex in `packages/core` to the scheme set
> `packages/adapters` already uses.** Nothing else changes; `redact` is correct as it stands.

**What redaction is not.** A last line of defence, not a licence to pass secrets around and
clean them up later. Redact at the boundary, and still never put a secret somewhere it does
not belong.

---

## 7 and 8. Disconnect and revocation — CONFIRMED

`revokeTokens(platform)` does two things, **in this order** (`tokens.ts:248`):

1. `POST {broker}/api/oauth/revoke`, which forwards to the platform's own revocation
   endpoint. Google, Twitch and Kick all publish one.
2. Delete the local copy from the vault.

The order matters. Deleting first and then failing to revoke would leave a live token at the
platform that LIVETAP can no longer even name, let alone withdraw. The revoke is **best
effort by design** and the local delete happens regardless: a creator who presses Disconnect
must end up disconnected locally even when the platform is unreachable, and a failed revoke
is recoverable from the platform's own security settings page whereas an orphaned local
token is not.

`apps/web/src/__tests__/oauthCallback.test.ts` "disconnect" runs both halves, including the
network-failure path. Revoking sends the **refresh** token where one exists, because
revoking only the access token would leave the refresh token able to mint another
(`tokens.ts:261`).

**Facebook publishes no RFC 7009 revocation endpoint.** `DELETE /me/permissions` is its
documented equivalent and the broker uses it (`broker.ts` `revokeStyle:
'delete-permissions'`). Whether it behaves as expected is **UNPROVEN** — no real Facebook
app has been connected.

Refresh is CONFIRMED too, against a fake broker: renewal inside the margin, no renewal for a
token comfortably alive, and — the one that silently breaks products — **persisting the
rotated refresh token**, because Twitch device-code and Kick refresh tokens are single use.

"Disconnect account" and "Remove destination" are deliberately separate actions. Removing a
destination is a layout decision; disconnecting an account is a security one.

---

## 9. Browser storage — CONFIRMED by a real browser

`node infra/dev-harness/secret-scan/browser-storage-dump.mjs` builds nothing and fakes
nothing: it serves `apps/web/dist` through the same preview server the E2E uses, drives a
real Chromium down the golden path, pastes a Twitch-shaped canary key into a Custom RTMP
destination, waits for the card to appear, and then enumerates **localStorage,
sessionStorage, `document.cookie`, every IndexedDB database and object store, and every
Cache Storage entry and body.**

Output, 2026-09-15:

```
  localStorage  livetap.destinations
  localStorage  livetap.intent
  localStorage  livetap.onboarding
  localStorage  livetap.moments
  localStorage  livetap.settings

  livetap.destinations, in full:
    [{"id":"youtube-1-…","platform":"youtube",…,"ingest":{"protocol":"rtmp","url":"rtmp://mock.youtube.livetap.invalid/live"}},
     {"id":"custom-2-…","platform":"custom","label":"Secret scan target",…,"ingest":{"protocol":"rtmp","url":"rtmp://ingest.example.invalid/app"}}]

PASS  no stream key, no token and no secret field name in any web store.
```

The persisted destination carries its **ingest URL and no `streamKey` field at all**. The
script also fails if it never reached the paste step, because a clean dump of a store
nothing was put into proves nothing.

| Stored in the browser | What it is |
|---|---|
| `livetap.destinations` | destination configs, stream key absent entirely |
| `livetap.oauth.pending` | the PKCE verifier and `state`, in **sessionStorage**, for the seconds between leaving for the platform and coming back |
| `livetap.onboarding`, `livetap.intent`, `livetap.mode`, `livetap.settings`, `livetap.moments`, `livetap.theme`, `livetap.realBroadcastAck` | preferences |
| `livetap.wasLive` | sessionStorage. A boolean, so a reload can say the broadcast ended |

**Not stored in the browser, on any surface:** access tokens, refresh tokens, stream keys,
passphrases, client secrets.

The PKCE verifier is the one credential-shaped thing that touches storage, and it has to:
the browser navigates away and comes back to a fresh page. SEC-F14 asserts it is in
`sessionStorage` and **not** `localStorage` — the distinction is the whole mitigation — that
it is cleared on completion, and that on its own it grants nothing.

One consequence the product must keep being honest about: because stream keys are not
persisted on web, a destination restored from a previous session comes back needing its key.
The Destinations screen says exactly that. The Studio screen still says only "No destination
is ready" and offers "Add a destination", pointing a returning creator at the wrong action.
Copy gap, not a security gap; recorded as HANDOFF item 3.

---

## 10. IPC — CONFIRMED, with one correction

The Electron renderer is a sandboxed web app. `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`, `nodeIntegrationInWorker: false`,
`nodeIntegrationInSubFrames: false`, `webSecurity: true`. The renderer cannot reach
`require`, so an XSS in the renderer is an XSS, not a remote shell.

`apps/desktop/src/main/ipc.security.test.ts` registers the real handlers against a fake
`ipcMain` and asserts:

- **Exactly 22 channels**, enumerated by name in the test. A twenty-third fails it.
- **No generic `invoke`.** Every channel name is a baked-in `CH.*` constant; the preload is
  read as text and every `ipcRenderer.invoke/send/on/off` argument is proven to be a
  constant rather than a parameter. There is no `invoke(channel, payload)` signature.
- **Every channel refuses a `webContents` that is not the app window.**
- **Every payload-taking channel rejects garbage** — `undefined`, `null`, numbers, booleans,
  arrays, prototype-polluting keys — and every structured channel rejects a wrong-shaped
  object, and every id channel rejects an id outside `^[A-Za-z0-9_:-]{1,128}$`.
- **A prototype-pollution payload is refused, not sanitised**, including the parsed-JSON
  shape that leaves a real own `__proto__` key.
- **Rejections never echo the input**, so an error toast cannot become an exfiltration
  channel.
- `openExternal` refuses `http:`, `file:`, `javascript:`, `data:`, `ms-msdt:`, `smb:`,
  `livetap:` and a CRLF-injected https URL.
- The renderer **cannot choose where a recording is written** — main overwrites the
  directory with its own — and `system.openPath` cannot escape the recordings directory,
  including via an NTFS alternate data stream (`recording.mp4:payload.exe`).
- The renderer **cannot ask the loopback listener to bind an arbitrary host**: main
  re-validates and collapses anything that is not `'localhost'` to `'127.0.0.1'`.

### The correction

The previous version of this document said: *"A token never crosses IPC in the renderer's
direction."* **That was false.** SEC-F12 executes it: `livetap:vault:get` returns
`{ ok: true, secret }` to the renderer (`apps/desktop/src/main/ipc.ts:147-150`), and
`livetap:vault:list` enumerates the ids of everything stored.

It is that way **by design**, and the design is defensible: the platform adapters run in the
renderer, so the renderer is what builds an ingest target and what sets an `Authorization`
header. Moving the secret behind the boundary means moving the whole adapter layer into
main — a real architectural option, and not a small one.

What it means for the threat model, stated rather than hidden: **an XSS in the renderer can
read every stored secret by id, and can list the ids.** The mitigations are the ones that
stop the XSS — `script-src 'self'` with no `unsafe-inline` and no `unsafe-eval`,
contextIsolation, sandbox, no nodeIntegration, a navigation allow-list, and a CSP header
injected by main on every response rather than a meta tag — not a boundary inside the vault.

The ids themselves are charset-restricted, so a stored id cannot become a path traversal or
a log injection. CONFIRMED.

---

## 11. Backend authorization — PLAUSIBLE

The token broker (`apps/web/api/`) has **no ambient authority**. No cookie, no session, no
server-side user. Every request carries everything it needs, and the broker's only job is
holding the client secret a public client cannot.

- **Same-origin only.** `Sec-Fetch-Site` must be `same-origin` or `none`, and when `Origin`
  is present its host must match the deployment's. A missing `Origin` is allowed because the
  desktop app has no web origin — and that is safe because there is nothing for CSRF to
  steal: a forged cross-site request would be the attacker exchanging the attacker's own
  authorization code.
- **Rate limited** — and honestly labelled in its own source as a per-instance, in-memory
  bucket that is **not** a distributed rate limit. Tracked as SEC-W3.
- **Input validated.** Unknown platform, a `codeVerifier` outside `[A-Za-z0-9._~-]{43,128}`,
  or a redirect URI outside the allow-list are all 400 before anything reaches a platform.
- **Never logs or persists a token.** `postToken`'s error path explicitly builds its message
  from `error_description` and never the token or code, and truncates to 300 characters.

All unit-tested (`apps/web/api/_lib/broker.test.ts`) and **never deployed with a real
secret**, which is why the label is PLAUSIBLE rather than CONFIRMED.

> **SEC-F21, OPEN, LOW. The device endpoint takes caller-chosen scopes.**
>
> `apps/web/api/oauth/device.ts:39-42` accepts any array of up to 32 strings as `scopes` and
> forwards them to Twitch under this deployment's `client_id`. A caller who sends no
> `Origin` (curl, the desktop app) reaches it.
>
> Severity is LOW because the client id is **already public** — `GET /api/oauth/config`
> returns it by design — and Twitch's device endpoint needs no secret, so an attacker can run
> the same flow directly against Twitch without LIVETAP. It buys them nothing they do not
> have. It is still worth pinning the scope set server-side to
> `PLATFORM_OAUTH[platform].defaultScopes`, so the deployment cannot be used to render a
> consent screen asking for more than LIVETAP ever asks for.

---

## 12. The one live secret on this disk — CONFIRMED absent from git

`apps/web/.env.local` holds a **real Vercel OIDC token**. It is the only live credential on
this machine. Its value is not printed in this document, in any test, in any report, or
anywhere else.

What was verified, and how:

| Check | Command | Result |
|---|---|---|
| Not tracked | `git ls-files --error-unmatch apps/web/.env.local` | `did not match any file(s) known to git` |
| Ignored, and by which rule | `git check-ignore -v apps/web/.env.local` | `apps/web/.gitignore:2:.env*` |
| No history for the path | `git log --all -- apps/web/.env.local` | empty |
| No `.env`-shaped file **ever** added, on any ref | `git log --all --diff-filter=A --name-only` | only `apps/web/.env.example` and `infra/relay/.env.example` |
| **The value is in no git object at all** | every blob in `git rev-list --all --objects` piped through `git cat-file --batch \| grep -cF "$TOKEN"` | **0** |
| Not in any build output | `grep -rlF "$TOKEN"` over `apps/web/dist`, `apps/web/.vercel`, `apps/desktop/dist`, `apps/desktop/release`, `apps/mobile/www`, `apps/web/public`, `docs`, `infra` | **0 files each** |
| Refs checked | `git for-each-ref` | `refs/heads/main`, `refs/remotes/origin/{HEAD,main,dependabot/…}` |

The blob scan is the one that matters: it walks the entire object graph, not just reachable
commits for one path, so a file added and removed under a different name would still be
found.

### What the owner must still do

1. **Treat that token as live and rotate it when convenient.** It was generated by
   `vercel` tooling for local development. Nothing in this repo has leaked it, but a token
   sitting in a working directory on a build host is a token with a longer life than it
   needs. Rotation is `vercel env pull` again, or deleting the file when local Vercel
   development is not in progress.
2. **Never `vercel build` with that file where the output is committed.** Confirmed clean
   today; the `.gitignore` rule is `.env*` and covers it, but the habit is what keeps it
   true.
3. **Real platform secrets go in the Vercel project's environment variables, not in a
   file.** `docs/OWNER_ACTIONS.md` has the list, in order.
4. **Before the first real connect**, decide SEC-F15 (below) — a desktop sign-in cannot
   currently survive, so the first real account should be connected on the web surface or
   after the integrator has landed the fix.

---

## 13. Scope minimisation

`packages/adapters/src/oauth/scopes.security.test.ts` matches every scope LIVETAP requests
against a call site in the shipped adapter that needs it. The mechanism is a grep of the
adapter source, not a hand-maintained claim, so a scope that loses its last caller becomes a
test failure.

### YouTube — minimal. CONFIRMED

| Scope | Gates | Used |
|---|---|---|
| `…/auth/youtube.force-ssl` | `liveBroadcasts` insert/bind/transition/list/update, `liveStreams`, `liveChat` read/write/ban, `videos`, thumbnails | **yes** |

One scope, and Google publishes no narrower one that covers `liveChatMessages`. It is a
*sensitive* scope, which is what puts a public YouTube app into verification — that is
Google's tiering, not an over-ask. The test also asserts LIVETAP requests no Google scope
touching drive, gmail, userinfo, openid, profile or email.

### Twitch — all six used. CONFIRMED

| Scope | Call site |
|---|---|
| `channel:read:stream_key` | `GET /streams/key` (`TwitchAdapter.ts:399`) |
| `channel:manage:broadcast` | `PATCH /channels` (`:441`) |
| `user:read:chat` | `POST /eventsub/subscriptions` (`:273`) |
| `user:write:chat` | `POST /chat/messages` (`:303`) |
| `moderator:manage:banned_users` | `POST /moderation/bans` (`:333`) |
| `moderator:manage:chat_messages` | `DELETE /chat/messages` (`:321`) |

Four of those six exist only for the chat panel. They are used, so they are not findings —
but a creator who never opens chat grants four moderation permissions for nothing.
**Recommendation (not a defect): request the chat four incrementally, the first time the
creator opens the chat panel.** Twitch supports re-authorization with a wider scope set.

`GET /users` needs no scope, and `user:read:email` is deliberately **not** requested even
though the adapter mentions it. Asserted.

### Kick — seven of eight used. ONE FINDING

> **SEC-F18, OPEN, LOW. `events:subscribe` is requested and cannot be used.**
>
> `packages/adapters/src/oauth/endpoints.ts:117` requests it.
> `packages/adapters/src/real/KickAdapter.ts:57-59` says, in its own words, that there is
> deliberately **no** chat subscription because "Kick chat read only exists as a webhook to
> a public HTTPS endpoint, which a desktop LIVETAP cannot receive."
>
> So LIVETAP asks a creator to grant a permission the shipped code is documented as unable
> to use. That is precisely "a scope we ask for and never use".
>
> **Fix:** delete `'events:subscribe'` from Kick's `defaultScopes` at `endpoints.ts:117`.
> Add it back the day a relay endpoint exists to receive the webhook. Removing it also stops
> `missingScopes()` warning the creator about a scope LIVETAP does not need.
>
> The test fails today:
> `× Kick's events:subscribe MUST have a call site — it has none today`

The other seven each have a call site, asserted: `user:read` → `/public/v1/users`,
`channel:read` → `/public/v1/channels`, `channel:write` → the `PATCH`, `streamkey:read` →
the gated `stream.key` field, `chat:write` → `POST /public/v1/chat`, `moderation:ban` →
`/public/v1/moderation/bans`, `moderation:chat_message:manage` → `DELETE
/public/v1/chat/{id}`.

Kick's consent screen lets the creator untick `streamkey:read`. The adapter reads the
**granted** list and degrades to the paste path rather than assuming
(`KickAdapter.ts:105-110`). Asserted by SEC-F20.

### Facebook — two clearly used, one unresolved

| Scope | Call site | Verdict |
|---|---|---|
| `publish_video` | `POST /{target}/live_videos` | used |
| `pages_read_engagement` | `GET /{liveVideoId}/comments` | used |
| `pages_manage_posts` | no endpoint unique to it | **PLAUSIBLE, unresolved** |

`pages_manage_posts` gates publishing content to a Page, which is the same call
`publish_video` gates, so no endpoint in the adapter is exclusively behind it and this
cannot be settled by reading the code. It has never been exercised against the real Graph
API. **The owner should confirm at first connect whether a Page live video succeeds without
it, and if it does, drop it.**

The test also asserts Facebook is never asked for `publish_to_groups`, `user_posts`,
`user_friends`, `email`, `pages_messaging`, `business_management` or `ads_management`.

### The platforms with no working sign-in

`instagram`, `tiktok`, `x` and `linkedin` are not in the broker at all — `broker.ts` has
four platforms. Their scope lists are research, and their own notes say so. X's list
deliberately omits `broadcast.read` and `broadcast.write`: grantable, mapped to no
documented endpoint, and frightening on a consent screen. Asserted.

---

## What this document does not claim

- That any of this has been observed against a real platform. It has not: there is no
  platform credential on this host. See `docs/qa/REAL_PLATFORM_TEST_MATRIX.md`.
- That the mobile secure store works. The Kotlin has never executed.
- That macOS Keychain behaves as Windows DPAPI does here. No Mac has run this. The
  safeStorage probe is a **per-machine** result; re-run it on each target.
- That the redaction regexes catch a credential shape nobody thought of. They catch the ten
  carriers and nineteen field names in the test, plus the ownership matrix — and SEC-F17
  proves that list was, until today, missing a shape that was staring at it.
- That a desktop sign-in works. **It does not**, for the reason in SEC-F15.

---

## Open findings, ranked

| Id | Severity | Where | One line |
|---|---|---|---|
| SEC-F15 | **HIGH** | `apps/desktop/src/preload/index.ts:116-125` vs `apps/web/src/state/tokens.ts:58`, `secrets.ts:21-25` | the desktop vault returns `VaultResult`; the renderer consumes `string \| undefined`. A desktop sign-in can never be read back |
| SEC-F17 | **MEDIUM** | `packages/core/src/validation/ingest.ts:80` | `redactSecrets` masks URL userinfo for `rtsp` only. A WHIP/SRT credential reaches `main.log` |
| SEC-F16 | **MEDIUM** | `apps/web/src/state/secrets.ts:41-44`, `:60-62`, `tokens.ts:79-83` | a refused vault write is silent, the in-memory fallback is skipped, and `hasStreamKey` still says yes |
| SEC-F7 | **MEDIUM** | `packages/adapters/src/oauth/index.ts:37` | `buildAuthorizeUrl` silently drops PKCE instead of refusing when no challenge is supplied |
| SEC-F3a | LOW | `apps/desktop/src/main/oauth.ts:174-176` | a buffered callback leaves the listener up and the state reusable |
| SEC-F4 | LOW | `apps/desktop/src/main/oauth.ts:148` | the `state` comparison is not constant time |
| SEC-F18 | LOW | `packages/adapters/src/oauth/endpoints.ts:117` | Kick's `events:subscribe` is requested and documented as unusable |
| SEC-F21 | LOW | `apps/web/api/oauth/device.ts:39-42` | the device endpoint forwards caller-chosen scopes under the deployment's client id |
| SEC-F8a | INFO | `packages/adapters/src/oauth/pkce.ts:41` | `byte % 66` is a real modulo bias costing under 0.01 bits/char |

None of these is fixed in this pass. Team F writes the test and names the line; the
integrator owns the source.
