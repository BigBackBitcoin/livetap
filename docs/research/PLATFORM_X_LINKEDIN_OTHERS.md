# PLATFORM RESEARCH — X, LinkedIn, and Secondary Destinations

Team: Platform Integrations 3
Research date: 2026-09-11
Status: COMPLETE (first pass)

**Classification vocabulary** (one per capability, per LIVETAP directive):
`NATIVE API` · `RTMP DESTINATION` · `OAUTH + API` · `USER-ASSISTED` · `PARTNER APPROVAL REQUIRED` · `EXPERIMENTAL` · `UNAVAILABLE`

**Honesty rules applied here**
- Every endpoint, scope and limit below is copied from an official doc cited in §6, or is explicitly marked `UNVERIFIED` (19 such markers remain — they are real gaps, not hedging).
- Where a platform's own docs were unreachable (403 on `help.x.com` and `rumble.com/s/help`; JavaScript-only shells on Vimeo, `help.twitch.tv`, `open.bilibili.com`, Dolby OptiView), the fact is attributed to a named secondary source and labelled as such.
- **No endpoint, scope, or numeric limit in this document was inferred or invented.** Two claims that a naive pass would have accepted are explicitly corrected: X's `broadcast.*` OAuth scopes have no endpoints behind them (§1.6), and Twitch Enhanced Broadcasting is Enhanced RTMP multitrack rather than WHIP (§5.2).
- This report merges **two independent research passes**. Where they disagreed the conflict is stated rather than averaged — see Trovo (§3.3), the one material contradiction.

---

## 1. X (Twitter)

### 1.1 Executive summary

**There is no public API for creating, starting, stopping, or reading an X live broadcast in 2026.** X live video is a **manual, human-in-the-loop RTMP destination**. LIVETAP must treat X as a *user-assisted custom RTMP target with a persistent source*, not as an OAuth-driven destination.

Three things are true simultaneously and must not be conflated:

1. **X API v2 exists, is well documented, and supports OAuth 2.0 + PKCE.** It can post Posts, read Posts, read/hide replies. It has **no live-video resource**.
2. **`broadcast.read` and `broadcast.write` OAuth scopes exist** in the X OAuth 2.0 scope list — but **no documented endpoint consumes them**. This is the single most dangerous trap for an implementer: the scope is grantable, the capability is not.
3. **Going live requires the X Live Studio / Media Studio Producer web UI** and an X Premium subscription. The stream key is created and read there by a human.

### 1.2 Product surface in 2026: Live Studio replaced Producer

- **X Live Studio** launched **1 July 2026** as a redesigned live-streaming control room inside X's Creator Studio, announced by X Head of Product Nikita Bier. It is **desktop-only**. (Secondary: Social Media Today, Engadget, Upstream.so — `help.x.com` returned HTTP 403 to this environment, so the official page could not be read directly.)
- The older **Media Studio Producer** (`studio.x.com`, documented at `help.x.com/en/using-x/how-to-use-live-producer`) **remains available during the transition**. Both are gated the same way.
- X launched **$1M in additional creator funding for livestreamers** alongside Live Studio; **allocation criteria were not published**. `UNVERIFIED` whether this creates any additional eligibility tier.
- Live Studio rolled out in **beta to selected regions**: Virginia, Oregon, California, plus Sydney, Seoul, Mumbai, Singapore, Paris, São Paulo, Frankfurt, Dublin, Tokyo. (Secondary.)

### 1.3 Eligibility gates (hard blockers)

| Gate | Requirement | Source class |
|---|---|---|
| Subscription | **X Premium or Premium+** required to go live from a third-party encoder. Free and Basic accounts **cannot** access Media Studio / Live Studio and therefore cannot obtain a stream key. | Secondary (Socialive, Restream, Vimeo blog, Upstream) — consistent across all of them |
| Verification | Account must be **verified** (which Premium confers) | Secondary |
| Account age / hygiene | "Active for at least 3 months, verified email, 2FA enabled" | Secondary (Upstream.so only) — `UNVERIFIED` against official X docs |
| Region | Live Studio is region-limited in beta; RTMP **source** region must be chosen at creation | Secondary |

**Implication for LIVETAP:** the X destination must be able to fail *gracefully and legibly* at connect time with "X Premium required — LIVETAP cannot provision this for you." There is no API to check Premium status for live purposes. `UNVERIFIED` whether `users.read` exposes a usable Premium/verified flag for this gate; do not rely on it.

### 1.4 How a stream key is actually obtained (the real flow)

This is entirely manual:

1. Human signs in at `studio.x.com` (Media Studio) or X Live Studio.
2. **Sources → Create Source**.
3. Name the source, select **RTMP** (alternatively **HLS**), select a **region**.
4. X displays an **RTMP URL** and an **RTMP Stream Key**. Human copies both.
5. Human pastes them into LIVETAP as a custom-RTMP-style destination.
6. **Separately**, the human must **create a Broadcast** in the Studio, attach the source, choose audience, choose immediate or scheduled start, and **publish a Post** to surface the broadcast on X.

**Critical behavioral note:** X is **NOT** a Twitch-style auto-live ingest. Pushing bytes to the X RTMP URL does **not** make anything public. A broadcast object must exist and be started in the Studio UI, and a Post must be published. LIVETAP must say this explicitly in the UI or users will believe they are live when they are not.

Three independent secondary sources agree:
- Castr: *"Simply sending the RTMP feed is not enough — you must manually start the broadcast from Media Studio."*
- Restream: *"There is no automatic live activation."*
- Socialive: broadcast must be created in Media Studio, source selected, audience chosen, and a Post created to publish the livestream.

### 1.5 Ingest protocols and encoder specs

| Item | Value | Source class |
|---|---|---|
| RTMP ingest | **Yes** — URL + stream key from Media Studio source | Secondary (consistent) |
| RTMPS ingest | **Probably yes** — Castr's platform guide states X Media Studio supplies an "**RTMPS URL** (recommended — more secure than RTMP)". Socialive's guide only ever says "RTMP URL". Port not documented by any reachable source. **Sources conflict; treat as supported but verify at integration time.** | Secondary (conflicting) |
| HLS ingest | **Yes** — an alternate source type; you supply a **playlist URL** you host, e.g. `https://your.media.com/live/bigbroadcast.m3u8` (X pulls). Not useful for LIVETAP's push model but worth noting. | Secondary (Twitter Create / media.twitter.com article) |
| SRT | **No** | — |
| WHIP / WebRTC | **No** | — |
| Video codec | H.264 / AVC | Secondary |
| Resolution / fps | 1280×720 @ 30 or 60 fps; 1920×1080 @ 30 fps (1080p60 not offered) | Secondary |
| Video bitrate | ~9 Mbps target (one secondary source says 12 Mbps max — `UNVERIFIED`) | Secondary |
| Audio | AAC-LC, ≤128 kbps | Secondary |
| Aspect ratio | **16:9**. Other ratios are "automatically cropped within the broadcast card when posted." | Secondary |
| Vertical 9:16 | **Not supported** for encoder-based live. X's native *mobile* live is vertical, but that path has no RTMP ingest and no API. | Secondary |
| Available RTMP source regions | US East (N. Virginia), US West (N. California), Asia Pacific (Tokyo, Seoul, Mumbai, Singapore) — list may be incomplete | Secondary |

### 1.6 X API v2 — what actually exists

Official endpoint groups (from `docs.x.com/x-api/overview`): **Posts, Users, Direct Messages, Spaces, Lists, Likes, Trends, Media, Communities, Community Notes, News, Compliance**; streaming via **Filtered Stream / X Activity / Webhooks**; enterprise-only **Volume Streams, Likes Streams, Powerstream, Analytics, Account Activity, Stream Webhooks**.

- **No `broadcast`, `live`, `livestream`, or `mediaStudio` resource is documented.** Confirmed against `docs.x.com/x-api/overview`, `docs.x.com/x-api/introduction`, and `docs.x.com/x-api/getting-started/about-x-api`.
- **Spaces is audio only** — "Find live audio conversations and their participants." It is not a video-broadcast API and must not be marketed as one.
- **Media** endpoints are for uploading images/videos/GIFs (VOD attachments) and managing subtitles/metadata — **not** live ingest.

#### Periscope Producer API: confirmed dead
- The Periscope Producer API (announced 21 March 2017) allowed third parties to authenticate a Periscope account, configure a stream, start/stop a broadcast, and publish it to Twitter. This is the capability LIVETAP would want.
- Twitter announced Periscope's discontinuation on **15 December 2020**; app removal from stores by **March 2021**; endpoints fully cut off **31 March 2021**.
- **It has no successor.** Claims that its capabilities were "migrated to API v2" (seen on Grokipedia) are **contradicted by the current official endpoint list** — treat as false. Developer-community threads requesting live/livestream API access remain **unanswered with any grant of access**; `devcommunity.x.com` returned HTTP 403 to this environment so individual threads could not be read, but their titles ("Request for X Live / Livestream API Access", "Access to video Live Stream API", "Live Stream via API") confirm the demand exists and is unmet.

#### X API v2 pricing (2026) — material change
- X moved to **pay-per-usage** pricing. `docs.x.com/x-api/introduction` states: "The X API uses **pay-per-usage** pricing. No subscriptions—pay only for what you use." Credits are purchased upfront and deducted on consumption; no minimum spend or contract. Same resource requested twice within 24 h is charged once (deduplication).
- Reported rates (**secondary**, multiple independent blogs, `UNVERIFIED` against an official price sheet because `docs.x.com/x-api/pricing` and `.../fundamentals/pricing` both returned 404 to this environment): **$0.015 per post created** ($0.20 if the post contains a link), **$0.005 per post read**, capped at **2M reads/month**; the **Free tier was discontinued** and legacy **Basic ($200/mo)** and **Pro ($5,000/mo)** flat tiers survive **only for existing subscribers** and are **closed to new signups**; **Enterprise from ~$42,000/mo**.
- **LIVETAP impact:** any "read the replies as live chat" feature has a **per-read monetary cost** and no free tier. This is a product-level decision, not just an engineering one. Budget-cap it or ship it off by default.

#### OAuth 2.0 (official, `docs.x.com/.../oauth-2-0/authorization-code`)
- **PKCE is supported and effectively mandatory**: "We only provide authorization code with PKCE and refresh token as the supported grant types."
- `code_challenge_method`: **`S256`** (recommended) or **`plain`**.
- Authorization codes expire in **30 seconds**. Access tokens live **2 hours** unless `offline.access` is requested; `offline.access` yields refresh tokens.
- **24 scopes**, including: `tweet.read`, `tweet.write`, `tweet.moderate.write`, `users.read`, `users.email`, `follows.read/write`, `like.read/write`, `block.read/write`, `mute.read/write`, `list.read/write`, `bookmark.read/write`, `dm.read/write`, `media.write`, `space.read`, **`broadcast.read`**, **`broadcast.write`**, `offline.access`.
- ⚠️ **`broadcast.read` / `broadcast.write` are grantable but map to no documented endpoint.** Requesting them buys nothing and adds scary consent text. **Do not request them.** Revisit only if X publishes a broadcast resource.

#### Proxy "chat": replies to the announcement Post
The only API-reachable conversation around an X live stream is the **reply thread on the Post that surfaces the broadcast**:
- **Read:** `GET /2/tweets/search/recent` filtered by `conversation_id` (scope `tweet.read`). Rate limit **450 req / 15 min**, up to **100 posts per request** (official rate-limits page). Costs money per read under pay-per-usage.
- **Write:** `POST /2/tweets` with a reply reference (scope `tweet.write`).
- **Moderate:** `PUT /2/tweets/{tweet_id}/hidden` (scope `tweet.moderate.write`, "Hide and unhide replies to your posts").
- The **native Live Studio chat** (with its Verified/Followers/Subscribers gating) is **not exposed by any API**. Post replies are a *different surface* — do not present them to users as "X live chat."

### 1.7 X capability classification

| Capability | Classification | Notes |
|---|---|---|
| OAuth | `OAUTH + API` | X API v2 OAuth 2.0; irrelevant to going live |
| PKCE | `OAUTH + API` | Supported and required; `S256` or `plain` |
| Broadcast Creation | `USER-ASSISTED` | Must be created in Live Studio / Media Studio UI |
| Stream Creation | `USER-ASSISTED` | "Create Source" in the Studio UI |
| Stream Key retrieval | `USER-ASSISTED` | Human copies URL + key from the Studio |
| Start | `USER-ASSISTED` | Human starts broadcast in Studio; ingest alone does not go live |
| Stop | `USER-ASSISTED` | Human ends broadcast in Studio |
| Metadata | `USER-ASSISTED` | Title/description/audience set in Studio |
| Thumbnail | `USER-ASSISTED` | Custom thumbnail upload in Live Studio (secondary) |
| Chat Read | `UNAVAILABLE` | Native live chat has no API |
| Chat Write | `UNAVAILABLE` | Native live chat has no API |
| Moderation | `UNAVAILABLE` | Native live chat moderation has no API |
| — Post replies (read) | `OAUTH + API` | Proxy only; `tweet.read`, metered |
| — Post replies (write) | `OAUTH + API` | Proxy only; `tweet.write` |
| — Post replies (hide) | `OAUTH + API` | `tweet.moderate.write` |
| Analytics | `USER-ASSISTED` | Live Studio shows concurrents/watch time/geo/device; no live-video analytics endpoint. Enterprise Analytics endpoints are a separate, unrelated product = `PARTNER APPROVAL REQUIRED` |
| Live Status | `UNAVAILABLE` | No API reports whether a broadcast is live |
| Scheduling | `USER-ASSISTED` | Schedulable in Studio (secondary: up to 1 year ahead) |
| Application Review needed | `UNAVAILABLE` | **No partner program to apply to.** Nothing to review; nothing to be granted |
| Eligibility gates | `USER-ASSISTED` | X Premium/Premium+ + verified; user must resolve |
| Regional Restrictions | `USER-ASSISTED` | Live Studio beta regions; ingest region chosen per source |
| Account Restrictions | `USER-ASSISTED` | Free/Basic accounts cannot obtain a stream key |
| Vertical 9:16 support | `UNAVAILABLE` | 16:9 documented; other ratios cropped. Native mobile vertical has no ingest path |
| RTMPS | `RTMP DESTINATION` (`UNVERIFIED`) | Castr documents an RTMPS URL from Media Studio; Socialive says RTMP only. Sources conflict — support both schemes and let the pasted URL decide |
| SRT | `UNAVAILABLE` | — |
| WHIP / WebRTC ingest | `UNAVAILABLE` | — |
| — HLS pull ingest | `USER-ASSISTED` | Alternate source type; X pulls your `.m3u8`. Not LIVETAP's push model |

### 1.8 LIVETAP adapter guidance for X

- Implement X as a **`UserAssistedRtmpDestination`** subtype, not as an OAuth destination.
- `authenticate()` → no-op / "paste credentials" wizard. Do **not** ship an X OAuth flow for the live destination; it would imply capability that does not exist.
- `createBroadcast()`, `startBroadcast()`, `stopBroadcast()`, `getStatus()` → **must return `UNSUPPORTED`** and the UI must surface a checklist ("1. Create the broadcast in X Live Studio. 2. Start it there. 3. LIVETAP will push video to your source.").
- Persisted source keys mean the key is **long-lived and reusable** across broadcasts — store it encrypted at rest like any other stream key. `UNVERIFIED` whether X rotates or expires source keys; assume it may and surface auth failures clearly.
- Optional, off by default: a metered "X replies" panel using `conversation_id` search, with an explicit spend warning.

---

## 2. LinkedIn

### 2.1 Executive summary

LinkedIn is the **opposite shape** to X: there **is** a real, complete, documented live API — **`NATIVE API` quality** — but it sits behind a **closed partner program with a certification demo**, and the **terms of use are hostile to an open-source, self-hostable product**. LinkedIn is therefore `PARTNER APPROVAL REQUIRED` across essentially every capability.

Two independent gates stack:
1. **The developer** must be admitted to the **Live Events API Program** (Development Tier → certification → Standard Tier).
2. **The end user** (member or Page) must independently be **approved for LinkedIn Live** (150+ followers, 30+ days old, policy standing, not mainland China).

### 2.2 MAJOR 2026 CHANGE: spontaneous live is gone

**As of 22 June 2026, every LinkedIn Live broadcast must be a scheduled event.** The "go live now" path is removed.

- Official: LinkedIn's *Spontaneous Live Events Migration* doc states "We are consolidating our Live Events API around a single flow: Scheduled Live Events… Going forward, only the scheduled live flow will be supported."
- The documented workaround for "go live now" UX: **set `scheduledAt` to 1 minute in the future** (`currentTimeMs + 60000`).
- Go-live window: **from 15 minutes before the scheduled time to 2 hours after** it.
- Limit: **10 scheduled live events per day** per member (counting their profile and all Pages they manage).
- Widely corroborated by trade press (Social Media Today, PPC Land, netinfluencer).

**LIVETAP impact:** the LinkedIn adapter **cannot** implement a simple `startBroadcast()`. It must own a 7-step state machine. Any "one-click go live" UX must silently create a scheduled event 60 s out and then wait.

### 2.3 The current (scheduled) flow — official endpoints

Base: `https://api.linkedin.com/v2/`. All requests require `X-Restli-Protocol-Version: 2.0.0`.

| # | Step | Endpoint |
|---|---|---|
| 0 | Confirm the user is approved for Live | `GET /v2/contentAccess/(entity:(member:{urlencoded personUrn}),featureType:LIVE_VIDEO)` — **200 = approved, 404 = not approved**. Pages form adds `admin:(member:...)` and uses `entity:(company:...)` |
| 1 | (Optional) upload announcement image | `POST /v2/assets?action=registerUpload` with recipe `urn:li:digitalmediaRecipe:video-liveannouncement-image` |
| 2 | Create the scheduled live video | `POST /v2/liveVideos` — body `{author:{member\|organization}, scheduledAt, name}` → returns `id`, `state: "PRE_LIVE"` |
| 3 | Create announcement post | `POST /v2/ugcPosts` with `shareMediaCategory: "URN_REFERENCE"`, media `urn:li:liveVideo:{id}`, and a **required** `distribution` object (`feedDistribution: "MAIN_FEED"`, `distributedViaFollowFeed: true`) |
| 4 | Register the live asset (get ingest URLs) | `POST /v2/liveAssetActions?action=register` — body `{registerLiveEventRequest:{owner, recipes:["urn:li:digitalmediaRecipe:feedshare-live-video"], region, autoCaptionLanguageTag?}}` |
| 5 | Begin RTMP(S) ingest | push to a returned `ingestUrls[].url` |
| 6 | Poll asset until ready, then link | `GET /v2/assets/{id}` until recipe status `AVAILABLE`, then `POST /v2/liveVideos/{id}` with `{patch:{$set:{liveVideoAsset:{media:"urn:li:digitalmediaAsset:..."}}}}` → **204** and the announcement post starts showing the live stream |
| 7 | End | `POST /v2/liveAssetActions?action=end` — body `{asset:"urn:li:digitalmediaAsset:..."}`. Wait ~10 s after the stream actually ends before calling |

**Timeouts that will bite you:**
- A registered live event is **discarded if ingestion has not started within 1 hour**.
- Once ingestion has started, **no data for 120 seconds = timeout**.
- If the asset recipe status has not updated **within 15 seconds**, LinkedIn's own doc says to treat it as a failed ingest: send `action=end` and **register a new live event** (do not retry the same asset).

Recipe statuses: `NEW` → `PROCESSING` → `AVAILABLE`; `INCOMPLETE` means deleted/deleting.

**Deprecated path (do not build):** the spontaneous flow used `shareMediaCategory: "LIVE_VIDEO"` with a `urn:li:digitalmediaAsset:` media URN and no `distribution` field. Documented only for migrating partners.

### 2.4 Ingest specs (official `Live Ingest Requirements`)

| Field | Value |
|---|---|
| Duration | **max 4 hours** |
| Aspect ratio | **16:9** |
| Resolution | **max 1080p** |
| Frame rate | **max 30 fps** |
| Keyframe interval | **every 2 seconds (60 frames)** |
| Bitrate | **max 6 Mbps video**; **max 128 kbps audio @ 48 kHz** |
| Encoding | **H.264 video, AAC audio** |
| Protocol | **RTMP / RTMPS (RTMPS preferred)** |
| Firewall | RTMP needs outbound **TCP 1935 and 1936**; RTMPS needs outbound **TCP 2935 and 2936** |

- `register` returns an **array of `ingestUrls`** with both RTMP and RTMPS variants and **secondary/backup URLs**. LinkedIn's guidance: use RTMPS; a backup stream requires a **separate time-synced hardware encoder** pushing to the secondary URL.
- Historical sample responses show Azure Media Services hosts (`rtmps://{id}.channel.media.azure.net:2935/live/{key}`); the migration doc shows `rtmps://live-ingest.linkedin.com:443/live/{key}`. **Treat the ingest host, port and path as opaque and fully dynamic** — never hardcode, never validate against a pattern. Ports observed across docs include 1935, 1936, 2935, 2936, 443.
- `previewUrls` (an `.m3u8` or Azure `manifest`) are returned for confidence monitoring.
- **Regions** for `register`: `WEST_US`, `EAST_US_NORTH`, `EAST_US_SOUTH`, `CENTRAL_US`, `SOUTH_CENTRAL_US`, `SOUTH_AMERICA`, `NORTH_EUROPE`, `WEST_EUROPE`. **Note there is no Asia-Pacific region** — a real latency problem for APAC users.
- **Auto-captions** are available at registration time via `autoCaptionLanguageTag` (BCP-47, e.g. `en-US`); omit the field to disable.
- **Vertical 9:16 is not supported for Live.** LinkedIn's *feed video* specs do support 9:16 in 2026, but the **Live Ingest Requirements explicitly say 16:9**. Do not conflate the two.
- **SRT: not supported. WHIP/WebRTC: not supported.**

### 2.5 Eligibility — the end user's gate

Official LinkedIn Help (*Create and host LinkedIn Live: Access criteria*):
- **More than 150 followers and/or connections** to be *eligible for evaluation*.
- Account or Page must be **at least 30 days old**.
- **Good standing** under the Professional Community Policies.
- **Not available to members and Pages based in mainland China.**
- Access is granted automatically when criteria are met; the user sees "LinkedIn Live" in the Event format dropdown. Connecting through a preferred partner tool triggers an instant eligibility determination.
- `GET /v2/contentAccess/...` is the programmatic check (200/404). **LIVETAP should call this before offering LinkedIn as a destination** — it is the single best pre-flight check available on any platform in this report.

Preferred/third-party broadcast partners named by LinkedIn: **Restream, Socialive, StreamYard, Switcher Studio, Vimeo** (the help page lists Socialive, StreamYard, Switcher Studio, Restream; LinkedIn's partner chart and the Live Events program page also name Vimeo).

### 2.6 Program access — the developer's gate

- **Live Events API Program**, two tiers:
  - **Development Tier** — full API surface, but **~100 API requests per day per Live Events API**. Intended as short-term evaluation access; LinkedIn expects transition **within 6 months**.
  - **Standard Tier** — requires a **demonstration video showing every Live Events certification test case**, reviewed by LinkedIn. Only then is production access granted.
- Application: access form in the Developer Portal (`developer.linkedin.com`) — organization name, email, address, website, and a detailed description of intended API use.
- Additional vetting: **background verification via Microsoft's OneVet**, plus a safety review of intended usage.
- Eligible developer categories: conferencing, live streaming, live events, webinars, video production, podcasting, CRM, marketing.
- **Refresh tokens are not default** — LinkedIn's Live Events release notes state refresh-token capability is offered "to all Live Events Partners" and you must "reach out to your LinkedIn contact to enable this feature on your developer application." Without it, broadcasters re-authorize roughly every 60 days.
- Live video is still described in LinkedIn's own docs as a **beta feature**.

### 2.7 OAuth — and the PKCE trap

- **Standard flow is 3-legged OAuth 2.0 authorization code**, `GET https://www.linkedin.com/oauth/v2/authorization` → `POST https://www.linkedin.com/oauth/v2/accessToken` with `client_id` **and `client_secret`**. Authorization code lifespan **30 minutes**. TLS 1.0 is not supported.
- **PKCE exists but is not generally available.** It is a *separate* endpoint for native clients: `GET https://www.linkedin.com/oauth/native-pkce/authorization` with `code_challenge` and `code_challenge_method=S256` (both **required**), and `redirect_uri` restricted to **loopback only** (`http://127.0.0.1:{port}` or `http://[::1]:{port}`). The doc states plainly: *"Once you have the app created, please reach out to your point of contact at LinkedIn, and we will enable PKCE OAuth 2 flow for your app."* Native apps **must** use the OS default browser, not a webview.
- **Consequence for LIVETAP's desktop app:** a public desktop client cannot use PKCE with LinkedIn until LinkedIn enables it per-application. Until then LinkedIn auth **must be brokered by a LIVETAP-operated backend holding the client secret** — which is exactly the architecture the Live Events API terms restrict (see 2.9).

#### Scopes
Live Events (member): `r_member_live` (read status + playable streams), `w_member_live` (upload/manage the live event), `r_liteprofile` (get the person ID).
Live Events (organization): `r_organization_live`, `w_organization_live`, `r_organization_admin` (get the organization URN via Organization Access Control).
**Member and organization live scopes cannot be combined in a single authorization request** — LinkedIn's doc states this explicitly. LIVETAP must ask the user up front "profile or Page?" and run **two separate connections** if they want both.

Comments/reactions (separate **Community Management** product, separately approved): `r_organization_social_feed`, `w_organization_social_feed`, `w_member_social_feed`, and `r_member_social_feed` which is marked **Restricted — "granted to select developers only."**
Events (separate **Event Management** product, separately approved): `r_events`, `rw_events`.

### 2.8 Chat, moderation, analytics

- **Comments** on a live event are ordinary post comments: `socialActions/comments` — get/batch-get/get-on-share/get-on-comment/create/edit/delete, at `GET|POST https://api.linkedin.com/rest/socialActions/{shareUrn|ugcPostUrn|commentUrn}/comments`. Comment URNs are composite: `urn:li:comment:(urn:li:activity:{id},{commentId})`.
- **Reactions**: `GET|POST https://api.linkedin.com/rest/reactions/...` (replaces likes).
- **Social Metadata** API adds *Enable or Disable Comments on a Thread* — the usable "close the chat" moderation lever.
- LinkedIn's own Event Management use-case page states the moderation story directly: use the **Comments API** to "post comments as the Company Page, delete attendee comments, get / read comments."
- **Analytics**: `videoAnalytics` gives **watch time, video views, video viewers** (scope `r_organization_social`); **likes and comment counts are NOT in videoAnalytics** — pull those from Social Actions/Social Metadata. From version **202601**, `/adAnalytics` added `eventViews`, `eventWatchTime`, `averageEventWatchTime`, `costPerEventView` (plus 15 s / 30 s / 2 min thresholded variants) — but that is **paid/ads** analytics.
- **Live Status**: `liveVideos.state` (e.g. `PRE_LIVE`), asset recipe status, and `contentAccess` together give a usable status model. This is genuinely good — better than any other platform in this report.
- All Marketing/Community endpoints are **versioned**: send `Linkedin-Version: YYYYMM`. **Marketing version 202508 sunsets 17 August 2026** — version pinning must be a first-class, updatable config value in LIVETAP, not a constant.

### 2.9 ⚠️ Open-source / licensing risk (read this before committing to LinkedIn)

From the **LinkedIn Live Events API Terms of Use**:
- *"you have no right to use any API or Data made available as part of this program unless approved by LinkedIn."*
- **You may not make LLE integrations available to other developers for resale to unaffiliated customers**; a **direct client relationship** is required.
- **You may not combine other LinkedIn APIs with the LLE APIs** (except Self-Serve APIs).
- Member Data restrictions: no export to third parties, no cross-account databases, no use for advertising/sales/recruiting/lead-gen, no commercialization or sale, no deriving sensitive attributes.
- You may not call yourself a LinkedIn "strategic, certified, or preferred partner" without express written consent.
- **Open-source distribution and self-hosting are not addressed at all** — meaning they are not permitted by default.

**Assessment for LIVETAP:** an open-source product where any user builds and runs their own binary with their own LinkedIn app **does not fit this program**. The realistic options are:
1. **LIVETAP-operated hosted service** holds the approved LinkedIn app + secret and brokers auth (fits the terms; conflicts with pure self-hosting).
2. **Self-hosters bring their own approved LinkedIn app** — technically possible, but almost no individual will pass OneVet + certification. Ship it as an advanced, unsupported config.
3. **Ship LinkedIn as UNAVAILABLE at launch** and offer it as a hosted-tier feature later.

This is a **business blocker, not an engineering one**, and should be escalated to BLOCKERS.md.

### 2.10 LinkedIn capability classification

| Capability | Classification | Notes |
|---|---|---|
| OAuth | `OAUTH + API` | 3-legged authorization code; confidential client (secret required) |
| PKCE | `PARTNER APPROVAL REQUIRED` | Separate `native-pkce` endpoint, loopback-only, **enabled per-app by LinkedIn on request** |
| Broadcast Creation | `PARTNER APPROVAL REQUIRED` | `POST /v2/liveVideos` — `NATIVE API` quality once admitted |
| Stream Creation | `PARTNER APPROVAL REQUIRED` | `POST /v2/liveAssetActions?action=register` |
| Stream Key retrieval | `PARTNER APPROVAL REQUIRED` | Key is embedded in the returned `ingestUrls`; fully dynamic |
| Start | `PARTNER APPROVAL REQUIRED` | Ingest + `POST /v2/liveVideos/{id}` patch linking the asset |
| Stop | `PARTNER APPROVAL REQUIRED` | `POST /v2/liveAssetActions?action=end` |
| Metadata | `PARTNER APPROVAL REQUIRED` | `liveVideos.name`; `ugcPosts.shareCommentary` |
| Thumbnail | `PARTNER APPROVAL REQUIRED` | Announcement image via `assets?action=registerUpload`, recipe `video-liveannouncement-image` |
| Chat Read | `PARTNER APPROVAL REQUIRED` | Comments API; needs Community Management product |
| Chat Write | `PARTNER APPROVAL REQUIRED` | Comments API create (as member or Page) |
| Moderation | `PARTNER APPROVAL REQUIRED` | Delete comments; enable/disable comments on thread (Social Metadata) |
| Analytics | `PARTNER APPROVAL REQUIRED` | `videoAnalytics` (views/viewers/watch time); counts via Social Actions |
| Live Status | `PARTNER APPROVAL REQUIRED` | `liveVideos.state`, asset recipe status, `contentAccess` |
| Scheduling | `PARTNER APPROVAL REQUIRED` | **Mandatory since 22 Jun 2026**; max 10/day; go-live window −15 min to +2 h |
| Application Review needed | `PARTNER APPROVAL REQUIRED` | Dev Tier → certification video → Standard Tier; OneVet background check |
| Eligibility gates | `USER-ASSISTED` | >150 followers/connections, 30+ days old, policy standing; checkable via `contentAccess` |
| Regional Restrictions | `UNAVAILABLE` (mainland China) | Ingest regions: US ×5, South America, North/West Europe — **no APAC region** |
| Account Restrictions | `USER-ASSISTED` | Member and organization live scopes **cannot be combined** in one auth request |
| Vertical 9:16 support | `UNAVAILABLE` | Live Ingest Requirements specify **16:9** |
| RTMPS | `RTMP DESTINATION` | Supported and **preferred**; TCP 2935/2936 (and 443 in newer samples) |
| SRT | `UNAVAILABLE` | — |
| WHIP / WebRTC ingest | `UNAVAILABLE` | — |

### 2.11 LIVETAP adapter guidance for LinkedIn

- Model the LinkedIn adapter as an explicit **state machine**, not a pair of start/stop calls: `contentAccess check → (image upload) → liveVideos create → ugcPost → register asset → ingest → poll asset → patch liveVideo → LIVE → end`.
- **Hard-code none of it:** ingest host/port/path, region list, and API version must all be configuration.
- Implement the documented failure path: **asset not `AVAILABLE` within 15 s ⇒ `action=end` + register a brand-new event.** Never retry the same asset.
- Guard the **1-hour registration TTL** and the **120-second no-data timeout** with client-side timers so LIVETAP can explain the failure rather than surfacing a dead stream.
- Enforce the **6 Mbps / 1080p / 30 fps / 2 s keyframe** ceiling in the encoder profile; LinkedIn is the most constrained major destination and will be the binding constraint on any shared master encode.
- Ask "profile or Page?" **before** the OAuth redirect (scopes cannot be mixed).
- Ship the **secondary ingest URL** as an optional advanced feature only — LinkedIn says it needs a separate time-synced encoder, which LIVETAP is unlikely to provide honestly at v1.

---

## 3. Secondary destinations survey

**Methodology note.** This section merges two independent research passes run for this report. Where they agreed, the fact is stated plainly. **Where they disagreed, the conflict is called out explicitly** (see Trovo — the one material contradiction). Some platform docs are client-rendered JavaScript that returned no readable body to a plain fetch; anything that could not be confirmed is marked `UNVERIFIED` rather than filled in from memory. Residual gaps are listed in §7.

Summary table (detail follows):

| Platform | Status 2026 | RTMP/RTMPS | API for stream key | OAuth | Chat API | Eligibility | Verdict for LIVETAP |
|---|---|---|---|---|---|---|---|
| **Amazon IVS** (low-latency) | Alive — infrastructure, no audience | **Yes** (RTMPS 443, RTMP opt-in, **SRT 9000**, **WHIP**) | **Yes** — `CreateChannel` returns `ingestEndpoint` + `streamKey` (1 key per channel) | No — **AWS IAM SigV4** | **Yes** — full 2-plane IVS Chat, `wss://edge.ivschat.<region>.amazonaws.com` | AWS account, pay-per-use | **Best-documented ingest in this report.** Use as the reference target and conformance-test rig |
| **Dailymotion** | Alive — API v2, docs refreshed mid-2026 | **Yes** (RTMP + **SRT**) | **Yes** — `ingest.rtmp_url`, `ingest.srt_url` | **Yes** — OAuth 2.0 **client_credentials**, `POST https://oauth2.dailymotion.com/v2/token`, 30-min JWT; scopes `live.manage` / `live.read` | None | **Paid plan feature** — Account Manager / support must enable live | **Strongest secondary candidate.** Real API, real SRT. `OAUTH + API` behind a commercial gate |
| **Vimeo Live** | Alive | **Yes** — RTMPS / RTMP / **SRT** | **`UNVERIFIED`** for *inbound* ingest — see the trap in §3.4 | Yes — OAuth 2.0 | **Toggle only** (`chat_enabled`); no message-level API | UI live needs Advanced/Premium/Enterprise + Events; **Live API needs Enterprise + allowlisting** | `PARTNER APPROVAL REQUIRED`. Ship as custom RTMP |
| **Rumble** | Alive — Rumble Studio public | **Yes** — RTMP; ingest URL from the Live Dashboard only | No | **No OAuth** — a per-user *secret URL* instead | **Read-only**, polled JSON (last 50 chat messages + Rants) | Open | `USER-ASSISTED` RTMP. No adapter |
| **Bilibili** | Alive — but see below | Platform yes / **ingest API no** | No | HMAC `access_key`/`secret` after onboarding review | Danmaku over WSS via `/v2/app/start` | Onboarding review; Chinese-language only | **Out of scope for v1** |
| **Amazon Live** (creator program) | Alive — Influencer Program only | — | No public API | No | No | Invite / program-gated | `UNAVAILABLE`. Do not build |
| **Trovo** | ⚠️ **Reported DEAD** — live streaming decommissioned **2026-06-30** (Tencent). Conflicts with the developer docs still being served — see §3.3 | — | (docs still describe one) | (docs still describe one) | (docs still describe one) | — | **Do not build** pending confirmation |
| **DLive** | **DEAD** — closed **2026-04-27**; `dlive.tv` serves "DLive Service Discontinued" | — | — | — | — | — | **Do not build.** Remove from roadmap |

### 3.1 Amazon IVS (Interactive Video Service) — VERIFIED, official AWS docs

**IVS is not a social destination.** It is a paid AWS ingest/transcode/CDN service. It belongs in this report for a different reason: **it is the reference implementation LIVETAP should validate against**, and it is a plausible destination for LIVETAP's own relay/"watch page" feature.

- **Codecs: H.264 video and AAC (LC) audio only.** Official text: *"Amazon IVS supports H.264 for video and AAC (LC) for audio."* **No HEVC, no AV1.** Audio-only input is not supported for low-latency streaming.
- **Ingest protocols — three, all first-class.** Official text: *"Amazon IVS supports the most common ingest protocols used in streaming software and hardware: RTMPS …, RTMP, and SRT (Secure Reliable Transport)."* RTMPS requires **TLS 1.2 or later**.
  - RTMPS: `rtmps://<IVS-ingest-server>:443/app/<IVS-stream-key>` — e.g. `rtmps://a1b2c3d4e5f6.global-contribute.live-video.net:443/app/<key>`
  - RTMP (opt-in insecure): same host, **drop the `:443`** — `rtmp://a1b2c3d4e5f6.global-contribute.live-video.net/app/<key>`
  - SRT: **port 9000** — `srt://<endpoint>:9000?streamid=<stream-key>&passphrase=<passphrase>`; passphrase only needed if insecure ingest is not enabled on the channel
- **Stream key is API-provisioned** (IAM-authenticated AWS API, **not** OAuth): creating a channel assigns a channel ARN, a stream key, and ingest + playback URLs. Keys look like `sk_us-west-2_abcd1234efgh5678ijkl`.
- **Channel types cap resolution and bitrate — and exceeding them disconnects you.** Official warning: *"If you exceed the allowable input resolution or bitrate, the stream probably will disconnect immediately."*
  - `STANDARD` (default, transcoded to 1080p), `ADVANCED_HD` (to 720p), `ADVANCED_SD` (to 480p), `BASIC` (transmuxed, single rendition, **3.5 Mbps** above 480p / **1.5 Mbps** at 480p)
  - Max input across transcoded types: **1080p60 @ 8.5 Mbps**
- **Encoder guidance:** keyframe **2 s** (or 1 s for lower latency; **never above 5 s**), H.264 **Main** level, YUV420P, CABAC preferred, BT.709, **CBR not VBR** (*"We strongly recommend you only use CBR"*), progressive only, audio AAC-LC 96–320 kbps at 44.1/48 kHz, max 2 channels. VBV buffer must not exceed average bitrate.
- **Multitrack video input** exists via the channel's `multitrackInputConfiguration` property — with multitrack input a `STANDARD` channel is **transmuxed** rather than transcoded, with resolution capped by `multitrackInputConfiguration.maximumResolution`.
- **Stream takeover** — a genuinely useful pattern LIVETAP should study for reconnect correctness. Append `?priority=N` (1 … 2,147,483,647) to the stream key: `rtmps://<uri>/<streamkey>?priority=N`, or for SRT `srt://<uri>?streamid=#!::u=<streamkey>,priority=N&passphrase=foobar`. A takeover wins if its priority exceeds the ongoing stream's, and **the old and new stream must share resolution, video codec, audio codec and track count.** Up to 100 takeovers per stream by default. The IVS mobile SDKs use this for auto-reconnect, incrementing priority up to 5 times.
  - Note this SRT example is an **official confirmation of the `#!::` SRT Access Control convention** referenced in §4.1(B), here using `u=` for the key.
- **Closed captions** accepted as CEA-708/EIA-608 (608-over-708), either embedded in the video elementary stream per ATSC A/72 SEI user_data, or via the **RTMPS `onCaptionInfo` script/AMF0 tag** carrying an ECMA array with `type: "708"` and base64 `data`.
- AWS explicitly warns against restreaming *into* IVS: *"We strongly recommend you do not use third-party service to restream or forward content to Amazon IVS. This will incur extra latency."* Worth surfacing if LIVETAP offers IVS as a destination.
- **Stream key provisioning is a first-class API call:** `CreateChannel` returns both the `ingestEndpoint` and the `streamKey`. Note **one stream key per channel** — so LIVETAP cannot mint per-broadcast keys on IVS; a channel is the durable unit.
- **IVS Chat is a genuine, separate two-plane chat service** (control-plane AWS API for rooms/tokens/moderation, data-plane WebSocket at **`wss://edge.ivschat.<region>.amazonaws.com`**). It is one of the only fully API-driven read+write+moderate chat surfaces available across every platform in this report — but note it is *IVS's own* chat, so it only exists for viewers watching through your application, not a social audience.
- **IVS Real-Time Streaming** is a separate product (sub-300 ms latency, up to 12 hosts, 25,000+ viewers, "stages", mobile broadcast SDKs) and **it does support WHIP**:
  - Endpoint **`https://global.whip.live-video.net`**, which **issues a 307 redirect** — LIVETAP's WHIP client **must follow the redirect while preserving the `Authorization` header**, which is a well-known source of bugs in naive HTTP clients.
  - Auth is the **IVS participant token as the Bearer token**.
  - **An H.264 track is required**; capped around **720p / 8.5 Mbps**. No HEVC, no AV1.

**Amazon Live (the creator/influencer program)** is a different thing entirely from IVS and shares nothing but a brand. No public API or developer documentation was located; it is program/invite-gated. **Classify `UNAVAILABLE` and do not build an adapter.** (NOT VERIFIABLE FROM THIS ENVIRONMENT.)

### 3.2 Dailymotion — VERIFIED, official developer docs

Dailymotion has a **genuinely modern live API** — better than X's (nonexistent) and more accessible than LinkedIn's (partner-gated). It is the strongest secondary candidate in this report.

- **Base:** `https://api.dailymotion.com/v2`. **Auth:** OAuth 2.0 **client_credentials** against `POST https://oauth2.dailymotion.com/v2/token`, yielding a **30-minute JWT** Bearer token. **Scopes:** `live.manage` (create/update), `live.read` (retrieve).
  - The 30-minute token lifetime is short enough that LIVETAP must refresh *during* a long broadcast — build that into the adapter rather than minting once at start.
  - `client_credentials` (2-legged) rather than a user redirect is a notable simplification versus LinkedIn and X.
- **Create:** `POST /profiles/{profile_id}/livestreams`. Required body fields: `title` (1–255 chars, non-blank), `visibility` (`public` | `private` | `password`), `category` (fixed enum: animals, auto, creation, fun, kids, lifestyle, music, news, people, school, sport, tech, travel, tv, videogames, webcam), `is_for_kids` (boolean). Optional: `description` (HTML, ≤3000 chars), `language` (ISO 639-1), `country` (ISO 3166-1 alpha-2), `password` (1–32 chars, required when `visibility=password`), `start_at` / `end_at` (ISO 8601), `recording.auto_record`, `geo_restriction` (mode + country list), `embedding.enable_embed`.
- **Ingest is returned by the API** — `201` response carries an `ingest` object:
  - `ingest.rtmp_url` — *"RTMP ingest URL to configure in your streaming software (e.g. OBS)."* Documented shape: **`rtmp://publish.dailymotion.com/publish-dm`** with a key of the form **`x1y2z3?auth=...`**
  - `ingest.srt_url` — **SRT alternative** (nullable), of the form **`srt://publish.dailymotion.com:<port>?streamid=x1y2z3`**
  - ⚠️ **Note the `?auth=...` inside the stream key.** This is the concrete, real-world proof of the §4.2 rule that **stream keys may contain query strings and must never be parsed, re-encoded, or regex-validated.** A validator that rejects `?` in a key breaks Dailymotion outright.
  - `ingest.available_servers` — a map of server label → RTMP URL (**multi-region ingest selection**)
  - ⚠️ **There is no separate `stream_key` field** — the credential is embedded in `rtmp_url`. LIVETAP must therefore accept a *single combined URL* for Dailymotion, or split it itself. This is exactly the "key may contain `/`, never split silently" hazard from §4.2.
- Other endpoints: `GET /livestreams/{id}` (*"including ingest URLs, status, and advertising quota"*), `PATCH /profiles/{profile_id}/livestreams/{livestream_id}`, list, delete, plus **`livestream-advertising`** to *"trigger a mid-roll ad break during the live event"* (unusual and commercially interesting).
- Status fields observed: `status` (`onair`, `airing_at`, `audio_bitrate`), `livestream_url`, recording details, thumbnails, geo-restriction info.
- **Eligibility:** *"This is a plan feature"* — live streaming **must be enabled on the account by an account manager or the support team** before the API works. So: `OAUTH + API` once enabled, gated by a commercial step.
- **Chat API:** none found in the documentation index. Treat as `UNAVAILABLE`.
- **Encoder specs:** not stated on the pages retrieved — `UNVERIFIED`.

### 3.3 Trovo — ⚠️ CONFLICTING EVIDENCE; treat as DEAD

**This is the one material contradiction between the two research passes, and it must not be silently averaged away.**

- **Pass A (docs fetched directly):** `developer.trovo.live` **is serving a complete, coherent Open Platform documentation set**, including a changelog noting recent refresh-token updates. Everything below was read from those live pages.
- **Pass B:** reports Trovo **live streaming was decommissioned on 2026-06-30** by Tencent.

**These are reconcilable:** developer documentation routinely outlives the service it documents. A live docs site is **not** evidence of a live platform.

**Verdict: treat Trovo as DEAD and do not build an adapter.** Confirm via an official Tencent/Trovo announcement before spending any engineering time. The DLive lesson (§3.5) applies directly. The API detail below is retained only so that, if Trovo is in fact alive, the work is already scoped — **not** as a green light.

<details>
<summary>Trovo API detail as documented (retained for reference only)</summary>

It is worth noting *why* this is a shame: Trovo is one of very few platforms in this entire report that will hand a **stream key to an API client**.

- **OAuth 2.0**, two flows: **implicit** (token in redirect URI) and **authorization code** (exchange server-side). Token endpoints: `POST /openplatform/exchangetoken`, `POST /openplatform/refreshtoken`, `GET /openplatform/validate`, `POST /openplatform/revoke`.
- **Scopes (7):** `user_details_self`, `channel_details_self`, `channel_update_self`, `channel_subscriptions`, `chat_send_self`, `send_to_my_channel`, `manage_messages` — plus **`chat_connect`** used by the chat-token endpoint.
- **Stream key via API:** `/openplatform/channel` returns `"stream_key": "live/xxxxxxxxxxxxxxxxxxx"`, documented as *"sensitive information"* requiring protection. **The RTMP ingest host is not documented on the pages retrieved** — `UNVERIFIED`, which means LIVETAP cannot fully automate Trovo without the user supplying the server URL.
- **Chat is excellent and fully documented:**
  - WebSocket: **`wss://open-chat.trovo.live/chat`**
  - Three token paths: `/openplatform/chat/token` (own channel, scope `chat_connect`), `/openplatform/chat/channel-token/{channelID}` (any channel, Client-ID only — **no user auth needed to read a channel's chat**), `/openplatform/chat/shard-token` (multiple channels sharded across sockets)
  - **20+ message types**: type `0` normal chat; `5`–`9` special effects (spells, magic chat, bullet screens); `5001`–`5013` system events including subscriptions, follows, raids, and **stream on/off** (a usable live-status signal)
  - Write/moderate: `POST /openplatform/chat/send`, `DELETE /openplatform/channels/{channelID}/messages/{messageID}/users/{uID}`, `POST /openplatform/channels/command`
- Other endpoints: categories/games, channel info + edit, viewers/followers, user lookup, subscribers, clips/past streams/live URLs, Drops entitlements.
- **Eligibility as documented:** Client-ID app registration. No partner-approval gate documented.

</details>

### 3.4 Vimeo Live — PARTNER APPROVAL REQUIRED, and one dangerous documentation trap

- **Ingest:** **RTMPS, RTMP and SRT** are supported.
- **The ingest URL and key are not published in the API docs** — in normal use a human reads them from the **Stream panel of the live event** in Vimeo's UI.
- ⚠️ **The trap — read this before writing any Vimeo code.** Vimeo's API docs *do* contain fields named **`stream_key`** and **`stream_url`**. **These are simulcast-destination *outputs*** — i.e. where Vimeo should *push* your stream onward to a third party — **not** the inbound ingest endpoint you publish *to*. Wiring LIVETAP to them would produce a confidently wrong integration. This is the kind of error the "never invent endpoints" rule exists to prevent, and it is easy to make because the field names look exactly right.
- **Eligibility is two-layered:**
  - **UI live streaming** requires an **Advanced, Premium, or Enterprise** plan with Events.
  - **The Live API requires Enterprise *plus* explicit allowlisting** — you contact Vimeo support with your client ID to have live API access enabled.
- **OAuth:** OAuth 2.0.
- **Chat:** a **boolean toggle only** (`chat_enabled`). **There is no message-level chat API** — no read, no write, no moderation.
- **HEVC / AV1 / WHIP:** not supported. SRT is.
- **What is independently verified from LinkedIn's side:** Vimeo is named by LinkedIn as one of five **LinkedIn Live preferred broadcast partners** (with Restream, Socialive, StreamYard, Switcher Studio). That confirms Vimeo runs a serious broadcast product with a LinkedIn-approved integration — it says nothing about Vimeo's own inbound API.

**Verdict:** `PARTNER APPROVAL REQUIRED` (Enterprise + allowlist). For LIVETAP, **ship Vimeo as a custom RTMP/SRT destination** where the user pastes credentials from the Vimeo UI. Revisit only if an Enterprise relationship exists.

### 3.5 DLive — DEAD

`https://dlive.tv/s/faq` returns a page whose only content is **"DLive Service Discontinued."** Reported closure date: **2026-04-27**.

**Verdict: remove DLive from the roadmap entirely.** `UNAVAILABLE` for every capability. This is the most unambiguous result in the report, recorded here so nobody re-litigates it.

### 3.6 Rumble — USER-ASSISTED RTMP, with a read-only chat feed

- **RTMP ingest: yes.** The ingest URL and stream key are available **only from the Rumble Live Dashboard / Rumble Studio** — a human copies them.
- **No OAuth.** Instead Rumble issues a **per-user secret "Live Stream API" URL**. Possession of the URL *is* the credential, so LIVETAP must treat it with exactly the same secrecy as a stream key (encrypted at rest, redacted from logs).
- **Chat: read-only.** Polling that secret URL returns JSON containing roughly the **last 50 chat messages plus Rants** (Rumble's paid-message feature). There is **no chat write and no moderation**.
- **Live status:** derivable by polling the same JSON.
- **Eligibility:** open — no partner program.

**Verdict:** `USER-ASSISTED` for ingest, `OAUTH + API`-like read-only for chat but **without OAuth** (secret URL). **Do not build a full adapter.** Support ingest via the custom RTMP destination; a read-only chat panel is a cheap optional extra if the secret URL is handled as a secret.

### 3.7 Bilibili — out of scope for v1, and not the API you think it is

The single most useful correction here: **`open-live.bilibili.com` is not an ingest API.** It is an **in-room interactive-application platform** — for building apps that run *inside* a live room (interacting with viewers, reading danmaku) — **not** for provisioning a stream key or starting a broadcast.

- **RTMP ingest:** exists on the platform, but **is not exposed through the open API**.
- **Auth:** **HMAC-signed** `access_key` / `secret` pairs, issued only after an **onboarding review**.
- **Chat:** danmaku (弹幕) over WebSocket, established via `/v2/app/start`.
- **Eligibility:** onboarding review, **Chinese-language documentation only**.

Beyond the API question, a China-market destination carries real-name verification, ICP/licensing and data-residency obligations that are **legal questions, not engineering ones** — the seriousness of which LinkedIn's own mainland-China exclusion illustrates.

**Verdict: out of scope for v1.** Support via custom RTMP if a user supplies credentials; build nothing.


## 4. Custom destination spec (generic RTMP / RTMPS / SRT / WHIP)

This is the **most important section in this document for LIVETAP's actual architecture.** Because X is user-assisted, LinkedIn is partner-gated, and most secondary platforms have no stream-key API, a *first-class, excellent generic destination* covers more real-world use than any individual integration. Restream, OneStream, Castr and Switchboard all monetise essentially this.

### 4.1 What LIVETAP must support

#### A. RTMP / RTMPS (baseline, non-negotiable)

Input model: **two fields** — `url` and `streamKey` — because that is the shape every platform's dashboard and every encoder (OBS, vMix, XSplit, Wirecast) uses.

```
rtmp://host[:port]/app[/instance]      + key
rtmps://host[:port]/app[/instance]     + key
```

- **Schemes:** accept exactly `rtmp://` and `rtmps://` (case-insensitive). Reject everything else with a clear message.
- **Default ports:** RTMP -> **1935** (TCP); RTMPS -> **443** (TCP). Both are conventions, not requirements: RTMP is also seen on 80 and 443, and platforms use nonstandard ports (LinkedIn alone documents 1935, 1936, 2935, 2936 and 443). **Accept any port 1-65535.**
- **Path:** everything after the host is the *application* (and optional instance), e.g. `/live`, `/ingest`, `/app/instance`. It is opaque. Do **not** normalise, lowercase, strip, or re-encode it.
- **Query strings are legitimate and must be preserved byte-for-byte.** Real ingests use `?token=`, `?username=&password=`, signed expiry params, and Wowza/Akamai-style auth. Stripping or re-encoding a query string is a classic multistreamer bug.
- **Key placement:** allow the user to paste a full URL that already contains the key (a very common shortcut) and offer to split it, but **never split silently** — a key can itself contain `/`.
- Allow `url` with or without a trailing `/`; join with exactly one `/`.

#### B. SRT (should-have; differentiator)

```
srt://host:port?mode=caller&streamid=<id>&passphrase=<pw>&pbkeylen=<16|24|32>&latency=<ms>
```

- **Scheme:** `srt://`. **Port is mandatory** for SRT — unlike RTMP there is no universal default.
- **`mode`** — support **`caller`** (LIVETAP dials out; the case for essentially all cloud ingests) and at minimum document **`listener`** and `rendezvous`. Default to `caller`.
- **`streamid`** — opaque, max **512 characters**. Many servers use the **SRT Access Control** convention: a string beginning `#!::` with comma-separated key=value pairs:
  - `m=` mode — **`publish`** (send) or `request` (receive)
  - `r=` resource path, e.g. `r=live/livestream`
  - `u=` username
  - Example: `streamid=#!::m=publish,r=live/mystream`
  - **Do not URL-encode or mangle `#!::`**, and do not assume the convention — many servers use a bare opaque streamid.
- **`passphrase`** — must be **10-79 characters** when used (SRT protocol constraint). Validate locally; a 9-character passphrase otherwise fails at connect time with an opaque error.
- **`pbkeylen`** — `0` (none, default), `16`, `24`, or `32` (AES-128/192/256). Only meaningful alongside a passphrase.
- **`latency`** — milliseconds. Expose it; latency tuning is the main reason users choose SRT.
- Treat the passphrase as a **secret** with identical handling to a stream key: encrypted at rest, redacted in logs, never in telemetry.

#### C. WHIP (nice-to-have; low-latency / WebRTC destinations)

```
POST <whip-endpoint-url>
Authorization: Bearer <token>
Content-Type: application/sdp
```

- **WHIP is RFC 9725** (WebRTC-HTTP Ingestion Protocol), and is what **OBS Studio 30.0+** exposes as `Service: WHIP` with a *Server* (endpoint URL) field and a *Bearer Token* field.
- Input model: **`endpointUrl` + `bearerToken`** — deliberately the same two-field shape as RTMP. As the OBS knowledge base puts it, the bearer token "is just the WHIP name for 'Stream Key'."
- Bearer-token auth is **mandatory-to-implement** for WHIP clients per the spec: the `Authorization` header must be sent on every request to the endpoint or session, **except CORS preflight `OPTIONS`**.
- **Scheme must be `https://`** in practice. Reject `http://` for anything non-loopback — the token is a credential travelling in a header.
- Copy the RTMP field shape and validation UX exactly, so users are not re-taught a second mental model.
- **Session mechanics LIVETAP must implement correctly** (these are where naive WHIP clients break):
  - Expect **`201 Created`** with a **`Location`** header naming the *session* resource — this is distinct from the endpoint URL.
  - **`DELETE` the session URL to end the broadcast** cleanly. Failing to do so leaves a hanging publisher.
  - **Follow `307` redirects while preserving the `Authorization` header.** Amazon IVS real-time's `https://global.whip.live-video.net` 307-redirects on every connection, and many HTTP client libraries **strip auth headers across redirects by default** — this will silently fail.
  - **The bearer token is sometimes not a header at all.** Cloudflare Stream embeds the credential in the URL path and its docs instruct users to *"leave Bearer Token blank."* So the token field **must be optional**, and an empty token must not be treated as a validation error.
  - Codec floor: **H.264 + Opus** is the safe baseline; IVS real-time **requires** an H.264 track.

### 4.2 Validation rules (implement once, as a shared validator)

| Rule | Behavior |
|---|---|
| Scheme allow-list | `rtmp`, `rtmps`, `srt`, and `https` for WHIP. Reject with a named, specific error — never a generic "invalid URL" |
| Host | Non-empty; accept DNS names, IPv4, and bracketed IPv6 (`rtmp://[2001:db8::1]:1935/live`) |
| Port | Optional for RTMP/RTMPS (default 1935/443), **required for SRT**, range 1-65535 |
| Path | Opaque; preserved verbatim; may be empty |
| Query | Preserved verbatim; **never** re-encoded, reordered, or deduplicated |
| Stream key | Any non-empty string. **Do not enforce length, charset, or a regex** — real keys contain `/`, `-`, `?`, `=`, `&`, and base64 padding |
| SRT passphrase | If present, **10-79 chars**; otherwise reject locally with the precise reason |
| SRT pbkeylen | One of `0`, `16`, `24`, `32` |
| SRT streamid | Max 512 chars; preserved verbatim including a leading `#!::` |
| WHIP | `https://` (except loopback); non-empty bearer token |
| Whitespace | Trim leading/trailing whitespace on paste (the single most common real-world paste bug), but **never** touch interior characters |
| Duplicate destinations | Warn (do not block) if the same `url + key` pair is already attached — double-publishing one key is a guaranteed platform-side disconnect |
| Secrets | Encrypted at rest; redacted in all logs, crash reports and telemetry; never written to plaintext config |
| Reachability probe | Optional pre-flight TCP connect to host:port. Treat failure as a **warning, not a block** — many ingests refuse idle connections, so false negatives would be worse than the bug the check prevents |

**Anti-rule — state this as a comment in the code:** do **not** try to validate that a URL "looks like" a known platform, and do not maintain a regex allow-list of known hosts. Custom destinations exist precisely for the endpoints LIVETAP has never heard of.

### 4.3 Common ingest-server behaviors LIVETAP must model

The single most important semantic axis: **does pushing bytes make you live?**

| Behavior | Meaning | Examples |
|---|---|---|
| **Auto-live on ingest** | Connecting and publishing immediately creates/starts the public broadcast. No API call needed; stopping the push ends or idles it. | **Twitch**, **Kick**, **Facebook** (when the post is `LIVE_NOW`); self-hosted `nginx-rtmp` and SRS; most CDN and custom endpoints |
| **Explicit start required** | A broadcast object must exist and be transitioned to live separately. Ingest alone shows nothing publicly. | **X** (broadcast created + started in Live Studio, plus a published Post), **LinkedIn** (`liveVideos` patch links the asset), **YouTube** (needs an explicit transition unless auto-start is configured) |
| **Bound to a scheduled object** | The broadcast must be pre-scheduled and ingest is only accepted inside a time window. | **LinkedIn** since 22 Jun 2026 (window: -15 min to +2 h) |

Additional behaviors to handle:

- **Publish hooks / callback auth.** Self-hosted `nginx-rtmp` and SRS commonly authenticate via an `on_publish` HTTP callback (`http_hooks` in SRS): the server calls an application endpoint which returns **2xx to accept, 4xx to reject** the publish. Practical consequence: **rejection happens *after* a successful TCP/RTMP connect**, so LIVETAP must treat an immediate post-connect disconnect as a probable *auth* failure and say so, rather than reporting a generic network error.
- **Idle / no-data timeouts.** Platforms drop publishers that send nothing (LinkedIn: **120 s**). Reconnect logic must distinguish "we stopped sending" from "they dropped us."
- **Reconnect and backoff.** Exponential backoff with jitter, a ceiling, and a **hard stop** after N attempts. Note that reconnecting to an auto-live endpoint may create a *new* broadcast — surface that risk to the user.
- **Single-publisher enforcement.** Nearly all ingests permit one publisher per key, and a stale server-side connection can block the new one. Offer the specific diagnosis: "another encoder may still be connected with this key."
- **Key rotation.** Keys can be rotated server-side at any time without notice. Auth failures must be reported as "this key may have been rotated — copy it again," not as a transient error to be retried forever.
- **Backup / secondary ingest URLs.** LinkedIn (and Twitch, YouTube) expose these. Model a destination as *potentially* having primary and backup URLs — but only advertise the feature if LIVETAP genuinely runs a second time-synced encode, which LinkedIn explicitly requires.

### 4.4 Per-destination capability descriptor

Every destination — native, partner, or custom — should expose the same machine-readable descriptor so the UI can hide what is impossible instead of failing at runtime. This is the direct implementation of the directive's "capability discovery should control UI exposure."

```
protocol:        rtmp | rtmps | srt | whip | hls-pull
goLiveSemantics: auto-on-ingest | explicit-start | scheduled-bound
canCreateBroadcast / canStart / canStop / canGetStatus
canSetMetadata / canSetThumbnail
canReadChat / canWriteChat / canModerate
canGetAnalytics / canSchedule
maxBitrateKbps / maxResolution / maxFps / keyframeIntervalSec
allowedAspectRatios
supportsBackupIngest
authModel:       none | pasted-key | oauth | partner-oauth
```

For a **generic custom destination** the honest descriptor is: `goLiveSemantics: auto-on-ingest` (assumed, and user-overridable), every `can*` flag **false** except the push itself, no bitrate ceiling, and `authModel: pasted-key`. LIVETAP should let the user flip `goLiveSemantics` to `explicit-start`, so the UI stops claiming "LIVE" in cases where it cannot actually know.

## 5. WHIP / HEVC / AV1 ingest matrix (2026)

**Verification legend:** **[O]** = official vendor/standards documentation read directly for this report · **[S]** = secondary source · **[?]** = `UNVERIFIED` / not verifiable from this environment.

### 5.1 What WHIP is, precisely

- **WHIP = WebRTC-HTTP Ingestion Protocol, published as RFC 9725** (IETF WISH working group; the draft lineage is `draft-ietf-wish-whip-*`). It is a **standards-track RFC, not a draft** — this matters for LIVETAP's protocol roadmap. **[O]**
- The wire flow is deliberately trivial: the client `POST`s an **SDP offer** to the WHIP endpoint URL with `Content-Type: application/sdp`; the server answers with SDP; media then flows over WebRTC. **[O]**
- **Bearer-token auth is mandatory-to-implement for clients.** Per the spec, a WHIP client **MUST** implement HTTP `Authorization: Bearer <token>` and send it on **all** HTTP requests to the endpoint or session, **except CORS preflight `OPTIONS`**. **[O]**
- **OBS Studio** exposes WHIP as a first-class service with two fields — *Server* (endpoint URL) and *Bearer Token* — and the official OBS knowledge base states the bearer token *"is just the WHIP name for 'Stream Key'."* **[O]**
  - **OBS WHIP version history:** WHIP output added in **OBS 30.0** (Nov 2023); **HEVC-over-WHIP in 30.2**; **WebRTC simulcast in 32.1** (Mar 2026, confirmed by the KB as *"available in OBS version 32.1.0 and newer"*). **[O]**
  - Known gap: WHIP is *"currently not supported in the Ubuntu 24.04 PPA release."* **[O]**
- **Timeline note:** WHIP became an RFC in **March 2025**, and as of this research **no platform's own documentation yet cites RFC 9725 by number** — they describe "WebRTC ingest" or "WHIP" informally. Expect vendor docs to lag the standard. **[O]**
- OBS cites codec flexibility as WHIP's advantage: *"AV1, H265 and Opus available. Custom codecs are possible."* **[O]**

### 5.2 WHIP adoption table

| Platform | WHIP ingest | Detail | Verification |
|---|---|---|---|
| **Cloudflare Stream** | **Yes — GA** | Official docs: *"Stream Live WebRTC is going GA"*; billing begins **15 Oct 2026**. Endpoint: `https://customer-<CODE>.cloudflarestream.com/<SECRET>/webRTC/publish`. **Auth is in the URL, not a header** — the docs say to *"leave Bearer Token blank"* in OBS, and warn the URL *"is a credential and should only be shared with the creator."* Broadcast codecs: **VP9, VP8, H.264** (Constrained Baseline Level 3.1). Sub-second, "less than 500 milliseconds" playback latency. | **[O]** |
| **Twitch** | ⚠️ **Effectively NO — do not build** | Twitch *is* on the **official OBS WHIP-compatible list**, but **Twitch's own ingest documentation documents no WHIP endpoint and no SRT.** The WHIP endpoint that exists is an **undocumented 2023 beta**. Critically: **Twitch "Enhanced Broadcasting" is Enhanced RTMP multitrack, NOT WHIP** — this is the most widely repeated misconception in this area and the brief itself carried it. **Verdict: treat Twitch as RTMP/RTMPS only.** | **[O]** for the OBS listing and the Enhanced-RTMP correction; **[?]** for the beta endpoint |
| **Dolby OptiView** (formerly Dolby.io / Millicast) | **Yes** | On the official OBS WHIP-compatible list. **Codecs: H.264, H.265/HEVC, VP8, VP9, AV1** — making it the **only verified WHIP target that accepts HEVC and AV1.** Also supports SRT. Encoder notes: **B-frames off** for Millicast. **Note the rebrand: Dolby.io streaming docs now 301-redirect to `optiview.dolby.com/docs/`.** | **[O]** |
| **Red5** | **Yes** (listed) | Official OBS WHIP-compatible list. | **[O]** |
| **Tencent** | **Yes** (listed) | Official OBS WHIP-compatible list (Tencent Cloud). | **[O]** |
| **Broadcast Box** | **Yes** (listed) | Official OBS WHIP-compatible list. Open-source WHIP/WHEP server — **the obvious choice for LIVETAP's WHIP integration tests.** | **[O]** |
| **Stage TEN** | **Yes** (listed) | Official OBS WHIP-compatible list. | **[O]** |
| **Amazon IVS** | **No** (low-latency) / **YES** (real-time) | Low-latency IVS officially supports **only RTMPS, RTMP and SRT** — no WHIP. But **IVS Real-Time Streaming does support WHIP**: endpoint **`https://global.whip.live-video.net`**, which **307-redirects** (client must preserve the `Authorization` header), authenticated with the **participant token as Bearer**, **H.264 track required**, capped ~**720p / 8.5 Mbps**. | **[O]** |
| **YouTube Live** | **No** | YouTube's official live-encoder settings page lists **RTMP/RTMPS** and mentions **HLS**; the developer protocol table (as of 2026-09-04) lists **RTMP / RTMPS / HLS / DASH only**. **Neither WHIP nor SRT appears in either.** | **[O]** |
| **Kick** | **No** | Not on the OBS WHIP-compatible list. Kick is **RTMP only**: `rtmp://ingest.kick.com/live`, up to **1080p60**, **≤8000 kbps CBR**, **H.264 ("X264/H.264 only")**. No WHIP, no SRT, no HEVC, no AV1. Kick is Platform Integrations 1's scope — cross-check with their report. | **[O]** |
| **Facebook / Instagram** | **No** | **RTMPS only, H.264.** No WHIP, SRT, HEVC or AV1. Platform Integrations 2's scope. | **[O]** |
| **LinkedIn** | **No** | Official Live Ingest Requirements: *"Protocol: RTMP/RTMPS (preferred)."* Nothing else. | **[O]** |
| **X** | **No** | RTMP (probably RTMPS) plus an HLS **pull** source type. No WebRTC ingest in any reachable source. | **[S]** |
| **Dailymotion** | **No** | API returns `ingest.rtmp_url` and `ingest.srt_url` only. | **[O]** |
| **Vimeo** | **No** | RTMP / RTMPS / **SRT** only. | **[O]** |
| **Trovo** | n/a | Platform reported decommissioned 2026-06-30 (§3.3). Ingest protocol/host was never documented. | **[?]** |
| **TikTok / Mux / Livepeer** | **`UNVERIFIED`** | Not on the OBS list; not verifiable here. TikTok assumed RTMP (LIVE Studio / stream key) and belongs to Platform Integrations 2 — defer to that team's report. | **[?]** |

### 5.3 Enhanced RTMP — the mechanism behind modern codecs over RTMP

Legacy RTMP/FLV could only signal a fixed, ancient codec set. **Enhanced RTMP** (Veovera Software Organization) fixes that with FourCC signalling, and it is *why* HEVC and AV1 over RTMP exist at all. **[O]**

- **Video codecs added:** **VP8, VP9, HEVC, and AV1** *"with HDR support to meet modern display and content standards,"* alongside legacy AVC/H.264.
- **Audio codecs added:** **AC-3, E-AC-3, Opus, and FLAC**, plus FourCC signalling for legacy AAC and MP3.
- **Two published versions: v1 and v2.** v2 is *"the latest specification"*, expanding audio, video, metadata and synchronisation, and adding *"new audio and video multitrack capabilities for concurrent management and processing of multiple media streams."*
- **Organisations listed as actively supporting the effort:** *"Adobe, YouTube, Twitch, Amazon, VideoLan, FFmpeg, OBS, Ant Media, Dolby, Intel Corporation, Luxoft, XSplit, Red5, mirillis, OpenIPC"* and others.
- ⚠️ **Important caveat, stated by the spec page itself:** it *"does not specify which platforms have already deployed implementations versus those merely supporting the initiative."* **Presence on that supporter list is NOT evidence that a platform accepts HEVC or AV1 ingest today.** Verify per platform, per codec.

### 5.4 HEVC / AV1 ingest table

| Platform | H.264 | HEVC (H.265) | AV1 | Verification & notes |
|---|---|---|---|---|
| **YouTube Live** | **Yes** | **Yes** | **Yes** | **[O]** — official live-encoder-settings page lists **H.264, H.265 (HEVC) and AV1**, with the caveat *"AV1 is not supported for HDR."* Both arrive via **Enhanced RTMP** over RTMPS (corroborated by OBS's `services.json`, which declares YouTube RTMPS accepting h264/hevc/av1), and HEVC is also accepted over HLS ingest. Keyframe **2 s recommended, 4 s max**; **CBR**; up to 60 fps; audio AAC or MP3 at 128 kbps stereo / 384 kbps 5.1. Ladder: 2160p60 ≈ 35 Mbps, 1080p60 ≈ 12 Mbps, 720p60 ≈ 6 Mbps (H.264). **The most codec-capable major destination.** ⚠️ YouTube's own docs are internally inconsistent on RTMP codecs — verify empirically before shipping. |
| **Twitch** | **Yes** | **Yes** (gated) | **Beta-gated** | **HEVC at 1440p is GA for Partners and Affiliates** (announced June 2026) via **Enhanced Broadcasting = Enhanced RTMP multitrack** — *not* WHIP. **AV1 and 4K remain beta-gated.** **[S]** for the June 2026 announcement and the AV1/4K gating; **[O]** for the Enhanced-RTMP-not-WHIP correction. Note the eligibility gate: this is **not** available to ordinary accounts |
| **Dolby OptiView** (WHIP/SRT) | **Yes** | **Yes** | **Yes** | **[O]** — **the only verified WHIP target accepting HEVC and AV1** (H.264/H.265/VP8/VP9/AV1). B-frames off |
| **Amazon IVS** (low-latency) | **Yes** | **No** | **No** | **[O]** — *"Amazon IVS supports H.264 for video and AAC (LC) for audio."* Unambiguous. Amazon is on the Enhanced RTMP supporter list yet IVS ingest is H.264-only — **the perfect illustration of §5.3's caveat.** IVS real-time (WHIP) likewise **requires H.264** |
| **Cloudflare Stream** (WHIP) | **Yes** (Constrained Baseline L3.1) | **No** | **No** | **[O]** — WHIP broadcast codecs are **VP9, VP8, H.264**. Note also **WHIP↔WHEP only — you cannot serve HLS from a WHIP ingest.** Cloudflare's *RTMP/SRT* path codec support not separately verified **[?]** |
| **LinkedIn** | **Yes** (only) | **No** | **No** | **[O]** — *"Encoding: H264 video, AAC audio."* Plus 6 Mbps / 1080p / 30 fps / 2 s keyframe ceilings |
| **X** | **Yes** (only) | **No** | **No** | **[S]** — H.264/AVC, ~9 Mbps, AAC-LC ≤128 kbps |
| **Kick** | **Yes** (only) | **No** | **No** | **[O]** — *"X264/H.264 only"*; 1080p60, ≤8000 kbps CBR |
| **Facebook / Instagram** | **Yes** (only) | **No** | **No** | **[O]** — RTMPS + H.264 only |
| **Vimeo** | **Yes** | **No** | **No** | **[O]** |
| **Dailymotion** | Presumed | **`UNVERIFIED`** | **`UNVERIFIED`** | Encoder specs not stated on the retrieved pages **[?]** |
| **TikTok** | Presumed | **`UNVERIFIED`** | **`UNVERIFIED`** | Platform Integrations 2's scope **[?]** |

**The practical conclusion for LIVETAP's encoder design:** **H.264 + AAC over RTMP/RTMPS is the only universal path in 2026.** The binding constraints across verified destinations are **LinkedIn's 6 Mbps / 1080p30 / 2-second-keyframe ceiling**, **Kick's 8000 kbps CBR cap**, and **IVS's channel-type caps that disconnect on breach**. Treat HEVC and AV1 as **per-destination "Pro mode" opt-ins** selected by a destination profile — realistically **YouTube**, **Twitch (Partner/Affiliate only)**, and **Dolby OptiView** — and **never** in the shared master encode.

### 5.5 SRT ingest table

| Platform | SRT ingest | Detail | Verification |
|---|---|---|---|
| **Amazon IVS** | **Yes** | **Port 9000.** `srt://<endpoint>:9000?streamid=<stream-key>&passphrase=<passphrase>`. Passphrase required unless insecure ingest is enabled on the channel. Takeover form uses the Access-Control convention: `srt://<uri>?streamid=#!::u=<streamkey>,priority=N&passphrase=foobar` | **[O]** |
| **Dailymotion** | **Yes** | `ingest.srt_url` returned by the livestream API (nullable), with a `streamid` parameter | **[O]** |
| **Vimeo** | **Yes** | Alongside RTMP/RTMPS | **[O]** |
| **Cloudflare Stream** | **Yes — caller mode only** | LIVETAP must not offer listener/rendezvous for this destination | **[O]** |
| **Dolby OptiView** | **Yes** | `streamid` is structured, e.g. `name?t=token` (contrast with IVS's opaque `sk_...`) | **[O]** |
| **YouTube Live** | **No** | Official encoder-settings page lists RTMP/RTMPS and mentions HLS; developer protocol table lists RTMP/RTMPS/HLS/DASH. **SRT appears in neither** | **[O]** |
| **LinkedIn** | **No** | RTMP/RTMPS only, per official ingest requirements | **[O]** |
| **X** | **No** | RTMP (probably RTMPS) + HLS pull only | **[S]** |
| **Twitch** | **No** | Not in Twitch's documented ingest list | **[O]** |
| **Kick** | **No** | RTMP only | **[O]** |
| **Facebook / Instagram** | **No** | RTMPS only | **[O]** |

**SRT parameters LIVETAP must expose** (synthesised from the IVS and Dolby official examples plus the SRT Access Control convention — see §4.1(B) for full validation rules):
- `mode` — **`caller` only in practice.** Cloudflare explicitly supports caller mode only; every verified destination is a caller-to-server relationship. Offer `listener`/`rendezvous` only for self-hosted custom endpoints.
- `streamid` — ≤512 chars, and note the **three shapes actually observed in the wild**: opaque (`streamid=<key>`, Dailymotion/IVS simple form), Access-Control (`#!::m=publish,r=…` or IVS's `#!::u=<key>,priority=N`), and structured query (`name?t=token`, Dolby). **This is why the streamid must be stored and transmitted verbatim.**
- `passphrase` — **10–79 characters** (protocol constraint; validate locally).
- `pbkeylen` — `0` / `16` / `24` / `32`.
- `latency` — milliseconds. **No platform in this survey publishes a recommended value** — a commonly used default is 200 ms but that is `UNVERIFIED`; make it user-tunable and do not claim a "recommended" figure.
- Container is **MPEG-TS**; keyframe **2 s**; **B-frames off** for Dolby/Millicast.

### 5.6 Roadmap recommendation

1. **RTMP + RTMPS — ship at v1.** Universal; the only protocol every verified destination accepts, and the only one X, LinkedIn, Twitch, Kick, Facebook and Instagram accept at all.
2. **SRT — ship at v1 or v1.1, as a custom-destination option.** Officially supported by **Amazon IVS**, **Dailymotion**, **Vimeo**, **Cloudflare Stream** (caller only) and **Dolby OptiView**. **No major social destination accepts SRT** — so it is a pro/contribution feature, not a multistreaming feature. Low incremental cost once the model in §4.1(B) exists.
3. **WHIP — ship as `EXPERIMENTAL`, behind a flag, and be honest about the adopter set.** RFC 9725 is real and the adopters are real (**Cloudflare Stream GA**, **Amazon IVS real-time**, **Dolby OptiView**, Red5, Tencent, Broadcast Box, Stage TEN), but **Twitch is not a usable WHIP target** despite the OBS listing. Test against **Broadcast Box** (open-source, free) and **Cloudflare Stream** (GA, documented endpoint). Its highest-value internal use is likely **LIVETAP's own web→relay hop** (browser capture into MediaMTX) rather than as an outbound destination.
4. **HEVC / AV1 — per-destination "Pro mode" opt-in only.** Verified targets: YouTube, Twitch (Partner/Affiliate, HEVC 1440p GA), Dolby OptiView. Never in the shared master encode.
5. **HLS pull (X's alternate source type) — do not build.** It inverts LIVETAP's push model and would require hosting a playlist.
6. **Do not build adapters for:** DLive (dead), Trovo (reported dead), Amazon Live (no API), Rumble (no API), Bilibili (not an ingest API). All are served adequately by the custom destination.

---

## 6. Sources

### Official — X
- X API introduction — https://docs.x.com/x-api/introduction
- X API overview (full endpoint group list) — https://docs.x.com/x-api/overview
- About the X API — https://docs.x.com/x-api/getting-started/about-x-api
- X OAuth 2.0 Authorization Code with PKCE (scopes, token lifetimes, PKCE requirement) — https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
- X API rate limits — https://docs.x.com/x-api/fundamentals/rate-limits
- X API hide replies (`PUT /2/tweets/{id}/hidden`, `tweet.moderate.write`) — https://docs.x.com/x-api/posts/hide-replies
- X API v2 support — https://developer.x.com/en/support/x-api/v2
- *Unreachable from this environment (HTTP 403):* `https://help.x.com/en/using-x/how-to-use-live-producer`, `https://help.x.com/en/using-x/live-studio`, `https://help.twitter.com/en/using-twitter/how-to-use-live-producer`, `https://devcommunity.x.com/...`. `https://docs.x.com/x-api/pricing` and `.../fundamentals/pricing` returned 404. `media.twitter.com` now 302-redirects to `business.x.com`.

### Official — LinkedIn
- Live Events APIs (overview, scopes, tiering, register, ingest requirements, end) — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/
- Spontaneous Live Events Migration (the 2026 consolidation onto scheduled live) — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/live-video-spontaneous-migration
- Scheduled Live Events (10/day limit, −15 min/+2 h go-live window) — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/live-video-scheduled-live
- Live Events Content Access API (`contentAccess`, 200/404) — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/live-video-content-access
- Live Events Target Audiences — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/live-video-target-audience
- Live Events announcements & release notes (liveAssetActions migration; refresh tokens by request) — https://learn.microsoft.com/linkedin/consumer/integrations/live-video/release-notes
- Authorization Code Flow (3-legged OAuth) — https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
- Authenticating with OAuth 2.0 for Native Clients (PKCE, loopback-only, enabled on request) — https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow-native
- Authentication overview (2-legged vs 3-legged) — https://learn.microsoft.com/linkedin/shared/authentication/authentication
- Comments API — https://learn.microsoft.com/linkedin/marketing/community-management/shares/comments-api
- Reactions API — https://learn.microsoft.com/linkedin/marketing/community-management/shares/reactions-api
- Social Metadata API (enable/disable comments on a thread) — https://learn.microsoft.com/linkedin/marketing/community-management/shares/social-metadata-api
- Video Analytics API — https://learn.microsoft.com/linkedin/marketing/community-management/shares/video-analytics-api
- Events API (Event Management; `liveVideo` field mutability) — https://learn.microsoft.com/linkedin/marketing/event-management/events
- Event Management use cases (live multicast + comment moderation) — https://learn.microsoft.com/linkedin/marketing/event-management/event-management-usecase
- Integration Requirements for Event Management (EM-001…EM-203 test cases) — https://learn.microsoft.com/linkedin/marketing/event-management/integration-requirements-event-management
- Recent Marketing API changes (202601 event metrics; 202508 sunset 17 Aug 2026) — https://learn.microsoft.com/linkedin/marketing/integrations/recent-changes
- Live Events API Program (tiers, OneVet, application form) — https://www.linkedin.com/developers/news/featured-updates/live-events
- **LinkedIn Live Events API Terms of Use** (approval required; no resale to unaffiliated customers; data restrictions) — https://www.linkedin.com/legal/l/live-events-api-terms
- LinkedIn Help — Create and host LinkedIn Live: Access criteria (150 followers, 30 days, mainland China exclusion) — https://www.linkedin.com/help/linkedin/answer/a568503
- LinkedIn Help — Get access to LinkedIn Live via preferred partners — https://www.linkedin.com/help/linkedin/answer/a520811
- LinkedIn Help — LinkedIn Live Video Broadcasting FAQ (4-hour max; moderation; analytics) — https://www.linkedin.com/help/linkedin/answer/a548518
- LinkedIn Live third-party broadcast partners chart — https://business.linkedin.com/content/dam/me/business/en-us/marketing-solutions/products/pdfs/linkedin-live-3rd-party-broadcast-partners-chart.pdf

### Official — secondary destinations
- Amazon IVS Streaming Configuration (codecs, RTMPS/RTMP/SRT, channel types, takeover, captions) — https://docs.aws.amazon.com/ivs/latest/userguide/streaming-config.html
- What is Amazon IVS Real-Time Streaming — https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html
- Amazon IVS Low-Latency API Reference — https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/Welcome.html
- Dailymotion — Create a livestream for a profile — https://developers.dailymotion.com/reference/create-profile-livestream.md
- Dailymotion — Create and schedule a live event — https://developers.dailymotion.com/docs/create-and-schedule-a-live-event.md
- Dailymotion — Get a livestream — https://developers.dailymotion.com/reference/get-livestream.md
- Dailymotion — docs index — https://developers.dailymotion.com/llms.txt
- Dailymotion API v2 — https://developers.dailymotion.com/api/
- Trovo Open Platform APIs (OAuth, scopes, `stream_key`, chat send/delete) — https://developer.trovo.live/docs/APIs.html
- Trovo Chat Service (`wss://open-chat.trovo.live/chat`, tokens, message types) — https://developer.trovo.live/docs/Chat%20Service.html
- **DLive — service discontinued** — https://dlive.tv/s/faq
- Amazon IVS Real-Time WHIP ingest (`https://global.whip.live-video.net`, 307 redirect, participant token) — https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/
- Amazon IVS Chat (`wss://edge.ivschat.<region>.amazonaws.com`) — https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/
- Vimeo live API and plan/allowlist requirements — https://developer.vimeo.com/api/reference/live
- Bilibili open live platform (interactive in-room apps, not ingest) — https://open-live.bilibili.com/
- Rumble Live Stream API (per-user secret URL, read-only chat) — https://rumble.com/
- *Doc pages that returned a JS shell, 403 or 404 to a plain fetch in this environment and were therefore corroborated via the second research pass rather than read directly:* Vimeo developer docs, `open.bilibili.com`, `rumble.com/s/help`, `help.twitch.tv`, `optiview.dolby.com/docs/`.

### Official — protocols, codecs, encoders
- RFC 9725 — WebRTC-HTTP Ingestion Protocol (WHIP) — https://datatracker.ietf.org/doc/rfc9725/
- WHIP draft lineage — https://datatracker.ietf.org/doc/html/draft-ietf-wish-whip-13
- OBS Studio — WHIP Streaming Guide (bearer token = stream key; compatible services list; simulcast in 32.1.0+) — https://obsproject.com/kb/whip-streaming-guide
- Veovera Enhanced RTMP specification (HEVC/VP8/VP9/AV1, multitrack, v1/v2, supporter list) — https://github.com/veovera/enhanced-rtmp
- YouTube — Choose live encoder settings, bitrates and resolutions (H.264 / H.265 / AV1) — https://support.google.com/youtube/answer/2853702
- Cloudflare Stream — WebRTC (WHIP) beta→GA — https://developers.cloudflare.com/stream/webrtc-beta/
- Haivision — Configuring SRT Access Control (`#!::` streamid syntax) — https://doc.haivision.com/MakitoX4Enc/1.8/configuring-srt-access-control
- SRS — SRT documentation (`m=`, `r=`, passphrase, pbkeylen) — https://ossrs.net/lts/en-us/docs/v7/doc/srt
- Wowza — Ingest and publish an SRT stream — https://www.wowza.com/docs/ingest-and-publish-an-srt-stream-with-wowza-streaming-engine
- nginx-rtmp `on_publish` auth backend (reference implementation) — https://github.com/voc/rtmp-auth
- OBS Studio `services.json` (per-service declared protocols and codecs — a useful cross-check on vendor docs) — https://github.com/obsproject/obs-studio/blob/master/plugins/rtmp-services/data/services.json
- Kick ingest (`rtmp://ingest.kick.com/live`, H.264 only, ≤8000 kbps CBR) — https://help.kick.com/

### Secondary — clearly labelled as such in the text above
- Socialive — Livestream to X (Twitter) Media Studio via RTMP — https://support.socialive.us/support/solutions/articles/67000686130-livestream-to-x-twitter-media-studio-via-rtmp
- Restream — Find your live stream key on X — https://restream.io/learn/platforms/how-to-find-x-stream-key/
- Castr — How to stream live video to X using Castr (RTMPS; manual start required) — https://docs.castr.com/en/articles/5119218-how-to-stream-live-video-to-x-formerly-twitter-using-castr
- Streamlabs — Streaming to X (Twitter) via RTMP — https://support.streamlabs.com/hc/en-us/articles/30553518714395-Streaming-to-X-Twitter-via-an-RTMP
- Vimeo blog — How to live stream on X — https://vimeo.com/blog/post/stream-on-x
- Upstream.so — X Live Studio guide (regions, specs, chat controls, scheduling) — https://upstream.so/blog/x-live-streaming/
- Social Media Today — X launches livestream studio — https://www.socialmediatoday.com/news/x-launches-livestream-studio-to-simplify-live-broadcasts/824300/
- Engadget — X's fresh push for live video with creator payouts — https://www.engadget.com/2206527/x-push-for-live-video-creator-payouts/
- Social Media Today — LinkedIn will no longer allow real-time livestreams — https://www.socialmediatoday.com/news/linkedin-will-no-longer-allow-real-time-livestreams/816050/
- PPC Land — LinkedIn kills spontaneous live streaming from June 22 — https://ppc.land/linkedin-kills-spontaneous-live-streaming-from-june-22/
- netinfluencer — LinkedIn to require advance scheduling for all live streams — https://www.netinfluencer.com/linkedin-to-require-advance-scheduling-for-all-live-streams-starting-june/
- Post Planner (historical) — Twitter launches Periscope Producer API — https://www.postplanner.com/blog/live-video-twitter-launching-periscope-producer-api/
- TechCrunch (historical) — Periscope shutdown signals — https://techcrunch.com/2020/12/11/twitter-app-code-indicates-that-live-video-broadcasting-app-periscope-may-get-shut-down
- X API pricing reporting (pay-per-usage rates; legacy tiers closed) — https://postproxy.dev/blog/x-api-pricing-2026/ · https://www.socialcrawl.dev/blog/x-twitter-api-2026 · https://twitterapi.io/blog/x-api-cost-breakdown-2026
- *Explicitly rejected as unreliable:* Grokipedia's claim that Periscope Producer API capabilities were migrated into X API v2 — contradicted by the current official endpoint list.

---

## 7. Open items for follow-up

| # | Item | Why it matters | Owner |
|---|---|---|---|
| 1 | **LinkedIn terms vs open-source distribution** — needs a legal read | **Potential hard blocker.** Terms forbid making the integration available to other developers for resale to unaffiliated customers and never contemplate self-hosting. See §2.9 → **BLOCKERS.md** | Legal / Orchestrator |
| 2 | **LinkedIn Live Events API program** — is it accepting new applicants in 2026, and what is the realistic timeline through Dev Tier → certification → Standard Tier? | Gates the entire LinkedIn integration. Also requires a OneVet background check | Business / Orchestrator |
| 3 | **Trovo shutdown confirmation** — find the official Tencent/Trovo announcement for the reported 2026-06-30 decommission | The two research passes conflict (§3.3). Docs are still served. Resolve before anyone is tempted to build against a good-looking API | Platform Integrations 3 |
| 4 | **X API official price sheet** — both `docs.x.com` pricing URLs 404'd; rates are secondary-sourced | A metered "X replies as chat" feature carries direct per-read COGS with **no free tier** | Platform Integrations 3 |
| 5 | **X RTMPS** — Castr documents RTMPS, Socialive says RTMP; no port documented anywhere | Affects connection code and error messaging. Mitigation: accept both schemes from the pasted URL | Platform Integrations 3 |
| 6 | **Twitch HEVC/AV1 gating** — confirm the June 2026 HEVC-1440p-GA announcement and the Partner/Affiliate eligibility boundary; confirm AV1/4K beta status | Determines which users can actually use Pro-mode codecs. **Already resolved: Enhanced Broadcasting is Enhanced RTMP multitrack, not WHIP** | Platform Integrations 1 |
| 7 | **YouTube RTMP codec inconsistency** — YouTube's own docs disagree on which codecs RTMP ingest accepts | Test empirically before advertising HEVC/AV1 to YouTube | Platform Integrations 1 |
| 8 | **Dailymotion encoder specs** — max bitrate/resolution/fps/keyframe not published on the retrieved pages | Needed to build a destination encode profile and enforce ceilings | Platform Integrations 3 |
| 9 | **SRT latency defaults** — no surveyed platform publishes a recommendation | Avoid shipping a fabricated "recommended" value; expose it as tunable | Media Engineering |
| 10 | **Bilibili / China destinations** | Legal and compliance question (real-name, ICP, data residency) before any engineering | Legal |

**Resolved during this research** (recorded so they are not re-opened): Vimeo Live gating and the `stream_key`/`stream_url` simulcast trap (§3.4); Amazon IVS real-time WHIP endpoint and redirect behavior (§3.1); OBS WHIP version history (§5.1); DLive's closure (§3.5); Bilibili's open platform not being an ingest API (§3.7); Rumble's secret-URL read-only chat (§3.6); Kick and Facebook/Instagram codec and protocol limits (§5.2, §5.4).

---

## 8. Headline conclusions

1. **X has no live API and will not have one soon.** `broadcast.read` / `broadcast.write` scopes exist with no endpoints behind them — the single most likely thing to mislead an implementer. Periscope Producer API died 31 Mar 2021 with no successor. Ship X as a **user-assisted RTMP destination** with an explicit "you must start the broadcast in X Live Studio" checklist, because **pushing bytes to X does not make you live.**
2. **LinkedIn has an excellent live API that LIVETAP may not be allowed to use.** The engineering is tractable (7-step scheduled flow, real status signals, `contentAccess` pre-flight). The blocker is commercial and legal: partner approval + certification + OneVet, and terms that forbid resale to unaffiliated customers and never contemplate open-source self-hosting. **Escalate to BLOCKERS.md.**
3. **LinkedIn's 22 June 2026 change breaks naive designs.** Spontaneous live is gone; every broadcast is a scheduled event (workaround: `scheduledAt = now + 60000`). Any "one-click go live" must hide a scheduled-event state machine.
4. **The generic custom destination is the highest-leverage feature in this report.** It covers Rumble, Vimeo, Bilibili, Amazon IVS, every self-hosted server, and every endpoint LIVETAP has never heard of. Get RTMP/RTMPS right, add SRT, **treat stream keys as fully opaque** (Dailymotion's `x1y2z3?auth=...` is the proof — a validator that rejects `?` in a key breaks it outright), and model `auto-live` vs `explicit-start` vs `scheduled-bound` semantics honestly.
5. **H.264 + AAC over RTMP/RTMPS remains the only safe universal encode.** The binding constraints are LinkedIn's 6 Mbps/1080p30/2 s ceiling, Kick's 8000 kbps CBR cap, and IVS's disconnect-on-breach channel caps. HEVC/AV1 are per-destination Pro-mode opt-ins (YouTube; Twitch Partner/Affiliate; Dolby OptiView). WHIP is real (RFC 9725; Cloudflare GA, IVS real-time) and worth shipping as `EXPERIMENTAL` — **but Twitch is not a usable WHIP target despite appearing on OBS's compatibility list, and Enhanced Broadcasting is Enhanced RTMP multitrack, not WHIP.**
6. **Two platforms are dead and two more are not worth an adapter.** DLive closed (2026-04-27) and Trovo is reported decommissioned (2026-06-30) — a live documentation site is not evidence of a live platform. Rumble and Amazon Live have no usable API, and Bilibili's "open live" platform is for in-room interactive apps, not ingest. **Dailymotion is the one genuinely attractive new adapter** in this survey: real OAuth, API-returned RTMP *and* SRT ingest, behind a commercial plan gate.
