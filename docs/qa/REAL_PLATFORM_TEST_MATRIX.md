# Real platform test matrix

Written 2026-09-14 on the build host (headless Windows Server 2022 VM, no
camera, no GPU, **no platform credentials of any kind**).

This table records what has been **run against the real platform**. It is not a
capability matrix; that is
`docs/research/PLATFORM_CAPABILITY_MATRIX.md`, and it describes what each
platform's API can do. This file describes what LIVETAP has been observed
doing, which today is a much shorter list.

---

## Status vocabulary

| Status | Means |
|---|---|
| **PASS** | run against the real thing on this host, and it worked |
| **PARTIAL** | run, and it did some of what the cell claims. The cell says which part |
| **EXTERNALLY BLOCKED** | cannot be run here without something only the owner can supply. The cell names it |
| **UNAVAILABLE** | the platform offers no mechanism for a third-party app. Nothing to test, now or later |
| **UNVERIFIED** | code exists and has not been run against the real platform. This is the honest default and most of this table is it |

**UNVERIFIED is not a synonym for broken.** Every real adapter has unit tests
against recorded fakes, and the OAuth flow is exercised end to end against a
local identity provider that genuinely verifies PKCE. What none of that
establishes is that Google, Twitch, Kick or Meta accept these exact requests.
Only a real credential does, and there is none on this host. See
`docs/OWNER_ACTIONS.md` for what supplies one.

**What "proven against the local harness" means, and does not.**
`infra/dev-harness/fake-idp/` is a real HTTP server that recomputes the PKCE
challenge, enforces single-use 60-second authorization codes, rotates refresh
tokens, serves YouTube-shaped and Twitch-shaped API responses including
`errorStreamInactive`, and injects 401, 429 and 500 faults. Passing against it
proves LIVETAP's half of the conversation is correct. It cannot prove the other
half. Those cells are UNVERIFIED with a note, never PASS.

### Proven against the harness — the desktop sign-in, end to end, 2026-09-15

`node apps/desktop/e2e/oauth.mjs` (`npm run e2e:oauth -w @livetap/desktop`) is the
first run in this repository's history in which the **built desktop application**
was launched, the **YouTube row of its own Add destination sheet** was tapped, and
a destination reached READY carrying an account name, with no stream key typed and
nothing simulated. Read that file's header before quoting anything from here: it
lists, link by link, what was real and what was redirected.

**Real in that run.** The `window.livetap.oauth` contextBridge IPC; the main
process's RFC 8252 loopback listener and its state check; `generatePkce`,
`buildAuthorizeUrl` and the authorize URL's entire query string; the fake IdP's
own consent page and `/authorize/decision`; the **real** Vercel handlers from
`apps/web/api/oauth/*.ts` and `apps/web/api/_lib/broker.ts`, bundled from source
and executed unmodified; constant-time S256 PKCE verification; the Electron
`safeStorage` vault; `tokenProviderFor`'s renewal; `YouTubeAdapter.validate`'s
account lookup; and the real Destinations screen, store and orchestrator, with no
test hooks and no injected registry.

**Redirected, and only this.** (1) `shell.openExternal` was replaced in the main
process so the harness could play the human who opens a browser and presses
Approve — the renderer bridge, the IPC and main's own `isHttpsUrl` /
`isExternallyOpenable` guards all still ran. (2) `accounts.google.com` and
`www.googleapis.com/youtube/v3` were pointed at the harness, the second by a
`window.fetch` wrapper because `apps/web/src/state/registry.ts` gives
`YouTubeAdapter` no `apiBase` seam. (3) The broker spoke TLS on loopback with a
certificate generated for the run and pinned by SPKI, because the renderer is a
`file://` document under the production CSP and that CSP refuses plain http —
measured, not assumed. (4) `Sec-Fetch-Site` was dropped for the second half of the
run, after the first half had measured what happens when it is not.

**What the run measured, with the identity provider's own control surface as the
authority rather than the UI:** exactly one authorization code issued and
exchanged exactly once; the code bound to a PKCE challenge and to the loopback
redirect the app actually opened; the state the IdP received identical to the one
the main process generated; the loopback listener refusing both a forged state and
a missing one (HTTP 400 twice); one live grant with a refresh token; the account
name on the card matching the one the IdP issued; the token renewed on its own when
it aged into the 60 s margin, with the refresh token rotated and the new one kept;
and no access token, refresh token, authorization code or PKCE verifier anywhere in
the renderer console, the main process output, the page text or `localStorage` —
checked against the exact strings the broker saw in transit.

**It still cannot prove Google accepts these requests.** Every YouTube cell below
stays UNVERIFIED.

**And it fails.** The run ends FAIL, on four defects it measured rather than
inferred. They belong to other workstreams' files and are recorded here, not fixed:

| Severity | Where | What |
|---|---|---|
| CRITICAL | `apps/web/src/state/mockMode.ts:48`; `VITE_LIVETAP_BROKER_URL` is set by no build in this repo | The shipped desktop renderer folds `brokerBaseUrl()` to `""`, so every broker call resolves against `file://`. On an installed build, Connect account can only answer "no sign-in set up" and drop the creator on the paste-a-key form. `apps/web/.env.example` documents the variable and leaves it empty; `apps/desktop/scripts/build-renderer.mjs` passes only `VITE_LIVETAP_MOCK_MODE`. The Android build has the same gap |
| CRITICAL | `apps/web/api/_lib/broker.ts:579` (`assertSameOrigin`) | Chromium sends `Sec-Fetch-Site: cross-site` from a `file://` renderer, so the broker answers 403 to every desktop request. The sign-in completes at the platform and dies at the code exchange. The `Origin` half of that function is already documented as deliberately permissive for the desktop app; the `Sec-Fetch-Site` half was not given the same exemption |
| CRITICAL | `apps/web/src/state/store.ts:800` (`disconnect`) | Disconnect account revokes nothing: `revokeTokens()` has no caller outside its own test, so the grant stays live at the platform. Measured: 0 calls to `/api/oauth/revoke`, 0 grants revoked |
| CRITICAL | `apps/web/src/state/store.ts:800` (`disconnect`) | …and deletes nothing: the access and refresh tokens are still in the device vault under `oauth:youtube` afterwards. The confirmation the creator reads says "LIVETAP tells YouTube to forget it, deletes what it kept on this device" |
| HIGH | `apps/web/src/state/tokens.ts:227` (`tokenProviderFor`) + `packages/adapters/src/real/http.ts:98` | A token that dies *before* its stated expiry is never renewed: renewal is on the clock only and nothing retries a 401 with a fresh token, though the doc comment says it does. That is Google's Testing-status behaviour every seven days — the creator is signed out with a valid refresh token sitting in the vault |

Re-run it with `npm run e2e:oauth -w @livetap/desktop`. It needs nothing running
beforehand, assembles its own copy of the app rather than writing to
`apps/desktop/dist`, and takes the broadcast run lock because the app holds a
single-instance lock.

---

## The matrix

Columns, per destination: whether the OAuth exchange has been run; whether an
account was connected and identified; broadcast creation; the stream credential
(key or ingest URL); start; live status; stop; reconnect after a real drop;
chat; analytics; what the creator still has to do by hand; and what the
platform will not let LIVETAP do at all.

### YouTube

| Column | Status | What was actually observed |
|---|---|---|
| OAuth | UNVERIFIED | Authorization code + PKCE S256 with a loopback redirect runs end to end against the local IdP (33 tests, 2026-09-14). No Google client id exists on this host |
| Account connected | UNVERIFIED | the adapter fetches the channel identity and the account summary reaches the destination card against the fake. Never against a real channel |
| Broadcast creation | UNVERIFIED | `liveBroadcasts.insert` and `liveStreams.insert` are implemented against recorded fakes |
| Stream credential | UNVERIFIED | read from `cdn.ingestionInfo.rtmpsIngestionAddress` + `streamName`. Never seen a real one |
| Start | UNVERIFIED | bind, then poll `streamStatus` until `active`, then transition. The `errorStreamInactive` path is exercised against the fake |
| Live status | UNVERIFIED | `videos.liveStreamingDetails` |
| Stop | UNVERIFIED | transition to `complete` |
| Reconnect | UNVERIFIED | the reconnect state machine is proven against a real dropped TCP connection on a local server, not against YouTube's ingest |
| Chat | UNVERIFIED | `liveChatMessages` read and write implemented |
| Analytics | UNVERIFIED | concurrent viewers from `liveStreamingDetails` |
| Manual steps for the creator | **none** | the creator never sees a stream key |
| Limitations | — | vertical 9:16 has no API. Quota is unit-based and live-method costs are absent from Google's own table. Testing-status authorizations expire after 7 days |
| **Overall** | **UNVERIFIED** | needs `LIVETAP_YOUTUBE_CLIENT_ID` and a channel with live enabled |

### Twitch

| Column | Status | What was actually observed |
|---|---|---|
| OAuth | UNVERIFIED | device code grant implemented; `POST /api/oauth/device` exists. Exercised against the local IdP only |
| Account connected | UNVERIFIED | — |
| Broadcast creation | **UNAVAILABLE** | Twitch has no broadcast object. There is nothing to create and nothing to test |
| Stream credential | UNVERIFIED | `GET /streams/key`. The ingest host must come from `GET https://ingest.twitch.tv/ingests` `url_template_secure`, never a hardcoded constant |
| Start | **UNAVAILABLE** | no start endpoint exists for apps. The stream begins when video arrives |
| Live status | UNVERIFIED | EventSub `stream.online` and `stream.offline` |
| Stop | **UNAVAILABLE** | no stop endpoint exists. The stream ends when video stops |
| Reconnect | UNVERIFIED | — |
| Chat | UNVERIFIED | EventSub WebSocket read, Helix `POST /chat/messages` write |
| Analytics | **UNAVAILABLE** | Twitch publishes no per-stream viewer history to apps. Any graph would be LIVETAP's own measurements, and is labelled as such |
| Manual steps for the creator | **none** | |
| Limitations | — | no PKCE anywhere in Twitch's docs. Refresh tokens are single use and die after 30 days idle. No thumbnail upload for any app |
| **Overall** | **UNVERIFIED** | needs `LIVETAP_TWITCH_CLIENT_ID`. This is the cheapest platform to make real: no review, no queue |

### Kick

| Column | Status | What was actually observed |
|---|---|---|
| OAuth | UNVERIFIED | authorization code + mandatory PKCE, exchange through the broker because Kick requires a client secret |
| Account connected | UNVERIFIED | — |
| Broadcast creation | **UNAVAILABLE** | Kick has no broadcast object |
| Stream credential | UNVERIFIED | `GET /public/v1/channels` gated by `streamkey:read`. **There is an open Kick bug where `stream.key` and `stream.url` come back empty while the channel is offline**, which is exactly LIVETAP's state when it needs them. The paste fallback stays until one empirical test says otherwise. That test is owner action 3 |
| Start | **UNAVAILABLE** | starts when video arrives |
| Live status | UNVERIFIED | `livestream.status.updated` webhook |
| Stop | **UNAVAILABLE** | no stop endpoint |
| Reconnect | UNVERIFIED | — |
| Chat | **EXTERNALLY BLOCKED** | Kick delivers chat by inbound webhook only. A desktop-only build has no public URL to receive one, so Kick chat needs hosted or self-hosted LIVETAP. There is no `chat:read` scope and no polling endpoint |
| Analytics | **UNAVAILABLE** | Kick has no stats API |
| Manual steps for the creator | possibly pasting the key | depends on the offline-key test |
| Limitations | — | rate limits are not documented at all; only 429 responses are declared. The consent screen lets the creator untick `streamkey:read` |
| **Overall** | **UNVERIFIED** | needs `LIVETAP_KICK_CLIENT_ID` and `LIVETAP_KICK_CLIENT_SECRET` |

### Facebook

| Column | Status | What was actually observed |
|---|---|---|
| OAuth | UNVERIFIED | code exchange and long-lived-token exchange both server side |
| Account connected | UNVERIFIED | — |
| Broadcast creation | UNVERIFIED | `POST /{target}/live_videos` with `status=LIVE_NOW` |
| Stream credential | UNVERIFIED | `secure_stream_url`. Expires unused after 24 hours; a used one lasts up to 8 |
| Start | UNVERIFIED | implicit with `LIVE_NOW` |
| Live status | UNVERIFIED | — |
| Stop | UNVERIFIED | `POST /{id}?end_live_video=true` |
| Reconnect | UNVERIFIED | `enable_backup_ingest` and `secure_stream_secondary_urls` exist and are not yet used |
| Chat | UNVERIFIED | SSE on `streaming-graph.facebook.com`. Write and moderation are undocumented enough that the product ships read-only and degrades visibly |
| Analytics | UNVERIFIED | `LiveVideoInputStream.stream_health` |
| Manual steps for the creator | **none**, once approved | |
| Limitations | — | App Review of the Live Video API plus Business Verification gate every non-role user. Account 60+ days old and Page 100+ followers, enforced since 2024-06-10. Max 8 hours. `GET` is unsupported on the `/live_videos` edges. Crossposting fails silently |
| **Overall** | **EXTERNALLY BLOCKED** | works for a role-holder immediately, for anyone else only after Meta's review. **Also blocked on a policy question**: Meta's Live Video API FAQ is indexed with language prohibiting simulcasting Facebook live video to third-party sites, and that page could not be read by machine. Get a written answer before App Review |

### Instagram

| Column | Status | Note |
|---|---|---|
| OAuth | **UNAVAILABLE** for live | Instagram Business Login authorizes reading live comments and probing live status. **No scope authorizes going live** |
| Broadcast creation, start, stop | **UNAVAILABLE** | no live API exists in either Instagram API flavour |
| Stream credential | UNVERIFIED | pasted by the creator from Live Producer. Single use, per session, never persisted |
| Live status | UNVERIFIED | readable through the comments API surface |
| Reconnect | UNVERIFIED | the key may not survive a reconnect; a new session means a new key |
| Chat | UNVERIFIED | `live_comments` webhook, live window only, no backfill, no moderation |
| Analytics | **UNAVAILABLE** | |
| Manual steps | **every session**: desktop browser, Live Producer, copy URL and key, paste, and **press Go live in Instagram's tab** | |
| **Overall** | **PARTIAL** | the bytes path is the Custom RTMP path and is proven; everything around it is the creator's hands |

### TikTok

| Column | Status | Note |
|---|---|---|
| OAuth | **UNAVAILABLE** for live | TikTok's OAuth is good and grants no live capability. There is no live scope, no live endpoint, no live webhook |
| Broadcast creation, start, stop, live status, chat, analytics | **UNAVAILABLE** | none of these exist for any third-party app |
| Stream credential | UNVERIFIED | pasted from LIVE Studio. New one every session |
| Reconnect | UNVERIFIED | |
| Manual steps | **every session**: desktop browser, Go LIVE, category and title, Save and Go LIVE, copy Server URL and Stream key, paste | |
| Limitations | — | if the account has no LIVE access, **no stream key exists at all** and refreshing will not produce one. Some competitors start a TikTok LIVE without a key because TikTok gave them private partner access; LIVETAP has not got it and says so |
| **Overall** | **PARTIAL** | same as Instagram: the bytes are real, the control plane does not exist |

### X

| Column | Status | Note |
|---|---|---|
| OAuth | **UNAVAILABLE** for live, deliberately | X API v2 OAuth exists and is irrelevant. `broadcast.read` and `broadcast.write` are grantable, alarming on the consent screen, and map to no endpoint. LIVETAP requests neither |
| Broadcast creation, start, stop, live status | **UNAVAILABLE** | the Periscope Producer API was cut off 2021-03-31 with no successor |
| Stream credential | UNVERIFIED | created by the creator in Live Studio. Appears long lived and reusable, unlike Instagram's and TikTok's |
| Reconnect | UNVERIFIED | |
| Chat | **UNAVAILABLE** for native live chat | replies to the announcement Post are possible, off by default, and metered: X API v2 has no free tier |
| Analytics | **UNAVAILABLE** | |
| Manual steps | create a Source **and** a Broadcast in Live Studio, paste the key, then **start the broadcast in X**. Pushing bytes alone publishes nothing | |
| Limitations | — | X Premium is required to obtain a stream key. Live Studio is beta and region limited. 16:9 only; other ratios are cropped |
| **Overall** | **PARTIAL** | |

### LinkedIn

| Column | Status |
|---|---|
| Every column | **UNAVAILABLE** |

Not an engineering gap. The Live Events API terms forbid making the integration
available to unaffiliated customers and never contemplate open-source or
self-hosted distribution; admission requires a certification demo video and a
Microsoft OneVet background check; PKCE is enabled per application on request
only. Unlike every other platform there is **no paste fallback**, because
LinkedIn never shows a member a stream key. Recorded as BLOCKERS.md B-003.

### Custom RTMP / RTMPS / SRT / WHIP

This is the only row with real results, because it is the only destination that
needs nothing from anybody.

| Column | Status | What was actually observed, on this host |
|---|---|---|
| OAuth | **UNAVAILABLE**, by design | no account exists |
| Account connected | **UNAVAILABLE**, by design | |
| Broadcast creation | **UNAVAILABLE**, by design | |
| Stream credential | **PASS** | pasted into the real form, validated by `validateIngest`, stored through the desktop vault |
| Start | **PASS** | measured 2026-09-14 12:43. Two real RTMP publishers on `127.0.0.1:1935`, one at 1920x1080 and one at 1080x1920, both H.264 + AAC 48 kHz stereo, confirmed by MediaMTX's control API and decoded independently by ffprobe |
| Live status | **PARTIAL** | LIVETAP reports what the sender can see: bytes accepted, rate, connection state. It does **not** claim anyone is watching, because for a custom destination that information does not exist |
| Stop | **PASS** | END removed every publisher from the server; recordings finalised and decoded as H.264 + AAC at both shapes |
| Reconnect | **PASS** | `kill-publisher.mjs` dropped a real TCP connection with frames in flight. The surviving destination's byte count kept climbing through the failure, 1,237,654 to 1,542,861 bytes, and the app went on reporting a live broadcast |
| Chat | **UNAVAILABLE**, by design | |
| Analytics | **UNAVAILABLE**, by design | |
| Manual steps | paste an address and a key | |
| Limitations | — | LIVETAP cannot know the far end's rules. Auto-live semantics vary: Twitch, Kick and Facebook `LIVE_NOW` start on data, YouTube needs an explicit transition, X and Instagram need a human |
| **Overall** | **PASS**, with one live regression | see the note below |

**The regression, stated exactly.** The PASS above was measured at 12:43
against the renderer bundle built at 11:01. A rebuild at 13:02 of the same
source tree **fails the same test**: both destinations enter RECONNECTING with
"The stream URL or key is empty or malformed" and no publisher ever connects.
The mechanism is in `apps/web/src/state/registry.ts`: when `mockMode` is true,
`createRegistry` returns `createMockAdapters()` for the **whole** registry,
including `custom`. A Custom RTMP destination needs no credentials and is the
one path that works with nothing configured, so simulating it turns the app's
own "LIVETAP is not broadcasting anywhere" banner into the truth even when the
creator pasted a real address. Compounding it, `apps/desktop/package.json`'s
`build:renderer` runs a bare `vite build` with `VITE_LIVETAP_MOCK_MODE` unset,
so the desktop app ships in mock mode by default; the Android build script
already sets it to `false` (`apps/mobile/scripts/build-android.sh:57`). Both are
other workstreams' files and are recorded as handoffs, not fixed here.

---

## How to re-run this

```bash
node infra/dev-harness/ingest/selftest.mjs            # is the receiver honest?
npm run verify:broadcast                              # the whole chain, one exit code
npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts
```

For the platform rows, there is nothing to re-run until a credential exists.
The moment one does, the first thing to run is Twitch: no review, no queue, and
the fastest path from UNVERIFIED to PASS on this page.
