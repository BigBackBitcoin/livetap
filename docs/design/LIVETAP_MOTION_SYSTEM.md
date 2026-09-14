# LIVETAP Motion System, the public experience

**Version** 3.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Choreography library** Anime.js **4.5.0** (`animejs`), a real dependency of `apps/web` (`^4.5.0` in
`apps/web/package.json`), imported from its subpaths (`animejs/animation`, `animejs/draggable`, etc.)
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` ·
`LIVETAP_INTERACTION_SYSTEM.md` · `scrollcraft/builds/livetap-public/PLAN.md`

**What changed since v1.0.** v1.0 described a page with nine Scroll Craft device families, a
scroll-linked "chaos collapse" choreography, an atmosphere canvas and a `createScope`-based reduced
motion branch that could flip live mid-visit. A first-time-creator audit found the deployed page's main
thread jammed by exactly that stack, the wheel did nothing because the browser was busy hit-testing
fixed, cue-driven, parallaxed layers on every frame (`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`
§0). The rebuild's answer was not to tune the choreography but to remove almost all of it: every act
became `pin`, one fixed band cross-faded by a listener carried every chapter's copy, and the only
Scroll Craft device families left in the build were `pin` and `flow`.

**What changed since v2.0.** That rebuild passed its own performance gate and still read wrong: the
owner said the spacing and flow seemed off, and asked for the full Scroll Craft process to run again
without holding anything back from it. Removing every device family had traded one problem for
another, a page that scrolled cheaply but felt like one section shown eight times. This version
restores five of the removed device families, `reveal` (twice, iris and up), `pan`, `count`, and
`flow`+`in`, plus pointer `tilt` on the close, to the five chapters between the peak and the close,
without touching the chaos collapse, the atmosphere canvas or the live-toggling reduced-motion branch,
none of which come back. **The rule motion communicates a state change, and nothing else animates**
still holds, and it now holds over more of the page than v2.0 left it holding over, because more of the
page is doing something a wheel or a pointer caused.

The app already holds that line in three durations and four easings. This page still adds no new
duration and no new easing token. It now names **six** motion classes, the same six v2.0 named, because
the returning Scroll Craft devices are owned and paid for by the engine itself, not by a seventh
page-authored motion class; the chaos collapse those six replaced in v1.0 still does not exist.

---

## 1. Install and import

`animejs` **is** a dependency of `apps/web` today (`"animejs": "^4.5.0"`). Nothing to install; this
section is kept only so the import discipline is written down somewhere normative.

Import from the **subpaths**, never the root export and never a CDN. `apps/web/vercel.json` sets
`script-src 'self'`, so a CDN script would be blocked with no visible error. This is what the page
actually imports today, and it is a shorter list than v1.0 planned, no `createTimeline`, no
`createScope`, no `stagger`, because there is no per-act timeline choreography left to build with them:

```ts
// apps/web/src/public/main.ts
import { animate }          from 'animejs/animation';
import { createDraggable }  from 'animejs/draggable';
import { onScroll }         from 'animejs/events';
import { createTimer }      from 'animejs/timer';
import { createSeededRandom, set } from 'animejs/utils';
import { spring }           from 'animejs/easings/spring';
import { engine }           from 'animejs/engine';

// versus.ts additionally imports animate and createTimer for its two playable lanes.
```

### 1.1 Global engine settings, set once at mount

```ts
engine.fps = 30;                    // default 240. Halves the page's animation work on every device.
engine.pauseOnDocumentHidden = true; // already the default; asserted rather than assumed
engine.precision = 2;               // default 4. Two decimals is below a device pixel.
engine.defaults.ease = 'outQuad';
engine.defaults.duration = 200;
```

Unchanged from v1.0. `engine.fps = 30` is still the single most valuable line in the file.

---

## 2. Who owns what: the two-system contract, and the one honest exception

There are two motion systems on this page, and, new in this version, one very small third reader
that exists purely so a chapter's band can know which one is active. The boundary is a table, and it is
testable.

### 2.1 The division

| | **Scroll Craft** | **Anime.js** |
|---|---|---|
| Reads scroll | Yes: to hold each act pinned for its span, to pan the MOMENTS lane, to open and close every band's cue, to drive the two OUTPUTS counters and the SHAPES/PRO reveals, and (via `onScroll` in method mode) to detect when a declared rest enters or leaves the viewport | No. Never continuously; `onScroll` only fires playback methods at a threshold. |
| Drives | Act pinning, the reduced-motion floor, both rests' hold state, every band's cue window, the MOMENTS pan, the OUTPUTS counters, the SHAPES iris and the PRO up-wipe, and the VERSUS staggered entrance | Every state-change transition, the guided demo, both countdowns, path draws, chat arrival, the drag with its spring release, and the six output canvases' own redraw loop |
| Trigger | The wheel, for pinning, panning and cue windows | A timer, a tap, a key, a pointer, or a scroll **threshold** |
| Written in | `data-sc-act` / `data-sc-cue` / `data-sc-pan` / `data-sc-reveal` / `data-sc-count` / `data-sc-in` / `data-sc-tilt` on real markup | `animate()` / `createDraggable()` / `createTimer()` inside plain functions, no scope wrapper |

**This version uses seven of the engine's device families: `pin`, `flow`, `reveal` (twice, iris and
up), `pan`, `count`, `flow`+`in`+stagger, and pointer `tilt`.** That is a deliberate expansion from
v2.0, whose entire vocabulary was `pin` and `flow`: v2.0 traded away every cue device to fix a
main-thread jam, and it fixed the jam, but the owner read the result as flat, "the spacing and flow
seems off," and this version restores variety chapter by chapter rather than reintroducing the v1.0
choreography that caused the original jam. Two device families from v1.0's nine still do not appear
anywhere on this page: `parallax` and `drift`. Both stay cut for the reasons `LIVETAP_VISUAL_DIRECTION.md`
§2.1 and §4.6 record, not because this revision ran out of budget for them
(`LIVETAP_SCROLL_STORY.md` §5.1).

### 2.2 The third reader: `watchActs()`, and why it is not a violation

v1.0's rule was written as an absolute: "Scroll Craft is the only thing that reads scroll position."
That is no longer strictly true, and this document says so rather than quietly keeping a stale claim.
`main.ts`'s `watchActs()` carries its **own** `scroll` / `resize` listener, gated behind a single
`requestAnimationFrame`, whose only job is to compute which act's box contains the point 45% down the
viewport and toggle a `classList` on the matching rail item and a couple of boolean flags (whether the
peak is armed, whether the SHAPES guides should show, whether the close is dimming the monitor).

**Its job shrank in this revision, and that is the point.** In v2.0, `watchActs()` also toggled
`is-here` to decide whether a chapter's band was *visible*, because every chapter shared one fixed band
layer and something had to decide which panel to show. Now each band lives inside its own act and reads
its own visibility from the engine's own cue (`LIVETAP_SCROLL_STORY.md` §6); `is-here` still exists, and
`watchActs()` still sets it, but it governs **pointer-events only**, whether a fading band should still
catch a tap meant for the console underneath it. `watchActs()` has gone from deciding what copy is
readable to deciding what is clickable, a strictly smaller job than it had in v2.0, even though the
page around it grew more devices.

Three things keep this from re-creating the problem it replaced:

1. **It writes nothing Scroll Craft or Anime.js also writes.** It only ever toggles `classList`
   membership and a few booleans; it never touches `transform`, `opacity`, `clip-path` or any SVG
   attribute. The "no two systems on one property" rule (§2.3) still holds, because this is a third
   system that does not touch animated properties at all.
2. **It is one listener, one rAF, no per-frame style read.** It reads `scrollY` and `innerHeight`, both
   of which are already-computed layout values, not `getComputedStyle().getPropertyValue()` against a
   custom property, which is what actually cost the old page a style recalculation every frame.
3. **The band's own visibility is now the engine's cue, not this listener.** A band's opacity is driven
   by `--sc-p` through the cue window Scroll Craft itself computes and writes; `watchActs()` no longer
   participates in that write at all, which removes an entire class of "two writers, one property" risk
   that existed in v2.0's cross-fade.

`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md` §0 is the reason this distinction matters:
`audit-closure.spec.ts` asserts fewer than three long tasks in six idle seconds and 40+ fps on the
deployed page, and `watchActs()` is deliberately kept to the budget that assertion enforces even as the
device roster around it grew back.

### 2.3 The ownership table, per layer

| Layer | Who writes `transform` | Who writes `opacity` | Who writes anything else |
|---|---|---|---|
| Static falloff (the old ATMOSPHERE plane) | Nobody | Nobody | Nothing. It is one static `radial-gradient()` on `.ltp-surface::before`, present in every theme, every breakpoint and every motion setting. There is no canvas and nothing animates it (§6.4). |
| SIGNAL | Nobody. Paths are never translated. | Anime | Anime: `stroke-dashoffset`, `stroke-width`, `stroke`, `d` |
| PRODUCT STAGE | CSS transitions, triggered by a class toggle | CSS | Anime: `aspect-ratio` is **not** animated; the shape change animates `transform: scale()` on an inner frame plus a `clip-path` |
| DESTINATIONS | Anime on the tile itself (no separate parallax wrapper any more) | Anime | Anime: `box-shadow` and `background-color` |
| MOMENTS LANE | Scroll Craft's `pan` device only, on the lane itself | Nobody | Scroll Craft: the lane's own scroll-linked translate; Anime never touches this element |
| BAND | Scroll Craft's `cue` device, on the band itself (or on `.ltp-band__inner` for the two tall panels, §2.4) | Scroll Craft's `cue` device | Scroll Craft: nothing else. `watchActs()`'s `classList` toggle only ever governs `pointer-events` on this layer, never `opacity` (§2.2) |
| SHAPES / PRO reveal | Scroll Craft's `reveal` device, `clip-path` only | Nobody | Scroll Craft: `clip-path` wipe (iris on SHAPES, up on PRO) |
| OUTPUTS counters | Nobody | Nobody | Scroll Craft's `count` device: text content only, via the engine's own instance API, re-targeted by `main.ts` (`LIVETAP_INTERACTION_SYSTEM.md` §7.0) |
| VERSUS entrance | Scroll Craft's `in` device, `translateY` once on entry | Scroll Craft's `in` device | Scroll Craft: `data-sc-stagger` sequences the children |
| DATA / STATUS | Nobody. No positional animation at all. | Anime | Anime: text content via a modifier, colour, `stroke-dashoffset` on the countdown ring |
| INTERACTION (the drag) | Anime `createDraggable` only | Anime | Anime |
| MAKE chips (tilt) | Scroll Craft's pointer `tilt` device only | Nobody | Scroll Craft: a spring-damped rotate on pointer move, fine-pointer only |
| CHROME (rail / status bar) | Nobody | CSS transitions at `--lt-dur-1` / `--lt-dur-2` | CSS |

The rule that survives from v1.0: a magnet, a parallax and a cue writing the same `transform` on the
same element is what breaks a page, so where a cued element needs its own continuous transform, an
**inner wrapper** carries it rather than stacking a second writer on the same node. With no `parallax`
device on this build, this rule now protects the stage's re-flow, the drag's tile, the MOMENTS lane
(owned exclusively by the pan device) and the MAKE chips (owned exclusively by the tilt device):
nowhere on the page do two systems reach for the same `transform` on the same node.

### 2.4 The two tall panels' inner cue, and why

OUTPUTS and VERSUS carry more content than the band region was ever meant to hold, so their band grows
downward as a panel, `.ltp-band--tall`, and that panel keeps its own background stable regardless of
the cue. The cue itself, and the `opacity` it drives, sits one level in, on `.ltp-band__inner`, wrapping
the panel's actual copy and controls. This matters for verification, not just layout: §8's harness hides
cued copy to measure the ground underneath it, and if the cue sat on the panel element itself, hiding
the cue would also hide the panel's own background, which is part of what the harness is trying to
measure against.

---

## 3. The six motion classes

Every **Anime.js** animation on the page is one of these six. v1.0 named seven; the seventh, CHAOS
COLLAPSE, is removed in full, there is no chaos prologue on this page any more
(`LIVETAP_SCROLL_STORY.md` §6), so there is nothing left for that class to describe. This count does
not grow with the Scroll Craft devices this revision restored, `reveal`, `pan`, `count`, `in` and
`tilt` are owned and paid for by the engine itself (§2.1, §2.3), not by a page-authored Anime.js class,
so they are not a seventh or eighth item on this list.

### 3.1 STATE CHANGE

A chip, a badge, a border or a fill changing because a state machine moved. Unchanged from v1.0.

| Property | Value |
|---|---|
| Duration | `--lt-dur-1` (120ms) for colour and fill; `--lt-dur-2` (200ms) when a dot treatment changes shape |
| Easing | `--lt-ease-standard`, `cubic-bezier(0.2, 0, 0, 1)` |
| Animates | `opacity`, `color`, `background-color`, `border-color`. Never position, never size. |
| Composition | `'none'`, these fire rapidly and in bursts |

The chip's label text changes in the same frame as the colour, with no cross-fade.

### 3.2 CONNECTION PATH DRAW

A signal path arriving or leaving. Unchanged from v1.0.

| Property | Value |
|---|---|
| Duration | ~420ms on draw, faster on the vanish and the recoil |
| Easing | Draw: `'outQuart'`. Recoil: a two-keyframe overshoot, then settle. |
| Animates | `stroke-dashoffset` from the path's own length to 0. Nothing else. |
| Technique | `stroke-dasharray` is set once to `path.getTotalLength()` at mount, not per frame |

On the going-live beat all paths light in **one frame**, not staggered: a coordinated broadcast is the
claim, so staggering the paths would say the opposite.

### 3.3 STAGE RE-FLOW

The canvas changing shape between 16:9, 9:16 and 1:1. Unchanged from v1.0.

| Property | Value |
|---|---|
| Duration | `--lt-dur-3` (320ms) |
| Easing | `--lt-ease-standard` |
| Animates | `transform: scale()` and `clip-path` on the stage's inner frame, plus `translate`/`scale` on each layer to its new normalized placement. Never `width`, `height`, `aspect-ratio`, `top` or `left`. |
| Layer placement | Each layer's target rect comes from the active Moment's `placement` map through `insetToSafeArea()` |

### 3.4 COUNTDOWN

Two countdowns exist: GO LIVE's 3-2-1, and the reconnect ring. Unchanged from v1.0.

| | GO LIVE | Reconnect ring |
|---|---|---|
| Duration | 3 × 1000ms | 4000ms, the retry interval |
| Easing | Per-digit: none. The digit swaps. | `--lt-ease-linear`. A countdown that eases is lying about time. |
| Animates | Digit text content, swapped in one frame | `stroke-dashoffset` on a circle, full circumference to 0 |

### 3.5 CHAT ARRIVAL

Unchanged from v1.0.

| Property | Value |
|---|---|
| Duration | 200ms (`--lt-dur-2`) |
| Animates | `opacity` 0 → 1 and a small `translateY` |
| Stagger | Only on the initial seed of four rows |
| Never | Layout animation of the log. New rows are appended and the log's scroll position is set, not animated. |

### 3.6 PRO REVEAL

| Property | Value |
|---|---|
| Duration | 200ms per row |
| Animates | `opacity` 0 → 1 only. No position at all. |
| Stagger | 60ms over four rows |
| Depth | **No `parallax` translate any more.** v1.0 gave this layer `parallax="-0.6"` so it appeared to recede behind the surface as the act scrolled; that device does not exist on this build (`LIVETAP_SCROLL_STORY.md` §5.1). The panels now simply mount above the desk, in place, at whatever depth their z-order already implies. |

---

## 4. The signature move's physics, in real API

Unchanged from v1.0, and confirmed against the shipped code line for line: the peak's drag mechanics
were never implicated in the audit's performance findings, because a drag is pointer-driven and runs
off the scroll thread entirely. `dragThreshold: { mouse: 3, touch: 7 }` remains the library default.

```ts
const drag = createDraggable(tile, {
  trigger: grip,                 // only the 44x44 grip starts a drag
  container: surface,
  containerFriction: 0.35,       // resists at the edge without hard-stopping
  containerPadding: 0,
  dragSpeed: 0.92,                // trails the pointer slightly, so the tile has mass
  releaseEase: spring({ stiffness: 150, damping: 18 }),
  onGrab:    () => lift(tile),
  onDrag:    () => publishTension(Math.hypot(drag.x, drag.y)),
  onRelease: () => (tension() >= 1 ? breakDestination(id) : null),
  onSettle:  () => clearTension(),
});
```

| Concern | Resolution |
|---|---|
| Break threshold | `168 * Math.min(1, innerWidth / 1440)` px of Euclidean displacement |
| Break while still held | The break fires the first time tension reaches 1, then `drag.disable()` |
| Snap-back | Anime's own release spring |
| Re-arm | `drag.enable()` when the tile returns to `LIVE` |
| Reduced motion | `createDraggable` is **never called** (§5); a one-tap band button, `Delete`, and the tile's own drop control fire the identical `breakDestination()` |

The peak also gained a fourth, non-drag entry path in this version, a one-tap band button that
connects, goes live and breaks a destination on a short timer, so the whole mechanic is reachable
without finding the grip at all (`LIVETAP_SCROLL_STORY.md` §7.1).

---

## 5. Reduced motion: read once, not live-toggled

This section replaces v1.0's "The scope, React, and reduced motion in one place" in full. v1.0 planned a
`createScope({ mediaQueries: { reduceMotion, isPhone } })`, whose documented benefit was that a
visitor who turned on Reduce Motion mid-visit would get the reduced page without a reload, because the
scope re-runs its constructors whenever a registered media query's match state flips.

**That is not how the shipped page works, and this document says so rather than repeating the plan as
if it were the build.** `main.ts` reads both flags once, at module load, as plain booleans:

```ts
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone   = matchMedia('(max-width: 639.98px)');
const wide    = matchMedia('(min-width: 1025px)');
```

`reduced` is threaded as a plain argument into every module that needs it, `mountOutputs(host,
picture, { reduced })`, `mountVersus(host, { reduced })`, the drag setup, the guided demo, rather than
branched live from a scope. `phone` and `wide` remain live `MediaQueryList` objects and are read again
at the points that care about breakpoint (the mobile span rewrite, the layout pass), so a resize across
640px or 1024px does update the layout; **only the reduced-motion branch is fixed at load.**

**The known gap, recorded rather than hidden:** a visitor who toggles their OS-level "reduce motion"
setting mid-visit will not see this page change until they reload it. This is a real regression from
what v1.0 specified and it is not yet closed. It does not violate the accessibility floor's information
parity rule (`LIVETAP_INTERACTION_SYSTEM.md` §14 rule 5), whichever mode the page loaded in still
carries every state, number and announcement the other mode does, but it is less generous than a live
branch would be, and a future revision should either restore a scope-style re-check or add its own
`change` listener on the media query.

---

## 6. The performance budget

### 6.1 JavaScript: about 53.2 KB gzipped for the whole public page

The public experience still ships as its own Vite entry with no React and no framework. The number
moved from v1.0's 60 KB budget (46.4 KB measured at the time) because this build carries more real
logic than the plan did, `picture.ts`'s camera/compose engine, `outputs.ts`'s six live canvases and
`versus.ts`'s two playable lanes did not exist in v1.0's estimate. Restoring `reveal`, `pan`, `count`,
`in` and `tilt` in this revision cost nothing on this line: those devices are the vendored engine's own
code, already inside the `scrollcraft.js` budget below, so growing the act table's device variety did
not grow the JS the visitor downloads.

| Item | Approximate budget (gz) | Basis |
|---|---|---|
| `scrollcraft.js`, copied verbatim | ~14 KB | Vanilla, no dependencies, never edited; carries every device family the build uses, `pin` and `flow` no more or less than `reveal`, `pan`, `count`, `in` and `tilt` |
| Anime.js 4.5.0, subpath-imported | ~19 KB | Only the modules this build actually calls: `animate`, `createDraggable`, `onScroll`, `createTimer`, `utils`, `spring`, `engine` |
| The page's own logic: `main.ts`, `data.ts`, `picture.ts`, `outputs.ts`, `versus.ts`, `capture.ts` | ~20 KB | The picture/compose engine, the six output canvases and the two playable Versus lanes; `main.ts` also carries `updateCounters()`'s re-targeting of the OUTPUTS counters through the engine's instance API |
| `theme.js`, the classic pre-paint script | ~0.4 KB | Unchanged |
| Shared `@livetap/ui` CSS and the icon sprite | 0 KB of JS | CSS is a separate budget line (below); icons are inline SVG `<symbol>`s in `index.html`, not a JS module |
| React, react-router, zustand, `packages/core`, `packages/adapters`, `packages/media` | 0 KB | None of them load on `/` |
| **Total** | **~53.2 KB gzipped** | Against the same 60 KB ceiling v1.0 set |

| Other assets | Approximate size |
|---|---|
| CSS: the whole design system plus `landing.css` and `acts.css` | ~16 KB gzipped |
| Video and image assets: `creator.{mp4,webm,webp}`, `guest.{mp4,webm,webp}`, `screen.svg` | ~360 KB total, served by format negotiation so a visitor downloads one video variant per clip, not both |
| `archivo-latin.woff2`, self-hosted, subset | ~29 KB |

These are working numbers from the current build, not a `vite build --reportCompressedSize` run
captured at authoring time; re-measure before citing them in a release note, and prefer the CI assertion
over this table if the two ever disagree.

### 6.2 What may be animated

Unchanged from v1.0 as a list of properties; what has changed is who is allowed to animate them, per
§2.1 and §2.3.

| Allowed | Forbidden |
|---|---|
| `transform` (`translate`, `scale`, `rotate`) | `width`, `height`, `min-width`, `min-height` |
| `opacity` | `top`, `right`, `bottom`, `left`, `inset` |
| `clip-path` | `margin`, `padding`, `gap` |
| `stroke-dashoffset`, `stroke-width`, `stroke`, SVG `d` | `aspect-ratio` |
| `color`, `background-color`, `border-color` | `box-shadow` as a continuous tween |
| Scroll Craft's own cue, reveal, pan, count and tilt devices, each reading `--sc-p` or a pointer position it already tracks | `filter` and `backdrop-filter`, anywhere |
| | `transition: all`, anywhere |

### 6.3 `will-change` discipline

The rule is unchanged, added for the duration of a motion, removed after it, never at rest, but the
inventory is much shorter, because the chaos panels and the atmosphere canvas that used to carry it are
both gone.

| Element | When it carries `will-change` |
|---|---|
| The dragged tile | Between `onGrab` and `onSettle`, set to `transform` |
| The stage's inner frame | Between the start and end of a re-flow, set to `transform, clip-path` |
| The static falloff gradient | Never. It is a static background, not an animation. |
| Everything else | Never |

### 6.4 The atmosphere plane is a static gradient, not a canvas

v1.0 specified a `<canvas>` layer, scan-drift bands and a carrier trail, capped at 30 fps, paused
off-screen, clamped device-pixel-ratio, not created below 640px or under reduced motion. **None of that
exists in the shipped page.** `.ltp-atmos` is a leftover CSS rule with no element to apply to; the
atmosphere is entirely `.ltp-surface::before`, one `radial-gradient()`, present at every breakpoint, in
every theme and under every motion setting, with zero JavaScript and zero per-frame cost. This is
strictly cheaper than the v1.0 plan and it removes an entire class of "profile the canvas" work from the
verification checklist (§8), because there is nothing left in that layer to profile.

The grain layer (`.sc-grain`) is also gone in practice: the element is still present in the markup
(vendored from the Scroll Craft engine's own template) but `acts.css` sets it to `display: none`, so it
paints nothing and costs nothing.

### 6.5 The absences that make the budget work

- **No canvas loop, no per-frame drift.** The atmosphere plane costs nothing (§6.4).
- **No chaos collapse.** An entire choreography class, its will-change juggling and its jitter
  keyframes are gone with the prologue (`LIVETAP_SCROLL_STORY.md` §6).
- **No `parallax` or `drift` anywhere.** This revision restored `pan`, `reveal`, `count`, `flow`+`in`
  and pointer `tilt` to five chapters (`LIVETAP_SCROLL_STORY.md` §5.1), but `parallax` and `drift`
  stay cut for the reasons recorded in `LIVETAP_VISUAL_DIRECTION.md` §2.1 and §4.6, and the returning
  devices' own cost is what `audit-closure.spec.ts`'s long-task budget (§8.1) now measures directly.
- **No webfont blocking first paint.** Unchanged: one self-hosted subset file with `font-display: swap`.
- **No React on `/`.** Unchanged.
- **No `filter` or `backdrop-filter` anywhere.** Unchanged.
- **Nothing animates while off-screen.** Chat and the output canvases both pause via
  `IntersectionObserver` / `visibilitychange`.

---

## 7. The reduced-motion matrix

`prefers-reduced-motion: reduce` still means **instant state changes with no positional animation**,
read once at load rather than live-branched (§5). Rows that described devices removed from this build
(the chaos collapse, the atmosphere canvas, `parallax`, the seventeen-step hero story) are gone from
this table. `pan`, `reveal` and pointer `tilt`, cut from v2.0, are back in this revision and back in
this table with their own reduced-motion rows below; everything that remains is current.

| Element | Full motion | Reduced motion |
|---|---|---|
| Engine durations | `--lt-dur-1/2/3` = 120 / 200 / 320ms | The app's own token override sets all three to 1ms |
| Scroll Craft pin | Holds the act's stage in view for its span | Unchanged; pinning is not a motion |
| The declared rests' hold state | Detected via `onScroll` enter/leave thresholds | Unchanged |
| Each band's cue | Opacity ramps in and out over the chapter's own 0.02 to 0.95 window | Unchanged; a cue window is not itself a motion, the content inside it still respects its own row below |
| SHAPES iris reveal | `clip-path` iris wipe across `0.06` to `0.42` of the act's travel | Lands at its final state instantly; the control is present at full strength throughout |
| PRO up reveal | `clip-path` wipe upward across `0.08` to `0.4` | Lands at its final state instantly |
| MOMENTS pan | The lane travels sideways under the wheel, scroll-linked | The engine turns `data-sc-pan` into a native horizontal scroll region; the cards and their live thumbnails are reached by scrolling sideways by hand |
| OUTPUTS counters | Numerals count up across their own cue window | Land at their final value instantly |
| VERSUS entrance | The two lanes rise in, staggered 90ms per child, once on entry | Land in place instantly, no stagger |
| MAKE chip tilt | Spring-damped rotate toward the pointer, fine-pointer only | Never constructed; the engine does not build pointer devices under reduced motion regardless of pointer type |
| Static falloff gradient | Always static, always on | Identical, there was never a canvas to disable |
| Destination connect | Path draws over ~420ms | Path appears at full length by opacity |
| Path carrier (LIVE) | A slow travelling highlight | Not drawn |
| Stage re-flow | ~320ms scale and clip-path | Instant. The new composition is simply there. |
| Moment change | Layers cross over on the Moment's own transition duration | Instant swap |
| GO LIVE countdown | Digit swap plus the button's fill change | Digit swap only |
| Going live | All paths light in one frame | Identical. It was already one frame. |
| The drag | `createDraggable`, tension, spring release | **Not constructed.** The one-tap band button, `Delete`, or the tile's own drop control fire the same break. |
| Break sequence | `DEGRADED` for 700ms, then `RECONNECTING` | `DEGRADED` skipped |
| Reconnect ring | `stroke-dashoffset` counting | Static full ring; the digit still counts, in text |
| Heal | Path redraws, tile springs home | Path opacity 0 → 1. Tile does not move. |
| `LIVE` / `RECONNECTING` pulse | 1600ms halo | A permanent full-opacity dot plus a 1px ring |
| Chat arrival | Opacity plus a small rise, seed stagger | Opacity only, no stagger |
| Output canvases | Redraw at 12 fps | Redraw once per state change |
| Pro reveal | Four rows at 60ms stagger | All four instantly |
| The guided demo | Runs on its own 4.2s clock either way | Identical timings; the information is in the state changes, not the motion |
| Tour | Panel slides in; completion strikes through | Panel appears; completion is instant |
| Announcements | As specified | **Identical.** Reduced motion never reduces what a screen reader is told. |

---

## 8. The verification plan

Three passes, in order.

### 8.1 Scroll Craft's harness, and the audit's own performance gate

```bash
cd apps/web && npm run build && npm run preview

node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/shots
node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/mobile  --width 390 --height 844
node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/reduced --reduced-motion
```

| What the harness reports | What we expect |
|---|---|
| **DEAD SCROLL** | Not reported on any of the eight acts. Six are pinned and must show change; MOMENTS pans; VERSUS is a `flow` chapter whose lanes arrive once. Both declared rests are `flow` and are excluded by design. |
| **Bespoke fixed stage** | The whole page is one. `#surface` publishes `data-sc-verify-state`, a compact signature of rendered values, never raw scroll progress. |
| **FROZEN CLIP** | Not applicable to the SCROLL mechanism, the sample clips play on their own clock, not on `--sc-p`, so there is no frame for the harness to find frozen against scroll. |
| **CUES THAT NEVER PEAK** | Applicable again, and checked directly: every band's `data-sc-cue` must reach full opacity somewhere in its window, `0.02` to `0.95` with ramps either side, and the two `reveal` devices and two `count` counters must each complete rather than stall partway. This is a real check now that chapter copy lives inside each act's own cue, not a cross-faded band layer. |
| **Console errors and failed requests** | Zero. |

**New for this version, and specific to the audit's own findings:** `apps/web/e2e/audit-closure.spec.ts`
asserts fewer than three long tasks in six idle seconds and 40+ fps on the deployed page, the direct,
automatable form of `AUDIT_CLOSURE.md` §0's root-cause finding. This assertion did not exist against
v1.0's build and is now the primary performance gate for this page, ahead of the harness's own
dead-scroll check.

Two things the harness still cannot cover, measured by hand:

- **The band's reserved space at every breakpoint.** Confirm the surface never overlaps the band and the
  band never clips its own title or lede, at 1440, 1024, 768 and 390.
- **Reduced-motion reachability.** Confirm on `scrollcraft/lab/reduced/sheet.png` that every control that
  needs a pointer in full motion (the drag) still has a working non-pointer path.

### 8.2 Field measurements

Unchanged targets from v1.0, worth re-measuring against the smaller bundle:

| Metric | Target |
|---|---|
| LCP | ≤ 1.8 s throttled; ≤ 1.2 s on cable. The LCP element is the stage's held frame, `loading="eager"`. |
| CLS | ≤ 0.02 |
| INP | ≤ 200 ms at p75 |
| TBT | ≤ 150 ms |
| Long tasks after first paint | None over 50ms, and `audit-closure.spec.ts` (§8.1) enforces this directly |
| JS transferred on `/` | ~53.2 KB gz, per §6.1 |
| Memory after 5 minutes idle | No growth. Chat is row-capped; the output canvases and the picture loop both pause off-screen; every Anime.js instance reverts on teardown. |

### 8.3 Scroll smoothness, and the feel check

Record a Chrome performance trace while scrolling the whole page at a normal reading pace; require no
frame over 16.7ms in the scroll-linked work, at 1440 and at 390. `parallax` and the chaos collapse stay
removed, but `pan`, `reveal` (twice), `count` and the VERSUS entrance are back in this revision, so the
scroll-linked work to profile is no longer only act pinning and the two rests' hold detection: the
MOMENTS lane's own translate, the two reveal wipes' `clip-path` and the two counters' text updates all
run during a scroll now, and `watchActs()`'s own listener (§2.2) is the smallest item on that list, not
the whole of it. This is exactly the work `audit-closure.spec.ts`'s long-task budget exists to catch if
it grows past what a wheel can carry.

The feel check runs last, per `feel.md` §6: scroll top to bottom once at a normal pace, write one word
per act for what was felt, and diff it against the intended curve in `LIVETAP_SCROLL_STORY.md` §3.
Two questions for this revision specifically: **does the peak still read as the peak, largest span,
second act, right after the hero?** And **does the descent after it now read as seven different
chapters rather than one chapter's mechanism worn six more times?** The first question is unchanged
from v2.0's own feel check; the second is the one this revision exists to answer.

### 8.4 The checks that are specific to this page

| Check | Method |
|---|---|
| **Siblings never flicker** | A test that samples every non-broken tile's computed style before, during and after a break, and asserts no change. |
| **watchActs() never writes an animated property** | A dev-mode assertion: the function's own write set is `classList` toggles and dataset booleans only. |
| **The copied constants match `packages/core`** | A unit test that imports the real `SAFE_AREAS` and `defaultMoments()` and deep-equals them against `data.ts`. |
| **No raw hex in the public page's CSS** | A lint rule. |
| **Keyboard** | Tab the whole page at 1440 and at 390. Focus order matches visual order; nothing reachable is parked at opacity 0. |
| **Forced colors** | Load with Windows High Contrast. Focus survives on `outline`; the `LIVE` chip and the GO LIVE fill survive on `forced-color-adjust: none` plus a border. |
| **Long-task budget** | `audit-closure.spec.ts`, the audit's own gate (§8.1). |
