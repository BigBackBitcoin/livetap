# Platform authentication matrix — the four levels

Written 2026-09-14; the level-3 paste path rewritten 2026-09-15. Sources: `docs/research/PLATFORM_CAPABILITY_MATRIX.md` and
the three platform research files behind it. No new research here; this
document is the classification and the setup procedure, per platform.

**Related:** `docs/OWNER_ACTIONS.md` is the same information arranged as one
sitting at a laptop. This file is the per-platform reference and the reason
each platform lands where it does.

---

## The four levels

A level answers one question: **what does the creator have to do, beyond
tapping the platform's name, before LIVETAP can broadcast there?**

| Level | What the creator does | What the owner does first | Platforms |
|---|---|---|---|
| **1** | Taps the platform, signs in once, done. | Registers an app. No review, no queue. | **Twitch** |
| **2** | Taps the platform, signs in once, done. | Registers an app **and** clears a platform review, or adds themselves to a test/role list to use it alone. | **YouTube**, **Facebook** |
| **3** | Copies an ingest address and a stream key off their own studio page, pastes both, and sometimes presses a button in the platform's own tab. | **Nothing.** | **Every platform except LinkedIn** — permanently for **Kick**, **Instagram**, **TikTok** and **X**, and as the fallback for **YouTube**, **Twitch** and **Facebook** until their client is registered |
| **4** | Nothing works. The platform is shown as unavailable and says why. | Nothing they can do. | **LinkedIn** |

Custom RTMP, RTMPS, SRT and WHIP sit outside the levels. There is no account,
no authentication and no review: the creator pastes an address and a key, and
LIVETAP pushes. It is the only destination that works with nothing configured
anywhere, which is why it is the alpha's first real broadcast.

**Why the levels are drawn here and not elsewhere.** The line between 1 and 2
is a review queue the owner cannot control. The line between 2 and 3 is whether
the creator ever sees a stream key: at level 2 they never do, at level 3 they
must. The line between 3 and 4 is whether a paste path exists at all. LinkedIn
is alone at level 4 because it is the only platform that never shows a member a
stream key, so there is nothing to fall back to.

---

## The level is per build, not per platform — and today every build is at level 3

This document used to read as though a platform's level were a property of the
platform. It is not. It is a property of **this build**: whether an OAuth client
for that platform has been registered and configured, which is a fact about the
deployment and nothing else.

Until somebody registers a client, **the level-1/2 column is unreachable and
every platform except LinkedIn is at level 3** — because every one of them
prints an ingest address and a stream key on the creator's own studio page,
which takes about thirty seconds to copy and needs no app, no review and no
console work by anybody.

That is not a degraded mode. A destination created by pasting a key is real: it
puts real bytes on a real wire and it must never be labelled demo or mock. It is
simply the path where the *creator* holds the key instead of LIVETAP.

| | Level 1 / 2 — the API path | Level 3 — the paste path |
|---|---|---|
| Needs an OAuth client registered | yes | **no** |
| Creator sees a stream key | never | every time |
| LIVETAP sets the title | yes | **no** |
| LIVETAP reads the platform's own health / viewers | yes | **no** |
| LIVETAP starts and stops the broadcast | yes, where the platform has the call | only by starting and stopping the video |
| LIVETAP can explain a platform-side rejection | yes | **no** |
| Available in the owner's build right now | no | **yes** |

`apps/web/src/state/registry.ts` implements exactly this: it registers a
platform's own API adapter when a client is configured, and otherwise registers
the real custom-RTMP adapter **wearing that platform's own profile**, so the
aspect ratios, the bitrate ceiling and the eligibility notes stay the platform's
own. A platform whose client IS configured is never downgraded to paste.

### What LIVETAP pre-fills, and what it refuses to guess

| Platform | Server address LIVETAP pre-fills | Source |
|---|---|---|
| YouTube | `rtmp://a.rtmp.youtube.com/live2` | YouTube's published primary ingest; `b.rtmp` is a simultaneous second ingest, not a spare, so it is not offered |
| Facebook | `rtmps://live-api-s.facebook.com:443/rtmp/` | Facebook's RTMPS ingest; port 443 by design, so it survives firewalls that block 1935 |
| Twitch | fetched at paste time from `GET https://ingest.twitch.tv/ingests`, `url_template_secure` | the ingest host is regional; there is no single correct value to hard-code |
| Kick, TikTok, Instagram, X | **nothing** | per-channel or per-session hosts. An empty field with a placeholder asks a question the creator can answer off the page already open in front of them; a wrong default fails at go-live for a reason nobody can see |

Every pre-filled address stays editable, and is labelled as a default. The
creator's own studio page is the authority, always. Twitch's lookup is
unauthenticated and needs no client id; when it cannot be read, the field is
left empty rather than filled with the secondary-sourced host the official docs
never name.

Where a platform prints ONE joined address ending in the key, LIVETAP splits it
into the two fields and says on screen that it did. The split is conservative: a
real ingest URL has exactly one path segment (`/live2`, `/app`, `/rtmp`), so a
second, long enough segment can only be a key.

### What the creator loses by pasting, per platform

One line of this appears on the destination itself, derived from the platform's
own profile rather than written out per platform, so it cannot drift from what
the adapters do.

| Platform | Who publishes the broadcast | Title | Platform-side health / viewers | Rejection reason |
|---|---|---|---|---|
| Twitch | Twitch, the moment video arrives | creator, on Twitch | not visible to LIVETAP | not visible to LIVETAP |
| Kick | Kick, the moment video arrives | creator, on Kick | not visible to LIVETAP | not visible to LIVETAP |
| Facebook | Facebook, the moment video arrives | creator, in Live producer | not visible to LIVETAP | not visible to LIVETAP |
| YouTube | **creator presses Go live in YouTube Studio** | creator, in Studio | not visible to LIVETAP | not visible to LIVETAP |
| Instagram | **creator presses Go live in Live Producer** | creator, in Live Producer | not visible to LIVETAP | not visible to LIVETAP |
| TikTok | **creator presses Go LIVE** | creator, in TikTok | not visible to LIVETAP | not visible to LIVETAP |
| X | **creator starts the broadcast in Live Studio** | creator, in the Studio | not visible to LIVETAP | not visible to LIVETAP |

In every row, what LIVETAP still does is the thing that matters: it produces the
picture once and pushes it to all of them at the same time.

**LinkedIn is not in that table and never will be.** It is the one platform that
never shows a member a stream key, so there is no paste path to fall back to.
It stays unavailable, and says why.

---

## Level 1 — Twitch

**Why level 1.** No app review, no eligibility rule, no queue. The app exists
the moment you press Create. The only gate on the entire platform is 2FA on the
account, which the developer console requires before it will open.

| | |
|---|---|
| Desktop flow | **Device code grant** (`https://id.twitch.tv/oauth2/device`). Twitch documents no PKCE anywhere, so authorization code from a binary would mean shipping a secret, and implicit returns no refresh token. |
| Web flow | Authorization code, secret server side. `state` is always sent and verified; Twitch does not enforce it. |
| Never | Implicit, on any surface. |
| Access token | about 4 hours |
| Refresh token | **one-time use**, dies after 30 days idle. The rotated token must be persisted atomically on every refresh or the account silently disconnects. |
| Client secret | not needed for desktop, and deliberately not created |

**Owner steps, in order.**
1. Enable 2FA on the Twitch account.
2. `dev.twitch.tv/console/apps`, Register Your Application.
3. Name: globally unique across all of Twitch.
4. OAuth Redirect URLs: `http://localhost:53871/callback` and
   `https://livetap.vercel.app/oauth/callback`.
5. Category: Broadcasting Suite. Client type: Public. Create.
6. Copy the Client ID. **Do not generate a secret.**

**Scopes.** `channel:read:stream_key channel:manage:broadcast user:read:chat
user:write:chat moderator:manage:banned_users moderator:manage:chat_messages`

**What is still manual after this, and why.** Nothing the creator does. But
Twitch has no start endpoint and no stop endpoint for apps: the broadcast
begins when video arrives and ends when it stops. There is also no thumbnail
upload and no per-stream analytics API. The product says each of these in its
own words rather than hiding a missing button.

---

## Level 2 — YouTube

**Why level 2.** The creator's experience is identical to level 1 once the
owner is set up, but the owner is in two review queues: Google OAuth app
verification for the sensitive scope, and a separate YouTube API Services
compliance audit to exceed the default quota. Neither publishes an SLA.

**The owner can use it alone today without either.** Leave the app in
**Testing** and add your own Google account as a test user; the real flow works
immediately. The cost is that the authorization expires **seven days** after
consent while the app is in Testing, because Google issues short-lived refresh
tokens in that state. Expect to re-tap Connect about once a week until
verification lands. Nothing else breaks and no settings are lost.

| | |
|---|---|
| Desktop flow | Authorization code + **PKCE `S256`** with a loopback redirect on a random port. Client type **Desktop app**. |
| Web flow | Authorization code, client type **Web application**, exact HTTPS redirect, exchange server side, `access_type=offline` + `prompt=consent` to reliably get a refresh token. |
| Never | OOB (`urn:ietf:wg:oauth:2.0:oob`) is dead; custom URI schemes are deprecated. |
| Access token | about 1 hour |
| Refresh token | long lived, but invalidated by revocation, password change, six months idle, the per-client-per-user cap, or Testing status |
| Client secret | issued even for Desktop app clients. Shipped obfuscated; PKCE is what actually protects the exchange. |

**Owner steps, in order.**
1. Google Cloud Console: create the project.
2. APIs and Services, Library: enable **YouTube Data API v3**.
3. OAuth consent screen: External, with app name, support email, logo,
   homepage, privacy policy and terms URLs, all publicly reachable.
4. Verify that domain in Google Search Console with the same Google account,
   then add it under Authorized Domains.
5. Credentials, Create OAuth client ID, type **Desktop app**.
6. Declare exactly one scope: `https://www.googleapis.com/auth/youtube.force-ssl`.
7. Leave publishing status on **Testing**; add your own account as a test user.
8. On youtube.com, confirm the channel has live streaming enabled.

**Eligibility LIVETAP cannot unlock.** 16 or older, channel verified, and no
live-streaming restriction in the past 90 days. A community-guidelines strike
blocks live for 14 days.

**What the creator never sees.** A stream key. LIVETAP creates the broadcast,
creates the stream, binds them, waits for `streamStatus == "active"`,
transitions to live, and transitions to complete at the end.

---

## Level 2 — Facebook

**Why level 2.** Same shape as YouTube and a harder gate: App Review of the
Live Video API feature **plus** Business Verification, which takes weeks. The
escape hatch is the same shape too: **add your own account as a developer or
tester on the app and the real adapter works for you immediately**, with no
review and no expiry.

| | |
|---|---|
| Desktop flow | loopback redirect, and the **LIVETAP backend performs both the code exchange and the long-lived-token exchange**. The app secret never leaves the server. Meta's PKCE documentation covers the OIDC flow only. |
| Web flow | standard server-side code flow. Facebook Login for Business is preferred for Page targets: configuration ids instead of a raw scope, per-asset delegation, and system user tokens that default to never expiring. |
| Access token | short lived, 1 to 2 hours, exchanged server side for a long-lived token of about 60 days |
| Refresh token | **none**. Facebook renews by exchanging an access token for a fresher access token (`grant_type=fb_exchange_token`), which is why the broker carries a per-platform refresh strategy rather than assuming `refresh_token`. |
| Client secret | mandatory, server side only |

**Owner steps, in order.**
1. `developers.facebook.com`, create a **Business** app; record App ID, App
   Secret and Client Token.
2. Add Facebook Login; set the valid OAuth redirect URI.
3. Add `publish_video`, `pages_manage_posts`, `pages_read_engagement`, and add
   the **Live Video API** App Review feature.
4. Add your own Facebook account as a developer or tester on the app.
5. Confirm the Page has 100 or more followers and the account is 60 or more
   days old. Both have been enforced since 2024-06-10.
6. **Before submitting for review**, get a written answer from Meta on whether
   a multistreaming product is permitted. Meta's Live Video API FAQ is indexed
   with language prohibiting simulcasting Facebook live video to third-party
   sites, and that page could not be read by machine during research.

**Operational facts the adapter must honour.** The ingest URL expires unused
after 24 hours and a used one is good for up to 8 hours; `GET` is not supported
on the `/live_videos` edges, so ids must be persisted client side; crossposting
fails silently and has to be read back.

---

## Level 3 — Kick

**Why level 3.** Sign-in is real and useful: LIVETAP sets the title, the
category and the tags, and Kick goes live when video arrives. But two things
keep it off level 2. The stream key comes from `GET /public/v1/channels` gated
by `streamkey:read`, and there is an open bug where it returns empty strings
while the channel is offline, which is exactly LIVETAP's state when it needs
it. And chat is delivered by **inbound webhook only**, so a desktop-only build
cannot read Kick chat at all.

| | |
|---|---|
| Desktop flow | Authorization code + **mandatory PKCE `S256`** at `id.kick.com`, but `client_secret` is required at the token endpoint, so the exchange goes through the LIVETAP broker. |
| Web flow | the same, secret server side. This is the flow Kick is designed around. |
| Redirect spelling | **`http://localhost:<port>/callback`**. Kick's front end rewrites the first `127.0.0.1` it finds. |
| Token lifetimes | not documented. Read `expires_in`; `POST /oauth/token/introspect` when in doubt. |
| Refresh | returns a **new access token and a new refresh token**. Persist both. |
| Client secret | mandatory. Kick has no public-client mode. |

**Owner steps, in order.**
1. Enable 2FA on the Kick account.
2. `kick.com/settings/developer`, create the app.
3. **Enable the scopes on the app itself**, or they cannot be requested:
   `user:read channel:read channel:write streamkey:read chat:write
   events:subscribe moderation:ban moderation:chat_message:manage`.
4. Redirect URI in the `localhost` spelling.
5. Copy the Client ID and Client Secret.
6. **Run the offline stream-key test** (see `docs/OWNER_ACTIONS.md` part 3).
   Its answer decides whether Kick behaves as level 2 or stays level 3.

**A scope the creator can take away.** Kick's consent screen lets the creator
untick `streamkey:read`. The granted scope list must be read back after every
connect and the destination degraded to the paste path, rather than assuming
what was asked for is what was given.

---

## Level 3 — Instagram

**Why level 3.** There is no live API in either Instagram API flavour. The
Instagram Business Login scopes authorize reading live comments and probing
live status; **none of them authorizes going live.**

**Owner steps.** None. There is no developer account to create for this.

**What the creator does, every session.**
1. `instagram.com` in a **desktop browser**. Live Producer is desktop-web only.
2. Add post, then Live.
3. Enter a title, choose the audience.
4. Copy the URL and stream key Instagram shows.
5. Paste both into LIVETAP as a Custom RTMP destination.
6. LIVETAP pushes. **The creator presses Go live in Live Producer.**

**The key is single use and per session.** LIVETAP must never persist it and
must prompt again next broadcast. Eligibility, from Instagram: a public account
with 1,000 or more followers, and Live Producer itself is limited access.

---

## Level 3 — TikTok

**Why level 3.** TikTok's OAuth is genuinely good (PKCE mandatory, loopback
with a port, genuinely secretless) and completely irrelevant to going live.
There is **no live scope, no live endpoint and no live webhook**. Signing in
with TikTok grants no live capability whatsoever, and the product says exactly
that rather than implying otherwise by offering a sign-in button.

One trap for anyone implementing the OAuth for VOD publishing later: TikTok's
PKCE challenge is the **hex-encoded** SHA-256 of the verifier, not base64url. A
generic OAuth library fails silently here.

**Owner steps.** None for live.

**What the creator does, every session.** Sign in to TikTok in a desktop
browser, Go LIVE in the left nav, press the red Go LIVE, choose a category and
title, Save and Go LIVE, then copy the Server URL and Stream key from the
bottom of the dashboard and paste them into LIVETAP.

**Partner asymmetry, said out loud.** Some apps start a TikTok LIVE without a
key because TikTok gave them private access. LIVETAP does not have it. Do not
bundle reverse-engineered Webcast clients: they depend on a third-party signing
service, self-declare as not production ready, and put the creator's account at
risk.

**If the account has no LIVE access, no stream key exists at all.** Refreshing
will not produce one. That is TikTok's own eligibility rule and nothing in
LIVETAP can unlock it.

---

## Level 3 — X

**Why level 3.** X has no live API. The Periscope Producer API, the capability
LIVETAP would want, was cut off on 2021-03-31 and has no successor. Pushing
bytes to an X source **publishes nothing**: a human must start the broadcast in
Live Studio.

**Ship no X OAuth flow for the live destination.** It would imply a capability
that does not exist. In particular, never request `broadcast.read` or
`broadcast.write`: they are grantable, they look alarming on the consent
screen, and they map to no endpoint.

**Owner steps.** None. X Premium or Premium+ is required on the creator's own
account to obtain a stream key at all, and that is a subscription, not a
developer registration.

**What the creator does.**
1. Sign in at `studio.x.com`.
2. Sources, Create Source, name it, select RTMP, select a region.
3. Copy the RTMP URL and Stream Key into LIVETAP.
4. **Separately** create a Broadcast, attach the source, choose the audience,
   and publish the Post.
5. LIVETAP pushes; the creator starts the broadcast in the Studio.

Source keys appear to be long lived and reusable, unlike Instagram's and
TikTok's, so they are stored encrypted at rest rather than prompted for each
session.

---

## Level 4 — LinkedIn

**Why level 4, and why no amount of engineering changes it.** The Live Events
API is technically the best-designed API in the whole research set: a real
seven-step state machine, a real eligibility pre-flight
(`GET /contentAccess/...`, 200 approved, 404 not), real comments, real
analytics. None of that is reachable.

- The Live Events API Terms state you have no right to use the APIs unless
  approved, forbid making integrations available to other developers for resale
  to unaffiliated customers, require a direct client relationship, forbid
  combining other LinkedIn APIs with the Live Events APIs, and never contemplate
  open-source or self-hosted distribution at all.
- Admission is Development Tier, then a certification demo video covering every
  Live Events test case, then Standard Tier, plus a Microsoft OneVet background
  check.
- PKCE exists at a separate native endpoint but LinkedIn enables it **per
  application on request**, so a public desktop client cannot use it unaided
  and authentication must be brokered by a LIVETAP-operated backend, which is
  precisely what the terms restrict.
- Refresh tokens are not default either; without them a broadcaster
  re-authorizes about every 60 days.

**Owner steps.** None available. The decision is recorded as BLOCKERS.md B-003
with three options: run a LIVETAP-operated hosted service holding the approved
app; document a bring-your-own-approved-app path as advanced and unsupported;
or ship LinkedIn as unavailable. **The MVP choice is unavailable.**

**What the product says.** That LinkedIn Live is partner-only, that LIVETAP has
not been admitted, and that an ingest URL from an already-approved tool can be
added as a custom destination. Unlike every other platform there is no paste
fallback of its own, because LinkedIn never shows a member a stream key.

---

## Custom RTMP, RTMPS, SRT and WHIP — outside the levels

No account, no authentication, no review, no eligibility. The creator pastes an
address and a key; LIVETAP validates the shape, runs a connection test, pushes,
and reports exactly what it can see from the sender's side.

What it deliberately does **not** claim: that anyone is watching. For a custom
destination the platform's own confirmation does not exist, and inventing one
would be the worst kind of lie this product can tell.

Accepted shapes, which are the specification `validateIngest` implements:

| Protocol | Shape | Notes |
|---|---|---|
| RTMP / RTMPS | `rtmp[s]://host[:port]/app` plus a stream key | publish URL is url + `/` + key; the key may legitimately contain a query string |
| SRT | `srt://host:port`, optional `streamid`, optional `passphrase`, optional `latency` | caller mode only, MPEG-TS |
| WHIP | an `https://` endpoint, optional bearer token | follow 307 redirects preserving headers; expect 201 plus `Location`; `DELETE` the resource to end |

Whitespace and shell metacharacters are refused in both the URL and the key.

---

## One table, every platform

"Level" below is the level the platform reaches **once the owner has registered
its client**. The last column is what is true of a build with nothing configured,
which is every build today.

| Platform | Level, once registered | Owner registration | Review | PKCE | Client secret needed | Creator sees a stream key | A human must press a button on the platform | Paste path with nothing registered |
|---|---|---|---|---|---|---|---|---|
| Twitch | 1 | yes, instant | none | no (device code) | no | no | no | **yes** |
| YouTube | 2 | yes | two queues, or Testing for yourself | yes, S256 | issued, obfuscated | no | no | **yes** |
| Facebook | 2 | yes | App Review + Business Verification, or a role on the app | OIDC only | yes, server side | no | no | **yes** |
| Kick | 3 | yes, instant | none | yes, mandatory | yes, server side | sometimes | no | **yes** |
| Instagram | 3 | none | n/a | n/a | n/a | **yes, every session** | **yes** | **yes** |
| TikTok | 3 | none for live | n/a | n/a | n/a | **yes, every session** | **yes** | **yes** |
| X | 3 | none | n/a | n/a | n/a | yes, reusable | **yes** | **yes** |
| LinkedIn | 4 | not available | partner programme + background check | per-app request only | yes | never | n/a | **no — no key exists to paste** |
| Custom | — | none | none | n/a | n/a | yes, the one they already had | depends on the far end | **yes** |
