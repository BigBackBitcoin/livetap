# LIVETAP fake identity provider (development harness)

A single, dependency-free Node server (`node:http`, `node:crypto`, `node:url` only, ESM, zero
npm packages) that speaks enough **real OAuth 2.0** and enough **real YouTube / Twitch API
shape** that LIVETAP's production code paths can be exercised end to end on a machine that has
no platform credentials.

Nothing in the product has to be modified to use it. You point three configuration values at it
and the real code runs:

| Production setting | Point it at |
| --- | --- |
| `PLATFORM_OAUTH[...].authorizeUrl` / `tokenUrl` | `http://127.0.0.1:8789/authorize` and `/token` |
| `YouTubeAdapter({ apiBase })` | `http://127.0.0.1:8789/youtube/v3` |
| `TwitchAdapter({ apiBase, ingestListUrl })` | `http://127.0.0.1:8789/helix` and `.../helix/ingests` |

## What it actually proves

- **PKCE is really verified.** `/token` recomputes `SHA-256(code_verifier)` and compares it in
  constant time to the `code_challenge` stored at `/authorize`. A wrong verifier gets
  `invalid_grant`. There is no stub and no bypass in that path, because the point of the harness
  is to be evidence about `packages/adapters/src/oauth/pkce.ts`, not a convenience.
  Both encodings the repo supports are handled: RFC 7636 base64url, and TikTok's documented hex
  deviation. Which one is compared is decided by the shape of the stored challenge, never by
  anything the token request says.
- **Single-use codes are really single use,** with a 60 second lifetime, and a replay revokes the
  tokens the first exchange minted (RFC 6749 section 4.1.2).
- **The ingest address points at a local RTMP server.** The app receives a stream key from an API
  call and then pushes real bytes to a real server. That is what makes an end-to-end test end to
  end rather than a mock handshake.
- **Failures are real failures.** Fault switches make one platform return 401, 500, 429, a slow
  response or an expired token while the other platform keeps working, so LIVETAP's failure
  isolation is tested against something that actually fails.
- **The real adapters drive it unmodified.** `real-adapters.test.mjs` constructs
  `YouTubeAdapter` and `TwitchAdapter` from `packages/adapters` exactly as production does and
  runs validate / createBroadcast / start / getStatus against this server over HTTP.

## What it is NOT

**It is a development harness. It must never be deployed, and a production build must never be
pointed at it.**

- It is not an identity provider. There is no user database, no password, no session. The
  "consent screen" is a button and the account is a constant.
- It is not a security boundary. It mints bearer tokens for anyone who asks and its `/_control`
  surface lets any caller mutate its state.
- It is not a platform emulator. It implements the endpoints LIVETAP calls, in the envelope
  shapes LIVETAP parses, and nothing else. Quotas, eligibility, transcoding, monetisation,
  category lookup and EventSub are all absent. `POST /helix/eventsub/subscriptions` returns a
  documented 501: EventSub is a WebSocket protocol and this server is `node:http` only, so
  Twitch chat cannot be exercised here.

Guardrails it enforces on itself:

- it binds to `127.0.0.1` and refuses any other bind address unless
  `LIVETAP_FAKE_IDP_ALLOW_PUBLIC_BIND=1`;
- it refuses to start with `NODE_ENV=production` unless
  `LIVETAP_FAKE_IDP_I_KNOW_THIS_IS_A_HARNESS=1`;
- `/_control` and the request journal never return a full access token, refresh token,
  authorization code or stream key. They return a prefix and a length.

## Run it

```bash
node infra/dev-harness/fake-idp/fake-idp.mjs
```

```
  LIVETAP fake identity provider  (DEVELOPMENT HARNESS, never deploy)
  listening            http://127.0.0.1:8789
  authorize            http://127.0.0.1:8789/authorize
  token                http://127.0.0.1:8789/token
  revoke               http://127.0.0.1:8789/revoke
  youtube apiBase      http://127.0.0.1:8789/youtube/v3
  twitch apiBase       http://127.0.0.1:8789/helix
  control              http://127.0.0.1:8789/_control
  ingest handed out    rtmp://127.0.0.1:1935/live
  access token ttl     3600s
  client ids           livetap-dev-client
```

Tests:

```bash
npx vitest run --config infra/dev-harness/fake-idp/vitest.config.ts
```

The root `vitest.config.ts` lists its projects explicitly and does not include `infra/`. This
directory deliberately owns no file outside itself, so it ships its own project config. To fold
it into `npm test`, add the one string `'infra/dev-harness/fake-idp'` to the `projects` array in
the root `vitest.config.ts`.

## Endpoints

### OAuth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/authorize` | Validates `client_id`, `redirect_uri`, `response_type`, `scope`, `state`, `code_challenge`, `code_challenge_method`, then renders a consent page. |
| GET | `/authorize/decision?request_id=...&decision=approve\|deny` | What the consent page's buttons link to. `approve` redirects with `code` and `state`; `deny` redirects with `error=access_denied`. |
| POST | `/token` | `grant_type=authorization_code` and `grant_type=refresh_token`. Form-encoded or JSON. Client credentials in the body or in HTTP Basic. |
| GET, POST | `/revoke` | `token` in the query (Google's style) or in a form body (RFC 7009). Always 200. |
| GET | `/.well-known/openid-configuration` | Discovery document, for clients that look for one. |

`/youtube/authorize`, `/youtube/token`, `/twitch/authorize`, `/twitch/token` and the `/revoke`
equivalents are aliases that pin the platform, so each platform can be given distinct endpoint
URLs in a `PLATFORM_OAUTH` override. Without a prefix, the platform comes from `?platform=` or is
inferred from the requested scopes.

Error responses follow RFC 6749 section 5.2: `invalid_request`, `invalid_grant`,
`invalid_client` (401, with `WWW-Authenticate`), `unsupported_grant_type`,
`unsupported_response_type`, `invalid_scope`, `access_denied`.

Errors that would require trusting an unvalidated `client_id` or `redirect_uri` are rendered as
an HTML 400 and are **not** redirected anywhere, because redirecting them is how an open redirect
is built.

### YouTube-shaped (`/youtube/v3`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/channels?part=id,snippet&mine=true` | `items[0].id`, `snippet.title`, `snippet.thumbnails.*.url` (a real SVG this server serves), so the app can show an account name and avatar. |
| POST | `/liveStreams` | `cdn.ingestionInfo.ingestionAddress` and `.streamName`. |
| GET | `/liveStreams?part=status&id=...` | `items[0].status.streamStatus` and `.healthStatus.status`. |
| POST | `/liveBroadcasts` | A broadcast with `id`, `snippet.liveChatId`, `status.lifeCycleStatus`. |
| PUT | `/liveBroadcasts` | Metadata update. |
| GET | `/liveBroadcasts?part=snippet&id=...` | `items[0].snippet.liveChatId`, `items[0].status.lifeCycleStatus`. |
| POST | `/liveBroadcasts/bind?id=&streamId=` | Sets `contentDetails.boundStreamId`, moves the broadcast to `ready`. |
| POST | `/liveBroadcasts/transition?id=&broadcastStatus=` | `testing`, `live` or `complete`. |
| GET | `/videos?part=liveStreamingDetails,statistics&id=` | `concurrentViewers` (absent when not live, like the real API) and `likeCount`. |
| GET, POST | `/liveChat/messages` | Poll and post chat, with `pollingIntervalMillis` and `nextPageToken`. |

Two behaviours are reproduced on purpose because the adapter depends on them:

- **`transition` to `live` returns 403 `errorStreamInactive`** unless the bound stream is
  `active`. That is the real API's most common failure and the reason
  `YouTubeAdapter.waitForActiveStream` exists. The harness makes that loop honest instead of
  decorative. Use `LIVETAP_FAKE_STREAM_ACTIVE_AFTER_MS` to make the wait take real time.
- **`rtmpsIngestionAddress` is only emitted when the configured ingest really is RTMPS.** The
  adapter prefers it over `ingestionAddress`, so inventing one would silently point the encoder
  at an address a plain local RTMP server cannot answer.

### Twitch-shaped (`/helix`)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/users` | `data[0]` with `id`, `login`, `display_name`, `profile_image_url`. |
| GET | `/streams/key?broadcaster_id=` | `data[0].stream_key`. Requires the `channel:read:stream_key` scope. |
| GET | `/ingests` | `{ ingests: [ { url_template, availability, default, priority, ... } ] }`, unauthenticated, like the real list. Also served at `/ingests` so `ingestListUrl` can point at either. |
| GET | `/streams?user_id=` | `data[0]` with `type: "live"` and `viewer_count`, or `data: []` when offline. |
| GET | `/channels?broadcaster_id=` | `data[0]` with `broadcaster_login`, `title`, `game_id`. |
| PATCH | `/channels?broadcaster_id=` | 204. Requires the `channel:manage:broadcast` scope. |
| POST | `/chat/messages` | `data[0].message_id`. |
| POST | `/eventsub/subscriptions` | 501, documented above. |

Every `/helix` call except `/ingests` requires a `Client-Id` header matching a configured client
id, exactly as Twitch does. A token issued for one platform cannot call the other platform's API.

### `/_control`

`GET /_control` returns the whole observable state: config, counters, pending authorizations,
codes, tokens, revoked token ids, broadcasts, streams, injected faults and the last 200 requests
with query strings redacted. Secrets appear only as `{ "prefix": "lt_at_yo", "length": 62 }`.

`POST /_control` with a JSON body:

| Body | Effect |
| --- | --- |
| `{"op":"reset"}` | Forget every token, code, broadcast, stream and counter, and re-apply `LIVETAP_FAKE_FAULT`. |
| `{"op":"fault","platform":"youtube","fault":"401","count":1}` | Inject a fault. See the table below. |
| `{"op":"clearFaults"}` or `{"op":"clearFaults","platform":"twitch"}` | Clear injected faults. |
| `{"op":"streamActive","streamId":"str_...","active":true,"health":"bad"}` | Force a YouTube stream's `streamStatus` and `healthStatus`. |
| `{"op":"twitchLive","live":true,"viewers":42}` | Put the fake Twitch channel on or off air. |
| `{"op":"revokeAll"}` | Revoke every outstanding token. |

Other routes: `GET /healthz`, `GET /assets/avatar.svg`, `GET /` (a summary page).

## Fault switches

Faults are per platform, so one destination can fail while the other keeps working.

| Fault | What it does | Injected by |
| --- | --- | --- |
| `401` | The next *n* calls to that platform return 401 (`authError` / `Unauthorized`). One shot by default. | `{"op":"fault","platform":"youtube","fault":"401","count":1}`, `LIVETAP_FAKE_FAULT=youtube:401`, or `?_fault=401` on one request |
| `500` | Every call to that platform returns 500 until cleared, or *n* times if `count` is given. | `{"op":"fault","platform":"twitch","fault":"500"}`, `LIVETAP_FAKE_FAULT=twitch:500`, or `?_fault=500` |
| `429` | Same, with 429 `rateLimitExceeded` / `Too Many Requests`, which `classifyFailure` maps to `RATE_LIMITED`. | `{"op":"fault","platform":"youtube","fault":"429"}`, `LIVETAP_FAKE_FAULT=youtube:429`, or `?_fault=429` |
| `slow` | Delay every call to that platform by *n* ms (default 1500) before responding, for timeout and spinner testing. | `{"op":"fault","platform":"youtube","fault":"slow","count":3000}`, `LIVETAP_FAKE_FAULT=youtube:slow=3000`, or `?_fault=slow&_faultMs=3000` |
| `expired` | Mark every live token for that platform as already expired, so API calls 401 and the app must refresh or re-auth. | `{"op":"fault","platform":"youtube","fault":"expired"}`, `LIVETAP_FAKE_FAULT=youtube:expired`, or `?_fault=expired` |

`?_fault=` affects only the request it is on. `/_control` and `LIVETAP_FAKE_FAULT` faults are
sticky until they are consumed or cleared. `LIVETAP_FAKE_FAULT` takes a comma separated list,
for example `LIVETAP_FAKE_FAULT=youtube:401,twitch:slow=2000`.

For token-refresh and re-auth UX, `LIVETAP_FAKE_SHORT_TOKENS=1` is usually easier than the
`expired` fault: every access token then lives 5 seconds.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIVETAP_FAKE_IDP_HOST` | `127.0.0.1` | Bind address. Anything else needs the public-bind flag. |
| `LIVETAP_FAKE_IDP_PORT` | `8789` | Bind port. `0` picks an ephemeral port. |
| `LIVETAP_FAKE_IDP_ALLOW_PUBLIC_BIND` | off | Permits a non-loopback bind. You almost certainly do not want this. |
| `LIVETAP_FAKE_IDP_I_KNOW_THIS_IS_A_HARNESS` | off | Permits starting with `NODE_ENV=production`. |
| `LIVETAP_FAKE_INGEST` | `rtmp://127.0.0.1:1935/live` | Base ingest URL handed out by both platforms. Point it at your local RTMP server. An `rtmps://` value also enables `rtmpsIngestionAddress` and `url_template_secure`. |
| `LIVETAP_FAKE_TOKEN_TTL` | `3600` | Access token lifetime in seconds. |
| `LIVETAP_FAKE_SHORT_TOKENS` | off | Forces the access token lifetime to 5 seconds, for refresh and re-auth UX testing. |
| `LIVETAP_FAKE_ROTATE_REFRESH` | on | Rotate the refresh token on every refresh (Twitch device-code behaviour). Set to `0` for Google's non-rotating behaviour. With rotation on, a client that fails to persist the rotated token breaks on its second refresh, which is the bug worth catching. |
| `LIVETAP_FAKE_REQUIRE_PKCE` | on | Require `code_challenge` at `/authorize` and `code_verifier` at `/token`. Turn off to exercise a no-PKCE platform such as Twitch. |
| `LIVETAP_FAKE_REQUIRE_STATE` | off | Require a non-empty `state`. |
| `LIVETAP_FAKE_REQUIRE_CLIENT_SECRET` | off | Require `client_secret` at `/token` (confidential-client only). |
| `LIVETAP_FAKE_ENFORCE_SCOPES` | on | Refuse calls whose token lacks the scope the real endpoint needs. |
| `LIVETAP_FAKE_ENFORCE_CLIENT_ID` | on | Require a matching `Client-Id` header on `/helix`. |
| `LIVETAP_FAKE_AUTO_APPROVE` | off | Skip the consent page and approve immediately. Handy for scripted runs; `?auto=approve` on a single `/authorize` does the same thing without changing the default. |
| `LIVETAP_FAKE_CLIENT_IDS` | `livetap-dev-client` | Comma separated list of accepted client ids. |
| `LIVETAP_FAKE_CLIENT_SECRET` | `livetap-dev-secret` | Accepted client secret, when one is sent. |
| `LIVETAP_FAKE_STREAM_ACTIVE_AFTER_MS` | `0` | How long after `liveStreams.insert` before `streamStatus` becomes `active`. `0` is instant. Raise it to exercise the adapter's poll loop. |
| `LIVETAP_FAKE_FAULT` | none | Boot-time faults, for example `youtube:401,twitch:slow=2000`. |
| `LIVETAP_FAKE_YOUTUBE_CHANNEL_ID` | `UCfakeIdpDevChannel0001` | Fake channel id. |
| `LIVETAP_FAKE_YOUTUBE_TITLE` | `LIVETAP Dev Channel` | Fake channel title, shown as the account name. |
| `LIVETAP_FAKE_TWITCH_USER_ID` | `900001` | Fake broadcaster id. |
| `LIVETAP_FAKE_TWITCH_LOGIN` | `livetap_dev` | Fake login. |
| `LIVETAP_FAKE_TWITCH_DISPLAY_NAME` | `LIVETAP Dev` | Fake display name. |

## Worked example: the whole flow with curl

```bash
B=http://127.0.0.1:8789
CID=livetap-dev-client
RURI='http://127.0.0.1:53219/callback'

# 1. A real PKCE pair, built the way packages/adapters/src/oauth/pkce.ts builds it.
eval "$(node -e '
const {createHash,randomBytes}=require("node:crypto");
const A="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
let v="";for(const b of randomBytes(64))v+=A[b%A.length];
const c=createHash("sha256").update(v,"utf8").digest("base64")
  .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
console.log(`VERIFIER=${v}\nCHALLENGE=${c}`);')"

# 2. Authorize. Drop &auto=approve to see the consent page in a browser instead.
SCOPE=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.force-ssl
LOC=$(curl -s -o /dev/null -D - \
  "$B/authorize?client_id=$CID&redirect_uri=http%3A%2F%2F127.0.0.1%3A53219%2Fcallback\
&response_type=code&scope=$SCOPE&state=xyz&code_challenge=$CHALLENGE\
&code_challenge_method=S256&platform=youtube&auto=approve" \
  | tr -d '\r' | grep -i '^location:' | cut -d' ' -f2)
echo "$LOC"
# http://127.0.0.1:53219/callback?code=lt_code_b8f723...&state=xyz
CODE=$(node -e 'console.log(new URL(process.argv[1]).searchParams.get("code"))' "$LOC")

# 3. A WRONG verifier is rejected. This is the assertion the harness exists for.
curl -s -X POST "$B/token" -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code -d "code=$CODE" --data-urlencode "redirect_uri=$RURI" \
  -d "client_id=$CID" -d "code_verifier=$(node -e 'console.log("Z".repeat(64))')"
# {"error":"invalid_grant","error_description":"code_verifier does not match the code_challenge from the authorization request."}

# 4. The right one works.
curl -s -X POST "$B/token" -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code -d "code=$CODE" --data-urlencode "redirect_uri=$RURI" \
  -d "client_id=$CID" -d client_secret=livetap-dev-secret -d "code_verifier=$VERIFIER"
# {"access_token":"lt_at_youtube_...","token_type":"Bearer","expires_in":3600,
#  "refresh_token":"lt_rt_youtube_...","scope":"https://www.googleapis.com/auth/youtube.force-ssl"}
AT=...   # paste the access_token
RT=...   # paste the refresh_token

# 5. Replaying the code is refused, and it revokes what the first exchange minted.
curl -s -X POST "$B/token" -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=authorization_code -d "code=$CODE" --data-urlencode "redirect_uri=$RURI" \
  -d "client_id=$CID" -d "code_verifier=$VERIFIER"
# {"error":"invalid_grant","error_description":"Authorization code has already been used. The tokens it issued were revoked."}

# 6. Platform API: the account name and avatar.
curl -s -H "Authorization: Bearer $AT" "$B/youtube/v3/channels?part=id,snippet&mine=true"

# 7. The go-live sequence: insert, insert, bind, poll, transition.
BID=$(curl -s -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -X POST \
  "$B/youtube/v3/liveBroadcasts?part=id,snippet,contentDetails,status" \
  -d '{"snippet":{"title":"harness"},"status":{"privacyStatus":"private"}}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
curl -s -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -X POST \
  "$B/youtube/v3/liveStreams?part=id,snippet,cdn,contentDetails" \
  -d '{"snippet":{"title":"harness stream"}}'
# "ingestionInfo": { "streamName": "lt-key-8a55...", "ingestionAddress": "rtmp://127.0.0.1:1935/live" }
#   ^ push real bytes here:  ffmpeg ... -f flv rtmp://127.0.0.1:1935/live/lt-key-8a55...

# Transitioning before the stream is active fails the way the real API fails:
#   403 { "error": { "errors": [ { "reason": "errorStreamInactive" } ] } }
curl -s -X POST -H "Authorization: Bearer $AT" \
  "$B/youtube/v3/liveBroadcasts/bind?id=$BID&part=id,contentDetails&streamId=$SID"
curl -s -H "Authorization: Bearer $AT" "$B/youtube/v3/liveStreams?part=status&id=$SID"
# {"streamStatus":"active","healthStatus":{"status":"good",...}}
curl -s -X POST -H "Authorization: Bearer $AT" \
  "$B/youtube/v3/liveBroadcasts/transition?id=$BID&part=id,status&broadcastStatus=live"

# 8. Twitch side (needs a twitch token; use /twitch/authorize with the twitch scopes).
curl -s -H "Authorization: Bearer $TAT" -H "Client-Id: $CID" "$B/helix/users"
curl -s -H "Authorization: Bearer $TAT" -H "Client-Id: $CID" "$B/helix/streams/key?broadcaster_id=900001"
curl -s "$B/helix/ingests"

# 9. Fault injection: YouTube fails, Twitch does not.
curl -s -X POST "$B/_control" -H 'Content-Type: application/json' \
  -d '{"op":"fault","platform":"youtube","fault":"401","count":1}'
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AT" \
  "$B/youtube/v3/channels?part=snippet&mine=true"          # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TAT" -H "Client-Id: $CID" \
  "$B/helix/users"                                          # 200

# 10. Refresh, then revoke.
curl -s -X POST "$B/token" -H 'Content-Type: application/x-www-form-urlencoded' \
  -d grant_type=refresh_token -d "refresh_token=$RT" -d "client_id=$CID"
curl -s -X POST "$B/revoke" -H 'Content-Type: application/x-www-form-urlencoded' -d "token=$AT2"
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $AT2" \
  "$B/youtube/v3/channels?part=snippet&mine=true"          # 401

# 11. What did the server actually see?
curl -s "$B/_control"
```

## Files

| File | What it is |
| --- | --- |
| `fake-idp.mjs` | The server. Also importable: `createServer({ env })`, `start({ port })`, plus the pure helpers `loadConfig`, `verifyPkce`, `isAllowedRedirectUri`, `parseFaultSpec`, `injectFault`, `redact`, `describeSecret`. |
| `fake-idp.test.mjs` | Vitest suite over real HTTP on port 0: PKCE success and failure, code reuse, refresh, revoke, fault injection, envelope shapes, control surface. |
| `real-adapters.test.mjs` | The real `YouTubeAdapter` and `TwitchAdapter` from `packages/adapters`, unmodified, driven against this server. |
| `vitest.config.ts` | The vitest project, pinned to this directory. |
