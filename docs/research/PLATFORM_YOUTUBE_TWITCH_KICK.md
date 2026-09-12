# LIVETAP Platform Integration Research — YouTube, Twitch, Kick

**Research group:** Platform Integrations (group 1)
**Researched:** 2026-09-11
**Method:** Official developer documentation first (developers.google.com/youtube, dev.twitch.tv/docs, docs.kick.com), secondary sources only for practical context and explicitly labelled as such.

## Classification legend

| Label | Meaning |
|---|---|
| `NATIVE API` | First-class documented API endpoint does the thing end to end |
| `RTMP DESTINATION` | Only achievable by pushing bytes to an ingest endpoint; no control-plane API |
| `OAUTH + API` | Requires an OAuth user token plus API calls |
| `USER-ASSISTED` | Requires the human to do something in the platform UI/account |
| `PARTNER APPROVAL REQUIRED` | Gated behind platform review/verification/audit |
| `EXPERIMENTAL` | Exists but beta/limited-availability/undocumented-for-third-parties |
| `UNAVAILABLE` | No mechanism exists for third-party apps |
| `UNVERIFIED` | Could not confirm from an official source — do not build on it |

**Hard rule applied throughout:** no endpoint, scope, or numeric limit appears below unless it was read from an official doc page. Anything else is marked `UNVERIFIED` or explicitly labelled "secondary source".

---

# 1. YouTube (YouTube Data API v3 / Live Streaming API)

## 1.1 Capability classification

| Capability | Classification | Notes |
|---|---|---|
| OAuth | `OAUTH + API` | Google Identity OAuth 2.0; authorization code (web) + installed-app/loopback (desktop) |
| PKCE | `OAUTH + API` | Officially supported for installed apps; `S256` and `plain` accepted; client secret not applicable to Android/iOS/Chrome client types |
| Broadcast Creation | `NATIVE API` | `liveBroadcasts.insert` |
| Stream Creation | `NATIVE API` | `liveStreams.insert` |
| Stream Key retrieval | `NATIVE API` | `cdn.ingestionInfo.streamName` + `ingestionAddress` / `rtmpsIngestionAddress` |
| Start | `NATIVE API` | `liveBroadcasts.transition` → `live`, or `contentDetails.enableAutoStart` |
| Stop | `NATIVE API` | `liveBroadcasts.transition` → `complete`, or `contentDetails.enableAutoStop` |
| Metadata | `NATIVE API` | `liveBroadcasts.insert/update` (title, description, categoryId, privacyStatus, DVR, embed, closed captions, monitor-stream delay) |
| Thumbnail | `NATIVE API` | `thumbnails.set` (2 MB max, jpeg/png) |
| Chat Read | `NATIVE API` | `liveChatMessages.list` (polling, `pollingIntervalMillis`) or `liveChatMessages.streamList` (server-streaming, recommended) |
| Chat Write | `NATIVE API` | `liveChatMessages.insert` |
| Moderation | `NATIVE API` | `liveChatMessages.delete`, `liveChatBans.insert/delete`, `liveChatModerators.list/insert/delete` |
| Analytics | `NATIVE API` | Live concurrents via `videos.list?part=liveStreamingDetails`; historical via YouTube Analytics API `reports.query` with the `liveOrOnDemand` dimension |
| Live Status | `NATIVE API` | `liveStreams.list?part=status` (`status.streamStatus`), `liveBroadcasts.list?part=status` (`status.lifeCycleStatus`) |
| Scheduling | `NATIVE API` | `snippet.scheduledStartTime` is **mandatory** on `liveBroadcasts.insert` |
| Application Review needed | `PARTNER APPROVAL REQUIRED` | Google OAuth verification (sensitive/restricted scopes) **and** YouTube API Services compliance audit to exceed default quota |
| Eligibility gates | `USER-ASSISTED` | Channel must be verified, user 16+, no live-streaming restriction in past 90 days |
| Regional Restrictions | `UNVERIFIED` | No official statement found for API-level regional gating. Vertical-live beta is region-limited (secondary source) |
| Account Restrictions | `USER-ASSISTED` | Community-guidelines strike blocks live streaming for 14 days; 10 active streams/channel, 3 active streams per stream key |
| Vertical 9:16 support | `EXPERIMENTAL` | No API field for aspect/format. Dual horizontal+vertical output is a Live Control Room / encoder-side behaviour; vertical-live Shorts feed reported as closed beta (secondary source) |
| RTMPS | `NATIVE API` | `cdn.ingestionInfo.rtmpsIngestionAddress` + `rtmpsBackupIngestionAddress` |
| SRT | `UNAVAILABLE` | Official protocol comparison lists only RTMP, RTMPS, HLS, DASH |
| WHIP / WebRTC ingest | `UNAVAILABLE` | `cdn.ingestionType` accepts only `rtmp` (incl. RTMPS), `hls`, `dash` |

## 1.2 Exact endpoints and scopes

### Endpoints (base `https://www.googleapis.com/youtube/v3`)

| Purpose | Method + path |
|---|---|
| Create broadcast | `POST /liveBroadcasts` (`part=id,snippet,contentDetails,status`) |
| List broadcasts | `GET /liveBroadcasts` |
| Update broadcast | `PUT /liveBroadcasts` |
| Delete broadcast | `DELETE /liveBroadcasts` |
| Bind stream to broadcast | `POST /liveBroadcasts/bind` (`id`, `part`, `streamId`) |
| Transition state | `POST /liveBroadcasts/transition` (`id`, `part`, `broadcastStatus=testing|live|complete`) |
| Insert ad cuepoint | `POST /liveBroadcasts/cuepoint` |
| Create stream | `POST /liveStreams` (`part=id,snippet,cdn,contentDetails,status`) |
| List / update / delete stream | `GET` / `PUT` / `DELETE /liveStreams` |
| Chat read (poll) | `GET /liveChat/messages` (`liveChatId`, `part=id,snippet,authorDetails`) |
| Chat read (stream) | `liveChatMessages.streamList` — server-streaming connection. **Exact request URL not stated on the reference page; treat the transport detail as `UNVERIFIED`** |
| Chat write | `POST /liveChat/messages` (`part=snippet`) |
| Chat delete message | `DELETE /liveChat/messages` |
| Ban / timeout | `POST /liveChat/bans`, `DELETE /liveChat/bans` |
| Moderators | `GET`/`POST`/`DELETE /liveChat/moderators` |
| Super Chat events | `GET /superChatEvents` |
| Live stats / concurrents | `GET /videos?part=liveStreamingDetails,statistics` |
| Thumbnail | `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=…` |
| Analytics | `GET https://youtubeanalytics.googleapis.com/v2/reports` |

### Required request bodies (verified)

* `liveBroadcasts.insert` **mandatory**: `snippet.title`, `snippet.scheduledStartTime`, `status.privacyStatus`.
  Settable: `snippet.{title,description,categoryId,scheduledStartTime,scheduledEndTime}`, `status.{privacyStatus,selfDeclaredMadeForKids}`, `contentDetails.{monitorStream.enableMonitorStream, monitorStream.broadcastStreamDelayMs, enableAutoStart, enableAutoStop, enableClosedCaptions, enableDvr, enableEmbed, recordFromStart, availabilityConfig}`.
  **Note:** `contentDetails.latencyPreference` was *not* present in the insert-request property list on the official page — treat it as `UNVERIFIED` and set latency via `monitorStream.broadcastStreamDelayMs` / encoder settings instead.
* `liveStreams.insert` **mandatory**: `snippet.title`, `cdn.frameRate`, `cdn.ingestionType`, `cdn.resolution`.
  * `cdn.ingestionType`: `dash`, `hls`, `rtmp` (which includes RTMPS)
  * `cdn.resolution`: `240p`, `360p`, `480p`, `720p`, `1080p`, `1440p`, `2160p`, `variable`
  * `cdn.frameRate`: `30fps`, `60fps`, `variable`
  * `variable` resolution must be paired with `variable` frame rate
  * Response `cdn.ingestionInfo`: `streamName`, `ingestionAddress`, `backupIngestionAddress`, `rtmpsIngestionAddress`, `rtmpsBackupIngestionAddress`
* `liveChatMessages.insert` **mandatory**: `snippet.liveChatId`, `snippet.type` (`textMessageEvent` | `pollEvent`), plus `snippet.textMessageDetails.messageText` or `snippet.pollDetails.metadata.{questionText,options[2..4]}`.

### Scopes

| Scope | Needed for |
|---|---|
| `https://www.googleapis.com/auth/youtube.force-ssl` | **Primary scope for LIVETAP.** Required/accepted by every liveBroadcasts, liveStreams, liveChat* method; only scope that permits chat write + moderation |
| `https://www.googleapis.com/auth/youtube` | Alternative to force-ssl on all live methods; also thumbnails.set |
| `https://www.googleapis.com/auth/youtube.upload` | thumbnails.set (alternative) |
| `https://www.googleapis.com/auth/youtube.readonly` | Read-only channel/video reads |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | YouTube Analytics `reports.query` (views, watch time, `liveOrOnDemand`) |
| `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | Revenue metrics |
| `https://www.googleapis.com/auth/youtube.channel-memberships.creator` | Channel members list |
| `https://www.googleapis.com/auth/youtubepartner` | Content-owner/partner operations |

**Recommended minimal set for LIVETAP:** `youtube.force-ssl` (+ `yt-analytics.readonly` only if analytics is shipped). Both are sensitive/restricted-class YouTube scopes → verification required (see 1.6).

## 1.3 Recommended OAuth flow

### Desktop app (LIVETAP native client)

1. Create an OAuth client of type **Desktop app** in Google Cloud Console.
2. Use Authorization Code + **PKCE** with a **loopback redirect**: `http://127.0.0.1:<random-port>` or `http://[::1]:<port>`. This is documented as "the recommended mechanism for obtaining the authorization code" for macOS/Linux/Windows desktop.
3. `code_challenge_method=S256` (`plain` is also accepted; use S256).
4. Token endpoint: `POST https://oauth2.googleapis.com/token`.
5. **Do NOT rely on**: `urn:ietf:wg:oauth:2.0:oob` (no longer supported) or custom URI schemes (deprecated — "no longer supported due to the risk of app impersonation"). Loopback on **mobile** is also deprecated.
6. Desktop clients in Google Cloud still *issue* a client secret; it is not a real secret in a distributed desktop binary. PKCE is what protects the exchange. Google states the client secret "is not applicable to requests from clients registered as Android, iOS, or Chrome applications" — for the **Desktop** type the console still shows one, so ship it as an obfuscated non-secret and always send PKCE. (Whether the Desktop token endpoint *rejects* a request lacking `client_secret` is `UNVERIFIED`; implement sending it.)

### Web app (LIVETAP hosted)

1. Create an OAuth client of type **Web application**; register exact HTTPS redirect URIs.
2. Authorization Code on the **server side** with the client secret held server-side only. PKCE can and should still be layered on, but the secret is mandatory for web clients — never ship a web client's secret to the browser or to a desktop binary.
3. Request `access_type=offline` + `prompt=consent` to reliably obtain a refresh token.

### Token lifetimes / refresh

* Access tokens: short-lived (Google's standard is 1 hour). Refresh tokens are long-lived but can be invalidated by user revocation, password change, 6 months of inactivity, or exceeding the per-client-per-user refresh-token cap.
* Apps left in **Testing** publishing status get refresh tokens that expire in 7 days — this is a classic multistreaming-tool bug. Exact current wording not re-verified in this pass → `UNVERIFIED` on the 7-day figure; the Testing/Production distinction itself is documented.

## 1.4 Go-live sequence (numbered API calls)

Derived from the official "Life of a broadcast" guide.

1. `POST /liveBroadcasts?part=snippet,contentDetails,status` — create the broadcast. Set `snippet.title`, `snippet.scheduledStartTime`, `status.privacyStatus`, and `contentDetails.{enableDvr, recordFromStart, enableAutoStart, enableAutoStop, monitorStream.enableMonitorStream}`.
2. `POST /liveStreams?part=snippet,cdn,contentDetails` — create the stream: `cdn.ingestionType=rtmp`, `cdn.resolution`, `cdn.frameRate`, `contentDetails.isReusable=true` (default) so one stream object can serve many broadcasts.
3. Read `cdn.ingestionInfo.rtmpsIngestionAddress` + `cdn.ingestionInfo.streamName` from the step-2 response → this is the RTMPS URL + stream key for the encoder. Keep `rtmpsBackupIngestionAddress` for failover.
4. `POST /liveBroadcasts/bind?id=<broadcastId>&part=id,contentDetails&streamId=<streamId>` — bind stream to broadcast.
5. `POST https://.../upload/youtube/v3/thumbnails/set?videoId=<broadcastId>` — optional custom thumbnail (broadcast id == video id).
6. Start the encoder pushing to the RTMPS ingest.
7. Poll `GET /liveStreams?part=status&id=<streamId>` until `status.streamStatus == "active"`. **Required** before any transition — otherwise `errorStreamInactive`.
8. *(optional)* `POST /liveBroadcasts/transition?broadcastStatus=testing&id=…&part=status` — only valid if the monitor stream is enabled.
9. `POST /liveBroadcasts/transition?broadcastStatus=live&id=…&part=status` — go live. **Skip this entirely if you set `contentDetails.enableAutoStart=true`** (official note: enableAutoStart/enableAutoStop cannot be `true` if you intend to use the testing stage, because testing would start the broadcast).
10. While live: `GET /videos?part=liveStreamingDetails&id=<broadcastId>` for `concurrentViewers` and `activeLiveChatId`; `liveBroadcasts.list?part=snippet` also exposes `snippet.liveChatId`.
11. *(optional)* `POST /liveBroadcasts/cuepoint` for ad breaks.
12. Stop the encoder.
13. `POST /liveBroadcasts/transition?broadcastStatus=complete&id=…&part=status` — end. **Skip if `enableAutoStop=true`** (auto-completes ~1 minute after transmission stops).

Transition errors to handle explicitly: `errorStreamInactive`, `invalidTransition`, `redundantTransition`, `concurrentBroadcastsExceedLimit`.

## 1.5 Chat / moderation / analytics approach

* **Chat read:** prefer `liveChatMessages.streamList` (server-streaming push) over `liveChatMessages.list` polling — the official docs recommend it because it "reduces the need for constant polling", which directly reduces quota burn. `maxResults` 200–2000 (default 500); `profileImageSize` 16–720 px (default 88). When polling, honour `pollingIntervalMillis`; documented constraints include "there can only be one poll per chat" and you cannot fetch messages older than the initial request.
* **Chat write:** `liveChatMessages.insert` with `part=snippet`. Supports text messages and polls (2–4 options).
* **Moderation:** `liveChatMessages.delete` (single message), `liveChatBans.insert` (ban/timeout) + `liveChatBans.delete` (unban), `liveChatModerators.*` to manage the mod list. All need `youtube.force-ssl`.
* **Analytics:** two tiers.
  * Real-time-ish: `videos.list?part=liveStreamingDetails` → `concurrentViewers` (absent if zero viewers or the owner hid the count), `actualStartTime`, `actualEndTime`, `activeLiveChatId`.
  * Historical: YouTube Analytics API `GET https://youtubeanalytics.googleapis.com/v2/reports` with the `liveOrOnDemand` dimension (`LIVE` / `ON_DEMAND`, data from 2014-04-01) and `creatorContentType` (identifies livestream vs Shorts vs VOD). Scope `yt-analytics.readonly`.

## 1.6 Review / eligibility / quota / rate limits

**Quota (official page, last updated 2026-09-04):**
* Default allocation is **not** a flat 10,000: it is **100 `search.list` calls/day + 100 `videos.insert` calls/day + 10,000 units/day combined for all other endpoints**. `search.list` and `videos.insert` have their own buckets and cost 1 unit per call.
* Every request, including invalid ones, costs at least 1 unit. Each additional page of a paged result incurs the cost again.
* Daily quotas reset at midnight Pacific Time.
* Documented per-method costs: `activities.list` 1, `channels.list` 1, `channels.update` 50, `playlistItems.insert/update/delete` 50, `thumbnails.set` 50, `videos.list` 1, `videos.update` 50, `videos.rate` 50, `captions.insert` 400, `captions.update` 450, `watermarks.set` 50.
* **Gotcha:** although the page states "API methods for live streaming are also listed in the table", the rendered quota table contains **no rows for `liveBroadcasts`, `liveStreams`, `liveChatMessages`, `liveChatBans`, or `liveChatModerators`**. Exact per-call costs for live-streaming methods are therefore **`UNVERIFIED`**. Budget against the documented general rule ("a read operation… usually costs 1 unit. A write operation… usually costs 50 units"), i.e. assume ~50 units per insert/update/bind/transition/delete and ~1 per list, and instrument real usage from `Ratelimit`/quota dashboards before committing capacity numbers.
* Exceeding the default requires a **compliance audit**: "If you would like to request additional quota beyond the default allocation, you must first complete an audit." Forms: Audit and Quota Extension `https://support.google.com/youtube/contact/yt_api_form`, Appeals `https://support.google.com/youtube/contact/yt_api_appeals`, Change of Control `https://support.google.com/youtube/contact/yt_api_change_of_control_form`. Official timeline is only "a member of YouTube's API Services team will contact you as soon as possible" — no SLA (secondary sources report weeks to months).

**OAuth verification:** Google classifies scopes as non-sensitive / sensitive / restricted; "Apps that request access to scopes categorized as sensitive or restricted must complete Google's OAuth app verification before being granted access." Restricted-scope apps need annual re-verification and a CASA security assessment. The 100-test-user cap for apps in *Testing* publishing status is referenced in the help-centre navigation but the explanatory text was not retrievable in this pass → cap figure `UNVERIFIED`, the Testing-vs-Production gate itself is confirmed.

**Channel eligibility (support.google.com/youtube/answer/9227509):**
* Must be **16+**.
* Channel must be **verified**.
* **No live-streaming restrictions in the past 90 days.**
* A community-guidelines strike during a stream blocks live streaming for **14 days**; circumventing with another channel can terminate the account.
* **Limit of 10 active streams per channel and 3 active streams per stream key.**
* The commonly cited "phone verification + 24-hour wait" is real in practice but was **not** stated on the page fetched → `UNVERIFIED` as an exact figure; treat as "channel verification then a waiting period".

**Encoder settings (support.google.com/youtube/answer/2853702):**
* Codecs: **H.264, H.265/HEVC, and AV1**. Audio AAC or MP3 (5.1 via AAC only), 128 kbps stereo / 384 kbps 5.1.
* Keyframe interval: **recommended 2 s, maximum 4 s**. CBR. Up to 60 fps.
* Bitrate (min–max, H.264 recommended): 2160p60 10–40 Mbps (35); 2160p30 8–35 (30); 1440p60 6–30 (24); 1440p30 5–25 (15); 1080p60 4–10 (12); 1080p30 3–8 (10); 720p60 3–8 (6); 240–720p30 3–8 (4). *(These min/max/recommended columns are internally inconsistent on Google's own page for 1080p — recommended exceeds max. Treat the "recommended" column as the target.)*
* At 4K/2160p the "improve for low latency" option is unavailable.
* Protocol capability matrix (official ingestion-protocol-comparison): **RTMP** (unencrypted, H.264, suitable for normal/low/ultra-low latency), **RTMPS** (encrypted, H.264, low/ultra-low latency, prevents MITM on ingest), **HLS** (encrypted, H.264 + **HEVC**, HDR, better for 4K, *not* suitable for ultra-low latency), **DASH** (encrypted, H.264 + **VP9**, better for 4K, not ultra-low latency). **No SRT. No WebRTC/WHIP.**

## 1.7 Gotchas

1. **`scheduledStartTime` is mandatory** on `liveBroadcasts.insert` even for "go live right now" — pass `now` (or a few seconds out).
2. **`enableAutoStart` and the testing stage are mutually exclusive.** Official text: these properties "can't be set to `true` before the testing stage because the test would actually cause the broadcast to start."
3. **You must poll `liveStreams.list` for `streamStatus == active` before transitioning** or you get `errorStreamInactive`. There is no push notification for this; it is a poll loop, and each poll costs quota.
4. **Live-streaming methods are missing from the official quota table** while the page insists they are there. Any capacity model you build is an estimate until you measure it.
5. **`search.list` is now a hard 100 calls/day bucket.** Never use search to discover a channel's live broadcast; use `liveBroadcasts.list` / `videos.list` with explicit IDs.
6. **Two separate approval tracks.** Google Cloud OAuth verification (consent screen / sensitive scopes) is *not* the same as the YouTube API Services compliance audit (quota). A multistreaming product needs both.
7. **Broadcast id == video id** for `thumbnails.set` and `videos.list`. Convenient, and a frequent source of confusion.
8. **`isReusable` streams** let you keep one stable stream key across broadcasts — essential if LIVETAP wants to let users paste a persistent key into an encoder, instead of re-keying every session.
9. **`concurrentViewers` disappears** (field absent, not zero) when there are no viewers or the owner hid the count — handle absence, don't default to 0 silently.
10. **10 active streams / channel and 3 active streams per stream key** will bite a multistreaming tool that creates a stream object per session without cleaning up.
11. **Vertical 9:16 has no API surface.** There is no aspect-ratio or "format" field on `liveBroadcasts` or `liveStreams`. Vertical/dual-format is decided by what the encoder pushes and by Live Control Room behaviour.
12. **OOB redirect is dead and custom schemes are deprecated** — if LIVETAP inherits any old desktop OAuth code, it must be migrated to loopback + PKCE.

## 1.8 Sources (YouTube)

* https://developers.google.com/youtube/v3/live/docs — API reference index
* https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/insert
* https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/bind
* https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition
* https://developers.google.com/youtube/v3/live/docs/liveStreams
* https://developers.google.com/youtube/v3/live/docs/liveStreams/insert
* https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list
* https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
* https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert
* https://developers.google.com/youtube/v3/live/life-of-a-broadcast
* https://developers.google.com/youtube/v3/live/guides/ingestion-protocol-comparison
* https://developers.google.com/youtube/v3/live/guides/hls-ingestion
* https://developers.google.com/youtube/v3/docs/videos
* https://developers.google.com/youtube/v3/docs/thumbnails/set
* https://developers.google.com/youtube/v3/determine_quota_cost (fetched 2026-09-11; page last updated 2026-09-04)
* https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
* https://developers.google.com/youtube/analytics/reference/reports/query
* https://developers.google.com/youtube/analytics/dimensions
* https://developers.google.com/identity/protocols/oauth2/native-app
* https://developers.google.com/identity/protocols/oauth2/scopes
* https://support.google.com/youtube/answer/2853702 (live encoder settings)
* https://support.google.com/youtube/answer/9227509 (live streaming requirements)
* https://support.google.com/cloud/answer/9110914 and /13463073 (OAuth app verification)
* Secondary (context only): reports of vertical-live closed beta in US/CA/UK/AU — https://www.creatoressentials.com/glossary/vertical-live/, https://support.restream.io/en/articles/9520510-stream-to-youtube-shorts

---

# 2. Twitch (Helix API + EventSub)

## 2.1 Capability classification

| Capability | Classification | Notes |
|---|---|---|
| OAuth | `OAUTH + API` | Authorization Code, Implicit, Client Credentials, **Device Code** |
| PKCE | `UNAVAILABLE` | PKCE / `code_challenge` is **not mentioned anywhere** in Twitch's authentication docs. Use Device Code Grant for public clients |
| Broadcast Creation | `RTMP DESTINATION` | No broadcast object exists. A Twitch channel is persistent; a "stream" is created implicitly by ingest |
| Stream Creation | `RTMP DESTINATION` | Same — nothing to create |
| Stream Key retrieval | `NATIVE API` | `GET /helix/streams/key`, scope `channel:read:stream_key` |
| Start | `RTMP DESTINATION` | Auto-starts when RTMP data arrives. No start endpoint |
| Stop | `RTMP DESTINATION` | Stop pushing bytes. No stop endpoint |
| Metadata | `NATIVE API` | `PATCH /helix/channels`, scope `channel:manage:broadcast` (title, game/category, language, tags, CCLs) |
| Thumbnail | `UNAVAILABLE` | Live thumbnails are auto-captured; `thumbnail_url` is read-only on Get Streams |
| Chat Read | `NATIVE API` | EventSub `channel.chat.message` v1 over WebSocket (preferred); IRC still works but docs recommend against it |
| Chat Write | `NATIVE API` | `POST /helix/chat/messages`, scope `user:write:chat` (or `user:bot` + `channel:bot`) |
| Moderation | `NATIVE API` | `POST/DELETE /helix/moderation/bans`, `DELETE /helix/chat/messages` |
| Analytics | `NATIVE API` (partial) | `GET /helix/analytics/games` (scope `analytics:read:games`) returns a CSV download URL; **per-stream concurrent-viewer analytics are not available via API** |
| Live Status | `NATIVE API` | `GET /helix/streams` (`viewer_count`, `started_at`, `type`) + EventSub `stream.online` / `stream.offline` v1 |
| Scheduling | `NATIVE API` | `GET /helix/schedule`. Segment create/update/delete endpoints exist in the reference but their exact paths/scopes were **not verified in this pass** → `UNVERIFIED` |
| Application Review needed | `UNAVAILABLE` (i.e. none) | Self-serve. "Apps are created immediately upon clicking Create"; no review workflow documented. 2FA on the Twitch account is mandatory to register |
| Eligibility gates | `UNAVAILABLE` (i.e. none) | Affiliate/Partner status is **not** required to stream or to use the API. Partner/Affiliate gates apply only to 1440p/HEVC and server-side transcoding |
| Regional Restrictions | `UNVERIFIED` | Nothing found in official docs |
| Account Restrictions | `USER-ASSISTED` | Suspensions/bans are account-level, resolved in the Twitch UI |
| Vertical 9:16 support | `USER-ASSISTED` | **Dual Format streaming is GA for all streamers as of June 2026**, delivered via Enhanced Broadcasting client-side encoding. Configured in the encoder, not via API |
| RTMPS | `RTMP DESTINATION` | Official docs give the URL form as `rtmp://<ingest-server>/app/<stream-key>`; `rtmps://live.twitch.tv/app` is widely used but is a **secondary-source** claim here |
| SRT | `UNAVAILABLE` | Official video-broadcast docs name RTMP only |
| WHIP / WebRTC ingest | `UNAVAILABLE` | Not documented |

## 2.2 Exact endpoints and scopes

### OAuth endpoints

* Authorize: `https://id.twitch.tv/oauth2/authorize`
* Token: `https://id.twitch.tv/oauth2/token`
* Device code: `https://id.twitch.tv/oauth2/device`

### Helix endpoints (base `https://api.twitch.tv/helix`)

| Purpose | Method + path | Scope |
|---|---|---|
| Get Stream Key | `GET /streams/key` | `channel:read:stream_key` |
| Get Streams (live status, viewer_count) | `GET /streams` | app or user token |
| Get Channel Information | `GET /channels` | app or user token |
| Modify Channel Information | `PATCH /channels` | `channel:manage:broadcast` |
| Send Chat Message | `POST /chat/messages` | `user:write:chat` (or `user:bot` + `channel:bot`) |
| Get Chatters | `GET /chat/chatters` | `moderator:read:chatters` |
| Ban / timeout user | `POST /moderation/bans` | `moderator:manage:banned_users` |
| Unban user | `DELETE /moderation/bans` | `moderator:manage:banned_users` |
| Delete chat message(s) | `DELETE /chat/messages` | `moderator:manage:chat_messages` |
| Get Channel Stream Schedule | `GET /schedule` | app or user token |
| Create Stream Marker | `POST /streams/markers` | `channel:manage:broadcast` — the reference also shows `stream:manage:markers`; **exact scope `UNVERIFIED`** |
| Get Games / Search Categories | `GET /games`, `GET /search/categories` | app or user token |
| Start Commercial | `POST /channels/commercial` | `channel:edit:commercial` |
| Get Game Analytics | `GET /analytics/games` | `analytics:read:games` |
| Get Broadcaster Subscriptions | `GET /subscriptions` | `channel:read:subscriptions` |
| EventSub create/get/delete | `POST` / `GET` / `DELETE /eventsub/subscriptions` | webhook → app token; websocket → user token |
| Get Ingest Servers | `GET https://ingest.twitch.tv/ingests` | **no auth** |

Request bodies (verified):
* Send Chat Message: `broadcaster_id` (req), `sender_id` (req), `message` (req), `reply_parent_message_id` (opt).
* Ban User: `data.user_id` (req), `data.duration` (opt, seconds — omit for permanent ban), `data.reason` (opt, max 500 chars).
* Delete Chat Messages: query `broadcaster_id` (req), `moderator_id` (req), `message_id` (opt — omit to clear all).

### Scopes (exact strings, from the official scopes reference)

| Scope | Grants |
|---|---|
| `channel:manage:broadcast` | Update channel configuration, stream markers, stream tags |
| `channel:read:stream_key` | View the authorized user's stream key |
| `user:read:chat` | Receive chatroom messages and informational notifications (EventSub chat) |
| `user:write:chat` | Send chat messages to a chatroom |
| `user:bot` | Join chat as your user, appearing as a bot |
| `channel:bot` | Join your channel's chatroom as a bot user |
| `chat:read` | View chat messages via IRC (legacy) |
| `chat:edit` | Send chat messages via IRC (legacy) |
| `moderator:manage:banned_users` | Ban and unban users |
| `moderator:manage:chat_messages` | Delete chat messages; manage pinned messages |
| `moderator:read:chatters` | View chatters in a broadcaster's chat room |
| `analytics:read:games` | Game analytics for owned games |
| `channel:read:subscriptions` | Subscriber list / subscription check |
| `moderator:read:followers` | Required for EventSub `channel.follow` v2 |
| `channel:moderate` | Required for EventSub `channel.ban` v1 |
| `channel:manage:moderators` | Required for EventSub `channel.moderate` |

**Recommended minimal set for LIVETAP:** `channel:read:stream_key channel:manage:broadcast user:read:chat user:write:chat moderator:manage:banned_users moderator:manage:chat_messages`.

## 2.3 Recommended OAuth flow

### Desktop app

Use the **Device Code Grant** (`grant_type=urn:ietf:params:oauth:grant-type:device_code`). Rationale:
* Twitch **does not document PKCE**, so Authorization Code from a desktop binary would require shipping the client secret — unacceptable.
* Implicit Grant returns no refresh token, so the user would re-authorize constantly.
* Device Code is explicitly for "apps with limited input capabilities or that lack a suitable browser", returns a refresh token, and requires no client secret at the device.
* Documented characteristics: access token lifetime **4 hours**; refresh token is **one-time-use** and expires after **30 days of inactivity** — so persist the rotated refresh token on every refresh or you lock the user out.

### Web app

**Authorization Code Grant** with the client secret held server-side (`response_type=code` → `grant_type=authorization_code`). Refresh token is returned. Observed `expires_in` in Twitch's own example is ~14,124 s (~4 h), so treat access tokens as ~4 h and refresh proactively. Always send and verify `state` (documented as "strongly encouraged" for CSRF; Twitch does not enforce it, so LIVETAP must).

**Do not use Implicit Grant** anywhere in LIVETAP — no refresh token, token in the URL fragment.

App registration: requires **2FA enabled** on the Twitch account, a **globally unique app name**, OAuth redirect URL(s), and a category. Client secrets are generated on demand and regenerating invalidates the previous one. No approval queue.

## 2.4 Go-live sequence (numbered API calls)

Twitch has no broadcast lifecycle API — the sequence is metadata-then-ingest.

1. `GET /helix/users` (or the token's `user_id` from validate) to resolve `broadcaster_id`. *(Endpoint path `GET /helix/users` not re-verified in this pass — `UNVERIFIED` on the exact path, though it is the canonical one.)*
2. `GET /helix/search/categories?query=<game>` → resolve `game_id` for the category the user picked.
3. `PATCH /helix/channels?broadcaster_id=<id>` with `{ "title": …, "game_id": …, "broadcaster_language": …, "tags": [...] }` — scope `channel:manage:broadcast`. Do this **before** going live so the stream appears correctly from second zero.
4. `GET /helix/streams/key?broadcaster_id=<id>` — scope `channel:read:stream_key`.
5. *(optional)* `GET https://ingest.twitch.tv/ingests` (no auth) to pick a low-latency PoP; substitute the key into the template. Official URL form: `rtmp://<ingest-server>/app/<stream-key>[?bandwidthtest=true]`, e.g. `rtmp://sfo.contribute.live-video.net/app/live_user_123456789`. The `?bandwidthtest=true` query param disables live viewing — use it for LIVETAP's connection-test feature.
6. Open an EventSub **WebSocket** to `wss://eventsub.wss.twitch.tv/ws` (optionally `?keepalive_timeout_seconds=10..600`), wait for the Welcome message, capture `session_id`.
7. `POST /helix/eventsub/subscriptions` (user token) for: `stream.online` v1, `stream.offline` v1, `channel.update` v2, `channel.chat.message` v1, `channel.chat.message_delete` v1, `channel.chat.clear` v1 — transport `{ "method": "websocket", "session_id": … }`.
8. Start the encoder. **The broadcast begins automatically**; `stream.online` fires.
9. While live: `GET /helix/streams?user_id=<id>` for `viewer_count` (poll; there is no viewer-count EventSub event).
10. `PATCH /helix/channels` any time to change title/category mid-stream.
11. Stop the encoder. `stream.offline` fires. **There is no stop endpoint.**

## 2.5 Chat / moderation / analytics approach

* **Chat read — use EventSub WebSocket, not IRC.** Official guidance: "Twitch IRC has some limitations versus EventSub, and is more complicated to parse, so it is recommended that you use EventSub subscriptions and API calls instead." IRC remains available at `wss://irc-ws.chat.twitch.tv:443` and `irc://irc.chat.twitch.tv:6697` (port 6667 non-SSL is decommissioned), authenticating with `PASS oauth:<token>` / `NICK <lowercase-login>` and scopes `chat:read` / `chat:edit`. The IRC docs do **not** publish numeric send limits — the commonly quoted "20 messages / 30 s" is `UNVERIFIED` from the page fetched; the docs only warn that excess messages are "silently drop[ped]" and the connection may be closed.
* **Chat write — use Helix** `POST /helix/chat/messages` rather than IRC PRIVMSG. Per-endpoint rate limits are documented on individual endpoint pages; not captured here → `UNVERIFIED`.
* **Moderation:** `POST /helix/moderation/bans` handles both ban (omit `duration`) and timeout (`duration` in seconds); `DELETE /helix/moderation/bans` unbans; `DELETE /helix/chat/messages` deletes one message or clears chat. Mirror inbound state with EventSub `channel.moderate`, `channel.ban`, `channel.chat.message_delete`.
* **Analytics:** thin. `GET /helix/analytics/games` returns a **CSV download URL** (game-level, requires ≥300 minutes of coverage, past 365 days), and extension analytics likewise. Twitch's insights docs give only aggregate "Peak Concurrent Viewers" / "Average Concurrent Viewers" at game level — **there is no per-stream concurrent-viewer analytics API**. For LIVETAP, build live-viewer graphs by sampling `GET /helix/streams` yourself and storing the series.

## 2.6 Review / eligibility / quota / rate limits

* **No app review.** Registration is instant; 2FA required on the account.
* **Rate limits:** token-bucket. Each app gets a bucket of points; default endpoint cost is **1 point**, and exhausting the bucket within 60 seconds yields HTTP 429. Headers on every response: `Ratelimit-Limit`, `Ratelimit-Remaining`, `Ratelimit-Reset` (Unix timestamp). Twitch's own example shows a limit of **800**. Separate buckets for app access tokens and for user access tokens (the latter "per client ID per user per minute"). Some endpoints return 429 for reasons unrelated to the general bucket, so parse the error message, don't just back off.
* **Required headers:** `Authorization: Bearer <token>` and `Client-Id: <client_id>`.
* **EventSub limits (official):**
  * Max **3 subscriptions with the same `type` and `condition`**.
  * **Webhooks:** max total cost **10,000**.
  * **WebSockets (per user token):** max **3 connections** with enabled subscriptions; max **300 enabled subscriptions per connection**; max total cost **10**.
  * Cost rules: subscriptions that require user authorization cost **0**; subscriptions that don't (e.g. `stream.online`) cost **1**, reduced to **0** if the user has authorized your app. So a properly-authorized multistreaming app effectively lives at cost 0 and is bounded by the 300/connection and 3-connection limits.
  * WebSocket keepalive: `keepalive_timeout_seconds` 10–600; if no notification or keepalive arrives within the window, reconnect and **resubscribe**. On a `session_reconnect` message you get ~30 s and a `reconnect_url`; do not close the old socket until the new one sends Welcome, or you get close code **4004**. Reconnect-URL connections do not count toward the 3-connection limit.
* **Eligibility:** none for streaming or API use. Partner/Affiliate status is required for **1440p/2K** and unlocks server-side transcoding; **HEVC up to 1440p at up to 9 Mbps (7.5 Mbps at 1080p)**; **AV1 and 4K remain limited to the Twitch Enhanced Broadcasting beta community** and Twitch is not actively expanding it (secondary sources, June 2026 blog + coverage).
* **Encoder settings:** the canonical page (`help.twitch.tv/s/article/broadcast-guidelines`) is a JavaScript-rendered Salesforce portal and could not be machine-read in this pass. Verified from official developer docs: RTMP ingest, URL template `rtmp://<ingest-server>/app/<stream-key>`, `?bandwidthtest=true` for Twitch Inspector. Verified from the official Twitch blog: HEVC 1440p ≤ 9 Mbps, 1080p 7.5 Mbps. The classic **H.264 / CBR / 2-second keyframe / 6000 kbps cap** figures come only from secondary sources here → mark **`UNVERIFIED`** in code comments and re-confirm against the help article before hard-coding.

## 2.7 Gotchas

1. **No PKCE.** This is the single biggest architectural constraint for a desktop LIVETAP client. Device Code Grant is the only secretless flow with refresh.
2. **Device-code refresh tokens are one-time-use with a 30-day inactivity expiry.** Persist the new refresh token atomically on every refresh, or users get silently logged out.
3. **No start/stop API.** LIVETAP's "Go Live" button for Twitch is really "start pushing RTMP + set metadata"; "End Stream" is "stop pushing". Confirm state via `stream.online`/`stream.offline`, not by assuming.
4. **`channel.moderate` needs `channel:manage:moderators`**, which is a heavier scope than most users expect — consider deriving moderation feedback from `channel.ban` + `channel.chat.message_delete` instead.
5. **EventSub WebSocket total cost limit of 10** (vs 10,000 for webhooks). Fine when every subscription is user-authorized (cost 0), but a multi-account app that subscribes to `stream.online` for channels that have *not* authorized it will hit the cost ceiling after 10.
6. **Resubscribe on reconnect.** Subscriptions are bound to the WebSocket session, not to your app. A dropped socket loses them all.
7. **429s are not always the bucket.** Parse the body.
8. **No stream-level analytics.** If LIVETAP promises viewer graphs, it owns the sampling and storage.
9. **No thumbnail control.** Don't design a UI affordance for it.
10. **Ingest server selection matters** and `ingest.twitch.tv/ingests` needs no auth — cache it and let users override the PoP.
11. **Dual Format (vertical) is encoder-side.** It rides on Enhanced Broadcasting multi-encode; there is no API flag. LIVETAP would need to produce the second 9:16 encode itself.

## 2.8 Sources (Twitch)

* https://dev.twitch.tv/docs/authentication/ — flows overview
* https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ — endpoints, params, lifetimes
* https://dev.twitch.tv/docs/authentication/scopes/ — scope strings
* https://dev.twitch.tv/docs/authentication/register-app/ — 2FA, registration
* https://dev.twitch.tv/docs/api/guide/ — rate limits, headers
* https://dev.twitch.tv/docs/api/reference/ — endpoint reference (Get Stream Key, Get Streams, Modify Channel, Send Chat Message, bans, Delete Chat Messages, schedule, analytics)
* https://dev.twitch.tv/docs/eventsub/ — transports
* https://dev.twitch.tv/docs/eventsub/manage-subscriptions/ — cost/limit rules, subscription endpoints
* https://dev.twitch.tv/docs/eventsub/handling-websocket-events/ — wss URL, keepalive, reconnect, 4004
* https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ — type names, versions, scopes
* https://dev.twitch.tv/docs/chat/irc/ — IRC hosts/ports, EventSub recommendation
* https://dev.twitch.tv/docs/video-broadcast/ — RTMP URL format, ingest servers, bandwidthtest
* https://dev.twitch.tv/docs/video-broadcast/reference/ — `GET https://ingest.twitch.tv/ingests`
* https://dev.twitch.tv/docs/insights/ — analytics scope and limits
* https://blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/ — Dual Format GA, HEVC bitrates
* https://help.twitch.tv/s/article/broadcast-guidelines — canonical encoder guidelines (**not machine-readable; must be read manually**)
* Secondary (context only): https://blog.twitch.tv/en/2024/01/08/introducing-the-enhanced-broadcasting-beta/, https://help.twitch.tv/s/article/dual-format-vertical-video

---

# 3. Kick (Kick Public API / Kick Dev)

## 3.1 Capability classification

| Capability | Classification | Notes |
|---|---|---|
| OAuth | `OAUTH + API` | **OAuth 2.1** on `https://id.kick.com`; Authorization Code + Client Credentials. No implicit, no device flow |
| PKCE | `OAUTH + API` | **Mandatory** — `code_challenge` and `code_challenge_method=S256` are *required* query params. But `client_secret` is **also required** at the token endpoint → no true public-client support |
| Broadcast Creation | `UNAVAILABLE` | No broadcast/stream object to create |
| Stream Creation | `UNAVAILABLE` | Same |
| Stream Key retrieval | `OAUTH + API` (partly `UNVERIFIED`) | Scope `streamkey:read` = "Read a user's stream URL and stream key". The `endpoints.Stream` schema on `GET /public/v1/channels` contains `key` and `url`, and the page states "Available data will depend on the scopes attached to the authorization token used" — but the docs **never explicitly attach `streamkey:read` to an endpoint**. There is no dedicated stream-key endpoint in the OpenAPI surface |
| Start | `RTMP DESTINATION` | Auto-starts on ingest; no API |
| Stop | `RTMP DESTINATION` | No API |
| Metadata | `NATIVE API` | `PATCH /public/v1/channels`, scope `channel:write` — `stream_title`, `category_id`, `custom_tags` (max 10). Returns 204 |
| Thumbnail | `UNAVAILABLE` | `thumbnail` is read-only on channel/livestream responses |
| Chat Read | `NATIVE API` — **webhooks only** | `chat.message.sent` v1 webhook. **No WebSocket, no polling endpoint, no chat-history endpoint.** Requires a publicly reachable HTTPS URL configured in the Kick developer tab; "Localhost URLs won't work" |
| Chat Write | `NATIVE API` | `POST /public/v1/chat`, scope `chat:write` |
| Moderation | `NATIVE API` | `POST`/`DELETE /public/v1/moderation/bans` (`moderation:ban`), `DELETE /public/v1/chat/{message_id}` (`moderation:chat_message:manage`) |
| Analytics | `UNAVAILABLE` | No analytics API. Only `viewer_count` on livestream/channel reads (0 if the streamer hid it) and `GET /public/v1/livestreams/stats` which returns a platform-wide `total_count` — not channel analytics |
| Live Status | `NATIVE API` | `GET /public/v2/livestreams`, `GET /public/v1/users/livestreams`, `GET /public/v1/channels` (`stream.is_live`), plus `livestream.status.updated` v1 webhook |
| Scheduling | `UNAVAILABLE` | No scheduling endpoints |
| Application Review needed | `PARTNER APPROVAL REQUIRED` (optional) | App works immediately without review. **Verification is optional and email-based** (developers@kick.com) and raises the `chat.message.sent` subscription cap from **1,000 → 10,000** and grants a verified badge |
| Eligibility gates | `USER-ASSISTED` | Kick account + **2FA must be enabled** to access the Developer tab |
| Regional Restrictions | `UNVERIFIED` | Nothing in official docs |
| Account Restrictions | `USER-ASSISTED` | Handled in Kick UI |
| Vertical 9:16 support | `UNVERIFIED` | No official developer or help documentation found confirming vertical/portrait ingest |
| RTMPS | `UNVERIFIED` | Kick's own help article was unreachable (HTTP 403). Secondary sources give `rtmp://ingest.kick.com/live`. **RTMPS support not confirmed by any official source** |
| SRT | `UNVERIFIED` | Not documented either way |
| WHIP / WebRTC ingest | `UNAVAILABLE` | Not documented |

## 3.2 Exact endpoints and scopes

### OAuth (host `https://id.kick.com` — **different host from the API**)

| Purpose | Method + path |
|---|---|
| Authorize | `GET /oauth/authorize` — `client_id`, `response_type=code`, `redirect_uri`, `state` (**required**), `scope`, `code_challenge`, `code_challenge_method=S256` (all required) |
| Token (auth code) | `POST /oauth/token` — `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`, `code_verifier` |
| Token (app) | `POST /oauth/token` — `grant_type=client_credentials`, `client_id`, `client_secret` |
| Refresh | `POST /oauth/token` — `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` (returns a **new** access *and* refresh token) |
| Revoke | `POST /oauth/revoke?token=…&token_hint_type=access_token|refresh_token` |
| Introspect | `POST /oauth/token/introspect` with `Authorization: Bearer <token>` → `{active, client_id, token_type: "app"|"user", scope, exp}` |

All token requests use `Content-Type: application/x-www-form-urlencoded`. The older `POST /public/v1/token/introspect` is **deprecated** (moved under `/oauth`, 2026-01-15).

### API (base `https://api.kick.com`)

| Purpose | Method + path | Scope |
|---|---|---|
| Get channels (incl. `stream.is_live`, `stream.key`, `stream.url`, `viewer_count`, `category`, `stream_title`, subscriber counts) | `GET /public/v1/channels` (no params = authenticated user; or up to 50 `broadcaster_user_id`, or up to 50 `slug` ≤25 chars — **cannot mix**) | `channel:read` (+ `streamkey:read` for key/url — `UNVERIFIED` mapping) |
| Update stream metadata | `PATCH /public/v1/channels` — body `{stream_title?, category_id?, custom_tags?[≤10]}`, ≥1 required, 204 No Content | `channel:write` |
| Get user info | `GET /public/v1/users` | `user:read` |
| Live streams (paginated, cursor) | `GET /public/v2/livestreams` — `category_id` (≤25), `language_code` (BCP 47, ≤25), `limit`, `cursor` | user or app token |
| Live streams for users | `GET /public/v1/users/livestreams` — `user_id` (≤100) | user or app token |
| Live streams (v1, **deprecated**) | `GET /public/v1/livestreams` | user or app token |
| Platform livestream count | `GET /public/v1/livestreams/stats` → `{total_count}` | user or app token |
| Categories | `GET /public/v2/categories`, `GET /public/v1/categories/{id}` | user or app token |
| Send chat message | `POST /public/v1/chat` — body `{type: "user"|"bot" (req), content (req, ≤500 grapheme clusters and ≤2048 UTF-8 bytes), broadcaster_user_id (required for type=user, ignored for bot), reply_to_message_id? (uuid)}` → `{is_sent, message_id}` | `chat:write` |
| Delete chat message | `DELETE /public/v1/chat/{message_id}` | `moderation:chat_message:manage` |
| Ban / timeout | `POST /public/v1/moderation/bans` — body `{broadcaster_user_id (req), user_id (req), duration? (minutes, 1–10080 — omit for permanent ban), reason? (≤100 chars)}` | `moderation:ban` |
| Unban / clear timeout | `DELETE /public/v1/moderation/bans` — body `{broadcaster_user_id, user_id}` | `moderation:ban` |
| List event subscriptions | `GET /public/v1/events/subscriptions` | user or app token |
| Create event subscriptions | `POST /public/v1/events/subscriptions` — body `{events: [{name, version}] (req), method: "webhook", broadcaster_user_id (required with app token; ignored with user token)}` | `events:subscribe` (user) or app token |
| Delete event subscriptions | `DELETE /public/v1/events/subscriptions` | `events:subscribe` or app token |
| Webhook signing key | `GET /public/v1/public-key` | — |
| Channel rewards / redemptions | `/public/v1/channels/rewards…` | `channel:rewards:read` / `channel:rewards:write` |
| KICKs leaderboard | `GET /public/v1/kicks/leaderboard` | `kicks:read` |
| Ads | `/public/v1/…` ads endpoints | `ads:read` / `ads:write` |

### Scopes (complete official list)

`user:read`, `channel:read`, `channel:write`, `channel:rewards:read`, `channel:rewards:write`, `chat:write`, `streamkey:read`, `events:subscribe`, `moderation:ban`, `moderation:chat_message:manage`, `kicks:read`, `ads:read`, `ads:write`.

**Note there is no `chat:read` scope** — reading chat is exclusively via the `events:subscribe` webhook path.

**Recommended minimal set for LIVETAP:** `user:read channel:read channel:write streamkey:read chat:write events:subscribe moderation:ban moderation:chat_message:manage`.

### Webhook event types (name / version)

`chat.message.sent` v1, `channel.followed` v1, `channel.subscription.new` v1, `channel.subscription.renewal` v1, `channel.subscription.gifts` v1, `channel.reward.redemption.updated` v1, `livestream.status.updated` v1 (stream started/ended), `livestream.metadata.updated` v1, `moderation.banned` v1, `kicks.gifted` v1.

## 3.3 Recommended OAuth flow

### Desktop app

Authorization Code + PKCE (`S256`) with a **loopback redirect**, but be aware Kick requires `client_secret` at the token endpoint, so a pure desktop client **cannot** be fully secretless. Two options:

* **Preferred:** proxy the code→token exchange through a LIVETAP backend that holds the secret. The desktop client generates the verifier/challenge and receives only the resulting tokens. This keeps the secret server-side and still satisfies Kick's mandatory PKCE.
* **If shipping fully offline:** embed an obfuscated secret and accept that it is extractable. Not recommended for an open-source product, where the secret would be in the repository.

**Loopback gotcha (officially documented):** prefer `http://localhost/...` over `http://127.0.0.1/...`. Kick's docs front end is Next.js, which rewrites the first occurrence of `127.0.0.1` in a URL to `localhost`, breaking exact redirect-URI matching. Official workaround is to insert a sacrificial query param containing `127.0.0.1` (e.g. `&redirect=127.0.0.1`) *before* `redirect_uri`.

`state` is listed as **required** ("Yes (at the moment)") — always send it.

### Web app

Authorization Code + PKCE with the secret server-side. Straightforward; this is the flow Kick is designed around.

### Token lifetimes / refresh

Response fields are `access_token`, `token_type`, `refresh_token`, `expires_in`, `scope`. **Kick's docs do not state numeric lifetimes** — read `expires_in` at runtime. Refresh tokens were made "reusable/flexible" on 2025-11-25 (changelog), and refresh returns both a new access token and a new refresh token — persist both. Use `POST /oauth/token/introspect` to check `active` and `exp` rather than guessing.

## 3.4 Go-live sequence (numbered API calls)

1. `GET /public/v1/channels` (no params, user token) → `broadcaster_user_id`, current `category`, `stream_title`, `stream.is_live`.
2. `GET /public/v2/categories?...` to resolve the `category_id` the user picked.
3. `PATCH /public/v1/channels` with `{"stream_title": …, "category_id": …, "custom_tags": [...]}` — scope `channel:write`, expect **204**.
4. `GET /public/v1/channels` with a token carrying `streamkey:read` → read `stream.url` and `stream.key` from the `stream` object. **Treat as `UNVERIFIED`: validate empirically against a real token before shipping, and fall back to `USER-ASSISTED` (user pastes their key from kick.com) if the fields come back empty.**
5. Ensure the app's webhook URL is configured and enabled in the Kick Developer tab (one-time, `USER-ASSISTED`), and fetch `GET /public/v1/public-key` to verify signatures.
6. `POST /public/v1/events/subscriptions` with `{"method": "webhook", "events": [{"name":"livestream.status.updated","version":1},{"name":"livestream.metadata.updated","version":1},{"name":"chat.message.sent","version":1},{"name":"moderation.banned","version":1}]}` — scope `events:subscribe`.
7. Start the encoder pushing to the ingest URL + key. **The stream starts automatically**; `livestream.status.updated` fires.
8. While live: `GET /public/v1/users/livestreams?user_id=<id>` (or `GET /public/v1/channels`) for `viewer_count`, `started_at`, `title`, `tags`.
9. `PATCH /public/v1/channels` any time to change title/category mid-stream.
10. Stop the encoder. `livestream.status.updated` fires again. **No stop endpoint.**

## 3.5 Chat / moderation / analytics approach

* **Chat read is webhook-only.** This is the defining architectural constraint: LIVETAP **cannot read Kick chat from a desktop-only client**. Kick requires a publicly accessible HTTPS webhook URL configured per-app in the developer settings, and explicitly says localhost will not work without a tunnel (Cloudflare Tunnel / ngrok). For an open-source multistreamer this means either (a) LIVETAP runs a relay service that fans webhooks out to clients, or (b) Kick chat read is a self-hosted-only feature.
* Verify every webhook against `GET /public/v1/public-key`. Operational hazard: **an app that repeatedly fails to process a webhook event for over a day is automatically unsubscribed from that event** (changelog 2025-12-12), and **disabling webhooks auto-unsubscribes the app from all events** (2025-12-19). Build resubscription reconciliation.
* **Chat write:** `POST /public/v1/chat` with `type: "bot"` (posts to the token's own channel, `broadcaster_user_id` ignored) or `type: "user"` (requires `broadcaster_user_id`). 500 grapheme clusters / 2048 UTF-8 bytes max. 429 is a documented response.
* **Moderation:** bans/timeouts via `POST /public/v1/moderation/bans` — note **`duration` is in MINUTES** (1–10080, i.e. up to 7 days), unlike Twitch's seconds. Message deletion is `DELETE /public/v1/chat/{message_id}` using the UUID from the `chat.message.sent` payload (or the `message_id` returned by your own send).
* **Analytics:** effectively none. Sample `viewer_count` yourself. `viewer_count` is documented to be **0 when the streamer opted out of sharing it** — do not treat 0 as "no viewers".

## 3.6 Review / eligibility / quota / rate limits

* **App creation:** sign up → **enable 2FA** → kick.com/settings/developer → create app → get Client ID, Client Secret, redirect URL. Review Kick's Developer Terms and Conditions. No approval queue.
* **Verification (optional, `PARTNER APPROVAL REQUIRED` tier):** email developers@kick.com with Client ID, app name, whether the bot needs verification, reason, and supporting evidence. Benefits: verified badge on the bot account, and **chat subscription limit raised from 1,000 → 10,000**.
* **Subscription limits (official):** **10,000 subscriptions per event type per app**; for `chat.message.sent` specifically, **1,000 for unverified apps**.
* **Rate limits: not documented numerically.** The OpenAPI specs declare `429 Too Many Requests` responses (e.g. on `POST /public/v1/chat`) but no bucket size, window, or headers are published anywhere in docs.kick.com. **`UNVERIFIED` — implement adaptive backoff on 429 and assume nothing.**
* **Encoder settings: no official developer documentation.** `help.kick.com/en/articles/7066931-how-to-stream-on-kick-com` returned HTTP 403 to automated fetching. Secondary sources (streamersize.com, dacast, obs-versions) consistently report `rtmp://ingest.kick.com/live`, max 8,000 kbps, max 1920x1080, max 60 fps, H.264 only, CBR, 2-second keyframe interval. **All of that is secondary — `UNVERIFIED`.** Read the help article manually before hard-coding any of it.
* **API maturity signals:** `/public/v1/livestreams` and the v1 categories endpoints are already deprecated in favour of v2; the old introspect endpoint was moved. The docs describe the API as a "first release" with "more in the pipeline", with a public roadmap at github.com/orgs/KickEngineering/projects/3 and feedback via GitHub Issues / Discord. Expect churn.

## 3.7 Gotchas

1. **Chat read requires a public webhook endpoint.** No WebSocket, no polling, no `chat:read` scope. This is the #1 integration blocker for a desktop-first multistreamer.
2. **PKCE is mandatory but `client_secret` is still required** — Kick has no public-client mode. An open-source desktop build cannot hold this secret; plan a token-exchange proxy.
3. **`127.0.0.1` redirect URIs are broken** by Kick's own Next.js front end. Use `localhost`, or apply the documented sacrificial-query-param workaround.
4. **No dedicated stream-key endpoint.** The `streamkey:read` scope exists but is not bound to any documented endpoint; the key appears to ride on `GET /public/v1/channels` → `stream.key` / `stream.url`. Verify empirically; keep a manual-paste fallback.
5. **Ban `duration` is in minutes** (max 10080). Getting this wrong by a factor of 60 is an easy, user-visible bug.
6. **Webhooks auto-unsubscribe** after ~1 day of persistent processing failures, and disabling webhooks drops all subscriptions. Reconcile `GET /public/v1/events/subscriptions` on every startup.
7. **`viewer_count == 0` may mean "hidden", not "empty".**
8. **No rate limits published.** Only 429 response codes. Treat every endpoint as unknown-capacity.
9. **Rapid deprecation.** v1 livestreams and v1 categories are already deprecated; pin to v2 where it exists and watch docs.kick.com/changelog.
10. **No scheduling, no thumbnails, no analytics, no broadcast objects.** Kick's control plane is metadata + chat + moderation only.
11. **`GET /public/v1/channels` cannot mix `broadcaster_user_id` and `slug`** in one request (400).
12. **Two different hosts** — `id.kick.com` for OAuth, `api.kick.com` for the API. Easy misconfiguration.

## 3.8 Sources (Kick)

* https://docs.kick.com/llms.txt — documentation index (all pages available as `.md`)
* https://docs.kick.com/readme.md — API status, roadmap, changelog
* https://docs.kick.com/changelog.md — most recent entry 2026-08-11
* https://docs.kick.com/getting-started/kick-apps-setup.md — 2FA, app creation, PKCE
* https://docs.kick.com/getting-started/generating-tokens-oauth2-flow.md — OAuth 2.1 endpoints, params, 127.0.0.1 workaround, introspect
* https://docs.kick.com/getting-started/scopes.md — complete scope list
* https://docs.kick.com/apis/channels.md — GET/PATCH channels, `endpoints.Stream` with `key`/`url`
* https://docs.kick.com/apis/chat.md — POST /public/v1/chat, DELETE /public/v1/chat/{message_id}
* https://docs.kick.com/apis/moderation.md — bans (duration in minutes, 1–10080)
* https://docs.kick.com/apis/livestreams.md — v2 livestreams, users/livestreams, stats
* https://docs.kick.com/apis/users.md — users, deprecated introspect
* https://docs.kick.com/apis/faqs.md — app verification (1,000 → 10,000 chat subs), docs-UI testing
* https://docs.kick.com/events/introduction.md — webhook setup, no-localhost requirement
* https://docs.kick.com/events/subscribe-to-events.md — subscription endpoints and limits
* https://docs.kick.com/events/event-types.md — event names and versions
* https://docs.kick.com/events/webhook-security.md — signature verification, auto-disable
* https://github.com/orgs/KickEngineering/projects/3 — public roadmap
* Secondary (context only, **all ingest/encoder figures unverified**): https://help.kick.com/en/articles/7066931-how-to-stream-on-kick-com (403 to automated fetch — read manually), https://streamersize.com/platforms/kick/, https://www.dacast.com/blog/how-to-stream-on-kick-with-obs/

---

# 4. Cross-platform summary for LIVETAP architecture

| Dimension | YouTube | Twitch | Kick |
|---|---|---|---|
| Control-plane richness | Full broadcast lifecycle API | Metadata + chat only | Metadata + chat only |
| Go-live model | **Explicit** `transition` (or `enableAutoStart`) | **Implicit** on ingest | **Implicit** on ingest |
| Stream key source | `NATIVE API` per broadcast/stream | `NATIVE API`, persistent | `OAUTH + API`, `UNVERIFIED` mapping |
| Desktop OAuth | Auth Code + **PKCE**, loopback | **Device Code** (no PKCE) | Auth Code + PKCE, **but secret required** → needs proxy |
| Chat read transport | Server-streaming `streamList` (or polling) | EventSub **WebSocket** | **Webhook only** (needs public HTTPS) |
| Live viewer count | `videos.list` `liveStreamingDetails.concurrentViewers` | `GET /helix/streams` `viewer_count` | `viewer_count` (0 if hidden) |
| Hard gate to ship | Google OAuth verification **+** YouTube compliance audit | None | None (verification optional, for chat scale) |
| Quota model | Unit-based, 10,000/day + separate 100/day buckets | Token bucket, ~800 points/min, headers | **Undocumented** |
| RTMPS | Yes (`rtmpsIngestionAddress`) | Widely used, `UNVERIFIED` officially | `UNVERIFIED` |
| SRT / WHIP | No / No | No / No | `UNVERIFIED` / No |
| Vertical 9:16 | `EXPERIMENTAL`, no API | GA June 2026, encoder-side | `UNVERIFIED` |

**Design implications**

1. Build two go-live strategies, not one: an *explicit-lifecycle* adapter (YouTube) and an *ingest-implicit* adapter (Twitch, Kick). The YouTube adapter needs a stream-status poll loop and a state machine; the others need only metadata-then-push.
2. Build three different chat transports. There is no common abstraction below "message stream": HTTP server-streaming, WebSocket, and inbound webhook. Kick's webhook requirement forces either a hosted relay or a documented self-hosting step.
3. Auth is the hardest portability problem. PKCE-without-secret works on YouTube only. Twitch needs Device Code. Kick needs a server-side token exchange. A desktop-only, fully-offline LIVETAP can integrate YouTube and Twitch cleanly, but not Kick.
4. YouTube is the only platform with a real approval gate, and it has two of them. Start the OAuth verification and compliance-audit submissions early; there is no published SLA.
5. Normalise the units: ban durations are **seconds** on Twitch and **minutes** on Kick; YouTube uses `liveChatBans` with its own semantics.

## Open items requiring manual verification

1. Per-method YouTube quota costs for all `live*` methods (absent from the official quota table).
2. `contentDetails.latencyPreference` availability on `liveBroadcasts.insert`.
3. Exact HTTP transport/URL for `liveChatMessages.streamList`.
4. YouTube phone-verification + 24-hour wait as an exact, citable requirement.
5. Google OAuth Testing-status 100-user cap and refresh-token expiry figures.
6. Twitch official Broadcasting Guidelines numbers (help.twitch.tv is JS-rendered; read manually).
7. Twitch stream-schedule segment endpoints and the Create Stream Marker scope.
8. Whether Kick's `GET /public/v1/channels` actually returns `stream.key`/`stream.url` with `streamkey:read`.
9. Kick's official ingest URL, RTMPS/SRT support, and encoder limits (help article blocks automated fetch).
10. Kick API rate limits (entirely undocumented).
