# LIVETAP Scroll Story, the Scroll Craft score

**Version** 3.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Reads from** `scrollcraft/builds/livetap-public/BRIEF.md` (self-authored, not interviewed,
including its "Revision 3" section), `docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md` /
`LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`, the first-time-creator audit (score 59/150) that
drove the rebuild v2.0 documented, and the owner's follow-up direction of 2026-09-14, "the spacing
and flow seems off," that drove the revision this version documents.
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_INTERACTION_SYSTEM.md` ·
`LIVETAP_MOTION_SYSTEM.md` · `scrollcraft/builds/livetap-public/PLAN.md` /
`REPORT.md`

**What changed since v1.0.** The build this document originally described shipped, an independent
first-time-creator audit of the deployed page scored it 59/150 and named a jammed main thread as
the root cause of nearly everything it disliked (`AUDIT_CLOSURE.md` §0), and the page was rebuilt
to close every actionable finding. The grammar did not change, this is still **Live surface**, but
the score, the hero, the chaos prologue and the choreography that caused the jam were gone. That
rebuild's own fix over-corrected: every act became `data-sc-act="pin"` and nothing else, with one
fixed band layer cross-faded by a passive scroll listener carrying every chapter's copy. It shipped,
it passed its own performance gate, and the owner read it and said the spacing and flow seemed off.

**What changed since v2.0.** The owner asked for the full Scroll Craft process to run again rather
than a spot fix, and said plainly not to block it from changing things. Reading the v2.0 build
against its own grammar found the reason the flow read as off: one device shown eight times is not
a page, it is one section repeated, whatever that section's own performance numbers say. This
version restores device variety, seven families across eight chapters, moves each chapter's band
inside its own act instead of behind a single cross-faded layer, and gates every band's copy with
the engine's own cue so narration is never on screen while a stage is sliding through a seam, which
is the version of "controls floating, narration clipped" the v2.0 rebuild had not actually solved,
it had just hidden it behind a cheaper mechanism. Performance is not spent to get this back: the
scroll-linked cost this version reintroduces is measured directly by `audit-closure.spec.ts`'s
long-task budget rather than assumed safe or assumed unsafe. Sections that are no longer true are
replaced, not footnoted; where a rule was traded away on purpose, that trade is written down rather
than hidden.

---

## 1. The grammar: Live surface

Scroll Craft offers eight page grammars and they are mutually exclusive. This page is **Live surface**
(`references/uniqueness.md` §2.3): the page behaves like the product, running, with scroll driving its
state. That has not changed.

It is the only grammar that can carry the brief's answer to interview question 5, *"the visitor should
feel like they are using LIVETAP"*, because it is the only one whose close is an input and whose nav is
the product's own chrome. The other seven still do not fit, one line each:

| Grammar | Why it lost |
|---|---|
| **Filmic one-shot** | Forbids any chrome that implies the page is a tool, which is the one thing this page must imply; it also carries a burden of proof it cannot discharge when the pitch is literally "watch what it does". |
| **Chaptered editorial** | Turns a demonstration into a read: a folio, intertitles and a media column put a magazine between the visitor and the product. |
| **Continuous world** | Requires worldflight and real geography, and LIVETAP has no place to travel through, no footage to fly, and nothing that "where you are" could mean. |
| **Typographic poster** | Bans the product from the frame and makes type the imagery, when the product is the picture and the brief bans photography precisely because the product already is one. |
| **Gallery / catalog** | Labels objects instead of operating them: six destinations are connections to make, not a range to browse, and a museum label cannot go `READY`. |
| **Split stage** | Needs two sides held in tension for the whole page, and a permanent divider would cut the one persistent stage in half for an argument this page does not have. |
| **Rhythmic cutlist** | Bans `pin` and `dwell` outright, so the peak could not hold still while the visitor drags a tile with their own pointer, and cutting away from the stage destroys the only continuous thing on the page. |

### 1.1 What the grammar forbids, and what this page does instead

| The grammar bans | This page's substitute |
|---|---|
| Marketing chrome: wordmark-plus-CTA bar, scrims, full-bleed photography, kinetic headline stacks, a hero claim over footage | The app's own chrome: an 88px left rail on desktop, a top row plus a bottom status bar on phones, both real enough to navigate with |
| A section heading in display type | The largest type on the page is either a number the surface is counting or a sentence the surface is reporting about itself (VISUAL_DIRECTION §3.2) |
| `scrub` | No scroll-scrubbed video anywhere. The stage does carry real footage now, a sample creator clip and a guest clip (§2.2, and `LIVETAP_INTERACTION_SYSTEM.md` §1a), but it plays on its own clock, mounted once, never tied to `--sc-p`. Nothing on this page ties a video's playhead to scroll. |
| `kinetic` | No character or line splitting. Type arrives at full opacity, the way a status line does. |
| `spotlight` | No pointer light anywhere. The dragged tile in ACT 2 BREAK IT and the close's six intent chips (`data-sc-tilt="5"`, a small, spring-damped tilt toward the pointer, fine-pointer only) are the only pointer-driven transforms on the page. |
| `drift` | Zero `data-sc-drift` attributes. The ground is one colour for the whole page. The two-stop drift the first version carried was cut in the rebuild along with the chaos act it decorated (§6). |
| A magnetic button as the ending | The ending is a real input: the onboarding's first question with six operable intent chips. |

### 1.2 The honesty rule, discharged

The grammar's honesty rule is not suspended: the surface has to be real markup running real logic on
real or clearly-labelled sample data. This page discharges it as follows, and every item is checkable:

- Every panel computes its state from data arrays in the page (`PLAN.md` §3) through the same state
  machines the app uses, with the same ten `DestinationState`s.
- Every format re-flow uses the **same** normalized placements and `SAFE_AREAS` values as
  `packages/core/src/production/intents.ts`. The stage re-flows because the maths says so, not because
  a designer moved a rectangle.
- Every connection method shown per platform is derived from `packages/adapters` capability data, not
  written by hand.
- The page says on its face that the scenario is a demo: the status bar carries a persistent
  `info` line, "Demo surface. Nothing is broadcast anywhere.", non-dismissible, which is the same
  honesty contract as the app's mock banner.
- The sample picture is labelled as a sample, and the moment a visitor grants their own camera the
  stage says so and never uploads the stream (`LIVETAP_INTERACTION_SYSTEM.md` §1a).
- No painted surface, no screenshot, no div dressed as another company's product. If a panel cannot
  compute, it is not on the page.

---

## 2. Nav, hero and close follow from the grammar

These three are not decided separately. The grammar decides them, and the audit is what forced the
hero to actually obey it.

### 2.1 Nav: the app's chrome, and it navigates

**Desktop (> 1024px):** a fixed 88px left rail on `--lt-bg-1`, geometrically identical to the app's
rail: the mark at the top, then five real anchor links to the acts, each a 24px icon above a 12px
label, never icon-only. The active item takes the app's left-edge accent, decided by which act owns
the viewport (§5.3, `watchActs()`):

| Item | Icon | Target |
|---|---|---|
| Stage | `tv` | ACT 1 HERO |
| Break it | `alert` | ACT 2 BREAK IT |
| Shapes | `chart` | ACT 3 SHAPES |
| Outputs | `globe` | ACT 5 OUTPUTS |
| Versus | `sliders` | ACT 6 VERSUS |

Below the nav, at the bottom where the app puts Settings and the mode switch: the theme toggle
(`sun` / `moon`), a **Tour** item that opens the guided tour (§9), and one `external-link` item,
GitHub.

A fixed status bar runs along the bottom of the viewport at 40px, carrying the surface's live session
state, destination count, format count, health pill, elapsed clock, plus the persistent demo line
and "Free. Open source. Runs on your machine." That bar is the page's only persistent text besides the
active chapter's band, and it is a readout, not a message.

**Mobile (< 640px):** no rail. A 44px top row holds the mark alone. The status bar moves to the bottom
at 56px plus `env(safe-area-inset-bottom)`, carries the same readouts, and the Tour and GitHub items
move into it.

**Not present anywhere:** a wordmark-plus-CTA marketing bar, a progress readout, a section counter, a
scroll cue, a Moments or Pro item in the nav, those two chapters are reachable by scrolling, not by
the rail, because the rail's five items are the acts the audit named as needing to be found fastest
(the failure demo and the shapes/outputs/versus argument), not an index of everything.

### 2.2 Hero: the surface already doing something, not hidden behind anything

This is the section the audit rewrote. The first version's hero was "already mounted, already live,
already telling its 17-step story on its own clock", **underneath six duplicated-control panels of a
chaos prologue, jittering, which covered the headline for the audit's entire eighteen-second wait**
(`AUDIT_CLOSURE.md` P0 #1). That prologue does not exist any more. There is nothing between the visitor
and the hero.

At first paint: the fixed live surface holds a **real sample picture**, a generated creator clip
playing on the stage from frame one, not a grey rectangle and not a static plate, and the hero band,
a real panel with real type, is visible and readable at progress zero. The hero's cue,
`data-sc-cue="0 0.86 0"`, is the one greet cue on the page, it opens at the very start of the
chapter's travel rather than a few percent in, because there is nothing before it to protect the
copy from:

- **The product statement**, in `hero` type: *"Go live everywhere. Without becoming a broadcast
  engineer."*
- **A lede** naming the category, the audience and the difference: *"LIVETAP is a free, open-source
  live production app for streamers and creators. Connect YouTube, Twitch, TikTok and more, say what
  you are making, tap GO LIVE. One production, every platform, each on its own connection."*
- **"Use my camera"**, real `getUserMedia`, local only, mirrored self-view, never uploaded.
- **"Try the web demo"**, a real link to `/app/start`.
- A trust line: *"Runs on your machine. Nothing on this page is broadcast."*

Then a **4.2-second guided demo** runs once, on its own clock, not on scroll: the mic switches on,
then the intent's two suggested destinations connect, then one more, each reaching `READY`. At 4.2s it
writes *"Your turn. Tap GO LIVE. Nothing is broadcast from this page."* under the GO LIVE button, and
the button breathes twice (`ltp-breathe`, 1.6s × 2) to be found. It never goes live by itself, and any
visitor action, a tap, a scroll, a focus, interrupts it immediately and permanently (`interrupt()` in
`main.ts`). This is the audit's finding #12 closed by name: "Auto-play steals agency… demonstrate ≤5 s
then hand over."

The rail, the status bar, the destination tiles, the toolbar and the Moment strip are all real from
the first frame, exactly as `LIVETAP_INTERACTION_SYSTEM.md` §1 requires: nothing a visitor needs is
scroll-gated, and nothing is animating that has not been caused by the clock above or by the visitor.

### 2.3 Close: an actual input

ACT 8 MAKE is the real onboarding's first question, **"What are you making?"**, with six live intent
chips built from `INTENTS`. Picking one is not a link: it re-composes the fixed stage into that
intent's production, its shape, its first Moment, its renamed Moments and its suggested
destinations, in place, using the same `chooseAspect()` / `insetToSafeArea()` the app runs.
Only then does the toolbar's primary action carry the chosen intent forward:

- **Open LIVETAP** → `./app/start`, carrying the picked intent
- **Watch on GitHub for the first build** → the repository
- **Code** → the repository

There is no Download link anywhere on the page. Desktop and mobile builds are not published, and the
footer says so in plain words rather than pointing a button at a release that does not exist
(`AUDIT_CLOSURE.md` P1 #19). The early-access form appears only when the deployment has
`LIVETAP_EARLY_ACCESS_WEBHOOK` configured; until then, watching the repository is the honest capture
path.

A magnetic button would be the wrong ending for a page that spent its whole length being a tool.

---

## 3. The feeling curve

The emotion is the constraint; the cause names a device second, never first. The curve below is this
version's own table: **eight acts and two declared rests**, and the peak still lands second, now with
each act's own device doing the work the emotion asks for rather than one device standing in for
all eight.

| # | Act | Feeling | What on screen causes it |
|---|---|---|---|
| 1 | **HERO** | recognition | A real production statement over a real picture already on the stage: a working console with something on it, not a claim about one. "Use my camera" and "Try the web demo" are both real, both one tap away. `pin`, greet cue. |
| · | **REST A** | stillness | 0.25svh of nothing. The hero has resolved, the guided demo has handed over or is still counting down, and nothing moves until the visitor scrolls or taps. **Authored silence, and the silence in front of the peak.** `flow`. |
| 2 | **BREAK IT** | dread, then trust | **PEAK.** One tap, "Go live, then break YouTube", or a drag, or `Delete` on a focused live tile. The connection snaps, the chip tells the truth, a countdown runs, the others never flicker, then it heals. `pin`, the largest span by a visible margin. |
| 3 | **SHAPES** | surprise | The legend irises open (`data-sc-reveal="iris"`, the page's one iris) and the 16:9 / 9:16 / 1:1 control re-flows the picture in place, with the chat-safe and button-safe zones drawn directly on it. `pin`, reveal. |
| 4 | **MOMENTS** | breadth | Six Moment cards, each carrying a live canvas thumbnail of that look, travel sideways under the wheel in a lane wider than the viewport, each producing a genuinely different picture: Screen Share turns the screen input on, Guest brings in a second clip, Break and Ending change the words on the ground. `pan`. |
| 5 | **OUTPUTS** | pride | Two real counters, destinations and shapes, count up from the visitor's own picks, with six small live canvases underneath, each the same production re-cropped into its own platform's shape, with a name, a shape, an "up to N Mbps" ceiling and a state chip. `pin`, count. |
| 6 | **VERSUS** | conviction | "Instead of OBS.", two playable lanes that arrive once as the chapter enters, side by side, that let the visitor press through fourteen named concepts on one side and six measured taps on the other, then read one honest line each about Restream, StreamYard, Streamlabs and Riverside. `flow`, staggered entrance. |
| 7 | **PRO** | respect | A labelled Simple/Pro control wipes up (`data-sc-reveal="up"`) and opens four real panels, quality, per-platform ceilings, audio, the session log, above the desk. Nothing the visitor already learned moves. `pin`, reveal. |
| · | **REST B** | settling | 0.25svh of nothing, before the question. `flow`. |
| 8 | **MAKE** | readiness | The surface settles into "What are you making?" with six live intent chips that tilt toward the pointer, then Open LIVETAP, Watch on GitHub, Code, and an honest footer: no download exists yet. `pin`, tilt, greet-and-hold cue. |

No two adjacent rows carry the same feeling. There are two declared rests, one directly in front of
the peak and one directly in front of the close.

### 3.1 Why the peak stays second

The first shipped version placed BREAK IT (then called RESILIENCE) as ACT 6 of 8, two-thirds down the
page. The audit named that placement directly: *"Failure demo buried two-thirds down… move it much
higher"* (P1 #11), and separately: *"the drag-to-break demo earned my curiosity"* was the one thing
that kept the auditor reading despite everything else being broken. The v2.0 rebuild moved BREAK IT to
a cold open, the second thing on the page, and that placement is not in question in this revision,
nothing about "the spacing and flow seems off" pointed at the peak's position. What changed around it
is the device roster: BREAK IT is still `pin`, still the largest span on the page by a visible margin
over the next-largest act, `2.8` against `1.8` for MOMENTS, and it still sits directly after the
page's first declared silence.

`feel.md`'s requirement that a peak be preceded by silence still holds: REST A, 0.25svh, is that
silence, and it is still trivially the page's quietest act, since it has no content at all. The
descent after the peak, SHAPES, MOMENTS, OUTPUTS, VERSUS, PRO, MAKE, keeps the same logic the v2.0
score set: the peak proves the thing works, and everything after it explains how and shows the rest
of what the product does, ending on the product's own first question. What is different in this
revision is that the descent now has a device shape of its own, reveal, pan, count, staggered flow,
reveal, so a visitor descending from the peak reads seven distinct acts rather than six repeats of
the one they just left.

---

## 4. The peak

**Act 2. The sentence a visitor says to a friend:**

> I dragged YouTube off the stream with my mouse and everything else stayed live, then it pulled itself
> back.

**Tell-someone sentence:** it's the site where you break your own live stream and watch it survive.

The peak still gets the three things `feel.md` says it must get, at the expense of other acts:

| It gets | Here |
|---|---|
| The asset budget | There are no generated visual assets for this act specifically, so the equivalent budget is **build effort**: the pointer physics, the tension path, the countdown ring, the sibling-isolation assertion, the one-tap "Go live, then break YouTube" button and the three input equivalents are the most expensive code on the page, and they exist only for this act. |
| The silence before it | REST A, 0.25svh, directly in front of it, the first of the page's two declared silences. |
| The most scroll room | `data-sc-span="2.8"` against a next-largest of 1.8 (MOMENTS). The peak is over 1.5× the longest other act. |

---

## 5. The act table

Total page length **12.6 viewport-heights** across **8 acts plus 2 declared rests**, across **seven
device families**: `pin`, `flow`, `reveal` (iris and up), `pan`, `count`, `flow`+`in`+stagger, and
pointer `tilt`. Inside the 8-to-14 budget.

| # | Beat | `data-sc-act` | Device | Span | What the act does |
|---|---|---|---|---|---|
| 1 | **HERO** | `pin` | greet cue | **1.3** | The product statement, the lede, the two hero actions and the guided 4.2s demo. |
| · | **REST A** | `flow` | none | 0.4 | Authored silence. Nothing on screen changes; the surface simply holds. |
| 2 | **BREAK IT** | `pin` | none | **2.8** | The peak. One-tap break, drag, or `Delete`. |
| 3 | **SHAPES** | `pin` | `reveal="iris"` | **1.4** | The band's legend irises open; the 16:9 / 9:16 / 1:1 control re-flows the picture, with labelled chat/button safe zones drawn on it. |
| 4 | **MOMENTS** | `pan` | `data-sc-pan="0.05"` | **1.8** | A lane wider than the viewport carries six Moment cards, each with a live canvas thumbnail of that look, sideways under the wheel. |
| 5 | **OUTPUTS** | `pin` | `count` ×2 | **1.4** | Two real counters, destinations and shapes, count up from the visitor's own picks; six live output canvases composed from the same picture underneath. |
| 6 | **VERSUS** | `flow` | `data-sc-in` + stagger | 0.9 | "Instead of OBS.", two playable lanes that arrive once, staggered, as the chapter enters; the four-competitor strip. |
| 7 | **PRO** | `pin` | `reveal="up"` | **1.2** | The Simple/Pro control wipes up; four panels open above the desk. |
| · | **REST B** | `flow` | none | 0.4 | Authored silence, before the question. |
| 8 | **MAKE** | `pin` | `tilt="5"` + greet-and-hold cue | **1.3** | The close: the product's first question, six intent chips that tilt toward the pointer, the toolbar, the footer. |

### 5.1 The device roster, tried uniform, then restored, and why

The v2.0 rebuild scored itself against Scroll Craft's device-diversity gate and then, deliberately,
stopped meeting it: `AUDIT_CLOSURE.md` §0 had found the deployed page's main thread jammed by its own
choreography, `pan` shelves, `reveal` irises, `count` timelines, `parallax` layers and pointer `tilt`
all hit-testing on every frame, so that rebuild made every act `data-sc-act="pin"` and nothing else,
with one fixed band layer cross-faded by a passive scroll listener carrying every chapter's copy. It
shipped, it passed `audit-closure.spec.ts`, and it was wrong in a different way than the page it
replaced: the owner's own words were "the spacing and flow seems off," and reading the build against
the grammar's own device-diversity gate shows why. One device, `pin`, shown eight times with the same
cross-fading band underneath is not eight chapters, it is one chapter's mechanism worn eight times, no
matter how cheap each wearing is. Performance and variety are not actually in tension, they only looked
that way because the wrong fix was chosen the first time; the wrong choice was retuning nothing, it was
removing everything.

This version restores seven device families, **pin**, **flow**, **reveal** (iris on SHAPES, up on
PRO), **pan** (MOMENTS), **count** (OUTPUTS), **flow + `in` + stagger** (VERSUS), and pointer **tilt**
(MAKE), and pairs every one of them with the fix the audit actually asked for on the band itself:
narration now lives inside its own act, gated by the engine's own cue rather than a listener-driven
cross-fade, so copy is on screen only during the chapter's own travel and never while a stage is
sliding through a seam (§6). The one place bespoke, non-Scroll-Craft choreography still runs is the
peak's drag, because it is pointer-driven and off the scroll thread entirely
(`LIVETAP_MOTION_SYSTEM.md` §2, §4).

This is not a bet that device variety is free. `audit-closure.spec.ts`'s long-task budget, fewer than
three long tasks in six idle seconds and 40+ fps, still gates the deployed page, and it now gates a
page that actually uses seven device families rather than one. That is the honest measure of the
trade: cost is not assumed away by removing devices and it is not ignored by adding them back, it is
read off the same E2E budget either way.

What still holds from the original checks:

| Check | Result |
|---|---|
| The grammar's bans hold | Yes. No `scrub`, no `kinetic`, no `spotlight` beyond the peak's drag and the close's chip tilt, no drift, no magnetic close. |
| No two adjacent acts carry the same feeling | Confirmed in §3. |
| One peak, largest span by a visible margin | 2.8 against 1.8. The act before it is the page's first declared rest. |
| Every act earns its scroll span | Every act carries a state a visitor caused or watched; both rests are declared silences. |
| Total 8 to 14 viewport-heights | 12.9. |
| Minimum useful pinned span ≥ 1.2 | Smallest pinned span is PRO at 1.2. |
| Ground on every pinned act | The fixed surface is the ground for all eight, present from first paint. |
| No two adjacent acts read the same | BREAK IT and SHAPES are both `pin`, the sequence's only same-base-act adjacency, but nothing about what happens inside them repeats: the peak is a bespoke drag with no cue device at all, SHAPES is a `reveal="iris"` legend. Every other boundary changes base act, `pin` to `flow`, `pin` to `pan`, `flow` to `pin`. |

### 5.2 The structural decision that makes it one surface

The brief's answer to interview question 7 is *one persistent surface that stays on screen the whole
way*, and that has not changed. What changed is how the surrounding chapters talk to it.

- **One fixed live surface**, `#surface` / `.ltp-surface`, `position: fixed`, mounted once at first
  paint, never unmounted, never unpinned. It carries `data-sc-verify-state`, a compact signature of the
  values that actually paint, format, the six destination states, path phases, chat length, the pro
  flag, so the harness can check the acts that are pinned rather than trusting raw scroll progress.
- **One fixed chrome layer**: the rail (or top row), the status bar.
- **Ten transparent act sections**, `<main class="ltp-acts">`: eight acts and two declared rests, each
  `pointer-events: none` except for its own controls. Each act's own band, `[data-lt-band]`, now lives
  **inside that act's own stage** (§6), not in a separate fixed layer; the engine holds each pinned act
  in the viewport for its span, pans MOMENTS, or lets the two `flow` chapters travel with the page's
  own scroll, and each act's cue decides when its own band is readable.
- `watchActs()` still runs, on one passive `scroll`/`resize` listener plus a single
  `requestAnimationFrame`, but its job is narrower than it was in v2.0: it only toggles `is-here`,
  which governs **pointer-events**, arms and disarms the peak's drag on entry to and exit from
  ACT 2 BREAK IT, and shows or hides the SHAPES safe-area guides. It no longer decides whether a
  band's copy is visible, that is the engine's own cue now (§6).

`data-sc-verify-state` publishes **rendered** values, never raw scroll progress, and the peak and the
close each set `data-sc-verify-hold="true"` on the surface only while their resolution or their final
screen is actually the thing on screen.

---

## 6. The band, back inside each act, and gated by the act's own cue

The first shipped version's hero was the chaos prologue: six duplicate control panels, a stream-key
field, a bitrate input, a clock, a GO LIVE button, a mic meter, a destination row, each one six times
over, jittering and converging into the surface across ACT 1's `--sc-p`. It does not exist in this
build, and it was never brought back. **Why it is gone** has not changed since v2.0: the audit's own
words, *"an overlapping stack of six duplicated UI cards was frozen across the centre of the screen,
covering the headline, and it stayed there indefinitely… my honest first thought was 'this site didn't
load properly.'"* `AUDIT_CLOSURE.md` P0 #1 required the intro removed entirely rather than tuned,
because a decorative element that can cover its own headline for eighteen seconds has no safe middle
ground between "gone" and "still risky."

**What v2.0 replaced it with, and why that also had to change.** The rebuild put every chapter's copy,
title, lede, mirrored controls, into **one fixed band**, `[data-lt-bands]`, a single layer stacked
above the surface holding one panel per chapter, with only the active panel visible and the rest
cross-faded out by a `classList` toggle from `watchActs()`. It fixed the audit's finding #9, *"pale,
clipped narration; controls floating in white,"* and finding #10, *"120px dead zone under the
caption,"* the band was a real panel, never pale, never clipped. But it also meant every chapter read
as the same panel in the same place saying something different, which is most of what "the spacing and
flow seems off" was describing: eight acts sharing one band, cross-faded by a listener, is visually one
section shown eight times, whatever the mechanism underneath.

**What this version does instead.** Each chapter's band, `[data-lt-band]`, now lives **inside its own
act's stage**, `[data-sc-stage]`, inside its own `<section id="act-...">`, not in a shared layer above
the surface. It is positioned in the region the surface leaves free, exactly as before: on desktop a
**reserved region above the surface**, `clamp(224px, 27svh, 252px)`; on phones a **plate over the
desk's lower edge**, `clamp(196px, 26svh, 228px)`. What decides when a band is readable is no longer a
`classList` toggle keyed to which act is "current," it is the engine's own cue, `data-sc-cue`, carried
by each band directly: it opens at **0.02** of the chapter's own travel and closes at **0.95**, with
ramps either side so the copy holds a plateau at full strength rather than only touching full opacity
for a single scroll pixel. That is the literal fix for "narration clipped at the top edge": copy is
never on screen while a stage is still sliding through the seam into or out of its own chapter, because
the cue is not open yet, or has already closed, whenever the stage is in that seam. Between chapters,
while no band's cue is open, only the console is on screen, which is the grammar's own beat, not a
gap.

`is-here`, set by `watchActs()`, still exists, but it now governs **pointer-events only**: a band that
is fading out under its own cue must not catch a tap meant for the console underneath it. It is not
what makes a band's copy visible or invisible, the cue is.

**Anchors vary chapter to chapter**, on purpose, so no two consecutive bands sit in the same part of
the frame: the hero's is a lead block, the peak's is a lead block, SHAPES trails to the frame's far
edge, MOMENTS' sits inside its own pan lane as a lead-and-trail pair either side of the travelling
cards, OUTPUTS and VERSUS are tall panels, PRO leads again, and MAKE is centred and holds.

**The two tall panels, OUTPUTS and VERSUS, carry their cue on an inner block.** `.ltp-band--tall`
itself holds the panel's own background and grows downward over the surface; the cue, and the
opacity it drives, sits on a child, `.ltp-band__inner`, wrapping the panel's actual content. This is
not a stylistic choice: the verification harness hides cued copy to measure the ground underneath it,
and if the cue sat on the panel itself the harness would also hide the panel's background, which is
part of what it is measuring against. Putting the cue one level in keeps the panel's own ground stable
while the copy inside it opens and closes.

**The phone plate, `.ltp-act__plate`, is a sibling of the band, not a cue.** It is driven directly by
`--sc-p`, the act's own raw progress, rather than by the cue window, so it can fade in ahead of the
band's copy and fade out after it, protecting the band's contrast against whatever the desk shows
underneath without itself being subject to the "never on screen during a seam" rule that governs
copy.

---

## 7. The signature move: drag to disconnect

One bespoke interaction that exists on this site alone. Coded in the page, off the page's own
`data-lt-*` attributes and pointer events, armed and disarmed by `watchActs()` on entry to and exit
from ACT 2 BREAK IT. The Scroll Craft engine is not touched, and this is the one place on the page
where bespoke, clock- and pointer-driven choreography still runs, deliberately, because it is off the
scroll thread (§5.1, `LIVETAP_MOTION_SYSTEM.md` §2).

Anime.js `createDraggable` supplies the pointer physics primitive, and that is not what makes this a
signature move: `createDraggable` gives a drag with bounds and a spring release, and nothing more. The
move is the composition around it, the tension path, the break threshold, the state machine, the
countdown, the sibling-isolation guarantee, the one-tap alternative and the keyboard/touch equivalents,
none of which any kit provides.

### 7.1 Three ways in, all through the same state machine

The audit's finding #26 asked for the demo to hand itself over in under five seconds and then invite
the visitor in; this act adds a fourth invitation on top of the drag, keyboard and touch paths the
first version already had, because the fastest way to feel the peak should not require finding a grip:

| Path | How |
|---|---|
| **One tap** | The band's own button, labelled by what it will do: `Go live, then break YouTube` if nothing is live yet, `Break {name} for me` once a destination is live, `Breaking. Watch the tile` while it resolves. Pressing it connects, goes live and breaks a destination on a short timer if nothing is live yet, so a visitor who has not touched anything else on the page can still see the whole peak in one press. |
| **Drag** | Grab the 44 × 44px grip on a `LIVE` tile's leading edge and pull. |
| **Keyboard** | `Delete` / `Backspace` on a focused `LIVE` tile, or `ArrowLeft/Right/Up/Down` nudges that raise tension incrementally. |

All three end at the same `breakDestination()` call. There is exactly one state machine, and the
mechanics below (§7.2–§7.6) describe it regardless of which path triggered it.

### 7.2 Pointer

| Phase | Behaviour |
|---|---|
| **Invitation** | Only while ACT 2 BREAK IT is the active act, and only on a tile whose state is `LIVE`, the tile grows a 44 × 44px grip on its leading edge (three 12px hairlines, not a glyph) and a `metadata` line under its label reads "Drag me off the stage" (or "Press Delete to drop it" when the tile is keyboard-focused). |
| **Grab** | `createDraggable(tile, { trigger: grip, ... })`, so only the grip starts a drag and the rest of the tile stays a normal button. Anime's own `dragThreshold` defaults apply, `{ mouse: 3, touch: 7 }`. `onGrab` lifts the tile. `touch-action: none` is on the grip and nowhere else. |
| **Drag** | `dragSpeed: 0.92`, so the tile trails the pointer very slightly rather than tracking it 1:1, which gives it mass. `container` is the surface with `containerFriction: 0.35`, so the frame resists at its edges without hard-stopping. |
| **Tension** | `onDrag` computes the Euclidean displacement and publishes `--lt-tension`, `0` at the port and `1` at the break threshold. It drives the path and only the path: stroke-width narrows from 2px toward 0.75px, stroke colour interpolates toward the strain colour, and the bezier's control points pull toward a straight line as tension rises. |
| **Threshold** | The break fires when the displacement passes **168px**, scaled by `min(1, viewportWidth / 1440)` so a narrow window does not make the break unreachable. Under the threshold, the stream never broke. |
| **Release under threshold** | Anime's own spring carries the tile home: `releaseEase: spring({ stiffness: 150, damping: 18 })`. **No state change at all**: the chip stays `LIVE`, the path returns to full strength, and nothing is announced. |
| **Release over threshold, or crossing it while held** | The break fires the first time tension reaches 1, **while the tile is still held**, a stream does not wait for you to let go. The draggable is disabled for the duration of the sequence and re-enabled once the tile is `LIVE` again. |

### 7.3 What snaps

1. **The path snaps.** The connection line is cut at the tension point and recoils to the port; the
   tile-side segment vanishes. No screen shake, no flash of the whole frame, no sound.
2. **The tile falls out of the composition.** It settles where the visitor dropped it, at a reduced
   scale, and its frame goes from the `LIVE` solid fill to the `DEGRADED` tint. It is still on the page,
   still readable, still the visitor's.
3. **The chip tells the truth, in the app's own words.** `LIVE` → `DEGRADED` for 700ms with the label
   "Live, rough", then → `RECONNECTING` with the label "Reconnecting" and a real countdown, "Attempt 1
   of 10, retrying in 4 s". The dot pulses, because `RECONNECTING` is one of exactly two states in the
   system that pulse.
4. **The siblings do nothing.** No sibling tile's transform, opacity, scale, chip state, path geometry
   or pulse phase changes by any amount, at any point in the sequence. Their clocks keep counting.

### 7.4 Keyboard and touch equivalents

- **Keyboard.** `Delete` / `Backspace` on a focused `LIVE` tile breaks it immediately, advertised
  through `aria-keyshortcuts`. `ArrowLeft/Right/Up/Down` nudge tension incrementally, so the break fires
  at the same 168px-equivalent threshold and the causal feeling survives without a pointer.
- **Touch.** The same grip, the same 44 × 44px target, the same threshold scaled by viewport width, on
  a 390px screen that is about 45px, reachable inside the tile row.

### 7.5 Reduced-motion equivalent

Under `prefers-reduced-motion: reduce`, `createDraggable` is never constructed: the reduced-motion
branch is selected by the scope's own media-query matching, so the whole drag apparatus is never built
rather than built and suppressed. The one-tap band button, `Delete` and the tile's own drop control
still fire the identical state machine. `DEGRADED` is skipped (a 700ms intermediate state with no
motion is a flicker), the path appears and disappears by opacity rather than by animated stroke, and
every announcement is identical to the full-motion page. Nothing is removed except movement.

### 7.6 Why this counts as a signature move

Nothing in Scroll Craft's own device kit has a drag, a break, a tension model, a snap-back or per-item
failure isolation. The move is also the tell-someone sentence and the peak: if the signature move and
the tell-someone sentence pointed at different moments, one of them would be decoration. They do not.

---

## 8. The fingerprint gate

**The registry at `scrollcraft/FINGERPRINTS.md` already carries one row for `livetap-public`**, from
the version this document is revising. This is not a new build under a new name, it is the same
build, revised against the same URL a second time, first to close an audit's findings, now to fix the
spacing and flow of that closure's own fix, so the existing row is **updated in place** rather than
appended a second time. `FINGERPRINTS.md`'s own append-only rule is about distinct builds occupying
distinct rows; a build revising itself updates its own row, or the registry would claim two different
pages share one URL.

### 8.1 The row, updated

| Build | Grammar | Nav treatment | Hero device | Act-sequence shape | Close pattern | Signature move | World | Port |
|---|---|---|---|---|---|---|---|---|
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail on desktop / a top bar plus a bottom status bar carrying live session state on phones, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint with a real sample picture already on the stage, seen with nothing over it; a 4.2s guided demo hands over to the visitor | Eight chapters plus two declared silences, 12.6vh, seven device families (`pin`, `flow`, `reveal`, `pan`, `count`, `flow`+`in`, pointer `tilt`); the peak is a cold open second, `pin`, span 2.8 against a next-largest of 1.8, ahead of a descent that carries its own device shape (a reveal, a pan, a count, a staggered flow, a reveal) rather than repeating the peak's device | The product's real first-run question, "What are you making?", with six operable, pointer-tilting intent chips that re-compose the fixed stage, handing the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage, or tap one button, or press Delete: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Real sample footage. No generated imagery, no photography of anything but the product's own demo picture; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

### 8.2 What this revision changes in "What is taken"

The bullets in `FINGERPRINTS.md`'s "What is taken" section are updated to match. The
**fixed-surface-plus-fixed-band structure** bullet, itself already a revision of the original
duplicated-controls hero, is corrected again: the band is no longer one fixed layer cross-faded by a
scroll listener, it is now a band per act, living inside that act's own stage, gated by the engine's
own cue. The **uniform `pin` with no other Scroll Craft device** bullet is removed outright rather
than kept and re-explained, because it is no longer true of this build: uniform `pin` was tried as a
deliberate performance trade after the audit, it shipped, and it was replaced in this revision because
it read as one section shown eight times, not because the trade was cheap or expensive but because a
page is not supposed to read that way regardless of its frame budget. What a future build should take
from this is not "uniform `pin` is safe" or "uniform `pin` is unsafe," it is that **any scroll-linked
device's cost is measured directly by the E2E long-task budget** (`audit-closure.spec.ts`) before it
ships, whether that device is one family repeated eight times or seven families used once each. The
act-count-and-length band changes from 8-acts-plus-1-rest-at-12.4vh to **8 acts plus 2 rests at
12.6vh, peak at 2.8 and still positioned second**. Everything else, Live surface as a grammar, app
chrome as nav, a real first-run question as the close, drag-to-break as a signature move, still holds.

---

## 9. ACT 8: the handoff, so site and app are one product

The close is not a link to a marketing "get started" page. It is the app's first screen, running one
screen early, and the visitor's answer travels with them.

### 9.1 What the visitor sees

The fixed stage holds. Where the Pro layer just was, the surface puts one question at `headline`:
**"What are you making?"**, and six intent chips from `INTENTS`, each carrying an icon, a title and a
tagline. Each chip is `<button aria-pressed>`, and each carries `data-sc-tilt="5"`, a small,
spring-damped tilt toward the pointer on fine-pointer devices only, the page's second and last
pointer-driven transform after the peak's drag. The close's own cue, `data-sc-cue="0.02 1 0 0"`,
opens early and holds to the end of the chapter's travel rather than closing before it, a
greet-and-hold rather than a greet-and-fade, because this is the page's last screen and it must stand
still with content on it (§9.4).

Picking a chip does three things at once, none of which is navigation:

1. The stage re-composes into that intent's production: the page's own `chooseAspect()` /
   `insetToSafeArea()` run, and the stage adopts the intent's master aspect ratio, its first Moment, and
   the Moments it renames, so a visitor who picks **Gaming** watches the Screen Share Moment become the
   default, and one who picks **Vertical Live** watches the stage become 9:16.
2. The surface's state line reports what just happened.
3. The toolbar's primary action gains the chosen intent as a query parameter.

### 9.2 The toolbar, and the one label per action

Three items, in the close's own toolbar, each with exactly one label used everywhere on the page:

| Item | Label | Target | Behaviour |
|---|---|---|---|
| Primary | **Open LIVETAP** | `./app/start` | The app's real onboarding route. Gains `?intent={id}` once a chip is picked, so the visitor arrives at step 2 having already answered step 1. |
| Secondary | **Watch on GitHub for the first build** | The repository | The honest capture path while no build exists. |
| Tertiary | **Code** | The repository | `external-link` glyph, `rel="noreferrer noopener"`. |

**Exactly one of the three is solid-filled**: Open LIVETAP. The live red belongs to being on air, and
this is not that.

### 9.3 Why the handoff makes them one product

The visitor's last action on the marketing site is the app's first question, asked by the same
component, in the same tokens, with the same six profiles, and answered once. There is no "sign up"
step in between, no second version of the question, and no re-asking of something they already told
us.

### 9.4 What the close must not do

- It must not fade out. The last screen must stand still with content on it.
- It must not be followed by a tall footer. The footer is **inside** ACT 8's stage.
- It must not add a fourth action, a newsletter field, a pricing teaser, a logo wall, or a Download
  link. There is nothing to download yet, and the footer says so.
- It must not use a magnetic CTA. The grammar forbids it and the ending does not need pulling toward.
