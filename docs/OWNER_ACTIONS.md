# LIVETAP — everything the owner has to do, once, in order

Written 2026-09-14. This is the whole list. It exists so nobody has to ask you
anything again mid-build.

Nothing in the engineering plan is blocked on any of it. The alpha's first real
broadcast goes to a Custom RTMP destination on your own machine, which needs no
platform account, no certificate and no review. What this list buys is the
second thing you asked for: connecting your real accounts and going live on
them without ever seeing a stream key.

**Total time: about two and a half hours at a laptop, plus waiting on other
people's review queues afterwards.** Do part 0 first; it takes five minutes and
it is the only item that is urgent.

---

## How to read this

| Column | Meaning |
|---|---|
| **Produces** | the values to hand back, and where they go |
| **Unblocks** | what starts working the moment you finish |
| **Waiting on** | whose queue you are then in, if anyone's |

Every value below is either a public client id (safe to ship) or a secret
(never ships in a binary; it lives in the token broker's environment). The
document says which, every time. If a step asks you for a value and you are not
sure where it goes, part 8 is the single table of every environment variable.

---

## 0. Rotate the Vercel token that is sitting in the repo, now

`apps/web/.env.local` contains a live Vercel OIDC token. It is gitignored, so it
is not in the repository's history, but it is on disk and it is real.

1. Vercel dashboard, Account Settings, Tokens: revoke the existing token.
2. `vercel login` again if the CLI stops working.
3. Confirm `.env.local` is still listed in `.gitignore`.

**Produces:** nothing to paste. **Unblocks:** everything else in this list is
safe to do afterwards. **Time:** 5 minutes.

---

## 1. Twitch — start here, because it is the only one with no gate at all

Ten minutes, no review queue, works immediately. This is the fastest way to
have one real platform account connected end to end, which is why it is first.

1. Turn on **two-factor authentication** on the Twitch account. The developer
   console is unreachable without it, and this is the only gate on the entire
   platform.
2. Go to `dev.twitch.tv/console/apps` and press **Register Your Application**.
3. **Name:** must be globally unique across all of Twitch. Try `LIVETAP Multistream`.
4. **OAuth Redirect URLs**, add both:
   - `http://localhost:53871/callback`
   - `https://livetap.vercel.app/oauth/callback`
5. **Category:** Broadcasting Suite.
6. **Client Type:** Public.
7. Press Create. Copy the **Client ID**.
8. **Do not generate a client secret.** The desktop build uses the device code
   grant, which needs no secret, and a secret in a shipped binary is not a
   secret.

> **Produces:** `LIVETAP_TWITCH_CLIENT_ID` (public, safe to ship).
> **Unblocks:** real Twitch sign-in, real title and category set from LIVETAP,
> real stream key fetched from the API, real chat through EventSub, and a real
> broadcast that starts the moment video arrives.
> **Waiting on:** nobody.

**What LIVETAP still cannot do on Twitch, and why it is not a bug.** Twitch has
no start endpoint and no stop endpoint for apps. Your stream begins when video
arrives and ends when it stops. Twitch also makes its own live thumbnail and
publishes no per-stream analytics. The app says all three in plain language.

---

## 2. Google / YouTube — about 40 minutes, then a review queue you can skip for yourself

1. **Google Cloud Console**, create a project called LIVETAP.
2. **APIs and Services, Library**: enable **YouTube Data API v3**. Enable
   YouTube Analytics API only if you decide the analytics panel ships.
3. **OAuth consent screen**: choose **External**. Fill in app name, support
   email, app logo, homepage URL, privacy policy URL and terms URL. All three
   URLs must be publicly reachable on a domain you control.
   - The repo already has the pages: `/privacy` and `/terms` on the deployed
     site.
4. **Verify that domain in Google Search Console** using the same Google
   account that owns the Cloud project, then add it under **Authorized
   Domains** on the consent screen. This step is the one people forget and it
   blocks the next one.
5. **Credentials, Create credentials, OAuth client ID**, type **Desktop app**.
   - Do **not** register an OOB (`urn:ietf:wg:oauth:2.0:oob`) redirect. Google
     killed it, and custom URI schemes are deprecated.
   - The loopback redirect is chosen by the app at run time on a free port, and
     Google accepts any port for a Desktop app client, so there is nothing to
     type here.
   - If a hosted LIVETAP ships later, create a **separate** Web application
     client with redirect `https://livetap.vercel.app/oauth/callback`.
6. **Scope**, declare exactly one: `https://www.googleapis.com/auth/youtube.force-ssl`.
   It is the only scope that permits chat write and moderation, and asking for
   more makes verification harder for no gain.
7. Leave **publishing status on Testing** and add your own Google account to
   the **test user** list.
8. On youtube.com, confirm the channel already has live streaming enabled:
   16 or older, channel verified by phone, and no live-streaming restriction in
   the past 90 days. **LIVETAP cannot unlock this and no app can.**

> **Produces:** `LIVETAP_YOUTUBE_CLIENT_ID` (public) and
> `LIVETAP_YOUTUBE_CLIENT_SECRET` (goes in the broker's environment; the
> desktop build ships it obfuscated and PKCE is what actually protects the
> exchange).
> **Unblocks:** LIVETAP creating the broadcast, creating the stream, binding
> them, transitioning to live, ending it, setting the title, description,
> privacy and thumbnail, and bringing your live chat into the app. This is the
> only platform with a complete control plane, and it is the one that makes the
> product's promise visible.
> **Waiting on:** nobody, for you. See the caveat below.

### The Testing-status caveat, stated plainly

**You do not need Google's verification to do your own first broadcast.** With
the app left in Testing and your own account added as a test user, the real
OAuth flow works today: a real consent screen, a real authorization code, a
real token, a real broadcast on your real channel.

**The cost is that the authorization expires seven days after you grant it.**
While an app is in Testing, Google issues short-lived refresh tokens, so about
once a week you will tap Connect on the YouTube card and sign in again. It
takes about fifteen seconds. Nothing else breaks and no settings are lost.

That ends when the app is verified. Verification is two separate queues, and
neither publishes an SLA:

- **Google OAuth app verification** for the sensitive scope, with annual
  re-verification.
- **A YouTube API Services compliance audit**, which is what you need to exceed
  the default quota. The default is not a flat 10,000 units: it is 100
  `search.list` per day, 100 `videos.insert` per day, and 10,000 units per day
  for everything else, and every request costs at least one unit even when it
  fails.

Submit both when you are ready to have other people use LIVETAP. Do not block
your own alpha on either.

---

## 3. Kick — about 15 minutes, plus one test only you can run

1. Turn on **2FA** on the Kick account. The Developer tab is unreachable
   without it.
2. Go to `kick.com/settings/developer` and create the app.
3. **Enable these scopes on the app itself.** A scope that is not enabled on
   the app cannot be requested at authorize time, so this is not optional:
   ```
   user:read  channel:read  channel:write  streamkey:read
   chat:write  events:subscribe  moderation:ban  moderation:chat_message:manage
   ```
   There is no `chat:read` scope on Kick; chat arrives by webhook.
4. **Redirect URI:** use the `http://localhost:<port>/callback` spelling, **not
   `127.0.0.1`**. Kick's front end rewrites the first `127.0.0.1` it finds in
   the authorize URL, which silently breaks the redirect.
5. Copy the **Client ID** and the **Client Secret**. Kick has no public-client
   mode, so the secret is mandatory and must stay server side.

### The one test that decides how Kick behaves in the product

With `streamkey:read` granted and **your channel OFFLINE**, call:

```
GET https://api.kick.com/public/v1/channels
Authorization: Bearer <your access token>
```

and report whether `stream.key` and `stream.url` come back **non-empty**.

This matters because offline is exactly the state LIVETAP is in when it needs
those values. There is an open Kick bug where they return empty strings while
the channel is offline. If they come back empty, Kick is a paste-key
destination in practice and the app will say so; if they come back populated,
Kick joins YouTube and Twitch as a sign-in-and-go destination.

> **Produces:** `LIVETAP_KICK_CLIENT_ID` (public),
> `LIVETAP_KICK_CLIENT_SECRET` (broker environment only), and a yes or no on
> the offline stream key.
> **Unblocks:** real Kick sign-in, title and category set from LIVETAP, and
> either the automatic key path or an honest paste path.
> **Waiting on:** nobody.

---

## 4. Facebook — about 30 minutes, then weeks of review. Do not block on it.

1. `developers.facebook.com`, create a **Business** app. Record the **App ID**,
   the **App Secret** (Settings, Basic) and the **Client Token** (Settings,
   Advanced).
2. Add **Facebook Login**. Valid OAuth redirect URIs:
   `https://livetap.vercel.app/oauth/callback`.
3. Add permissions `publish_video`, `pages_manage_posts`,
   `pages_read_engagement`, and add the **Live Video API** App Review feature.
4. **Add your own Facebook account as a developer or tester on the app.** That
   alone makes the real adapter work for you on day one, with no review at all.
   This is the Facebook equivalent of YouTube's test-user list, and it has no
   seven-day expiry.
5. Confirm the target Page already has **100 or more followers** and the
   account is **60 or more days old**. Facebook has enforced both since
   2024-06-10, and a brand-new test Page cannot go live no matter what the API
   says.
6. **Before you submit for App Review, get a written answer from Meta on
   whether a multistreaming product is permitted.** Meta's Live Video API FAQ
   is indexed with language prohibiting simulcasting Facebook live video to
   third-party sites. That page 404s to automated fetching, so it could not be
   read during research. If that clause is live it goes to the heart of what
   LIVETAP is, and it is far cheaper to know before the review than after.

> **Produces:** `LIVETAP_FACEBOOK_APP_ID` (public),
> `LIVETAP_FACEBOOK_APP_SECRET` (broker environment only),
> `LIVETAP_FACEBOOK_CLIENT_TOKEN`, and a policy answer.
> **Unblocks:** for you personally, immediately: create, start and end a real
> Facebook live from LIVETAP. For anyone else: nothing until App Review and
> Business Verification both clear.
> **Waiting on:** Meta, for weeks, and only for other people's use.

---

## 5. The platforms that need nothing from you as a developer

TikTok, Instagram and X need **no developer account at all**. They are Custom
RTMP destinations where you paste a per-session key. There is no console step,
no client id and nothing to apply for. The only work is honesty in the product,
which is already done:

- **TikTok**: signing in with TikTok grants no live capability whatsoever.
  There is no live API, no live endpoint and no live webhook. You paste a key
  from LIVE Studio, and TikTok gives you a new one every session. Some
  competitors start a TikTok LIVE without a key because TikTok gave them
  private partner access; LIVETAP does not have it and says so.
- **Instagram**: Live Producer is desktop-web only, rotates its key every
  session, and a human has to press Go live in Instagram's own tab after the
  bytes are already flowing.
- **X**: needs X Premium to get a stream key at all, and pushing bytes does not
  publish anything. You create a Source and a Broadcast in Live Studio and
  press start there. LIVETAP shows a three-step checklist rather than
  pretending.

**LinkedIn ships as unavailable.** This is not an engineering gap. The Live
Events API terms forbid making the integration available to unaffiliated
customers and never contemplate open-source or self-hosted distribution, and
admission needs a certification demo video plus a Microsoft OneVet background
check. Unlike every other platform there is no paste fallback, because LinkedIn
never shows a member a stream key. See BLOCKERS.md B-003 for the three options
if you ever want to revisit it.

> **Produces:** nothing. **Unblocks:** nothing, because nothing is blocked.

---

## 6. Hardware and the machine you will actually use

The build host is a headless VM with no camera, no microphone and no GPU.
Everything below is about your own machine.

1. Plug a **USB webcam and microphone** into a Windows machine you control.
   Note the exact device names as Windows reports them, so the device-picker
   labels can be checked against reality.
2. If you want the hardware encoder paths exercised, use a machine with an
   **NVIDIA, Intel or AMD GPU**. All three hardware branches fail to open on
   the build host, so only the libx264 fallback is proven today.
3. Have an **Android phone with USB debugging enabled** for the sideload.
   Android 13 or newer, so the notification-permission path runs.
4. You do **not** need a code-signing certificate, an Apple Developer account
   or a Google Play account for your own alpha. An unsigned local install and
   an `adb install` are enough for one owner.

---

## 7. The order to do it in, and why

```
0  Rotate the Vercel token                     5 min    do this first
1  Twitch                                     10 min    one real platform, working, today
2  Google / YouTube                           40 min    the platform that shows the whole promise
3  Kick                                       15 min    plus the offline stream-key test
4  Facebook                                   30 min    then wait on Meta; not on your path
5  TikTok / Instagram / X                      0 min    nothing to do
6  Hardware                                   20 min    your own machine, your own phone
8  Paste the values in                        10 min    the table below
```

Twitch is first on purpose. It is the only platform with no review, no
eligibility rule and no waiting, so within twenty minutes of starting you can
see a real account connected to a real broadcast and know the chain works
before spending forty minutes in Google's console.

---

## 8. Every value, and exactly where it goes

Set these in the Vercel project's environment variables (Project, Settings,
Environment Variables). `apps/web/.env.example` is the authoritative list and
should be read alongside this table.

| Variable | Secret? | Where it is used |
|---|---|---|
| `LIVETAP_YOUTUBE_CLIENT_ID` | no | served to every surface by `GET /api/oauth/config` |
| `LIVETAP_YOUTUBE_CLIENT_SECRET` | **yes** | the broker's token exchange only; never leaves the server |
| `LIVETAP_TWITCH_CLIENT_ID` | no | served by `/api/oauth/config`; also sent as `Client-Id` on every Helix call |
| `LIVETAP_KICK_CLIENT_ID` | no | served by `/api/oauth/config` |
| `LIVETAP_KICK_CLIENT_SECRET` | **yes** | broker only. Kick has no public-client mode |
| `LIVETAP_FACEBOOK_APP_ID` | no | served by `/api/oauth/config` |
| `LIVETAP_FACEBOOK_APP_SECRET` | **yes** | broker only, for the code and long-lived-token exchanges |
| `LIVETAP_FACEBOOK_CLIENT_TOKEN` | **yes** | broker only |
| `LIVETAP_EARLY_ACCESS_WEBHOOK` | **yes** | where the "notify me" form posts. Optional; see BLOCKERS.md B-009 |

**Redirect URIs, per platform, exactly as they must be typed into each console:**

| Platform | Desktop | Web |
|---|---|---|
| YouTube | none to register (Desktop app client, loopback on any port) | `https://livetap.vercel.app/oauth/callback` |
| Twitch | `http://localhost:53871/callback` (the device code flow uses none, but the form requires one) | `https://livetap.vercel.app/oauth/callback` |
| Kick | `http://localhost:<port>/callback` — **`localhost`, never `127.0.0.1`** | `https://livetap.vercel.app/oauth/callback` |
| Facebook | handled by the broker | `https://livetap.vercel.app/oauth/callback` |

**Scopes, per platform, exactly as they must be enabled:**

| Platform | Scopes |
|---|---|
| YouTube | `https://www.googleapis.com/auth/youtube.force-ssl` |
| Twitch | `channel:read:stream_key channel:manage:broadcast user:read:chat user:write:chat moderator:manage:banned_users moderator:manage:chat_messages` |
| Kick | `user:read channel:read channel:write streamkey:read chat:write events:subscribe moderation:ban moderation:chat_message:manage` |
| Facebook | `publish_video pages_manage_posts pages_read_engagement` |

Once the variables are set, LIVETAP stops being in demo mode by itself: the app
asks `GET /api/oauth/config` at boot and switches on whatever is actually
configured. There is no separate switch to flip and no flag to remember.

---

## 9. What this list deliberately does not ask you for

These were considered and are not needed for your own alpha. They are recorded
in BLOCKERS.md with what each one unblocks if you ever want it.

| Not needed | Why | Blocker |
|---|---|---|
| Windows and macOS code-signing certificates | an unsigned local install works on your own machine | B-004 |
| Apple Developer Program, Google Play Console | sideloading your own APK needs neither | B-005 |
| A GitHub token with `workflow` scope | CI is a convenience; every gate runs locally today | B-001 |
| A GPU host | the libx264 fallback is what the alpha uses | B-007 |
| A public HTTPS origin for the token broker | desktop and mobile can point at a local `apps/web/api` during development | — |
| A Docker or Linux host for the relay | the relay is only needed for the browser surface, not for desktop or Android | B-008 |
| A mailing-list or form provider | only the "notify me" button depends on it | B-009 |
