# LIVETAP Motion System — the public experience

**Version** 1.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Choreography library** Anime.js **4.5.0** (`animejs`), API verified against animejs.com and the
published 4.5.0 package on 2026-09-12
**Companions** `LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` ·
`LIVETAP_INTERACTION_SYSTEM.md` · `scrollcraft/builds/livetap-public/PLAN.md`

The rule this whole document serves: **motion communicates a state change, and nothing else animates.**
The app already holds that line in three durations and four easings. This page adds no new duration
and no new easing token; it adds seven motion *classes*, each of which is a named use of the existing
tokens.

---

## 1. Install and import

`animejs` is **not currently a dependency** of this repo. Nothing in `package.json`,
`apps/web/package.json` or `node_modules` references it; the only mention is the JS budget line in
`ARCHITECTURE_DECISIONS.md`. So the build team installs it:

```bash
npm i animejs -w @livetap/web        # 4.5.0, zero runtime dependencies
```

Import from the **root export or the subpaths**, never from a CDN. `apps/web/vercel.json` sets
`script-src 'self'`, so a CDN script would be blocked with no visible error.

```js
// the page imports exactly these, and nothing else
import { animate }         from 'animejs';
import { createTimeline }  from 'animejs';
import { createScope }     from 'animejs';
import { createDraggable } from 'animejs';
import { onScroll }        from 'animejs';
import { stagger }         from 'animejs';
import { spring }          from 'animejs';
import { utils, engine }   from 'animejs';
```

Two API corrections worth writing down, because both appear in older material:

- **`createScrollObserver` does not exist.** The scroll factory is `onScroll()`, and the class is
  `ScrollObserver`.
- **`createSpring()` is deprecated in 4.x and logs a console warning.** The factory is `spring()`.
- Also: `utils.remap` does not exist; the range mapper is **`utils.mapRange`**.

### 1.1 Global engine settings, set once at mount

```js
engine.fps = 30;                    // default 240. One global cap; see §6.
engine.pauseOnDocumentHidden = true;  // already the default; asserted rather than assumed
engine.precision = 2;               // default 4. Two decimals is below a device pixel.
engine.defaults.ease = 'outQuad';   // default is 'out(2)'; ours matches --lt-ease-standard's intent
engine.defaults.duration = 200;     // default is 1000, which is four times our longest UI duration
```

`engine.fps = 30` is the single most valuable line in the file: it halves the page's animation work on
every device at a frame rate that is indistinguishable for opacity and colour transitions, and it is
the reason the canvas cap in §6 and the motion budget agree.

---

## 2. Who owns what: the two-system contract

There are two motion systems on this page and they must never write the same property on the same
element. The boundary is not a convention, it is a table, and it is testable.

### 2.1 The division

| | **Scroll Craft** | **Anime.js** |
|---|---|---|
| Reads scroll | **Yes. It is the only thing that reads scroll position.** | **No.** Never. |
| Drives | Act pinning, act progress `--sc-p`, cue opacity and rise, `reveal` wipes, `pan` travel, `parallax` translate, `drift` ground colour, `flow` + `in` entry staggers, the reduced-motion floor, focus centring on `focusin` | Everything on a clock: the hero auto-story, state-change transitions triggered by a tap, the countdown, the path draw, chat arrival, the Pro reveal, the drag and its spring release |
| Trigger | The wheel | A timer, a tap, a key, a pointer, or a scroll **threshold** |
| Written in | `data-sc-*` attributes on real markup, plus page CSS reading `--sc-p` | `animate()` / `createTimeline()` inside one `createScope()` |

The one-sentence version: **Scroll Craft owns scroll-linked continuous motion; Anime.js owns
scroll-triggered discrete events and everything not driven by scroll at all.**

### 2.2 The bridge, and why it is `onScroll` and not a second rAF loop

The page needs to start a timeline when an act arrives. The naive way is a per-frame read of
`getComputedStyle(act).getPropertyValue('--sc-p')`, which costs a style recalculation every frame and
introduces a second rAF loop alongside the engine's.

Instead, every scroll-triggered timeline is armed by an Anime.js `ScrollObserver` in its **method**
mode, which fires playback methods at thresholds and costs nothing between them:

```js
// ACT 3's source-switch-on sequence starts when the act is 40% into the viewport,
// pauses when it leaves, and does not restart on the way back up.
const produce = createTimeline({ autoplay: false });
produce.add('#src-camera', { opacity: [0, 1], duration: 200 })
       .add('#src-mic',    { opacity: [0, 1], duration: 200 }, '<<+=70')
       .add('#src-screen', { opacity: [0, 1], duration: 200 }, '<<+=70');

onScroll({
  target: '#act-produce',
  enter: 'center bottom',
  leave: 'top top',
  sync: 'play pause',     // the 4.x default: 1 name = enter, 2 = enter leave
  repeat: false,
}).link(produce);
```

`sync` has four modes and only two of them are used on this page:

| `sync` value | Meaning | Used here |
|---|---|---|
| `'play'`, `'play pause'`, `'play pause reverse reset'` (method names; 4 names map to enterForward / leaveForward / enterBackward / leaveBackward) | Fire playback methods at the thresholds | **Yes**, for every scroll-armed timeline |
| `true` / `1` | Link playback progress 1:1 to scroll position | **No.** This is scroll-linked continuous motion, which is Scroll Craft's job. Using it here would be two systems driving one thing. |
| a number in `(0, 1)`, e.g. `0.25` | Smoothed catch-up to the scroll position | **No**, same reason |
| an ease name, e.g. `'inOutCirc'` | Eased scroll-linked progress | **No**, same reason |

That is the whole boundary: **`sync` may only ever carry method names on this page.** If a build wants
`sync: true`, the motion it wants belongs in CSS driven from `--sc-p`.

### 2.3 The ownership table, per layer

| Layer | Who writes `transform` | Who writes `opacity` | Who writes anything else |
|---|---|---|---|
| BACKGROUND | Nobody | Nobody | Scroll Craft `drift`, two stops |
| ATMOSPHERE | Scroll Craft `parallax` (−0.4) | CSS | The page's own canvas loop (§6), which is not an animation system |
| SIGNAL | Nobody. Paths are never translated. | Anime | Anime: `stroke-dashoffset`, `stroke-width`, `stroke`, `d` |
| PRODUCT STAGE | CSS from `--sc-p` during ACT 1 only | CSS | Anime: `aspect-ratio` is **not** animated; the stage's shape change animates `transform: scale()` on an inner frame plus a `clip-path`, never `width` or `height` |
| DESTINATIONS | Scroll Craft `parallax` on the **wrapper**; Anime on the **inner tile**. Two nodes. | Anime | Anime: `box-shadow` and `background-color` via `composition: 'none'` |
| DATA / STATUS | **Nobody.** No positional animation at all. | Anime | Anime: text content via a `modifier`, colour, and `stroke-dashoffset` on the countdown ring |
| INTERACTION | Anime `createDraggable` only | Anime | Anime |
| FOREGROUND | Nobody | CSS transitions at `--lt-dur-1` / `--lt-dur-2` | CSS |

Two consequences that have bitten Scroll Craft builds before and are pre-empted here:

- A magnet, a parallax and a cue all write `transform`, so they cannot share an element. The same
  applies across systems. Where a cued element needs its own continuous transform, the page drives an
  **inner wrapper** from `--sc-p` in CSS rather than stacking a second writer on the same node.
- Any element Anime.js touches and then releases gets `utils.cleanInlineStyles` as its `onComplete`,
  so it does not keep an inline style that a later cue would have to fight.

---

## 3. The seven motion classes

Every animation on the page is one of these seven. A new class requires deleting one.

All durations are the app's three tokens or a stated multiple of them, and all easings are the app's
four. The two exceptions are named and justified: the countdown, whose duration is the retry interval,
and the spring on the drag release, which is a physical model rather than a duration.

### 3.1 STATE CHANGE

A chip, a badge, a border or a fill changing because a state machine moved.

| Property | Value |
|---|---|
| Duration | `--lt-dur-1` (120ms) for colour and fill; `--lt-dur-2` (200ms) when a dot treatment changes shape |
| Easing | `--lt-ease-standard`, `cubic-bezier(0.2, 0, 0, 1)` |
| Animates | `opacity`, `color`, `background-color`, `border-color`. **Never** position, never size. |
| Composition | `'none'` — these fire rapidly and in bursts, and `'replace'` would cancel-and-restart neighbours for no benefit |

```js
animate(chip, {
  backgroundColor: 'var(--lt-state-live-tint)',
  color:           'var(--lt-state-live-on)',
  duration: 120,
  ease: 'cubicBezier(0.2, 0, 0, 1)',
  composition: 'none',
  onComplete: utils.cleanInlineStyles,
});
```

The chip's **label text** changes in the same frame as the colour, with no cross-fade. A state's word
and its colour must never disagree, even for 120ms.

### 3.2 CONNECTION PATH DRAW

A signal path arriving or leaving.

| Property | Value |
|---|---|
| Duration | 420ms on draw, 90ms on the tile-side vanish, 220ms on the stage-side recoil |
| Easing | Draw: `'outQuart'`. Recoil: a two-keyframe overshoot, 8px past the port then settle. |
| Animates | `stroke-dashoffset` from the path's own length to 0. Nothing else. |
| Technique | `stroke-dasharray` is set once to `path.getTotalLength()` at mount, not per frame |

```js
const len = path.getTotalLength();
utils.set(path, { strokeDasharray: len, strokeDashoffset: len });
animate(path, { strokeDashoffset: 0, duration: 420, ease: 'outQuart' });
```

On the multistream beat all paths light in **one frame**, not staggered: a coordinated broadcast is
the claim, so staggering the paths would say the opposite. That is a deliberate absence of stagger and
it is the only place on the page where simultaneity is the point.

### 3.3 STAGE RE-FLOW

The canvas changing shape between 16:9, 9:16 and 1:1.

| Property | Value |
|---|---|
| Duration | `--lt-dur-3` (320ms), which is the app's own duration for a preview aspect-ratio change |
| Easing | `--lt-ease-standard` |
| Animates | `transform: scale()` and `clip-path: inset(...)` on the stage's inner frame, plus `translate` and `scale` on each layer to its new normalized placement. **Never `width`, `height`, `aspect-ratio`, `top` or `left`.** |
| Layer placement | Each layer's target rect comes from the Moment's `placement` map through `insetToSafeArea()`, converted to a transform against the layer's untransformed box |
| Stagger | `stagger(40, { from: 'center' })` across the layers, so the picture re-composes from the middle outward rather than sweeping |

The stage's centre stays fixed and its scale stays 1.0. What changes is the visible rectangle and where
the layers sit inside it.

### 3.4 COUNTDOWN

Two countdowns exist: GO LIVE's 3-2-1, and the reconnect ring.

| | GO LIVE | Reconnect ring |
|---|---|---|
| Duration | 3 × 1000ms | 4000ms, which is the retry interval and therefore not a design choice |
| Easing | Per-digit: none. The digit swaps. | `--lt-ease-linear`. A countdown that eases is lying about time. |
| Animates | Digit text content. The app cross-fades in 320ms; this page swaps in one frame, because tabular figures at `display` size do not need a fade to be legible and a fade makes two digits visible at once. | `stroke-dashoffset` on a 20px circle, full circumference to 0 |
| Numerals | Tabular, always. Width must not change. |

```js
// the ring. One tween, linear, no loop.
animate(ring, {
  strokeDashoffset: [circumference, 0],
  duration: 4000,
  ease: 'linear',
});
// the digit, driven by the same clock so the two can never disagree
animate({ t: 4 }, {
  t: 0, duration: 4000, ease: 'linear',
  modifier: utils.round(0),
  onUpdate: self => { digit.textContent = String(Math.ceil(self.targets[0].t)); },
});
```

### 3.5 CHAT ARRIVAL

| Property | Value |
|---|---|
| Duration | 200ms (`--lt-dur-2`) |
| Easing | `--lt-ease-standard` |
| Animates | `opacity` 0 → 1 and `translateY` 6px → 0. Six pixels, because a chat row is 20px tall and anything more reads as a slide. |
| Stagger | Only on the initial seed of four rows: `stagger(60)`. Individual arrivals after that are single tweens. |
| Never | Layout animation of the log. New rows are appended and the log's scroll position is set, not animated. |

### 3.6 PRO REVEAL

| Property | Value |
|---|---|
| Duration | 200ms per row |
| Easing | `--lt-ease-standard` |
| Animates | `opacity` 0 → 1 only. **No position at all**, because the panels must arrive in space that was already empty, and anything that slides implies something moved to make room. |
| Stagger | `stagger(60)` over four rows, so the layer resolves in 380ms total |
| Depth | The panels' apparent recession is Scroll Craft's `parallax="-0.6"`, not an anime transform. Two systems, two properties, one element each. |

### 3.7 CHAOS COLLAPSE

The page's only large choreography, and the only one driven from `--sc-p` rather than from a clock.

| Property | Value |
|---|---|
| Driver | CSS `calc()` and `translate` against ACT 1's `--sc-p`. **Not Anime.js.** It is scroll-linked continuous motion, which is Scroll Craft's side of the contract. |
| Animates | `translate` and `opacity` on each of the six duplicate panels, and `scale` 0.96 → 1.00 on the stage |
| Shape | Each panel's translate interpolates from its scattered position to the position of the surface's single instance of that control. Opacity crosses over at `p = 0.82`, so the copies are gone before the stage finishes scaling. |
| Jitter | A 2px, 7 Hz jitter on each panel while `p < 0.35`, from a per-panel CSS `@keyframes` with a per-panel `animation-delay`, killed at `p >= 0.35` by a class the page toggles once. Not a per-frame JS write. |
| Reduced motion | No convergence, no jitter, no scale. Panels present at `p = 0`, absent by `p = 0.2`, opacity only. |

---

## 4. The signature move's physics, in real API

`createDraggable` is the primitive. The parameters below are chosen values, not defaults, and the two
that matter are stated explicitly because the library's own documentation and its 4.5.0 source disagree
on one of them (`releaseDamping`: docs say 10, source says 20).

```js
const drag = createDraggable(tile, {
  trigger: grip,                 // only the 44x44 grip starts a drag
  container: surface,            // the live surface is the bounds
  containerFriction: 0.35,       // resists at the edge without hard-stopping (0 = none, 1 = hard stop)
  containerPadding: 0,
  dragSpeed: 0.92,               // trails the pointer slightly, so the tile has mass
  releaseEase: spring({ stiffness: 150, damping: 18 }),
  // a spring passed to releaseEase overrides releaseMass / releaseStiffness / releaseDamping,
  // and takes its velocity from the real thrown velocity, which is exactly what a snap-back wants
  velocityMultiplier: 1,
  // dragThreshold left at the library default { mouse: 3, touch: 7 }: 7px of touch slop is what
  // keeps a vertical flick on a phone scrolling the page instead of grabbing the tile
  onGrab:    () => lift(tile),
  onDrag:    () => publishTension(Math.hypot(drag.x, drag.y)),
  onRelease: () => (tension() >= 1 ? breakDestination(id) : null),
  onSettle:  () => clearTension(),
});
```

| Concern | Resolution |
|---|---|
| Break threshold | `168 * Math.min(1, innerWidth / 1440)` px of Euclidean displacement. Published as `--lt-tension` = `clamp(d / threshold, 0, 1)`. |
| Break while still held | `onDrag` fires `breakDestination()` the first time tension reaches 1, then `drag.disable()`. The visitor does not have to release to cause the break, because a stream does not wait for you to let go. |
| Snap-back | Anime's own release spring. The page does not animate the tile home itself. |
| Re-arm | `drag.enable()` when the tile returns to `LIVE`. |
| Reduced motion | `createDraggable` is **never called**. The branch is selected by the scope's `mediaQueries`, so the apparatus is not constructed at all. |
| Cleanup | The scope's `revert()` reverts the draggable with everything else. |

---

## 5. The scope, React, and reduced motion in one place

The public page ships without React (§6), so the scope is created imperatively at mount. The React
pattern is documented here anyway, because `/app` is React and a future shared component will need it.

```js
// the public page: one scope for the whole page, two media queries
const scope = createScope({
  root: '#lt-page',
  defaults: { ease: 'outQuad', duration: 200 },
  mediaQueries: {
    reduceMotion: '(prefers-reduced-motion: reduce)',
    isPhone:      '(max-width: 639.98px)',
  },
}).add(self => {
  const { reduceMotion, isPhone } = self.matches;

  mountHeroStory({ reduced: reduceMotion, steps: isPhone ? 9 : 17 });
  mountStateMachines({ reduced: reduceMotion });
  if (!reduceMotion) mountDrag();       // not constructed at all when motion is reduced
  if (!reduceMotion && !isPhone) mountAtmosphere();

  self.add('resetStory', () => heroStory.restart());

  return () => { /* the page's own listeners; anime instances revert themselves */ };
});

// on teardown, and on hot reload
scope.revert();
```

A scope re-runs its constructors whenever a registered media query's match state flips, so a visitor
who turns on Reduce Motion mid-visit gets the reduced page without a reload, and a visitor who rotates
a tablet across 640px gets the right composition. `(prefers-reduced-motion: reduce)` has **no special
handling** in Anime.js: it is an ordinary query and the branching is the page's own, which is why every
class in §3 states its reduced-motion behaviour explicitly.

Inside React, the same scope is created in a `useEffect` with `root` passed the **ref object itself**
(not `ref.current`), and `scope.current.revert()` is the cleanup. Methods registered with
`self.add(name, fn)` are called from event handlers as `scope.current.methods[name](...)`.

---

## 6. The performance budget

### 6.1 JavaScript: 60 KB gzipped for the whole public page

**The public experience ships as its own Vite entry with no React, and that entry already exists.**
`apps/web/vite.config.ts` builds two documents: `index.html` is `/`, a plain static document with the
design system's stylesheet and one ~400-byte classic theme script and **no framework at all**, and
`app.html` is the React SPA. The reason is already recorded in the repo as arithmetic rather than
taste: `docs/qa/FRICTION_BENCHMARK.md` §6 measured React 19's DOM renderer at 69.2 KB gzipped, so no
React page can meet a 60 KB budget however well the rest is split.

So no entry-point surgery is needed. What changes is the **content** of `index.html` and
`src/landing.css`, and the page goes from shipping zero JavaScript to shipping about 55 KB gzipped.
That is a real cost and it is the owner's directive that authorises it: a page whose thesis is
"experience the product" cannot be a static document. The budget below is what keeps it honest.

| Item | Budget (gz) | Basis |
|---|---|---|
| `scrollcraft.js`, copied verbatim | **14 KB** | 52.9 KB raw, vanilla, no dependencies. Measure on first build; the engine is never edited, so this number is fixed for the life of the page. |
| Anime.js 4.5.0, tree-shaken | **19 KB** | The published per-module figures are Timer 5.60, Animation +5.20, Timeline +0.55, Draggable +6.41, Scroll +4.30, Stagger +0.48, Spring +0.52, Scope +0.22, SVG +0.35 — about 24 KB for everything this page uses, and the modules overlap, so 19 KB is the target and 24 KB is the ceiling. **The prebuilt `dist/bundles/anime.esm.min.js` is 40.8 KB gzipped and must not be used**: importing the bundle instead of the subpaths would spend two thirds of the page's whole budget on one library. |
| The page's own logic: state machines, data arrays, the atmosphere canvas, the drag composition, the hero timeline, the tour | **22 KB** | Authored. This is the number to defend in review. |
| `theme.js`, the existing classic script | **0.4 KB** | Already shipped. Stays exactly as it is: a classic script in `<head>` so a visitor who chose dark never sees a flash of light. |
| Shared `packages/ui` CSS and the icon paths | **0 KB of JS** | CSS is not in this budget. `@livetap/ui/styles.css` is 52 KB raw and 9.2 KB gzipped, already measured, already shipped on `/`. The icons are inlined SVG path data in the markup, not a JS module. |
| React, react-router, zustand, `packages/core`, `packages/adapters`, `packages/media` | **0 KB** | None of them load on `/`, and none of them do today either. The intents, moments and safe-area values the page needs are ~1.5 KB of constants, copied into the page's data module with a comment naming their source, rather than an import that drags the orchestrator in. |
| **Total** | **55.4 KB, against a 60 KB budget** | Under 5 KB of headroom, which is the margin for the tour and the ErrorCard copy. Assert it in CI. |

The 1.5 KB copy of `SAFE_AREAS`, the six `INTENT_PROFILES` summaries and the six Moment placements is a
deliberate duplication and it is the one place this page does not import from `packages/core`. It is
guarded by a unit test that imports the real values and asserts the copies match, so the duplication
cannot drift. `PLAN.md` §6 carries that test.

### 6.2 What may be animated

| Allowed | Forbidden |
|---|---|
| `transform` (`translate`, `scale`, `rotate`) | `width`, `height`, `min-width`, `min-height` |
| `opacity` | `top`, `right`, `bottom`, `left`, `inset` |
| `clip-path` — for wipes and the stage's visible rectangle | `margin`, `padding`, `gap` |
| `stroke-dashoffset`, `stroke-width`, `stroke`, SVG `d` | `aspect-ratio` |
| `color`, `background-color`, `border-color` | `box-shadow` as a continuous tween (it is stepped between the three elevation tokens instead) |
| `--*` custom properties the page reads in `calc()` | `filter` and `backdrop-filter`, anywhere, at any time |
| | `transition: all`, anywhere |

### 6.3 `will-change` discipline

`will-change` promotes an element to its own compositor layer and costs memory for as long as it is
set. The rule is therefore: **`will-change` is added in the frame before a motion starts and removed in
the frame after it ends.** Nothing on this page carries it at rest.

| Element | When it carries `will-change` |
|---|---|
| The dragged tile | Between `onGrab` and `onSettle`, set to `transform` |
| The stage's inner frame | Between the start and end of a re-flow, set to `transform, clip-path` |
| The six chaos panels | While ACT 1's `--sc-p` is between 0 and 1, set to `transform, opacity`, by a class the page toggles twice |
| The atmosphere canvas | Never. A canvas is already its own layer. |
| Everything else | Never |

A page that sets `will-change: transform` on every animated element has a compositor-memory problem
instead of a paint problem, and on a mid-range phone that is a worse trade.

### 6.4 The atmosphere canvas

| Rule | Value |
|---|---|
| Frame rate | **30 fps cap**, by an accumulator in the page's own rAF loop. `engine.fps = 30` caps Anime.js; the canvas is not an Anime.js instance, so it caps itself. |
| Off-screen | Paused by `IntersectionObserver` on the surface, and by `visibilitychange`. Paused means the rAF loop is cancelled, not that it runs and skips drawing. |
| Resolution | `devicePixelRatio` clamped to **2**. A 3× phone screen gets a 2× canvas, and nobody can tell, because the content is bands at 2.5% opacity. |
| Resize | Debounced 150ms, and it re-reads the size rather than scaling the bitmap. |
| Mobile | Not created below 640px. A static CSS radial falloff replaces it. |
| Reduced motion | Not created. Same replacement. |
| Cost ceiling | If the canvas costs more than **2ms per frame** on the verification pass, the band count drops from 9 to 5 and the carrier count from 24 to 12. That is a real lever with a real threshold, not an aspiration. |

### 6.5 The absences that make the budget work

Worth listing, because they are the biggest wins on the page and none of them is visible in a profile:

- **No video.** No `scrub`, no footage, no poster fetch, no h264 decode, no Blob. The Live surface
  grammar bans `scrub`, and the saving is the entire media budget.
- **No photography and no generated imagery.** One 16:9 WebP hero plate that already exists.
- **No webfont blocking first paint.** One self-hosted subset variable file with `font-display: swap`.
- **No React on `/`.**
- **No `filter` or `backdrop-filter` anywhere.** Blur is the most expensive thing a compositor does on
  a phone, and the design does not use it (VISUAL_DIRECTION §2).
- **Nothing animates while off-screen.** The story, the chat and the canvas all pause.

---

## 7. The reduced-motion matrix

`prefers-reduced-motion: reduce` means **instant state changes with no positional animation**. Every
state, every number, every word and every announcement is identical to the full-motion page. Only
movement is removed, and nothing becomes unreachable.

| Element | Full motion | Reduced motion |
|---|---|---|
| Engine durations | `--lt-dur-1/2/3` = 120 / 200 / 320ms | The app's own token override sets all three to **1ms** |
| Scroll Craft cues | Opacity plus a rise | Opacity only. The engine collapses translation itself. |
| Scroll Craft `parallax` | ATMOSPHERE −0.4, DESTINATIONS +0.35, PRO −0.6 | Zeroed by the engine |
| Scroll Craft `pan` (ACT 2's shelf) | Transform-driven lateral travel | The engine hands the stage back as a native `overflow-x: auto` scroll region with proximity snapping, so every tile stays reachable. **Confirm on the contact sheet that the shelf shows real content and that items past the fold can be got to** — nothing in the harness reports this. |
| Scroll Craft `reveal` (ACT 4's iris) | `clip-path` wipe | Not run. The guides appear by opacity. |
| Chaos collapse | Convergence, jitter, stage scale 0.96 → 1.00 | No convergence, no jitter, no scale. Panels present at `p = 0`, absent by `p = 0.2`. |
| Destination connect | Path draws over 420ms; tile scales 0.98 → 1.00 | Path appears at full length by opacity. No tile scale. |
| Path carrier (LIVE) | A 1.6s travelling highlight at 6% | Not drawn |
| Stage re-flow | 320ms scale and clip-path, layers staggered from centre | Instant. The new composition is simply there. |
| Moment change | Layers cross over on the Moment's own `transition.durationMs` | Instant swap |
| GO LIVE countdown | Digit swap plus the button's fill change | Digit swap only, no fill transition |
| Going live | All paths light in one frame | Identical. It was already one frame. |
| The drag | `createDraggable`, tension, spring release | **Not constructed.** `Delete`, the `⋯` menu item, or a press-and-move past the threshold fires the same break. |
| Break sequence | `DEGRADED` for 700ms, then `RECONNECTING` | `DEGRADED` skipped. Straight to `RECONNECTING`, because a 700ms intermediate with no motion is a flicker. |
| Reconnect ring | `stroke-dashoffset` counting | Static full ring. The digit still counts, in text. |
| Heal | Path redraws, tile springs home | Path opacity 0 → 1. Tile does not move, because it never moved. |
| `LIVE` / `RECONNECTING` pulse | 1600ms halo, opacity 1 → 0.35, scale 1 → 1.35 | A permanent full-opacity dot plus a 1px ring. The app's own resolution, and the two pulsing states stay distinguishable. |
| Chat arrival | Opacity plus 6px rise, 60ms seed stagger | Opacity only, no stagger, flat 2600ms interval |
| Pro reveal | Four rows at 60ms stagger, parallax −0.6 | All four instantly, no parallax |
| Intent cards (`tilt`) | 5° toward the pointer | Inert. The engine disables pointer devices under reduced motion, and they are gated to `(hover: hover) and (pointer: fine)` anyway. |
| Atmosphere canvas | 30 fps, paused off-screen | Not created |
| Hero auto-story | 17 steps with choreography | 17 steps as state changes only, same timings, because the information is in the sequence |
| Tour | Panel slides in; completion strikes through | Panel appears; completion is instant |
| Announcements | As specified | **Identical.** Reduced motion never reduces what a screen reader is told. |

---

## 8. The verification plan

Three passes, in order, and the third is the one that cannot be automated.

### 8.1 Scroll Craft's harness

```bash
cd apps/web && npm run build && npm run preview      # serves the real build on :4173

# confirm the harness is looking at OUR page before trusting any run
curl -s http://localhost:4173/ | grep -o "<title>.*</title>"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/fonts/archivo-subset.woff2

node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/shots
node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/mobile  --width 390 --height 844
node <skill>/scripts/shoot.mjs --url http://localhost:4173/ --out scrollcraft/lab/reduced --reduced-motion
```

The harness is served the **real Vite preview build**, not a standalone copy of the page, because the
page's whole claim is that it is the same product as the app. `serve.mjs` is not used; a
`file://` load would block nothing here (there is no video) but it would also not exercise the real
bundle, the real CSP or the real font path.

| What the harness reports | What we expect, and what we do about it |
|---|---|
| **DEAD SCROLL** | Reported on ACT 1, ACT 2, ACT 3, ACT 5, ACT 6 and ACT 8, all of which are pinned or panned and must show change. The two rests are `flow` and are excluded from the check by design; they additionally carry `data-sc-verify-hold="true"` while the hold is active, and the peak's resolution hold carries it for its last 0.5 of span. **Any dead scroll outside a declared hold is a ship blocker.** |
| **Bespoke fixed stage** | The whole page is one. `#lt-surface` publishes `data-sc-verify-state` as a compact signature of the values that actually paint: `format`, the six destination states, the path phases, chat length and the pro flag. It publishes **rendered** values, never raw scroll progress; publishing progress to turn the check green is exactly the failure the check exists to catch. |
| **FROZEN CLIP** | Not applicable. There is no video on the page. |
| **CUES THAT NEVER PEAK** | Every cue must reach 1.0 somewhere. ACT 1's hero cue uses the greet-and-hold form `"0 1 0 0"`; ACT 8's cues are one-value holds; every other act's last cue is a two-value window ending at 1. |
| **CONTRAST** | Measured on the composited page. Every scrim on the page is a **sibling** of the copy it protects, never a `::before` on it, or the pass hides it and grades the line against the raw ground. The tell that this has gone wrong: a scrim change that does not move the reported number by even a hundredth. |
| **Console errors and failed requests** | Zero. A 404 on the font degrades silently to the system stack, which looks fine and is not. |

Two things the harness cannot cover and that are therefore manual measurements:

- **ACT 2's `pan` overflow.** A rail narrower than the viewport travels zero and the harness still
  reports no dead scroll. Measure it: `rail.scrollWidth - innerWidth` must be at least half a viewport
  at 1440, 1024 and 390. Six tiles at `clamp(15rem, 20vw, 18rem)` plus a lead label and a trailing note
  should give roughly 900px of overflow at 1440; **verify, do not assume.**
- **Reduced-motion reachability.** Confirm on `scrollcraft/lab/reduced/sheet.png` that the shelf shows
  real content and that tiles past the fold can be reached through the native scroll-region fallback.

Then **read `sheet.png`**, all three of them. The harness proves the page changes; it cannot tell
anyone whether the composition is good, whether the peak reads as the peak, or whether the page means
anything.

### 8.2 Field measurements

| Metric | Target | How |
|---|---|---|
| **LCP** | **≤ 1.8 s** on a throttled Fast 3G / 4× CPU profile; ≤ 1.2 s on cable | The LCP element is the stage's held frame, `loading="eager"`, with `width` and `height` attributes so its box is reserved. Nothing above it waits on JS. |
| **CLS** | **≤ 0.02**, and the honest target is **0** | Every box on the first screen has a reserved size: the stage has an explicit aspect box, every tile's four regions are present at every state with their 44px slots reserved even when empty, and the font swap changes weight on at most four elements, none of them in a flow that reflows. |
| **INP** | **≤ 200 ms** at p75 | Every visitor action is a state change on a fixed set of nodes, and no handler does layout work. The heaviest is the stage re-flow, which reads each layer's untransformed box once per re-flow and not per frame. |
| **TBT** | **≤ 150 ms** | 55 KB of JS with no framework hydration. |
| **Long tasks after first paint** | None over 50ms | The hero timeline is built once at mount; the six state machines are plain objects; the canvas draws at 30 fps in a capped loop. |
| **JS transferred on `/`** | **≤ 60 KB gz**, split per §6.1 | `vite build --reportCompressedSize` already reports per-chunk gzipped size, and `chunkSizeWarningLimit` is set. Add an assertion to CI rather than reading the log. |
| **Memory after 5 minutes idle** | No growth | The chat log is capped at 40 rows; the atmosphere loop allocates nothing per frame; the hero story stops looping after 45 s idle; every Anime.js instance is inside the one scope and is reverted on teardown. |

### 8.3 Scroll smoothness, and the feel check

**Smoothness** is measured, not judged: record a Chrome performance trace while scrolling the whole
page at a normal reading pace and require **no frame over 16.7ms in the scroll-linked work**, at 1440
and at 390. The scroll-linked work is Scroll Craft's single rAF loop and the CSS that reads `--sc-p`;
if a frame goes long, the cause is either a `--sc-p`-driven property that triggers layout (find it and
move it to `transform`) or the atmosphere canvas (apply the §6.4 cost ceiling).

**The feel check** (`feel.md` §6) runs last and it runs cold. Scroll the page top to bottom once at a
normal reading pace without stopping to fix anything, write one word per act for what was actually
felt, and only then open `BRIEF.md` and diff the two curves. Where they disagree the page is wrong, not
the brief. Then three specific checks:

- **Does the peak read as the peak?** On the contact sheet ACT 6 must be the largest visual change and
  must occupy the most scroll room. If a different act is the biggest thing on the sheet, that act is
  the real peak and the plan lost.
- **Is there silence in front of the peak?** REST B must read as quieter than ACT 6 on the sheet.
- **Does the end resolve?** The last screen must stand still with content on it: the question, six
  cards, three toolbar items, and the footer inside the stage.

Report the diff — intended curve, felt curve, and what changed — in the build report. A first pass that
reports them as identical either got lucky or did not do the check cold.

### 8.4 The checks that are specific to this page

| Check | Method |
|---|---|
| **Siblings never flicker** | A test that samples every non-broken tile's computed `transform`, `opacity`, chip state, path `d` and `stroke-width` before, during and after a break, and asserts no change. This is the peak's whole claim, so it is a test and not an intention. |
| **Two systems never write one property** | A dev-mode assertion: before any `animate()` call, check the target is not inside a `[data-sc-parallax]`, `[data-sc-cue]` or `[data-sc-pan]` subtree for the property being written. Fails loudly in development, compiled out of production. |
| **The copied constants match `packages/core`** | A unit test that imports the real `SAFE_AREAS`, `INTENT_PROFILES` and `defaultMoments()` and deep-equals them against the page's copies. |
| **No raw hex in the public page's CSS** | A lint rule. Every colour is a `--lt-*` token or a `color-mix()` of one. |
| **Remove-most-colour** | A screenshot with a one-line override that flattens every state colour to `--lt-text-secondary`, checked against the three criteria in VISUAL_DIRECTION §4.3. |
| **Keyboard** | Tab the whole page at 1440 and at 390. Focus order matches visual order, the ring is visible against every ground it crosses, nothing reachable is parked at opacity 0, and the pinned acts park their own progress so a focused control's cue is open. |
| **Forced colors** | Load with Windows High Contrast. Focus survives because it uses `outline`; the `LIVE` chip and the GO LIVE fill survive because they pair `forced-color-adjust: none` with a border. |
