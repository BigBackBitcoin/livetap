# LIVETAP — First-Time Creator Audit 3

# 114 / 150

**Auditor:** Team I (Ruthless Creator), auditing blind as a first-time streamer who has never seen this product.
**Date:** 2026-09-15
**Commit at start of testing:** `471d998` (working tree dirty; another agent was editing the repo during this run — `package.json` changed on disk mid-audit, so every finding below is against the build I made myself at the start, not necessarily against HEAD now).
**Build:** `npm run build -w @livetap/web` → `apps/web/dist`, served by `apps/web/scripts/preview-server.mjs` on port 4321.
**Driver:** Playwright/Chromium (repo's own install), 1440×900 desktop; 320/375/390/412×812 mobile with touch emulation; `--use-fake-device-for-media-stream` for camera tests.
**Caveat on performance:** this machine is contended (several agents running). Nothing below is a frame-rate claim.

**Method note on blindness.** I did not read `REAL_WORLD_ALPHA_READINESS.md`, the previous audits, `UX_POLISH_PASS.md`, `HANDOFF.md`, `CURRENT_PHASE.md`, `docs/release/**`, any `*CLOSURE*`/`*RETEST*` file, or the session git log before writing the scores above and the findings below. I read `LIVETAP_FIRST_TIME_CREATOR_AUDIT_RETEST.md` only afterwards, for the disagreement section at the end.

**Screenshots** are in `docs/qa/audit3-screens/` and referenced by filename throughout.

---

## Scores

| # | Category | Score | The one thing that would have earned the missing points |
|---|---|---|---|
| 1 | First Impression | **8**/10 | The "Ready" chip rendering whole inside the YouTube and Twitch tiles instead of being sliced by the tile edge. |
| 2 | Product Clarity | **9**/10 | The lede paragraph not being clamped to one line and cut mid-phrase on a phone. |
| 3 | Differentiation | **9**/10 | The Versus claims citing something a visitor can open, not `docs/qa/FRICTION_BENCHMARK.md`. |
| 4 | Interactive Experience | **7**/10 | GO LIVE surviving a double-tap, and working a second time after you end a stream. |
| 5 | Visual Quality | **7**/10 | No clipped text at any width I tested — the chips, the live dock, the 320 px nav. |
| 6 | Premium Feel | **7**/10 | Acts handing over without ~1,000 px of scrolling where no copy is on screen. |
| 7 | Streamer Appeal | **8**/10 | All six Moments reachable, or visibly scrollable, at 1440 px. |
| 8 | Professional Credibility | **7**/10 | No internal repo paths on the public page, and no invented hardware when permission is blocked. |
| 9 | Beginner Friendliness | **8**/10 | The blocked-camera state being named, and an obvious way to start a second stream. |
| 10 | OBS Switching Motivation | **8**/10 | The comparison readable end to end at normal scroll speed, with citations that resolve. |
| 11 | Multistreaming Clarity | **9**/10 | The noun: "Going live on 3 destinations", not "Going live on 3" next to a 0:00 clock. |
| 12 | Mobile Appeal | **7**/10 | The explanatory sentence readable, and the destination rail showing that it scrolls. |
| 13 | Trust | **9**/10 | Telling the truth in the blocked-permission case, as the landing page already does. |
| 14 | Desire to Try | **8**/10 | The golden path surviving a second attempt. |
| 15 | Desire to Download | **3**/10 | A download button for the Windows build that exists on disk right now. |
| | **Total** | **114**/150 | |

Nothing was scored unseen. Every category above was exercised against the running build.

---

## 1. The first five seconds (1440×900, no interaction)

**Screenshot:** `01-landing-5s.png`

By 5.1 s the page is fully painted and completely static — nothing is still moving, nothing is still arriving, no layout shift. A stranger sees, top to bottom: a wordmark and a six-item rail; the headline *"Go live everywhere. Without becoming a broadcast engineer."*; a two-sentence lede naming the category, the platforms and the action; two CTAs (*Use my camera*, *Try the web demo*) with a trust caption; and then a working demo — a video stage with a real picture, six destination tiles wired to it with green connector lines, a GO LIVE (DEMO) button, 16:9/9:16/1:1, Camera/Microphone/Screen toggles, six Moment cards, and a chat panel. A status bar pins *"Demo surface. Nothing is broadcast anywhere · 3 destinations · 2 formats · Idle · 0:00 · Free. Open source. Runs on your machine."*

That is an unusually complete and unusually honest five seconds. The thing the page is selling is on the page, running, above the fold.

**What is cut off at 5 s — CONFIRMED.** The "Ready" chips on the YouTube and Twitch tiles are sliced by the tile's right edge: the chip's right border is absent and the final letter is chopped. Measured: `span.lt-chip__label` has `scrollWidth 32` against `clientWidth 17` on those two tiles, at **1152, 1280, 1440, 1600 and 1920** px viewport widths (only at 1024, where the layout reflows, does it render whole). TikTok's tile — which carries a narrow 9:16 thumbnail instead of a wide 16:9 one — renders its chip correctly, which is what makes the two broken ones obvious side by side.
*Evidence:* `07-zoom-tiles-left.png`, `09-tile-1440.png`, `09-tile-1280.png`.

**Cramped, not broken.** The caption under GO LIVE ("Your turn. Tap GO LIVE. Nothing is broadcast from this page.") wraps to two lines of ~11 px in a column narrower than the button, and sits within a few pixels of the toolbar's bottom edge. `06-zoom-toolbar.png`.

## 2. Fifteen seconds

**Screenshot:** `02-landing-15s.png` — pixel-identical to the 5 s frame. Nothing auto-plays, nothing reveals itself on a timer.

Have they learned what this is and who it is for? Yes. The lede does the work explicitly: *"LIVETAP is a free, open-source live production app for streamers and creators. Connect YouTube, Twitch, TikTok and more, say what you are making, tap GO LIVE. One production, every platform, each on its own connection."* Category, audience, platforms, verb, and the differentiating claim, in three sentences. I cannot fault this at 15 s on a desktop.

## 3. Sixty seconds

**Screenshot:** `03-landing-60s.png` — again identical. The page waits for you.

Would they still be here? Only if they scrolled or clicked, and both pay off:

- Clicking **Use my camera** calls `getUserMedia` and puts the live 1280×720 picture into the stage **and into each destination thumbnail**, with TikTok's thumbnail correctly cropped to 9:16 while YouTube's and Twitch's stay 16:9. The caption changes to *"Your camera. Local only."* and the button to *"Stop my camera"*. This is the single most persuasive second on the whole site — the core claim demonstrated on your own face in about a second. **CONFIRMED**, `30-landing-usecamera.png`.
- Clicking **GO LIVE (DEMO)** on the landing demo works: status goes Idle → Excellent, the stage caption goes *"Ready on YouTube, Twitch and TikTok"* → *"Live on YouTube, Twitch and TikTok"*, the tiles turn to red Live chips, the connector lines turn red, the timer runs, and a demo chat message arrives. **CONFIRMED**, `C1-landing-live.png`, `C3-tour-1.png`.

**Would they still be here at 60 s of scrolling? — a real problem. CONFIRMED.** The page is 11,430 px tall at 1440×900 (≈12.7 screens). I sampled the top 260 px band every 200 px from 0 to the bottom. The band is empty — nothing but the fixed rail — across roughly **4,600 px of the 11,430 px page (~40%)**, in stretches of: y 400–1400 (1,000 px), 3000–3800, 4400–5000, 6000–6800, 7200–7800, 8600–8800, 9200–10000. The sticky demo stage stays on screen below, so the screen is never blank, but between acts there is up to **1.1 full screens of wheel travel with no words on the page**. I traced the mechanism: each act's band is `opacity: 0; visibility: hidden` outside its reveal window (`.ltp-band--lead`, confirmed by computed style at y=1200/1400 vs y=1600–2800), and consecutive windows do not overlap. One act fades out entirely before the next begins to arrive.

**Ghosting between layers — CONFIRMED.** At scroll positions where an act is mid-fade, its translucent panel is drawn over the sticky stage and you get two layers of text at once: in `13-whynot-1440.png` the Instagram/X/Facebook tiles and the TikTok tile are legibly visible *through* the "Why not the others?" panel; in `10-sec-8200-versus-mid.png` the Restream/StreamYard lines sit on top of the video stage. `10-sec-8400-versus-foot.png` shows the same row with its second line sheared off by the stage's top edge.

## 4. The product

### Onboarding — the best part of the product

Three steps, and it is genuinely excellent. `20-app-first.png`, `24-onb-step2.png`, `26-onb-step3.png`.

- Step 2 lists each platform with **how** you connect and **why**: *"Copy a key from TikTok's own live dashboard and paste it here. You press Go live in TikTok once LIVETAP is sending. TikTok is vertical, so LIVETAP sends it a vertical picture."*
- LinkedIn is present and refused: *"LinkedIn does not let an app like LIVETAP go live for you, so LIVETAP will not pretend it can. … LIVETAP is not one, and would rather say so than waste your evening."*
- **Continue** is correctly disabled with the reason stated: *"Pick one place to go live to continue."* **CONFIRMED** — Playwright's click timed out on a `disabled` button, which is the right failure.
- Step 3 ends with a plain-English summary of everything it decided for you.

### Camera — the product is less real than its own advert. CONFIRMED.

The landing page shows your camera. **The application never does.** I instrumented `navigator.mediaDevices.getUserMedia` at page-init and drove the full onboarding into the Studio with camera permission granted and a working device: **zero `getUserMedia` calls**. The preview is a synthetic canvas stream reading "DEMO PREVIEW / Main Camera / Simulated picture — this build is not broadcasting".

The cause is in the source and it is the default: `envMockMode()` in `apps/web/src/state/mockMode.ts` returns `true` unless `VITE_LIVETAP_MOCK_MODE === 'false'`, and `createEngine` in `apps/web/src/state/engine.ts` then selects `MockEngine`, which has no camera path. So the shipped default build's Studio cannot show you your own face. A visitor who clicks the hero's primary CTA, sees themselves, and then clicks through to `/app` is handed a purple card.

### The three output shapes — CONFIRMED working, with one that undercuts the pitch

The segmented control works and the preview box changes aspect exactly: 16:9 → 700×394 (ratio 1.778), 9:16 → 233×414 (0.563), 1:1 → 414×414 (1.000). `42-shape-0/1/2.png`. Correct `role="radio"` with `aria-checked` true/false, and named tooltips ("Widescreen 16 by 9").

But **9:16 is a centre crop, not a reframe. CONFIRMED.** In `42-shape-1.png` the preview reads **"EMO PREVIE"** and **"ated picture — this build is not broadca"** — the frame is simply cropped, so words are chopped at both edges. The underlying `video.videoWidth/Height` stays 1280×720 in all three shapes. The page three screens earlier promises *"One production. Every shape."* and *"LIVETAP reframes automatically"*; the only vertical preview the product offers demonstrates the opposite. (This may be a limitation of `MockEngine` rather than the real compositor — but the mock is the only engine the default build runs, so it is what every visitor sees.)

### Moments — CONFIRMED, with a discoverability defect

Six Moments (Starting Soon, Main Camera, Screen Share, Guest, Break, Ending), each with a plain description, tap to switch, *"Viewers see this"* on the active one, and *"Switching now shows viewers a brief cut"* while live. The Moments screen adds five layouts and the note *"Placement is saved per shape, so your vertical stream can be framed differently from your widescreen one"* — a detail a real streamer will notice.

**But at 1440 px the rail hides two of the six with no cue. CONFIRMED.** `.lt-momentstrip` measures `scrollWidth 900` against `clientWidth 700` — **200 px (22%) hidden**. "Break" is sliced in half at the rail's right edge and "Ending" is entirely invisible. There is no arrow, no fade, no gradient mask. At 1440 — an ordinary laptop width — a first-timer does not know two more Moments exist. `40-studio.png`, `51-golive-immediately.png`.

### Adding a destination — fine

`B-destinations.png`. Per-destination cards with "+ Add destination", real capability lines (*"16:9 · up to 2160p60"*, *"9:16 · up to 1920p30"*), Ready state, Remove.

### GO LIVE — CONFIRMED working, and well done

3-2-1 countdown with a Cancel, then per-destination Ready → Starting → Live with honest intermediate copy (*"Telling TikTok you're live…"*), a running timer, a red END in a persistent bottom bar, and the three shapes locked with a reason: *"Locked while you are live — platforms cannot change format mid-stream."* Live-region announcements say *"You are live on 1 destination."* then *"…2 destinations."* `51/52/53-golive-*.png`.

**Pressing GO LIVE with nothing set up — CONFIRMED, exemplary.** Via "Skip setup": the button is genuinely `disabled`, greyed, and the page says *"Nowhere to send this yet"* with an **Add destination** action and the line *"No destination is ready — that is the one thing LIVETAP cannot do for you."* `80-skip-setup.png`. This is the best empty-state copy in the product.

### Breaking a destination and recovering — CONFIRMED, best-in-class

The Health tab carries a **Demo failures** panel: *"These raise the same events a real failure raises, so you can watch LIVETAP keep the other destinations live."* — Drop YouTube, Drop TikTok, Make YouTube rough, Make TikTok rough, Unplug the camera, Break the picture. `60-health-idle.png`.

I dropped YouTube 10.4 s into a live stream. At +0.8 s:

> **YouTube · Reconnecting** — Trying again in 2 s (attempt 1 of 10)
> **WHY** The connection to the stream server dropped, usually because of your network.
> **DOING** LIVETAP is reconnecting automatically. Your other destinations keep streaming.
> **YOU CAN** Check your internet connection. If this keeps happening, lower your quality in Settings.
> [Stop trying] [Keep trying]

The stage pill went amber: *"One destination is reconnecting"* with *"Your other destinations keep streaming. LIVETAP is bringing this one back automatically."* TikTok never flinched. YouTube was back to **Live** by t = 16.3 s, ~5 s after the drop. `71-drop-0.png` … `71-drop-5.png`. I have not seen a streaming product handle this as well.

*Minor:* the six controls in that panel are styled two different ways for the same class of action — two bordered buttons and four borderless text labels.

### Stopping — CONFIRMED working, then CONFIRMED broken

END works. Bottom bar: *"Ending your broadcast — Telling your destinations the stream ended…"*, chips go to *"YouTube · Stopping / Telling YouTube the stream ended…"*. `96-end-settled.png`. It takes over ~7 s to complete, which is defensible.

**Then the Studio is dead. This is the worst defect I found — see Defect 1 below.**

## 5. Mobile (375, 390, 412 — and 320)

Measured at each width with touch emulation, then driven with a thumb's worth of taps.

**What is right, and it is a lot.** No horizontal page scroll at *any* width including 320 (`document.scrollWidth === window.innerWidth` on both the landing page and the Studio, at 320/375/390/412). A proper bottom tab bar in the app with five ≥44 px targets. Exactly **one** interactive element below the 44 px guideline anywhere in the Studio at any of the four widths: the `Manage destinations` text link at 24 px high. The Studio at 375–412 is genuinely thumb-usable: big preview, big shape pills, a full-width GO LIVE, everything reachable. `M375-05-studio.png`, `M412-06-studio-bottom.png`.

**What is wrong:**

- **The explanation of the product is cut off mid-sentence. CONFIRMED.** At 375 px, `.ltp-band__lede` renders at **20 px tall (one line)** while its content needs **80 px (four lines)** — `-webkit-line-clamp: 3`, `overflow: hidden`, **60 px / 75% of the sentence hidden**, with no ellipsis and nothing to expand. On screen it reads *"LIVETAP is a free, open-source live production app for"* and simply stops. The single sentence that tells a phone visitor what this is, is unreadable. `M375-01-landing.png`.
- **The landing destination rail is cut mid-card with no scroll cue.** At 375 the Twitch tile is sliced through its status chip (*"Not conne…"*); measured `li.ltp-dest` spanning x 240→460 against a 375 px viewport. Same at 390 and 412. `M375-01-landing.png`.
- **At 320 px the bottom nav clips "Settings".** `nav.lt-shell__nav` measures `scrollWidth 362` against `clientWidth 320`; the Settings item sits at x 303→362 and is sheared at the edge. `M320-05-studio.png`.
- Ordering: on a phone the demo comes first and the headline lands at y≈553 of an 812 px viewport — still on the first screen, but the bottom fifth of it. Defensible (show, don't tell), and I have not deducted for it.

## 6. What a first-timer does wrong

| What I did | What I expected | What happened |
|---|---|---|
| **GO LIVE with nothing set up** | A refusal that says why | Button genuinely disabled, *"Nowhere to send this yet"*, an Add-destination action, and *"No destination is ready — that is the one thing LIVETAP cannot do for you."* **Exemplary.** |
| **Pressed GO LIVE twice** (real mouse, same pixel, 150 ms apart) | The second press ignored | **The stream was cancelled, silently.** See Defect 2. |
| **Reloaded mid-flow (while live)** | A warning, or the stream restored | Stream torn down, back to idle, **no `beforeunload` guard at all** (`window.__bu === 0`: zero `beforeunload` listeners registered; `window.onbeforeunload` null) and no post-reload explanation. Destinations and setup do survive the reload. See Defect 3. |
| **Denied camera permission** (landing) | An honest message | *"No camera permission, so the sample picture stays. Nothing was recorded."* **Correct.** `A3-landing-denied.png` |
| **Blocked camera permission** (app) | The same honesty | **The app invented a camera.** See Defect 4. |
| **Resized to 320 px** | Cramped but usable | Usable, no sideways scroll, but the bottom nav clips "Settings". |
| **Tabbed through with the keyboard only** | Something to complain about | **Nothing to complain about.** See below. |

**Keyboard — genuinely strong, no deduction.** Both pages open with a skip link (*"Skip to the live surface"*, *"Skip to the main screen"*). Every one of the first 22 stops on the landing page and the first 20 in the Studio carried a visible `rgb(26,102,214) solid 2px` focus ring, in sensible DOM order, with real accessible names — GO LIVE announces itself as *"GO LIVE on 3 demo destinations"*, the shape buttons as *"Widescreen 16 by 9"*, the preview as *"Program preview, Main Camera"*. `A1-keyboard-landing.png`, `A2-keyboard-studio.png`. I could reach and operate GO LIVE with the keyboard alone.

---

## The defects, ranked

### Defect 1 — After ending a stream, you cannot start another one. CONFIRMED. Severity: critical.

**What I did.** Completed onboarding with YouTube + TikTok, tapped GO LIVE, confirmed both destinations Live, pressed END, waited.

**What I expected.** The stream ends; the destinations return to Ready; I can go live again.

**What happened.** Both destinations stay at **"YouTube · Ended / Ended"** and **"TikTok · Ended / Ended"** indefinitely — held through t+3 s, +10 s, +20 s, +30 s and **+45 s**. The Studio shows:

> ● **Not ready to go live**
> None of your 2 destinations is ready yet. **See what happened**
> [ GO LIVE (DEMO) ] *(greyed, `aria-disabled="true"`)*
> No destination is ready

Meanwhile the health pill *still* reads **"Stream is excellent"**, 45 s after the stream ended. Clicking **"See what happened"** lands on the Destinations screen — which shows each destination as **"In your next stream / Ended"** with the only actions being *Watch this destination* and *Remove*. Nothing there names the state or offers a reset.

The store is not actually stuck: simply visiting `/app/destinations` re-mounts and both immediately read **"Ready — Goes live when you tap GO LIVE"**, and returning to the Studio (or reloading) restores a working GO LIVE. So this is a **stale Studio-screen state**, not a real platform state.

**Why it matters most.** It is on the golden path. Every single person who tries this product, ends their first stream, and wants a second one hits a dead screen that tells them nothing is ready, with no visible way out. The fix is invisible (navigate away and back).

*Evidence:* `B1-post-end-stuck.png`, `B4-watch-dest.png`, `B5-after-reload.png`, `B6-golive-after-end-clicked.png`.

### Defect 2 — Double-tapping GO LIVE silently cancels the stream. CONFIRMED. Severity: high.

**What I did.** Clicked the exact centre of the GO LIVE button (638, 686) with a real mouse event, then clicked the same pixel 150 ms later.

**What I expected.** The second click swallowed, or an explicit cancel I can see.

**What happened.** 150 ms after the first click, `document.elementFromPoint(638, 686)` returns **`SPAN.lt-golive__cancel` — "Cancel"**. The countdown control takes over the same pixels the GO LIVE label just occupied, so the second tap of a double-tap lands on Cancel. Ten seconds later both destinations are back to **Ready**, the button reads **GO LIVE (DEMO)**, and I grepped the entire page for `/cancel/i`: **no match anywhere**. Nothing tells the user their stream was cancelled.

A nervous first-timer double-taps the big blue button, then sits looking at a page that appears unchanged, not knowing whether they are live. For a live-streaming product that is the worst possible ambiguity.

*Evidence:* `90-doubletap.png`, `91-doubletap-10s.png`, `82-double-tap.png`, `83-double-tap-settled.png`.

### Defect 3 — The page offers no download, and tells you not to look for one. CONFIRMED. Severity: high (commercial).

**What I did.** Read the foot of the public page.

**What it says, verbatim:**

> *"There is no download yet: desktop and mobile builds are not published. The web demo is real and runs in your browser. Watch the repository and GitHub tells you the day the first build ships."*

with the CTA **"Watch on GitHub for the first build"**. Source: `apps/web/index.html:674`.

**What is actually true.** `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` exists — 230,661,718 bytes, alongside `latest.yml`, a `.blockmap` and `win-unpacked`. An installable Windows build is sitting on disk.

So the page does not merely fail to offer the download; it spends a paragraph persuading the visitor that the thing they came for does not exist. Everything else about this page argues *"you could be live in a minute"*, and the last thing it says is *"come back another day."* That is why Desire to Download is a 3 and not a 6: the 3 points are for the sentence having been honest when it was written, and for the GitHub-watch fallback being a real if weak conversion.

*Evidence:* `12-footer.png`.

### Defect 4 — With camera permission blocked, the app invents a camera. CONFIRMED. Severity: high (trust).

**What I did.** Reproduced Chrome's real "blocked" state: `getUserMedia` rejects `NotAllowedError`, and `enumerateDevices` returns entries that exist but carry empty labels — exactly what Chrome does after a user clicks Block. Then walked onboarding to step 3.

**What I expected.** The same honesty the landing page shows.

**What happened.** Step 3 reads:

> **Camera** — `Camera 1` — *"This is your Main Camera Moment."*
> **Microphone** — `Microphone 1` — *"Say something — the level should move."*

No mention of the denial anywhere. The app fabricated names for devices it cannot open, and pointed the user at a level meter that will never move. It then lets you press **Open Studio** as if everything is configured.

The two neighbouring cases are handled correctly, which makes this worse, not better: the landing page says *"No camera permission, so the sample picture stays"*, and when `enumerateDevices` returns an empty list the app correctly says *"No camera found — using a test pattern"* with a **Look again** button. Only the state a real user actually produces — clicking Block — gets the wrong answer.

This is the one place in a relentlessly honest product where it states something untrue.

*Evidence:* `A5-deny-faithful.png` (blocked), `A4-app-denied-step3.png` (no devices), `A3-landing-denied.png` (landing, correct).

### Defect 5 — Clipped text in the first thing you see. CONFIRMED. Severity: medium.

The "Ready" chip on the YouTube and Twitch hero tiles is sliced by the tile edge at 1152/1280/1440/1600/1920 px (`scrollWidth 32` vs `clientWidth 17`). It is in the hero, at every common desktop width, on the two most recognisable brands on the page. `09-tile-1440.png`.

### Defect 6 — The live destination dock is visually broken. CONFIRMED. Severity: medium.

Compare `54-chips-ready.png` (calm, bordered, legible) with `55-chips-live.png`:

- A stray grey **"‖"** glyph floats to the left of each chip, outside it, unlabelled and unexplained.
- Two lines of text ("YouTube · Live" / "Sending to this destination") are crammed into a 42 px solid-red pill, and the second line rides its lower edge.
- **"Stop this destination"** — the only per-destination stop, a destructive action — is a `lt-btn--ghost` with no border, no background and no underline at rest (measured 152×36). Next to a caption in the same grey, it is indistinguishable from prose. In the calm Ready state the equivalent slot holds a properly underlined blue link.

Going live makes the status panel look worse than standing by.

### Defect 7 — Internal repo paths printed on the public marketing page. CONFIRMED. Severity: medium.

The Versus section's evidence lines read, on the live page a stranger sees:

- *"Counted from the OBS Quick Start Guide. See docs/qa/FRICTION_BENCHMARK.md"*
- *"Measured by the golden-path tests. See docs/qa/FRICTION_BENCHMARK.md"*
- *"One line each, from docs/research/COMPETITOR_FAILURE_DATABASE_A.md. Every line carries its own section."*

The strongest competitive claims on the site — 14 concepts vs 6 taps — rest on citations no visitor can open. It reads as an internal build that shipped by accident. `13-whynot-1440.png`.

### Defect 8 — Reloading while live has no guard and no explanation. CONFIRMED. Severity: medium.

Zero `beforeunload` listeners are registered (instrumented `window.addEventListener` at page-init: `__bu === 0`; `window.onbeforeunload` null). Ctrl+R while live tears the broadcast down with no confirmation, and after the reload the app says nothing about what happened — it just looks idle. Destinations and setup do survive, which is right. A browser reload genuinely must end the encoder; the defect is the silence on both sides of it.

### Defect 9 — Ambiguous landing copy: "Going live on 3". CONFIRMED. Severity: low.

`apps/web/src/public/main.ts:663` renders a bare count. On screen it sits directly under GO LIVE, a few centimetres from a clock reading **0:00**, and reads as a countdown rather than a destination count. The app's own version (`Studio.tsx:378`, via `nameDestinations`) gets it right — *"Demo — going live on 2, and nothing is broadcast anywhere"* — and so does the screen-reader string at `main.ts:1188` (*"Going live on 3 destinations."*). The visible landing string is the only one missing the noun. `12-footer.png`, `05-scroll-03.png`.

### Defect 10 — Smaller things, all CONFIRMED

- **Moments rail hides 2 of 6 at 1440 px** with no scroll affordance (200/900 px hidden). *(Also counted under Streamer Appeal.)*
- **"YouTube · Ended / Ended"** — the same word as both status and detail.
- **"In your next stream / Ended"** on the Destinations screen — internally contradictory.
- **Health pill stale after END** — *"Stream is excellent"* for 45 s after the stream ended, and *"Live"* + *"Stream is excellent"* during the Ending handshake.
- **The Studio's tour offer covers the Demo-mode banner** at first paint (`27-onb-adv-0.png`), and the landing Quick-tour panel overlaps the Simple/Pro control (`C3-tour-1.png`).
- **Demo-failures panel** mixes bordered and borderless buttons for six actions of the same kind.
- **Onboarding step 1 cards** have ragged bottoms within a row, and the lower half of a 900 px viewport is empty.
- **`Manage destinations`** is the only sub-44 px interactive element on mobile (24 px high).

---

## What is genuinely good, recorded so the scores make sense

I am hard to impress and these still impressed me:

1. **The failure story.** A *Demo failures* panel that invites you to break the product, a WHY/DOING/YOU CAN reconnect card, "Your other destinations keep streaming", and a real 5-second recovery. No competitor shows you this.
2. **The refusals.** LinkedIn declined rather than faked. *"TikTok, Instagram and X publish no live chat API, so nothing from them appears here."* *"No destination is ready — that is the one thing LIVETAP cannot do for you."* *"Locked while you are live — platforms cannot change format mid-stream."*
3. **Accessibility.** Skip links, a visible focus ring on every one of 42 tab stops I checked, correct radio semantics with `aria-checked`, meaningful accessible names, live-region announcements. This is usually the first thing to be missing and here it is the last.
4. **The landing camera demo.** Your own face on the stage and in six destination thumbnails, correctly cropped per platform, in about a second, with no account.
5. **Mobile discipline.** Zero horizontal overflow at 320/375/390/412, one sub-44 px target in the whole Studio.
6. **Zero console errors and zero page errors** across every flow I drove — landing, onboarding, studio, go-live, drop/recover, end, four mobile widths.

---

## Where I disagree with the previous retest

*Read only after the scores above were written.*

I read `docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_RETEST.md` after finalising the table above. The disagreements below are findings, not reconciliations — where we differ, my number is what I measured on the build I made myself.

**The retest scored 132/150 on 2026-09-14 against production `livetap.vercel.app`. I scored 114/150 against a local build of commit `471d998`. Delta: −18.**

Two honest caveats before the disagreements. First, the retest says so itself, in its own words: *"the retest scorer is the same builder that closed the audit, so the number is a self-assessment."* That is a creditable disclosure and I am not treating it as a gotcha. Second, we tested different artefacts — deployed production versus a build from this working tree — so some divergence is legitimate. Where it matters I have checked that the defect lives in the source rather than in my deployment, and I say so.

| Category | Retest | Mine | Why we differ |
|---|---|---|---|
| Desire to Download | 7 | **3** | The substantive disagreement. See below. |
| Interactive Experience | 10 | **7** | They wrote *"every control answers at every chapter"*. Two controls do not: GO LIVE cancels itself on a double-tap with no message, and GO LIVE will not run a second time after END. Neither is a chapter-level check, so their instrument could not have caught either. |
| Premium Feel | 9 | **7** | They assert *"no dead band"* and *"no dead scroll"*. Their metric is whether a band is inside the viewport at each chapter anchor; mine is whether any copy is on screen at every 200 px of scroll. On the second metric ~40% of the page is empty in the top band, with stretches of 1,000 px. Both measurements can be true at once; they measure different things, and the reader experiences mine. |
| Visual Quality | 9 | **7** | Their evidence is `bandInside: true` at every chapter on every viewport. That is a statement about band *containers*. It says nothing about text clipped inside a component — the "Ready" chip inside a hero tile, the two-line dock chip inside a 42 px pill, the nav item inside a 320 px bar. All three are clipped on my build, and none would move `bandInside`. |
| Professional Credibility | 8 | **7** | Neither the retest nor its remaining-issues list mentions that `docs/qa/FRICTION_BENCHMARK.md` and `docs/research/COMPETITOR_FAILURE_DATABASE_A.md` are printed on the public page as the citations for the Versus numbers. |
| Mobile Appeal | 8 | **7** | We disagree about *which* mobile problem matters. Their listed issue is *"panels cover the desk on phones for two chapters"*, recorded as decided intended behaviour — I did not deduct for that. My deduction is the lede clamped to one line and cut at *"app for"* at 375/390/412, which the retest does not mention and which removes the sentence that explains the product. |
| Trust | 9 | **9** | Same number, different grounds. They credit the trust copy, and they are right. I deducted the point they did not test: with camera permission **blocked**, the app reports `Camera 1` and `Microphone 1` as though both work. |
| OBS Switching Motivation | 8 | **8** | Same number, different reason. They capped at 8 because the benchmark refuses to assert an OBS click count — a good reason. I capped at 8 because the measured claims cite files a visitor cannot open. |
| First Impression | 9 | **8** | I agree with their evidence: nothing covers the headline, at any width I tried. My one-point deduction is the clipped "Ready" chip in the hero at five desktop widths — a defect their checks were not looking for. |

### The disagreement that matters: Desire to Download

The retest scored 7 and justified it: *"There is still nothing to download; the honest path is 'Watch on GitHub for the first build'. Capped until a build ships."* On 2026-09-14 that was correct and I would have scored it the same way.

A build has since shipped. `apps/desktop/release/LIVETAP-0.1.0-win-x64.exe` is 230,661,718 bytes on disk, with `latest.yml`, a blockmap and `win-unpacked` beside it. The page still says, at `apps/web/index.html:674`:

> *"There is no download yet: desktop and mobile builds are not published."*

The honest sentence became a false one, and nothing on the page noticed. That is why 7 became 3.

The more useful finding is the *mechanism*. The retest records this item as **"EXTERNAL / honest limit"** in the closure matrix (B-004/B-005) rather than as an open task — filed as a permanent fact about the world instead of a thing that would one day need changing. That classification is exactly what let a now-untrue sentence survive the event it was waiting for. Anything capped as an external limit needs a trigger attached to it, or it becomes a lie on a schedule.

### The structural disagreement

Every property the retest's harness checks, I independently confirmed on my build: no horizontal overflow at 320/375/390/412; the headline uncovered; nothing goes live unasked; zero console errors and zero page errors across every flow I drove. **Their assertions hold.**

All ten of my defects sit in the gaps between those assertions. The harness asks *"is the band inside the viewport"* and never *"is the word inside the chip"*. It asks *"does GO LIVE go live"* and never *"does it go live twice"*, or *"what does the second tap hit"*. It grants camera permission and never blocks it.

So the gap between 132 and 114 is not mostly a disagreement about taste. It is the difference between a suite that verifies the paths it was written to verify — 88/88 green, and I believe it — and a stranger pressing the button twice. The retest's own final line anticipates this and is right: *"An independent re-audit by the original auditor is the real acceptance test."* This is that re-audit, and the honest summary is that the product is better than 59/150 by a very long way, is not yet 132/150, and cannot currently be used to stream twice in one sitting.
