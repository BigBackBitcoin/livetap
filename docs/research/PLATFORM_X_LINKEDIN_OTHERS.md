# PLATFORM RESEARCH — X, LinkedIn, and Secondary Destinations

Team: Platform Integrations 3
Research date: 2026-09-11
Status: COMPLETE (first pass)

**Classification vocabulary** (one per capability, per LIVETAP directive):
`NATIVE API` · `RTMP DESTINATION` · `OAUTH + API` · `USER-ASSISTED` · `PARTNER APPROVAL REQUIRED` · `EXPERIMENTAL` · `UNAVAILABLE`

**Honesty rules applied here**
- Every endpoint, scope and limit below is copied from an official doc that is cited in the Sources section, or explicitly marked `UNVERIFIED`.
- Where a platform's own help pages were unreachable from this environment (HTTP 403 on `help.x.com`), the fact is attributed to a named secondary source and labelled as such.
- No endpoint, scope, or numeric limit in this document was inferred or invented.

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
