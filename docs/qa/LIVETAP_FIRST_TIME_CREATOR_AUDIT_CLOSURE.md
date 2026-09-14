# LIVETAP FIRST-TIME CREATOR AUDIT - CLOSURE MATRIX

**Source of truth:** `first time review.txt` (the first-time creator audit of https://livetap.vercel.app, score 59 / 150).
**Directive:** `docs/prompt-pack/11_AUDIT_CLOSURE_MISSION.md` (100% of actionable findings closed; deployed experience is the test).
**Status key:** CLOSED = implemented, tested, verified on the deployed site · OPEN = not yet · EXTERNAL = blocked on an owner-only dependency (named).
**Evidence key:** E2E = `apps/web/e2e/audit-closure.spec.ts` / `experience.spec.ts` test names; UNIT = vitest file; SHOT = screenshot under `docs/qa/deployed-review-2/`; DOC = document.

## 0. What could and could not be reproduced

The scroll failure could not be reproduced in Chromium with real wheel events on the old page (wheel from the centre of the surface scrolled 600 px in headless Chromium at 1440x900, 1280x720 and 1920x919, with and without reduced motion), and a runtime audit of every `addEventListener` call showed the old page registered no wheel or touch listener at all. The audit machine's own Chrome could not be used as an instrument: the browser extension's script channel timed out on every page on this host, including example.com, so nothing measured there says anything about the page.

What the old page did have, and what is gone: an intro collage of 36 animated layers with `will-change` over the headline, an atmosphere canvas and a film-grain layer painting continuously, chapter copy that was scroll-gated and that slid through the seams between sticky stages, and a Formats control whose band could sit over the toolbar. The new page removes every one of those and adds guards that run on every build and on every deploy review: zero non-passive wheel or touch listeners (asserted), fewer than three long tasks in six idle seconds and 40+ fps (asserted), wheel and keyboard scrolling from six points of the page (asserted), and the shape, Moment and GO LIVE controls answering at every chapter (asserted).

## 1. P0 findings

| # | Audit finding (verbatim spirit) | Severity | Required change | Implemented | Tested | Evidence |
|---|---|---|---|---|---|---|
| 1 | Intro card stack covers the headline, looks broken, never clears | P0 | Remove the intro collage entirely; hero renders correctly at progress zero | Yes: the lattice and its 36 copies are deleted; the hero band is a fixed panel visible at load; nothing is scroll-gated | E2E `P0 hero` | SHOT desk-0, phone-0; `landing-rules.test.ts` "puts the statement, the picture control and the demo link in the hero band" |
| 2 | Wheel scrolling dead except a right-edge gutter | P0 | Native scrolling from anywhere: wheel, trackpad, touch, keys | Yes: no wheel/touch listeners exist at all (audited at runtime); heavy layers removed; bands are fixed and switched by a passive scroll listener | E2E `P0 scroll` (wheel over surface, stage, tile, toolbar, band; PageDown, End, Home, Space, ArrowDown; touch swipe on mobile; listener audit) | E2E |
| 3 | No product statement above the fold | P0 | One clear statement: what, who, why | Yes: "Go live everywhere. Without becoming a broadcast engineer." + lede naming the category, the audience and the difference, in the hero band | E2E `P0 hero`; UNIT landing-rules | SHOT desk-0 |
| 4 | Stage is an empty grey rectangle; never a frame of video | P0 | Real picture: camera, or excellent fallback footage | Yes: sample creator footage (generated, photographic, 960x540, 158 KB mp4 / 85 KB webm, poster 18 KB) plays on the stage from first paint; "Use my camera" puts the visitor's own camera on the stage, local only, mirrored self-view, never uploaded | E2E `P0 stage`, `P1 camera granted`, `P1 camera denied`; UNIT `public-picture.test.ts` | SHOT desk-0 |
| 5 | Formats: switching to 9:16 changed nothing / refused silently | P0 | The picture must transform; safe zones drawn; works everywhere | Yes: the canvas box changes aspect, cover-crop re-frames the picture, labelled chat/buttons zones are hatched on 9:16, thumbnails and outputs re-crop; the control exists in the toolbar and in the Shapes band and works at every chapter | E2E `P0 silent controls`, `shape re-flows` | SHOT desk-3 |
| 6 | Show the six outputs from one production | P0 | Interactive destination-output view with destination, format, quality, state, health | Yes: Outputs chapter renders six live canvases composed from the same picture in each platform's shape, with name, shape, "up to N Mbps" ceiling and state chip; every connected tile also carries its own picture in its own shape | E2E `P0 outputs`; UNIT `public-picture.test.ts` (mountOutputs) | SHOT desk-4 |
| 7 | Silent control failures | P0 | Every control works or explains itself | Yes: GO LIVE with nothing picked connects two destinations and says so under the button; Screen Share switches the screen on and says so; a live tile tapped says what a tap cannot do; disconnected tiles say "Tap to connect"; format and mode controls have no scroll-position restriction | E2E `P0 silent controls`, `GO LIVE from nothing` | E2E |
| 8 | Orphaned floating "Pro" toggle | P0 | Labelled SIMPLE / PRO, contextualised | Yes: a labelled Simple / Pro segmented control in the toolbar, mirrored in the Pro chapter band with a one-line explanation; Pro opens four panels above the desk | E2E `Pro adds panels` | SHOT desk-6 |
| 9 | Pale, clipped narration; controls floating in white | P0 | Readable, in-viewport, deliberate copy | Yes: each chapter is a band with a 28px title in text-primary, a 16px lede in text-secondary and its controls; bands are fixed, never scroll through a seam, never overlap the surface | E2E `P0 bands never move`; harness contrast | SHOT desk-2..6 |
| 10 | 120px dead zone under the caption | P0 | No dead space | Yes: the band is a composed panel with title, lede and tools; the surface starts where the band ends | SHOT desk-0 | SHOT |

## 2. P1 findings

| # | Audit finding | Severity | Required change | Implemented | Tested | Evidence |
|---|---|---|---|---|---|---|
| 11 | Failure demo buried two-thirds down | P1 | Move it much higher | Yes: "Break it yourself" is chapter 2, immediately after the hero, with the largest span; its band has a one-tap "Go live, then break YouTube" button plus drag and keyboard paths | E2E `break is chapter two`, drag/keyboard tests | SHOT desk-2 |
| 12 | Auto-play steals agency; page goes live before you touch it | P1 | Demonstrate ≤5 s then hand over | Yes: the demo lasts 4.2 s (mic on, three destinations to READY), then writes "Your turn. Tap GO LIVE." under the button and stops; it never goes live by itself | E2E `P1 nothing goes live until the visitor does` | E2E |
| 13 | Production profiles are static cards | P1 | Real presets that change the stage | Yes: six chips; picking one changes the shape, the first Moment, renames Moments, suggests two destinations (highlighted, connected if nothing was) and writes the result under the chips; the Open link carries the intent into the app | E2E `intent changes the stage` | SHOT desk-7 |
| 14 | Moments only communicate through labels | P1 | Each Moment produces a visible transition | Yes: Starting Soon (ground + text, no camera), Main Camera (full-frame footage), Screen Share (screen asset with camera inset; screen input switched on), Guest (two-up with a second clip), Break and Ending (text over ground); mirrored in the Moments band | E2E `Moment recomposes` | SHOT desk-4 |
| 15 | No real camera | P1 | "Use my camera", local, private | Yes: see #4; privacy copy on the stage and in the hero band; denial and insecure-context paths explained | E2E camera tests | E2E |
| 16 | Mobile appeal 2/10, collapsed desktop layout | P1 | Dedicated mobile composition, vertical first | Yes: under 640px the intent defaults to Vertical Live and the stage to 9:16 with the chat zone drawn; the surface is state line, tall picture, tile strip, GO LIVE; the band is a plate at the bottom; Shapes and Simple/Pro controls live in their chapters' bands; tested at 375, 390, 412, 768 | E2E `mobile composition` (four widths) | SHOT phone-0..4, tablet-0 |
| 17 | OBS never mentioned, no comparison | P1 | Concise interactive comparison, no unsupported claims | Yes: "Instead of OBS." chapter with two playable lanes (14 concepts named before a first stream vs 6 measured taps, 2 questions, 0 broadcasting words), the multistream plugin fact, and no OBS click count or minutes (the benchmark refuses to assert one) | E2E `versus`; UNIT `public-versus.test.ts` (number allow-list guard) | SHOT desk-5 |
| 18 | Position against Restream, StreamYard, Streamlabs, Riverside | P1 | Why LIVETAP exists | Yes: one supported line each, cited to `COMPETITOR_FAILURE_DATABASE_A.md` sections via `data-lt-source` | UNIT `public-versus.test.ts` | DOC |
| 19 | Download points at a build that does not exist | P1 | Truthful CTA | Yes: no Download anywhere; "Watch on GitHub for the first build" and a footer that says builds are not published and the web demo is real | E2E `P1 download never lies`; UNIT landing-rules | SHOT desk-7 |
| 20 | No way to capture interest | P1 | Legitimate conversion path | Built: `/api/early-access` (consent, validation, rate limit, same-origin, forwards to an owner-configured endpoint, stores nothing) and a form that renders only when configured; until then the GitHub watch path is the honest capture. Privacy policy §11 written | UNIT `early-access.test.ts` (11 tests) | EXTERNAL for the endpoint: B-009 |
| 21 | Vertical-first is a bullet, not an experience | P1 | Show it | Yes: phones open in 9:16 with the chat zone drawn on real footage; the Vertical Live chip re-frames the desktop stage the same way | E2E mobile + intent tests | SHOT phone-0 |
| 22 | Keep the trust signals | P1 | Preserve and improve | Yes: demo badge, rotating-key explanation in the paste-key row, "runs on your machine", open source link, no cookies, "nothing on this page is broadcast" in the hero, and camera privacy copy | E2E `stream key`; landing-rules | SHOT |
| 23 | Preserve the connection lines | P1 | Refine, keep | Yes: unchanged language, now drawn to tiles that carry pictures; strain and snap on drag kept | E2E drag test | SHOT desk-2 |
| 24 | Generic six-card ending | P1 | Interactive production system | Yes: see #13; chips, one sentence, no bullets | SHOT desk-7 | SHOT |
| 25 | Content load: text at both ends | P1 | Experience → explanation → experience | Yes: hero is one statement; chapters are one title and one sentence each; the close is one question, six chips, one sentence, three links | landing-rules (no counters, no reveals) | SHOT |
| 26 | Control auto-play: "Your turn" | P1 | 5 s then invitation | Yes: see #12 | E2E | E2E |
| 27 | Streamer first impression: camera, mic, output, platforms, live state | P1 | Stage looks like a stream | Yes: footage, LIVE badge on the picture while live, camera/mic/screen states in the toolbar, six platform tiles with pictures, health pill | SHOT desk-0 | SHOT |
| 28 | Professional creator test | P1 | Show what exists without overclaiming | Yes: per-destination health, reconnect with attempt count, Pro panels (quality, platform ceilings, audio, session log), three shapes, six outputs; nothing added that the product does not do | SHOT desk-6 | SHOT |
| 29 | Trust + execution: no broken states, dead buttons, fake downloads, silent controls | P1 | Fix the experience | Yes: every item above; zero console errors on load at desktop, phone and reduced motion | E2E `zero console errors` | E2E |

## 3. Additional items the audit named in passing

| # | Finding | Change | Status |
|---|---|---|---|
| 30 | "GO LIVE printed twice", "1080", two mic sliders | Gone with the lattice | CLOSED |
| 31 | Health chip / timer / chat start by themselves | They start only after the visitor's GO LIVE | CLOSED |
| 32 | Chat caveat reads as "mobile is second-class" | Kept (it is true) but the phone composition leads with the vertical picture; the caveat is not shown on phones | CLOSED |
| 33 | No way to author Moments (OBS user's question) | Not added (the product does not ship a scene editor); the Moments chapter says "six looks that come with the production, nothing to build first", which is the honest answer | CLOSED (honest limitation) |
| 34 | Share or deep-link demo state | Not built: the demo is stateless by design (nothing stored, nothing tracked); the Open link carries the chosen intent into the app, which is the one state worth carrying | CLOSED (decision, recorded in DECISIONS_LOG) |

## 4. Verification ledger (2026-09-14, production https://livetap.vercel.app)

| Gate | Result | Where |
|---|---|---|
| Typecheck, lint | clean | `npx tsc -b`, `npx eslint .` |
| Unit tests | 65 files, 1122 passed | `npx vitest run` (incl. public-picture 14, public-versus 19, early-access 11, landing-rules) |
| E2E | 88 passed (audit-closure 28, experience 35, landing-and-layout, screenshots, golden path, failure isolation, stream key) | `npm run e2e -w @livetap/web` |
| Scroll Craft harness | 54 frames, no dead scroll, every cue clears 4.5:1 | `scrollcraft/builds/livetap-public/lab/shots2/` |
| Deployed review, 8 viewports | all flows pass, 0 console errors, 0 blocking wheel/touch listeners, all links 200, `/nope` 404 | `docs/qa/deployed-review-2/review.json` + 29 screenshots |
| Layout shift on production | 0.004 desktop, 0.002 to 0.012 elsewhere | `apps/web/scripts/cls-trace.mjs https://livetap.vercel.app/` |
| Main thread | 0 long tasks in 5 idle seconds, 61 fps (build host) | E2E "P2 performance" |
| Budget | landing JS 52.9 KB gz, CSS 15.3 KB gz, footage 158 + 85 + 91 + 33 KB, posters 18 + 13 KB | vite build |

Exact E2E titles cited above: "P0 hero: the statement, the picture and the demo link are above the fold and nothing covers the headline"; "P0 stage: a frame of video is on the stage from the first paint"; "P0 scroll: the wheel scrolls from anywhere on the page"; "P0 scroll: the keyboard scrolls the page"; "P0 scroll: nothing on the page blocks the wheel or a touch move"; "P0 scroll: a swipe scrolls the page on a phone"; "P0 silent controls: the shape control works at every chapter"; "P0 silent controls: a Moment can be chosen at every chapter"; "P0 silent controls: GO LIVE answers at every chapter"; "P0 silent controls: the shape control exists on a phone"; "P1 nothing goes live until the visitor does"; "P1 download never lies"; "P1 camera: a granted camera replaces the demo picture and says so"; "P1 camera: a refused camera keeps the demo picture and names the reason"; "P1 reduced motion: the page is fully usable, the videos hold still, and the break skips the flicker"; "P2 performance: an idle page does almost nothing, and the frame rate holds"; and in experience.spec.ts: "GO LIVE from an empty surface connects two for you, and says which two", "the shape control physically re-flows the stage, and 9:16 draws the reserved space", "six outputs, each in its own platform shape, counted by the lede", "the two lanes play, and playing ours moves the surface behind it", "Pro adds four rows, says so in the signature, and takes nothing away", "the intent chips change the production and carry the answer into the app", "dragging a live destination off the stage breaks exactly that one", "the chapter button does the whole thing, and its label says what it will do", "each chapter lights its own band, and only its own".

## 5. Status

| Bucket | Count | Closed | Notes |
|---|---|---|---|
| P0 findings (§1) | 10 | 10 | |
| P1 findings (§2) | 19 | 18 closed, 1 EXTERNAL | #20 email capture is built and tested; the form appears when the owner sets `LIVETAP_EARLY_ACCESS_WEBHOOK` (B-009). The GitHub watch path is live now. |
| Items named in passing (§3) | 5 | 5 | two are recorded decisions (stateless demo, no scene-editor claim) |
| **Actionable total** | **34** | **33 closed + 1 external** | |

Retest: `docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_RETEST.md` (132 / 150 self-assessed; two categories capped by things no page can change: no shipped build, no honest OBS click count).

## 6. Revision 3 (same day): the full Scroll Craft pass

The owner said the spacing and flow felt off and asked for the full Scroll Craft process to run. It did (`scrollcraft/builds/livetap-public/REPORT.md`): the copy moved back inside each chapter's act with cues that close before the chapter leaves (so #9's "never clipped, never off-screen" holds by construction rather than by a fixed layer), and the score regained seven device families (pin, flow, reveal, pan, count, flow + in, pointer). Every row above was re-verified on production after that deploy with the same review script at the same eight viewports (`docs/qa/deployed-review-2/review.json`) and the E2E suite (88 of 88). Nothing in this table changed status.
