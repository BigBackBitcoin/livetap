# Destination Adapters

How LIVETAP talks to a platform, and the rules that keep it honest.

- **Contracts:** `packages/core/src/types/destination.ts`, `packages/core/src/destination/adapter.ts`
- **Implementations:** `packages/adapters/src`
- **Capability evidence:** `docs/research/PLATFORM_YOUTUBE_TWITCH_KICK.md`,
  `docs/research/PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md`,
  `docs/research/PLATFORM_X_LINKEDIN_OTHERS.md`

---

## 1. The adapter contract

A `DestinationAdapter` is the only thing in LIVETAP that knows a platform exists. It owns one
platform's control plane and nothing else: no UI, no encoder, no state machine, no retry policy.

```
readonly profile: PlatformProfile      // what this platform can honestly do
supports(capability): boolean          // derived from the profile, never hand-written
disconnect(credential)                 // required
validate(config, credential?)          // required — resolves ingest / refreshes credential
createBroadcast(config, credential?)   // required — returns a BroadcastHandle
stopBroadcast(handle, credential?)     // required — may legitimately be a no-op

startBroadcast?  getStatus?  publishMetadata?  publishThumbnail?
subscribeChat?   sendChat?   moderate?         getAnalytics?    getHealth?
```

Everything optional is **only implemented when the platform's capability matrix marks the
capability automated**. The orchestrator checks `supports()` before calling, so an adapter must
never implement a method it cannot honour — an empty implementation is a lie the UI will repeat.

### The call sequence the orchestrator actually uses

`BroadcastOrchestrator` drives every destination through exactly this path:

```
connect(id)                validate()                     DISCONNECTED -> READY
goLive()                   createBroadcast()              READY -> STARTING
                           publishMetadata()  (if supports('metadata'))
                           [engine pushes bytes]
engine "outputUp"          startBroadcast()   (only if profile.autoStartsOnIngest === false)
                           subscribeChat()    (if supports('chatRead'))    -> LIVE
stop() / stopDestination() stopBroadcast()                 LIVE -> STOPPING -> ENDED
```

Two consequences worth internalising:

1. **`autoStartsOnIngest` is load-bearing.** `false` means "the platform needs an explicit call
   after ingest is accepted" and the orchestrator will call `startBroadcast` at that moment.
   YouTube is `false` (it needs `liveBroadcasts.transition`). Twitch, Kick, Facebook and Custom
   are `true` (they publish themselves). Instagram, TikTok and X are `false` *for a different
   reason*: a human has to press a button in the platform's own UI, and LIVETAP has no
   `startBroadcast` to offer — the destination is shown as awaiting confirmation instead of
   claiming to be live.
2. **Failures must be thrown, not swallowed.** The orchestrator converts a thrown error into a
   humane error via `classifyFailure({ status, message })`. So every adapter error carries a
   `status` when the platform gave one (see `HttpError` in `real/http.ts`), which is how `401`
   becomes "sign in again" rather than "something went wrong".

---

## 2. The capability-driven UI rule

> **If `isAutomated(profile.capabilities[key])` is false, the UI must not offer the affordance,
> and must say why in the user's language.**

`CapabilityClass` has seven values; only three are automated
(`NATIVE_API`, `OAUTH_API`, `RTMP_DESTINATION`). The other four are promises LIVETAP cannot keep:

| Class | Meaning | What the UI does |
|---|---|---|
| `NATIVE_API` | A documented endpoint does it end to end | Offer it |
| `OAUTH_API` | Works with a user token, possibly behind app review | Offer it, surface the gate in onboarding |
| `RTMP_DESTINATION` | Achieved purely by pushing bytes | Offer it silently |
| `USER_ASSISTED` | The human must do a step in the platform's UI | Show the step, with a link and a checklist |
| `PARTNER_APPROVAL_REQUIRED` | Gated behind a partner program | Show it as unavailable and say who gates it |
| `EXPERIMENTAL` | Exists but unverified/limited | Hide by default; advanced setting at most |
| `UNAVAILABLE` | No mechanism exists | Do not render the control at all |

Nothing about a platform is hard-coded anywhere else. `PLATFORM_PROFILES` is the single source of
truth, `profiles.test.ts` asserts every `CapabilityKey` is present with a known class, and each
mock adapter's `supports()` is asserted to mirror its profile exactly. When the research changes,
one file changes and the UI follows.

**Honesty over feature parity.** Where the research could not confirm something from an official
doc, the profile takes the *conservative* class and the reason lives in a code comment plus an
`eligibilityNotes` entry the user can read. Examples shipped today:

- Kick `streamKey` is `USER_ASSISTED`, not `OAUTH_API`: the `streamkey:read` scope exists but the
  docs never bind it to an endpoint. The adapter has an opt-in `trustChannelStreamKey` flag for
  whoever verifies it empirically.
- Kick and Instagram `chatRead` are `UNAVAILABLE`: both are webhook-only to a public HTTPS
  endpoint, which a desktop LIVETAP cannot receive. Chat write and moderation still work on Kick.
- Twitch `pkce` is `UNAVAILABLE`: Twitch documents no PKCE. Desktop uses the device code grant.
- Facebook `chatWrite` is `EXPERIMENTAL` and `moderation` is `UNAVAILABLE`: the live-comment write
  edge and the `blocked_users` contract could not be verified.
- X is `USER_ASSISTED` end to end, and its `broadcast.read` / `broadcast.write` scopes are
  deliberately never requested: they are grantable but no documented endpoint consumes them.

---

## 3. The credential model

**Adapters never hold secrets.**

```
UI / orchestrator  ──CredentialRef──>  Adapter  ──tokenProvider(ref)──>  SecureStore
   (ids only)                        (no secrets)                    (the only secret holder)
```

- `CredentialRef` is an opaque handle plus non-secret display data (`id`, `platform`,
  `accountId`, `accountLabel`, `expiresAt`, `scopes`). It is safe to put in renderer state, logs
  and snapshots.
- Every real adapter is constructed with
  `{ fetch, tokenProvider: (credential) => Promise<string>, apiBase?, ... }`. The adapter calls
  `tokenProvider` **per request**, so refresh, rotation and revocation are entirely the store's
  problem. An adapter that cached a token would break Twitch's single-use refresh tokens.
- The platform SecureStore is the only component that persists tokens: OS keychain on desktop,
  encrypted server-side storage on web. Refresh-token rotation must be persisted atomically —
  Twitch device-code refresh tokens are single-use and expire after 30 days of inactivity, and
  Kick returns a new refresh token on every refresh.
- **Stream keys are secrets too.** They live only inside `IngestTarget`, they never enter
  snapshots, and `redact()` in `real/http.ts` strips bearer tokens, `key=`/`token=`/`secret=`
  parameters and RTMP path keys out of every error message before it can reach a log. Core's
  `redactIngest()` does the same for diagnostics. Tests assert that a leaked key in an error body
  comes back as `••••`.
- Single-use keys are never stored at all: Instagram and TikTok rotate the key every session, so
  the UI asks for a fresh paste per broadcast instead of remembering one.

`fetch` is injected too, which is what makes the real adapters unit-testable against a recorded
fake (`testing/fakeFetch.ts`) with zero network and zero dependencies.

---

## 4. OAuth per platform

`oauth/` is pure: `generatePkce()`, `buildAuthorizeUrl()`, `parseCallback()` and a table of
per-platform endpoints, default scopes and PKCE support. No network, no storage, no globals.
`buildAuthorizeUrl` only emits `code_challenge` when the platform documents PKCE, so LIVETAP
never sends one to Twitch and never omits one where it is mandatory.

| Platform | Desktop | Web | Notes |
|---|---|---|---|
| **YouTube** | Authorization code + **PKCE (S256)** with a loopback redirect (`http://127.0.0.1:<port>`) | Server-side code exchange with the client secret | OOB is dead and custom schemes are deprecated. `access_type=offline&prompt=consent` for a refresh token. `youtube.force-ssl` is sensitive, so a public app needs Google OAuth verification **and** a YouTube compliance audit for quota. |
| **Twitch** | **Device code grant** (`https://id.twitch.tv/oauth2/device`) | Authorization code, secret server-side | Twitch documents no PKCE, so authorization code from a desktop binary would mean shipping a secret. Device-code refresh tokens are single-use with a 30-day inactivity expiry. |
| **Kick** | Authorization code + **PKCE (mandatory)** with a **server-side token exchange** | Authorization code + PKCE, secret server-side | Kick requires `client_secret` at the token endpoint *even with* PKCE — there is no public-client mode, so a LIVETAP-operated exchange is required. Use `http://localhost/...`, not `127.0.0.1`. `state` is required. |
| **Facebook** | Loopback redirect + **server-side** code exchange and long-lived-token exchange | Server-side code flow | PKCE is documented for the OIDC flow only; secret-less Graph auth is unverified. Never ship the app secret in a desktop build. Login for Business uses a `config_id` instead of a scope list. |
| **Instagram** | Server-side exchange (no PKCE documented) | Server-side code flow | Authorizes comment/status reads only — **never** going live. |
| **TikTok** | Authorization code + **PKCE, hex-encoded challenge** | Server-side code flow | TikTok's documented deviation from RFC 7636: the challenge is the SHA-256 **hex** digest. Parameter is `client_key`. There is no live scope, so this is only worth shipping alongside VOD publishing. |
| **X** | Authorization code + PKCE | Same | Only useful for the optional, metered "replies to the announcement Post" panel. Never request `broadcast.*`. |
| **LinkedIn** | Blocked: PKCE is a separate `native-pkce` endpoint LinkedIn enables per app on request | Server-side, partner-approved app | Shipped disabled. Member and organization live scopes cannot be combined in one request. |
| **Custom** | — | — | No account, no OAuth. |

The **web app runs the code exchange on Vercel** (serverless function holding the client secrets
for Kick, Facebook and the YouTube web client); the **desktop app uses a loopback PKCE redirect**
for YouTube, device code for Twitch, and calls the same hosted exchange for Kick and Facebook.
The desktop binary ships no usable secret.

---

## 5. Mock-mode isolation

> **Mock mode may never masquerade as production, and production may never depend on mock code.**

Enforced by construction:

1. `MockDestinationAdapter` forces `profile.mock = true` even when handed a production profile.
   `mockProfile(id)` copies the honest profile and flips the flag; the real profiles keep
   `mock: undefined` and a test asserts it.
2. Every mock ingest is a `.livetap.local` address (`rtmp://mock.<platform>.livetap.local/live`),
   every watch URL is `https://mock.livetap.app/<platform>/<id>`, every `BroadcastHandle` carries
   `mock: true`, and every `ChatMessage` carries `mock: true`.
3. `DestinationConfig.mock` and `DestinationSnapshot` flow through the orchestrator unchanged, so
   the UI can badge every mock destination and display `MOCK_BANNER` —
   *"Mock mode — no real platforms are connected"*.
4. Mock adapters make **no network calls at all**. There is no `fetch` in their constructor.
5. `createMockAdapters()` is the single construction point for mock adapters, and it is the only
   place that builds a full nine-platform registry. Production wiring builds its registry from
   `real/` + `custom/`.
6. Mocks honour the real capability matrix. A mock TikTok still has no chat; a mock YouTube still
   needs `startBroadcast`. That means mock mode exercises the same capability-gated code paths as
   production, which is the whole point of having it.

Mock behaviour is scriptable and deterministic: `MockScenario` takes `seed`, `latencyMs`,
`chatRateMs`, `failValidate` and `failCreate` (an `ErrorCode` that is thrown in an HTTP-ish shape
so `classifyFailure` maps it straight back to the same code), plus injectable `now` and `timers`.
The PRNG is a 20-line mulberry32, so a demo recorded with `seed: 99` replays message for message.

---

## 6. What exists today

| Module | Kind | Network |
|---|---|---|
| `profiles/` | 9 honest `PlatformProfile`s, `PLATFORM_PROFILES`, `getProfile`, `mockProfile` | none |
| `mock/` | `MockDestinationAdapter`, `createMockAdapters`, `MOCK_BANNER`, mulberry32, chat corpus | none |
| `custom/` | `CustomRtmpAdapter` — real, validates via core's `validateIngest` | none |
| `real/` | `YouTubeAdapter`, `TwitchAdapter`, `KickAdapter`, `FacebookAdapter`, shared `http.ts` | injected `fetch` |
| `oauth/` | `generatePkce`, `buildAuthorizeUrl`, `parseCallback`, per-platform endpoint table | none |
| `testing/` | `createFakeFetch` — recorded fake for adapter tests | none |

Not implemented, deliberately: Instagram, TikTok and X have no control plane to implement, and
LinkedIn is partner-gated. The three paste-the-key platforms ship by giving `CustomRtmpAdapter`
their own honest profile, so they register under their real platform id and keep their real
capability matrix while only ever pushing bytes:

```ts
registry.register(new CustomRtmpAdapter(getProfile('tiktok')));
```

That is why `CustomRtmpAdapter` takes a profile instead of hard-coding `customProfile`. An
approved LinkedIn partner can use the same path with an ingest URL they registered themselves.
 Kick has no `subscribeChat` because Kick chat read does not exist
outside a public webhook. YouTube `publishThumbnail` throws rather than pretending: it needs the
multipart media-upload host, which is not wired up yet.

### Adding a platform

1. Research it against official docs and write the findings into `docs/research/`.
2. Add a `PlatformProfile` with **every** `CapabilityKey` classified, honest
   `connectionSummary`/`eligibilityNotes`, and encoder numbers marked `UNVERIFIED` in comments
   where the source is secondary.
3. Add it to `PLATFORM_IDS` in core and to `PLATFORM_PROFILES`.
4. Implement only the methods whose capabilities are automated.
5. Add an `oauth/endpoints.ts` entry, or `undefined` if the platform has no OAuth.
6. Write the request-sequence test against `createFakeFetch`, including the `401` mapping.
