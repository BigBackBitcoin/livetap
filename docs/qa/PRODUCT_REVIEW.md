# LIVETAP — RUTHLESS PRODUCT REVIEW

**Reviewed:** 2026-09-12 · **Surface:** `https://livetap.vercel.app` (production build, mock mode)
**Method:** Playwright, Chromium, 1440×900 / 834×1194 / 375×812, dark and light, 30 screenshots in
`docs/qa/review-screenshots/`, every one looked at. Measurements (bounding boxes, computed styles,
scroll geometry, tab order) taken in the page, not estimated.
**Judged against:** `docs/prompt-pack/09_LIVETAP_NORTH_STAR_CORRECTION.md`,
`docs/design/PRODUCT_SPEC.md` §2–§4, `docs/design/DESIGN_SYSTEM.md` §0,
`docs/qa/FRICTION_BENCHMARK.md`, `docs/research/SWITCHING_TRIGGERS.md` §1.

---

## Verdict: **NOT-YET**

The thesis is right and the architecture under it is genuinely better than OBS: six taps to a
two-platform multistream, zero broadcasting vocabulary on the path, one production fanned into 16:9
and 9:16 automatically, and — the differentiator that matters most — a destination that drops,
reconnects in 1.3 s and comes back while the other never leaves LIVE, with a four-field humane error
card and one button (`11-studio-one-destination-reconnecting-1440-dark.png`). That is T1 and T2 from
the switching-triggers research, answered, working, in a browser. Nobody else in the category has
shipped that shape.

It is NOT-YET because the product fails at the two moments it exists for. **You cannot end a live
stream** — the END button is rendered `aria-disabled` the instant you go live, and clicking it does
nothing (verified by force-click on the deployed build). **You cannot see a failure** — the
production-level humane error card for a lost camera or a dead encoder is auto-placed into an
implicit grid row 288 px below the fold, so the camera dies, the health pill keeps saying "Stream is
excellent", and nothing visible changes. Alongside those, the pre-flight row tells a live streamer
"No destination is ready" with a red dot while two destinations are LIVE; GO LIVE itself is below
the fold at all three breakpoints; a page reload turns a connected destination into "TikTok is
missing something"; and the marketing page sells "Tap GO LIVE" without ever saying the hosted build
broadcasts nowhere. Every one of these is a trust event, and this is a product whose entire pitch is
that it can be trusted with a live show. Fix the seven P0s and this is a SHIP-WITH-FIXES.

**Status after this review:** all 7 P0 and 12 of 15 P1 findings are fixed in `apps/web/src`, plus
three further defects found while verifying them (§6). The remainder are listed below with the exact
change; the seven that need `packages/*` or `vercel.json` are described rather than made. All 20 E2E
specs, 57 unit tests, `tsc --noEmit` and `eslint apps/web` pass, the ≤6-tap golden path is intact,
and the two desktop visual baselines were regenerated deliberately.

**The screenshots in `docs/qa/review-screenshots/` are the as-reviewed state of
`livetap.vercel.app`, not the fixed state** — they are the evidence for the findings below. The
fixed state is measured in §7 and captured in the regenerated
`apps/web/e2e/__screenshots__/baseline-*.png`.

---

## 1. The seven personas

### 1.1 Complete beginner ("I want to go live on YouTube tonight")

**Tries first:** the big red *Open LIVETAP* on the landing page, then taps a picture of a camera
labelled **Talking**, then **YouTube**, then **Continue**. That is the best onboarding in this
category — `03-onboarding-step1-intent-1440-dark.png` asks one question in plain words and answers
it with consequences ("Auto vertical crop for TikTok and Shorts"), not settings.

**Hesitates at:** `05-onboarding-step3-setup-1440-dark.png`. The preview they are about to broadcast
says **MOCK PREVIEW** in 48 px caps over *"Simulated engine - no camera, no encoder"*. A beginner
does not know what a mock or an encoder is; what they read is "something is wrong with my camera".
Then `06-studio-idle-1440-dark.png`: on a 1440×900 laptop the GO LIVE button is 271 px below the
fold. The one thing they came for is not on the screen.

**Feels unfinished:** the Moment strip is clipped mid-card at every width with no scroll affordance —
two of six Moments are simply invisible (`06`, `21`, `29`). The 404 is flush against the top edge of
the window with no wordmark (`25`).

**Would trust it if:** the preview stopped shouting a word they do not know, and GO LIVE were the
first thing on the screen rather than the last.

**Would leave because:** they went live, wanted to stop, and the END button did not respond
(`08-studio-live-1440-dark.png`). One unstoppable stream is the end of the relationship.

### 1.2 OBS expert

**Tries first:** Pro mode, immediately — to find out whether the simplicity is a cage. It is not:
`23-settings-pro-1440-dark.png` gives encoder, rate control, keyframe interval, the reconnect policy
in numbers ("10 attempts, first wait 1 second, longest 30, doubling"), a shortcut table, and an
in-product diagnostics log that states *"LIVETAP never asks you to carry a log file to another
website."* This is exactly the T2 answer, and it is the single most persuasive screen in the build.
The honesty goes further than it had to: *"The engine in use is mock, and a mock engine reports
SIMULATED rather than claiming a verified encoder."*

**Hesitates at:** the pre-flight row while live. `11` shows a **red** dot next to "Stream is
excellent — Everything is running smoothly." An OBS expert reads state indicators for a living; a
red dot that contradicts its own label is the exact thing they left OBS to escape.

**Feels unfinished:** "YouTube · YouTube", "TikTok · TikTok stopped receiving your stream." (`15`,
`11`) — the label field is defaulted to the platform name and then concatenated with it. The
reconnect chip says "Attempt 1 — LIVETAP is reconnecting this one" where the spec promises
"Attempt 1 of 10 — retrying in 2s", and the INGEST_DISCONNECTED card has no "Stop trying" escape.

**Would trust it if:** it survived a reload. `14-studio-after-reload-while-live-1440-dark.png` — F5
while live silently returns to idle, says nothing about the stream that just died, and TikTok comes
back as *"TikTok is missing something. / The stream URL or key is empty or malformed."*

**Would leave because:** END does not work. An expert will not re-test a tool that failed to stop.

### 1.3 Professional creator (multi-platform, sponsor obligations)

**Tries first:** three destinations at once, to see whether the multistream claim holds
(`27-studio-live-3dest-1440-light.png`). It does — one tap, three platforms, per-platform shape.
That is the T1 trigger answered, and it is why this person is here.

**Hesitates at:** the Studio dock and the chip row list the same destinations twice, 200 px apart
(`27`). Which one is authoritative during a show?

**Feels unfinished:** the health model ignores destination state — TikTok is RECONNECTING and the
pill still reads "Stream is excellent" (`11`). Two of the three chip states render as solid fills,
when `PRODUCT_SPEC` §4.2 reserves the solid fill for LIVE precisely so LIVE is unmistakable at a
glance.

**Would trust it if:** the post-stream summary existed and told them what actually went out — right
now ending a stream is untested territory because ending is impossible.

**Would leave because:** the camera-lost card is invisible (`12-studio-camera-lost-1440-dark.png`).
A silent failure during a sponsored stream is a refund.

### 1.4 Podcast producer (two people, clips afterwards)

**Tries first:** Podcast → three destinations → the Guest Moment. The intent-to-layout mapping is
real: picking Podcast produces a **Conversation** Moment and a side-by-side layout, and the Moments
editor (`21-moments-1440-dark.png`) offers five layouts in human words with no scene/source tree.
One noun, as promised.

**Hesitates at:** `24-recordings-1440-dark.png` contradicts itself three times on one screen —
"Every stream is recorded on this device unless you turn it off", "Recording is currently off", and
"LIVETAP records every stream so you always have your own copy". The Studio stage bar says "Rec
off". A producer whose deliverable *is* the recording cannot act on that.

**Feels unfinished:** the Moments screen is a wide empty left column under a small preview; the
Moment strip clips "Ending", the Moment a podcast needs most.

**Would trust it if:** the recording promise were one sentence that matched the switch.

**Would leave because:** they finished a two-hour interview and found the recording default was off
while three strings told them it was on.

### 1.5 Mobile (phone) creator

**Tries first:** `31-onboarding-step1-375-dark.png` — the onboarding is genuinely good on a phone:
no horizontal overflow at 375 anywhere in the product (measured on landing, onboarding, Studio idle,
Studio live and Destinations), bottom tab bar, full-width cards.

**Hesitates at:** `32-studio-live-375-dark.png`. GO LIVE/END sits roughly 1,400 px down a scrolling
page, below the preview, the Moment strip, and three full device cards. On a phone, the product's
one dominant action requires four thumb-flicks to reach.

**Feels unfinished:** the 16:9 / 9:16 / 1:1 control — the one thing a vertical creator touches most —
measures 46×32 and 44×32 px against a 44 px minimum; "Manage demo destinations" is a 160×18 px link;
on the tablet breakpoint Mute and Share my screen are 217×26 px.

**Would trust it if:** GO LIVE were pinned where their thumb already is.

**Would leave because:** they scrolled for the button, went live, then had to scroll back to find the
"Demo mode" banner had scrolled away entirely — the honesty banner is inside the scrolling main
column, so it is on screen exactly when it does not matter.

### 1.6 Investor

**Tries first:** the landing page, then the six-tap claim in `FRICTION_BENCHMARK.md`, then the
failure demo. All three hold up. The benchmark is unusually honest — it refuses to publish an
uninstrumented OBS click count and names five things it does not measure. `SWITCHING_TRIGGERS.md`
quantifies the wedge (2,888,784 downloads of a Japanese-documented multistream plugin) rather than
asserting it.

**Hesitates at:** the gap between the landing page and the build. `01-landing-1440-dark.png` promises
"Connect your accounts… Tap GO LIVE", "Go live on several places at the same time", and "In your
browser: Nothing to install. This is the build you are one tap away from right now." The build
behind that button broadcasts nowhere, and the marketing page never says so. In a category whose
incumbents' chief sin is dishonesty about what works, that is the wrong first impression.

**Feels unfinished:** three accent-filled "Open LIVETAP" buttons on one page, against the design
system's own rule of exactly one; a multistream diagram that is unreadable at 375 px; large dead
vertical bands between sections.

**Would trust it if:** the landing said "this hosted build is a demo" in the hero, where it costs
nothing and buys everything.

**Would leave because:** a demo where the stop button does not work reads as a prototype, not a
company.

### 1.7 Security reviewer

**Tries first:** the stream-key form and the privacy page. Both are strong.
`18-streamkey-bad-1440-dark.png`: the key field is `type="password"`, the hint says *"This is a
password for your channel. LIVETAP keeps it for this session only and never shows it again"*, and
the errors are specific and actionable ("That looks like a web page address, not a stream server").
`28-privacy-1440-light.png` and the Pro diagnostics both state that keys and tokens are never
written to the log — and the log I captured contains none. `redactForStorage()` strips `streamKey`
and `passphrase` before anything reaches `localStorage`. Chat is rendered as text, never markup,
with a comment pointing at `SECURITY.md`.

**Hesitates at:** `/nope-not-a-page` returns **HTTP 200** with the SPA shell. Harmless here, wrong in
principle, and it will poison search indexing.

**Feels unfinished:** the key-redaction decision has a user-visible cost nobody accounted for — a
demo destination that is redacted on write and then restored without its key lands in CONFIG_INVALID
with a card telling the user to paste a key they never had (`15`).

**Would trust it if:** the 404 returned 404.

**Would leave because:** nothing here. This is the most trustworthy surface in the product.

---

## 2. The six north-star questions

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Could a first-time creator figure this out? | **YES** | Two questions, four screens, six taps, zero settings screens, zero protocol words on the path (`03`, `04`, `05`, `06`). Intent produces a real production, not just encoder settings — the thing OBS's wizard does not do. |
| 2 | Could an experienced creator trust it? | **NO** | END is `aria-disabled` while live and does nothing (`08`). The camera-lost card renders 288 px below the fold while the health pill says "Stream is excellent" (`12`). A red pre-flight dot sits beside "Stream is excellent" (`11`, `27`). A reload turns a working destination into "TikTok is missing something" (`14`). |
| 3 | Is it faster than existing workflows? | **YES** | Six taps to a two-platform multistream against a plugin install, `global.ini` editing and a per-destination start click. Measured, reproducible, and honest about what it does not measure. |
| 4 | Is the underlying power visible only when needed? | **YES** | Encoder, rate control and keyframe interval exist only under the Pro toggle (`22` vs `23`), and Pro adds below without moving anything. The one leak is the word "encoder" escaping into Simple copy (pre-flight row, ENCODER_FAILED card, mock preview) — fixed in `apps/web`, described for `packages/*`. |
| 5 | Does the interface feel fundamentally different from OBS? | **YES** | No canvas, no dock grid, no scene/source tree, no mixer. Six named Moments, one preview, one button, and an error that names its cause. `13`'s demo-failure panel is something OBS has no analogue for. |
| 6 | Would someone actually switch? | **NO — not yet** | They would *try* it, because T1 and T2 are answered visibly. They would not move their show onto a build whose stop button is inert, whose camera-loss notice is invisible, and whose marketing page does not say the hosted deployment broadcasts nowhere. Fix P0-1 through P0-7 and this becomes YES for the multistream segment. |

---

## 3. Design rules, checked objectively

| Rule | Result |
|---|---|
| Exactly one solid accent-filled action per screen | **FAIL on Landing** — three `#D63A2D`-filled "Open LIVETAP" buttons (header, hero, Get LIVETAP card), measured by computed `background-color`. Studio, Destinations, Moments, Settings, Recordings each have exactly one. Onboarding steps 1–2 have zero, which is correct (the cards are the choice). |
| No colour-only state | **FAIL while live** — `.lt-preflight--red` paints `rgb(255,107,107)` next to the words "Stream is excellent". Elsewhere the rule holds: every chip carries a word, every field error carries a glyph, the mock banner carries text. |
| 44 px touch targets at 375 and 834 | **FAIL** — aspect segmented items 46×32 / 44×32; Mute 217×26 and Share my screen 217×26 at 834; "Manage demo destinations" 160×18; "Manage destinations" 311×24. Everything else passes; onboarding at 375 has exactly one miss ("Skip setup", 72×24). |
| No horizontal overflow at 375 | **PASS** — `scrollWidth - clientWidth === 0` on landing, onboarding, Studio idle, Studio live and Destinations. |
| Focus visible on keyboard navigation | **PASS** — `outline: 2px solid rgb(107,168,255)` on every focusable element sampled; a skip link is the first tab stop on both the marketing and app shells. |
| Reduced motion respected | **PASS** — under `prefers-reduced-motion: reduce`, `document.getAnimations()` returns zero running animations while live, and the LIVE chip's halo resolves to a permanent full-opacity ring exactly as §4.2 requires. |
| Typography scale adherence | **PASS** — Settings resolves to 7 distinct size/weight pairs (28/700, 18/600, 16/400, 14/500, 14/400, 13/600, 13/400), all on the documented scale. No ad-hoc sizes found. |
| No protocol words in Simple mode | **FAIL** — "MOCK PREVIEW" and "no camera, no encoder" on the preview; "Health appears once the encoder starts sending" in the live pre-flight row; "The video encoder stopped… switch to Software encoding" in the ENCODER_FAILED card; a "Mock" badge on every platform in onboarding and the add sheet. The guard test only scans `rtmp|bitrate|codec|keyframe|scene|source`, so none of these are caught. |
| Mock banner visible but not shouting | **PARTIAL** — correct tone, correct copy, correctly undismissable, correctly absent from marketing (`06`). But it is absent from onboarding entirely (spec §4.4 says every app route), and it scrolls out of view because it lives inside the scrolling main column (`08`). |
| Humane error cards show all four fields | **PASS where visible** — CAMERA_LOST, ENCODER_FAILED, INGEST_DISCONNECTED and CONFIG_INVALID all render WHAT / WHY / DOING / YOU CAN with exactly one primary action and the code never displayed (`11`, `15`). The defect is placement, not composition. |

### Resilience behaviours

| Behaviour | Result |
|---|---|
| One destination reconnecting while others stay live | **PASS, and it is the best thing in the build.** Measured on the deployed site: drop → RECONNECTING at 0 s → LIVE again at 1.3 s, YouTube never leaving LIVE, with a full error card and one button (`11`). Two caveats: 1.3 s is too fast for a human to read the card the demo exists to show, and the chip omits the "of 10 · retrying in 2s" the spec promises. |
| Camera-lost notice | **FAIL** — raised, composed correctly, rendered at `top: 1188` in a 900 px viewport at `scrollY 0`. Invisible (`12`). |
| Encoder crash notice | **FAIL** — same placement bug, plus protocol vocabulary in the copy (`13`). |
| Reload while "live" (state honesty) | **PARTIAL FAIL** — the app correctly stops claiming to be live, but says nothing about the stream that ended, and the key-based destination returns broken with a misleading card (`14`). |
| 404 | **PARTIAL** — honest and offers one way back, but top-flush, unbranded, claims "That page moved" for a URL that never existed, and is served with HTTP 200 (`25`). |
| Landing promises vs mock reality | **FAIL** — see P0-5. |

---

## 4. Findings, ranked

### P0 — must fix before calling this an MVP

**P0-1 · You cannot end a live stream.**
`apps/web/src/screens/Studio.tsx` passes `disabled={preflight.level === 'red'}` to `GoLiveButton`.
The moment the countdown completes every destination leaves `READY`, so `evaluatePreflight()`
returns `red`, and `GoLiveButton`'s `handleClick` opens with `if (disabled) return;`. Verified on the
deployed build: `aria-disabled="true"`, Playwright reports "element is not enabled", and a
`{force:true}` click changes nothing. No E2E test ever ends a stream, which is why this shipped.
Screenshot `08-studio-live-1440-dark.png`. **Change:** evaluate pre-flight only when idle, and never
disable the button while `state === 'live'`. *(Fixed.)*

**P0-2 · Pre-flight contradicts itself while live.**
Same root cause. The row under the preview renders `lt-preflight--red` (a `--lt-danger` dot) beside
"Stream is excellent — Everything is running smoothly", and the button's `aria-describedby` target
announces "No destination is ready — that is the one thing LIVETAP cannot do for you" to a screen
reader while two destinations are LIVE. Violates DESIGN_SYSTEM §0 rule 2. `11`, `27`.
`apps/web/src/screens/Studio.tsx`, `apps/web/src/components/preflight.ts`. **Change:** while live,
drive the row's level from `evaluateHealth()` (green/amber/red), not from pre-flight. *(Fixed.)*

**P0-3 · Production error cards are invisible.**
`.lt-studio` is `display: grid` with `grid-template-areas: 'stage' 'moments' 'devices' 'go' 'dock'`.
`<NoticeCards/>` is its first child and has no `grid-area`, so it is auto-placed into an implicit row
after every named area. Measured with a live camera-lost error: card rect `top: 1188`, viewport 900,
`scrollY 0`, page 1482 — 288 px below the fold, while the health pill still reads "Stream is
excellent". Tenet 6 ("no silent failures") fails outright. `12`, `13`.
`apps/web/src/app.css` (`.lt-studio`, `.lt-noticecards`). **Change:** give the notice region a named
`notices` area at the top of both the 1-column and 2-column templates. *(Fixed.)*

**P0-4 · GO LIVE is below the fold at every breakpoint.**
Measured: 1440×900 → page 1296 px, button top 1171 (271 px below the fold); 834×1194 → ~1280;
375×812 → ~1400. Tenet 2 and DESIGN_SYSTEM §0 rule 3 both say this control is the largest,
highest-contrast thing on the screen; it is currently not on the screen. `06`, `29`, `32`.
`apps/web/src/app.css`, `apps/web/src/screens/Studio.tsx`. **Change,** in three parts, each
recorded as a deliberate deviation from the layout drawn in §5c: (a) the go section moves directly
beneath the preview at every breakpoint, in the DOM as well as the grid, so visual order, tab order
and reading order agree — §5c's own first sentence ("on one screen without scrolling at any
breakpoint") is the stronger requirement, and meeting it in the drawn order needs the dock to become
a Sheet on tablet and the device cards to lose half their height; (b) amber pre-flight collapses by
default, which §4.5 already calls "expandable" and which recovers ~140 px (red never collapses — a
blocking reason must be readable without a click); (c) on a phone the pre-flight row, the button and
its subtitle are pinned above the tab bar, exactly as §5c's mobile drawing specifies. *(Fixed.)*

**P0-5 · The landing promises what the hosted build cannot do.**
"Connect your accounts. Pick where you want to go live. Tap GO LIVE.", "Go live on several places at
the same time", "In your browser: Nothing to install. This is the build you are one tap away from
right now." Nothing on the marketing page says the deployment behind that button broadcasts nowhere;
the first mention of demo mode is grey tertiary text *below* the platform grid on onboarding step 2.
Any over-claim is a finding; in this category it is the finding. `01`, `26`, `30`, `04`.
`apps/web/src/screens/Landing.tsx`. **Change:** state it in the hero note and on the "In your
browser" card, in the product's own voice. *(Fixed.)*

**P0-6 · Developer and protocol vocabulary in Simple mode.**
Four sites: (a) the preview renders "MOCK PREVIEW" at ~48 px over "Simulated engine - no camera, no
encoder" — `packages/media/src/mock/MockEngine.ts:420,424`; (b) the live pre-flight row reads
"Waiting for stream data — Health appears once the encoder starts sending" — `packages/core`
health headline; (c) `ENCODER_FAILED` reads "The video encoder stopped… switch to Software encoding
in Pro settings" — `packages/core/src/errors/humanize.ts`; (d) every platform in onboarding and the
add sheet carries a badge reading **"Mock"** where `COPY.demo` is "Demo" and `PRODUCT_SPEC` §4.4
mandates "Demo" — `apps/web/src/screens/onboarding/Onboarding.tsx:236`,
`apps/web/src/screens/Destinations.tsx:205`. `05`, `06`, `08`, `13`, `16`.
**Change:** (d) fixed. (a)–(c) need `packages/*` — exact text given in §5. Also extend
`apps/web/src/__tests__/no-obs-words.test.ts` to catch `encoder|mock|ingest|rtmps|muxing` so this
cannot recur. *(Partly fixed; guard extended.)*

**P0-7 · A reload breaks a connected destination and says nothing about the stream it ended.**
`persist.redactForStorage()` strips `ingest.streamKey` before writing (correct), and the restore path
in `store.init()` reconnects mock destinations regardless (`store.ts:364`), so a key-based demo
destination comes back with a keyless ingest, fails validation, and lands in `CONFIG_INVALID` —
surfaced as "TikTok · TikTok is missing something. / The stream URL or key is empty or malformed."
with a primary action of "Paste a new key" for a destination the user never pasted a key into.
Reproduces on any full navigation, not just F5. `14`, `15`.
`apps/web/src/state/store.ts`. **Change:** re-derive the demo ingest for mock destinations on
restore, and tell the user plainly when a reload ended a broadcast. *(Fixed.)*

### P1 — should fix

| # | Finding | Screenshot | File | Change |
|---|---|---|---|---|
| P1-1 | Three accent-filled CTAs on the landing page | `01`, `26` | `screens/Landing.tsx` | Hero keeps the solid fill; header and "In your browser" card become secondary. *(Fixed.)* |
| P1-2 | The landing CTA uses the LIVE red while the app's primary is blue — "the red always means LIVE" (DESIGN_SYSTEM §1.2) | `01` vs `05` | `app.css` `.lt-landing .lt-btn--primary` | Marketing CTA uses the app's primary blue. *(Fixed.)* |
| P1-3 | Countdown numeral and "Cancel" render in `--lt-accent-live` on the demo's `--lt-info` fill (~1.3:1), and the numeral is not dominant | `07` | `app.css` `.lt-golive--demo` | Force legible foreground on the demo fill and keep the numeral large. *(Fixed.)* |
| P1-4 | Mock banner scrolls out of view — it sits inside the scrolling main column | `08` | `app.css` `.lt-shell__main`, `MockBanner` | Make the banner sticky under the nav chrome. *(Fixed.)* |
| P1-5 | Mock banner absent from onboarding (spec §4.4: every app route) | `03`, `04` | `screens/onboarding/Onboarding.tsx` | Render `<MockBanner/>` at the top of onboarding. *(Fixed.)* |
| P1-6 | The demo-mode sentence on step 2 is grey tertiary text *below* the grid the user has already used | `04` | `screens/onboarding/Onboarding.tsx` | Moved above the grid; superseded by P1-5's banner. *(Fixed.)* |
| P1-7 | Recordings contradicts itself three times on one screen | `24` | `screens/Recordings.tsx` | Copy derives from the actual setting. *(Fixed.)* |
| P1-8 | "YouTube · YouTube", "TikTok · TikTok stopped receiving your stream." | `15`, `11` | `screens/Destinations.tsx`, `components/DestinationChips.tsx`, `screens/Studio.tsx` | `destinationTitle()` drops the label when it equals the platform name. *(Fixed in `apps/web`; the error-card text needs the one-line `packages/core` change in §5.)* |
| P1-9 | 404 is top-flush, unbranded, and claims "That page moved" for a URL that never existed | `25` | `screens/NotFound.tsx`, `app.css` | Centred, wordmark, accurate copy, secondary link home. *(Fixed.)* |
| P1-10 | Touch targets under 44 px on touch breakpoints: aspect segmented 46×32 / 44×32; Mute 217×26; Share my screen 217×26; "Manage demo destinations" 160×18 | `29`, `32` | `app.css` `.lt-segmented__item`, `.lt-toggle`, `.lt-bannerslot a` | 44 px minimum below 1025 px. *(Fixed.)* |
| P1-11 | Studio does not take initial focus on GO LIVE (spec §4.3); it is the 27th tab stop | — | `screens/Studio.tsx` | Focus GO LIVE on mount when idle, without stealing focus later. *(Fixed.)* |
| P1-12 | Moment strip clips two of six Moments at every width with no affordance | `06`, `21`, `29` | `app.css` `.lt-momentstrip` | Edge fade + `scroll-padding`, and the strip wraps at ≥1025 px. *(Fixed.)* |
| P1-13 | `no-obs-words.test.ts` does not scan for `encoder`, `mock`, `ingest`, `rtmps` | — | `__tests__/no-obs-words.test.ts` | Guard extended. *(Fixed.)* |
| P1-14 | No E2E ends a stream — the reason P0-1 shipped | — | `e2e/golden-path.spec.ts` | "a live stream can be ended, and the 5-second grace can be undone": asserts END is enabled, that no `.lt-preflight--red` exists while live, that UNDO returns to LIVE, and that the second END actually reaches idle. *(Fixed.)* |
| P1-15 | Health ignores destination state: "Stream is excellent" while one destination is RECONNECTING | `11` | `packages/core` `evaluateHealth` | Needs a `packages/*` change — described in §5. **Open.** |

### P2 — polish

1. READY, STARTING and RECONNECTING chips all render as solid fills; `PRODUCT_SPEC` §4.2 reserves the solid fill for LIVE so LIVE is unmistakable. `packages/ui` `StatusChip`. (`15`, `27`)
2. Reconnect status text omits "of {max}" and the retry countdown the spec specifies. `packages/core`. (`11`)
3. `INGEST_DISCONNECTED` card has no "Stop trying" footer link (§4.1). `components/NoticeCards.tsx`.
4. Destination chips duplicated between the chip row and the dock, 200 px apart. (`27`)
5. Emoji icons (🎥🎮🎙) in intent and Moment cards against the custom icon set in the nav — two visual languages. (`03`, `06`)
6. The nav rail's background stops mid-page on long pages. (`23`)
7. "Pro mode" wraps to two lines in the tablet top bar. (`29`)
8. Landing has large dead vertical bands and a one-column "Why open source matters here" at 1440. (`01`)
9. `/nope-not-a-page` returns HTTP 200 — a `vercel.json` rewrite, outside `apps/web/src`.
10. The multistream diagram is unreadable at 375 px. (`30`)
11. The reconnect demo recovers in 1.3 s — too fast to read the card it exists to demonstrate. Consider a 4 s scripted outage for the demo path only.
12. First app boot forces dark regardless of the OS preference. Documented in `AppBoot.tsx` and reflected in Settings, so defensible — but it is a silent override of a stated user preference.
13. `Toggle` is `button[aria-pressed]` rather than `role="switch"`. Documented rationale; worth revisiting since all four uses are switches, not toggle buttons.
14. The add sheet does not group demo providers under a "Demo destinations" heading with the explanatory note §4.4 specifies. (`16`)
15. The stream-key form's "Name for this destination" silently accepts empty and falls back to "Custom". (`18`)

---

## 5. Changes that need `packages/*` (described, not made)

1. **`packages/media/src/mock/MockEngine.ts:420,424`** — replace `'MOCK PREVIEW'` with `'DEMO PREVIEW'`
   and `'Simulated engine - no camera, no encoder'` with
   `'Simulated picture — this build is not broadcasting'`. Update the expectation in
   `MockEngine.test.ts:235`.
2. **`packages/core/src/errors/humanize.ts`** — `ENCODER_FAILED` currently says "The video encoder
   stopped." / "The encoder crashed or is unavailable on this device." / "If it happens again,
   switch to Software encoding in Pro settings." Replace with the §4.1 shipping strings: *what*
   "Your device could not keep making the picture."; *why* "Something in the video pipeline stopped
   on this device."; *doing* "LIVETAP is restarting it at a safer quality and keeping you live.";
   *youCan* "Close other apps, or choose a lower quality in Settings."
3. **`packages/core/src/orchestrator/BroadcastOrchestrator.ts:624`** — `target` is built as
   `` `${displayName} · ${config.label}` `` unconditionally. Guard it:
   `const target = label === displayName ? displayName : \`${displayName} · ${label}\`;`
   This removes "TikTok · TikTok is missing something." everywhere at once.
4. **`packages/core` `evaluateHealth`** — accept the destination snapshots (or a
   `degradedDestinations` count) so the pill cannot say "Stream is excellent" while a destination is
   RECONNECTING or DEGRADED, and so its headline stops naming the encoder.
5. **`packages/ui` `GoLiveButton`** — add an optional `demo?: boolean` prop that renders the label as
   `GO LIVE (DEMO)` (the string already exists, unused, as `COPY.goLiveDemo`), per §4.3's rule that an
   all-mock stream must never look like a real one at any glance distance. `apps/web` currently
   carries this only in the subtitle and the fill colour.
6. **`packages/ui` `StatusChip`** — restrict the solid fill to `LIVE`; render `READY`, `STARTING`,
   `RECONNECTING` and `DEGRADED` as outlined chips with a tinted dot.
7. **`vercel.json`** — serve a real 404 status for unmatched paths instead of a 200 SPA shell.

---

## 6. Three more defects, found while verifying the fixes

**P0-8 · The navigation was never on screen on a phone or a tablet.**
`.lt-shell__nav` is `position: sticky` inside an `auto`-height grid row, which gives it no travel.
Measured on the deployed build at 375×812: the bottom tab bar sat at document `y = 1535` of a 1,923px
page — never visible while Studio was in use — and at 834 the top bar scrolled away at `top: -397`.
Fixed: `position: fixed` below 1025px with a deterministic `--lt-navbar-h`, and matching padding on
`.lt-shell__main`. *(Fixed.)*

**P1-16 · The router never reset scroll between screens.**
Arriving at Studio from a scrolled onboarding step landed the page 67px down with the demo banner
already clipped, and every move between app screens inherited the previous screen's scroll offset.
Fixed with a `useLocation`-keyed `window.scrollTo(0, 0)` in `AppShell`. *(Fixed.)*

**P1-17 · A production notice without a `HumaneError` rendered nowhere at all.**
`NoticeCards` required `error`, and the only other consumer is a screen-reader-only live region — so
a plain production message reached sighted users through no surface whatsoever. Fixed: those now
render as a `Banner` with a Hide affordance, which is what makes P0-7's reload message visible.
*(Fixed.)*

---

## 7. Measured, after the fixes (local production build, same instrumentation)

| Measure | Before | After |
|---|---|---|
| END while live | `aria-disabled="true"`, click does nothing | enabled; tap → 5s grace → UNDO returns to LIVE → elapse ends the stream |
| Pre-flight row while live | `lt-preflight--red`, `rgb(255,107,107)` dot, "Stream is excellent" | `lt-preflight--green`, `rgb(63,217,140)` dot, same words |
| GO LIVE bottom edge vs viewport, 1440×900 | 1171 top / 900 viewport (271px below the fold) | **768 / 900** |
| GO LIVE bottom edge, 834×1194 | ~1280 | **916 / 1194** |
| GO LIVE bottom edge, 375×812 | ~1400 | **684 / 812**, pinned above the tab bar per §5c |
| Camera-lost card position (1440×900, `scrollY 0`) | `top: 1188`, out of viewport | **`top: 114`, in viewport** at all three breakpoints |
| Scroll offset on arriving at Studio | 67px | 0 |
| Navigation visible while using Studio (375 / 834) | no / no | **yes / yes** |
| Touch targets under 44px at 375 | 9 | 2 (the focus-revealed skip link, and one inline text link in the dock) |
| Touch targets under 44px at 834 | 18 | 3 |
| Horizontal overflow at 375 / 834 / 1440 | 0 | 0 |
| `no-obs-words` guard | did not scan `encoder`, `mock`, `encoding`, `transcode` | scans all of them, and passes |
| Initial keyboard focus on Studio | `<body>`; GO LIVE was the 27th tab stop | GO LIVE holds focus on an idle mount |

Unchanged and still true: six taps to LIVE on two platforms, zero protocol words on the path, one
destination dropping and recovering in 1.3s while the other never leaves LIVE.

---

## 8. What is genuinely good, and should not be touched

- The six-tap golden path, and the fact that it is measured by a test rather than asserted by a person.
- Intent → production. Picking **Podcast** produces a Conversation Moment and a split layout, not a
  set of encoder defaults. This is the part OBS's wizard does not do and the part that makes the
  thesis real.
- Failure isolation, end to end: the drop, the amber chip, the four-field card, the automatic
  1.3-second recovery, and the other destination never noticing. This is T1 and T2 answered.
- Platform honesty. LinkedIn is listed and explicitly marked unavailable with the reason
  ("LinkedIn only allows approved partner tools to go live. LIVETAP is not one, and would rather say
  so than waste your evening."). Nobody else in the category does this.
- The stream-key form, the secrets handling, and the privacy page.
- Pro mode as an additive layer that moves nothing, with in-product diagnostics instead of a log
  upload.

---

## 9. The stop control, closed and kept closed

Date: 2026-09-14. Every number here is a Playwright measurement against the production build,
reproducible with `npx playwright test live-safety.spec.ts -w @livetap/web`.

The rule being held: there is always exactly one obvious way to stop a live broadcast, and it is
never covered, clipped, unreachable in Pro, unreachable in a vertical format, or unreachable on a
phone. Five findings were open against it.

| Finding | What was measured before | What holds now |
|---|---|---|
| P0-1 END cancelled by navigating away | the 5 s grace was a `setTimeout` in a Studio effect; unmounting the screen ran its cleanup and `goLive` stayed `'live'` | the timer is `Runtime.graceTimer` in the store. `store.test.ts` proves the stop with no React mounted at all; the e2e presses END, taps Destinations, waits 9 s and finds no live bar |
| P0-2 nothing could stop a STARTING broadcast | the button reported `aria-busy` and swallowed the click while broadcast objects were being created on the platforms | `GoLiveButton` takes `onCancelStart` and reads "Cancel start"; the live bar carries the same control on every other screen. `store.cancelStart()` also stops again once the in-flight `goLive()` settles, because `BroadcastOrchestrator.goLive` ends by setting LIVE without re-checking for a stop |
| P0-3 the control was off-screen from 640px to 1024.98px | at 834x1112 in 9:16 the GO LIVE bar's box was `{x:24, y:1741.33, w:786, h:56}` in a 1112px window, 629px below the fold | the pinned bar and the preview cap both cover the whole range below 1025px. Reverting only that one media query reproduces `y:1741.33` exactly, and the matrix fails on it |
| P0-4 a LIVE destination could be switched out of Studio, taking its stop button with it | filtering on `config.enabled` alone | two guards: the toggle is disabled for any destination in an active state, and `DestinationList` lists `enabled || isActiveState(state)` |
| P0-5 Studio was the only screen with any stop control | four screens had none | `LiveBar` is rendered by `AppShell` outside `<Outlet/>`, so it is on every route and survives a route change |

**The matrix.** 8 viewports x 3 formats x Simple and Pro = 48 cells, each walking idle, the
countdown, STARTING, LIVE and mid-grace. Every cell asserts with `document.elementFromPoint` at
the control's own centre that a tap there reaches the stop control and not something else, and
that the whole control is inside the window rather than merely on the page. The STARTING window
is about a second against the mock adapters, far too short to poll from outside, so it is sampled
inside the page on every animation frame from GO LIVE until LIVE: a single frame with no reachable
control fails the cell. 48/48 pass; 0 frames out of roughly 150 per cell were unreachable.

**The interaction defect the owner called out.** An auditor pressed "Stop trying" inside a recovery
card and the control underneath fired instead. Reproduced here: hold the pointer down on that
button for six seconds, so the scripted four-second outage recovers mid-press, and the element at
the pointer becomes `Stop this destination` - a different destructive control. A card that renders
from a live condition disappears the instant the machine fixes it, and if it disappears between
pointerdown and pointerup the click lands on whatever reflows into that spot. `DestinationRow`
now holds its snapshot steady for the length of a press (`useSteadyWhilePressed`), released one
macrotask after `pointerup` because `click` is dispatched after it. With the hold removed the test
fails with the auditor's exact symptom; with it, the destination the creator pressed is the one
that stops.

**The rest of the pointer story.** `.lt-tooltip__bubble` is `pointer-events: none` - it was
absolutely positioned over the control it describes with pointer events on. The z-index scale is
nine tokens in `tokens.css` rather than seven literals across two packages, and the ordering is the
rule: the live bar at 900 outranks the navigation, the honesty banner, a Sheet and its scrim, and a
tooltip, with only the skip link above it. A test opens a Sheet over a live broadcast and asserts
the bar is still hit-testable. `html` gains `scroll-padding-block-end`, because without it
`scrollIntoView` parks a control flush with the bottom edge, underneath the fixed bar - measured
against a destination's own "Stop trying" button while live.

**Honesty.** `broadcastReality(destinations, adapterKind, engineHost)` is the one selector the
banner, the GO LIVE label, the countdown length, the subtitle and the live bar all read. It answers
from the adapters and the engine the process actually constructed, so a simulated build cannot be
talked into claiming a real broadcast by a destination whose config says `mock: false`. A real
broadcast runs a five-second countdown naming its destinations rather than three, and the first one
on a given browser profile states "You are about to broadcast to your connected accounts" and waits
for an answer. Still no modal: the reasoning in section 4.3 has not changed.
