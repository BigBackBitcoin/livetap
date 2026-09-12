# LIVETAP Scroll Story — the Scroll Craft score

**Version** 1.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Reads from** `scrollcraft/builds/livetap-public/BRIEF.md` (self-authored, not interviewed)
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_INTERACTION_SYSTEM.md` ·
`LIVETAP_MOTION_SYSTEM.md` · `scrollcraft/builds/livetap-public/PLAN.md`

---

## 1. The grammar: Live surface

Scroll Craft offers eight page grammars and they are mutually exclusive. This page is **Live surface**
(`references/uniqueness.md` §2.3): the page behaves like the product, running, with scroll driving its
state.

It is the only grammar that can carry the brief's answer to interview question 5 — *"the visitor should
feel like they are using LIVETAP"* — because it is the only one whose close is an input and whose nav is
the product's own chrome. The other seven do not fit, one line each:

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
| Marketing chrome: wordmark-plus-CTA bar, scrims, full-bleed photography, kinetic headline stacks, a hero claim over footage | The app's own chrome: an 88px left rail on desktop, a status bar on mobile, both real enough to navigate with |
| A section heading in display type | The largest type on the page is either a number the surface is counting or a sentence the surface is reporting about itself (VISUAL_DIRECTION §3.2) |
| `scrub` | No video anywhere. There is no footage and the grammar does not want any. |
| `kinetic` | No character or line splitting. Type arrives at full opacity on a plateau, the way a status line does. |
| `spotlight` | No pointer light. The only pointer-driven transforms are the dragged tile in ACT 6 and `tilt` on the close's six intent cards. |
| `drift` past two stops | Exactly two `data-sc-drift` attributes exist on the page (ACT 1 and ACT 6). |
| A magnetic button as the ending | The ending is a real input: the onboarding's first question with six operable intent cards. |

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
- The page says on its face that the scenario is a demo: the chrome's status bar carries a persistent
  `info` line, "Demo surface. Nothing is broadcast anywhere.", non-dismissible, which is the same
  honesty contract as the app's mock banner (PRODUCT_SPEC §4.4).
- No painted surface, no screenshot, no div dressed as another company's product. If a panel cannot
  compute, it is not on the page.

---

## 2. Nav, hero and close follow from the grammar

These three are not decided separately. The grammar decides them.

### 2.1 Nav: the app's chrome, and it navigates

**Desktop (> 1024px):** a fixed 88px left rail on `--lt-bg-1`, geometrically identical to the app's
rail (DESIGN_SYSTEM §9.1): the mark at the top with a `--lt-space-4` inset, then four items, each a
24px icon above a 12px label, never icon-only. The items are real anchor links to the acts, and the
active item takes the app's 2px `--lt-accent-focus` left edge:

| Item | Icon | Target |
|---|---|---|
| Stage | `tv` | ACT 1 |
| Destinations | `globe` | ACT 2 |
| Formats | `chart` | ACT 4 |
| Moments | `camera` | ACT 3 |

Below the rail's spacer, at the bottom where the app puts Settings and the mode switch: the theme
toggle (`sun` / `moon`, the app's `useTheme`) and one `external-link` item, GitHub.

A fixed status bar runs along the bottom of the viewport at 40px, carrying the surface's live session
state — destination count, health word, elapsed time — plus the persistent demo line. That bar is the
page's only persistent text, and it is a readout, not a message.

**Mobile (< 640px):** no rail. A 44px top row holds the mark alone. The status bar moves to the bottom
at 64px plus `env(safe-area-inset-bottom)`, carries the same session state, and gains the one action.
The four rail items are not reproduced as a menu: on a phone the page is a single column and the acts
arrive in order, so an index would be chrome for its own sake.

**Not present anywhere:** a wordmark-plus-CTA marketing bar, a progress readout, a section counter, a
scroll cue.

### 2.2 Hero: the surface already in a state

The hero is not a title and not a claim. At first paint the live surface is **already mounted, already
live, and already telling its 17-step story on its own clock** (INTERACTION_SYSTEM §9), and the six
duplicated-control panels of the chaos prologue are stacked over it, jittering.

So the landing view carries, simultaneously: a working console, and six copies of every control on top
of it. That is the recognition the brief asks for ("that is my Tuesday") and it is honest from frame
one, because the product is visible through the lattice rather than hidden behind a headline.

The surface's state line takes the greet-and-hold cue form, `data-sc-cue="0 1 0 0"`, so the one screen
every visitor sees has content on it at full opacity at `p = 0`.

### 2.3 Close: an actual input

ACT 8 is the real onboarding's first question, **"What are you making?"**, with the six live intent
cards built from `INTENT_PROFILES`. Picking one is not a link: it re-composes the fixed stage into that
intent's production, in place, using `buildAutomaticProduction()`'s own output (§9 below).
Only then does the toolbar's one action become specific.

A magnetic button would be the wrong ending for a page that spent its whole length being a tool.

---

## 3. The feeling curve

Written before the acts, per `references/feel.md` §1. The emotion is the constraint; the cause names a
device second, never first.

| # | Act | Feeling | What on screen causes it |
|---|---|---|---|
| 1 | **CHAOS** | recognition, then relief | Six panels, each one a duplicate of a control the surface already has — six stream-key fields, six bitrate numbers, six clocks, six GO LIVE buttons — overlapping and jittering over a working console. Across the act they converge and merge into one of each, and the console stands clear. |
| — | **REST A** | stillness | The collapsed surface, settled, its destination row dim, one empty-state line. Nothing moves until the visitor does. **Authored silence.** |
| 2 | **CONNECT** | agency | Six destination tiles travel in on a shelf. The visitor taps them; each one draws a signal path into the stage's port and turns `READY`. The ones not tapped stay dim, at 0.98 scale. |
| 3 | **PRODUCE** | competence | Camera, mic and screen switch on in sequence in the production column; the Moment strip appears; picking a Moment re-composes the stage in place. |
| 4 | **ADAPT** | surprise | The visitor taps 9:16 and the stage physically re-flows: the camera re-frames, the title moves inside the new safe area, the per-destination format labels change. |
| 5 | **MULTISTREAM** | pride | GO LIVE, a 3-2-1 countdown they can cancel, then every path lights and every tile turns `LIVE` together. Chat begins, with platform badges. |
| — | **REST B** | calm | The show is running and nothing is happening. Steady paths, steady pulses, a clock counting. **Authored silence, and the silence before the peak.** |
| 6 | **RESILIENCE** | dread, then trust | **PEAK.** The visitor drags one `LIVE` tile away from the stage with their own pointer. Its path strains, snaps, and recoils. The tile goes `DEGRADED`, then `RECONNECTING` with a visible countdown. The others never flicker. Then it snaps back `LIVE`. |
| 7 | **POWER** | respect | One toggle, and the same surface gains a Pro layer behind it: encoder, per-format bitrate, audio routing, diagnostics. Nothing the visitor already learned moves by one pixel. |
| 8 | **ACTION** | readiness | The surface settles into "What are you making?" with six live intent cards. Download, GitHub and Try demo sit in the surface's own toolbar. |

No two adjacent rows carry the same feeling. Two rows are rests and both are declared.

### 3.1 One refinement to the brief

The brief placed its second authored silence *after* the tile snaps back and before Pro mode. This
score moves the structural rest to **before** the peak instead, and keeps the post-snap-back hold as
the last 0.5 of ACT 6's own span.

Why: `feel.md` §2 requires silence *in front of* the peak, and requires the act before the peak to be
quieter than it. ACT 5 MULTISTREAM is the page's brightest act; the peak cannot arrive from it. Placing
the rest between them gives the peak something to be a change from, and it is thematically exact — the
calm of a running show is the thing the visitor is about to break. The peak still resolves inside its
own span, which is where a peak's resolution belongs.

Both silences are in `BRIEF.md`. This refinement is recorded here rather than by editing the brief's
own words.

---

## 4. The peak

**Act 6. The sentence a visitor says to a friend:**

> I dragged YouTube off the stream with my mouse and everything else stayed live, then it pulled itself
> back.

**Tell-someone sentence:** it's the site where you break your own live stream and watch it survive.

The peak gets the three things `feel.md` says it must get, at the expense of other acts:

| It gets | Here |
|---|---|
| The asset budget | There are no generated assets, so the equivalent budget is **build effort**: the pointer physics, the tension path, the countdown ring, the sibling-isolation assertion and the three input equivalents are the most expensive code on the page, and they exist only for this act. |
| The silence before it | REST B, 0.6 viewport-heights of a running show with nothing happening. |
| The most scroll room | `data-sc-span="2.8"` against a next-largest of 1.6. The peak is 1.75× the longest other act. |

---

## 5. The act table

Total page length **12.8 viewport-heights** across **8 acts plus 2 declared rests**. Inside the 8-to-14
budget, and deliberately not in the 6-to-7-acts-at-13.6-to-13.8vh band that is a fingerprint dimension.

| # | Beat | `data-sc-act` | Primary device | Span | Also in the act | Why this device |
|---|---|---|---|---|---|---|
| 1 | **CHAOS** | `pin` | `pin`, with the collapse driven from `--sc-p` | **1.3** | `data-sc-drift` stop 1 | The frame has to hold still while the multiplicity resolves, or the collapse is something that scrolled past rather than something that happened. Pin is the grammar's lean, and it is correct exactly once at the open. |
| — | **REST A** | `flow` | none, by design | 0.7 | `data-sc-verify-hold="true"` | Authored silence. A ground-only rest is the only way to make the first destination tap feel like the visitor's idea. |
| 2 | **CONNECT** | `pan` | `pan` | **1.6** | `data-sc-in` on each tile's arrival | Lateral travel reads as breadth, and six destinations are a breadth, not a hierarchy. The shelf is also the one place on the page where the real product has a scrolling row. |
| 3 | **PRODUCE** | `pin` | `flow` + `in` staggers inside a pinned column | **1.4** | The Moment strip as the app's own scroll-snap rail | The beat is an assembly in sequence, which is what a stagger is for; the pin is what stops the column sliding away while the third source is still arriving. |
| 4 | **ADAPT** | `flow` | `reveal` | 0.9 | `data-sc-reveal="iris"` used once, here, on the safe-area guides | A wipe is a change of state, and this beat is the page's only literal transformation of shape. A cue would merely introduce it. |
| 5 | **MULTISTREAM** | `pin` | `count` | **1.4** | `data-sc-drift` absent; the ground holds | Real numbers land here and nowhere else: the destination count the visitor produced by tapping, and the elapsed clock. A counter is a truth claim with motion attached, so it is only used where the number is computed. |
| — | **REST B** | `flow` | none, by design | 0.6 | `data-sc-verify-hold="true"` | Authored silence, and the silence in front of the peak. |
| 6 | **RESILIENCE** | `pin` | bespoke pointer physics (the signature move) | **2.8** | `data-sc-drift` stop 2 | The page must stop moving and start responding, and the drag must not have the page scrolling out from under it. This is the only act where the visitor's hand does something other than scroll or tap. |
| 7 | **POWER** | `flow` | `parallax` | 0.9 | `data-sc-in` at 60ms stagger on the Pro rows | Depth from differential movement is the only honest way to say "this was always underneath". The Pro layer arrives *behind* the surface, so it moves slower than it. |
| 8 | **ACTION** | `pin` | pointer `tilt="5"` on the intent cards | **1.2** | One-value hold cues; the footer inside the stage | The page ends by responding to a pointer that is choosing, not by pulling one toward a button. A card you pick is a card you pick up. |

### 5.1 The checks, run

| Check | Result |
|---|---|
| The grammar's bans hold | Yes. No `scrub`, no `kinetic`, no `spotlight`, two `drift` stops, no magnetic close. |
| Four or more distinct device families | Nine: `pin`, `pan`, `reveal`, `count`, `parallax`, `flow`+`in`, pointer `tilt`, `drift`, plus the bespoke pointer physics. |
| No device family twice in a row | `pin` → (rest) → `pan` → `pin` → `reveal` → `count` → (rest) → bespoke → `parallax` → `tilt`. No adjacent repeat. |
| At most two `scrub` acts | Zero. |
| No two adjacent acts carry the same feeling | Confirmed in §3. |
| One peak, largest span by a visible margin | 2.8 against 1.6. The act before it is a rest. |
| Every act earns its scroll span | The two rests are declared silences; every other act carries a state change the visitor caused or watched. |
| Total 8 to 14 viewport-heights | 12.8. |
| Not 6 to 7 acts at 13.6 to 13.8vh | 8 acts plus 2 rests at 12.8vh. |
| Minimum useful pinned span ≥ 1.2 | Smallest pinned span is ACT 8 at 1.2. The two rests are `flow` and are not pinned, so the floor does not apply to them. |
| Only the last act may hold its final cue | ACT 8 alone uses one-value cues. Every other act closes its last cue with a two-value window ending at 1. |
| Ground or greet on every pinned act | The fixed surface is the ground for all of them, and it is present from first paint. ACT 1 additionally greets. |

### 5.2 The structural decision that makes it one surface

The brief's answer to interview question 7 is *one persistent surface that stays on screen the whole
way*. A page of pinned acts cannot deliver that: each act pins its own stage, unsticks it, and slides
the next one in, which is the seam the owner has already rejected in another build ("weird clear page
lines... very cheap looking").

So the page is built the way `verify.md` sanctions for a bespoke fixed experience:

- **One fixed live surface**, `#lt-surface`, `position: fixed; inset: 0`, mounted once at first paint,
  never unmounted, never unpinned. It holds layers 1 to 6 of VISUAL_DIRECTION §2. It carries
  `data-sc-verify-state`, updated to a compact signature of the values that actually paint (stage
  format, destination states, path phases, chat length, pro flag) so the harness can check the acts
  that are `flow` markers.
- **One fixed chrome layer**, layer 7.
- **The act stack** in normal document flow: ten transparent sections, each holding only its own
  act-local UI positioned beside the stage, each driving the surface through `--sc-p` and through
  Anime.js scroll observers. The engine pins, pans, reveals and staggers inside those sections exactly
  as it always does.

`data-sc-verify-state` publishes **rendered** values, never raw scroll progress, and
`data-sc-verify-hold="true"` is set only while a declared rest or the peak's resolution hold is
actually active.

---

## 6. The chaos prologue, justified inside the grammar

The Live surface grammar bans marketing chrome and forbids painting a surface. A "chaos act" is the
obvious place for both to sneak back in, so the constraints are written down.

**What the chaos is.** Six panels, each one a **duplicate of a control the LIVETAP surface already
has**, rendered in LIVETAP's own tokens and components: a stream-key `TextField`, a bitrate number
input, an elapsed clock, a GO LIVE button, an audio `Meter` with a fader, and a destination row. There
are six of each because there are six destinations, and that is the whole argument: multiple
platforms, multiple windows, multiple controls, multiple workflows means *doing the same thing six
times*.

**Why that is not a fake screenshot.** Every one of the six panels is operable: the key field accepts
text, the bitrate input increments, the clock runs, the fader moves, the GO LIVE button can be pressed
and reports what it cannot do. They are real controls with nothing behind them, which is exactly the
experience being named. Nothing imitates another company's interface, carries another company's
trademark, or claims to be a screenshot of anything.

**Why it is not marketing chrome.** There is no headline over it, no scrim, no claim. The only text in
the act is the panels' own labels plus one line in the surface's idiom, set at `body`, not `display`:
"Six destinations. Six of everything."

**How it collapses INTO the surface.** Driven from ACT 1's `--sc-p`, the six copies of each control
converge on the position of the surface's single instance of that control and merge with it: the six
stream-key fields converge on the destination row, the six bitrate numbers converge on the health
readout, the six clocks converge on the one elapsed timer, the six GO LIVE buttons converge on the one
GO LIVE. Opacity crosses over at `p = 0.82` so the copies are gone before the surface finishes its
scale from 0.96 to 1.00. By `p = 1` there is one of each and the console stands clear.

The collapse is a **merge**, not a fade. A fade would say the clutter went away; a merge says LIVETAP
absorbed it, which is the product's actual claim.

**Reduced motion.** No convergence. The copies are present at `p = 0` and absent by `p = 0.2`, by
opacity only, with no positional change, and the surface never scales. The argument survives; the
choreography does not.

---

## 7. The signature move: drag to disconnect

One bespoke interaction that exists on this site alone. Coded in the page, off the page's own
`data-lt-*` attributes and `--sc-p`. The Scroll Craft engine is not touched.

Anime.js `createDraggable` supplies the pointer physics primitive, and that is not what makes this a
signature move: `createDraggable` gives a drag with bounds and a spring release, and nothing more. The
move is the composition around it — the tension path, the break threshold, the state machine, the
countdown, the sibling-isolation guarantee and three equivalent input paths — none of which any kit
provides. The rule in `uniqueness.md` §3 is about Scroll Craft's own device kit, and no Scroll Craft
device can change a state machine.

### 7.1 Pointer

| Phase | Behaviour |
|---|---|
| **Invitation** | Only while ACT 6 is the active act, and only on a tile whose state is `LIVE`, the tile grows a 44 × 44px grip on its leading edge (three 12px hairlines, not a glyph) and a `metadata` line under its label reads "Drag me off the stage". The invitation appears once, on ACT 6 entry, and does not reappear after the first successful break. |
| **Grab** | `createDraggable(tile, { trigger: grip, ... })`, so only the 44 × 44px grip starts a drag and the rest of the tile stays a normal button. Anime's own `dragThreshold` defaults apply — `{ mouse: 3, touch: 7 }` — which is what keeps a vertical flick on a phone scrolling the page instead of capturing it. `onGrab` lifts the tile: `scale(1.04)` and `--lt-shadow-2` → `--lt-shadow-3`. `touch-action: none` is on the grip and nowhere else. |
| **Drag** | `dragSpeed: 0.92`, so the tile trails the pointer very slightly rather than tracking it 1:1. Direct tracking carries no momentum and reads as artificial; 0.92 gives the tile mass, which matters because the visitor is supposed to feel they are pulling something loose. `container` is the surface with `containerFriction: 0.35`, so the frame resists at its edges without hard-stopping. |
| **Tension** | `onDrag` computes `d = Math.hypot(draggable.x, draggable.y)` and publishes a page-local `--lt-tension`, `0` at the port and `1` at the break threshold. It drives the path, and only the path: `stroke-width` 2px → 0.75px, stroke colour interpolating `--ltp-signal-live` → `--ltp-signal-strain`, and the bezier's control points pulling toward a straight line as tension rises. Nothing else on the page reacts to tension. |
| **Threshold** | The break fires when `d` passes **168px**, scaled by `min(1, viewportWidth / 1440)` so a narrow window does not make the break unreachable. Under the threshold, the stream never broke. |
| **Release under threshold** | `onRelease` leaves anime's own spring to carry the tile home: `releaseEase: spring({ stiffness: 150, damping: 18 })`, which overrides `releaseMass` / `releaseStiffness` / `releaseDamping` and takes its velocity from the real thrown velocity. `onSettle` clears `--lt-tension`. **No state change at all**: the chip stays `LIVE`, the path returns to 2px, and nothing is announced. The visitor learns the stage holds on, which is the right thing to learn first. |
| **Release over threshold, or crossing the threshold while held** | The break. See §7.2. On break the draggable is `disable()`d for the duration of the sequence, so a second drag cannot start mid-recovery, and `enable()`d again when the tile is `LIVE`. |

### 7.2 What snaps

Four things happen, in this order, and they are the whole peak:

1. **The path snaps.** The bezier is cut at the tension point. The stage-side segment recoils to the
   port over 220ms with a two-stage collapse (overshoot 8px, settle), and the tile-side segment
   vanishes over 90ms. The port itself flashes its own border once, 120ms. No screen shake, no flash
   of the whole frame, no sound.
2. **The tile falls out of the composition.** It does not fly off screen. It settles where the visitor
   dropped it, at `scale(0.98)`, and its own frame goes from the `LIVE` solid fill to the `DEGRADED`
   tint. It is still on the page, still readable, still the visitor's.
3. **The chip tells the truth, in the app's own words.** `LIVE` → `DEGRADED` for 700ms with the label
   "Live, rough", then → `RECONNECTING` with the label "Reconnecting" and the app's real status
   sentence shape: `Attempt 1 of 10, retrying in 4 s`. The dot pulses, because `RECONNECTING` is one
   of exactly two states in the system that pulse.
4. **The siblings do nothing.** This is the point of the whole act, so it is a hard assertion rather
   than an intention: across the entire break-to-heal sequence, no sibling tile's `transform`,
   `opacity`, `scale`, chip state, path geometry or pulse phase changes by any amount. The page does
   not re-layout, does not re-sort, does not reflow. Their clocks keep counting. `PLAN.md` §6 carries
   this as a test.

### 7.3 What the countdown shows

| Element | Detail |
|---|---|
| Ring | A 20px circle on the tile's leading edge, `stroke-dasharray` = circumference, `stroke-dashoffset` animated from full to zero over exactly the retry interval, `--lt-ease-linear`. Colour `--lt-state-reconnecting`. |
| Digit | Inside the ring, the seconds remaining, `4 → 3 → 2 → 1`, in tabular figures. One digit, no unit, because the unit is in the sentence beside it. |
| Sentence | `Attempt 1 of 10, retrying in 4 s`, at `metadata`, truncated with an ellipsis rather than wrapped, with the full string in `title`, exactly as `StatusChip`'s `detail` prop already behaves. **PRODUCT_SPEC §4.2 writes this string with an em dash** (`Attempt {n} of {max} — retrying in {s}s`); the comma here is deliberate, because a visible em dash is a Scroll Craft ship blocker and the owner's rules ban it too. The app should adopt the comma as well, which is a one-string change to `packages/core`'s reconnect describer and is flagged as a risk rather than made here. |
| Attempt number | Increments once, to `Attempt 1 of 10`, and stays. The demo never shows attempt 2, because the demo always recovers on the first attempt and inventing a failed attempt would be inventing a statistic. |
| Duration | 4 s, chosen because PRODUCT_REVIEW §3 recorded the app's real recovery at 1.3 s and noted that 1.3 s is **too fast for a human to read the card the demo exists to show**. 4 s is the honest fix to a measured defect, and the page says it is a demo. |
| Heal | The path redraws from the port to the tile, `stroke-dashoffset` full → 0 over 420ms; the tile springs home; the chip goes `RECONNECTING` → `LIVE`; the solid fill returns. Total break-to-live: about 5.1 s. |

### 7.4 Keyboard equivalent

The move is not a mouse toy. There are two keyboard paths and both produce the same four events.

- **Direct.** With a `LIVE` tile focused, `Delete` or `Backspace` performs the break immediately. The
  tile is `<button>`-semantic and its `aria-keyshortcuts` advertises it; the `metadata` line under the
  label reads "Press Delete to drop it from the stage" when the tile has focus.
- **Incremental, so the causal feeling survives.** With the tile focused, each `ArrowLeft` /
  `ArrowRight` / `ArrowUp` / `ArrowDown` press nudges the tile 24px and raises `--lt-tension` by the
  same proportion a pointer drag would. The path strains visibly. The break fires when the accumulated
  distance crosses the same 168px threshold, which is seven presses. `Escape` at any point before the
  threshold returns the tile to its port with no state change, exactly like a release under threshold.

`aria-grabbed` is not used; it is deprecated and it tells a screen reader nothing useful here. Instead
the tile's accessible name changes with its state and every transition is announced (§7.6).

### 7.5 Touch equivalent

The same drag, on the same grip. Three touch-specific rules, and two of the three come from the
library rather than from an invented number: anime's `dragThreshold.touch` of **7px** is the slop
before a drag captures, so a vertical flick still scrolls the page; `touch-action: none` is on the
44 × 44px grip only; and the threshold is the same 168px scaled by viewport width, which on a 390px
screen is 45px and therefore reachable inside the tile row. The `Delete` path is unavailable on touch,
so the tile's own overflow control (`⋯`, 44 × 44px) carries one item, "Drop from stage", which is the
same action through the same state machine.

### 7.6 Reduced-motion equivalent

Under `prefers-reduced-motion: reduce` there is **no positional animation at all**. The tile does not
move, `createDraggable` is never called, the path is never bent, and nothing springs. The reduced-motion
branch is selected by the Anime.js scope's own `mediaQueries` map, so the whole drag apparatus is never
constructed rather than constructed and suppressed.

The interaction still exists, because the meaning is the state change and not the movement:

| Step | Reduced-motion behaviour |
|---|---|
| Invitation | The `metadata` line reads "Press Delete, or use the tile's menu, to drop it from the stage". No grip is shown, because there is nothing to drag. |
| Break | Triggered by `Delete`, by the tile's menu item, or by a pointer press-and-move past the threshold. Instant: the path's opacity goes 1 → 0 in one frame (no dashoffset animation), the chip flips straight to `RECONNECTING`, the tile's fill changes. `DEGRADED` is skipped, because a 700ms intermediate state with no motion is a flicker. |
| Countdown | Text only. `Attempt 1 of 10, retrying in 4 s`, decrementing once per second. The ring renders as a static full ring, not an animated one. |
| Heal | Instant: path opacity 0 → 1, chip → `LIVE`, fill returns. |
| Siblings | Unchanged, same assertion. |
| Announcement | Identical in both modes: `assertive` on the break and on the heal, `polite` on the countdown's first tick only. No feature is lost; only movement. |

### 7.7 Why this counts as a signature move

The test in `uniqueness.md` §3 is whether somebody who has seen the device kit could tell it apart
from something the kit already does. The kit has no drag, no break, no tension, no snap-back and no
per-item failure isolation; `magnet` pulls an element *toward* a pointer and `tilt` rotates one, and
neither can change a state machine. The move is also the tell-someone sentence and the peak, which
`feel.md` §3 requires: if the signature move and the tell-someone sentence pointed at different
moments, one of them would be decoration.

---

## 8. The fingerprint gate

**The registry at `scrollcraft/FINGERPRINTS.md` is empty.** It ships empty on purpose, and this
project's copy is unmodified: the table has headers and no rows, and the "What is taken" section says
"Nothing is taken yet."

So there is **nothing to clear**. The gate asks a build to differ from every existing row on at least
4 of 6 dimensions, and with zero rows the condition is vacuously satisfied. This is the first build in
this workspace, and it is recorded as such rather than reported as a pass against a table that does
not exist.

### 8.1 The row to append after shipping

Append this, and only this, to the registry's table. Do not edit it later to make room for a future
build.

| Build | Grammar | Nav treatment | Hero device | Act-sequence shape | Close pattern | Signature move | World | Port |
|---|---|---|---|---|---|---|---|---|
| `livetap-public` | Live surface | The product's own app chrome: an 88px labelled left rail plus a bottom status bar carrying live session state, both real enough to navigate with; no marketing bar | One fixed live surface, mounted at first paint and already telling its own 17-step story on its own clock, seen through a collapsing lattice of six duplicated control panels | `pin` → rest → `pan` → `pin` → `reveal` → `count` → rest → bespoke pointer → `parallax` → `tilt`; 8 acts plus 2 declared rests; 12.8vh; peak at 2.8 against a next-largest of 1.6 | The product's real first-run question, "What are you making?", with six operable intent cards that re-compose the fixed stage, handing the chosen intent to `/app/start` | Drag a `LIVE` destination off the stage with the pointer: its connection path strains and snaps, it counts down and heals, and no sibling flickers | Drawn signal field. No photography, no footage, no generated imagery; the product is the picture | Web, `/` in `apps/web`, dark default with a first-class light theme |

### 8.2 What this build takes, for the next build to avoid

Add these bullets to the registry's "What is taken" section:

- **Live surface** as a grammar.
- **App chrome as nav**, specifically a labelled left rail plus a live status bar.
- **The fixed-surface-plus-flow-markers structure**: one `position: fixed` product surface for the
  whole page with the act stack driving it, rather than one pinned stage per act.
- **A collapsing lattice of duplicated controls** as a hero device.
- **A real first-run question as the close**, with the answer carried into the app.
- **Drag-to-break-a-live-destination** as a signature move, and per-item failure isolation as the peak.
- **The act-count-and-length band**: 8 acts plus 2 rests at 12.8vh with the peak at 2.8.

---

## 9. ACT 8: the handoff, so site and app are one product

The close is not a link to a marketing "get started" page. It is the app's first screen, running one
screen early, and the visitor's answer travels with them.

### 9.1 What the visitor sees

The fixed stage holds. Where the chaos panels once were, and where the Pro layer just was, the surface
puts one question at `headline` — **"What are you making?"** — and the six intent cards from
`INTENT_PROFILES`, each one the real card: title, tagline, and the profile's own `whatYouGet` bullets.
Each card is `<button aria-pressed>` with `data-sc-tilt="5"`.

Picking a card does three things at once, none of which is navigation:

1. The stage re-composes into that intent's production: `buildAutomaticProduction(contentType, picked)`
   runs in the page, and the stage adopts its `masterAspectRatio`, its first Moment, and its
   `destinationAspects` — so a visitor who picks **Podcast** watches the stage become a split
   two-person layout, and one who picks **Vertical Live** watches it become 9:16.
2. The surface's state line reports what just happened, in the profile's own words: the first line of
   `AutomaticProduction.explanation`.
3. The toolbar's one action becomes specific.

### 9.2 The toolbar, and the one label per intent

Three items, in the surface's own toolbar, and each has exactly one label used everywhere on the page:

| Item | Label | Target | Behaviour |
|---|---|---|---|
| Primary | **Open LIVETAP** | `/app/start?intent={contentType}` | The app's real onboarding route in this deployment (`apps/web/src/App.tsx`, `/app/start`). The query parameter preselects step 1's intent card, so the visitor arrives at step 2 having already answered step 1 on the marketing page. If no card was picked, the link is `/app/start` with no parameter and the label is unchanged. |
| Secondary | **Download** | `/#download` | The existing anchor. OS detection and the honest per-OS states are the Landing spec's (PRODUCT_SPEC §5a), unchanged. |
| Tertiary | **GitHub** | The repository | `external-link` glyph, `rel="noopener"`. |

**Exactly one of the three is solid-filled**, and it is Open LIVETAP, using `--lt-accent-focus-solid`
rather than `--lt-accent-live-solid`, because the live red belongs to being on air and this is not
that. This also fixes the defect PRODUCT_REVIEW §3 measured on the current landing page, where three
`#D63A2D`-filled buttons competed.

### 9.3 Why the handoff makes them one product

The visitor's last action on the marketing site is the app's first question, asked by the same
component, in the same tokens, with the same six profiles, and answered once. There is no "sign up"
step in between, no second version of the question, and no re-asking of something they already told
us. That is what "site and app are one product" has to mean operationally, and it is the only claim in
this document that the app's own route table can verify.

### 9.4 What the close must not do

- It must not fade out. ACT 8's cues are one-value holds, so the last screen still has content on it.
- It must not be followed by a tall footer. The footer is **inside** ACT 8's stage, so there is no dead
  tail after the question.
- It must not add a fourth action, a newsletter field, a pricing teaser, or a logo wall.
- It must not use a magnetic CTA. The grammar forbids it and the ending does not need pulling toward.
