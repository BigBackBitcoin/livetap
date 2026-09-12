# REPORT: livetap-public

**Built** 2026-09-12 · **Grammar** Live surface · **Page** `/` in `apps/web`
**Local URL** `http://localhost:4173/` (the real Vite production build, served by
`apps/web/scripts/preview-server.mjs` the way the host serves it)
**Brief** `BRIEF.md`, **self-authored, not interviewed**. The human was unreachable for this run,
so the eight answers were transcribed from the owner's written directive
(`docs/prompt-pack/10_LIVETAP_UX_EXPERIENCE_REDESIGN.md`) and the north-star correction, in the
owner's own words wherever they exist. A self-authored brief is a fallback, never the plan.

---

## 1. The grammar, and why the other seven lost

**Live surface.** The page behaves like the product, running, with scroll driving its state. It
is the only grammar whose close is an input and whose nav is the product's own chrome, which is
the only way to carry the brief's answer to question 5: *the visitor should feel like they are
using LIVETAP*.

| Grammar | Why it lost |
|---|---|
| **Filmic one-shot** | Forbids any chrome that implies the page is a tool, which is the one thing this page must imply. It also carries a burden of proof it cannot discharge when the pitch is literally "watch what it does". |
| **Chaptered editorial** | Turns a demonstration into a read. A folio, intertitles and a media column put a magazine between the visitor and the product. |
| **Continuous world** | Requires worldflight and real geography. LIVETAP has no place to travel through, no footage to fly, and nothing that "where you are" could mean. |
| **Typographic poster** | Bans the product from the frame and makes type the imagery, when the product is the picture and the brief bans photography precisely because the product already is one. |
| **Gallery / catalog** | Labels objects instead of operating them. Six destinations are connections to make, not a range to browse, and a museum label cannot go `READY`. |
| **Split stage** | Needs two sides held in tension for the whole page, and a permanent divider would cut the one persistent stage in half for an argument this page does not have. |
| **Rhythmic cutlist** | Bans `pin` and `dwell` outright, so the peak could not hold still while the visitor drags a tile with their own pointer, and cutting away from the stage destroys the only continuous thing on the page. |

Nav, hero and close follow from the grammar and were not decided separately: the nav is the
app's own 88px labelled rail plus a live status bar; the hero is the surface already in a state,
telling its own story, seen through the chaos lattice; the close is the app's real first
question.

---

## 2. The signature move, as implemented

**Drag a LIVE destination off the stage. Its connection path strains and snaps, it counts down,
it heals, and no sibling flickers.**

Anime.js `createDraggable` supplies the pointer physics and nothing else. The move is the
composition around it, and no kit provides any of that:

| Part | How it works |
|---|---|
| **Invitation** | Only while ACT 6 is the act on screen, and only on a tile whose state is LIVE, the tile shows a 44 x 44px grip (three 12px hairlines, not a glyph) on its leading edge and a line under its chip reading "Drag me off the stage". Both slots are reserved at every other time, so the tile's box never changes size when the peak arms it. |
| **Grab** | `createDraggable(li, { trigger: grip, container: surface, containerFriction: 0.35, dragSpeed: 0.92, releaseEase: spring({ stiffness: 150, damping: 18 }) })`. `dragSpeed` below 1 gives the tile mass, which matters because the visitor is supposed to feel they are pulling something loose. Anime's own `dragThreshold` default of 7px on touch is what keeps a vertical flick scrolling the page. `touch-action: none` is on the grip and nowhere else. |
| **Tension** | `onDrag` publishes `--lt-tension` as `clamp(d / threshold, 0, 1)` on the tile, where the threshold is `168 * min(1, innerWidth / 1440)`. It drives the path and only the path: the stroke narrows from 2px to 0.75px, the colour crosses from `--ltp-signal-live` to `--ltp-signal-strain`, and the bezier's perpendicular slack collapses toward a straight line. |
| **Break** | Fires the first time tension reaches 1, **while the tile is still held**, because a stream does not wait for you to let go. The draggable is disabled for the sequence. |
| **What snaps** | The path is cut and its stage-side segment recoils over 220ms; the port flashes its own border once, 120ms; the tile settles where it was dropped at the DEGRADED tint rather than flying off screen; the chip goes LIVE to DEGRADED for 700ms, then RECONNECTING with the app's real sentence shape, "Attempt 1 of 10, retrying in 4 s", and a ring counting down beside it. No screen shake, no full-frame flash, no sound. |
| **Under the threshold** | Anime's own release spring carries the tile home and **nothing changes**: the chip stays LIVE, the path returns to 2px, nothing is announced. The visitor learns the stage holds on, which is the right thing to learn first. |
| **Keyboard** | `Delete` or `Backspace` on a focused LIVE tile breaks it immediately, advertised through `aria-keyshortcuts`. Arrow keys nudge 24px each and raise tension by the same proportion a drag would, so the break fires at the same 168px after seven presses and the causal feeling survives; `Escape` returns the tile with no state change. |
| **Touch** | The same grip, the same threshold scaled by viewport width (45px at 390), plus the tile's own drop control as the non-drag path. |
| **Reduced motion** | `createDraggable` is never constructed, so no grip is offered at all. `Delete` and the drop control fire the same break, DEGRADED is skipped because a 700ms intermediate with no motion is a flicker, the ring renders static while the digit still counts in text, and every announcement is identical. |
| **Siblings** | Nothing in the break sequence repaints anything but the broken tile. There is deliberately no repaint-everything path through it, so a sibling's chip class, dot class and pulse animation are never rewritten and its halo never restarts. |

One place the implementation diverges from the design: the tile's overflow control is a single
**drop** button rather than a menu with one item in it. A one-item menu is two taps for one
action and a focus trap for no reason; the button carries `aria-label="Drop YouTube from the
stage"` and is the same action through the same state machine.

**It is asserted, not intended.** `apps/web/e2e/experience.spec.ts` samples every sibling tile's
state, chip class, label, computed `transform`, `opacity`, `scale`, bounding box, path `d` and
`stroke-width` before, during and after a break, and asserts none of them changed. It does this
for the pointer path and again for the keyboard path.

---

## 3. The fingerprint gate

**The registry at `scrollcraft/FINGERPRINTS.md` was empty.** It ships empty on purpose and this
project's copy was unmodified, so there was **nothing to clear**: the gate asks a build to differ
from every existing row on at least 4 of 6 dimensions, and with zero rows the condition is
vacuously satisfied. That is recorded as the first build in this workspace rather than reported
as a pass against a table that did not exist.

The row was appended after shipping, along with the seven "what is taken" bullets. What the next
build inherits as a constraint: Live surface as a grammar, app chrome as nav, the
fixed-surface-plus-flow-markers structure, the collapsing lattice of duplicated controls as a
hero device, a real first-run question as the close, drag-to-break as a signature move, and the
8-acts-plus-2-rests-at-12.8vh band.

---

## 4. The score

Total **12.8 viewport-heights** across **8 acts plus 2 declared rests**, inside the 8-to-14
budget and deliberately outside the 6-to-7-acts-at-13.6-to-13.8vh band that is itself a
fingerprint dimension.

| # | Beat | `data-sc-act` | Device | Span | Feeling | What is on screen |
|---|---|---|---|---|---|---|
| 1 | **CHAOS** | `pin` | `pin` plus drift stop 1; the collapse is CSS against the act's own `--sc-p` | **1.3** | recognition, then relief | Six panels, each a duplicate of a control the surface already has, each holding its own six stacked copies, jittering over a working console. Across the act each one converges on the position of the surface's single instance of that control. |
| , | REST A | `flow` | none, declared | 0.7 | stillness | The collapsed surface, settled. Nothing moves until the visitor does. |
| 2 | **CONNECT** | `pan` | `pan` | **1.6** | agency | Six destination cards travel in on a shelf. Tapping one signs it in and draws its signal path into the stage. |
| 3 | **PRODUCE** | `pin` | `flow` plus `in` at a 70ms stagger inside a pinned column | **1.4** | competence | Camera, microphone and screen switch on in sequence; the Moment strip is live from here on. |
| 4 | **ADAPT** | `flow` | `reveal="iris"`, the page's only one | 0.9 | surprise | The safe-area guides wipe in, and the shape control re-flows the stage where it stands. |
| 5 | **MULTISTREAM** | `pin` | `count`, twice, on computed values | **1.4** | pride | Two counters the visitor produced by tapping, and the sentence that every connection is separate. |
| , | REST B | `flow` | none, declared | 0.6 | calm | The show is running and nothing is happening. The silence in front of the peak. |
| 6 | **RESILIENCE** | `pin` | bespoke pointer physics plus drift stop 2 | **2.8** | dread, then trust | The peak. Break it yourself. |
| 7 | **POWER** | `flow` | `parallax="-0.6"` on the wrapper, `in` at 60ms on the rows | 0.9 | respect | One toggle, four panels, and nothing the visitor learned moves. |
| 8 | **ACTION** | `pin` | pointer `tilt="5"` on the intent cards | **1.2** | readiness | The product's real first question, six operable cards, three actions, the footer inside the stage. |

**Nine device families, no family twice in a row, zero `scrub` acts, two drift stops, one
`iris`.** The peak is 2.8 against a next-largest of 1.6, which is 1.75x, and the act in front of
it is a declared silence. `src/__tests__/landing-rules.test.ts` asserts the device order, the
span table, the 12.8 total, the peak margin, the single `iris`, the two drift stops and the
"only the last act may hold its final cue" rule.

### Four divergences from the plan, all deliberate

- **Parallax exists only where the act stack owns the element.** The design gives the atmosphere
  canvas `-0.4` and the destination wrapper `+0.35`, but the engine only collects
  `data-sc-parallax` inside `[data-sc-act]`, and both of those live in the fixed surface. Rather
  than publishing a second scroll reader to fake it, the surface carries its depth through
  overlap, scale-as-state, contrast falloff and edge light, and `parallax` is used where it is
  honest: ACT 7's Pro layer, which is in the act stack and really is behind the surface.
- **The chaos collapse's stage scale is a class, not a `calc()`.** The lattice's own convergence
  is scroll-linked CSS against ACT 1's `--sc-p`, as the motion system requires. The stage is in
  the fixed surface and cannot read that variable, so its 0.96-to-1.00 settle is a CSS
  transition released by a `ScrollObserver` threshold, which is Anime's side of the contract: a
  scroll threshold, never a scroll position.
- **The hero story is an Anime.js `Timer` over a step table, not a `Timeline` of `.call()`s.**
  Both are Anime tickables on the same clock, so `engine.fps = 30` and
  `engine.pauseOnDocumentHidden` apply either way, and the story is paused and resumed by the
  same `IntersectionObserver`. The timer wins on the two things the design asks of it that a
  timeline of calls makes awkward: resuming the loop from **step 5** rather than step 1, so the
  surface never looks like it keeps rebooting, and discarding pending steps outright when a
  visitor interrupts rather than queueing them.
- **The three closing actions live in the close, not in the rail.** The directive lists
  Download, GitHub and Try demo as foreground navigation; `LIVETAP_SCROLL_STORY.md` §2.1 gives
  the rail the theme toggle and one GitHub item, and §9.2 puts the three actions in the
  surface's own toolbar at the close. The design documents win where they disagree with the
  directive's summary, so the rail carries GitHub, the tour and the theme, and ACT 8 carries
  Open LIVETAP, Download and GitHub with Try demo in the footer beside the legal links.

---

## 5. The feel check

Run against the final desktop contact sheet, read once in order, one word per act, before
re-opening `BRIEF.md`. **It was not a cold pass**, and claiming otherwise would be worthless:
the build was iterated against these same sheets four times, so the reading is informed. That is
stated rather than hidden, per `feel.md`.

| Act | Intended (BRIEF.md) | Felt | Diff, and what changed |
|---|---|---|---|
| 1 CHAOS | recognition, then relief | **cluttered**, then **clear** | Matches. The first pass felt *blocked* rather than cluttered, because the lattice covered the console completely and swallowed every pointer. The panels moved off the tile columns onto the stage's own area, and the gaps between them now pass pointers through. |
| REST A | stillness | **still** | Matches. |
| 2 CONNECT | agency | **agency** | Matches, and it is the act the sheet reads best: the shelf travels, the tile mirrors it, the path draws. |
| 3 PRODUCE | competence | **competence** | Matches, but thinner than intended. Three rows switching on is a small gesture against a stage that size. |
| 4 ADAPT | surprise | **clarity**, not surprise | **Diff.** The re-flow is legible and the guides land, but it reads as an explanation rather than a surprise, because the control that causes it lives in the toolbar rather than in the act. The act's copy now says where the control is, which helps the reading and does not restore the surprise. Recorded as the page's weakest act. |
| 5 MULTISTREAM | pride | **pride** | Matches, once the counters were moved to land inside the cue's plateau. Before that the numbers finished exactly as the line began to leave, so the payoff arrived on a fading sentence. |
| REST B | calm | **calm** | Matches, and it reads quieter than ACT 6 on the sheet. |
| 6 RESILIENCE | dread, then trust | **dread**, then **trust** | Matches, and it is the largest visual change on the sheet. |
| 7 POWER | respect | **respect**, but only once the toggle is used | Matches with the toggle on. With it off the act's band is one switch and nothing else, so on the contact sheet ACT 7 is the quietest act after the two declared silences. That is the design's own instruction ("one toggle") and the tour's step 6 prompts it, but it is recorded here rather than glossed: a visitor who never touches the toggle never sees the depth the act is about. The first pass read as *broken* instead, because the four panels sat on screen as empty outlines with Pro switched off: `display: grid` beats the user agent's `[hidden]`. |
| 8 ACTION | readiness | **readiness** | Matches. The first pass read as *muddled*, because the close's translucent ground let the stage's own 36px state line bleed through the footer. The console now recedes instead. |

**Does the peak read as the peak?** Yes. ACT 6 is the largest visual change on the sheet and it
holds the most scroll room by a visible margin.
**Is there silence in front of it?** Yes. REST B reads quieter than ACT 6.
**Does the end resolve?** Yes. The last screen stands still with the question, six cards, three
actions and the footer on it, and the footer is inside the stage so there is no dead tail.

---

## 6. Measured sizes

From `vite build --reportCompressedSize`, which is a measurement rather than an estimate.

| File | Raw | Gzipped | Budget |
|---|---|---|---|
| `dist/assets/landing-*.js` (the engine, Anime.js and the page's own logic, one chunk) | 134.5 KB | **46.0 KB** | 60 KB |
| `dist/assets/modulepreload-polyfill-*.js` | 0.7 KB | **0.4 KB** | , |
| `dist/assets/landing-*.css` (the whole design system, the engine's stylesheet and the page) | 78.8 KB | **14.4 KB** | 20 KB |
| `dist/index.html`, including the inline icon sprite | 33.9 KB | **8.1 KB** | , |
| `public/fonts/archivo-latin.woff2` | 28.3 KB | , | one font file |
| `public/brand/hero-a.webp`, the LCP element | 8.5 KB | , | , |

**JavaScript on `/`: 46.4 KB gzipped against a 60 KB budget**, with 13.6 KB of headroom. No
React, no router, no store, no `@livetap/core`, no `@livetap/adapters`, no media engine, no
video, no photography, no generated imagery. The app's own bundle is untouched.

`e2e/landing-and-layout.spec.ts` asserts the transferred JavaScript on `/` stays under 180 KB
uncompressed, roughly three times the gzipped budget, so a framework creeping back onto the page
fails a test rather than a number in a document going stale.

---

## 7. What the harness found, and what changed because of it

`scripts/shoot.mjs` against the real preview build, three passes, 61 sample positions each,
sampling within every act rather than uniformly down the document.

| Pass | Output | Result |
|---|---|---|
| Desktop 1440x900 | `lab/shots/` | **No dead scroll.** |
| Mobile 390x844 | `lab/mobile/` | **No dead scroll.** |
| Reduced motion | `lab/reduced/` | **No dead scroll**, and every graded cue clears 4.5:1 at its worst frame. |

Findings that changed the page:

1. **The whole surface was inoperable.** `<main class="ltp-acts">` is a block that spans the
   document, so it sat over the fixed console for the page's entire length and intercepted every
   click. Found by the E2E, not by the harness and not by any screenshot: every frame looked
   completely correct. `pointer-events: none` on the act stack, `auto` on each act's own
   controls.
2. **A contrast failure at 1.11:1 on the close**, because the close's ground was a `color-mix()`
   background on the cue element itself. The verification pass hides the copy element and
   everything inside it to photograph the frame underneath, so a scrim on the copy is never
   measured, and `color-mix()` in a computed `backgroundColor` defeats the pass's parser
   besides. The close now has an opaque ground with the console receding behind it, and every
   act's band density is a **sibling** plate rather than a background on the copy.
3. **The stage rendered a pale rectangle with a border**, because `insetToSafeArea()` was being
   applied to every camera layer. The product only insets text layers, plus the camera in the
   vertical screen-share case. Fixed to mirror `applyIntentToLayer()` exactly, which is a data
   drift the unit test now covers.
4. **Four empty outlines in ACT 7.** `display: grid` beats the user agent's
   `[hidden] { display: none }`, so the Pro panels sat on screen with Pro switched off.
5. **Act copy rode the entry slide up across the console.** A greeting cue is on screen from the
   moment a pinned stage appears, which is a viewport before its progress leaves 0. Since the
   fixed surface is the ground for every pinned act, the greets were replaced with windows that
   open at 0.06, and every band block additionally fades from its own act's `--sc-p`.
6. **The counters landed on a fading sentence.** `data-sc-count-at` finished at 0.30 and the
   cue's plateau ended at 0.31. Moved to 0.22 and 0.24, so the payoff number is on screen at
   full opacity.
7. **A stacking-context trap.** The tile row could not rise above the desk however high its
   z-index went, because the monitor above it had a z-index of its own. A stream-key row or an
   error card opening downward painted behind a Moment card.
8. **The Pro toggle was 77 x 26px.** The design system's `.lt-touch` only raises the floor below
   640px; this page holds 44px at every breakpoint.
9. **The tour ticked a step off by itself.** Re-selecting the shape that was already selected
   completed "change the shape". A tour that completes its own steps is a funnel.
10. **Mobile had no room for the stage.** Reserving the act band out of an 844px viewport left
    the stage at 240 x 135. The band now overlays the surface's lower edge on a plate, the
    status line reads above the picture so a signal path never crosses text, and the 44px grip
    and drop slots are reserved inside the tile rather than beside it.

### Two things the harness cannot report, measured by hand

- **ACT 2's `pan` overflow.** A rail narrower than the viewport travels zero and the harness
  still prints `no dead scroll detected`. Measured: six cards at `clamp(15rem, 20vw, 18rem)`
  plus a lead block and a trailing note give **1,034px of overflow at 1440** against a
  half-viewport floor of 720px, **979px at 1024** against 512px, and **1,610px at 390** against
  195px. The travel is real at all three.
- **Reduced-motion reachability.** Confirmed on `lab/reduced/13.png` that the shelf shows real
  content and that cards past the fold are reachable through the engine's native scroll-region
  fallback. Nothing in the harness reports this; it reads as a page behaving correctly.

---

## 8. What was verified, and how

| Verified | Method |
|---|---|
| The hero story reaches LIVE on three destinations with nothing tapped | E2E, 30s budget |
| One destination degrades and recovers while the others hold | E2E |
| A tapped destination signs in, turns Ready and draws its own path | E2E |
| A paste-key destination asks for the key first, in place, with a real label and a linked error | E2E |
| The shape control physically re-flows the stage, with bounding boxes measured | E2E |
| A Moment recomposes the stage and the frame does not move | E2E |
| Pro adds panels and the stage's box is identical before and after | E2E |
| The close carries the chosen intent into `./app/start?intent=` | E2E |
| **The drag puts exactly one tile into RECONNECTING while the others stay LIVE, then all three are LIVE** | E2E, with every sibling property sampled |
| **`Delete` does the same thing, on the same element** | E2E |
| An arrow nudge under the threshold strains the path and changes nothing | E2E |
| Reduced motion: no grip, no positional animation, DEGRADED skipped, identical information | E2E with `reducedMotion: 'reduce'` |
| The tour never advances by itself and has no progress counter | E2E |
| No horizontal overflow at 375, 834 and 1440, at five scroll positions each | E2E |
| Every interactive element is at least 44 x 44px at three widths | E2E |
| Every link on the page resolves 200 through the host's own rewrites | E2E |
| The copied constants match `packages/core` and `packages/adapters` | unit test |
| The icon paths match `packages/ui/src/components/Icons.tsx` | unit test |
| The engine carries no project-local edit | unit test |
| No raw hex, no em dash in copy, no banned device, no inline style, no emoji | unit tests |
| No protocol vocabulary in anything a visitor reads or hears | the repository's own `no-obs-words` scan, which already covered this document |
| Gzipped transfer sizes | `vite build --reportCompressedSize` |
| Tab order matches visual order, with nothing reachable parked at `opacity: 0` or `visibility: hidden` | 34 stops walked at 1440 and logged with each element's position, computed opacity and visibility |

### What was not verified

- **No throttled LCP, CLS or INP trace.** The structural work is done and the budget numbers are
  real transfer sizes, but no second and no CLS figure is claimed from a measurement that was
  not taken. One shift was found and removed by reasoning rather than by a trace: the stage's
  frame used to fall back to `inline-size: 100%` with a 16:9 ratio, which in this column is
  taller than the room the composition leaves it, so the frame overflowed its parent at first
  paint and jumped about 70px when the page measured itself. The fallback is height-driven per
  breakpoint now, within a few pixels of the measured value, and the measurement only refines
  it.
- **No Windows High Contrast pass.** The forced-colours rules are written and shipped, unloaded.
- **No real handset.** Mobile was verified at 390x844 and 375x812 with the mobile composition
  active, in Chrome.
- **No deployment.** Everything above is the real production build served the way the host serves
  it, not a Vercel URL. `vercel.json`'s rewrites were already correct in this repository, and
  the preview server applies the same list, so `/app/start` resolves in both.
- **The atmosphere canvas was not profiled.** It is capped at 30 fps by an accumulator, paused by
  `IntersectionObserver` and `visibilitychange`, clamped to a 2x bitmap and never created below
  640px or under reduced motion, but the 2ms-per-frame ceiling in the motion system was not
  measured, so the band-count reduction lever was not exercised.
- **The variable font's axes were taken on trust.** `archivo-latin.woff2` is declared
  `font-weight: 400 800`; the file was not decompressed to confirm its `fvar` table. Every
  numeral on the page carries `.lt-num` with `font-variant-numeric: tabular-nums`, so a
  countdown's digits cannot change width either way.

---

## 9. Assets

Nothing was generated. `KIE_AI_API_KEY` was not set, no image model was called, and no credit was
spent. The page's only pictorial elements are the LIVETAP mark (inline SVG, DESIGN_SYSTEM §1.2,
its ripples never animated here) and the one existing hero plate, used as a faint ground inside
the stage's composed canvas at 42% in dark and 10% in light. The product is the picture.

One new asset was needed and it already existed in the repository: the Archivo subset woff2,
28.3 KB, self-hosted, `font-display: swap`, preloaded, carrying the display slot only.
