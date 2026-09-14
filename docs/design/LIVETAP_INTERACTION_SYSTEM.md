# LIVETAP Interaction System, the public experience

**Version** 2.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` · `LIVETAP_MOTION_SYSTEM.md` ·
`scrollcraft/builds/livetap-public/PLAN.md`

**What changed since v1.0.** This document described the page before an independent first-time-creator
audit (`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md`, score 59/150) found it unusable and the page was
rebuilt to close every finding (`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`). The state
machines below are largely the ones the first version specified, the destination states, the GO LIVE
button, the drag-to-break peak and the Pro layer all still run on the same logic, but three structural
things changed: the stage now shows a **real picture** from the first frame instead of an empty
rectangle, the seventeen-step automatic hero story is gone in favour of a **4.2-second guided demo**
that hands over fast, and GO LIVE no longer dead-ends when nothing is connected. Every section below is
current; where a mechanic is unchanged from v1.0 it is stated as such rather than silently re-derived.

Every interactive element on the public page is specified here as a state machine over real data. The
data comes from `packages/core` and `packages/adapters`; nothing on this page invents a state, a
capability, a placement or a number.

**The honesty contract for the whole document:** the surface is a demo and says so. The status bar
carries a persistent, non-dismissible `info` line, "Demo surface. Nothing is broadcast anywhere.",
which is the same contract as the app's mock banner. Every state machine below runs on seeded sample
data, and every capability claim is derived from the adapter profiles rather than written.

**Silent-control rule, the audit's own P0/P1 findings turned into a design rule:** every control on
this page works from every scroll position and every surface state, or says why next to itself. GO LIVE
with nothing picked connects two destinations and says so. Screen Share switches the screen input on
rather than refusing. A live tile tapped explains END versus drag. A disconnected tile says "Tap to
connect." Nothing on the page fails silently.

---

## 1. The ten states, and who may enter them

The page uses the app's `DestinationState` union verbatim (`packages/core/src/types/destination.ts`)
and the app's `StatusChip` rendering rules. No eleventh state exists. This table is unchanged from v1.0.

`DISCONNECTED` · `AUTHENTICATING` · `READY` · `STARTING` · `LIVE` · `DEGRADED` · `RECONNECTING` ·
`FAILED` · `STOPPING` · `ENDED`

On the public page, `FAILED` and `STOPPING` are reachable only through the peak's break sequence or an
explicit "stop this destination" action, never as a dead end a visitor stumbles into.

| State | Label | Dot | Pulses | Status line on this page |
|---|---|---|---|---|
| `DISCONNECTED` | Not connected | hollow ring | no | The tile's own connection method (§3.2) |
| `AUTHENTICATING` | Signing in | solid | no | `Waiting for {platform}…` |
| `READY` | Ready | solid | no | `Goes live when you tap GO LIVE` |
| `STARTING` | Starting | solid | no | `Telling {platform} you are live` |
| `LIVE` | Live | solid + halo | **yes** | `{height}, {format}` |
| `DEGRADED` | Live, rough | solid | no | `Frames are being dropped` |
| `RECONNECTING` | Reconnecting | solid + halo | **yes** | `Attempt 1 of 10, retrying in 4 s` |
| `FAILED` | Failed | 20px `alert` glyph, no dot | no | First clause of the error's WHAT |
| `STOPPING` | Stopping | solid at 55% | no | `Telling {platform} the stream ended…` |
| `ENDED` | Ended | solid | no | `Streamed {duration}` |

Exactly two states pulse. Under `prefers-reduced-motion: reduce` the halo becomes a permanent
full-opacity ring plus a 1px outline.

---

## 1a. The picture, real from the first frame

This section is new in v2.0. The audit's single loudest finding was that the stage was "an empty
grey rectangle", a production tool that never once showed a frame of picture. `picture.ts` exists to
close that finding, and it owns the only real pixels on the page.

### 1a.1 What is on the stage, and when

| Source | What it is | When it shows |
|---|---|---|
| **Sample picture** | A generated creator clip, `creator.mp4` / `creator.webm` (960×540, poster `creator.webp`), playing on the stage from first paint | Default, whenever the visitor has not granted their own camera |
| **Guest clip** | A second generated clip, `guest.mp4` / `guest.webm` / `guest.webp`, composited alongside the sample picture | Only while the Guest Moment is active |
| **Screen asset** | `screen.svg`, built from the same three brand colours as the rest of the composed canvas, shown `contain` on a dark ground | Only while the Screen Share Moment is active |
| **The visitor's own camera** | Real `getUserMedia` video, local only | After "Use my camera" succeeds, in the hero band and again on the stage |

### 1a.2 "Use my camera"

One button, present in the hero band and again on the stage, wired to the same `useCamera()` call.
Requesting the camera is local only: `getUserMedia({ video: … })`, no audio, no recording, no upload.
The DOM preview is mirrored (`is-mirrored`) as a self-view convention; the composed picture that would
go to a destination is never mirrored, because people watching would read reversed text.

Every outcome is explained in place, next to the button, never silently:

| Outcome | What is said |
|---|---|
| Granted | "Your camera is on the stage. It stays in this tab and is never uploaded." The Main Camera Moment is selected and the tour's "camera" step completes. |
| Denied | "No camera permission, so the sample picture stays. Nothing was recorded." |
| No device found | "No camera was found, so the sample picture stays." |
| Insecure context | "A camera needs a secure page. The sample picture stays." |
| Stopped by the visitor | "Camera stopped. Back to the sample picture." |

At every outcome except denial and insecurity the sample picture is exactly as good a stand-in as it
was before the attempt: nothing regresses to an empty stage.

### 1a.3 One picture, many crops

`compose()` draws the current composition, whichever layers the active Moment specifies, in the
active format's safe-area placement, into a 2D canvas context. This is the one drawing routine on the
page: the six output previews in ACT 5 OUTPUTS and every connected destination tile's own thumbnail all
call it, at 12 fps, so an output is a re-crop of the real production rather than a second drawing of
it. The loop is off whenever its canvas is not visible, and under reduced motion it draws once per
state change instead of on an interval.

---

## 2. DESTINATION TILES

### 2.1 Always on the surface, not gated to an act

In v1.0 the six destination cards lived on a `pan` shelf that arrived during a dedicated CONNECT act.
That shelf does not exist any more. The six tiles are part of the fixed live surface (`.ltp-dests`),
present and operable from first paint, exactly like the stage and the toolbar. There is nothing to
scroll to before a visitor can connect a destination.

### 2.2 The six destinations, and the honest state each one starts in

Derived from `PLATFORM_PROFILES` in `packages/adapters/src/profiles/`. The badge is derived from
`profile.capabilities.streamKey` through the same three-way mapping the app's onboarding uses, never
written by hand. `ceilingMbps` is the number the OUTPUTS chapter prints as "up to N Mbps" (§8).

| Platform | Method | Badge | Auto-starts | Supported aspects | Preferred | Ceiling | Chat readable |
|---|---|---|---|---|---|---|---|
| **YouTube** | Connect account | success | no | 16:9, 9:16 | 16:9 | 40 Mbps | yes |
| **Twitch** | Connect account | success | yes | 16:9, 9:16 | 16:9 | 6 Mbps | yes |
| **TikTok** | Paste stream key | info | no | 9:16 | 9:16 | 4.5 Mbps | **no** |
| **Instagram** | Paste stream key | info | no | 9:16 | 9:16 | 6 Mbps | **no** |
| **X** | Paste stream key | info | no | 16:9 | 16:9 | (X's own ceiling) | **no** |
| **Facebook** | Connect account | success | yes | 16:9, 9:16 | 16:9 | (Facebook's own ceiling) | yes |

TikTok's tile says, in one `metadata` line: "You start and end the broadcast in TikTok. LIVETAP sends
the picture." Instagram's says the key rotates every session and is never stored. No platform logos, no
platform colours: the platform's name, set as text, is its identity.

### 2.3 The tile

A destination tile is a `<button>` with four regions, the same shape at every state so nothing reflows
when a state changes: name and grip, badge plus format label, `StatusChip`, and the chip's own status
line. The grip and the overflow control exist only while the tile is `LIVE` and the peak (§4) is armed;
at every other time their 44px slots are reserved but empty.

### 2.4 The state machine

```
                    tap / Enter / Space
  DISCONNECTED ───────────────────────────▶ AUTHENTICATING
       ▲                                          │
       │ tap again (unpick)                        │ (connect-account platforms)
       │                                           │ (paste-key platforms, which
       │                                           │  also show the key field first)
       └───────────────────────────◀────────── READY
                                                   │
                                       GO LIVE at zero (§5)
                                                   ▼
                                               STARTING ──▶ LIVE
```

| Transition | Trigger | What paints |
|---|---|---|
| `DISCONNECTED` → `AUTHENTICATING` | tap, `Enter`, `Space` | Chip flips in one frame. The path stub appears at the port. |
| `AUTHENTICATING` → `READY` | timer | The signal path **draws** from the stage's port to the tile's port. Chip → `Ready`. |
| `READY` → `DISCONNECTED` | tap again | Path fades, then is removed. Chip → `Not connected`. |
| paste-key platforms | tap | Before `AUTHENTICATING`, the tile expands in place to show a real `TextField` labelled "Stream key", with a demo value prefilled and visibly marked as a demo host. |

### 2.5 The path that gets drawn

One `<path>` per connected destination, in the SIGNAL layer, from a fixed port on the stage's edge to
an 8px anchor on the tile's leading edge. The path is a cubic bezier with slack, stroke 2px,
`stroke-linecap="round"`, colour by state, idle, ready, live (with a slow carrier travelling along it),
strained during the peak's tension, and not drawn at all while `RECONNECTING`, which is the point.

### 2.6 Accessibility

Every tile is a `<button>`. Tab order is the destinations' own order. `Enter` / `Space` picks and
unpicks. Each tile's accessible name carries its platform, its state, its connection method and the
word "demo." One `aria-live="polite"` region announces each `READY`. Reduced motion draws the path by
opacity instead of by animated stroke and skips the tile's scale change; every state change is instant
and announced. Tile targets are ≥ 168 × 44px at every breakpoint.

---

## 3. SHAPES (ACT 3)

### 3.1 One control, present in two places

The app's aspect-ratio segmented control, three segments, **16:9**, **9:16**, **1:1**, is a real
roving-tabindex `role="radiogroup"`, each segment ≥ 44 × 44px. It lives permanently in the toolbar, and
it is **mirrored** in the SHAPES band while that chapter is active, so a visitor who has not scrolled
past the hero can still reach it, and a visitor reading the SHAPES chapter sees the same control they
already used. The two controls are one state, painted twice.

The segment sets the **master canvas** shape. What each destination receives is computed, not chosen.

### 3.2 The re-flow uses the product's own maths

The stage re-flows by running the same functions the app runs, copied verbatim into `data.ts`:
`SAFE_AREAS`, `insetToSafeArea()` and `chooseAspect()`. Nothing on this page is hand-placed.

| Aspect | top | bottom | left | right |
|---|---|---|---|---|
| `16:9` | 0.05 | 0.06 | 0.05 | 0.05 |
| `9:16` | 0.12 | **0.28** | 0.05 | **0.16** |
| `1:1` | 0.06 | 0.12 | 0.06 | 0.06 |

The 9:16 insets are the visible payoff: the bottom 28% and the right 16% are where a vertical platform
puts chat and its action buttons, so tapping 9:16 visibly moves the composition out of that band. Those
two zones are drawn directly on the picture, labelled "Chat and captions" and "Buttons," and they show
whenever the SHAPES chapter is the active act **or** the picked format is not 16:9, so a visitor who
picks 9:16 in SHAPES and keeps scrolling still sees why the picture looks the way it does.

### 3.3 State machine

```
  format ∈ {16:9, 9:16, 1:1},  default 16:9 (9:16 on phones)
  ─────────────────────────────────────────────────────────
  tap / arrow ─▶ set format
                 ├─ stage aspect-ratio animates, --lt-ease-standard
                 ├─ each visible layer re-placed through insetToSafeArea()
                 ├─ every connected tile's own thumbnail re-composes at 12 fps
                 ├─ the status bar's format readout updates
                 └─ announce the new composition
```

Nothing else changes. The destination states, the Moment, the chat and the clock are untouched, because
changing the canvas shape does not change what is connected.

### 3.4 Accessibility

`role="radiogroup"` with `aria-label="Canvas shape"`; each segment `role="radio"` with `aria-checked`;
roving tabindex; `Home` / `End` supported. Under reduced motion the aspect change is instant and the
guides appear by opacity. Targets are 44px at every breakpoint, including desktop, the app's own
control currently fails this at 46×32, and this page fixes it rather than reproducing it.

---

## 4. BREAK IT (ACT 2, the peak)

This section replaces v1.0's "FAILURE AND RECOVERY" section. The mechanics are unchanged from v1.0:
the state machine, the countdown, the sibling-isolation guarantee, but the **trigger** changed: v1.0
described two paths, an automatic one from the seventeen-step hero story and a visitor-driven one from
the drag. The automatic path is gone along with the hero story (§9). Every break on this page now
happens because the visitor caused it.

### 4.1 The machine

```
  LIVE ──break──▶ DEGRADED ──700 ms──▶ RECONNECTING(t=4 s) ──t=0──▶ LIVE
                     │                        │
                     │                        └─ path absent, ring counting, attempt 1 of 10
                     └─ path at strain colour, chip "Live, rough"
```

| Trigger | Path |
|---|---|
| One tap | The BREAK IT band's own button: "Go live, then break YouTube" if nothing is live yet (it connects, goes live, and breaks a destination on a short timer), "Break {name} for me" once something is live |
| Drag | The drag crosses the 168px-equivalent threshold (`LIVETAP_SCROLL_STORY.md` §7) |
| Keyboard | `Delete` / `Backspace` on a focused `LIVE` tile, or seven arrow-key nudges |
| Reduced motion | Same triggers, `DEGRADED` skipped, no positional animation |

### 4.2 Siblings are untouched, as an assertion

Across the whole break-to-heal sequence, for every destination other than the broken one: `transform`
and `opacity` unchanged, chip state and status line unchanged, path geometry unchanged, pulse phase
uninterrupted, the elapsed clock keeps counting, no re-layout. This is the one claim the peak exists to
make, and it is asserted by a test, not by intention.

### 4.3 What the visitor is told

An `ErrorCard` opens **in place, beside the broken tile**. It renders the app's four fields with
exactly one primary action:

| Field | Copy |
|---|---|
| WHAT | `YouTube stopped accepting video.` |
| WHY | `The connection to YouTube dropped. Your other destinations are not affected.` |
| DOING | `LIVETAP is reconnecting on its own. Attempt 1 of 10.` |
| YOU CAN | `Wait for it, or stop this destination and keep the others live.` |
| Action | `Stop this destination.` Pressing it moves the tile to `ENDED`; the rest stay `LIVE`. |

The error code is never displayed on the Simple surface; technical detail lives behind the Pro layer's
`<details>` disclosure.

### 4.4 Accessibility

The break and the heal are `aria-live="assertive"`. The countdown announces once, on its first tick,
`polite`. The `ErrorCard`'s WHAT is `role="alert"`. Focus does not move on the break. Every trigger has
a keyboard and a touch equivalent (`LIVETAP_SCROLL_STORY.md` §7.4).

---

## 5. GO LIVE, and going live everywhere

### 5.1 Always in the toolbar, not gated to an act

`GoLiveButton` lives in the desk toolbar, present from first paint, exactly like the destination tiles
and the format control. There is no separate "MULTISTREAM" chapter any more, going live happens
whenever the visitor taps it, at whatever scroll position they are at. Because every destination here
is a demo, the label is **`GO LIVE (DEMO)`**.

### 5.2 GO LIVE never dead-ends

This is the clearest behavioural change from v1.0. The first version disabled the button with nothing
connected and printed "No destination is ready." The audit named that a silent-control failure (P0 #7),
so this version's button always works: with nothing connected, tapping it (or the peak's one-tap CTA)
connects the current intent's two suggested destinations first, then goes live, and says so in the
subtitle rather than refusing the tap.

### 5.3 State machine

```
  idle ──tap/Enter/Space──▶ (connect nothing-picked destinations if needed) ──▶ countdown(3) ──at zero──▶ starting ──▶ live
   ▲                                                                                │
   │                                            tap again, Escape, or Cancel        │
   └────────────────────────────────────────────────────────────────────────────────┘
```

| Phase | What paints | Announced |
|---|---|---|
| `idle`, nothing ready | Subtitle: "GO LIVE, LIVETAP connects two demo destinations first." Never `aria-disabled`. | (none) |
| `idle`, something ready | Subtitle: "GO LIVE on {n} demo destinations." | (none) |
| `countdown` | The numeral in `display` type, 3 → 2 → 1, with `Cancel` beside it. | "Going live in 3 seconds. Press Escape to cancel." |
| cancel | Back to `idle`. No destination changed state. | "Cancelled. You are not live." |
| `starting` | Every ready destination → `STARTING`. | "Going live on {n} destinations." |
| `live` | Every path lights together, in one frame. The elapsed clock starts. Chat begins (§10). | "You are live on {names}." |

### 5.4 No invented statistics

Unlike v1.0, this version carries no scroll-triggered `count` device animating a number upward, that
choreography was cut along with the rest of the per-act devices
(`LIVETAP_SCROLL_STORY.md` §5.1). The status bar's destination count and format count are plain text
readouts, updated the instant the underlying state changes, not counted up on a timeline. No bitrate,
viewer count or dropped-frame percentage is invented anywhere on the page; where a number like a
platform's Mbps ceiling appears, it is the platform's own published figure (§2.2, §8).

### 5.5 Accessibility

`Escape` cancels from anywhere on the page. The countdown does not steal focus. Going live and any
failure use `aria-live="assertive"`. The clock is `aria-live="off"` and carries `aria-label="Live for
{n} minutes"`. Under reduced motion the countdown is a digit swap with no scale, and the paths light in
one frame with no carrier.

---

## 6. MOMENTS (ACT 4)

### 6.1 The six Moments, real

From `MOMENTS` in `data.ts`, copied verbatim from `defaultMoments()`. The strip lives in the fixed
desk, present from first paint, and is **mirrored** in the MOMENTS band while that chapter is active,
the same two-places-one-state pattern as Shapes.

| id | Name | What changes on the stage |
|---|---|---|
| `starting-soon` | Starting Soon | Ground plus the words "Starting soon"; camera hidden; mic muted |
| `main-camera` | Main Camera | Full-frame picture |
| `screen-share` | Screen Share | The screen asset fills the frame, camera insets in a corner; **the screen input switches on** rather than the Moment refusing |
| `guest` | Guest | Two-up: the sample picture and the guest clip, side by side |
| `break` | Break | Ground plus "Back in a moment"; mic muted |
| `ending` | Ending | Ground plus "Thanks for watching" |

Intent renames apply from `RENAME`, so after ACT 8 the strip can honestly read **Gameplay** (gaming) or
**Slides** (presentation) instead of Screen Share, and **Conversation** (podcast) instead of Guest.

### 6.2 Screen Share is a real answer, not a refusal

v1.0 gated the Screen Share Moment behind a real screen source and disabled it otherwise. This version
switches the screen input on the moment it is needed, exactly as the silent-control rule requires: a
Moment that needs a source it does not have turns that source on rather than telling the visitor no.

### 6.3 State machine

```
  activeMoment ∈ the six ids,  default main-camera
  ────────────────────────────────────────────────
  tap / Enter / Space / keys 1-6 ─▶ set activeMoment
        ├─ outgoing layers fade over the Moment's own transition duration
        ├─ incoming layers placed for the current format, opacity → 1
        ├─ audio state adopted: micMuted from the Moment (Starting Soon and Break mute)
        └─ announce: "Moment: {name}."
```

The stage frame never moves during a Moment change; only its contents cross over.

### 6.4 The three input toggles, always available

Camera, Microphone and Screen are permanent toolbar buttons, not a choreographed three-step reveal tied
to a scroll position (v1.0's PRODUCE act staggered them in over 210ms; that stagger does not exist any
more, because the toolbar is always on screen). Camera is on from the first frame with the sample
picture; the mic switches on during the guided demo (§9) or on tap; the mic's `Meter` carries a real
`aria-valuenow` and a peak-hold marker.

### 6.5 Accessibility

`aria-pressed` on every Moment card; `1`–`6` shortcuts active only when focus is not in a text field;
`M` toggles the mic. The strip is a horizontal scroll region on mobile with real overflow. Under reduced
motion the layer crossover is an instant swap.

---

## 7. OUTPUTS (ACT 5)

New section: this chapter did not exist in v1.0. It is the direct answer to the audit's P0 finding #6,
*"show the six outputs from one production"*, which v1.0 only promised in words ("One production,
six correct pictures" was a sentence, not an image).

### 7.1 Six live canvases, one production

Six small canvases render side by side, one per destination, each drawn by the same `compose()` call
that paints the stage and every tile thumbnail (§1a.3). Each carries:

- the platform's **name**
- the **shape** it is receiving (16:9, 9:16 or 1:1, computed by `chooseAspect()`, not chosen by hand)
- **"up to N Mbps"**, the platform's own published ceiling from `DESTINATIONS[].ceilingMbps` (§2.2)
- its own `StatusChip`, identical in rules to the destination tile's chip

The 9:16 outputs carry the chat-safe band drawn on them, because "your face is not under the chat" is
the part of the claim a creator actually cares about (`LIVETAP_MOTION_SYSTEM.md` companion note).

### 7.2 Update cadence

Twelve frames per second, matched to the picture engine's own loop, and off entirely when the chapter
is not on screen. Under reduced motion the canvases redraw once per state change rather than on an
interval, a format change, a Moment change, or a destination reaching a new state.

### 7.3 Accessibility

Each output figure carries a text caption naming the platform, the shape and the state, so the
information survives without the canvas. Nothing in this chapter is interactive beyond the shared
Shapes and destination controls; it is a demonstration, not a new set of inputs.

---

## 8. VERSUS (ACT 6)

New section: this chapter did not exist in v1.0, which never named a competitor. It answers the audit's
P1 finding #17 and #18 directly: *"OBS never mentioned, no comparison"* and *"position against
Restream, StreamYard, Streamlabs, Riverside."*

### 8.1 Two playable lanes, not a table

"Instead of OBS." presents two lanes a visitor presses through rather than reads:

- **Lane A, OBS**: reveals, one tap at a time, the fourteen concepts OBS's own Quick Start guide names
  before a first stream, in that guide's order.
- **Lane B, LIVETAP**: reveals six measured taps, two questions, zero broadcasting words, the golden
  path a visitor has already walked on this page by the time they reach this chapter.

No tap count and no minutes figure is printed for OBS. `docs/research/SWITCHING_TRIGGERS.md` contains
no instrumented click count for it, and inventing one would be exactly the kind of number this project
refuses to publish; the module counts concepts, not clicks, and says so in its own source line.

### 8.2 Every number is traceable

| Claim | Source |
|---|---|
| LIVETAP's six taps, two questions, zero broadcasting words | `docs/qa/FRICTION_BENCHMARK.md` §2, each one asserted by a test |
| OBS's fourteen concepts, in order | `docs/qa/FRICTION_BENCHMARK.md` §3, citing `docs/research/SWITCHING_TRIGGERS.md` T6/T1 |
| The four competitor lines (Restream, StreamYard, Streamlabs, Riverside) | One sentence each, cited to `docs/research/COMPETITOR_FAILURE_DATABASE_A.md`, carried in `data-lt-source` on the element so a reviewer can check it without reading the module |

### 8.3 Playing lane B moves the real surface

Pressing "play" on the LIVETAP lane is not a separate simulation: it picks the Talking intent, connects
YouTube and TikTok on the real surface, and goes live, exactly as if the visitor had done it by hand on
the stage. The comparison is not a video of the product; it is the product.

### 8.4 Accessibility

Motion is opacity and transform only, and every chip in both lanes is present in the DOM from the
moment the chapter mounts, the reveal is decoration over content a screen reader can already read, not
a gate in front of it. Reduced motion lands every reveal at its final value with no stagger.

---

## 9. THE GUIDED DEMO

This section replaces v1.0's "THE HERO AUTO-STORY" entirely. The seventeen-step, ~22-second automatic
sequence, camera on, mic on, three destinations reaching `READY` then `LIVE`, a scripted degrade and
recover at steps 14–17, does not exist in this build. It ran underneath the chaos lattice and was
named directly by the audit as agency-stealing: *"the product was already 'live', and I had not agreed
to anything."*

### 9.1 What the 4.2-second demo does

One `createTimer`, run once at mount, on its own clock, never on scroll:

| At | Step |
|---|---|
| 0.5 s | Microphone switches on |
| 1.1 s | The intent's first suggested destination connects |
| 1.8 s | The intent's second suggested destination connects |
| 2.5 s | One more destination connects (skipped on phones, where only two destinations are suggested) |
| 3.3 s | The status bar's readouts repaint |
| 4.2 s | Hand-over: "Your turn. Tap GO LIVE. Nothing is broadcast from this page." is written under the button, and the button breathes twice |

It never goes live by itself, and it never triggers a break. Both of those now require the visitor.

### 9.2 Interruption is total and immediate

**Any visitor action cancels the demo permanently, and the surface keeps whatever state the action
produced.** A tap on any control, a scroll into the peak, or a keyboard focus event all call the same
`interrupt()`: the demo's timer is paused, its remaining steps are discarded rather than queued, and
the "Your turn" line is taken down if it was showing. There is no resume and no replay button. The demo
exists to make the first few seconds true; after that, the visitor is operating the thing.

---

## 10. CHAT

### 10.1 Starts when the surface actually goes live

Chat begins the moment GO LIVE succeeds, visitor-triggered, at any scroll position, not on a fixed
act or on the old hero story's own clock. `startChat()` seeds four messages immediately, then continues
on a jittered interval.

### 10.2 The corpus is real sample data, and it is labelled

Messages are drawn from a trimmed copy of `packages/adapters/src/mock/corpus.ts`'s display names,
messages and badge pool, weighted so most authors carry no badge and a few carry `subscriber`,
`member`, `moderator` or `verified`. Every rendered row carries a `Demo` badge on the author line. Mock
chat never renders without it.

### 10.3 The platform badges are honest, and three platforms are absent

Chat is shown only for platforms whose chat API is automated: YouTube, Twitch and Facebook. TikTok,
Instagram and X are absent, and the panel's footer states it once: "TikTok, Instagram and X publish no
live chat API, so nothing from them appears here."

### 10.4 Rate limits

| Limit | Value |
|---|---|
| Arrival interval | Jittered, seeded, deterministic per page load |
| Maximum rows in the DOM | Capped, oldest removed |
| Paused off-screen | Yes, via `IntersectionObserver` and `visibilitychange` |
| Auto-scroll | Never while the visitor has scrolled up |

### 10.5 Accessibility

`role="log"` with `aria-live="polite"` and `aria-relevant="additions"`. The `Demo` badge is part of each
row's accessible text, not a colour. Message rows are not tab stops.

---

## 11. PRO (ACT 7)

### 11.1 One control, present in two places

A `Toggle`, labelled `Pro`, lives permanently in the toolbar and is **mirrored** in the PRO band while
that chapter is active, the same pattern as Shapes and Moments. Turning it on adds four panels above
the desk: Quality, per-platform Ceiling, Audio and the session Log.

### 11.2 The rule that makes it respect, not clutter

**Nothing the visitor has already learned moves.** Pro is additive: the stage stays the same size in
the same place, the destination row keeps its positions, the Moment strip keeps its positions. The
panels appear in space that was empty. This page does not switch density to `pro`; it adds Pro
**content** at Simple **density**, which is a deliberate divergence from the app's own behaviour,
recorded rather than treated as an oversight.

### 11.3 State machine

```
  pro ∈ {off, on},  default off
  ───────────────────────────────
  toggle ─▶ pro = !pro
      on  ├─ panels mount above the desk
          ├─ opacity 0 → 1, 200ms, 60ms stagger across the four panels
          ├─ the technical <details> disclosure becomes available on the ErrorCard
          └─ announce: "Pro shown."
      off ├─ panels unmount
          └─ announce: "Pro hidden."
```

v1.0 additionally carried the Pro layer on a scroll-linked `parallax` plane, so it appeared to recede
behind the surface as the act scrolled. That device is gone with the rest of the per-act choreography
(`LIVETAP_SCROLL_STORY.md` §5.1); the panels now simply mount above the desk, in place, with the same
opacity-plus-stagger reveal but no parallax translate.

### 11.4 Accessibility

`aria-pressed` on the toggle; the panels are in the DOM only while `pro` is on, so nothing focusable is
parked at opacity 0; `<details>` disclosures are native. Under reduced motion the panels appear
instantly with no stagger.

---

## 12. THE INTERACTIVE TOUR

Optional, and the visitor operates it. It is not a slideshow and it does not scroll the page for them.
The seven steps are unchanged in count from v1.0, but every target and prompt is rewritten to match the
current chapters.

### 12.1 The seven steps

| Step | Prompt | Target act |
|---|---|---|
| 1 | Put your own camera on the stage. | HERO |
| 2 | Go live. | HERO |
| 3 | Break it. Drag a live destination off the stage. | BREAK IT |
| 4 | Change the shape. | SHAPES |
| 5 | Switch what viewers see. | MOMENTS |
| 6 | Look underneath. | PRO |
| 7 | Tell LIVETAP what you are making. | MAKE |

### 12.2 Rules

- **It never advances by itself.** No timer, no auto-advance.
- **It never scrolls the page.** Each step carries one text link, "Take me there," a real anchor to the
  act. The visitor chooses to follow it.
- **It never blocks.** The surface is fully operable with the tour open, and the tour is dismissible at
  any step.
- **It has no progress counter.** Completed steps are struck through; there is no "3 / 7."
- Steps complete out of order and only on a genuine action, re-picking the shape that was already
  selected does not complete "change the shape," because a tour that completes its own steps is a
  funnel.

### 12.3 Accessibility

`role="region"` with `aria-label="Guided tour"`, `role="list"` of steps, each completion announced
`polite`. Focus is not trapped, because the tour is not a dialog.

---

## 13. WHAT IS TRUE WITHOUT SCROLLING

This section replaces v1.0's "THE 15-SECOND TEST." The old section derived six facts a visitor should
absorb from the automatic hero story within roughly fifteen seconds without touching anything. That
premise no longer holds: the guided demo is 4.2 seconds, it never goes live, and it never demonstrates
recovery on its own, because both of those are now things the visitor causes rather than watches. What
is true at first paint, before any scrolling or tapping, is narrower and more honest:

| # | The fact | Visible by |
|---|---|---|
| 1 | **The stage shows a real picture, not a placeholder.** | First paint |
| 2 | **This operates several platforms from one production.** | Six destination tiles, always present |
| 3 | **You operate it with one button that never refuses you.** | The toolbar's `GO LIVE (DEMO)`, first paint |
| 4 | **It is free, open source, and runs on your machine.** | The status bar's persistent line, first paint |
| 5 | **The guided demo shows three destinations reaching `READY`, unassisted, in 4.2 seconds, then hands over.** | 4.2 s |

Everything else this page claims, the peak's resilience, the six shapes, the six Moments, the six
outputs, the OBS comparison, the Pro depth, is something the visitor discovers by scrolling or
tapping, not something the page performs at them. That is a narrower first-paint promise than v1.0
made, and it is the more honest one: a page that only shows what is true without asking anything of the
visitor cannot claim to demonstrate resilience or shape-switching, because neither happens until someone
causes it.

---

## 14. ACCESSIBILITY: THE FLOOR FOR EVERY DEMO

The app's accessibility floor applies unchanged. These are the additions that only a page like this
needs, carried over from v1.0 and still current.

| # | Rule |
|---|---|
| 1 | **Every demo has a keyboard path to every state it can reach.** The same action, on the same element, from the keyboard, not a "simulate failure" button. |
| 2 | **One live region per concern, not one per element.** Destination states (`polite`), broadcast state (`assertive`), chat (`role="log"`, `polite`, `additions`), tour progress (`polite`). |
| 3 | **Nothing focusable is ever parked at opacity 0.** Content that has not appeared yet is not in the DOM, or is `inert`. |
| 4 | **44 × 44px on every interactive element at every breakpoint**, desktop included for the format segments and the drag grip. |
| 5 | **Reduced motion means instant state changes with no positional animation.** No path draw, no tile movement, no scale, no countdown ring animation. Every state, every number and every announcement is identical to the full-motion page. |
| 6 | **Focus is never moved by the page**, except on `Escape` from the tour, which returns it to the entry point. |
| 7 | **Every state change a sighted visitor notices passively is announced**, and the announcement says what changed rather than what it looks like. |
| 8 | **Forced colors survive**: focus uses `outline`, and where a colour is the semantics the component pairs `forced-color-adjust: none` with a border. |
| 9 | **The page is comprehensible with JavaScript disabled**: the surface renders its first-paint markup server-side, the acts are real sections with real headings, and the facts in §13 are present as text in the DOM. It is not operable without JS, and it does not pretend to be. |
