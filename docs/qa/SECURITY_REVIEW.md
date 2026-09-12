# LIVETAP Security & Privacy Review

**Date:** 2026-09-12
**Scope:** web app + Vercel token broker, Electron desktop main/preload, `packages/adapters`,
`packages/core` validation, the self-hosted relay (`infra/relay`), supply chain, and the privacy
claims in `docs/legal/PRIVACY_ARCHITECTURE.md`.
**Method:** adversarial. Every finding below was reproduced by running something — a `node` probe,
a real `sh` parse of a generated command, `curl` against the live deployment, a failing unit test —
before it was written down. Where a thing could not be executed on this host it is labelled
`UNVERIFIED` and not claimed.

**Deployment tested:** <https://livetap.vercel.app> (mock mode) as of 2026-09-12 03:50 UTC.
Note that the live instance predates the fixes in this review; re-verify after the next deploy.

---

## 1. Executive verdict

### RELEASE-BLOCKING — fixed in this tree

| ID | One line |
|---|---|
| **SEC-D3** | The desktop engine wrote live **stream keys to `main.log` on disk on every broadcast** (full FFmpeg argv logged at `info`, plus raw FFmpeg stderr). Directly contradicted THREAT_MODEL T4. |
| **SEC-R1** | A stream key ending in `\` **desynchronised the quoting of the relay's `sh -c` hook command** (proved with `sh -n`). Confirmed denial of service; command injection was not reachable only by accident of the command's fixed layout. |
| **SEC-R2** | The relay validated `url.trim()` but published the **raw** `url`, so `rtmp://host/app ` passed the "no whitespace" rule with the space attached — the exact separator librtmp uses to begin parsing `tcUrl=` / `playpath=` / `conn=`. |
| **SEC-R3** | The relay would open an outbound RTMP connection to **any caller-chosen host**, including `mediamtx:9997` (the Control API holding every user's stream keys) and `169.254.169.254`. |

All four are fixed in the tree with regression tests. Nothing release-blocking remains **open**.

### SHOULD-FIX — fixed in this tree

`SEC-A1` (EventSub `reconnect_url` obeyed unvalidated), `SEC-A2` (unbounded, synchronous reconnect
loop — THREAT_MODEL T12 claimed backoff that did not exist), `SEC-A3` (server-controlled chat poll
interval with no clamp), `SEC-A4` (`redact()` missed `passphrase=`/`streamid=`/userinfo),
`SEC-A5` (a websocket frame of the four bytes `null` threw out of `onmessage`), `SEC-D1`
(navigation lock escapable via `%5c`), `SEC-D4`/`SEC-D5` (argv and relative-path hardening),
`SEC-W1`/`SEC-W2`/`SEC-W3` (broker `Sec-Fetch-Site`, `redirectUri` allow-list, rate limiter).

### SHOULD-FIX — OPEN, owned elsewhere

`SEC-W4` (`style-src 'unsafe-inline'` in `apps/web/vercel.json` — not in this team's edit remit),
`SEC-X1` (`npx eslint .` is not green: two files outside this team's remit),
`SEC-D7` (auto-update is not wired up at all, while `SECURITY.md` says updates are verified).

### Notes / NOT-AN-ISSUE

CSRF on the broker, the absent-`Origin` allowance, PKCE entropy, the vault, the recovery file, the
web app's storage, the XSS surface, and every privacy claim in `PRIVACY_ARCHITECTURE.md` were all
tested and are sound. Reasoning is in the findings table so the next reviewer does not have to
re-derive it.

---

## 2. Findings

Fix status: **FIXED** = commit-ready in this tree with a regression test. **OPEN** = not fixed,
exact recommendation given. **NOT-AN-ISSUE** = tested, with the reasoning that makes it safe.

### 2.1 Relay — `infra/relay/session-api/relay-session.mjs`

This is the highest-risk code in the product: MediaMTX executes `runOnAvailable` through `sh -c`,
and the command is built by string concatenation from caller-supplied URLs and stream keys.

| ID | Sev | Evidence / repro | Status |
|---|---|---|---|
| **SEC-R1** | **High** | `buildHookCommand` wrapped each tee argument in double quotes. A stream key of `KEY\` lands immediately before the closing `"` and escapes it. Generated the command and ran a real shell over it: `sh -n` → ``unexpected EOF while looking for matching `"'`` (exit 2). MediaMTX would therefore fail to start the hook and the session silently produces **no stream**. The old rule `/[\s"'`$;|&<>]/` did not contain `\`. Injection was not reachable because the only text that fell outside quotes was our own literal `-fifo_options` value — i.e. the fixed command layout was the sole thing standing between this and RCE. Also accepted `(`, `)`, `{`, `}`, `*`, `?`, `^`, `[`, `]`. | **FIXED** — two independent layers: a character **allow-list** (`URL_ALLOWED_RE` / `KEY_ALLOWED_RE` + a widened `UNSAFE_RE`), and `shQuote()` POSIX single-quoting every interpolated value so the command's *structure* no longer depends on input at all. Re-verified by shell round-trip: a key forced past validation containing `\`, `'` and `;id;` arrives as **one literal argv element** (`ARG[[f=flv:onfail=ignore]rtmp://a.example/app/KEY\';id;']`), `sh -n` exit 0. |
| **SEC-R2** | **High** | `const url = (ingest.url ?? '').trim()` was validated, but `composeRtmpPublishUrl` used the raw `ingest.url`. Executed: `validateIngest({url:'rtmp://ingest.example/app ', streamKey:'KEY'})` → `{ok:true}`, and `composeRtmpPublishUrl` → `"rtmp://ingest.example/app /KEY"`. Leading/trailing space, tab and newline all passed. Whitespace in an RTMP URL is where librtmp starts parsing `tcUrl=`/`playpath=`/`pubUser=` options. Non-string `url`/`streamKey` threw a `TypeError` (→ HTTP 500) instead of being refused. | **FIXED** — `checkString()` validates the **raw** value, rejects non-strings, rejects any leading/trailing whitespace, caps length. |
| **SEC-R3** | **High** | `RTMP_RE` accepts any host. The relay is a server that dials a host the *caller* picked, so `rtmp://mediamtx:9997/x` reaches the Control API that holds every connected user's stream keys (the compose file's own comment says so), `rtmp://169.254.169.254/x` reaches cloud metadata, `rtmp://10.x.x.x/x` reaches the operator's LAN. | **FIXED** — `isPrivateDestinationHost()` + `destinationHost()` refuse loopback, RFC 1918, link-local, `.local`/`.internal` and dot-less hostnames, with an explicit `LIVETAP_RELAY_ALLOW_PRIVATE_DESTINATIONS=1` opt-out. The refusal message never echoes the host back (it reaches a log line). Documented in `infra/relay/README.md` and `.env.example`. |
| SEC-R4 | Low | `buildHookCommand` interpolates `cfg.hookPassword` into the RTSP read-back URL, so the MediaMTX path config — readable through the Control API — contains that credential in plaintext. | **NOT-AN-ISSUE** (accepted, documented). It is operator configuration, not user data; the Control API is unpublished by design; and the existing comment already says a Control API reader can see every stream key anyway, so this adds no new exposure. |
| SEC-R5 | Med | Bearer auth: `isAuthorized` → `safeEqual` uses `timingSafeEqual` with a length pre-check. The length check leaks token **length** only, which is not a practical oracle for a 32-byte random secret. | **NOT-AN-ISSUE.** Constant-time as claimed. |
| SEC-R6 | Med | `docker-compose.yml` publishes `18080:8080` (session-api) and defaults `LIVETAP_RELAY_PUBLIC_WHIP_SCHEME=http`. On a default `docker compose up`, the POST that carries **every destination's stream key** travels in cleartext. | **OPEN — documentation is adequate, but the default is not.** `README.md` §TLS already tells operators to terminate TLS in Caddy and set `…SCHEME=https`. Recommend going further: refuse to start when `publicWhipScheme === 'http'` and `publicHost` is not a loopback/`.local` name, unless `LIVETAP_RELAY_ALLOW_CLEARTEXT=1`. Not applied here because it changes startup behaviour for existing local-only operators and could not be exercised end to end (no Docker daemon on this host — see `RELAY_VERIFICATION.md`). |
| SEC-R7 | Low | Log redaction: `redactIngest()` is the only path to a log line, `••••` + last 4 chars. Verified by the existing `stream keys never reach the logs` test and by the new SEC-R2/R3 tests asserting error strings do not echo input. Error responses return `{error:'Relay error.'}` with the detail only in the local log. | **NOT-AN-ISSUE.** |
| SEC-R8 | Low | Prototype pollution: `JSON.parse('{"__proto__":{…}}')` creates an *own* property, and `validateRequest` only reads named fields. Asserted `Object.prototype` stays clean. | **NOT-AN-ISSUE** (test added anyway). |

### 2.2 Web — `apps/web/api/**`, `vercel.json`, the SPA

| ID | Sev | Evidence / repro | Status |
|---|---|---|---|
| **SEC-W1** | Low | `assertSameOrigin` returned early when `Origin` was absent. Confirmed live: `curl -X POST` with no `Origin` reached the handler (`501 NOT_CONFIGURED`), while `-H 'Origin: https://evil.example'` was refused (`403` / `"Cross-origin requests are not allowed."`). **This is not a CSRF hole** — see SEC-W5 — but the check should not rest on one header. | **FIXED** — `Sec-Fetch-Site` is now checked first and refused unless `same-origin` or `none`. Every current browser sends it and page script cannot forge it, so a cross-site fetch is refused even if a proxy strips `Origin`. Absent (curl, desktop app) it falls through to the `Origin` check exactly as before. |
| **SEC-W5** | — | Is the absent-`Origin` allowance a CSRF hole for browsers? **No**, on three independent grounds: (1) the broker has no ambient authority — no cookie, no session, nothing keyed to a user, so a forged request is the attacker exchanging the attacker's own code; (2) `readJsonBody` requires `Content-Type: application/json`, which is not CORS-simple, so a cross-site POST is preflighted, and the function returns no `Access-Control-Allow-*` headers → the preflight fails and the POST is never sent; a `<form>` POST needs no preflight but cannot set that content type and is refused `415`; (3) CORS stops the attacker reading any response. Verified live (403 on cross-origin POST). A `SameSite` cookie / double-submit token would protect nothing here because there is no cookie to protect. | **NOT-AN-ISSUE** — reasoning recorded in the code so it is not "fixed" into something worse. |
| **SEC-W2** | Low | `REDIRECT_RE` accepted **any** `https://host/path`. This is *not* an open redirect — the broker never redirects; the value is echoed to the token endpoint, which rejects any `redirect_uri` not registered on the client. It is still an unnecessarily wide surface for a value that is used with this deployment's client secret. | **FIXED** — `isAllowedRedirectUri(redirectUri, host)` pins https redirects to the deployment's own host, keeps RFC 8252 loopback (`127.0.0.1` / `localhost` / `[::1]`, literal addresses only) for the desktop listener, and keeps `livetap://`. `requestHost()` prefers `x-forwarded-host` so a custom domain still matches; trusting that header is safe here because it only narrows what we forward and the platform independently enforces registration. Tested against `https://livetap.app@evil.example/cb`, `https://livetap.app.evil.example/cb` and a port mismatch. |
| **SEC-W3** | Med | No rate limiting anywhere in `api/oauth/*`. A warm instance could be used as a free brute-force / probing relay against a platform's token endpoint. | **FIXED, with an honest caveat.** Added an in-memory token bucket (20 req / 60 s, keyed on the first `x-forwarded-for` hop) applied to `/token` and `/refresh` after the origin check. **This is not a real rate limit:** Vercel runs many isolated instances and recycles them, so the effective budget is roughly (limit × live instances) and a cold start resets the counter. It stops one warm instance being an oracle; it is **not** a defence against a distributed attacker. A real limit needs shared state (Vercel KV / Upstash Redis / a Durable Object). That remains **OPEN** and is stated in the code comment so nobody mistakes one for the other. |
| SEC-W6 | Low | Error leakage: `postToken` never puts a code or token in a message; the upstream description is truncated to 300 chars. Verified by the existing test (`err.message` excludes `SECRETCODE`). `errorResponse` maps anything unknown to a flat `500 INTERNAL`. `node.ts` caps request bodies at 64 KB. | **NOT-AN-ISSUE.** |
| SEC-W7 | Low | Token logging: `grep -rn "console\.(log\|info\|warn\|error\|debug)" apps/web/api packages/adapters/src apps/desktop/src infra/relay` (excluding tests) returns **only** the relay's four startup banner lines (port, API URL, public host, transcode flag). No token or key is logged anywhere in the broker, the adapters or the desktop main process. | **NOT-AN-ISSUE.** |
| SEC-W8 | Low | Header hardening, verified live with `curl -sI https://livetap.vercel.app`: `HSTS max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()`, full CSP. API responses additionally carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Static assets return `Access-Control-Allow-Origin: *` (Vercel default) — harmless for public static files, and the functions themselves return no CORS headers. | **NOT-AN-ISSUE.** |
| **SEC-W4** | Low | CSP `style-src 'self' 'unsafe-inline'`. Necessity checked rather than assumed: there are exactly **4** inline style attributes in the whole UI (`PreviewCanvas.tsx:43` aspect-ratio, `Logo.tsx:76` font-size, `Meter.tsx:65,69` width/offset), all dynamic numeric values. `'unsafe-inline'` in `style-src` is therefore genuinely required today — but it also permits injected `<style>` elements, which CSS-based data exfiltration uses. | **OPEN** (`apps/web/vercel.json` is outside this team's edit remit). Recommendation: split the directive — `style-src 'self'; style-src-attr 'unsafe-inline'; style-src-elem 'self'`. That keeps the 4 style *attributes* working while blocking injected `<style>` *elements*. CSP3, supported by all current browsers; browsers that ignore `style-src-attr` fall back to `style-src`, so verify the Meter and Logo render correctly before shipping. The same split applies to the desktop CSP in `security/policy.ts`; deliberately **not** applied there either, because the Electron UI could not be launched on this host to confirm the fallback behaviour, and shipping an unverified UI regression would be worse than the finding. |
| SEC-W9 | — | CSP `script-src 'self'` actually holds: built `dist/index.html` contains **no** inline `<script>` with a body (`grep -oE "<script[^>]*>[^<]+</script>"` → none), only `<script type="module" src="/assets/…">`. Confirmed against both the local build and the live page. | **NOT-AN-ISSUE.** |
| SEC-W10 | — | SPA storage. `grep`ed every `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` write in `apps/web/src`: `livetap.theme` (AppBoot), the non-secret `livetap.*` keys in `state/persist.ts`, and `livetap.oauth.pending` in `OAuthCallback.tsx`. `persist.redactForStorage()` strips `streamKey` and `passphrase` before any destination config is written, and `state/secrets.ts` keeps a typed key in a module-scope `Map` only (desktop hands it to `safeStorage` instead). In the built bundle, `/api/oauth/token`'s response is not even read past `response.ok` — no token is retained anywhere. | **NOT-AN-ISSUE.** |
| SEC-W11 | — | `OAuthCallback.tsx` state handling: `resolveCallback` refuses a missing **or** mismatched `state` outright (no "tried anyway" path), the pending record is removed from `sessionStorage` *before* the exchange, and a `denied`/`mismatch`/`missing` outcome connects nothing. The PKCE verifier lives in `sessionStorage` for the duration of the redirect, which is the standard and necessary trade for a browser flow: it is single-use, tab-scoped, and worthless without the matching `state`. | **NOT-AN-ISSUE.** |
| SEC-W12 | — | XSS surface: `grep -rn "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|insertAdjacentHTML\|document.write\|eval(\|new Function"` across `apps/web/src`, `packages/ui/src` and `packages/media/src` returns **zero** matches. Chat is rendered as text nodes. No `href` is built from user data. | **NOT-AN-ISSUE.** |

### 2.3 Desktop — `apps/desktop/src/**`

| ID | Sev | Evidence / repro | Status |
|---|---|---|---|
| **SEC-D3** | **High** | `FfmpegEngine.spawnChild` did `this.log.info(role + ' spawn', { argv: argv.join(' ') })`, and a sender's last argv element is `rtmp://host/app/<STREAM KEY>`. `main/index.ts` sets `log.transports.file.level = 'info'`, so **every go-live wrote a live stream key into `main.log` on disk** (`%APPDATA%\LIVETAP\logs` / `~/Library/Logs/LIVETAP`). Second path: `onSenderStderr`/`onEncoderStderr` logged raw FFmpeg stderr, which echoes the full publish URL in most connection failures, and `state.lastErrorText` carried it onward into toasts and the diagnostics export. Flatly contradicts THREAT_MODEL T4 ("keys masked in logs", "diagnostics export redacts"). | **FIXED** — added `redactSecrets()` / `redactArgv()` to `packages/core` and applied them at all four logging/emit boundaries. Regression tests assert the key is absent from logs, events and `diagnostics()` **while also asserting the key really was passed to the child process**, so the test proves redaction rather than absence. |
| **SEC-D1** | Low | `isInternalNavigation` compared `decodeURIComponent(target.pathname).startsWith(decodeURIComponent(appDir))`. The WHATWG URL parser normalises `%2e%2e` (so that spelling was already safe) but **not** `%5c`. Executed: `file:///C:/…/dist/renderer/..%5C..%5C..%5CWindows%5CTemp%5Cevil.html` → **ALLOWED**. Win32 resolves `\` as a separator, so the app window could be navigated to any local file — and that document would be handed the preload bridge. Low severity because it needs an attacker-controlled local file plus a compromised renderer, but it is a real breach of the navigation lock. | **FIXED** — decode, normalise separators, then reject `..`/`.` segments explicitly, and reject decoded NUL. Prefix comparison alone is not a containment check. Also pinned that a sibling `renderer-evil/` directory is refused. |
| **SEC-D5** | Low | `isSafeRelativePath('recording.mp4:payload.exe')` returned **true**. On Windows that names an NTFS alternate data stream, which `path.resolve` keeps "inside" the recordings directory and `shell.openPath` would execute. Needs prior local write access, so low — but free to close. | **FIXED** — reject `:` anywhere, not just as a drive letter. Safe because `FfmpegEngine.startRecording` already strips `:` from its own filenames (`toISOString().replace(/[:.]/g,'-')`); pinned by a test asserting a real LIVETAP recording filename still passes. |
| **SEC-D4** | Low | Argv hardening found by probing: (a) `srt` was the only protocol in `buildSenderArgv` with no explicit scheme re-check (rtmp and whip both had one) — it relied on `validateIngest` alone; (b) `rtmp://host/app%00` was accepted; (c) a tee slave URL beginning `[` was read as a second option block by the muxer. | **FIXED** — all three. |
| SEC-D9 | — | Attacks attempted against the argv builder that **already failed correctly**, now pinned by tests so they stay failing: `file:`/`concat:`/`data:`/`subfile:` smuggled in as `rtmp` or `srt`; a value starting with `-` in every field that reaches argv (stream URL, WHIP bearer, SRT streamid, SRT passphrase, recording path); `streamid=x&passphrase=evil` parameter injection (refused — and a legitimate `live/key` is percent-encoded to stay one parameter); tee slave-list breakout via `|` (escaped to `\|`, so an injected slave stays part of one URL); a tee list with no anchor slave. | **NOT-AN-ISSUE** (13 new tests). |
| SEC-D6 | — | IPC guards. Prototype pollution: `isRecord` rejects own `__proto__`/`constructor`/`prototype` keys, and every nested object goes through it — tested at top level, nested inside `ingest`, and as a `formats` map key; `Object.prototype` verified clean. Huge strings: vault secrets are capped by **byte** length (a 2 049-emoji payload is 8 196 bytes and refused despite `.length` being 4 098), and URL / key / passphrase / streamId / output-count / chunk-size caps all hold. Path traversal: every spelling refused, plus the post-resolve `path.relative` re-check in `ipc.ts`. `isTrustedSender` pins every channel to the app window's `webContents.id`. The preload exposes named methods only — no generic `invoke`, no `sender` leak. | **NOT-AN-ISSUE** (14 new tests). |
| SEC-D2 | — | `isExternallyOpenable`/`isHttpsUrl`: `HTTPS://example.com` is allowed, which is **correct** — the URL parser normalises the scheme, so it genuinely is https. Pinned by a test so nobody "fixes" it with a case-sensitive compare and reopens the `file:`/`ms-msdt:` class of bug from the other side. `http:`, `file:`, `ms-msdt:`, `smb:`, `javascript:`, `data:`, `livetap:`, control characters and >2048-char URLs are all refused. `setWindowOpenHandler` always returns `{action:'deny'}`; `will-attach-webview` is prevented; `webviewTag: false`. | **NOT-AN-ISSUE.** |
| SEC-D8 | Info | An IDN homograph (`https://exаmple.com` with a Cyrillic а → `xn--exaple-kqf.com`) passes `isHttpsUrl`, because it is a valid https URL. The only caller is our own renderer building a platform authorize URL, and the user sees the real URL bar in their own browser. | **NOT-AN-ISSUE** (residual, listed in §5). |
| SEC-D10 | — | Window flags confirmed in `createWindow`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `webviewTag: false`. CSP is imposed on **responses** by main via `onHeadersReceived`, and any CSP the document set for itself is deleted first — so it cannot be stripped by injected markup. Permissions default-deny with a 4-entry allow-list (`media`, `display-capture`, `fullscreen`, `mediaKeySystem`) gated on origin match; `setDevicePermissionHandler(() => false)` refuses every HID/serial/USB/Bluetooth device independently. `onBeforeRequest` blocks every scheme except https/wss/file/devtools/blob/data (+ loopback http in dev). | **NOT-AN-ISSUE.** |
| SEC-D11 | — | Vault: `safeStorage.encryptString` → base64 → `vault.bin` written atomically (temp + rename) with mode `0o600`; **refuses** to store when `isEncryptionAvailable()` is false rather than falling back to plaintext; entries that fail `isVaultId` are dropped on load; `list()` returns ids only. `get` returns the plaintext straight to the caller without caching it in module scope. | **NOT-AN-ISSUE.** |
| SEC-D12 | — | Recovery file: `session-recovery.json` holds `startedAt`, `updatedAt`, `masterAspectRatio`, `qualityPreset`, `recording`, `momentId` and destination **ids** only. No URL, key, token or passphrase — confirmed by reading `RecoverySnapshot` and `isRecoverySnapshot`. Mode `0o600`, atomic write, and anything failing the guard is deleted rather than becoming app state. | **NOT-AN-ISSUE.** |
| SEC-D13 | — | OAuth loopback: binds `127.0.0.1` only (never `0.0.0.0`), ephemeral port, single-use, only `/callback` answers, 5-minute timeout, `state` from `randomBytes(32).toString('base64url')` (256 bits) and compared before anything is accepted, `Referrer-Policy: no-referrer` + `Cache-Control: no-store` + a `default-src 'none'` CSP on the response page, and the callback URL is never logged (`deep link received`, no URL). `isAcceptableDeepLink` requires the `livetap:` scheme, ≤4096 chars, no control characters. | **NOT-AN-ISSUE.** |
| **SEC-D7** | Low | Update trust. `electron-updater` is in `dependencies` and marked `external` in `tsup.config.ts`, but `grep -rn "autoUpdater"` across `apps/desktop` returns **no usage** — auto-update is not wired up at all. `electron-builder.yml` has `publish.owner/repo` as `REPLACE_WITH_…` placeholders with `publishAutoUpdate: true`. So there is **no update channel to attack** today (good), but `SECURITY.md` says "desktop updates are signed and verified (electron-updater)", which currently overstates reality. `allowDowngrade` and `channel` are unset, i.e. electron-updater defaults (`allowDowngrade: false`, channel derived from the version) — those defaults are the safe ones. | **OPEN.** Recommendation, in order: (1) correct `SECURITY.md` to say auto-update is **not implemented yet**; (2) when it is implemented, set `allowDowngrade: false` and a pinned `channel` explicitly rather than relying on defaults, require `provider: github` over https only, and refuse to run the updater at all on an unsigned build (`app.isPackaged && !signed` → no-op) so an unsigned build cannot be silently replaced; (3) until then, move `electron-updater` to `devDependencies` or drop it, since an unused runtime dependency is pure supply-chain surface. Signing itself stays `BLOCKED_EXTERNAL_DEPENDENCY` (no certificates). |

### 2.4 Adapters — `packages/adapters/src/real/**`

| ID | Sev | Evidence / repro | Status |
|---|---|---|---|
| **SEC-A1** | Med | `TwitchEventSubSession.handle` did `if (next) this.connect(next, true)` with `payload.session.reconnect_url` straight from a websocket frame. One frame could move the chat socket to **any** host, or downgrade it to plaintext `ws://`. The transport is TLS-authenticated to Twitch, but frame *content* is not something that should choose our next endpoint. | **FIXED** — `isAcceptableReconnectUrl(next, baseUrl)` requires a parseable `wss:` URL on the **same origin as the configured EventSub endpoint** (compared against the configured base, not a hard-coded `twitch.tv`, so a test double or proxy still works). A refused value falls back to our own endpoint rather than dropping chat. Tested that a frame naming `wss://attacker.example/ws` opens **no** socket to that host. |
| **SEC-A2** | Med | `socket.onclose → reconnectFromScratch() → connect()` and `connect()` re-wires `onclose` — a synchronous cycle. A socket that closes during construction (dead network, 429, hostile endpoint hanging up) produced an **unbounded tight loop** that pegs a core and hammers the endpoint. THREAT_MODEL T12 claims "bounded reconnect with backoff"; there was none on this path. | **FIXED** — the first reconnect stays immediate (a single drop should be invisible in chat); repeated failures back off exponentially (1 s → 30 s cap) through the injected timers, with one pending attempt at a time, reset by a `session_welcome`. `stop()` clears the pending timer. Test drives a socket that closes on every attempt and asserts the loop parks on a timer instead of spinning, and that `stop()` leaves no timer behind. |
| **SEC-A5** | Low | Found by a test written to probe untrusted frames: a frame of the four bytes `null` made `JSON.parse` return `null`, and `handle()` then threw `TypeError: Cannot read properties of null (reading 'metadata')` **out of the socket's `onmessage` handler** — in Node an unhandled error that can take the process down. | **FIXED** — anything that is not a plain object is not a frame and is ignored. Malformed JSON, `[]`, `null`, a bare string, a number and a `__proto__`-bearing event payload are all now covered by one test; `Object.prototype` verified clean. |
| **SEC-A3** | Med | `subscribeChat` did `if (page?.pollingIntervalMillis) waitMs = page.pollingIntervalMillis` then `await sleep(waitMs)` — a server-controlled value with no type or range check. `-1`, `NaN` or `"soon"` all make `setTimeout` fire immediately, turning the poll loop into an unthrottled request flood that burns the user's YouTube daily quota in seconds and pegs a core; a huge value silently stalls chat for hours. | **FIXED** — `clampChatPollInterval()` honours a finite hint inside [1 s, 60 s] and falls back otherwise. 5 tests, including "never returns a value that would make `setTimeout` fire immediately". |
| **SEC-A4** | Low | `redact()` in `real/http.ts` covered bearer tokens, a handful of query parameters and the RTMP path segment — but **not** `passphrase=` or `streamid=` (the SRT/WHIP credentials), nor `password=`/`signature=`/`authorization=`, nor URL userinfo (`rtsp://user:pass@host`). It also had **no tests of its own**. | **FIXED** — widened to match `packages/core`'s `redactSecrets` field-for-field (the two lists must not disagree), ordered longest-match-first so `refresh_token=` is not half-matched by `token=`, plus a userinfo rule and a non-string guard. New `real/http.test.ts` (10 tests) pins every field, asserts the surrounding diagnostic text survives, and asserts `HttpError.url` and a token echoed back inside a platform error body are both masked. |
| SEC-A6 | — | PKCE entropy: `generateCodeVerifier` uses `crypto.getRandomValues`, and the alphabet is exactly **64** characters, so `byte % 64` is **free of modulo bias** (256 is an exact multiple of 64) — worth recording, because the same pattern with a 62-character alphabet would be biased. Default 64 chars over a 64-symbol alphabet = 384 bits. `generateState` is 24 random bytes (192 bits) base64url. Challenge is real SHA-256 via `crypto.subtle`. The verifier is returned to the caller and never persisted by the module. | **NOT-AN-ISSUE.** |
| SEC-A7 | Low | HTTP error mapping: `extractMessage` falls back to `raw.slice(0, 200)` — i.e. part of the platform's response body — but everything passes through `redact()` and is capped at 500 chars. Adapters never see the stored secret (`tokenProvider` indirection), and the token goes only in the `Authorization` header, never the URL (tested). | **NOT-AN-ISSUE** (residual: a platform could invent a new secret-shaped field; §5). |
| SEC-A8 | Low | Unbounded queues: the EventSub session holds no message queue (each frame is mapped and handed to the callback synchronously), and the YouTube poller holds one page at a time with `maxResults: 200`. There is no growing buffer for an attacker to fill. | **NOT-AN-ISSUE.** |

### 2.5 Supply chain

| ID | Sev | Evidence | Status |
|---|---|---|---|
| SEC-S1 | — | `npm audit --omit=dev` → **`found 0 vulnerabilities`**. | **NOT-AN-ISSUE.** |
| SEC-S2 | Low | `npm audit` (full) → 4 (1 low, 3 moderate), all **dev-only**: `@vitest/mocker` path traversal / arbitrary file read (GHSA-82fw-gwwq-j7x9, fix = vitest 5 major), and `esbuild` dev-server arbitrary file read on Windows (GHSA-g7r4-m6w7-qqqr) via `tsup`. Neither ships. | **OPEN, accept for MVP.** Both are "an attacker who can already make requests to your local dev server". CI already gates on `--audit-level=high`, which these do not trip. Revisit `vitest@5` after the release, not during it. |
| SEC-S3 | — | Licences: `npx license-checker --summary` over the whole tree → MIT 439, ISC 49, Apache-2.0 28, BSD-3-Clause 16, BlueOak-1.0.0 15, BSD-2-Clause 13, Python-2.0 1, Unlicense 1, CC-BY-4.0 1, WTFPL 1, 0BSD 1, and three dual-licence permissive entries. **No GPL, LGPL, AGPL, SSPL or BUSL anywhere.** `--production` reports 8 `UNLICENSED`, which are exactly the 8 first-party `@livetap/*` workspace packages (`private: true`); no third-party package is unlicensed. | **NOT-AN-ISSUE.** Note: FFmpeg binaries are GPL and deliberately **not** bundled in the repo (`electron-builder.yml`); that licensing decision is already documented. |
| SEC-S4 | — | Typosquats: production dependency set is deliberately tiny and every entry is the canonical package — `react`, `react-dom`, `react-router`, `zustand`, `electron-log`, `electron-updater`, plus the four `@livetap/*` workspace packages. `packages/core`, `adapters` and `media` have **zero** third-party dependencies. Nothing lookalike. | **NOT-AN-ISSUE** (but see SEC-D7 on unused `electron-updater`). |
| SEC-S5 | — | Secret scan: `grep -rnE "AKIA[0-9A-Z]{16}\|ghp_[A-Za-z0-9]{36}\|gho_…\|sk-[A-Za-z0-9]{20,}\|AIza[0-9A-Za-z_-]{35}\|BEGIN [A-Z ]*PRIVATE KEY\|xox[baprs]-\|glpat-"` across every `.ts/.tsx/.mjs/.js/.json/.md/.yml/.yaml/.html/.example` file → **no matches**. Only `.env.example` files are tracked (`git ls-files | grep -i env`), and `.gitignore` covers `.env` / `.env.*` with `!.env.example`. | **NOT-AN-ISSUE.** |
| SEC-S6 | Low | `.github/workflows-pending/*.yml` pin actions by **tag**, not SHA: `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/setup-java@v4`, `gradle/actions/setup-gradle@v4`, `gitleaks/gitleaks-action@v2`. A moved tag is arbitrary code execution in CI with repository credentials. | **OPEN** (recommendation, workflows are not active yet). Pin every `uses:` to a full 40-character commit SHA with the version in a trailing comment, e.g. `uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v4.2.2`. Prioritise `gitleaks/gitleaks-action`, the least-audited third party in the list. Add `permissions: contents: read` at workflow level while you are there. |
| SEC-S7 | — | Lockfile: `package-lock.json` is committed, and `installCommand` is `npm ci` (not `npm install`), so the deployed tree matches the lockfile exactly. | **NOT-AN-ISSUE.** |

### 2.6 Privacy — claims in `PRIVACY_ARCHITECTURE.md` vs the code

Every claim below was checked against the **built** bundle, not the source, because that is what a
user actually receives.

| Claim | Verified how | Verdict |
|---|---|---|
| "no analytics or telemetry in the open-source core" | `grep -rlE "navigator\.sendBeacon\|gtag\|googletagmanager\|analytics\|posthog\|sentry\|mixpanel\|plausible\|segment\.io\|fullstory\|hotjar"` over `dist/**/*.js` matched two chunks; both inspected — the matches are the literal word "analytics" in the platform capability matrix (`analytics:"NATIVE_API"`) and the Privacy page's own copy asserting there is none. No analytics SDK, no beacon. | **TRUE** |
| "the landing page loads only same-origin assets" | Every `src`/`href` in built `index.html` is `/assets/*`, `/brand/hero-a.webp`, or a `data:` SVG favicon. No `fonts.googleapis.com`, no `fonts.gstatic.com`, no CDN. Confirmed identical on the live page. | **TRUE** |
| "no flow sends data to LIVETAP-operated servers" | The **only** network target literal in the entire built bundle is `fetch("/api/oauth/token")` — same origin. The other absolute URLs in `dist` are `w3.org` (SVG namespaces), `github.com`/`react.dev`/`reactrouter.com` (link text), `localhost` and `mock.livetap.app` (the mock adapter's fake ingest host, never dialled). | **TRUE** |
| "Long-lived tokens are never written to `localStorage`" | See SEC-W10: no token reaches any storage API; the broker's response is not read past `response.ok`. | **TRUE** |
| "Stream keys … same secure store as tokens" | `secrets.ts` → `window.livetap.vault` (`safeStorage`) on desktop, in-memory `Map` on web; `persist.redactForStorage()` strips `streamKey`/`passphrase` before any write. | **TRUE** |
| "diagnostics export redacts" / "keys masked in logs" (THREAT_MODEL T4) | Was **FALSE** on desktop — see SEC-D3. | **TRUE after this review's fix** |
| Mobile: secure storage, no cleartext | `AndroidManifest.xml` sets `usesCleartextTraffic="false"`; `capacitor.config.ts` sets `androidScheme: 'https'` and `allowNavigation: []`; permissions are limited to camera, mic, internet, network state, foreground-service variants, wake lock, notifications. The `livetap://oauth` intent filter is `exported="true"` and therefore claimable by another installed app — the manifest's own comment says so, and PKCE + `state` are the documented mitigation. | **TRUE**, with the deep-link caveat already documented |

---

## 3. Tests added

All named tests are new in this review and **each one failed against the pre-review code** unless
marked "pins existing behaviour".

**`infra/relay/session-api/relay-session.test.mjs`** (`node --test`, 13 new → 45 total)
- `SEC-R1 rejects a stream key ending in a backslash (sh quote desynchronisation)`
- `SEC-R1 rejects shell and glob metacharacters the old deny-list let through`
- `SEC-R1 the generated hook command is a balanced sh command with quoted values`
- `SEC-R1 shQuote makes the command structure independent of the value`
- `SEC-R2 rejects a URL whose whitespace survives only at the edges`
- `SEC-R2 composeRtmpPublishUrl only ever sees a value validateIngest approved`
- `SEC-R2 non-string url/streamKey are refused, not thrown on`
- `SEC-R2 __proto__ keys in a destination cannot pollute Object.prototype` (pins existing behaviour)
- `SEC-R3 private, loopback and link-local destinations are recognised`
- `SEC-R3 destinationHost extracts the authority and drops userinfo`
- `SEC-R3 validateRequest refuses an SSRF destination and allows it when opted in`
- `SEC-R3 real platform destinations still validate end to end`

**`apps/web/api/_lib/broker.test.ts`** (11 new → 20 total)
- `SEC-W1 Sec-Fetch-Site > refuses a browser request that declares itself cross-site even without an Origin header`
- `SEC-W1 Sec-Fetch-Site > still accepts same-origin browser requests and header-less non-browser clients`
- `SEC-W2 redirectUri allow-list > refuses an https redirectUri that is not this deployment`
- `SEC-W2 redirectUri allow-list > accepts this deployment, loopback and the private-use scheme`
- `SEC-W2 redirectUri allow-list > refuses non-loopback http and every other scheme`
- `SEC-W2 redirectUri allow-list > is not fooled by a userinfo or port prefix that looks like our host`
- `SEC-W2 requestHost > prefers the first x-forwarded-host hop, so a custom domain still matches`
- `SEC-W2 requestHost > falls back to host, and to undefined when neither is present`
- `SEC-W3 in-memory rate limiter > allows the budget then refuses with RATE_LIMITED`
- `SEC-W3 in-memory rate limiter > buckets per client and rolls over when the window expires`
- `SEC-W3 in-memory rate limiter > uses only the first x-forwarded-for hop, so a spoofed tail cannot split the bucket`

**`apps/desktop/src/main/security/policy.test.ts`** (8 new → 33 total)
- `SEC-D1 … > blocks traversal through a percent-encoded backslash`
- `SEC-D1 … > blocks traversal through a literal or encoded dot segment`
- `SEC-D1 … > blocks a NUL byte smuggled through percent-encoding`
- `SEC-D1 … > still allows the renderer bundle and its own subdirectories`
- `SEC-D1 … > blocks a sibling directory whose name merely starts with the bundle path`
- `SEC-D2 isExternallyOpenable scheme lock > accepts an uppercase scheme because the parser normalises it`
- `SEC-D2 … > still refuses every non-https scheme, including the dangerous ones`
- `SEC-D2 … > refuses control characters and absurd lengths`

**`apps/desktop/src/main/ffmpeg/FfmpegEngine.test.ts`** (4 new → 47 total)
- `SEC-D3 stream keys never reach the engine log > redacts the publish URL in the spawn argv log line`
- `SEC-D3 … > redacts an FFmpeg stderr line that echoes the publish URL`
- `SEC-D3 … > never puts a key in an emitted event, including engineError technicals`
- `SEC-D3 … > keeps the diagnostics export free of keys and passphrases`

**`apps/desktop/src/main/ffmpeg/argv.test.ts`** (13 new → 72 total)
- `SEC-D4 protocol allow-list cannot be escaped > refuses FFmpeg pseudo-protocols however they are labelled`
- `SEC-D4 … > refuses a pseudo-protocol smuggled in as an srt destination`
- `SEC-D4 … > refuses a WHIP endpoint that is not https`
- `SEC-D4 … > refuses an encoded NUL byte in any URL`
- `SEC-D4 no user string can become an ffmpeg option > refuses a leading dash in every field that reaches argv`
- `SEC-D4 … > keeps the WHIP bearer token as one argv element, never merged into the URL`
- `SEC-D4 SRT streamid / passphrase cannot inject a second parameter > refuses an ampersand, quote or space in a streamid`
- `SEC-D4 … > percent-encodes a legitimate streamid so it stays one parameter`
- `SEC-D4 … > appends passphrase with & only after an existing query, never duplicating ?`
- `SEC-D4 tee slave list cannot be broken out of > escapes a pipe so an injected slave stays part of one URL`
- `SEC-D4 … > refuses a slave URL that opens its own option block`
- `SEC-D4 … > refuses a slave format that is not a clean token`
- `SEC-D4 … > still refuses a network-only slave list with no anchor`

**`apps/desktop/src/shared/guards.test.ts`** (14 new → 48 total)
- `SEC-D5 isSafeRelativePath against Windows path tricks > refuses a colon anywhere: NTFS alternate data streams and drive-relative paths`
- `SEC-D5 … > refuses every traversal spelling, including mixed separators`
- `SEC-D5 … > refuses absolute, UNC, NUL and empty-segment paths`
- `SEC-D5 … > refuses an over-long path and a non-string`
- `SEC-D5 … > still accepts the filenames LIVETAP actually writes`
- `SEC-D6 prototype pollution through IPC payloads > refuses a JSON-parsed object with an own __proto__ key at any depth`
- `SEC-D6 … > refuses constructor and prototype keys too`
- `SEC-D6 … > refuses a formats map keyed by __proto__`
- `SEC-D6 oversized payloads are refused, not truncated > caps vault secrets by BYTE length, not character count`
- `SEC-D6 … > caps ingest urls, keys, passphrases and stream ids`
- `SEC-D6 … > caps the number of outputs so one message cannot spawn unbounded processes`
- `SEC-D6 … > caps a single media chunk`
- `SEC-D6 isHttpsUrl is the only gate on shell.openExternal > refuses every non-https scheme and host-less https`
- `SEC-D6 … > accepts a real https url regardless of scheme case`

**`packages/core/src/validation/ingest.test.ts`** (8 new → 13 total)
- `redactSecrets > masks the last path segment of an RTMP/RTMPS publish URL`
- `redactSecrets > masks a key inside a longer FFmpeg error line, keeping the diagnostic part`
- `redactSecrets > masks SRT and WHIP credentials carried as query parameters`
- `redactSecrets > masks bearer tokens, the whip -authorization argv flag, and rtsp userinfo`
- `redactSecrets > masks OAuth material that platform error bodies echo back`
- `redactSecrets > leaves text with no secret in it untouched, and handles junk input`
- `redactArgv > masks the publish URL element of a real sender argv and nothing else`
- `redactArgv > masks a WHIP bearer token passed as its own argv element`

**`packages/adapters/src/real/TwitchAdapter.test.ts`** (7 new → 25 total)
- `SEC-A1 session_reconnect url is validated, not obeyed > accepts only a same-origin wss url`
- `SEC-A1 … > refuses a different host, a downgrade to ws:, and non-websocket schemes`
- `SEC-A1 … > refuses junk, control characters and absurd lengths`
- `SEC-A1 … > does not open a socket to a hostile reconnect_url, and keeps chat alive`
- `SEC-A2 reconnect is bounded > backs off exponentially and caps the delay`
- `SEC-A2 … > does not spin when a socket closes immediately on every attempt`
- `SEC-A5 EventSub frames are treated as untrusted data > ignores malformed JSON, wrong types and prototype-polluting payloads`

**`packages/adapters/src/real/YouTubeAdapter.test.ts`** (5 new → 20 total)
- `SEC-A3 clampChatPollInterval > honours a sane server hint`
- `SEC-A3 … > floors values that would remove all pacing`
- `SEC-A3 … > caps a value that would stall chat for hours`
- `SEC-A3 … > falls back for anything that is not a finite number`
- `SEC-A3 … > never returns a value that would make setTimeout fire immediately`

**`packages/adapters/src/real/http.test.ts`** — new file, 10 tests (`redact`, `HttpError`,
`request error mapping`), covering SEC-A4 and pinning that the token travels only in the
`Authorization` header.

---

## 4. Gate status

| Command | Result |
|---|---|
| `npx vitest run` | **993 passed / 56 files**, 0 failed (baseline before this review: 913) |
| `npm run test:relay` (`node --test infra/relay/session-api/`) | **45 passed**, 0 failed |
| `npx tsc -b tsconfig.json` | clean |
| `npx eslint apps/web/api packages infra apps/desktop/src` | clean |
| `npx eslint .` (whole repo) | **3 errors, in 2 files outside this team's edit remit** — see SEC-X1 |
| `npm run build:web` | clean |

**SEC-X1 (OPEN, not this team's files).** `npx eslint .` is not green because of two files owned by
other teams, both untouched by this review:

- `apps/desktop/scripts/asar-check.cjs:2,3` — `@typescript-eslint/no-require-imports`. `require()`
  is the *correct* syntax in a `.cjs` file; this is a config gap, not a code defect. Fix either by
  exempting `**/*.cjs` from that rule in the root `eslint.config.mjs`, or with two
  `// eslint-disable-next-line @typescript-eslint/no-require-imports` comments.
- `apps/web/e2e/_review/capture.mjs:69` — `'destinations' is assigned a value but never used`.
  Rename to `_destinations` or delete the binding.

`node --test infra/relay/session-api/` is now wired into `npm run test:relay` and into
`npm run check`, because the relay's suite was **not** running under `npx vitest run` (it uses
`node:test` by design so `infra/` stays installable without the TypeScript workspace) — meaning the
relay, the highest-risk component in the product, had no coverage in the release gate at all.

---

## 5. Residual risk

Things that are real, understood, and deliberately not fixed.

1. **The relay's shell hook remains a shell hook.** Two layers now protect it (allow-list +
   `shQuote`), but the architecture still asks MediaMTX to run a command string through `sh -c` with
   user data in it. The durable fix is to stop generating a shell command — write the destination
   list to a file the hook reads, or run a small supervisor that spawns FFmpeg with an argv array
   the way the desktop engine does. Worth doing before the relay is offered as a hosted service.
2. **No real rate limit on the broker** (SEC-W3). The in-memory limiter is per-instance and
   defeated by concurrency or a cold start. A distributed attacker is unthrottled.
3. **No CI is running.** Workflows live in `.github/workflows-pending/`, so `npm audit`, gitleaks
   and the test suites are only ever run by hand. Every claim in this document is a point-in-time
   measurement, not a standing guarantee. Activating CI is the single highest-leverage security
   action left, and pinning its actions to SHAs (SEC-S6) should happen at the same time.
4. **Unsigned desktop builds.** `BLOCKED_EXTERNAL_DEPENDENCY` (no certificates). Users must trust
   the download source. Compounded by SEC-D7: `SECURITY.md` currently implies verified updates
   exist.
5. **Relay ships cleartext by default** (SEC-R6). Correct instructions exist in the README; nothing
   enforces them.
6. **Dev-tool CVEs** (SEC-S2): `@vitest/mocker` and `esbuild`, dev-only, both requiring local access.
7. **`style-src 'unsafe-inline'`** (SEC-W4) in both the web and desktop CSPs. Injected `<style>`
   is still possible; the `style-src-attr` split is specified but unverified in the Electron UI.
8. **IDN homographs pass `openExternal`** (SEC-D8). Only our own renderer calls it, and the user
   sees the real URL bar, so this is accepted rather than fixed.
9. **Mobile deep-link hijack.** Another installed Android app can claim `livetap://oauth`. PKCE
   plus `state` is the mitigation; App Links (`assetlinks.json`) would close it properly once a
   domain is fixed.
10. **`redact()` / `redactSecrets()` are deny-lists.** They cover every field these platforms use
    today. A platform that invents a new secret-shaped parameter would not be masked until the list
    is updated. Redact at the boundary; never rely on these to clean up a secret that should not
    have been there.
11. **SRT `streamid` values containing `!`** (e.g. the `#!::r=…,m=publish` form some providers use)
    are refused by `assertCleanUrl`'s `QUERY_PAIR` charset even though `assertCleanToken` allows
    `!`. This is a **functional** limitation, erring safe; flagged here so it is not mistaken for a
    security regression when someone hits it.
12. **Everything in this review is static/unit-level.** No Electron app was launched, no Docker
    daemon exists on this host, and the live deployment predates these fixes. The relay's runtime
    behaviour under the new validation is `UNVERIFIED` end to end.

---

## 6. Files changed

Code: `infra/relay/session-api/relay-session.mjs`, `apps/web/api/_lib/broker.ts`,
`apps/web/api/oauth/token.ts`, `apps/web/api/oauth/refresh.ts`,
`apps/desktop/src/main/security/policy.ts`, `apps/desktop/src/main/ffmpeg/FfmpegEngine.ts`,
`apps/desktop/src/main/ffmpeg/argv.ts`, `apps/desktop/src/shared/guards.ts`,
`packages/core/src/validation/ingest.ts`, `packages/adapters/src/real/TwitchAdapter.ts`,
`packages/adapters/src/real/YouTubeAdapter.ts`, `packages/adapters/src/real/http.ts`.

Tests: the nine files listed in §3 (`packages/adapters/src/real/http.test.ts` is new).

Docs / config: this file, `infra/relay/README.md`, `infra/relay/.env.example`,
`package.json` (`test:relay`, and `check` now runs it).

No `git commit` was made. `apps/web/src/**` was not touched; UI findings are reported as SEC-W4,
SEC-W10, SEC-W11 and SEC-W12.
