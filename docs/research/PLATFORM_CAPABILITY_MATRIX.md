# LIVETAP PLATFORM CAPABILITY MATRIX (canonical)

**Status:** DONE — synthesis of `PLATFORM_YOUTUBE_TWITCH_KICK.md`, `PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md`, `PLATFORM_X_LINKEDIN_OTHERS.md`.
**Synthesised:** 2026-09-11. No new research; contradictions resolved from the source docs only.
**Authority:** this file is the single source of truth for `PlatformProfile.capabilities` in `packages/core/src/types/destination.ts`. Columns are **exactly** the 19 `CapabilityKey` values; cells are **exactly** the 7 `CapabilityClass` values.
**Related ADRs:** ADR-006 (capability-driven adapters), ADR-010 (MVP destination set), ADR-011 (Automatic Production), ADR-012 (universal transport).

**Honesty rules carried forward.** A cell marked `†` rests on evidence the source research could not confirm against an official page — the classification is a *decision under uncertainty*, listed again in Section E. Nothing here was inferred or invented; every classification traces to one of the three source documents.

---

## SECTION A — MASTER MATRIX

One matrix, split into four column blocks for legibility. Row set is identical in every block. Blocks cover all 19 capability keys exactly once: A.1 (2) + A.2 (9) + A.3 (4) + A.4 (4) = 19.

Class vocabulary (from `CAPABILITY_CLASSES`):

| Class | Meaning for LIVETAP | Automated? |
|---|---|---|
| `NATIVE_API` | A documented public endpoint does the thing end to end | yes |
| `OAUTH_API` | Needs a user OAuth token plus documented API calls | yes |
| `RTMP_DESTINATION` | Achieved only by pushing bytes to an ingest endpoint; no control plane | yes |
| `USER_ASSISTED` | A human must act in the platform's own UI | no |
| `PARTNER_APPROVAL_REQUIRED` | Exists, gated behind a private/partner programme or review | no |
| `EXPERIMENTAL` | Exists but beta / limited / undocumented for third parties | no |
| `UNAVAILABLE` | No mechanism exists for a third-party app | no |

`AUTOMATED_CLASSES` = {`NATIVE_API`, `OAUTH_API`, `RTMP_DESTINATION`} — the UI may promise these; it must never promise the others.

### A.1 Authentication

| Platform | oauth | pkce |
|---|---|---|
| YouTube | `OAUTH_API` | `OAUTH_API` [1] |
| Twitch | `OAUTH_API` | `UNAVAILABLE` [2] |
| Kick | `OAUTH_API` | `OAUTH_API` [3] |
| Facebook | `OAUTH_API` | `OAUTH_API` † [4] |
| Instagram | `OAUTH_API` | `UNAVAILABLE` [5] |
| TikTok | `OAUTH_API` | `OAUTH_API` [6] |
| X | `OAUTH_API` | `OAUTH_API` [7] |
| LinkedIn | `OAUTH_API` [8] | `PARTNER_APPROVAL_REQUIRED` [8] |
| Custom RTMP/SRT/WHIP | `UNAVAILABLE` [9] | `UNAVAILABLE` [9] |

### A.2 Broadcast lifecycle

| Platform | broadcastCreation | streamCreation | streamKey | start | stop | metadata | thumbnail | scheduling | liveStatus |
|---|---|---|---|---|---|---|---|---|---|
| YouTube | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` [10] | `NATIVE_API` [11] |
| Twitch | `RTMP_DESTINATION` [12] | `RTMP_DESTINATION` [12] | `NATIVE_API` | `RTMP_DESTINATION` [12] | `RTMP_DESTINATION` [12] | `NATIVE_API` | `UNAVAILABLE` [13] | `NATIVE_API` † [14] | `NATIVE_API` |
| Kick | `UNAVAILABLE` [12] | `UNAVAILABLE` [12] | `OAUTH_API` † [15] | `RTMP_DESTINATION` [12] | `RTMP_DESTINATION` [12] | `NATIVE_API` | `UNAVAILABLE` | `UNAVAILABLE` | `NATIVE_API` |
| Facebook | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` [16] | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` [17] | `NATIVE_API` † [18] | `NATIVE_API` [19] |
| Instagram | `UNAVAILABLE` | `UNAVAILABLE` | `USER_ASSISTED` [20] | `USER_ASSISTED` [21] | `USER_ASSISTED` | `USER_ASSISTED` | `UNAVAILABLE` | `UNAVAILABLE` | `NATIVE_API` [22] |
| TikTok | `PARTNER_APPROVAL_REQUIRED` [23] | `PARTNER_APPROVAL_REQUIRED` [23] | `USER_ASSISTED` [24] | `USER_ASSISTED` | `USER_ASSISTED` | `USER_ASSISTED` | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` |
| X | `USER_ASSISTED` [25] | `USER_ASSISTED` [25] | `USER_ASSISTED` [26] | `USER_ASSISTED` [25] | `USER_ASSISTED` | `USER_ASSISTED` | `USER_ASSISTED` † | `USER_ASSISTED` † | `UNAVAILABLE` |
| LinkedIn | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` [27] | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` [28] | `PARTNER_APPROVAL_REQUIRED` [29] |
| Custom RTMP/SRT/WHIP | `UNAVAILABLE` | `UNAVAILABLE` | `USER_ASSISTED` | `RTMP_DESTINATION` | `RTMP_DESTINATION` | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` | `RTMP_DESTINATION` [30] |

### A.3 Audience surfaces

| Platform | chatRead | chatWrite | moderation | analytics |
|---|---|---|---|---|
| YouTube | `NATIVE_API` [31] | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` [32] |
| Twitch | `NATIVE_API` [33] | `NATIVE_API` | `NATIVE_API` | `NATIVE_API` [34] |
| Kick | `NATIVE_API` [35] | `NATIVE_API` | `NATIVE_API` [36] | `UNAVAILABLE` [37] |
| Facebook | `NATIVE_API` [38] | `EXPERIMENTAL` † [39] | `EXPERIMENTAL` † [40] | `NATIVE_API` † [41] |
| Instagram | `OAUTH_API` [42] | `EXPERIMENTAL` † [43] | `UNAVAILABLE` [44] | `UNAVAILABLE` |
| TikTok | `UNAVAILABLE` [45] | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` |
| X | `UNAVAILABLE` [46] | `UNAVAILABLE` [46] | `UNAVAILABLE` [46] | `USER_ASSISTED` [47] |
| LinkedIn | `PARTNER_APPROVAL_REQUIRED` [48] | `PARTNER_APPROVAL_REQUIRED` [48] | `PARTNER_APPROVAL_REQUIRED` | `PARTNER_APPROVAL_REQUIRED` [49] |
| Custom RTMP/SRT/WHIP | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` |

### A.4 Format and transport

| Platform | vertical916 | rtmps | srt | whip |
|---|---|---|---|---|
| YouTube | `EXPERIMENTAL` [50] | `NATIVE_API` [51] | `UNAVAILABLE` | `UNAVAILABLE` |
| Twitch | `USER_ASSISTED` [52] | `RTMP_DESTINATION` † [53] | `UNAVAILABLE` | `UNAVAILABLE` [54] |
| Kick | `UNAVAILABLE` † [55] | `RTMP_DESTINATION` † [56] | `UNAVAILABLE` † | `UNAVAILABLE` |
| Facebook | `RTMP_DESTINATION` [57] | `RTMP_DESTINATION` [58] | `UNAVAILABLE` | `UNAVAILABLE` |
| Instagram | `RTMP_DESTINATION` [59] | `RTMP_DESTINATION` † [60] | `UNAVAILABLE` | `UNAVAILABLE` |
| TikTok | `RTMP_DESTINATION` [61] | `RTMP_DESTINATION` † [60] | `UNAVAILABLE` | `UNAVAILABLE` |
| X | `UNAVAILABLE` [62] | `RTMP_DESTINATION` † [63] | `UNAVAILABLE` | `UNAVAILABLE` |
| LinkedIn | `UNAVAILABLE` [64] | `RTMP_DESTINATION` [65] | `UNAVAILABLE` | `UNAVAILABLE` |
| Custom RTMP/SRT/WHIP | `RTMP_DESTINATION` [66] | `RTMP_DESTINATION` | `RTMP_DESTINATION` | `RTMP_DESTINATION` [67] |

### A.5 Gates (short text)

| Platform | Application Review | Eligibility | Regional Restrictions | Account Restrictions |
|---|---|---|---|---|
| YouTube | **Two gates:** Google OAuth app verification (sensitive scopes, annual re-verification + CASA for restricted) **and** a separate YouTube API Services compliance audit to exceed default quota. No published SLA. | 16+, channel verified, no live restriction in past 90 days. 10 active streams/channel, 3 per stream key. | None documented at API level † (vertical-live beta region-limited, secondary) | A community-guidelines strike blocks live for 14 days; circumvention can terminate the account. |
| Twitch | None. Apps are created instantly; 2FA required on the account. | None. Affiliate/Partner needed only for 1440p/HEVC and transcoding. | None documented † | Suspensions are account-level, resolved in Twitch's UI. |
| Kick | None to start. Optional email verification (developers@kick.com) raises the `chat.message.sent` cap 1,000 → 10,000. | Kick account with **2FA enabled** to reach the Developer tab. | None documented † | Handled in Kick's UI. |
| Facebook | **Hard gate:** App Review of the "Live Video API" feature **plus Business Verification**; additional contracts may be required. Unapproved apps work only for users with a role on the app. | Account ≥ 60 days old; Page or professional-mode profile ≥ 100 followers (since 2024-06-10). | None global † (`targeting` restricts *your* audience, not you) | Personal profiles need professional mode; Page publishing needs the `CREATE_CONTENT` task. |
| Instagram | Only for the read/comment APIs. **Going live has no API to review.** | Public account with ≥ 1,000 followers to create a Live (since Aug 2025, secondary-sourced). Live Producer is "limited access at this time". | None documented † | Public account mandatory; private accounts cannot go live. |
| TikTok | Login Kit review; Content Posting API audit. **No published application route for live access at all.** | ~1,000 followers, 18+ for the stream-key path (secondary †). No LIVE access ⇒ **no stream key exists**. | **Yes, official:** "access requirements may vary depending on your country/region". | Good standing; RTMP/third-party permission is gated separately from LIVE itself. |
| X | **None — there is no partner programme to apply to.** | X Premium or Premium+ and a verified account to obtain a stream key (secondary, consistent). | Live Studio is beta and region-limited; the RTMP source region is chosen at creation. | Free/Basic accounts cannot obtain a stream key. |
| LinkedIn | **Two stacked gates:** Live Events API Program (Development Tier → certification demo video → Standard Tier) plus Microsoft OneVet background verification. Dev Tier ≈ 100 requests/day. | > 150 followers/connections, account or Page ≥ 30 days old, good standing. Checkable via `GET /v2/contentAccess/...` (200/404). | **Not available in mainland China.** Ingest regions: US ×5, South America, North/West Europe — **no APAC**. | Member and organization live scopes **cannot be combined** in one authorization. |
| Custom | None. | Whatever the target platform imposes — LIVETAP cannot know. | None. | None. |

### A.6 Secondary destinations (compact)

| Platform | Class for LIVETAP | Control plane | Transports | Chat | Gate |
|---|---|---|---|---|---|
| **Dailymotion** | `OAUTH_API` | Real API v2: `POST /v2/profiles/{id}/livestreams` (`live.manage`), `GET /v2/livestreams/{id}?fields=ingest.rtmp_url,ingest.srt_url` (`live.read`); OAuth client_credentials, 30-min JWT | RTMP + **SRT** | none | Paid plan; Account Manager enables live |
| **Vimeo** | `PARTNER_APPROVAL_REQUIRED` | Live API needs Enterprise + allowlisting (contact support with client id) | RTMPS/RTMP/**SRT** | toggle only (`chat_enabled`), no message API | Enterprise + allowlist |
| **Rumble** | `USER_ASSISTED` | none — key read from the Live Dashboard by a human | RTMP | read-only polled JSON (last 50 chat + Rants) via a secret URL | Open |
| **Amazon IVS** | `RTMP_DESTINATION` (via Custom) | AWS IAM SigV4, `CreateChannel` returns ingestEndpoint + streamKey (1 key/channel) | RTMPS :443, RTMP, **SRT** :9000, **WHIP** `https://global.whip.live-video.net` | full 2-plane chat (`wss://edge.ivschat.<region>.amazonaws.com`) | Open, pay-per-use. Infrastructure, **no audience** |
| **Dead: Trovo** | `UNAVAILABLE` | Live streaming decommissioned 2026-06-30 (Tencent) | — | — | **Do not build** |
| **Dead: DLive** | `UNAVAILABLE` | Service discontinued 2026-04-27 | — | — | **Do not build** |

Also surveyed and rejected for MVP: **Bilibili** (`open-live.bilibili.com` is an in-room interactive-app platform, not an ingest API; review + Chinese-only), **Amazon Live** (Influencer Program only, no public API).

### Footnotes

1. Google documents Authorization Code + PKCE (`S256` or `plain`) for installed apps with a loopback redirect. Desktop clients are still *issued* a client secret; PKCE is what protects the exchange.
2. PKCE / `code_challenge` is **not mentioned anywhere** in Twitch's authentication docs. Device Code Grant is the only secretless flow with refresh.
3. PKCE is **mandatory** on Kick (`code_challenge_method=S256` required), but `client_secret` is **also required** at the token endpoint — so there is no true public-client mode. Desktop needs a token-exchange broker.
4. Documented only for the **OIDC** Code Flow with PKCE (`code_verifier` replaces `client_secret`). Whether Meta supports secret-less PKCE for plain Graph-scope authorization is UNVERIFIED → plan a server-side exchange.
5. Instagram Business Login documents `client_id`, `redirect_uri`, `response_type`, `scope` only; token exchange requires `client_secret`.
6. Required for desktop/mobile. **Non-standard:** TikTok requires the SHA-256 of the verifier in **hex**, not base64url. Web-flow PKCE requirement is UNVERIFIED.
7. X supports only "authorization code with PKCE and refresh token". Auth codes expire in **30 s**; access tokens live 2 h; `offline.access` yields refresh tokens.
8. Standard flow is 3-legged authorization code with `client_secret`. PKCE exists at a **separate** endpoint (`/oauth/native-pkce/authorization`, loopback-only) but LinkedIn must enable it per application on request.
9. A custom destination has no identity layer. LIVETAP stores only the ingest target the user pasted.
10. `snippet.scheduledStartTime` is **mandatory** on `liveBroadcasts.insert` even for "go live now" — pass `now`.
11. `liveStreams.list?part=status` (`status.streamStatus`) and `liveBroadcasts.list?part=status` (`status.lifeCycleStatus`). No push notification exists; it is a poll loop and each poll costs quota.
12. Twitch and Kick have **no broadcast object**. The stream is created implicitly by ingest and ends when bytes stop. LIVETAP's "Go Live" for these is "set metadata, then push"; "End" is "stop pushing".
13. Live thumbnails are auto-captured; `thumbnail_url` is read-only. Do not design an affordance for it.
14. `GET /helix/schedule` is verified. Segment create/update/delete endpoints and their scopes were not verified.
15. Scope `streamkey:read` exists and `endpoints.Stream` on `GET /public/v1/channels` contains `key` and `url`, but the docs never bind the scope to an endpoint and there is no dedicated stream-key endpoint. **Validate empirically; fall back to `USER_ASSISTED` (paste) if the fields come back empty.**
16. `secure_stream_url` (RTMPS with embedded key) is returned at create, plus `secure_stream_secondary_urls` for backup. **The URL expires if unused within 24 h and can be streamed to for up to 8 h.**
17. `schedule_custom_profile_image` is documented for scheduled broadcasts on the user edge. A general "set thumbnail on a running live video" parameter is UNVERIFIED.
18. `status=SCHEDULED_UNPUBLISHED` + `event_params` (up to 7 days ahead) is documented, but the changelog deprecates *the old* scheduling mechanism. Verify against the live Graph API before relying on it.
19. `status` field plus per-input `LiveVideoInputStream.stream_health` (`video_bitrate`, `video_framerate`, `video_gop_size`, `video_width/height`) — the richest ingest telemetry of any platform here.
20. Human copies server URL + key from Live Producer. **The key refreshes every session** — never persist it.
21. Instagram detects the incoming stream; the **human** presses "Go live" in Live Producer. LIVETAP cannot.
22. `GET /{ig-user-id}/live_media` returns media only *while* broadcasting — a crude "am I live?" probe, not history, and not a reliable start signal (propagation delay UNVERIFIED).
23. Streamlabs Desktop goes live to TikTok **without a stream key** after an approved application — proof a private control plane exists. Nothing about it is publicly documented, so it cannot be designed against.
24. New key per session from `livecenter.tiktok.com/producer` or TikTok LIVE Studio. UI path is third-party corroborated only.
25. **X is not auto-live ingest.** Pushing bytes to the X RTMP URL publishes nothing: a Broadcast must be created and started in Live Studio / Media Studio *and* a Post published. Three independent secondary sources agree.
26. Studio → Sources → Create Source → RTMP + region → X displays URL + key. Source keys appear long-lived and reusable; whether X rotates them is UNVERIFIED.
27. The key is embedded in the `ingestUrls[]` returned by `POST /v2/liveAssetActions?action=register`. **Fully dynamic — never hardcode or pattern-validate host/port/path** (observed ports 1935/1936/2935/2936/443).
28. **Mandatory since 2026-06-22:** spontaneous live is gone. "Go live now" = `scheduledAt = now + 60 000 ms`. Go-live window −15 min to +2 h. Max 10 scheduled events/day.
29. `liveVideos.state` + asset recipe status + `contentAccess` together give the best status model of any platform in this report.
30. Sender-side only: LIVETAP knows its own socket state and outbound bitrate. There is no platform confirmation that anyone is watching.
31. Prefer `liveChatMessages.streamList` (server-streaming) over `list` polling — official guidance, and it cuts quota burn. When polling, honour `pollingIntervalMillis`; one poll per chat.
32. Live: `videos.list?part=liveStreamingDetails` → `concurrentViewers` (**field is absent, not 0**, when hidden or empty). Historical: YouTube Analytics `reports.query` with the `liveOrOnDemand` dimension.
33. EventSub **WebSocket** `channel.chat.message` v1. IRC still works but the docs recommend against it. Subscriptions are bound to the socket session — **resubscribe on reconnect**.
34. `GET /helix/analytics/games` returns a **CSV URL** at game level only. **There is no per-stream concurrent-viewer analytics API** — LIVETAP owns the sampling and storage if it draws viewer graphs.
35. **Webhook-only.** No WebSocket, no polling endpoint, no chat history, and no `chat:read` scope. Requires a publicly reachable HTTPS URL; "localhost URLs won't work". This is the #1 blocker for a desktop-only client.
36. Ban `duration` is in **MINUTES** (1–10080) — Twitch uses seconds. A factor-of-60 bug waiting to happen.
37. No analytics API. `viewer_count` is **0 when the streamer hid it** — do not read 0 as "no viewers". `/livestreams/stats` is platform-wide, not per channel.
38. Polling `GET /{id}/comments`, or SSE on **`streaming-graph.facebook.com`** (a different host from `graph.facebook.com`).
39. `POST /{live-video-id}/comments` is the assumed generic Graph pattern, not confirmed on an official live-video edge. Ship the chat panel degrading to read-only.
40. A `blocked_users` edge is referenced in Meta's index but its contract was not readable. Assume LIVETAP cannot reliably ban/timeout on Facebook in v1.
41. Reactions/likes/polls are readable (`/reactions`, `/live_reactions` SSE, `/likes`, `/polls`). Concurrent viewers (`live_views`) is UNVERIFIED — every doc path to the LiveVideo node returned 404.
42. `live_comments` webhook field; notifications arrive **only during** the broadcast and there is **no backfill**.
43. `POST /{ig-comment-id}/replies` exists for IG Media; acceptance of live-media comment ids is UNVERIFIED, and IG Media states "Live video Instagram Media not supported" for some comment operations.
44. Official: "Moderation is not supported by Live Producer at this time."
45. No API and no webhook. Reverse-engineered Webcast clients exist (AGPL, third-party sign server, self-declared not production-ready) — **do not bundle, do not enable by default**; ToS risk lands on the creator's account.
46. The native Live Studio chat has no API. Post replies on the announcement Post are a **different surface** (`GET /2/tweets/search/recent` by `conversation_id`, `POST /2/tweets`, `PUT /2/tweets/{id}/hidden`) — `OAUTH_API`, metered per read, and must never be labelled "X live chat". ⚠️ `broadcast.read` / `broadcast.write` scopes are grantable but map to **no documented endpoint** — do not request them.
47. Live Studio shows concurrents/watch time/geo/device in its own UI. No live-video analytics endpoint; enterprise Analytics is an unrelated, separately gated product.
48. Ordinary post comments via `socialActions/comments` — but that is the separate **Community Management** product, approved separately. `r_member_social_feed` is "granted to select developers only".
49. `videoAnalytics` gives watch time, views, viewers. Likes/comment counts are **not** in it — read them from Social Actions/Social Metadata.
50. **No API surface at all** for aspect or format. Dual horizontal+vertical is Live Control Room / encoder-side behaviour; the Shorts vertical-live feed is reported as closed beta (secondary).
51. `cdn.ingestionInfo.rtmpsIngestionAddress` + `rtmpsBackupIngestionAddress`, returned by the API — hence `NATIVE_API` rather than `RTMP_DESTINATION`.
52. **Dual Format is GA for all streamers as of June 2026**, delivered by Enhanced Broadcasting client-side multi-encode. Configured in the encoder, not via API — LIVETAP must produce the second 9:16 encode itself.
53. Official docs give `rtmp://<ingest-server>/app/<stream-key>`. `rtmps://live.twitch.tv/app` is widely used but is a secondary-source claim.
54. An undocumented 2023 WHIP beta endpoint exists. **Do not build on it.** Enhanced Broadcasting is Enhanced RTMP multitrack, *not* WHIP — a common and expensive misconception.
55. No official developer or help documentation confirming portrait ingest could be retrieved (help.kick.com returned 403 to automated fetch). Classified `UNAVAILABLE` so the UI never promises it; re-verify manually.
56. Secondary sources consistently report `rtmp://ingest.kick.com/live`. RTMPS support is not confirmed by any official source reachable in this pass.
57. Accepted but off-spec: the official reference **recommends 16:9**. Offer a per-destination canvas/crop rather than sending a 9:16 master blindly.
58. **RTMPS is mandatory** — plain RTMP was removed 2019-11-04, and the Live Encoder API was discontinued 2021-08-04.
59. Native format: official Live Producer post says "9×16 aspect ratio (recommended but not required)", 720×1280.
60. Whether the issued URL is `rtmp://` or `rtmps://` varies. **Read the scheme from the pasted URL; never hard-code it.**
61. Native format: 1080×1920 / 720×1280 portrait. 16:9 is accepted but letterboxed in the mobile player.
62. 16:9 is documented; other ratios are "automatically cropped within the broadcast card when posted". X's native *mobile* vertical live has no ingest path and no API.
63. Castr documents an RTMPS URL from Media Studio; Socialive says RTMP only. **Sources conflict — support both schemes and let the pasted URL decide.**
64. LinkedIn's *feed video* specs allow 9:16 in 2026, but the **Live Ingest Requirements explicitly say 16:9**. Do not conflate the two.
65. RTMPS supported and **preferred**. Firewall: RTMP needs outbound TCP 1935/1936; RTMPS needs 2935/2936 (443 in newer samples).
66. Whatever the user's target accepts. LIVETAP composes 9:16 from the same production; it cannot validate the far end.
67. `RTMP_DESTINATION` here means "push-only transport supported". WHIP: `https://` endpoint + optional Bearer; follow 307 redirects preserving headers; H.264 + Opus; expect 201 + `Location`; `DELETE` to end.

---

## SECTION B — PER-PLATFORM BRIEFS

Each brief is what an adapter author and a copywriter both need, and nothing else.

### B.1 YouTube — the only complete control plane

**Auth — desktop:** OAuth client type *Desktop app*; Authorization Code + **PKCE (`S256`)** with a **loopback redirect** (`http://127.0.0.1:<random-port>`). Token endpoint `POST https://oauth2.googleapis.com/token`. OOB (`urn:ietf:wg:oauth:2.0:oob`) is dead and custom URI schemes are deprecated — if any inherited code uses them, migrate. Send the issued client secret as an obfuscated non-secret *and always send PKCE*.
**Auth — web:** OAuth client type *Web application*, exact HTTPS redirect URIs, code exchange **server-side** with the secret. `access_type=offline` + `prompt=consent` to reliably get a refresh token.
**Scopes (minimum):** `youtube.force-ssl` (the only scope permitting chat write + moderation), plus `yt-analytics.readonly` **only if** analytics ships. Both are sensitive/restricted → verification required.
**Tokens:** access ~1 h. Refresh tokens are long-lived but invalidated by revocation, password change, 6 months idle, or the per-client-per-user cap. Apps left in *Testing* publishing status get short-lived refresh tokens — the classic multistreaming bug.

**Go-live sequence (verified endpoints, base `https://www.googleapis.com/youtube/v3`):**
1. `POST /liveBroadcasts?part=snippet,contentDetails,status` — `snippet.title`, `snippet.scheduledStartTime` (**mandatory**, pass `now`), `status.privacyStatus`, `contentDetails.{enableDvr,recordFromStart,enableAutoStart,enableAutoStop,monitorStream.enableMonitorStream}`.
2. `POST /liveStreams?part=snippet,cdn,contentDetails` — `cdn.ingestionType=rtmp`, `cdn.resolution`, `cdn.frameRate`, `contentDetails.isReusable=true`.
3. Read `cdn.ingestionInfo.rtmpsIngestionAddress` + `.streamName`; keep `rtmpsBackupIngestionAddress` for failover.
4. `POST /liveBroadcasts/bind?id=<broadcastId>&part=id,contentDetails&streamId=<streamId>`.
5. *(optional)* `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=<broadcastId>` (broadcast id == video id; 2 MB max).
6. Start the encoder.
7. Poll `GET /liveStreams?part=status&id=<streamId>` until `status.streamStatus == "active"` — **required**, else `errorStreamInactive`.
8. `POST /liveBroadcasts/transition?broadcastStatus=live&...` — **skip entirely if `enableAutoStart=true`** (auto-start and the testing stage are mutually exclusive).
9. While live: `GET /videos?part=liveStreamingDetails&id=<broadcastId>` for `concurrentViewers` + `activeLiveChatId`.
10. `POST /liveBroadcasts/transition?broadcastStatus=complete&...` — skip if `enableAutoStop=true`.
Handle explicitly: `errorStreamInactive`, `invalidTransition`, `redundantTransition`, `concurrentBroadcastsExceedLimit`.

**Chat transport:** `liveChatMessages.streamList` (server-streaming push) preferred; `liveChatMessages.list` polling as fallback honouring `pollingIntervalMillis`. Write: `liveChatMessages.insert`. Moderate: `liveChatMessages.delete`, `liveChatBans.insert/delete`, `liveChatModerators.*`.
**Quota reality:** default is **not** a flat 10,000 — it is 100 `search.list`/day + 100 `videos.insert`/day + 10,000 units/day for everything else; every request including failures costs ≥1 unit; live-method costs are absent from the official table (budget ~50/write, ~1/read and measure). **Never use `search.list` to find a broadcast.** Exceeding default requires a compliance audit.
**Encoder:** H.264 (also H.265/HEVC and AV1 accepted), AAC 128 kbps stereo, **keyframe 2 s (max 4 s)**, CBR, ≤60 fps. 1080p60 target ~12 Mbps (official min/max columns are internally inconsistent — treat "recommended" as the target); 1080p30 ~10; 720p60 ~6; ≤720p30 ~4. RTMPS. No SRT, no WHIP.
**Connection summary (beginner-facing):** "Sign in with Google once — LIVETAP creates the broadcast, goes live, ends it and brings your chat here. You never touch a stream key."
**When it can't:** *auth* — "Your Google sign-in expired. Reconnect YouTube and your broadcast settings stay exactly as they are." *not eligible* — "YouTube needs a verified channel, age 16+, and no live-streaming restrictions in the last 90 days. Nothing is wrong with LIVETAP — YouTube has to unlock live on your channel first." *stream inactive* — "YouTube hasn't seen your video yet, so it won't let us press Go Live. LIVETAP is retrying — this usually clears in a few seconds." *quota* — "YouTube has rate-limited this app for today. Your stream keeps running; chat and stats may pause."

### B.2 Twitch — no broadcast object, no PKCE

**Auth — desktop:** **Device Code Grant** (`grant_type=urn:ietf:params:oauth:grant-type:device_code`, `https://id.twitch.tv/oauth2/device`). Twitch documents no PKCE, so Authorization Code from a binary would mean shipping a secret; Implicit returns no refresh token. Access token **4 h**; refresh token is **one-time-use** and dies after **30 days idle** — persist the rotated token atomically on every refresh.
**Auth — web:** Authorization Code with the secret server-side. Always send and verify `state` (Twitch does not enforce it). **Never use Implicit anywhere.**
**Scopes (minimum):** `channel:read:stream_key channel:manage:broadcast user:read:chat user:write:chat moderator:manage:banned_users moderator:manage:chat_messages`. Registration requires 2FA and a globally unique app name; there is no review queue.

**Go-live sequence (base `https://api.twitch.tv/helix`):**
1. Resolve `broadcaster_id` from the validated token (`GET /users` path not re-verified).
2. `GET /search/categories?query=<game>` → `game_id`.
3. `PATCH /channels?broadcaster_id=<id>` `{title, game_id, broadcaster_language, tags}` — **before** ingest, so second zero looks right.
4. `GET /streams/key?broadcaster_id=<id>`.
5. *(optional)* `GET https://ingest.twitch.tv/ingests` (**no auth**) to pick a PoP. URL form `rtmp://<ingest-server>/app/<stream-key>`; `?bandwidthtest=true` disables live viewing — use it for LIVETAP's connection test.
6. Open EventSub WebSocket `wss://eventsub.wss.twitch.tv/ws`, capture `session_id` from Welcome.
7. `POST /eventsub/subscriptions` for `stream.online` v1, `stream.offline` v1, `channel.update` v2, `channel.chat.message` v1, `channel.chat.message_delete` v1, `channel.chat.clear` v1.
8. Start the encoder — **the broadcast begins automatically**; `stream.online` fires.
9. Poll `GET /streams?user_id=<id>` for `viewer_count` (no viewer-count event exists).
10. Stop the encoder; `stream.offline` fires. **There is no stop endpoint.**

**Chat transport:** EventSub WebSocket (keepalive 10–600 s; on `session_reconnect` you get ~30 s and a `reconnect_url` — do not close the old socket before the new one sends Welcome, or you get close code **4004**; **resubscribe after any drop**). Write via Helix `POST /chat/messages`, not IRC. WebSocket limits: 3 connections per user token, 300 subscriptions per connection, **total cost 10** (user-authorized subscriptions cost 0).
**Rate limits:** token bucket, 1 point per call, Twitch's example limit 800; headers `Ratelimit-Limit/Remaining/Reset`. Parse 429 bodies — not every 429 is the bucket.
**Encoder:** RTMP ingest confirmed; **the classic H.264 / CBR / 2 s keyframe / 6000 kbps figures are secondary-source only** (help.twitch.tv is JS-rendered and unreadable by machine) — mark UNVERIFIED in code comments. Verified from Twitch's blog: HEVC ≤1440p at ≤9 Mbps, 1080p 7.5 Mbps (Partner/Affiliate); AV1/4K restricted to the Enhanced Broadcasting beta. Dual Format 9:16 is encoder-side.
**Connection summary:** "Sign in with Twitch once. LIVETAP sets your title and category, then Twitch goes live the moment your video arrives — Twitch has no start button for apps, and no stop button either."
**When it can't:** *no start/stop* — "Twitch doesn't give apps a start or stop button. LIVETAP starts your stream by sending video, and ends it by stopping — your title and category are already set." *thumbnail* — "Twitch makes its own live thumbnail; nobody can upload one." *analytics* — "Twitch doesn't publish per-stream viewer history, so this graph is LIVETAP's own measurements." *auth* — "Twitch signed LIVETAP out (its refresh tokens expire after 30 days unused). Sign in again — it takes one code."

### B.3 Kick — metadata + chat only, and chat needs a public URL

**Auth — desktop:** Authorization Code + **mandatory PKCE (`S256`)** at `https://id.kick.com/oauth/authorize` with a **loopback** redirect — but `client_secret` is required at `POST /oauth/token`, so route the code→token exchange through a LIVETAP token broker (ADR-009 `TokenBroker`). Shipping an embedded secret in an open-source build is not acceptable.
**Auth — web:** Authorization Code + PKCE, secret server-side. This is the flow Kick is designed around.
**Gotchas:** prefer `http://localhost/...` over `http://127.0.0.1/...` (Kick's Next.js front end rewrites the first `127.0.0.1` occurrence; official workaround is a sacrificial `&redirect=127.0.0.1` param placed *before* `redirect_uri`). `state` is **required**. Two hosts: `id.kick.com` for OAuth, `api.kick.com` for the API. Lifetimes are not documented — read `expires_in`, and use `POST /oauth/token/introspect`. Refresh returns a **new** access *and* refresh token; persist both.
**Scopes (minimum):** `user:read channel:read channel:write streamkey:read chat:write events:subscribe moderation:ban moderation:chat_message:manage`. **There is no `chat:read` scope.**

**Go-live sequence (base `https://api.kick.com`):**
1. `GET /public/v1/channels` (no params) → `broadcaster_user_id`, current `category`, `stream_title`, `stream.is_live`.
2. `GET /public/v2/categories?...` → `category_id`.
3. `PATCH /public/v1/channels` `{stream_title, category_id, custom_tags[≤10]}` → expect **204**.
4. `GET /public/v1/channels` with `streamkey:read` → `stream.url` + `stream.key`. **UNVERIFIED mapping — fall back to paste.**
5. One-time: webhook URL configured and enabled in the Kick Developer tab; `GET /public/v1/public-key` for signature verification.
6. `POST /public/v1/events/subscriptions` `{method:"webhook", events:[livestream.status.updated v1, livestream.metadata.updated v1, chat.message.sent v1, moderation.banned v1]}`.
7. Start the encoder — stream starts automatically; `livestream.status.updated` fires.
8. Poll `GET /public/v1/users/livestreams?user_id=<id>` for `viewer_count`.
9. Stop the encoder. **No stop endpoint.**

**Chat transport:** **inbound webhooks only** — no WebSocket, no polling, no history. Consequence: **a desktop-only LIVETAP cannot read Kick chat.** Either a LIVETAP relay fans webhooks out to clients, or Kick chat read is a self-hosted-only feature. Reconcile `GET /public/v1/events/subscriptions` on every start: an app that fails to process an event for over a day is **auto-unsubscribed**, and disabling webhooks drops all subscriptions.
**Rate limits:** **not documented at all**; only 429 responses are declared. Adaptive backoff, assume nothing.
**Encoder (all secondary, UNVERIFIED):** `rtmp://ingest.kick.com/live`, H.264 only, CBR, ≤8,000 kbps, ≤1920×1080, ≤60 fps, 2 s keyframe. Read the help article manually before hard-coding.
**Connection summary:** "Sign in with Kick to set your title and category — Kick goes live as soon as your video arrives. Kick can only send chat to a public web address, so chat needs hosted or self-hosted LIVETAP."
**When it can't:** *chat on desktop* — "Kick only delivers chat to a public web address, which a desktop app doesn't have. Everything else about your Kick stream works; chat stays in Kick's tab." *stream key* — "Kick didn't hand over your stream key. Copy it from kick.com → Settings → Stream Key and paste it here — LIVETAP handles the rest." *analytics* — "Kick has no stats API, and a viewer count of 0 can mean you hid it."

### B.4 Facebook — fully automatable, behind the hardest business gate

**Auth — desktop:** loopback redirect → **LIVETAP backend performs the code exchange and the long-lived-token exchange** (the app secret never leaves the server). Do not ship an app secret in a desktop binary; Meta's PKCE doc covers the OIDC flow only.
**Auth — web:** standard server-side code flow. Prefer **Facebook Login for Business** for Page targets — configuration IDs instead of a raw `scope`, per-asset delegation, and business integration **system user tokens that default to never expiring** (attractive for self-hosted LIVETAP).
**Permissions:** `publish_video` (user timeline/group/event/Page); `pages_manage_posts` + `pages_read_engagement` for Pages; crossposting additionally needs `pages_read_user_content`, `pages_manage_engagement`, `pages_show_list` and the `CREATE_CONTENT` task. **App Review of the "Live Video API" feature + Business Verification are mandatory** for anyone who isn't a role-holder on the app.
**Tokens:** short-lived ~1–2 h → long-lived ~60 days via a server-side exchange. Meta warns not to depend on these lifetimes.

**Go-live sequence (base `https://graph.facebook.com/v25.0`):**
1. OAuth; exchange for a long-lived token; derive Page tokens.
2. `POST /{target-id}/live_videos` with `status=LIVE_NOW` (or `SCHEDULED_UNPUBLISHED` + `event_params`), `title` (≤254), `description`, `privacy`, optional `enable_backup_ingest=true`, optional `crossposting_actions`.
3. Store `id`; push RTMPS to `secure_stream_url` (+ `secure_stream_secondary_urls`). **URL expires unused after 24 h; a used URL is good for up to 8 h.**
4. While live: SSE `https://streaming-graph.facebook.com/{id}/live_comments` (or poll `/{id}/comments`); poll `LiveVideoInputStream.stream_health` for bitrate/fps/GOP.
5. `POST /{id}?end_live_video=true` → ends and saves as VOD.
Notes: `GET` is **not supported** on the `/live_videos` edges — persist ids yourself. Crossposting **fails silently** — read back `crosspost_shared_pages`. Unpublished broadcasts may be auto-deleted after hours.

**Chat transport:** SSE on `streaming-graph.facebook.com` (different host), fallback polling every few seconds. Write and moderation are UNVERIFIED — ship read-only and degrade visibly.
**Encoder (official):** RTMPS required. H.264 Level 4.1 ≤1080p30 / 4.2 for 1080p60; **16:9 recommended**; keyframe **2 s, never over 4 s**; 1080p60 4,500–9,000 kbps; 1080p30 3,000–6,000; 720p60 2,250–6,000; 720p30 1,500–4,000; 480p30 600–2,000; 360p 400–1,000. AAC-LC 44.1/48 kHz stereo, 128 kbps preferred (256 max). **Max duration 8 hours.**
**Connection summary:** "Sign in with Facebook and LIVETAP creates, starts and ends the broadcast for you — once Meta has approved the app and verified your business. Until then, use the stream-key path."
**When it can't:** *review* — "Facebook only lets approved apps go live for you. Meta has to review LIVETAP's Live Video API access and verify a business — that's on Meta's side and can take weeks. Meanwhile you can still stream to Facebook by pasting a key from Live Producer." *eligibility* — "Facebook needs an account at least 60 days old and a Page (or professional profile) with 100+ followers." *key expiry* — "Facebook's stream address expires after 24 hours and each broadcast can run 8 hours. LIVETAP gets a fresh one every time you go live."

### B.5 Instagram — no live API exists

**Auth:** Instagram Business Login (`https://www.instagram.com/oauth/authorize` → `POST https://api.instagram.com/oauth/access_token`, then `GET https://graph.instagram.com/access_token` for a 60-day token, refresh via `/refresh_access_token` once the token is ≥24 h old). **No PKCE** → desktop needs a backend for the exchange. Scopes: `instagram_business_basic`, `instagram_business_manage_comments`; the `live_media` read lives in the Facebook-Login flavour with `instagram_basic` + `pages_read_engagement`. **None of this authorizes going live** — it authorizes reading live comments and probing live status.

**Go-live sequence (USER_ASSISTED, official UI path):**
1. `instagram.com` in a **desktop browser** (Live Producer is desktop-web only).
2. "Add post" (＋ in a square) → **Live**.
3. Enter **title** and select **audience** on the "Go live" screen.
4. Instagram shows a unique **URL + stream key** (copy, or reset).
5. Paste both into LIVETAP — treat as **single-use, per-session** credentials; never persist, redact from logs, prompt again next broadcast.
6. LIVETAP pushes RTMP(S).
7. **The human presses "Go live" in Live Producer.** LIVETAP cannot.
8. The human ends the live in Live Producer.

**Chat transport:** `live_comments` webhook, live-window only, no backfill, no moderation. Reply via API is UNVERIFIED. Also unsupported by Live Producer: Live Rooms, Shopping, Fundraisers, Q&A.
**Encoder (official Live Producer post):** **9×16 recommended**, **720×1280 @ 30 fps** (60 supported), **2,250–6,000 kbps**, audio 44.1 kHz stereo up to 256 kbps. Max duration not documented. Read the URL scheme from the UI, never hard-code it.
**Connection summary:** "Instagram has no way to let apps go live. Open Live Producer on instagram.com, copy the fresh stream key, paste it here — LIVETAP sends the video, and you press Go live in Instagram's own tab."
**When it can't:** *start* — "Instagram doesn't let apps start a live for you. LIVETAP is already sending your video — switch to the Instagram tab and press Go live." *key* — "Instagram issues a brand-new stream key every session, so there's nothing for LIVETAP to save. Grab a fresh one from Live Producer each time." *eligibility* — "Instagram now requires a public account with 1,000+ followers to go live, and Live Producer itself is limited-access. If you don't see Live, Instagram hasn't enabled it for your account." *moderation* — "Instagram doesn't offer live moderation to any app, including its own Live Producer."

### B.6 TikTok — the honest paste path

**Auth — desktop (only worth shipping for VOD publishing):** `GET https://www.tiktok.com/v2/auth/authorize/` with **PKCE mandatory** — and the challenge is the **hex-encoded** SHA-256 of the verifier, not base64url (a generic OAuth library will silently fail here). Redirect must be `localhost`/`127.0.0.1` **with a port**, no query or fragment, ≤10 URIs, <512 chars each. `POST https://open.tiktokapis.com/v2/oauth/token/` — access token **24 h**, refresh **365 days**. Desktop is genuinely secretless. **There is no live scope, no live endpoint, no live webhook.**
**Auth — web:** standard server-side code flow (web PKCE requirement UNVERIFIED).
**What exists and is irrelevant to live:** Login Kit, Content Posting API (video/photo upload — worth shipping to repurpose recordings), Display, Research, Data Portability. **Do not implement any `/v2/live/...` path — it does not exist.**

**Go-live sequence (USER_ASSISTED):**
1. Sign in to TikTok in a desktop browser; **Go LIVE** in the left nav → `livecenter.tiktok.com/producer` (third-party corroborated; if the UI moved, look for "Go LIVE with third-party tools").
2. Scroll down, press the red **Go LIVE**, choose category + title, **Save & Go LIVE**.
3. Copy the **Server URL** and **Stream key** shown at the bottom of the dashboard.
4. Paste into LIVETAP; LIVETAP pushes RTMP(S). The human confirms and ends the stream in TikTok's dashboard.
**Never persist the key** (new one per session) and never reuse it.

**Chat transport:** none. Officially there is no read, write, moderation, viewer count, gift event or live status. Reverse-engineered Webcast clients exist but depend on a third-party signing service, are modified-AGPL, self-declare as not production-ready, and put ToS risk on the creator's account — **do not bundle, do not enable by default, do not link as a supported path.** "Stream key generator" projects are worse: they impersonate first-party/partner clients.
**Encoder (LIVETAP default; the platform publishes no spec):** 1080×1920, **30 fps**, H.264, ~4,000 kbps video (2,000–6,000 range reported), 128–160 kbps AAC, 2 s keyframe — user-overridable, because none of it is officially specified. Vertical is the platform; warn loudly on 16:9.
**Connection summary:** "TikTok doesn't let apps start a LIVE for you yet — paste your stream key from LIVE Studio; LIVETAP handles the rest."
**When it can't:** *start/stop* — "TikTok doesn't let apps start or end a LIVE. LIVETAP is sending your video; press Go LIVE in TikTok's tab." *no key exists* — "TikTok hasn't given your account LIVE access, so no stream key exists to copy — refreshing won't produce one. TikTok's own requirements (followers, age, region) have to be met first. This isn't a LIVETAP problem and there's nothing we can unlock for you." *chat* — "TikTok has no chat API for any third-party app, so TikTok chat can't appear here. Keep TikTok's LIVE dashboard open beside LIVETAP." *partner asymmetry* — "Some apps can start a TikTok LIVE without a key because TikTok gave them private access. LIVETAP doesn't have it, and we won't pretend otherwise."

### B.7 X — a manual destination with a persistent key

**Auth:** ship **no X OAuth flow for the live destination** — it would imply capability that does not exist. X API v2 (OAuth 2.0 + PKCE, `S256`, 30-second auth codes, 2 h tokens, `offline.access` for refresh) is only relevant to the optional, off-by-default replies panel. **Never request `broadcast.read`/`broadcast.write`:** grantable, scary in the consent screen, and mapped to no endpoint. Periscope Producer API — the capability LIVETAP would want — was cut off 2021-03-31 and has **no successor**.

**Go-live sequence (USER_ASSISTED, entirely manual):**
1. Human signs in at `studio.x.com` (Media Studio) or X Live Studio.
2. **Sources → Create Source**, name it, select **RTMP**, select a **region**.
3. Copy the **RTMP URL** and **Stream Key**; paste into LIVETAP as a custom-RTMP-style destination.
4. **Separately:** create a **Broadcast** in the Studio, attach the source, choose audience, choose immediate or scheduled start, and **publish a Post**.
5. LIVETAP pushes. **Pushing bytes alone publishes nothing** — the broadcast must be started in the Studio UI.
Adapter shape: `UserAssistedRtmpDestination`. `createBroadcast()`, `startBroadcast()`, `stopBroadcast()`, `getStatus()` return `UNSUPPORTED`; the UI shows a 3-step checklist. Source keys appear long-lived and reusable — store encrypted at rest, and surface auth failures clearly in case X rotates them.

**Chat transport:** none for native live chat. Optional, off by default, with an explicit spend warning: replies to the announcement Post via `GET /2/tweets/search/recent` filtered by `conversation_id` (450 req/15 min, ≤100 posts/request), `POST /2/tweets` to reply, `PUT /2/tweets/{id}/hidden` to hide. **X API v2 is pay-per-usage with no free tier** (reported ~$0.005/read, ~$0.015/post created — secondary), so every "live chat" refresh costs money. Budget-cap it.
**Encoder (secondary throughout):** H.264/AVC, 1280×720 @ 30/60 or 1920×1080 @ 30 (no 1080p60), ~9 Mbps, AAC-LC ≤128 kbps, **16:9** (other ratios are cropped in the broadcast card). No vertical, no SRT, no WHIP.
**Connection summary:** "X has no live API. Create a source and a broadcast in X Live Studio, paste the RTMP URL and key here, then start the broadcast in X — sending video on its own does **not** put you live on X."
**When it can't:** *start* — "Sending video to X isn't going live: X needs you to start the broadcast in Live Studio and publish the Post. LIVETAP is pushing video to your source and waiting for you." *premium* — "X only issues stream keys to Premium accounts. LIVETAP can't provision that for you — X Premium is a subscription on X." *chat* — "X's live chat isn't available to any app. LIVETAP can show replies to your announcement Post instead, but X now charges per read, so it's off unless you turn it on."

### B.8 LinkedIn — best API in the report, hardest terms

**Auth:** 3-legged authorization code, `GET https://www.linkedin.com/oauth/v2/authorization` → `POST https://www.linkedin.com/oauth/v2/accessToken` with `client_id` **and `client_secret`** (auth code lifespan 30 min). PKCE exists at a separate native endpoint (loopback only) but **LinkedIn must enable it per application on request** — so a public desktop client cannot use it today, and auth must be brokered by a LIVETAP-operated backend. Refresh tokens are **not default** — they are enabled per partner on request; without them, broadcasters re-authorize about every 60 days. **Member and organization live scopes cannot be combined in one authorization request** — ask "profile or Page?" *before* the redirect and run two connections if the user wants both. Every Marketing/Community call needs `Linkedin-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`; version pinning must be updatable config, not a constant.
**Scopes:** member live `r_member_live`, `w_member_live`, `r_liteprofile`; organization live `r_organization_live`, `w_organization_live`, `r_organization_admin`. Comments/reactions are the separately-approved Community Management product; events are the separately-approved Event Management product.

**Go-live sequence (base `https://api.linkedin.com/v2/`) — a 7-step state machine, not start/stop:**
0. `GET /contentAccess/(entity:(member:{urn}),featureType:LIVE_VIDEO)` — **200 = approved, 404 = not approved.** The single best pre-flight check available on any platform in this report; call it before offering LinkedIn at all.
1. *(optional)* `POST /assets?action=registerUpload`, recipe `urn:li:digitalmediaRecipe:video-liveannouncement-image`.
2. `POST /liveVideos` `{author, scheduledAt, name}` → `id`, `state: "PRE_LIVE"`. **Scheduled is the only flow since 2026-06-22** — "go live now" means `scheduledAt = now + 60 000 ms`; window is −15 min to +2 h; max 10/day.
3. `POST /ugcPosts` with `shareMediaCategory: "URN_REFERENCE"`, media `urn:li:liveVideo:{id}`, and the **required** `distribution` object.
4. `POST /liveAssetActions?action=register` `{registerLiveEventRequest:{owner, recipes:["urn:li:digitalmediaRecipe:feedshare-live-video"], region, autoCaptionLanguageTag?}}` → `ingestUrls[]` (+ `previewUrls`).
5. Push RTMPS to an `ingestUrls[].url`.
6. `GET /assets/{id}` until recipe status `AVAILABLE`, then `POST /liveVideos/{id}` `{patch:{$set:{liveVideoAsset:{media:"urn:li:digitalmediaAsset:..."}}}}` → **204**.
7. `POST /liveAssetActions?action=end` `{asset:...}`, ~10 s after the stream actually ends.
**Timers that must be client-side:** registration discarded if ingest hasn't started within **1 hour**; **120 s** with no data = timeout; if the recipe status hasn't updated within **15 s**, LinkedIn's own doc says treat it as failed — send `action=end` and **register a brand-new event**, never retry the same asset.

**Chat transport:** `socialActions/comments` (get/create/edit/delete) and `reactions`; Social Metadata provides enable/disable comments — the usable "close the chat" lever. Analytics: `videoAnalytics` for watch time/views/viewers (likes and comment counts come from Social Actions).
**Encoder (official Live Ingest Requirements):** **max 4 hours**, **16:9**, **≤1080p**, **≤30 fps**, keyframe **every 2 s (60 frames)**, **≤6 Mbps video**, **≤128 kbps audio @ 48 kHz**, **H.264 + AAC**, RTMP/RTMPS (RTMPS preferred). Firewall: TCP 1935/1936 (RTMP), 2935/2936 and 443 (RTMPS). **LinkedIn is the most constrained major destination and will be the binding constraint on any shared master encode.**
**Business blocker (escalate, not an engineering problem):** the Live Events API Terms forbid making integrations available to other developers for resale to unaffiliated customers, require a direct client relationship, forbid combining other LinkedIn APIs with LLE, and **do not address open-source distribution or self-hosting at all** — meaning they are not permitted by default. Options: (1) a LIVETAP-operated hosted service holds the approved app, (2) self-hosters bring their own approved app (almost nobody will pass OneVet + certification), or (3) **ship LinkedIn as unavailable at launch** — the MVP choice.
**Connection summary:** "LinkedIn only allows approved partner apps to go live, so LIVETAP can't connect your LinkedIn account yet. If an approved tool already gave you a LinkedIn ingest URL, add it as a custom destination."
**When it can't:** *unavailable* — "LinkedIn Live is partner-only: LinkedIn has to admit an app to its Live Events programme, which includes a certification review and a background check. LIVETAP hasn't been admitted. You can still stream to LinkedIn by pasting an ingest URL from an approved tool as a custom destination." *user not approved* — "LinkedIn hasn't switched Live on for this account yet. It needs 150+ followers or connections, an account at least 30 days old, and good standing — and it isn't available in mainland China."

### B.9 Custom RTMP / RTMPS / SRT / WHIP — the universal escape hatch

**Auth:** none. LIVETAP stores only what the user pasted, encrypted at rest, redacted from every log.
**Accepted shapes (spec for `validateIngest` in `packages/core/src/validation/ingest.ts`):**
- **RTMP/RTMPS:** `rtmp://host[:port]/app` or `rtmps://host[:port]/app` + stream key. The key **may contain a query string** (e.g. Dailymotion `x1y2z3?auth=...`). Publish URL = url + `/` + key. Refuse whitespace and shell metacharacters.
- **SRT:** `srt://host:port` + optional `streamid` (opaque, e.g. IVS `sk_...`, or structured, e.g. Millicast `name?t=token`), optional `passphrase` (AES), optional `latency` ms (**no platform publishes a recommended value** — default 200 is UNVERIFIED), **caller mode only**. Container MPEG-TS, 2 s keyframe, B-frames off for Millicast.
- **WHIP:** `https://` endpoint + optional Bearer token; **follow 307 redirects preserving headers** (required by Amazon IVS); H.264 + Opus; expect **201 + `Location`**; `DELETE` the resource to end.
**Go-live sequence:** validate → connection test (short ffmpeg/WebRTC probe, 5 s timeout, failure classified through `classifyFailure` into a `HumaneError`) → push → report sender-side health. Auto-live semantics vary and LIVETAP cannot know them: Twitch/Kick/Facebook(`LIVE_NOW`) start on data; YouTube needs an explicit transition; X and Instagram need a human.
**Chat transport:** none.
**Encoder:** the most constrained co-destination governs the shared master encode (in the MVP set that is LinkedIn at 6 Mbps/1080p/30 if ever enabled, otherwise Kick at 8,000 kbps/1080p60). Default H.264 + AAC, 2 s keyframe, CBR.
**Connection summary:** "Paste any RTMP, RTMPS, SRT or WHIP address and key. LIVETAP will push to it and tell you exactly what it can see — the far end's own rules still apply."
**When it can't:** *refused* — "The server refused the connection. That's almost always a wrong key or an expired one — LIVETAP checked the address format and it looks right." *unknown state* — "LIVETAP is sending video and the server is accepting it. For a custom destination we can't confirm anyone is watching — that's the platform's information to give, and it doesn't." *protocol* — "That address uses a protocol LIVETAP doesn't push yet. RTMP, RTMPS, SRT and WHIP all work."

---

## SECTION C — MVP DESTINATION SET DECISION (ADR-010)

**Decision (restated):** launch with **YouTube, Twitch, TikTok, and Custom RTMP/RTMPS/SRT/WHIP**. Kick, Facebook, Instagram, X and LinkedIn ship as honest cards through the same adapter contract.

### C.1 Evidence for the four

| Destination | Evidence FOR | Evidence AGAINST | Resolution |
|---|---|---|---|
| **YouTube** | The only platform with a complete broadcast lifecycle API: create, bind, transition, stop, metadata, thumbnail, chat read/write, moderation, analytics, live status, scheduling. Desktop-clean auth (PKCE + loopback, no secret needed). RTMPS from the API. | **Two approval gates** (Google OAuth verification *and* the YouTube compliance audit), neither with a published SLA. Quota is unit-based and live-method costs are absent from the official table. Vertical has no API. | Ship it, start both submissions immediately, and build against measured quota rather than assumed quota. Nothing else demonstrates the "LIVETAP does it all for you" promise as completely. |
| **Twitch** | **No app review, no eligibility gate** — the fastest path to a real working destination. Stream key + metadata + EventSub chat + moderation are all first-class. Ingest server list needs no auth. Simulcast now permitted. | **No PKCE** → desktop must use Device Code (4 h tokens, one-time-use refresh, 30-day idle expiry). No start/stop, no thumbnail, no per-stream analytics. Quality-parity policy binds every other destination's encode. | Ship it. Device Code is a real, documented, secretless flow. Encode presets must enforce Twitch parity automatically when Twitch is selected. |
| **TikTok** | Where the vertical audience is; the largest unclaimed position in the market (vertical multistream) runs through it. Desktop OAuth is genuinely good (PKCE + loopback, no secret) *if* LIVETAP also does VOD repurposing. | **No public live API of any kind** — no broadcast creation, no stream key, no chat, no status, no scheduling. Keys are single-use. Eligibility is opaque and region-varying, and with no LIVE access **no key exists**. Competitors with partner access look better through no merit of LIVETAP's. | Ship it as the honest `USER_ASSISTED` reference implementation: paste-per-session key, never persisted, plain-language explanation of the gate, and a public README note about partner asymmetry. This is the destination that proves LIVETAP's honesty principle. |
| **Custom** | Covers every platform LIVETAP has not adapted (X, LinkedIn via an approved tool, Rumble, Dailymotion, Amazon IVS, self-hosted MediaMTX, any future platform) with one validated code path. Enables SRT and WHIP, which no social platform accepts. | Zero destination intelligence: no metadata, no chat, no platform-confirmed status. | Ship it, and make the validator + connection test + humane error classification carry the experience instead. |

### C.2 What the others get in MVP

| Platform | MVP treatment | Why |
|---|---|---|
| **Kick** | **Card + stream-key path.** Real OAuth/metadata/chat adapter scaffolded and tested against fakes, disabled in the UI until a token broker exists. | PKCE is mandatory *and* a client secret is required → needs the `TokenBroker`; chat read needs a public webhook, impossible in a desktop-only build. The stream-key mapping is UNVERIFIED. Nothing blocks a paste path today. |
| **Facebook** | **Card + stream-key path** (Live Producer persistent key), with a scaffolded API adapter. | The API is excellent and fully automatable, but App Review of the Live Video API **plus Business Verification** gates every non-role user, and that takes weeks. A self-hosted operator who registers their own Meta app can enable the real adapter. |
| **Instagram** | **Card + stream-key path only**, key marked single-use, with a deep link to Live Producer and an explicit "awaiting your confirmation in Instagram" destination state. | No live API exists at all, in either Instagram API flavour. The key rotates per session. The human must press Go live. |
| **X** | **Card + stream-key path only** (`UserAssistedRtmpDestination`), with a visible 3-step checklist. | No live API, no partner programme to apply to, and pushing bytes does not publish anything. Premium is required to get a key. The replies panel is optional, off by default, and metered. |
| **LinkedIn** | **Unavailable card**, plus "add the ingest URL from an approved tool as a custom destination". | Not an engineering gap: the Live Events API terms do not permit open-source/self-hosted distribution, and admission requires a certification video plus a OneVet background check. Escalated in BLOCKERS.md; revisit as a hosted-tier feature. |

### C.3 Consequences the adapters must honour

1. **Two go-live archetypes, not one.** *Explicit lifecycle* (YouTube, Facebook, LinkedIn) needs a state machine with a stream-status poll loop; *ingest-implicit* (Twitch, Kick, custom, Facebook `LIVE_NOW`) needs only metadata-then-push. A third shape, *human-in-the-loop* (Instagram, TikTok, X), needs an `awaiting_user_confirmation` state — **the go-live state machine must tolerate non-atomic starts** and never claim the production is live because one destination is.
2. **Three chat transports, no common abstraction below "message stream":** HTTP server-streaming (YouTube), WebSocket (Twitch), SSE (Facebook), inbound webhook (Kick, Instagram), and nothing at all (TikTok, X, LinkedIn-without-partner, custom). Show per-platform capability badges; never fake parity.
3. **Auth is the hardest portability problem.** Secretless desktop works on YouTube (PKCE) and TikTok (PKCE, hex) only. Twitch needs Device Code. Kick, Facebook, Instagram and LinkedIn need a server-side exchange — that is exactly what ADR-009's `TokenBroker` is for.
4. **Normalise units at the adapter boundary:** ban duration is **seconds** on Twitch and **minutes** on Kick; YouTube uses `liveChatBans` with its own semantics.
5. **Never persist Instagram, TikTok or Facebook ingest credentials.** Instagram and TikTok rotate per session; Facebook's URL expires in 24 h. Prompt per broadcast and redact from logs.

---

## SECTION D — 2026 INGEST TRANSPORT MATRIX (condensed)

Corrections to widely-held assumptions, all verified in the source research: Twitch **Enhanced Broadcasting is Enhanced RTMP multitrack, not WHIP**; WHIP is **RFC 9725** (March 2025) and **no platform doc cites it yet**; YouTube's own docs contradict each other on RTMP codecs (OBS `services.json` declares h264/hevc/av1 over Enhanced RTMP, while the developer protocol table dated 2026-09-04 lists only RTMP/RTMPS/HLS/DASH); OBS gained WHIP output in 30.0, HEVC-over-WHIP in 30.2, WebRTC simulcast in 32.1.

| Target | WHIP | SRT | HEVC | AV1 | Note |
|---|---|---|---|---|---|
| YouTube | No | No | Yes (E-RTMP; also HLS) | Yes (E-RTMP) | RTMP/RTMPS/HLS/DASH only |
| Twitch | No † | No | Yes (Enhanced Broadcasting) | Beta-gated | RTMP/RTMPS per the ingest list |
| Kick | No | No | No (H.264 only) | No | `rtmp://ingest.kick.com/live`, 1080p60, ≤8,000 kbps CBR (secondary) |
| Facebook / Instagram | No | No | No | No | RTMPS only, H.264 |
| TikTok | † | † | † | † | RTMP assumed via LIVE Studio / stream key |
| LinkedIn | † | † | † | † | RTMP(S) via partner tools; H.264 + AAC required |
| X | No | No | No | No | RTMP(S); HLS **pull** is an alternate source type |
| Cloudflare Stream | Yes (VP8/VP9/H.264; WHIP↔WHEP only) | Yes (caller) | No | No | GA; billing from 2026-10-15 |
| Dolby OptiView (Millicast) | Yes (H.264/H.265/VP8/VP9/AV1) | Yes | Yes | Yes | **The only verified WHIP target accepting HEVC/AV1** |
| Amazon IVS real-time | Yes (H.264 required, ≤720p 8.5 Mbps) | Yes (low-latency product) | No | No | Participant token as Bearer; 307 redirect |
| Vimeo | No | Yes | No | No | RTMP/RTMPS/SRT |
| Dailymotion | No | Yes | † | † | RTMP + SRT |

**Universal-transport conclusion (ADR-012).** **H.264 + AAC over RTMP/RTMPS is the only universal path in 2026.** Every social destination in the MVP set and every fallback accepts it; nothing else is accepted by more than a subset.
- **HEVC and AV1** are Pro-mode options selected per destination profile (YouTube and Twitch only), never part of the default ladder.
- **SRT** is a custom-destination option (Dailymotion, Vimeo, Amazon IVS, self-hosted). No social platform accepts it.
- **WHIP** exists in LIVETAP for exactly two jobs: the **web/mobile → self-hosted relay hop** (MediaMTX, per ADR-005) and **custom WHIP destinations** (Amazon IVS, Cloudflare, Millicast). It is never a path to a social platform.
- Consequence for the encoder: one H.264/AAC master encode with 2 s keyframes and CBR satisfies every MVP destination; per-destination divergence is resolution, bitrate and aspect only. The **most constrained co-destination governs the master** — and Twitch's quality-parity policy must be enforced as a constraint in the encoder, not as advice in a doc.

---

## SECTION E — CONSOLIDATED UNVERIFIED ITEMS

Deduplicated across the three source documents. Nothing here may be hard-coded, promised in UI copy, or used in a capacity model without manual re-verification. `YTK` = PLATFORM_YOUTUBE_TWITCH_KICK.md, `TIF` = PLATFORM_TIKTOK_INSTAGRAM_FACEBOOK.md, `XLO` = PLATFORM_X_LINKEDIN_OTHERS.md.

| # | Item | Source doc | Why it matters |
|---|---|---|---|
| 1 | Per-method YouTube quota costs for every `live*` method (absent from the official quota table although the page claims they are there) | YTK | Any capacity model is an estimate until measured |
| 2 | `contentDetails.latencyPreference` on `liveBroadcasts.insert` | YTK | Latency is a user-visible promise; use `monitorStream.broadcastStreamDelayMs` instead |
| 3 | Exact HTTP transport/URL for `liveChatMessages.streamList` | YTK | The recommended chat transport's wire format |
| 4 | YouTube phone-verification + 24-hour wait as a citable requirement | YTK | Eligibility copy shown to users |
| 5 | Google OAuth *Testing*-status 100-user cap and the 7-day refresh-token expiry figure | YTK | Determines whether an unverified build is usable at all |
| 6 | Twitch official Broadcasting Guidelines numbers (H.264/CBR/2 s keyframe/6000 kbps) — help.twitch.tv is JS-rendered | YTK | The whole Twitch encoder preset |
| 7 | Twitch stream-schedule segment endpoints and the Create Stream Marker scope | YTK | Scheduling and marker features |
| 8 | Twitch RTMPS endpoint (`rtmps://live.twitch.tv/app`) as an official claim | YTK | Whether LIVETAP can offer encrypted ingest to Twitch |
| 9 | Twitch IRC numeric send limits (the quoted 20 msgs/30 s) | YTK | Chat-write throttling |
| 10 | Whether Kick's `GET /public/v1/channels` actually returns `stream.key`/`stream.url` with `streamkey:read` | YTK | Decides `OAUTH_API` vs `USER_ASSISTED` for the whole Kick adapter |
| 11 | Kick's official ingest URL, RTMPS/SRT support, and encoder limits (help article 403s to automated fetch) | YTK + XLO | Kick's entire encoder preset |
| 12 | Kick API rate limits — **entirely undocumented**, only 429 responses declared | YTK | Backoff strategy |
| 13 | Kick vertical/portrait ingest support | YTK | Whether Kick can appear in a 9:16 production |
| 14 | Facebook LiveVideo node field list, especially **`live_views`** (every doc path 404'd) | TIF | A viewer-count UI cannot be built without it |
| 15 | Facebook chat write on live videos (`POST /{live-video-id}/comments`) | TIF | Ship read-only until confirmed |
| 16 | Facebook `blocked_users` edge contract | TIF | Moderation must be assumed absent in v1 |
| 17 | Facebook SSE `comment_rate` parameter and exact SSE query syntax | TIF | Chat tuning |
| 18 | Facebook scheduling current status (changelog deprecation vs the live scheduling guide) | TIF | Scheduling feature viability |
| 19 | Facebook Groups live permission name (`publish_to_groups`?) | TIF | Group destinations |
| 20 | Facebook PKCE for non-OIDC Graph-scope authorization | TIF | Whether desktop can ever avoid a token broker |
| 21 | Instagram Live Producer account-type requirement (professional only?) | TIF | Eligibility copy |
| 22 | Instagram live ingest scheme/host (rtmp vs rtmps) | TIF | Read from the UI; never hard-code |
| 23 | Instagram live-comment reply and moderation via API | TIF | Chat panel capability badges |
| 24 | Instagram live max duration | TIF | Pre-flight overrun warning |
| 25 | Instagram's ≥1,000-follower / public-account rule as an official page (press-confirmed only) | TIF | Eligibility copy |
| 26 | Instagram `live_media` propagation delay after a stream starts | TIF | Whether it can confirm "we're live" |
| 27 | TikTok LIVE access thresholds (1,000 followers; 18 vs 16; 30-day account) | TIF | Eligibility copy — currently secondary only |
| 28 | TikTok encoder spec (bitrate ceiling, the 30 fps playback cap) | TIF | The TikTok preset is LIVETAP's own recommendation |
| 29 | TikTok web LIVE producer UI path (`livecenter.tiktok.com/producer`) | TIF | The instructions LIVETAP shows the user |
| 30 | TikTok web-flow PKCE requirement | TIF | Web OAuth implementation |
| 31 | X RTMPS support (Castr says RTMPS, Socialive says RTMP only) | XLO | Support both schemes; let the pasted URL decide |
| 32 | X eligibility detail: Premium requirement, 3-month account age, verified email, 2FA | XLO | Eligibility copy; no API can check it |
| 33 | Whether X rotates or expires Media Studio source keys | XLO | Whether a stored key can be trusted between shows |
| 34 | X API v2 price sheet (both pricing doc paths 404'd) | XLO | The replies panel has a real per-read cost |
| 35 | Whether `users.read` exposes a usable Premium/verified flag | XLO | Pre-flight check feasibility for X |
| 36 | X Live Studio region list completeness and the $1M creator-fund criteria | XLO | Regional availability copy |
| 37 | TikTok / LinkedIn WHIP, SRT, HEVC and AV1 support (all four unknown for both) | XLO | Transport matrix gaps |
| 38 | SRT `latency` recommended value — **no platform publishes one** | XLO | Custom SRT defaults |
| 39 | Vimeo inbound ingest URL and stream-key-via-API (the documented `stream_key`/`stream_url` are *simulcast outputs*, not inbound ingest) | XLO | Do not mistake one for the other |

---

## SECTION F — SOURCES (official, deduplicated)

Secondary sources are deliberately **not** reproduced here; they remain attributed in the three source documents, where every secondary claim is labelled as such.

**YouTube** — developers.google.com/youtube/v3/live/docs (+ `liveBroadcasts/insert`, `liveBroadcasts/bind`, `liveBroadcasts/transition`, `liveStreams`, `liveStreams/insert`, `liveChatMessages/list`, `liveChatMessages/streamList`, `liveChatMessages/insert`) · /youtube/v3/live/life-of-a-broadcast · /youtube/v3/live/guides/ingestion-protocol-comparison · /youtube/v3/live/guides/hls-ingestion · /youtube/v3/docs/videos · /youtube/v3/docs/thumbnails/set · /youtube/v3/determine_quota_cost · /youtube/v3/guides/quota_and_compliance_audits · /youtube/analytics/reference/reports/query · /youtube/analytics/dimensions · /identity/protocols/oauth2/native-app · /identity/protocols/oauth2/scopes · support.google.com/youtube/answer/2853702 (encoder settings) · /answer/9227509 (live requirements) · /answer/3006768 (ingest error catalogue) · /answer/2474026 · /answer/9228390 (mobile gate) · /answer/9854503 · /answer/2853835 · support.google.com/cloud/answer/9110914 and /13463073 (OAuth verification) · support.google.com/youtube/contact/yt_api_form, /yt_api_appeals, /yt_api_change_of_control_form

**Twitch** — dev.twitch.tv/docs/authentication/ (+ /getting-tokens-oauth/, /scopes/, /register-app/) · /docs/api/guide/ · /docs/api/reference/ · /docs/eventsub/ (+ /manage-subscriptions/, /handling-websocket-events/, /eventsub-subscription-types/) · /docs/chat/irc/ · /docs/video-broadcast/ (+ /reference/) · /docs/insights/ · `GET https://ingest.twitch.tv/ingests` · blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/ · help.twitch.tv/s/article/broadcast-guidelines (**JS-rendered; must be read manually**)

**Kick** — docs.kick.com/llms.txt · /readme.md · /changelog.md · /getting-started/kick-apps-setup.md · /getting-started/generating-tokens-oauth2-flow.md · /getting-started/scopes.md · /apis/channels.md · /apis/chat.md · /apis/moderation.md · /apis/livestreams.md · /apis/users.md · /apis/faqs.md · /events/introduction.md · /events/subscribe-to-events.md · /events/event-types.md · /events/webhook-security.md · github.com/orgs/KickEngineering/projects/3 · help.kick.com/en/articles/7066931 and /7120642 (**403 to automated fetch; read manually**)

**Facebook** — developers.facebook.com/docs/live-video-api/ (+ /overview/, /getting-started/, /reference, /changelog, /guides/streaming/, /guides/scheduling, /guides/crossposting, /guides/interacting/, /guides/backup_stream, /common-uses/interacting-with-viewers) · /docs/graph-api/reference/page/live_videos/ · /user/live_videos/ · /group/live_videos · /live-video-input-stream/ · /docs/graph-api/server-sent-events/endpoints/live-comments/ · /docs/features-reference/live-video-api · /docs/permissions/reference/publish_video · /docs/app-review/ · /docs/facebook-login/guides/access-tokens · /guides/advanced/oidc-token · /facebook-login-for-business

**Instagram** — developers.facebook.com/docs/instagram-platform (+ /overview/, /instagram-graph-api/reference/ig-user/live_media/, /reference/instagram-media/, /webhooks, /comment-moderation, /instagram-api-with-instagram-login, /.../business-login, /changelog/) · about.instagram.com/blog/tips-and-tricks/instagram-live-producer (**the authoritative Live Producer source**)

**TikTok** — developers.tiktok.com/doc/overview/ · /doc/tiktok-api-scopes/ · /doc/webhooks-overview/ · /doc/webhooks-events/ · /doc/content-posting-api-get-started/ · /doc/oauth-user-access-token-management/ · /doc/login-kit-desktop/ · /doc/login-kit-overview/ · tiktok.com/live/studio/help/article/FAQ/FAQ · tiktok.com/studio/download · (navigation-only, re-verify manually: support.tiktok.com/en/live-gifts-wallet/tiktok-live/going-live, livecenter.tiktok.com/help_center/article/1023/...)

**X** — docs.x.com/x-api/overview · /x-api/introduction · /x-api/getting-started/about-x-api · /x-api/.../oauth-2-0/authorization-code · X API v2 rate-limits page · help.x.com/en/using-x/how-to-use-live-producer (**403 to this environment**) · (pricing paths docs.x.com/x-api/pricing and /fundamentals/pricing both **404**)

**LinkedIn** — LinkedIn Live Events API docs: Spontaneous Live Events Migration · `POST /v2/liveVideos` · `POST /v2/ugcPosts` · `POST /v2/liveAssetActions?action=register|end` · `GET /v2/contentAccess/...` · `POST /v2/assets?action=registerUpload` · Live Ingest Requirements · Live Events API Program access + certification · Live Events API Terms of Use · developer.linkedin.com OAuth: /oauth/v2/authorization, /oauth/v2/accessToken, /oauth/native-pkce/authorization · socialActions/comments, reactions, Social Metadata, videoAnalytics, adAnalytics (202601) · linkedin.com/help/linkedin/answer/a568503 (access criteria) and /a520811 (preferred partners)

**Secondary destinations and transports** — Dailymotion API v2 livestreams + `oauth2.dailymotion.com/v2/token` · Vimeo Live API (Enterprise allowlist) · Rumble Live Stream API URL · Amazon IVS `CreateChannel`, RTMPS/SRT/WHIP endpoints and IVS Chat · open-live.bilibili.com · OBS `services.json` · RFC 9725 (WHIP) · Cloudflare Stream WHIP/WHEP · Dolby OptiView (Millicast) WHIP
