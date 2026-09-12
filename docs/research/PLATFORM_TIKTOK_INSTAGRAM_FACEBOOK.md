# LIVETAP Platform Integration Research — TikTok, Instagram, Facebook

> **Research group 2 — Platform Integrations**
> **Research date:** 2026-09-11
> **Scope:** Current official developer capabilities for *going live* on TikTok, Instagram and Facebook.
> **Method:** Official developer documentation first (`developers.tiktok.com`, `developers.facebook.com/docs/live-video-api`, `developers.facebook.com/docs/instagram-platform`), secondary sources only for practical context and explicitly labelled as such.

## Reading this document

Every capability is classified with **exactly one** of the following labels:

| Label | Meaning for LIVETAP |
|---|---|
| `NATIVE API` | A documented, public API call does the thing end-to-end. |
| `RTMP DESTINATION` | LIVETAP only pushes bytes to an ingest URL; no control-plane involvement. |
| `OAUTH + API` | Requires a user OAuth token plus documented API calls. |
| `USER-ASSISTED` | No API; the human must perform a step in the platform's own UI (typically copy a stream key). |
| `PARTNER APPROVAL REQUIRED` | Capability exists but is gated behind a private/partner program, not publicly documented. |
| `EXPERIMENTAL` | Exists but limited/unstable/limited-access. |
| `UNAVAILABLE` | Does not exist, or is not obtainable by a third party. |

`UNVERIFIED` is written anywhere a fact could **not** be confirmed against official documentation during this research pass. **Nothing in this document is an invented endpoint, scope or limit.**

### TL;DR architectural verdict

| Platform | Control plane | Ingest | Practical LIVETAP design |
|---|---|---|---|
| **Facebook** | Full public API (`/live_videos`) | RTMPS, API-issued | **Fully automatable.** OAuth + API. Requires App Review + Business Verification. |
| **Instagram** | **No live API at all** | RTMPS, UI-issued | **USER-ASSISTED only.** User pastes stream key from Live Producer. |
| **TikTok** | **No public live API** | RTMP(S), UI-issued or partner-issued | **USER-ASSISTED only** unless LIVETAP obtains partner access. |

---
---

# 1. FACEBOOK

Facebook is the only one of the three platforms with a **complete, publicly documented live-streaming control-plane API**.

## 1.1 Capability classification table — Facebook

| Capability | Classification | Notes / evidence |
|---|---|---|
| OAuth | `OAUTH + API` | Facebook Login / Facebook Login for Business. Short-lived user token ~1–2 h, long-lived ~60 days. |
| PKCE | `OAUTH + API` | Documented for the **OIDC Code Flow with PKCE** on manually-built login flows (`code_challenge`, `code_challenge_method=S256`, `code_verifier` replaces `client_secret`). See §1.4 caveat — the doc covers the OIDC flow; whether it is officially supported for a *pure Graph API access-token-only* flow is **UNVERIFIED**. |
| Broadcast Creation | `NATIVE API` | `POST /{user-id}/live_videos`, `POST /{page-id}/live_videos`, `POST /{group-id}/live_videos`, `POST /{event-id}/live_videos`. |
| Stream Creation | `NATIVE API` | Same call creates the LiveVideo object and its ingest stream(s). |
| Stream Key retrieval | `NATIVE API` | `secure_stream_url` returned in the create response (RTMPS URL with embedded key). Also `stream_secondary_urls` / `secure_stream_secondary_urls` for backup ingest and `dash_ingest_url`. |
| Start | `NATIVE API` | `status=LIVE_NOW` at create time, or `POST /{live-video-id}?status=LIVE_NOW` to promote an unpublished/scheduled broadcast. Frame-accurate go-live is additionally possible via an `onGoLive` AMF0 RTMP message carrying a timestamp. |
| Stop | `NATIVE API` | `POST /{live-video-id}?end_live_video=true` — ends broadcast and saves it as VOD. |
| Metadata | `NATIVE API` | `title` (max 254 chars), `description`, `privacy`, `content_tags`, `custom_labels`, `targeting`, `donate_button_charity_id` at create; updatable via `POST /{live-video-id}`. |
| Thumbnail | `NATIVE API` (scheduled only, partial) | `schedule_custom_profile_image` is a documented create parameter on `/{user-id}/live_videos`. A general "set thumbnail on a running live video" parameter is **UNVERIFIED**. |
| Chat Read | `NATIVE API` | Polling: `GET /{live-video-id}/comments`. Streaming: `GET /{live-video-id}/live_comments` over Server-Sent Events on host `https://streaming-graph.facebook.com`. |
| Chat Write | `NATIVE API` | `POST /{live-video-id}/comments` — **UNVERIFIED** as a documented edge for live videos specifically; the generic Graph API comment-creation pattern is assumed. Do not ship without re-verifying. |
| Moderation | `NATIVE API` (partial) | A `blocked_users` edge on LiveVideo is referenced in Meta's live-video docs index, but its exact parameters could not be read during this pass → **UNVERIFIED**. Comment delete/hide on live videos: **UNVERIFIED**. |
| Analytics | `NATIVE API` (partial) | `GET /{live-video-id}/reactions`, `GET /{live-video-id}/live_reactions` (SSE), `GET /{live-video-id}/likes`, `GET /{live-video-id}/polls`. Concurrent viewers via a `live_views` field: **UNVERIFIED** (the LiveVideo node reference page was not retrievable — 404 on every doc path tried). |
| Live Status | `NATIVE API` | `status` field; per-input health via the `LiveVideoInputStream` node — `stream_health` (a `LiveVideoStreamHealth` object exposing `video_bitrate`, `video_framerate`, `video_gop_size`, `video_height`, `video_width`), `is_master`, `secure_stream_url`, `stream_url`, `dash_ingest_url`. |
| Scheduling | `NATIVE API` | `status=SCHEDULED_UNPUBLISHED` + `event_params=<UNIX_TIMESTAMP>`; up to **7 days** ahead. **Gotcha:** the Live Video API changelog also records "Scheduling a live video is deprecated for v12.0…" for the *old* scheduling mechanism — see §1.7. |
| Application Review needed | **Yes — `PARTNER APPROVAL REQUIRED`-adjacent** | The **"Live Video API"** App Review *feature* must be approved, **and** it "is only available with business verification", and developers "may need to sign additional contracts". |
| Eligibility gates | Account-level | As of **June 10, 2024**: the Facebook account must be **at least 60 days old**, and the Page or professional-mode profile must have **at least 100 followers**. |
| Regional Restrictions | `UNVERIFIED` | No global region gate documented for the Live Video API. `targeting` lets *you* restrict your own audience by geo/locale/age. |
| Account Restrictions | Yes | Personal profiles need **professional mode** to satisfy the 100-follower rule; Page publishing needs `CREATE_CONTENT` task on the Page (documented for crossposting). |
| Vertical 9:16 support | Supported, not preferred | Official reference **recommends 16:9**. Vertical is not prohibited but is not the documented recommendation. Treat 9:16 as "works, non-optimal" — a dedicated vertical spec is **UNVERIFIED**. |
| RTMPS | `RTMP DESTINATION` — **required** | RTMP was removed Nov 4, 2019; RTMPS mandatory. Ingest host form: `rtmps://rtmp-api.facebook.com/rtmp/<key>`. |
| SRT | `UNAVAILABLE` | Not documented anywhere in the Live Video API. |
| WHIP / WebRTC ingest | `UNAVAILABLE` | Not documented. (A `dash_ingest_url` exists — DASH ingest, not WebRTC.) |

## 1.2 Exact endpoints, scopes and permissions — Facebook

### Create a broadcast

```
POST https://graph.facebook.com/v25.0/me/live_videos?status=LIVE_NOW
POST https://graph.facebook.com/v25.0/{page-id}/live_videos
POST https://graph.facebook.com/v25.0/{group-id}/live_videos
POST https://graph.facebook.com/v25.0/{event-id}/live_videos
```

**Documented `status` enum:** `UNPUBLISHED`, `LIVE_NOW`, `SCHEDULED_UNPUBLISHED`, `SCHEDULED_LIVE`, `SCHEDULED_CANCELED`.
(`published` is deprecated in favour of `status`.)

**Create parameters (Page edge, as documented):**
`title` (≤254 chars), `description`, `status`, `privacy`, `content_tags`, `custom_labels`, `donate_button_charity_id`, `enable_backup_ingest` (bool), `stop_on_delete_stream` (bool), `encoding_settings`, `spatial_audio_format` (`ambiX_4`), `is_spherical`, `projection` (`EQUIRECTANGULAR` | `CUBEMAP` | `HALF_EQUIRECTANGULAR`), `stereoscopic_mode` (`MONO` | `LEFT_RIGHT` | `TOP_BOTTOM` | `MULTI_VIEW`), `fisheye_video_cropped`, `original_fov`, `crossposting_actions`, `targeting`, `game_show`, `event_params`.

**User edge additionally documents:** `front_z_rotation`, `schedule_custom_profile_image`, `published` (deprecated).

**Create response fields:**
`id`, `stream_url`, `secure_stream_url`, `stream_secondary_urls`, `secure_stream_secondary_urls`, `dash_ingest_url`, `dash_ingest_secondary_urls`, `event_id`.

> `GET` on `/{user-id}/live_videos` and `/{page-id}/live_videos` is **not supported** ("You can't perform this operation on this endpoint"). You must track LiveVideo IDs yourself.

### Update / start / stop / delete

```
POST   /{live-video-id}?status=LIVE_NOW             # promote to live
POST   /{live-video-id}?end_live_video=true         # end broadcast, save as VOD
POST   /{live-video-id}?event_params=<UNIX_TS>      # reschedule
POST   /{live-video-id}                             # update title/description/crossposting_actions/...
DELETE /{live-video-id}
```

### Engagement

```
GET  /{live-video-id}/comments        # polling ("every few seconds")
GET  /{live-video-id}/reactions
GET  /{live-video-id}/likes
GET  /{live-video-id}/polls

# Server-Sent Events — host is streaming-graph.facebook.com, NOT graph.facebook.com
GET  https://streaming-graph.facebook.com/{live-video-id}/live_comments
GET  https://streaming-graph.facebook.com/{live-video-id}/live_reactions
```

Comment objects include created timestamp, commenter id + name, message text, and comment id; cursor-based pagination on the polling endpoints.
A `comment_rate` parameter is sometimes cited in the wild — **UNVERIFIED**, the dedicated SSE endpoint reference page could not be retrieved.

### Crossposting

```
POST /{page-id}                                # send / accept crossposting requests
GET  /{page-id}/crosspost_whitelisted_pages    # eligible pages + their crossposting permissions
POST /{live-video-id}?crossposting_actions=... # apply to a LiveVideo
```
`crossposting_actions` action values: `enable_crossposting`, `enable_crossposting_and_create_post`, `disable_crossposting`.

### Backup ingest

Pass `enable_backup_ingest=true` at create. Use `secure_stream_url` for primary and `secure_stream_secondary_urls` for backup.

### Permissions

| Target | Permissions (as documented) |
|---|---|
| User profile / timeline | `publish_video` |
| Page | `pages_manage_posts`, `pages_read_engagement` |
| Crossposting (Facebook Login for Business) | `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `pages_show_list`, `publish_video` — plus `CREATE_CONTENT` task on the Page |
| Groups | `POST /{group-id}/live_videos` is documented as creatable and flagged "a feature requiring App Review"; the exact permission name (e.g. `publish_to_groups`) was **not** stated on that page → **UNVERIFIED** |

`publish_video` — official description: *"publish live videos to an app user's timeline, group, event or Page"*; allowed usage: *"live-video stream to an app user's timeline, event or Page"*. **App Review required.**

### App Review facts

- App Review **feature**: **"Live Video API"** — *"manage live videos to Pages, Groups and User timelines when combined with the correct matching permission."*
- The feature *"is only available with business verification"*, and you *"may need to sign additional contracts before your app can access data."*
- Unapproved permissions can only be requested from users who hold a role on the app — i.e. **without approval, LIVETAP's Facebook support only works for developers/testers of the app.**

## 1.3 Go-live sequence — Facebook (fully automated)

1. **OAuth** the user (Facebook Login for Business recommended for Page targets). Request `publish_video` (+ Page permissions if targeting a Page).
2. Exchange the short-lived token for a **long-lived (~60-day) user token** server-side using the app secret; derive Page tokens from it.
3. If targeting a Page, list assets the client delegated; confirm the user holds `CREATE_CONTENT`.
4. `POST /{target-id}/live_videos` with `status=LIVE_NOW` (or `SCHEDULED_UNPUBLISHED` + `event_params`), `title`, `description`, `privacy`, optional `enable_backup_ingest=true`, optional `crossposting_actions`.
5. Store `id`; push RTMPS to `secure_stream_url` (and the secondary URL if backup enabled).
   - **The stream URL must be used within 24 hours or it expires.**
   - **Once used, a stream URL can be streamed to for up to 8 hours.**
6. While live: poll `GET /{id}/comments` / `reactions`, or hold an SSE connection to `streaming-graph.facebook.com/{id}/live_comments`. Poll the input stream's `stream_health` for bitrate/fps/GOP telemetry.
7. `POST /{id}?end_live_video=true` to finish. Broadcast is saved as VOD.
8. For scheduled broadcasts you can instead promote early with `POST /{id}?status=LIVE_NOW`.

### Encoder settings (from the official Live Video API reference)

| Item | Value |
|---|---|
| Protocol | RTMPS (required) |
| Video codec | H.264 — Level 4.1 up to 1080p30, Level 4.2 for 1080p60 |
| Aspect ratio | 16:9 recommended |
| Keyframe interval | Recommended **2 s**, do not exceed **4 s** |
| 1080p60 | 1920×1080, 4,500–9,000 Kbps |
| 1080p30 | 1920×1080, 3,000–6,000 Kbps |
| 720p60 | 1280×720, 2,250–6,000 Kbps |
| 720p30 | 1280×720, 1,500–4,000 Kbps |
| 480p30 | 854×480, 600–2,000 Kbps |
| 360p | 640×360, 400–1,000 Kbps |
| Audio | AAC-LC, 44.1 or 48 kHz, stereo, 128 Kbps preferred, 256 Kbps max |
| Max duration | **Must not exceed 8 hours** |

## 1.4 OAuth notes — Facebook (desktop and web)

- **Authorization endpoint:** `https://www.facebook.com/v{version}/dialog/oauth` (the PKCE/OIDC doc shows `.../v11.0/dialog/oauth`).
- **Token endpoint:** `/oauth/access_token`.
- **PKCE:** documented under *OIDC Code Flow with PKCE support for manually built Facebook Login flows*. `code_challenge` + `code_challenge_method` (`S256` recommended, `plain` as fallback). At token exchange, **`client_secret` becomes optional and `code_verifier` is required if `client_secret` is omitted.** A `nonce` is required in that flow. The response contains both `id_token` and `access_token`.
  - **Caveat for LIVETAP:** the doc frames this as the OIDC flow. Whether Meta officially supports secret-less PKCE for a plain Graph-API-scope authorization (the thing a desktop app actually needs) is **UNVERIFIED**. Plan for a **hosted callback + server-side token exchange** for desktop; do not ship an app-secret inside the desktop binary.
- **Token lifetimes:** short-lived user token ~1–2 h; long-lived ~60 days; exchange requires a **server-side call with the app secret**. Meta explicitly warns: *"Do not depend on these lifetimes remaining the same."*
- **Facebook Login for Business:** the preferred path for business-tool integrations. Uses saved **configurations** and a **Configuration ID** in place of a raw `scope` parameter; access is explicitly delegated per-asset at authorization time. **Business integration system user access tokens default to never expire** (60-day expiry optionally settable) — attractive for a self-hosted LIVETAP deployment.
- **Desktop pattern for LIVETAP:** loopback redirect → LIVETAP backend performs the code exchange and the long-lived-token exchange → backend holds the app secret. Web pattern: standard server-side code flow.

## 1.5 Chat / moderation / analytics approach — Facebook

- **Chat read: solved.** Prefer the SSE endpoint (`streaming-graph.facebook.com/{id}/live_comments`) for latency; fall back to polling `/{id}/comments` every few seconds.
- **Reactions: solved.** `/{id}/live_reactions` (SSE) or `/{id}/reactions`.
- **Chat write:** treat as **UNVERIFIED** until re-checked against the LiveVideo `comments` edge reference. Build the UI so it degrades to read-only.
- **Moderation:** a `blocked_users` edge is referenced but its contract is **UNVERIFIED**. Assume LIVETAP cannot reliably ban/timeout viewers via API in v1.
- **Analytics:** reactions/likes/polls are readable. Concurrent-viewer count (`live_views`) is **UNVERIFIED** — the LiveVideo node reference page returned 404 on every doc path attempted during this pass (`/docs/graph-api/reference/live-video/`, `/v23.0/live-video/`, `/v25.0/live-video`, `/documentation/...`). **Re-verify this field in the Graph API Explorer before building a viewer-count UI.**
- **Impossible / not documented:** SRT or WebRTC ingest; arbitrary broadcast length beyond 8 h; reusing a stream URL after 24 h; `GET` listing of `/live_videos` on User or Page.

## 1.6 Review / eligibility facts — Facebook

- Account ≥ **60 days old**; Page or professional-mode profile ≥ **100 followers** (effective June 10, 2024).
- App Review approval of the **Live Video API** feature **plus Business Verification** required for use by non-role users.
- `publish_video` requires App Review.
- Without approval, LIVETAP's Facebook destination is usable only by accounts holding a role on the Meta app — acceptable for a self-hosted/open-source model where each operator registers **their own** Meta app, and that is the recommended LIVETAP distribution story.

## 1.7 Gotchas — Facebook

1. **Stream URL TTL (24 h) and broadcast cap (8 h).** Create the LiveVideo close to go-live; do not cache `secure_stream_url` across sessions.
2. **Scheduling contradiction.** The Live Video API changelog states *"Scheduling a live video is deprecated for v12.0 and will be deprecated for all versions on December 14, 2021"* — yet the current scheduling guide documents `status=SCHEDULED_UNPUBLISHED` + `event_params`. Interpretation: the **old** scheduling mechanism (`planned_start_time`-style) was retired and replaced by the `event_params` / Live Online Event mechanism. **Verify against the live Graph API before relying on scheduling.**
3. **Crossposting fails silently.** *"If any crossposting relationships have changed or are invalid, the crossposts will obviously not succeed, but no error will be thrown."* You must read back `crosspost_shared_pages` / `crossposted_broadcasts`.
4. **`overlay_url` removed in v24.0**; returns `null` on v23.0 and older.
5. **RTMP is dead.** RTMPS only since Nov 4, 2019. The **Live Encoder API was deprecated Aug 4, 2021** — do not look for it.
6. **Unpublished broadcasts may be auto-deleted after several hours**; the docs recommend using the scheduled states rather than `UNPUBLISHED` for anything in the future.
7. **`GET` is not supported on the `/live_videos` edges** — persist IDs yourself.
8. **Business Verification is a hard gate** and can take weeks. Surface this in LIVETAP onboarding docs.
9. **16:9 is the documented recommendation.** If LIVETAP's canvas is 9:16 for TikTok/Instagram, Facebook will accept it but you are off the documented spec — offer a per-destination canvas/crop.
10. **Frame-accurate go-live** requires emitting an `onGoLive` AMF0 RTMP message with a timestamp; most off-the-shelf encoders won't. Optional, not required.

## 1.8 Sources — Facebook

- https://developers.facebook.com/docs/live-video-api/
- https://developers.facebook.com/docs/live-video-api/overview/
- https://developers.facebook.com/docs/live-video-api/getting-started/
- https://developers.facebook.com/docs/live-video-api/reference
- https://developers.facebook.com/docs/live-video-api/changelog
- https://developers.facebook.com/docs/live-video-api/guides/streaming/
- https://developers.facebook.com/docs/live-video-api/guides/scheduling
- https://developers.facebook.com/docs/live-video-api/guides/crossposting
- https://developers.facebook.com/docs/live-video-api/guides/interacting/
- https://developers.facebook.com/docs/live-video-api/guides/backup_stream
- https://developers.facebook.com/docs/live-video-api/common-uses/interacting-with-viewers
- https://developers.facebook.com/docs/graph-api/reference/page/live_videos/
- https://developers.facebook.com/docs/graph-api/reference/user/live_videos/
- https://developers.facebook.com/docs/graph-api/reference/group/live_videos
- https://developers.facebook.com/docs/graph-api/reference/live-video-input-stream/
- https://developers.facebook.com/docs/graph-api/server-sent-events/endpoints/live-comments/ (indexed; content not retrievable this pass)
- https://developers.facebook.com/docs/features-reference/live-video-api
- https://developers.facebook.com/docs/permissions/reference/publish_video
- https://developers.facebook.com/docs/app-review/
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens
- https://developers.facebook.com/docs/facebook-login/guides/advanced/oidc-token
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- https://www.facebook.com/help/587160588142067 (consumer Live Producer help; content not retrievable this pass)

---
---

# 2. INSTAGRAM

**Headline finding: there is still no public API to create, start, stop or manage an Instagram Live.** Instagram Platform (2026) documents exactly these products — Instagram API with Instagram Login, Instagram API with Facebook Login for Business, Instagram Messaging via the Messenger API, Sharing to Stories, Sharing to Feed, Embedding. **No live video / broadcast product is listed.**

The *only* live-related API surfaces are **read-only**:
- `GET /{ig-user-id}/live_media` — collection of live IG Media, **only while broadcasting**; *"Creating … not supported."*
- `live_comments` **webhook** field — *"Notifications for Comments on Live media are only sent during the live broadcast."*

Going live from a desktop encoder is therefore a **USER-ASSISTED** flow through **Instagram Live Producer** on `instagram.com`.

## 2.1 Capability classification table — Instagram

| Capability | Classification | Notes / evidence |
|---|---|---|
| OAuth | `OAUTH + API` | Instagram Business Login (`instagram.com/oauth/authorize`) or Facebook Login for Business. Useful for chat/insights only — **not** for going live. |
| PKCE | `UNAVAILABLE` / `UNVERIFIED` | The Instagram business-login doc lists `client_id`, `redirect_uri`, `response_type=code`, `scope` only; PKCE is **not mentioned**. Token exchange requires `client_secret`. Treat PKCE as unsupported for Instagram Login. |
| Broadcast Creation | `UNAVAILABLE` | No endpoint exists. `live_media` explicitly: creating not supported. |
| Stream Creation | `UNAVAILABLE` | — |
| Stream Key retrieval | `USER-ASSISTED` | Human copies server URL + stream key from Live Producer on `instagram.com`. Key **refreshes every session** — *"The stream key is not static, and will refresh each time you use Live Producer."* |
| Start | `USER-ASSISTED` | Instagram detects the incoming stream; the user presses **Go live** in Live Producer. |
| Stop | `USER-ASSISTED` | Ended in Live Producer (or by stopping the stream). No API. |
| Metadata | `USER-ASSISTED` | Title and audience are typed into the Live Producer UI before the key is issued. No API. |
| Thumbnail | `UNAVAILABLE` | Not offered by Live Producer or any API. |
| Chat Read | `OAUTH + API` (webhook) | `live_comments` webhook field delivers comments **only during the broadcast**. Also readable in the Live Producer UI itself. |
| Chat Write | `OAUTH + API` (likely; `UNVERIFIED` for live) | `POST /{ig-comment-id}/replies` exists for IG Media comments with `instagram_business_manage_comments`. Whether it accepts live-media comment IDs is **UNVERIFIED**. Live Producer lets the *broadcaster* read and respond to comments in the web UI. |
| Moderation | `UNAVAILABLE` during live | Official Live Producer post: *"Moderation is not supported by Live Producer at this time."* The comment-moderation API (`POST /{ig-comment-id}` hide/unhide, `DELETE /{ig-comment-id}`) is documented for IG Media; applicability to live comments is **UNVERIFIED**, and the IG Media reference states **"Live video Instagram Media not supported"** for the POST/enable-comments operation. |
| Analytics | `UNAVAILABLE` for live | No live-specific insights metric documented. Media Insights exist for normal media. Concurrent viewer count via API: **UNAVAILABLE**. |
| Live Status | `NATIVE API` (read-only, weak) | `GET /{ig-user-id}/live_media` returns *only* media being broadcast at request time — usable as a crude "am I live?" probe. Requires `instagram_basic` + `pages_read_engagement` (+ `ads_management` or `ads_read` if the user has a Business Manager role on the connected Page). |
| Scheduling | `UNAVAILABLE` via API | Instagram supports scheduling a Live in its own UI (secondary sources); no API. |
| Application Review needed | Yes, for the read APIs | Standard Meta App Review for Instagram permissions. **Not applicable to going live at all** — because going live has no API. |
| Eligibility gates | Yes, hard | **Public account with ≥1,000 followers required to create/schedule a Live** (rolled out Aug 2025; Meta confirmed to press, Help Centre updated; in-app notice: *"Only public accounts with 1,000 followers or more will be able to create live videos."*). Live Producer itself is described by Instagram as **"limited access at this time."** Professional (business/creator) account requirement for Live Producer is widely reported but **UNVERIFIED** against an official page. |
| Regional Restrictions | `UNVERIFIED` | None documented. |
| Account Restrictions | Yes | Public account required; private accounts cannot go live under the 2025 rule. |
| Vertical 9:16 support | Yes — the native format | Official Instagram Live Producer post: **"9x16 aspect ratio (recommended but not required)"**, **720×1280**, 30 fps (60 fps also supported). |
| RTMPS | `RTMP DESTINATION` | Live Producer issues a server URL + stream key for third-party encoders (OBS, Streamlabs, etc.). Exact scheme (rtmp vs rtmps) is **UNVERIFIED** from official docs — read it from the UI at runtime rather than hard-coding. |
| SRT | `UNAVAILABLE` | Not documented. |
| WHIP / WebRTC ingest | `UNAVAILABLE` | Not documented. |

## 2.2 Exact endpoints and scopes — Instagram

### Live-related (read-only)

```
GET /{ig-user-id}/live_media          # only currently-broadcasting live media; supports since/until
                                      # fields: id, media_type, media_product_type, owner, username, comments, ...
                                      # Creating: NOT SUPPORTED
```
Permissions: `instagram_basic`, `pages_read_engagement` (+ `ads_management` **or** `ads_read` if the app user has a Business Manager role on the connected Page). — This is the **Instagram API with Facebook Login** variant.

**Webhook fields available on Instagram Platform:** `comments`, **`live_comments`**, `mentions`, `message_echoes`, `message_reactions`, `messages`, `messaging_handover`, `messaging_optins`, `messaging_policy_enforcement`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `response_feedback`, `standby`, `story_insights`.
`live_comments`: *"Notifications for Comments on Live media are only sent during the live broadcast."*

### Comment moderation (normal media; live applicability UNVERIFIED)

```
GET    /{ig-media-id}/comments
GET    /{ig-comment-id}/replies
POST   /{ig-comment-id}/replies        # reply
POST   /{ig-comment-id}                # hide / unhide
POST   /{ig-media-id}                  # enable / disable comments  <-- "Live video Instagram Media not supported"
DELETE /{ig-comment-id}                # delete
```

**Scopes — Instagram Login:** `instagram_business_basic`, `instagram_business_manage_comments`.
**Permissions — Facebook Login:** `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement` (+ `ads_management` / `ads_read` if Page role).

**Full Instagram Login scope set documented:** `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `instagram_business_manage_comments`. (Media Insights are noted as available; an `instagram_business_manage_insights` scope name was **not** confirmed on that page → **UNVERIFIED**.)

## 2.3 OAuth notes — Instagram (desktop and web)

**Instagram Business Login (Instagram Login flavour):**

```
Authorize:      https://www.instagram.com/oauth/authorize
                ?client_id=<INSTAGRAM_APP_ID>&redirect_uri=<URI>&response_type=code&scope=<CSV or space-encoded>
Token:          POST https://api.instagram.com/oauth/access_token
                client_id, client_secret, grant_type=authorization_code, redirect_uri, code
Long-lived:     GET  https://graph.instagram.com/access_token      -> 60 days
Refresh:        GET  https://graph.instagram.com/refresh_access_token
                requires token ≥24h old, still valid, and instagram_business_basic granted
                unrefreshed tokens expire after 60 days
```

- **No PKCE** documented → a desktop client must route the code exchange through a LIVETAP backend holding `client_secret`. Never embed the secret in a desktop build.
- **Alternative:** Facebook Login for Business with Instagram permissions, which gets you Facebook's token model (and possibly never-expiring system user tokens) — see §1.4.
- **Reminder:** none of this authorizes going live. It authorizes reading live comments and probing live status.

## 2.4 Go-live sequence — Instagram (USER-ASSISTED)

**Exact UI path (from Instagram's official Live Producer post):**

1. Open **`instagram.com`** in a desktop browser (mobile web/app does not offer Live Producer).
2. Click the **"Add post"** button — the plus symbol inside a square.
3. Select **"Live"**.
4. On the **"Go live"** screen, enter the **title** of the live video and select the **audience**.
5. Instagram displays a screen containing **your unique URL and stream key**, with instructions. You can **copy the stream key** or **reset it** if you need a new one.

**LIVETAP flow:**

6. User pastes **server URL** and **stream key** into LIVETAP's Instagram destination form. LIVETAP must treat these as **single-use, per-session credentials** — never persist and reuse them; prompt for a fresh key on every broadcast.
7. LIVETAP starts pushing to that ingest URL.
8. Once Instagram detects the stream, the **user presses "Go live" in Live Producer** (LIVETAP cannot).
9. Comments can be read and answered **inside Live Producer** by the broadcaster; LIVETAP can additionally surface them via the `live_comments` webhook if the user has connected OAuth.
10. The user ends the live **in Live Producer**.

**Recommended encoder settings (official Instagram Live Producer post):**

| Item | Value |
|---|---|
| Aspect ratio | **9×16 — recommended but not required** |
| Resolution / fps | **720×1280 @ 30 fps** (60 fps also supported) |
| Video bitrate | **2,250–6,000 Kbps** |
| Audio | **44.1 kHz, stereo, up to 256 Kbps** |
| Max duration | Not stated in official docs → **UNVERIFIED** |

## 2.5 Chat / moderation / analytics approach — Instagram

- **Chat read:** subscribe to the `live_comments` webhook field (requires OAuth + the comments permission + App Review). Comments arrive only during the broadcast. There is **no backfill** — if your webhook receiver is down you lose that window.
- **Chat write:** only reliably possible **inside Live Producer's own UI**. API reply on a live comment is **UNVERIFIED** — ship read-only and mark reply as best-effort.
- **Moderation: impossible.** Official statement: *"Moderation is not supported by Live Producer at this time."* Plus IG Media's *"Live video Instagram Media not supported"* for the comment-enable POST.
- **Analytics: impossible for live.** No viewer count, no live insights metric. LIVETAP must show "not available on Instagram".
- **Also explicitly unsupported by Live Producer:** Live Rooms, Shopping, Fundraisers, Q&A.
- **Other things LIVETAP cannot do on Instagram:** create/start/stop/schedule a live, set a title after the key is issued, set a thumbnail, obtain a persistent stream key, obtain a stream key headlessly, or detect stream health.

## 2.6 Review / eligibility facts — Instagram

- **≥1,000 followers and a public account** to create or schedule a Live (rolled out from Aug 2025; Meta-confirmed; the in-app notice reads *"We changed the requirements to use this feature. Only public accounts with 1,000 followers or more will be able to create live videos."*). **Source class: secondary (TechCrunch/Engadget/eMarketer reporting Meta's confirmation + Help Centre update).**
- **Live Producer is described by Instagram as "limited access at this time."** Availability can therefore differ per account — LIVETAP must handle "user has no Live option" gracefully.
- Business/creator (professional) account requirement for Live Producer: widely reported, **UNVERIFIED** officially.
- App Review applies only to the Instagram read/comment APIs, not to going live.
- Instagram Platform changelog 2025–2026 contains **no live-video entries** — status quo holds.

## 2.7 Gotchas — Instagram

1. **The stream key rotates every session.** Any LIVETAP UX that stores "your Instagram stream key" will break. Design for paste-per-broadcast, with an explicit "get a new key" link to `instagram.com`.
2. **The human must press Go live.** LIVETAP's "start all destinations" button cannot be fully atomic when Instagram is in the mix. Show Instagram as "awaiting user confirmation in Live Producer".
3. **No API to end the stream** — if LIVETAP stops pushing, Instagram will end it, but the user should close Live Producer.
4. **Live Producer is desktop-web only.** Do not document a mobile path.
5. **`live_media` returns nothing when not broadcasting** — it is not a history endpoint, and it is not a reliable "did my broadcast start" signal for a stream LIVETAP just started (propagation delay is **UNVERIFIED**).
6. **Two different Instagram API flavours.** `live_media` is documented under the Facebook-Login (`instagram-graph-api`) doc tree with `instagram_basic`/`pages_read_engagement`; the newer Instagram-Login flavour uses `instagram_business_*` scopes and **does not** document `live_media`. Pick a flavour deliberately.
7. **Old scope names were deprecated 27 Jan 2025** (`business_basic` → `instagram_business_basic`); Instagram v1.0 endpoints deprecated with a **20 May 2025** migration deadline. Don't copy old tutorials.
8. **No PKCE** — desktop builds need a backend for token exchange.
9. **Assume the RTMP scheme from the UI**, not from a constant. Instagram has changed ingest hostnames without developer-facing notice.

## 2.8 Sources — Instagram

- https://developers.facebook.com/docs/instagram-platform
- https://developers.facebook.com/docs/instagram-platform/overview/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/live_media/
- https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/
- https://developers.facebook.com/docs/instagram-platform/webhooks
- https://developers.facebook.com/docs/instagram-platform/comment-moderation
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- https://developers.facebook.com/docs/instagram-platform/changelog/
- https://about.instagram.com/blog/tips-and-tricks/instagram-live-producer  *(official Instagram — the authoritative Live Producer source: UI path, key rotation, 9×16, 720×1280, 2,250–6,000 Kbps, "Moderation is not supported", "limited access at this time")*
- Secondary (eligibility, 2025 rule): https://techcrunch.com/2025/08/01/instagram-now-requires-users-to-have-at-least-1000-followers-to-go-live/ , https://www.engadget.com/apps/instagram-public-accounts-with-less-than-1000-followers-can-no-longer-go-live-133049758.html , https://www.emarketer.com/content/instagram-prohibits-creators-with-under-1-000-followers-going-live
- Secondary (practical Live Producer usage): https://streamlabs.com/content-hub/post/how-to-stream-instagram-live-producer-with-streamlabs-desktop , https://support.streamyard.com/hc/en-us/articles/360043298812-Create-an-Instagram-Live-Video

---
---

# 3. TIKTOK

**Headline finding: there is no public TikTok LIVE API for third parties.** Nothing in TikTok's developer platform creates a live session, returns a stream key, or reads live chat.

**Evidence (all from `developers.tiktok.com`):**
- The **developer product list** is: Login Kit, Content Posting API, Share Kit, Display API, Research API, Commercial Content API, Data Portability API, Embed Videos, Green Screen Kit, Mini Games, Mini Dramas, Webhooks, TikTok GO. **No live-streaming product.**
- The **API scopes reference** contains `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.upload`, `video.publish`, `local.product.manage`, `local.shop.manage`, `local.voucher.manage`, portability scopes, `research.data.basic`, `research.data.u18eu`, `research.data.vra`. **No live-streaming scope of any kind.**
- **Webhook events** are: `authorization.removed`, `video.upload.failed`, `video.publish.completed`, `portability.download.ready`. **No live events.**
- The **Content Posting API** posts **videos and photos only** — it is an upload API, **not** live.

Therefore: **TikTok LIVE from LIVETAP is `USER-ASSISTED` (stream-key paste), or `PARTNER APPROVAL REQUIRED` for anything better.**

## 3.1 Capability classification table — TikTok

| Capability | Classification | Notes / evidence |
|---|---|---|
| OAuth | `OAUTH + API` | Login Kit. `https://www.tiktok.com/v2/auth/authorize/` → `POST https://open.tiktokapis.com/v2/oauth/token/`. Gives identity/video scopes only — **no live capability**. |
| PKCE | `OAUTH + API` — **required for desktop** | *"PKCE is required for mobile and desktop applications."* `code_challenge` + `code_challenge_method=S256`. **Non-standard: TikTok requires the SHA-256 of the verifier in *hex* encoding, not base64url.** Verifier: unreserved chars `[A-Z][a-z][0-9]-._~`, 43–128 chars, new one per request. |
| Broadcast Creation | `UNAVAILABLE` (publicly) / `PARTNER APPROVAL REQUIRED` | No public endpoint. Streamlabs Desktop can go live to TikTok **without a stream key** after an approved application — proof a private control-plane exists, unavailable publicly. |
| Stream Creation | same as above | — |
| Stream Key retrieval | `USER-ASSISTED` (public) / `PARTNER APPROVAL REQUIRED` (programmatic) | User copies Server URL + Stream key from TikTok's web LIVE producer / TikTok LIVE Studio. A new key is issued each time you go live. |
| Start | `USER-ASSISTED` | User presses **Go LIVE** in TikTok's UI. |
| Stop | `USER-ASSISTED` | Ended in TikTok's UI. No API. |
| Metadata | `USER-ASSISTED` | Title + category entered in TikTok's UI before the key is issued. No API. |
| Thumbnail | `UNAVAILABLE` | Not documented. |
| Chat Read | `UNAVAILABLE` officially / `EXPERIMENTAL` unofficially | No API, no webhook. Unofficial reverse-engineered Webcast clients exist — see §3.7, **ToS risk**. |
| Chat Write | `UNAVAILABLE` | No API. Unofficial libraries are read-only by design. |
| Moderation | `UNAVAILABLE` | No API. |
| Analytics | `UNAVAILABLE` for live | `user.info.stats` gives follower/like counts on the profile, not live metrics. No live viewer count, no gift/diamond API. |
| Live Status | `UNAVAILABLE` | No documented way to ask "is this user live?". |
| Scheduling | `UNAVAILABLE` via API | TikTok's UI has scheduling features; no API. |
| Application Review needed | Yes, for everything | Login Kit apps are reviewed; **Content Posting API clients must pass an audit** — *"All content posted by unaudited clients will be restricted to private viewing mode."* Live access is a separate, non-public gate. |
| Eligibility gates | Yes, hard (creator-side) | Commonly documented: **≥1,000 followers** for LIVE access; **18+** for the PC/stream-key path and for gifts; account in good standing; LIVE Studio also cited as needing an account ≥30 days old. **All of these are secondary-source; TikTok's own help pages returned navigation-only content and could not be quoted → UNVERIFIED officially.** TikTok's LIVE Studio FAQ does officially say *"access requirements may vary depending on your country/region."* |
| Regional Restrictions | Yes | Official LIVE Studio FAQ: *"access requirements may vary depending on your country/region."* |
| Account Restrictions | Yes | Good standing / no recent Community Guidelines violations (secondary). No LIVE access ⇒ **no stream key exists at all**. |
| Vertical 9:16 support | Yes — the native format | 1080×1920 / 720×1280 portrait. Landscape 16:9 is accepted but the mobile player letterboxes/pillarboxes it. |
| RTMPS | `RTMP DESTINATION` | RTMP/RTMPS server URL + key from the UI. Whether the issued URL is `rtmp://` or `rtmps://` varies → **read it from the UI, do not hard-code**. |
| SRT | `UNAVAILABLE` | Not documented. |
| WHIP / WebRTC ingest | `UNAVAILABLE` | Not documented. |

## 3.2 Exact endpoints and scopes — TikTok

### What exists (and is irrelevant to live)

```
# Login Kit — desktop
GET  https://www.tiktok.com/v2/auth/authorize/
     ?client_key=&scope=&redirect_uri=&state=&response_type=code
     &code_challenge=&code_challenge_method=S256
# response params: code, scopes, state, error, error_description

POST https://open.tiktokapis.com/v2/oauth/token/      # grant_type=authorization_code | refresh_token
     # access_token valid 24h (86400s); refresh_token valid 365 days

# Content Posting API (VIDEO/PHOTO UPLOAD — NOT LIVE)
POST https://open.tiktokapis.com/v2/post/publish/video/init/
PUT  <upload_url returned by init>
POST https://open.tiktokapis.com/v2/post/publish/content/init/     # photos
GET  https://open.tiktokapis.com/v2/post/publish/status/fetch/
POST https://open.tiktokapis.com/v2/post/publish/creator_info/query/
# scope: video.publish (app-level approval + user authorization) | video.upload (draft only)
```

**Scopes (complete, from the official scopes reference):** `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.upload`, `video.publish`, `local.product.manage`, `local.shop.manage`, `local.voucher.manage`, data-portability scopes (ongoing/single, activity/DM/posts/profile), `research.data.basic`, `research.data.u18eu`, `research.data.vra`.
**There is no live scope.**

**Webhook events (complete):** `authorization.removed`, `video.upload.failed`, `video.publish.completed`, `portability.download.ready`.
**There is no live event.**

### What does NOT exist

There is **no** `POST /v2/live/...`, no "TikTok Live Server API", no stream-key endpoint, no live-chat endpoint in TikTok's public developer documentation. **Do not implement against any such path.** Any blog or SDK claiming one is either describing a partner-only surface or reverse-engineered internals.

## 3.3 OAuth notes — TikTok (desktop and web)

**Desktop (the LIVETAP-relevant case):**
- Authorize at `https://www.tiktok.com/v2/auth/authorize/`.
- **PKCE mandatory.** `code_challenge_method=S256`, and the challenge is the **hex-encoded SHA-256** of the verifier (TikTok's documented deviation from RFC 7636's base64url). Generate a fresh verifier per authorization request; 43–128 chars from `[A-Z] [a-z] [0-9] - . _ ~`.
- **Redirect URI rules for desktop apps:** host must be `localhost` or loopback `127.0.0.1`; a **port is required** (wildcard `*` port allowed); `http` or `https`; **no query parameters or fragments**; **max 10 URIs per app**, each **< 512 chars**.
- Token: `POST https://open.tiktokapis.com/v2/oauth/token/` with `code` + `code_verifier`. **Access token valid 24 h; refresh token valid 365 days**; refresh via `grant_type=refresh_token` from a background job, no user interaction.

**Web:** standard server-side code flow (see Login Kit for Web). PKCE is described as required for mobile/desktop; for web it is optional per the docs (**web-PKCE status: UNVERIFIED**).

**LIVETAP implication:** TikTok's desktop OAuth story is genuinely good — loopback + PKCE means **no client secret in the desktop binary**. It is just useless for live, so only implement it if LIVETAP also wants TikTok VOD publishing (repurposing recorded broadcasts via `video.publish`), which is a real and worthwhile adjacent feature.

## 3.4 Go-live sequence — TikTok (USER-ASSISTED)

**UI path A — TikTok web LIVE producer (the one to document; secondary-sourced):**

1. Sign in to TikTok in a desktop browser.
2. Click **"Go LIVE"** in the left navigation — this lands on **`livecenter.tiktok.com/producer`**.
3. Scroll to the bottom and click the red **"Go LIVE"** button.
4. Choose a **category** and **title**, then **"Save & Go LIVE"**.
5. At the bottom of the live dashboard, TikTok shows the **Server URL** and **Stream key**.
6. User pastes both into LIVETAP's TikTok destination form.
7. LIVETAP pushes RTMP(S). The user confirms/goes live and ends the stream in TikTok's dashboard.

> **Source class:** TikTok's own help articles served navigation-only HTML to every fetch attempted in this pass. The `livecenter.tiktok.com/producer` path is corroborated by multiple independent third-party guides (Restream, Castr, BIGVU, Streamlabs) but is **UNVERIFIED against an official TikTok page**. Ship it as guidance with a "if the UI has changed, look for 'Go LIVE with third-party tools'" fallback note.

**UI path B — TikTok LIVE Studio (desktop app):**
- Official download: `https://www.tiktok.com/studio/download`. Windows **64-bit Windows 10 or newer**; the LIVE Studio FAQ states it is **available for both macOS and Windows**.
- LIVE Studio is TikTok's *own* encoder — a **competitor** to LIVETAP's job, not a path for LIVETAP. Its value here is that it exposes the "Go LIVE with third-party tools" / stream-key option for creators who have it.
- TikTok explicitly states it does not penalise third-party encoders: *"we will not alter your traffic due to your use of specific streaming tools such as LIVE Studio or OBS."* Useful reassurance to put in LIVETAP's docs.
- The FAQ mentions a trial period requiring **"at least 25 minutes, twice during your first week."**

**UI path C — partner-native (not available to LIVETAP today):**
- Streamlabs Desktop can go live to TikTok **"eliminating the need for a stream key"** after the creator **applies for TikTok Live integration access through Streamlabs Desktop** and is accepted. Streamlabs also notes some creators get RTMP-destination access rather than native access.
- This confirms a **partner-only TikTok live control plane** exists. LIVETAP would need a direct commercial/partner relationship with TikTok to get it; **nothing about it is publicly documented**, so it cannot be designed against.

**Encoder settings (secondary sources; no official TikTok encoder spec page was retrievable):**

| Item | Value (secondary) |
|---|---|
| Orientation | **Vertical 9:16 strongly preferred** (1080×1920 or 720×1280). Landscape 16:9 is accepted but letterboxed in the mobile player. |
| Frame rate | **30 fps.** Multiple sources state viewer playback is capped at 30 fps, making 60 fps wasted bitrate — **UNVERIFIED officially.** |
| Video bitrate | ~2,000–4,500 Kbps typical; up to 6,000 Kbps cited. Above ~5,000 Kbps reportedly gives no benefit because TikTok re-encodes — **UNVERIFIED officially.** |
| Codec / audio | H.264; audio 160–256 Kbps (secondary). |
| Max duration | **UNVERIFIED.** |

**LIVETAP default recommendation:** 1080×1920, 30 fps, H.264, ~4,000 Kbps video, 128–160 Kbps AAC, 2 s keyframe interval — and make it user-overridable, since none of it is officially specified.

## 3.5 Chat / moderation / analytics approach — TikTok

- **Officially: nothing is possible.** No live chat read, no write, no moderation, no viewer count, no gift events, no live status.
- **Unofficially:** reverse-engineered clients (see §3.7) can read chat, gifts, likes, follows, viewer counts and battles from a *public* live room without login.
- **LIVETAP recommendation:** ship TikTok with **no chat integration in core**. If unified chat across platforms is a headline feature, TikTok must be either absent or an explicitly-labelled, **opt-in, off-by-default, clearly-warned plugin** the user installs themselves — not a bundled default. See the ToS analysis below.

## 3.6 Review / eligibility facts — TikTok

- **Developer-side:** Login Kit apps go through TikTok's app review. Content Posting API clients must pass an **audit**; unaudited clients' posts are forced to **private** visibility. There is **no published application process for live access** — a LIVETAP operator cannot self-serve into it.
- **Creator-side (secondary, consistently reported):** ≥1,000 followers for LIVE access; 18+ for the PC/stream-key path and for receiving gifts (some sources say 16+ to start a basic live — **contradictory, treat as UNVERIFIED**); account in good standing; LIVE Studio commonly cited as needing an account ≥30 days old.
- **Official and quotable:** LIVE Studio *"access requirements may vary depending on your country/region."*
- **Hard consequence:** if the creator has no LIVE access, **no stream key exists** — no amount of UI navigation produces one. LIVETAP's error copy must say this plainly rather than implying a LIVETAP bug.

## 3.7 Gotchas — TikTok, including ToS risk of unofficial methods

1. **Unofficial chat scrapers are a real legal and stability risk.** `TikTok-Live-Connector` (Node.js; ports exist for Python, Java, Go, C#) reads chat/gifts/likes/follows/viewer counts by **reverse-engineering TikTok's internal Webcast push service**. The project itself states it is *"**not** a production-ready API. It is a reverse engineering project"*, is **not affiliated with ByteDance**, and that **TikTok can change the Webcast protocol without notice**, breaking it.
   - **It requires a third-party signing service.** WebSocket URL signing is delegated to **Euler Stream**'s sign server; free community rate limits apply, with paid keys for more volume. That means: (a) an external dependency in your live path, (b) **traffic metadata about your users flowing to a third party**, (c) rate limits you do not control.
   - **Licensing:** modified **AGPL** — derivative works must stay open source. For LIVETAP (open source) that may be acceptable, but it is a real licence-compatibility question for anyone who forks LIVETAP commercially.
   - **ToS risk:** accessing TikTok's internal endpoints is outside TikTok's published developer terms. Risk lands on the **creator's account**, not on LIVETAP. Bundling it by default would export legal risk onto users.
   - **Verdict: do NOT bundle. Do NOT enable by default. Label as unofficial, unsupported, ToS-risky, and user-installed.**
2. **"TikTok stream key generator" tools are worse.** Projects like `Loukious/TikTokStreamKeyGenerator` and `StreamLabsTikTokStreamKeyGenerator` obtain stream keys by driving TikTok's or Streamlabs' private endpoints (the latter still requires Streamlabs TikTok LIVE access). These impersonate first-party/partner clients. **Do not ship, vendor, or link these from LIVETAP as a supported path** — they are account-ban and API-abuse territory. Mention them, if at all, only in a "why we don't do this" note.
3. **Stream keys are single-use.** A new key per live session. Never persist "the user's TikTok stream key".
4. **No LIVE access ⇒ no key.** Refreshing the page forever will not produce one.
5. **Vertical is the platform.** LIVETAP should default TikTok to a 9:16 canvas and warn loudly on 16:9.
6. **Do not confuse TikTok's products.** Content Posting API = upload; Display API = read public videos; Research API = academic, gated; Data Portability = user exports. None of them touch live. The *only* legitimate TikTok live surface for a third-party encoder is "paste the stream key".
7. **PKCE hex quirk.** If you reuse a generic OAuth library for TikTok, base64url-encoding the SHA-256 will fail. TikTok documents **hex**.
8. **Partner asymmetry is a competitive fact, not a bug.** Streamlabs/Restream having keyless TikTok go-live while LIVETAP does not is a **partner-access** difference. Document it honestly in LIVETAP's README so users don't file bugs about it.

## 3.8 Sources — TikTok

**Official (`developers.tiktok.com` / `tiktok.com`):**
- https://developers.tiktok.com/doc/overview/ — full product list; **no live product**
- https://developers.tiktok.com/doc/tiktok-api-scopes/ — full scope list; **no live scope**
- https://developers.tiktok.com/doc/webhooks-overview/ and https://developers.tiktok.com/doc/webhooks-events/ — 4 events; **no live event**
- https://developers.tiktok.com/doc/content-posting-api-get-started/ — video/photo upload only; audit requirement
- https://developers.tiktok.com/doc/oauth-user-access-token-management/ — token endpoint, 24 h access / 365 d refresh, PKCE required for mobile+desktop
- https://developers.tiktok.com/doc/login-kit-desktop/ — desktop authorize URL, PKCE hex-SHA256, `code_challenge_method=S256`, loopback redirect rules
- https://developers.tiktok.com/doc/login-kit-overview/
- https://www.tiktok.com/live/studio/help/article/FAQ/FAQ — LIVE Studio FAQ: macOS+Windows, region-varying access requirements, OBS not penalised, trial period
- https://www.tiktok.com/studio/download — official LIVE Studio download, 64-bit Windows 10+

**Official but not retrievable in this pass (navigation-only HTML) — re-verify manually:**
- https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/going-live
- https://livecenter.tiktok.com/help_center/article/1023/tiktok-live-studio-operation-manual_en-US
- https://www.tiktok.com/live/creators/en-US/article/configure-live-settings-in-live-studio-en-US

**Secondary (practical context, explicitly labelled):**
- https://support.streamlabs.com/hc/en-us/articles/24730717904795-Streamlabs-Announces-Integration-With-TikTok — keyless native TikTok go-live after approved application (403 to automated fetch; content via search excerpt)
- https://restream.io/learn/platforms/how-to-find-tiktok-stream-key/ , https://castr.com/blog/how-to-get-a-tiktok-stream-key/ , https://bigvu.tv/blog/how-to-get-a-tiktok-stream-key/ , https://streamlabs.com/content-hub/post/how-to-go-live-on-tiktok — `livecenter.tiktok.com/producer` UI path, eligibility
- https://streamersize.com/blog/best-tiktok-live-settings/ , https://sociallyin.com/resources/tiktok-livestream-requirements/ — encoder settings, requirements

**Unofficial / ToS-risky (documented as risk, NOT as an integration path):**
- https://github.com/zerodytrash/TikTok-Live-Connector — reverse-engineered Webcast chat reader; Euler Stream sign server; modified AGPL; self-declared "not production-ready"
- https://github.com/Loukious/TikTokStreamKeyGenerator and https://github.com/Loukious/StreamLabsTikTokStreamKeyGenerator — private-endpoint stream-key extraction; **do not use**

---
---

# 4. Cross-platform summary for LIVETAP engineering

## 4.1 Capability matrix at a glance

| Capability | Facebook | Instagram | TikTok |
|---|---|---|---|
| OAuth | `OAUTH + API` | `OAUTH + API` | `OAUTH + API` |
| PKCE | `OAUTH + API` (OIDC flow; Graph-only UNVERIFIED) | `UNAVAILABLE` | `OAUTH + API` (required, **hex** S256) |
| Broadcast Creation | `NATIVE API` | `UNAVAILABLE` | `UNAVAILABLE` / `PARTNER APPROVAL REQUIRED` |
| Stream Creation | `NATIVE API` | `UNAVAILABLE` | `UNAVAILABLE` / `PARTNER APPROVAL REQUIRED` |
| Stream Key retrieval | `NATIVE API` | `USER-ASSISTED` | `USER-ASSISTED` / `PARTNER APPROVAL REQUIRED` |
| Start | `NATIVE API` | `USER-ASSISTED` | `USER-ASSISTED` |
| Stop | `NATIVE API` | `USER-ASSISTED` | `USER-ASSISTED` |
| Metadata | `NATIVE API` | `USER-ASSISTED` | `USER-ASSISTED` |
| Thumbnail | `NATIVE API` (scheduled) | `UNAVAILABLE` | `UNAVAILABLE` |
| Chat Read | `NATIVE API` (SSE) | `OAUTH + API` (webhook, live-only) | `UNAVAILABLE` / `EXPERIMENTAL` unofficial |
| Chat Write | `NATIVE API` (UNVERIFIED) | `OAUTH + API` (UNVERIFIED for live) | `UNAVAILABLE` |
| Moderation | `NATIVE API` (partial, UNVERIFIED) | `UNAVAILABLE` | `UNAVAILABLE` |
| Analytics | `NATIVE API` (partial) | `UNAVAILABLE` | `UNAVAILABLE` |
| Live Status | `NATIVE API` | `NATIVE API` (read-only, weak) | `UNAVAILABLE` |
| Scheduling | `NATIVE API` | `UNAVAILABLE` | `UNAVAILABLE` |
| App Review needed | **Yes** (+ Business Verification) | Yes (read APIs only) | Yes (audit); live gate not public |
| Eligibility gates | 60-day account, 100 followers | Public acct, 1,000 followers | ~1,000 followers, 18+ (secondary) |
| Regional Restrictions | `UNVERIFIED` | `UNVERIFIED` | **Yes** (official: varies by region) |
| Account Restrictions | Professional mode / Page task | Public account required | Good standing; LIVE access |
| Vertical 9:16 | Works, 16:9 recommended | **Native (9×16)** | **Native (9:16)** |
| RTMPS | **Required** | Yes (`RTMP DESTINATION`) | Yes (`RTMP DESTINATION`) |
| SRT | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` |
| WHIP / WebRTC | `UNAVAILABLE` | `UNAVAILABLE` | `UNAVAILABLE` |

## 4.2 Design consequences

1. **LIVETAP needs two destination archetypes**, not one:
   - **Managed destination** (Facebook, and YouTube/Twitch per other research groups): OAuth, API-created broadcast, API-issued ingest, API start/stop, API chat.
   - **Manual destination** (Instagram, TikTok): a "paste server URL + stream key" form, flagged **single-use**, with a deep link to the platform UI and inline instructions, plus an explicit "the platform's own UI must confirm go-live" state in the multistream dashboard.
2. **The go-live state machine must tolerate non-atomic starts.** Facebook starts on an API call; Instagram and TikTok start when a human clicks in another window. Model per-destination states: `awaiting_key`, `key_entered`, `pushing`, `awaiting_user_confirmation`, `live`, `ended`.
3. **Never persist Instagram or TikTok stream keys.** Both rotate per session. Store nothing; prompt every broadcast. Redact from logs.
4. **No SRT, no WHIP, no WebRTC ingest on any of the three.** RTMP(S) push is the whole story. Don't build ingest abstraction for protocols nobody accepts.
5. **Canvas strategy:** 9:16 is native for Instagram and TikTok; Facebook documents 16:9. Support per-destination framing (or a 9:16 master with a 16:9 safe-area/letterbox option for Facebook).
6. **Unified chat is structurally impossible across all three.** Facebook: good. Instagram: read-only, live-window-only, no moderation. TikTok: nothing official. Design the chat panel to show per-platform capability badges rather than pretending parity.
7. **Onboarding must front-load the gates:** Meta App Review + **Business Verification** for Facebook; 1,000 followers + public account for Instagram; LIVE access for TikTok. These, not code, are what will block most LIVETAP users.
8. **Secret handling:** Facebook and Instagram require a server-side token exchange (app secret / client secret). TikTok desktop does not (PKCE + loopback). An open-source LIVETAP should therefore either ship a "bring your own Meta app + small callback service" story, or a hosted callback for Meta only.

## 4.3 Items flagged UNVERIFIED — re-check before implementation

| # | Item | Why |
|---|---|---|
| 1 | Facebook LiveVideo node field list, incl. **`live_views`**, `embed_html`, `permalink_url`, `seconds_left`, `copyright` | Every doc path to the LiveVideo node reference returned 404 in this pass. Verify in Graph API Explorer. |
| 2 | Facebook **Chat Write** on live videos (`POST /{live-video-id}/comments`) | Not confirmed on an official edge reference. |
| 3 | Facebook **`blocked_users`** edge contract | Referenced but not read. |
| 4 | Facebook SSE **`comment_rate`** parameter and exact SSE query syntax | SSE endpoint reference page not retrievable. |
| 5 | Facebook **scheduling** current status | Changelog deprecation vs. live scheduling guide conflict. |
| 6 | Facebook Groups live permission name (`publish_to_groups`?) | Not stated on the group edge page. |
| 7 | Facebook PKCE for **non-OIDC Graph-scope** authorization | Doc only covers the OIDC flow. |
| 8 | Instagram Live Producer **account-type requirement** (professional only?) | Widely reported, not on an official page. |
| 9 | Instagram live ingest **scheme/host** (rtmp vs rtmps) | Not in official docs; read from UI. |
| 10 | Instagram **live-comment reply/moderation via API** | IG Media says live not supported for some ops; reply path untested. |
| 11 | Instagram live **max duration** | Not documented. |
| 12 | TikTok **LIVE access thresholds** (1,000 followers; 18 vs 16; 30-day account) | TikTok help pages served navigation-only HTML. |
| 13 | TikTok **encoder spec** (bitrate ceiling, 30 fps cap) | Secondary sources only. |
| 14 | TikTok web LIVE producer **UI path** (`livecenter.tiktok.com/producer`) | Third-party corroborated only. |
| 15 | TikTok **web-flow PKCE** requirement | Docs specify mobile/desktop. |
