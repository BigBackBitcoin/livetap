# LIVETAP CURRENT STATUS

```
LIVETAP CURRENT STATUS
======================
Overall: 50%

WEB:       30%
DESKTOP:   70%
ANDROID:   35%

REAL BROADCAST:                    PARTIAL  (desktop proven; web cannot; Android unverified)
NO-ACCOUNT GUEST MODE:             PASS
EPHEMERAL SESSION / NO PERSISTENT: PARTIAL  (no secrets persist; non-secret state does)
CROSS-PLATFORM CONSISTENCY:        PARTIAL  (one codebase, three different capabilities)
CAN I TEST TODAY:                  PARTIALLY
```

Audited 2026-09-15 against HEAD `18f7702`, working tree clean, on the build host.
Every claim below carries the command or measurement that produced it. Where a
previous status document disagrees with this one, this one was measured today.

**The one-sentence answer.** A stranger can visit the site, need no account, and
reach a complete-looking studio — but the deployed website broadcasts nothing
and says so itself. Only the desktop app puts real bytes on a real wire, only
with a pasted stream key, and its installer is eight hours older than HEAD.

---

## 1. Repository / system truth

| | |
|---|---|
| HEAD | `18f7702 fix(web): the invisible-band guard was clipping the one band that paints outside itself` |
| Branch | `main` |
| Working tree | **clean** — `git status --short` returns 0 lines |
| Unpushed | **30 commits** ahead of `origin/main` |
| Concurrent sessions | Peer sessions were committing to this worktree earlier today (commits `07e51b9`, `9e1384b`, `471d998`, `db22f2b`, `de16128`, `18f7702`). Nothing uncommitted remains; no peer work was touched by this audit. |
| Typecheck | `npx tsc -b` — clean |
| Unit tests | **1,675 passed / 95 files** |

This audit changed no source file. It ran builds and harnesses only.

---

## 2. Completion percentages

| # | Category | Weight | Score | Weighted | Why |
|---|---|---|---|---|---|
| 1 | Web live product | 25% | 30% | 7.5 | Complete guest UI, zero broadcast capability |
| 2 | Desktop live product | 20% | 70% | 14.0 | Real broadcast proven; no OAuth; stale installer; intermittent multi-destination start |
| 3 | Android live product | 15% | 35% | 5.3 | APK builds and verifies; never run on hardware |
| 4 | Cross-platform consistency | 10% | 65% | 6.5 | One shared codebase; three very different capabilities |
| 5 | Destination integrations | 10% | 35% | 3.5 | Four real adapters, none configured; paste-key proven |
| 6 | Guest / no-account | 10% | 90% | 9.0 | No account anywhere, no server identity |
| 7 | Session privacy / ephemeral | 5% | 75% | 3.8 | No secrets persist; non-secret state survives with no discard |
| 8 | Bond / networking integration | 5% | 10% | 0.5 | Library and tests only; consumed by nothing |
| | **OVERALL** | **100%** | | **50.0%** | |

---

## 3. CRITICAL QUESTION 1 — Can someone use LIVETAP without a LIVETAP account?

### **PASS**

Driven with Playwright against `https://livetap.vercel.app/app` in a fresh
context — no cookies, no localStorage, no prior session:

```
url:            https://livetap.vercel.app/app/start
localStorage:   {}          (empty)
cookies:        (none)
sessionStorage: 0 keys
indexedDB:      []
sign-in words:  false       (regex /sign in|sign up|log in|create account|register/i)
pageerrors:     none
```

The visitor lands directly in a three-step setup and can reach Studio. There is
no LIVETAP account, no profile, no server-side identity, and no email capture in
the path. Grep confirms no auth gate: the only `api/` routes are
`oauth/{config,device,refresh,revoke,token}` and `early-access`, and none of them
guards the app.

**Nothing about accounts blocks the flow.** This requirement is met.

---

## 4. CRITICAL QUESTION 2 — Does the website actually broadcast?

### **FAIL — and the product says so itself, unprompted.**

The deployed page's own first paragraph:

> "Demo mode — this build simulates every destination. Nothing you connect here
> is broadcast anywhere, so you can try the whole thing safely."

Three independent confirmations:

**1. The deployed broker reports mock mode.**
```
$ curl https://livetap.vercel.app/api/oauth/config
{"platforms":{"youtube":{"configured":false},"twitch":{"configured":false},
"kick":{"configured":false},"facebook":{"configured":false}},"mockMode":true}
```

**2. No relay is deployed.** `apps/web/.env.example:30` —
`VITE_LIVETAP_RELAY_URL=` with the comment *"Leave empty to disable web go-live."*
The relay exists in `infra/relay/` as a docker-compose stack (Caddy + MediaMTX +
session-api) that nobody is running.

**3. A browser has no RTMP socket, and the engine says so.**
`packages/media/src/browser/BrowserEngine.ts:45` —
`'Browser cannot publish RTMP; use the desktop app or a WHIP relay'`, and
line 165: *"Browsers have no RTMP/SRT socket. Only the desktop engine (or the
relay) provides these."*

So web go-live is blocked twice over: mock mode is on, **and** even with it off
there is no transport. This is honest engineering, not a bug — but it means the
central product thesis is not yet delivered on the web.

---

## 5. CRITICAL QUESTION 3 — What can I test today?

### TEST A — WEB · works, broadcasts nothing

* **URL:** `https://livetap.vercel.app/app`
* Sequence: open → "What are you making?" → pick an intent → pick destinations →
  Continue → Open Studio → GO LIVE (DEMO).
* **Produces: neither a real nor a proving-ground broadcast.** Every destination
  is simulated. Use it to judge the interface, not the product.

### TEST B — DESKTOP · the only path that really broadcasts

* **Installer:** `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` — 225,260 KB,
  **built 04:18, HEAD committed 12:29 → the installer is ~8 hours stale** and
  does not contain the last six commits. Unsigned: SmartScreen will warn.
* **Proven path (from source, current HEAD):**
  ```
  node infra/dev-harness/ingest/start-ingest.mjs      # receiver
  npm run build -w @livetap/desktop
  node apps/desktop/e2e/broadcast.mjs
  ```
* **Real external broadcast:** possible only with a pasted stream key
  (`npm run verify:paste` drives the YouTube paste flow). OAuth is unavailable —
  see §8.

### TEST C — ANDROID · installable, unverified on hardware

* **APK:** `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
* 9,957 KB · package `app.livetap.mobile` · versionCode 1 / versionName 1.0 ·
  compileSdk 36 · debug-signed · **built 04:06, also ~8 hours stale.**
* Permissions present: `CAMERA`, `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE`,
  `FOREGROUND_SERVICE` (+ `_CAMERA`, `_MICROPHONE`, `_MEDIA_PROJECTION`),
  `WAKE_LOCK`, `POST_NOTIFICATIONS`, `VIBRATE`.
* **Never installed on a device. No Android hardware exists on this host.**
  Every mobile claim below is static-analysis or build-time only.

---

## 6. Media pipeline audit — the strongest evidence in this report

The desktop path is **real**, and was re-proven today at current HEAD.
`node apps/desktop/e2e/broadcast.mjs` drove the built app through its own UI and
ffprobe decoded what MediaMTX wrote to disk:

| path | codec | shape | audio | duration | bytes |
|---|---|---|---|---|---|
| `live/wide` | h264 Constrained Baseline | **1920x1080** | aac LC 48 kHz stereo | 7.03 s | 273,569 |
| `live/tall` | h264 Constrained Baseline | **1080x1920** | aac LC 48 kHz stereo | 8.00 s | 370,098 |
| `live/square` | h264 Constrained Baseline | **1080x1080** | aac LC 48 kHz stereo | 8.92 s | 284,821 |

Three genuinely different shapes from one production, simultaneously, decoded
back off disk. `ok no uncaught renderer errors during the broadcast`.

**How much to trust this, stated precisely.** The recordings above are anchored by
timestamp to the run that produced them (12:42:42–12:43:19) and probed individually
by the harness, so they are evidence about *this* run. But one link in the chain is
weaker than it looks and a reader should know it:
`verify-desktop-broadcast.mjs:496` records `'receiver running', 'PASS', 'an existing
receiver was reused'` — **reusing a receiver the gate did not start is a silent PASS
condition.** The MediaMTX serving these runs (pid 7744) had been up for nine hours
across an unknown number of runs by an unknown number of sessions, and
`recordings/live/wide` holds 62 files. A nine-hour-old orphan passing a freshness
check is how contaminated evidence gets recorded as proof. The positive result here
survives that — real H.264 at three distinct resolutions cannot be manufactured by a
stale receiver — but any *negative* result from a shared receiver is uninterpretable,
which is exactly the situation the correction below describes.

Stage by stage:

| Stage | Desktop | Web | Android |
|---|---|---|---|
| Camera capture | ✅ real `getUserMedia` | ✅ real | ⬜ unverified on hardware |
| Per-format composition | ✅ real canvases, one per aspect | ✅ real | ⬜ unverified |
| Encoder | ✅ Chromium MediaRecorder → ffmpeg | ⚠️ encodes, nowhere to send | ⬜ RootEncoder wired, unrun |
| Transport | ✅ real RTMP | ❌ none (no relay) | ⬜ unverified |
| Destination adapter | ✅ real | ⚠️ mock on deployment | ⬜ unverified |
| Media received | ✅ **verified by ffprobe** | ❌ never | ⬜ unverified |

**Two real defects found in the pipeline today:**

* **Multi-destination start failed once and passed once — CONFOUNDED, see the
  correction below.** The full gate run at 12:36 reported `live on 1 of 3` and
  **FAILED**; the direct driver run at 12:42 **PASSED** all three. Same HEAD, same
  host, minutes apart. Recording segments show `tall` dropped and restarted
  mid-run (four segments: 1,570 KB, 253 KB, 65 KB, 361 KB).

  > **CORRECTION (added after the audit was first delivered).** Both of those runs
  > shared a MediaMTX receiver (**pid 7744**) that this audit did not start and
  > does not own, while a concurrent session was running its own suite against the
  > same worktree. `infra/dev-harness/broadcast/runlock.mjs` guards the harness but
  > not a second session's stray processes. **Cross-session contention is at least
  > as good an explanation as a product defect, and this audit cannot separate
  > them.** The finding is therefore downgraded from a confirmed P0 to a
  > **P0-candidate requiring an isolated re-run** — one session, one receiver,
  > nothing else on the host. Do not schedule work against this item until that
  > re-run exists. The three ffprobe-verified recordings above are unaffected:
  > real media at three resolutions is a positive result that contention cannot
  > manufacture.
* **Frame rate is 12.1–12.8 fps** across all three encodes, against a 30 fps
  target. This host has no GPU and was running three simultaneous encodes, so
  this is not necessarily a product defect — but it has never been measured on
  hardware a creator would use. **P1 — unmeasured on real hardware.**

---

## 7. Guest / no-account audit — **PASS**

No account exists to create. No server-side session, no user record, no
identity. The three-step setup is preference collection, not registration, and
`Skip setup` is present on step 1.

---

## 8. Destination matrix

| Platform | Adapter exists | OAuth implemented | **Configured today** | Paste-key fallback | Usable today |
|---|---|---|---|---|---|
| YouTube | ✅ `YouTubeAdapter` | ✅ | ❌ `configured:false` | ✅ | 🔴 paste-key only |
| Twitch | ✅ `TwitchAdapter` | ✅ device grant | ❌ `configured:false` | ✅ | 🔴 paste-key only |
| Kick | ✅ `KickAdapter` | ✅ | ❌ `configured:false` | ✅ | 🔴 paste-key only |
| Facebook | ✅ `FacebookAdapter` | ✅ | ❌ `configured:false` | ✅ | 🔴 paste-key only |
| TikTok | ⬜ paste-only by design | ⬜ | — | ✅ `CustomRtmpAdapter` | ⚠️ paste-key |
| Instagram | ⬜ paste-only by design | ⬜ | — | ✅ `CustomRtmpAdapter` | ⚠️ paste-key |
| X | ⬜ paste-only by design | ⬜ | — | ✅ `CustomRtmpAdapter` | ⚠️ paste-key |
| LinkedIn | ❌ not present | ❌ | — | ❌ | ❌ unavailable |

**The single fact that governs this table:** no OAuth client IDs are configured
anywhere. No `.env` file exists in the repository (only `.env.example`), and the
deployment reports all four platforms `configured:false`. **Nobody can connect an
account on any surface today.** This is a human dependency — only the owner can
register the apps and set the secrets. See `docs/OWNER_ACTIONS.md`.

---

## 9. Ephemeral data audit — **PARTIAL**, and better than expected on the part that matters

Measured by walking a full guest session on the deployed site and reading every
storage surface at three points.

**Fresh visit:** `localStorage {}`, `sessionStorage 0`, `indexedDB []`, `cookies (none)`.

**After onboarding + adding a destination — five keys appear:**

```
livetap.destinations   [{"id":"youtube-1-wwmty9","platform":"youtube","label":"YouTube","aspectRatio":"16:9",…
livetap.intent         "talking"
livetap.onboarding     true
livetap.moments        [{"id":"starting-soon","name":"Starting Soon",…
livetap.settings       {"quality":"1080p30","recordEveryStream":false,"aspect":"16:9"}
```

**After reload:** identical. Still at `/app/studio`. Session restored.

**What never persists — verified in source, not assumed:**

* `apps/web/src/state/persist.ts:100` strips secrets before writing:
  `const { streamKey: _key, passphrase: _pass, ...ingest } = config.ingest;`
* Web OAuth tokens live in memory only. `tokens.ts:18` — *"WEB memory, for the
  life of the page, and nothing else. localStorage is readable by any…"*
* No cookies, no IndexedDB, no sessionStorage, no server session, at any point.
* `infra/dev-harness/broadcast/secret-log.test.mjs` exists and guards logging.

**Verdict.** The security-critical half is genuinely right: **no stream key, no
access token, no refresh token ever reaches disk in the browser.** What does
persist is five non-secret preference keys plus destination metadata (platform,
label, aspect — no key).

**What is missing for the stated requirement:** there is no "disconnect → session
discarded" action. The five keys survive reload, browser close, and a second
person using the same browser profile. A shared or public machine would show the
next person the previous person's destination list. **P1.**

---

## 10. Bond audit — **library only, consumed by nothing**

```
$ grep -rn "@livetap/bond" apps packages --include=*.ts --include=*.tsx | grep -v packages/bond
(no matches)
```

18 source files, 8 test files, zero importers outside its own package.

| Question | Answer |
|---|---|
| Is Bond consumed? | ❌ No. Nothing imports it, and **nothing depends on it** — `grep "@livetap/bond" --include=package.json` returns only its own `package.json:2`. It is a workspace package with no dependents. Independently confirmed by the session that owns this worktree. |
| Connected to the media pipeline? | ❌ No. |
| Real traffic over Bond? | ❌ No. |
| Does a relay exist? | ⚠️ `infra/relay/` exists, undeployed |
| Failover / loss recovery real? | ⚠️ Implemented and unit-tested; never carried a byte of real traffic |
| Encoder-rate coupling affects the encoder? | ❌ Not wired |

Bond is a well-tested networking library sitting beside the product rather than
inside it. **Scored 10%, not 0%, because the code and tests are real** — but no
percentage of it is in the shipping media path.

---

## 11. Cross-platform consistency matrix

One codebase feeds all three surfaces: `apps/web` is built into the Electron
renderer (`apps/desktop/scripts/build-renderer.mjs`) and staged as the Capacitor
bundle (`apps/mobile/scripts/stage-web.mjs`). The mental model is therefore
identical by construction. Capability is not.

| Capability | Web | Windows | macOS | Android | iOS |
|---|---|---|---|---|---|
| Launch | ✅ | ✅ | ⬜ | ⚠️ builds, unrun | ⬜ |
| Camera | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Microphone | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Preview | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Destination connection | ⚠️ simulated | ✅ paste-key | ⬜ | ⬜ | ⬜ |
| OAuth | 🔴 no client ids | 🔴 no client ids | ⬜ | 🔴 | ⬜ |
| Paste-key fallback | ⚠️ simulated | ✅ | ⬜ | ⬜ | ⬜ |
| GO LIVE | ⚠️ simulated | ✅ | ⬜ | ⬜ | ⬜ |
| **Live media** | ❌ **never** | ✅ **ffprobe-verified** | ⬜ | ⬜ | ⬜ |
| Destination health | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| END | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Error recovery | ✅ simulated | ⚠️ intermittent multi-dest | ⬜ | ⬜ | ⬜ |
| Session cleanup | ⚠️ persists | ⚠️ persists | ⬜ | ⬜ | ⬜ |
| Guest mode | ✅ | ✅ | ⬜ | ✅ by construction | ⬜ |
| No-account flow | ✅ | ✅ | ⬜ | ✅ by construction | ⬜ |

**macOS:** `apps/desktop/electron-builder.yml` declares `mac:` and `dmg:` targets.
No artifact has been built — it cannot be built on this Windows host.

**iOS:** `apps/mobile/ios/App/App.xcodeproj` and a `Podfile` exist — the Capacitor
scaffold, nothing more. No Swift, no build, no artifact, unbuildable without a
Mac. **Status: architecture scaffold only. Not a prototype.**

---

## 12. GO LIVE button audit

Covered by 11 Playwright spec files including `adversarial.spec.ts`,
`end-invariant.spec.ts`, `interaction-ownership.spec.ts` and `live-safety.spec.ts`.
Measured guards confirmed present in source:

* **Double-tap** — `GoLiveButton.tsx` ignores a click within `DOUBLE_TAP_MS = 450`
  of the countdown appearing, because Cancel takes over the pixels GO LIVE just
  occupied. Found by audit 3 as a silent stream-killer; fixed.
* **Second broadcast after END** — `evaluatePreflight` now filters on
  `isStartable` (READY **or** ENDED) rather than READY alone. Before this fix
  nobody could stream twice without reloading. Fixed.
* **END survives a route change** — the grace timer lives on the runtime, not the
  screen's effect.
* **Invisible overlays / click-through** — `[hidden]` reset plus an
  interaction-ownership suite that walks scroll positions asserting nothing
  invisible is hit-testable.

**Remaining P0:** the intermittent multi-destination start in §6 is a *silent*
failure of exactly the kind this audit area exists to catch.

---

## 13. Destination failure isolation

Proven on the wire, not in a mock. The gate kills a publisher at the TCP level
mid-broadcast and asserts the survivor keeps climbing:

> "One destination was dropped at the TCP level mid-broadcast and the other kept
> climbing. END stopped everything."

Isolation ✅ · survivor stays live ✅ · reconnect ✅ (the dropped path republishes —
a third recording exists because it came back) · global END ✅.

---

## 14. Exact available artifacts

| What | Path / URL | Size | Built | Stale? |
|---|---|---|---|---|
| Web (demo only) | `https://livetap.vercel.app/app` | — | live | current |
| OAuth broker | `https://livetap.vercel.app/api/oauth/config` | — | live | returns `mockMode:true` |
| Windows installer | `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` | 225,260 KB | 04:18 | **yes, ~8 h behind HEAD** |
| Android APK | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` | 9,957 KB | 04:06 | **yes, ~8 h behind HEAD** |
| Relay stack | `infra/relay/docker-compose.yml` | — | — | never deployed |
| macOS | — | — | — | not built |
| iOS | `apps/mobile/ios/App/App.xcodeproj` | — | — | scaffold only |

---

## 15. Blockers

### P0 — blocks real live usage

1. **The website cannot broadcast.** Mock mode on, no relay deployed, browser has
   no RTMP socket. The core thesis is undelivered on the surface a stranger
   actually visits. *(Deploy `infra/relay/` and set `VITE_LIVETAP_RELAY_URL` +
   `LIVETAP_MOCK_MODE=false`.)*
2. **No OAuth client IDs configured anywhere.** No account can be connected on any
   platform on any surface. Owner-only dependency.
3. **Multi-destination start — P0-CANDIDATE, NOT CONFIRMED.** One of two runs
   today reported `live on 1 of 3`. If real, a creator may believe they are live on
   three platforms and be live on one. **But both runs shared a receiver with a
   concurrent session** (§6 correction), so contention is an equally good
   explanation. Needs one isolated re-run before it is treated as a defect.

### P1 — important before alpha

4. **Both downloadable artifacts are ~8 hours stale** and predate six commits
   including two HIGH-defect fixes. Rebuild before anyone installs them.
5. **No session-discard action.** Five localStorage keys survive browser close;
   the next person on a shared machine sees the previous person's destinations.
6. **Android has never run on hardware.** Every mobile claim is build-time only.
7. **Frame rate unmeasured on real hardware** — 12.1–12.8 fps on this GPU-less host.
8. **Windows installer is unsigned** — SmartScreen will warn every installer.

### P2 — polish

9. macOS target declared but never built.
10. 30 commits unpushed; `origin/main` does not reflect the audited state.
11. **The completion gate records a reused receiver as PASS** rather than WARN
    (`verify-desktop-broadcast.mjs:496`), so a stale orphan satisfies a freshness
    check silently. Affects the trustworthiness of every gate run that found one
    listening, including two in this audit.
12. **`infra/relay/` cannot be deployed on this host as-is.** A system Caddy
    (pid 2924) holds 443, 80, 47443 and 2019; the relay's compose file brings up its
    own Caddy and will collide on all three of 443, 80 and 2019. This sits directly
    in front of the §16 item that moves WEB from 30% to ~70%, and deploying it also
    needs the owner's DNS and certificates — it is an owner decision, not a
    configuration change.

### FUTURE

11. Bond integration into the media path.
12. iOS beyond scaffold.
13. LinkedIn (no viable API path — documented as Level 4).

---

## 16. Shortest path to 100%

Ordered by unlock-per-unit-of-work. Items 1 and 2 are the owner's and block
everything downstream.

1. **Register one OAuth app (Twitch is the fastest — no review gate) and set the
   client id.** Unlocks account connection on desktop and web at once.
   → Destination integrations 35% → 70%.
2. **Deploy `infra/relay/` and flip the deployment out of mock mode.** One
   docker-compose stack plus two env vars. This single change is the difference
   between a demo and a product on the surface strangers visit.
   → Web 30% → 70%. Overall ≈ 50% → 62%.
3. **Fix the intermittent multi-destination start.** Root-cause why `tall`
   dropped and restarted four times in one run. → removes the last P0.
4. **Rebuild both artifacts at HEAD and attach the installer to a GitHub
   pre-release.** → Desktop 70% → 85%.
5. **Sideload the APK on one phone and run the journey once.**
   → Android 35% → 75%. Overall ≈ 80%.
6. **Add a "Forget this session" action** clearing the five keys.
   → Ephemeral 75% → 100%.
7. Sign the Windows installer; build macOS in CI. → ≈ 92%.
8. Wire Bond, or descope it honestly. → 100%.

---

## 17. Release recommendation

# C — FUNCTIONAL PROTOTYPE

with one surface close to **B — closed alpha**.

**Why not B overall.** The product thesis is *"go live without becoming a
broadcast engineer."* Today the only surface that goes live is the desktop app,
and the only way to connect a destination anywhere is to paste an RTMP URL and a
stream key — which is precisely being a broadcast engineer. The website, which is
where a stranger arrives, broadcasts nothing and tells them so.

**Why not D.** This is well past non-functional. The desktop app genuinely
captured through a real camera API, composed three different shapes from one
production, encoded H.264 and AAC, published real RTMP, survived a TCP-level kill
of one destination, and stopped cleanly — verified today by ffprobe decoding the
bytes off disk. 1,675 unit tests and 11 Playwright suites pass. The guest model is
real and the secret handling is genuinely careful.

**What would move it to A.** Two owner actions and one bug fix: one OAuth client
id, the relay deployed, and the intermittent multi-destination start resolved.
None of the three is large. All three are required.

---

---

## Appendix — one earlier finding withdrawn

An earlier session in this conversation saw `visual baselines > studio at desktop`
fail once and pass on re-run, and logged it as probable CPU contention while
explicitly declining to call it proven. **That hypothesis is now withdrawn in
favour of a better one**, supplied by the session that owns this worktree:

`de16128` added `clip-path: inset(calc((1 - var(--ltp-touchable)) * 50%))` to
`.ltp-band`. At full visibility that evaluates to `inset(0)`, which is *not* "no
clip" — it clips to the border box — while `.ltp-band--rail` sets
`overflow: visible` precisely because its lane paints outside that box. So every
band was clipped to its own edge from `de16128` until `18f7702` changed the open
end to `inset(calc(t * -100vmax + (1 - t) * 50%))`, a no-op at t=1 and a
byte-identical zero area at t=0.

Measured by that session at `act-moments` p=0.5, 390x844: the Moments mirror's box
is `[374, 577, 176, 207]` and the lane transform `-658.44px` **with and without**
the clip — identical geometry, and only the clipped build fails the click. A CSS
defect explains a reproducible failure better than contention does, and it is the
more useful explanation because it is actionable.

*Audited from the running system on 2026-09-15 at HEAD `18f7702`. No source file
was modified. Where this contradicts an earlier status document, prefer this one
and re-measure before trusting either.*
