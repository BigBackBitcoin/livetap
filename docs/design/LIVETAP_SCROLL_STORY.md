# LIVETAP Scroll Story, the Scroll Craft score

**Version** 2.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Reads from** `scrollcraft/builds/livetap-public/BRIEF.md` (self-authored, not interviewed) and
`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md` / `LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`, the
first-time-creator audit (score 59/150) that drove the rebuild this version documents.
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_INTERACTION_SYSTEM.md` ·
`LIVETAP_MOTION_SYSTEM.md` · `scrollcraft/builds/livetap-public/PLAN.md` /
`REPORT.md`

**What changed since v1.0.** The build this document described shipped, an independent
first-time-creator audit of the deployed page scored it 59/150 and named a jammed main thread as
the root cause of nearly everything it disliked (`AUDIT_CLOSURE.md` §0), and the page was rebuilt
to close every actionable finding. The grammar is unchanged, this is still **Live surface**, but
the score, the hero, the chaos prologue and the choreography that caused the jam are gone. This
version records the page as it now is. Sections that are no longer true are replaced, not
footnoted; where a rule was traded away on purpose, that trade is written down rather than hidden.

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
| `spotlight` | No pointer light. The only pointer-driven transform on the page is the dragged tile in ACT 2 BREAK IT. The close's intent chips do not tilt toward the pointer; that device was dropped in this rebuild along with the rest of the per-act choreography (§5). |
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
a real panel with real type, is visible and readable at progress zero:

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

The emotion is the constraint; the cause names a device second, never first. The curve below replaces
the first version's ten-row table (eight acts, two rests): this version has **eight acts and one
declared rest**, and the peak has moved from sixth to second.

| # | Act | Feeling | What on screen causes it |
|---|---|---|---|
| 1 | **HERO** | recognition | A real production statement over a real picture already on the stage: a working console with something on it, not a claim about one. "Use my camera" and "Try the web demo" are both real, both one tap away. |
| · | **REST** | stillness | 40svh of nothing. The hero has resolved, the guided demo has handed over or is still counting down, and nothing moves until the visitor scrolls or taps. **Authored silence, and the silence in front of the peak.** |
| 2 | **BREAK IT** | dread, then trust | **PEAK.** One tap, "Go live, then break YouTube", or a drag, or `Delete` on a focused live tile. The connection snaps, the chip tells the truth, a countdown runs, the others never flicker, then it heals. |
| 3 | **SHAPES** | clarity | The 16:9 / 9:16 / 1:1 control, mirrored in the band, re-flows the picture in place, with the chat-safe and button-safe zones drawn directly on it. |
| 4 | **MOMENTS** | competence | The six Moments, mirrored in the band, each producing a genuinely different picture: Screen Share turns the screen input on, Guest brings in a second clip, Break and Ending change the words on the ground. |
| 5 | **OUTPUTS** | pride | Six small live canvases, each the same production re-cropped into its own platform's shape, with a name, a shape, an "up to N Mbps" ceiling and a state chip underneath. |
| 6 | **VERSUS** | conviction | "Instead of OBS.", two playable lanes, side by side, that let the visitor press through fourteen named concepts on one side and six measured taps on the other, then read one honest line each about Restream, StreamYard, Streamlabs and Riverside. |
| 7 | **PRO** | respect | A labelled Simple/Pro control, mirrored in the band, opens four real panels, quality, per-platform ceilings, audio, the session log, above the desk. Nothing the visitor already learned moves. |
| 8 | **MAKE** | readiness | The surface settles into "What are you making?" with six live intent chips, then Open LIVETAP, Watch on GitHub, Code, and an honest footer: no download exists yet. |

No two adjacent rows carry the same feeling. There is exactly one declared rest, and it sits directly
in front of the peak.

### 3.1 Why the peak moved from sixth to second

The first version placed BREAK IT (then called RESILIENCE) as ACT 6 of 8, two-thirds down the page.
The audit named that placement directly: *"Failure demo buried two-thirds down… move it much higher"*
(P1 #11), and separately: *"the drag-to-break demo earned my curiosity"* was the one thing that kept
the auditor reading despite everything else being broken. Two findings point at the same fix, put the
thing that works where a visitor can reach it before they decide the page is not worth their time.

So this version makes BREAK IT a **cold open**: the second thing on the page, right after the hero,
with only one declared rest between them. `feel.md`'s requirement that a peak be preceded by silence
still holds, the 40svh rest is that silence, but the requirement that the act before the peak be the
page's quietest act is now trivially true, because there is only the hero and the rest before it, and
the rest has no content at all. This is a deliberate departure from the first version's placement, made
because the audit is the newer and more specific source of truth for this page, and it is recorded here
rather than by silently moving the act.

The rest of the descent, SHAPES, MOMENTS, OUTPUTS, VERSUS, PRO, MAKE, keeps the original score's
logic of explaining after demonstrating: the peak proves the thing works, and everything after it
explains how and shows the rest of what the product does, ending on the product's own first question.

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
| The silence before it | The page's one declared rest, 40svh, directly in front of it. |
| The most scroll room | `data-sc-span="2.4"` against a next-largest of 1.6 (VERSUS). The peak is 1.5× the longest other act. |

---

## 5. The act table

Total page length **12.4 viewport-heights** across **8 acts plus 1 declared rest**. Inside the 8-to-14
budget.

| # | Beat | `data-sc-act` | Span | What the act does |
|---|---|---|---|---|
| 1 | **HERO** | `pin` | **1.2** | The product statement, the lede, the two hero actions and the guided 4.2s demo. |
| · | **REST** | `flow` | 0.4 | Authored silence. Nothing on screen changes; the surface simply holds. |
| 2 | **BREAK IT** | `pin` | **2.4** | The peak. One-tap break, drag, or `Delete`. |
| 3 | **SHAPES** | `pin` | **1.4** | The 16:9 / 9:16 / 1:1 control, mirrored in the band; labelled chat/button safe zones drawn on the picture. |
| 4 | **MOMENTS** | `pin` | **1.4** | The six Moments, mirrored in the band. |
| 5 | **OUTPUTS** | `pin` | **1.4** | Six live output canvases, composed from the same picture. |
| 6 | **VERSUS** | `pin` | **1.6** | "Instead of OBS.", two playable lanes plus the four-competitor strip. |
| 7 | **PRO** | `pin` | **1.2** | The Simple/Pro control, mirrored in the band; four panels open above the desk. |
| 8 | **MAKE** | `pin` | **1.4** | The close: the product's first question, six intent chips, the toolbar, the footer. |

### 5.1 What the device-family score no longer measures, and why

The first version scored itself against Scroll Craft's device-diversity gate: nine device families
(`pin`, `pan`, `reveal`, `count`, `parallax`, bespoke pointer, `drift`, `flow`+`in`, pointer `tilt`),
no family twice in a row, at most two `scrub` acts. **That gate no longer applies to this build, and
the reason is written down rather than glossed over.**

`AUDIT_CLOSURE.md` §0 found the root cause of nearly every audit complaint: the deployed page's main
thread was jammed by its own choreography. The wheel did nothing because the browser had to hit-test a
stack of fixed, heavily parallaxed, cue-driven layers on every frame; the intro never cleared because
its convergence was scroll-driven and the thread that should have run it was busy; controls "refused"
because their handlers never got a turn to run. `pan` shelves, `reveal` irises, `count` timelines,
`parallax` layers and pointer `tilt` were all part of that stack.

The rebuild's answer is not to tune the choreography, it is to remove almost all of it. Every act in
the table above is `data-sc-act="pin"`: the engine holds the stage in the viewport for the act's span
and nothing more. There is no `pan`, no `reveal`, no `count`, no `parallax`, no `drift` and no pointer
`tilt` anywhere on the page any more. What each chapter's copy shows is decided by **one fixed band
layer, cross-faded by a passive scroll listener** (§6), not by per-act Scroll Craft cues. The one place
bespoke choreography survives is the peak's drag, because it is pointer-driven and off the scroll
thread entirely (`LIVETAP_MOTION_SYSTEM.md` §2, §4).

This is a real trade and it is made on purpose: a page that changes richly with the wheel but that the
wheel cannot reliably move at all has failed the grammar at a more basic level than "not enough device
variety." `audit-closure.spec.ts` asserts fewer than three long tasks in six idle seconds and 40+ fps,
which is the check this version optimizes for instead.

What still holds from the original checks:

| Check | Result |
|---|---|
| The grammar's bans hold | Yes. No `scrub`, no `kinetic`, no `spotlight` beyond the peak's own drag, no drift, no magnetic close. |
| No two adjacent acts carry the same feeling | Confirmed in §3. |
| One peak, largest span by a visible margin | 2.4 against 1.6. The act before it is the page's only rest. |
| Every act earns its scroll span | Every act carries a state a visitor caused or watched; the one rest is a declared silence. |
| Total 8 to 14 viewport-heights | 12.4. |
| Minimum useful pinned span ≥ 1.2 | Smallest pinned span is HERO and PRO at 1.2. |
| Ground on every pinned act | The fixed surface is the ground for all eight, present from first paint. |

### 5.2 The structural decision that makes it one surface

The brief's answer to interview question 7 is *one persistent surface that stays on screen the whole
way*, and that has not changed. What changed is how the surrounding chapters talk to it.

- **One fixed live surface**, `#surface` / `.ltp-surface`, `position: fixed`, mounted once at first
  paint, never unmounted, never unpinned. It carries `data-sc-verify-state`, a compact signature of the
  values that actually paint, format, the six destination states, path phases, chat length, the pro
  flag, so the harness can check the acts that are pinned rather than trusting raw scroll progress.
- **One fixed chrome layer**: the rail (or top row), the status bar.
- **One fixed band layer**, `[data-lt-bands]` (§6), new in this version, holding one panel per chapter.
- **The act stack**, `<main class="ltp-acts">`: nine transparent sections (eight acts, one rest), each
  `pointer-events: none` except for its own controls, whose only job is to hold scroll length and tell
  `watchActs()` which chapter is active. The engine pins each one; nothing else about them is bespoke.

`data-sc-verify-state` publishes **rendered** values, never raw scroll progress, and the peak and the
close each set `data-sc-verify-hold="true"` on the surface only while their resolution or their final
screen is actually the thing on screen.

---

## 6. The band layer, and why the chaos prologue is gone

The first version's hero was the chaos prologue: six duplicate control panels, a stream-key field, a
bitrate input, a clock, a GO LIVE button, a mic meter, a destination row, each one six times over,
jittering and converging into the surface across ACT 1's `--sc-p`. It does not exist in this build.

**Why it is gone.** The audit's own words: *"an overlapping stack of six duplicated UI cards was frozen
across the centre of the screen, covering the headline, and it stayed there indefinitely… my honest
first thought was 'this site didn't load properly.'"* `AUDIT_CLOSURE.md` P0 #1 requires the intro
removed entirely rather than tuned, because a decorative element that can cover its own headline for
eighteen seconds has no safe middle ground between "gone" and "still risky." The convergence was also
part of the scroll-linked choreography implicated in the main-thread jam (§5.1), so removing it served
both the visual finding and the performance one.

**What replaced it.** Every chapter's copy, the title, the lede, the mirrored controls, now lives in
**one fixed band**, `[data-lt-bands]`, a single layer stacked above the surface that holds one panel per
chapter. Only the active panel is visible; the rest are present in the DOM (so nothing is gated behind
scroll for assistive technology) and cross-fade in place by opacity and visibility over 200ms, none
under reduced motion. On desktop the band is a **reserved region above the surface**,
`clamp(224px, 27svh, 252px)`; on phones it is a **plate over the desk's lower edge**,
`clamp(196px, 26svh, 228px)`. The hero band is the one exception that is visible from first paint with
no cross-fade needed, because it is already active before any scrolling happens.

Which panel is active is decided by `watchActs()` (`main.ts`): the act whose box contains the point 45%
down the viewport is the active one, computed by one passive `scroll`/`resize` listener plus a single
`requestAnimationFrame`, not by Scroll Craft cues and not by a second per-frame scroll reader. This is
the direct fix for the audit's finding #9, *"pale, clipped narration; controls floating in white"*,
and finding #10, *"120px dead zone under the caption"*: the band is a real panel with a title in
`text-primary`, a lede in `text-secondary` and its own controls, it is never pale, never clipped at a
viewport edge, and it never overlaps the surface, because the surface's own layout reserves the band's
space rather than the band floating over it.

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
build, rebuilt against the same URL to close an audit's findings, so the existing row is **updated in
place** rather than appended a second time. `FINGERPRINTS.md`'s own append-only rule is about distinct
builds occupying distinct rows; a build revising itself updates its own row, or the registry would
claim two different pages share one URL.

### 8.1 The row, updated

| Build | Grammar | Nav treatment | Hero device | Act-sequence shape | Close pattern | Signature move | World | Port |
|---|---|---|---|---|---|---|---|---|
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail on desktop / a top bar plus a bottom status bar carrying live session state on phones, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint with a real sample picture already on the stage, seen with nothing over it; a 4.2s guided demo hands over to the visitor | Eight `pin` acts and one declared rest; 12.4vh; the peak is a cold open second, span 2.4 against a next-largest of 1.6, ahead of the explanatory descent (Shapes, Moments, Outputs, Versus, Pro) | The product's real first-run question, "What are you making?", with six operable intent chips that re-compose the fixed stage, handing the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage, or tap one button, or press Delete: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Real sample footage. No generated imagery, no photography of anything but the product's own demo picture; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

### 8.2 What this revision changes in "What is taken"

The bullets in `FINGERPRINTS.md`'s "What is taken" section are updated to match: the
**fixed-surface-plus-flow-markers structure** bullet now describes a fixed **band** layer switched by a
scroll-position listener rather than per-act cue choreography, and the **collapsing lattice of
duplicated controls** bullet is removed, that hero device does not exist in this build and should not
be treated as a reusable fingerprint by a future one. The act-count-and-length band changes from
8-acts-plus-2-rests-at-12.8vh to **8 acts plus 1 rest at 12.4vh, peak at 2.4 and positioned second**.
Everything else, Live surface as a grammar, app chrome as nav, a real first-run question as the close,
drag-to-break as a signature move, still holds.

---

## 9. ACT 8: the handoff, so site and app are one product

The close is not a link to a marketing "get started" page. It is the app's first screen, running one
screen early, and the visitor's answer travels with them.

### 9.1 What the visitor sees

The fixed stage holds. Where the Pro layer just was, the surface puts one question at `headline`:
**"What are you making?"**, and six intent chips from `INTENTS`, each carrying an icon, a title and a
tagline. Each chip is `<button aria-pressed>`.

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
