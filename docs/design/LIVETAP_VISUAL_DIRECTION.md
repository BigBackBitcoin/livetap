# LIVETAP Visual Direction, the public experience

**Version** 3.0 · **Status** Normative for the public experience (`/`) · **Owner** Design Direction
**Companions** `LIVETAP_SCROLL_STORY.md` (the score) · `LIVETAP_INTERACTION_SYSTEM.md` (the demos) ·
`LIVETAP_MOTION_SYSTEM.md` (durations and the Anime.js contract) ·
`scrollcraft/builds/livetap-public/PLAN.md` (the build)

**What changed since v1.0.** A first-time-creator audit of the deployed page (score 59/150,
`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md`) found the single largest visual failure to be the
stage itself: *"the centrepiece, the stage, is an empty grey rectangle. A production tool whose hero
image is a blank box cannot score well on visual quality, because the thing I'm buying is pictures."*
The rebuild that closed that finding (`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`) changed
this document's central rule more than any other page property: **the product is still the picture, but
now there is a picture.** The chaos-lattice hero, the atmosphere canvas and the grain layer this
document specified are gone.

**What changed since v2.0.** That rebuild also put every chapter's copy on a single fixed band layer,
cross-faded by a scroll listener, and the owner read the shipped result as flat, "the spacing and flow
seems off." This version does not touch the picture, the palette, the type or the atmosphere gradient,
none of that was the complaint, it moves each chapter's band back inside its own act and lets the
chapter's own reveal or pan or count carry a little of the depth and variety the flat cross-fade had
been carrying alone. This version records the direction as it now ships.

This document decides what the public experience looks like. It does not decide what it does; that is
the Interaction System. Everything here is derived from three sources and nothing else:

1. `docs/design/DESIGN_SYSTEM.md` and `packages/ui/src/tokens.css`, the app's existing language. The
   public experience adds **no new colour, no new size, no new radius, no new duration**. It adds one
   typeface and one page-local layer scale, both defined in §4 and §3.
2. The owner's directive of 2026-09-12 (`docs/prompt-pack/10_LIVETAP_UX_EXPERIENCE_REDESIGN.md`), the
   self-authored brief at `scrollcraft/builds/livetap-public/BRIEF.md`, and, new for this version,
   the first-time-creator audit and its closure matrix, which is the more specific and more recent
   source wherever the two disagree.
3. The Scroll Craft **Live surface** grammar, whose bans are treated here as hard rules.

---

## 0. The four rules that outrank everything else on this page

The app's four rules (DESIGN_SYSTEM §0) hold verbatim. These four are additional, and specific to a
page whose job is to be operated rather than read.

1. **The product is the picture, and now the page actually shows one.** No stock imagery, no device
   mockups, no illustration of a person, no photography of anything other than the product's own
   output. The pictorial elements are the LIVETAP mark, a generated sample creator clip that stands in
   for a visitor's own camera, a matching guest clip for the Guest Moment, and a drawn screen asset for
   Screen Share, every one of them the product's own demonstration picture, not decoration around it.
   Atmosphere is drawn, not photographed.
2. **Nothing on the page pretends.** Every panel is real markup computing its state from data arrays
   in the page, and the page says on its face that the scenario is a demo. A painted surface, a
   screenshot of a dashboard, or a div dressed as another company's product is forbidden outright.
3. **Copy lives in the surface's own idiom.** Labels, status lines, values, empty states, tooltips,
   field hints. The hero carries one real product statement, this is the one place display type is
   allowed to make a claim rather than report a state, because the audit found the page had no
   statement at all (`AUDIT_CLOSURE.md` P0 #3), and nothing else on the page reads like marketing copy.
4. **Colour is never the only carrier of state, and the page still reads with most colour removed.**
   Every coloured state also carries a word and a dot shape, exactly as `StatusChip` does in the app.

---

## 1. The world

### 1.1 What the world is

A **cinematic live control environment**: one production stage, lit, with its instruments around it,
in a room whose light comes from the stage itself. The reference set is unchanged from v1.0: a
broadcast truck's program monitor wall at night; a mission-control console where every light means one
thing; the calm of a well-run live show's talkback.

The world is a **signal field**, not a place. It has no floor, no horizon, no architecture and no sky.
What gives the frame depth is contrast falling off away from the stage, and the fact that the stage
itself is now the sharpest, most detailed thing on the page, because it is the one place with real
footage on it.

### 1.2 Explicitly not

Unchanged from v1.0.

| Not this | Why |
|---|---|
| Gaming PC, RGB, neon, chromatic glow | Colour here means a state, and a glow means nothing. |
| Purple or violet-to-blue AI gradients | The category default that signals "nobody chose". |
| Apple-style product flythrough | There is no object to fly around. |
| A SaaS template: hero claim, three feature cards, logo wall, pricing | The exact verdict the redesign exists to answer. |
| Cream-and-brass premium-artisan palette | Wrong category and a known default. |
| Glass and blur as decoration | The design does not use `backdrop-filter` anywhere (§7.1). |
| Platform brand colours or platform logos | Platform identity is carried by the platform's **name, set as text**. See §4.4. |
| Emoji as icons | The app's closed glyph set is the icon system (§5). |

### 1.3 Atmosphere: one static gradient, not a canvas

**This section replaces v1.0's `<canvas>` specification in full.** v1.0 called for a scan-drift and
carrier-trail canvas, capped at 30 fps and clamped by device-pixel-ratio. It was never built that way,
and the rebuild's own performance findings (`LIVETAP_MOTION_SYSTEM.md` §2.2, §6.4) are a good reason it
should not be: any per-frame canvas work is exactly the kind of continuous cost the audit's root-cause
finding named.

What ships instead is one CSS rule, `.ltp-surface::before`: a single `radial-gradient()`, centred above
the stage, fading `--ltp-atmos` (a 3% `color-mix()` of the text colour) to transparent. It is present at
every breakpoint, in every theme, under every motion setting, and it costs nothing, no JavaScript, no
canvas context, no per-frame paint. It is not created "below a breakpoint" or "under reduced motion,"
the way v1.0's canvas was meant to fall back; it is simply always this.

| Property | Value |
|---|---|
| Element | `.ltp-surface::before`, `aria-hidden` by construction (a pseudo-element, not focusable or announced) |
| Content | One `radial-gradient(120% 80% at 50% 38%, var(--ltp-atmos) 0%, transparent 62%)` |
| Colour budget | Under 5% opacity, `--ltp-atmos` itself |
| Cost | Zero JavaScript, one compositor layer that never repaints on its own |
| Removing it | Costs the page texture only, the same test v1.0 set for the canvas it replaced |

### 1.4 Grain: present in the markup, not on screen

`.sc-grain`, the Scroll Craft engine's own film-grain layer, is still in `index.html`, the engine
ships it as part of its template, but `acts.css` sets `.sc-grain { display: none; }`. It paints
nothing. This page does not use the engine's grain treatment; the room's texture comes entirely from
§1.3's gradient and from the real footage on the stage.

---

## 2. The layered composition

Seven z-bands, not eight. v1.0's eight-layer table included a full ATMOSPHERE layer with its own scale
and motion rules; that layer is now a zero-cost static gradient (§1.3) with nothing left to schedule, so
it is folded into the table below rather than kept as a peer of layers that actually hold interactive
content.

| # | Layer | `--ltp-z-*` | What it is | Motion rule |
|---|---|---|---|---|
| 0 | Static falloff | `atmos: 1` | `.ltp-surface::before`, §1.3 | None, ever. |
| 1 | SIGNAL | `signal: 2` | The connection paths | `stroke-dashoffset`, `stroke-width`, `opacity` and path geometry only. Never translated, never scaled. |
| 2 | PRODUCT STAGE | `stage: 10` | The stage frame and its picture | The only layer with a scale change: during a shape re-flow. The frame itself holds; its contents re-compose. |
| 3 | DATA / STATUS | `data: 30` | The toolbar, the desk, the readouts | No positional animation at all. Values change; boxes do not. |
| 4 | DESTINATIONS | `dests: 35` | The six destination tiles | Scale is a real state cue: smaller when `DISCONNECTED`, full size when `READY` / `LIVE`. |
| 5 | INTERACTION | `interaction: 40` | The peak's drag apparatus, the tour panel | Exists only while something is happening; removed from the DOM when idle. The only layer with pointer-driven transforms. |
| 6 | BANDS / ACTS | `acts: 50` | Each act's own band, living inside that act's stage (`LIVETAP_SCROLL_STORY.md` §6), plus the transparent act markers | `opacity`, driven by the engine's own cue window on the band itself, never a transform; SHAPES and PRO additionally wipe their mirrored control open by `clip-path` (§2.1). |
| 7 | CHROME | `chrome: 60` | The rail (or top row) and the status bar | Fixed, never parallaxed, never scaled. CSS transitions only. |

### 2.1 How depth is actually carried

Four tools now, not five, **parallax is gone from this list entirely.** v1.0's second tool was "scale
as state" plus a `data-sc-parallax` wrapper on the destination row and the atmosphere layer. No
`data-sc-parallax` attribute exists anywhere on this build (`LIVETAP_SCROLL_STORY.md` §5.1); depth is
carried by:

1. **Contrast falloff with distance.** The static gradient is under 5% of ink; SIGNAL strokes sit at
   60–100% of their state colour; STAGE is 100% contrast, and it is now also the one place with real
   photographic-grade detail, which does more for the falloff than the gradient alone ever could.
2. **Scale as state.** A `DISCONNECTED` destination is smaller than a `READY` one.
3. **Overlap.** The destination tiles cross the stage's boundary; the band sits above the surface on
   desktop as a reserved region and as a plate over the desk on phones (`LIVETAP_SCROLL_STORY.md` §6).
4. **Elevation, three steps**, taken from the app: `--lt-shadow-1` (tiles), `--lt-shadow-2` (the Pro
   panels), `--lt-shadow-3` (the stage). `--lt-shadow-live` is reserved for the armed GO LIVE button.

No zero-offset coloured halo anywhere. No fourth elevation step. No blur-as-glass.

### 2.2 The one rule that keeps it from being seven card stacks

Unchanged from v1.0: **a layer may not contain a rectangle whose only job is to hold content.** Every
box on the page is either the stage, a destination tile, a real control, a real status readout, or a
Pro panel. There is no "section card," no "feature card," and, new and explicit for this version, the
band is not a card either: it is a reserved region of the layout, not a floating panel over the surface.

---

## 3. Type

Unchanged from v1.0. Archivo carries the display slot only; the app's Inter stack carries everything
else.

### 3.1 Two faces, one file

| Slot | Face | Files loaded |
|---|---|---|
| **Display** | **Archivo** (variable, wght 400–800) | 1 · self-hosted woff2, subset, `font-display: swap` |
| **Text** | The app's existing `--lt-font-sans` stack | 0 · no download |
| **Mono** | The app's existing `--lt-font-mono` stack | 0 · no download |

One file total, self-hosted under `apps/web/public/fonts/`, preloaded with `crossorigin` because the
CSP is `font-src 'self' data:`. `--ltp-font-display: Archivo, "Segoe UI Variable Display", "Helvetica
Neue", Arial, sans-serif` is the declared fallback stack so the swap does not reflow. The wordmark never
uses Archivo (DESIGN_SYSTEM §1.1 fixes it to `--lt-font-sans`, weight 800, ALL CAPS).

### 3.2 The eight roles

Unchanged from v1.0, sizes are the app's nine-step scale.

| Role | Face | Where it appears |
|---|---|---|
| **display** | Archivo | The 3-2-1 countdown numeral. The elapsed timer at stage scale. Nothing else. |
| **hero** | Archivo | The hero band's product statement, and the stage's own state line, one line, a status or a real claim in the hero's case, never elsewhere. |
| **headline** | Inter stack | Band titles, panel titles, the close's question. |
| **body** | Inter stack | The hero's lede and every band's one sentence. Max 68 characters per line. |
| **metadata** | Inter stack | Bitrate ceilings, attempt counts, per-destination format labels, field hints. |
| **status** | Inter stack | Chip labels, the health word, "LIVE," "READY," "Demo." |
| **navigation** | Inter stack | Rail item labels, 12px under a 24px icon. Never icon-only. |
| **CTA** | Inter stack | GO LIVE, Open LIVETAP, GitHub links. |

One rule added in v1.0 and still true, with one named exception: **display and hero elsewhere on the
page never carry an argument. They carry state.** The hero band's product statement, in `hero` type, is
the one deliberate exception, the audit's finding that the page had no statement at all outweighs the
grammar's general preference here, and it is a single line, never repeated in that register anywhere
else on the page.

---

## 4. Colour

### 4.1 No new colour

Unchanged from v1.0. Every colour on this page is a token from `packages/ui/src/tokens.css`. Page-local
values exist only as `color-mix()` derivations under the `--ltp-` prefix, and there is no raw hex
anywhere in the public page's CSS.

```css
--ltp-edge:      inset 0 1px 0 color-mix(in oklab, var(--lt-text-primary)  9%, transparent);
--ltp-hair:                     color-mix(in oklab, var(--lt-text-primary) 12%, transparent);
--ltp-field:                    color-mix(in oklab, var(--lt-text-primary)  4%, transparent);
--ltp-signal-idle:              color-mix(in oklab, var(--lt-text-primary) 22%, transparent);
--ltp-signal-ready:             color-mix(in oklab, var(--lt-success)      70%, transparent);
--ltp-signal-live:              var(--lt-accent-live);
--ltp-signal-strain:            var(--lt-warning);
--ltp-atmos:                    color-mix(in oklab, var(--lt-text-primary)  3%, transparent);
--ltp-carrier:                  color-mix(in oklab, var(--lt-accent-focus)  3%, transparent);
```

### 4.2 What each colour means, and nothing else

Unchanged from v1.0.

| Meaning | Token | Never used for |
|---|---|---|
| **LIVE** | `--lt-accent-live`, `--lt-accent-live-solid`, `--lt-on-live` | Errors. Destructive actions. Links. Decoration. |
| **ACTION** | `--lt-accent-focus`, `--lt-accent-focus-solid`, `--lt-on-focus` | Anything to do with being on air. |
| **PLATFORM** | **No colour.** A platform is named in text. | Brand hues, tinted tiles, logo colours. |
| **WARNING** | `--lt-warning` | Failure. Warning means "live, and rough." |
| **SUCCESS** | `--lt-success` | "Live." |
| **STATE** | The ten `--lt-state-*` pairs, verbatim from DESIGN_SYSTEM §2.4 | Any state not in that list. |
| **FAILURE** | `--lt-danger`, `--lt-danger-solid`, `--lt-on-danger` | Live. |

`LIVE` is the only solid fill in the system, and there is exactly one solid-filled element on screen at
a time: the GO LIVE button before the countdown, then the LIVE chips.

### 4.3 The remove-most-colour test

Unchanged from v1.0. Set every state colour to `--lt-text-secondary` and every accent to
`--lt-text-primary`. The page must still be readable, hierarchical and operable, and now, additionally,
the stage's own footage must still read as a picture with the state colours gone, which was not a
question v1.0 had to answer because there was no footage.

### 4.4 Platform identity without platform colour

Unchanged from v1.0. Six destinations, each identified by name, connection method and `StatusChip`
state. No platform logo, no platform brand colour, no tinted tile.

### 4.5 Both themes

Unchanged from v1.0. Dark is the default; light is first-class. `--ltp-atmos` and `--ltp-carrier`
invert with the theme automatically because they are derived from theme tokens.

### 4.6 No drift at all

**This section replaces v1.0's "why there are only two stops" in full.** The Live surface grammar bans
`drift` past two stops; this build carries **zero**. There is no `data-sc-drift` attribute anywhere on
the page. v1.0's two stops decorated the chaos prologue's open and the peak's arrival; the prologue is
gone (§1.3, `LIVETAP_SCROLL_STORY.md` §6) and the peak no longer dims the room around it, its own
content (the snapping path, the reconnect ring) carries the dread-then-trust turn without a ground-colour
change. The ground is one colour for the whole page, which is a stricter reading of the grammar's rule
than v1.0's two stops were, not a looser one.

---

## 5. Iconography

Unchanged from v1.0 in mechanism, updated in the glyph list to match the current rail and the current
chapters. The public page uses the app's closed glyph set, unchanged: inline SVG `<symbol>`s,
`viewBox="0 0 24 24"`, 1.75px stroke, `currentColor`, round caps and joins, at 20px or 24px, extracted
from `packages/ui/src/components/Icons.tsx` so a glyph change changes both surfaces.

| Rule | Value |
|---|---|
| Source | The same path data as the app, inlined once as a sprite in `index.html`. |
| System glyphs used | `camera`, `mic`, `mic-off`, `screen`, `chat`, `chart`, `alert`, `check`, `x`, `refresh`, `play`, `stop`, `record`, `users`, `tv`, `globe`, `sliders`, `chevron`, `external-link`, `spinner`, `sun`, `moon` |
| Moment glyphs | One per Moment, drawn to match the system set's stroke and grid |
| Intent glyphs | One per intent chip, same rules |
| New glyphs | None beyond the Moment and intent sets, which existed in v1.0's plan too. If the page ever needs a system glyph beyond the list above, it names the one it replaces. |
| **Emoji** | Forbidden as an icon, anywhere on the page. |
| Colour | Always `currentColor`, except the live dot inside the mark. |
| Accessibility | `aria-hidden="true"` beside a text label; an icon-only control carries `aria-label`. |

The rail now carries five sections, not four (§2.1 of `LIVETAP_SCROLL_STORY.md`): Stage (`tv`), Break it
(`alert`), Shapes (`chart`), Outputs (`globe`), Versus (`sliders`).

---

## 6. Mobile: a different composition

Mobile is not the desktop composition with smaller type. It is a second composition of the same layers,
updated below for the current chapter set.

### 6.1 What changes

| Aspect | Desktop (> 1024px) | Mobile (< 640px) |
|---|---|---|
| **Chrome** | Left rail, 88px, `--lt-bg-1`, mark at top, five labelled items, theme toggle, Tour, GitHub | Bottom status bar, `56px + env(safe-area-inset-bottom)`. A 44px top row holds the mark alone. No rail. |
| **Band** | A reserved region above the surface, `clamp(224px, 27svh, 252px)` | A plate over the desk's lower edge, `clamp(196px, 26svh, 228px)` |
| **Stage** | Centre column, 16:9 at rest | Full-width, top of the viewport, 9:16 by default (the Vertical Live intent's own shape) |
| **Destinations** | Six tiles arranged around the stage, overlapping its edge | Below the stage, a horizontal scroll-snap row |
| **Static falloff** | Present | Present, identical. It is CSS; there is no breakpoint gate left to write (§1.3). |
| **SIGNAL paths** | Curved beziers from stage ports to tiles around the frame | Short vertical stubs from the stage's lower edge into the tile row |
| **Parallax** | None anywhere on the page (§2.1) | None anywhere on the page |
| **Act spans** | As scored (`LIVETAP_SCROLL_STORY.md` §5) | Every span multiplied by 0.85, rewritten before `ScrollCraft.mount()` |
| **The guided demo** | 4.2s, up to three destinations | 4.2s, two destinations (one fewer connect step) |
| **SHAPES** | 16:9, 9:16, 1:1 all three presented | All three still reachable; 9:16 is the default a phone visitor already sees |
| **PRO** | Four panels | Same four panels; no layout reduction beyond the desk's own responsive stacking |

### 6.2 What does not change

Depth is preserved, not flattened: the stage is still the brightest and sharpest plane, the tiles still
sit in front of it and overlap it, the band still reserves its own space rather than floating over the
surface, and the chrome is still above everything. What is different from v1.0 is not a further
reduction for mobile, it is that **there is nothing left to reduce**, because parallax, the chaos
lattice and the canvas were removed for every breakpoint, not just for phones.

### 6.3 Touch-first

Unchanged from v1.0.

- **44 × 44px minimum** on every interactive element, including the drag grip and the format segments.
- ≥ 8px of clear space between adjacent targets.
- `touch-action: none` scoped to the drag grip only.
- Nothing depends on hover.
- Safe-area insets honoured on the status bar.

---

## 7. The anti-patterns, as a checklist

Unchanged in method from v1.0: pass/fail, derived from the owner's directive's own verdict, now also
cross-checked against the first-time-creator audit's own findings, which named several of these tests
by the symptom they describe.

| # | Test | Passes when | Fails when |
|---|---|---|---|
| **1** | **The text test** | No run of prose longer than two lines anywhere on the page. | Any section reads as a paragraph of marketing prose. |
| **2** | **The static test** | Something on screen changes because of scroll or a tap, at every position. | Any full screen would survive unchanged as a JPEG. |
| **3** | **The feature-list test** | Zero bulleted feature lists, zero three-up feature-card grids. The close's six intent chips are operable controls that re-compose the stage, not a bullet grid, the exact thing the audit named as the one generic screen on the old page (`AUDIT_CLOSURE.md` P1 #24). | A grid of identical cards appears anywhere. |
| **4** | **The depth test** | At least three independent planes visible at every scroll position, falling off away from the stage. | Depth is asserted by a shadow rather than produced by falloff, overlap and scale. |
| **5** | **The demonstration test** | Every claim is demonstrated by an operable element, or now a real picture, within one screen of the claim. | A claim is asserted in words only, the exact failure the audit found in the stage's empty rectangle. |
| **C** | **The category-defining test** | After the visit, the visitor can name an action **they performed** that no other site let them perform. | The most memorable thing about the page is an effect they watched. |

### 7.1 The standing bans

Unchanged from v1.0, and still shipping blockers.

- No em dash anywhere visible. Period, comma, colon or parentheses.
- No `01 / 06` counters, no section numbers, no progress readout.
- No scroll cue.
- No gradient text, no neon, no outer glow, no zero-offset coloured halo.
- No `transition: all`. No animation of `width`, `height`, `top`, `left`, `margin` or `padding`.
- No full-frame dark overlay to fix contrast; density is a sibling of the copy, never a `::before` on it.
- No invented statistics.
- No autoplaying audio, and no audio at all.
- No text baked into an image.
- No download link while no build exists, the footer says so instead (§8, `AUDIT_CLOSURE.md` P1 #19).
- No cookie banner: the site sets no non-essential cookies, and the footer says so.

---

## 8. Assets

| Asset | Status | Note |
|---|---|---|
| The LIVETAP mark | Exists, inline SVG | Used in the chrome and in the close. Ripples never animate here. |
| `creator.mp4` / `creator.webm` / `creator.webp` | **New in this version.** Generated sample creator footage, 960×540. Plays on the stage from first paint, standing in for the visitor's own camera. | Replaces the empty stage the audit scored worst. |
| `guest.mp4` / `guest.webm` / `guest.webp` | **New.** A second generated clip, composited only during the Guest Moment. | |
| `screen.svg` | **New.** A drawn screen asset, built from the same three brand colours as the composed canvas, used only during Screen Share. | |
| `hero-a.webp` | Exists | Now used only as the `apple-touch-icon` and the Open Graph image, social preview, not the stage. |
| `hero-b.webp` | Exists | Not used by this page. |
| The icon set | Exists | Shared verbatim. |
| `archivo-latin.woff2`, subset | Exists | Self-hosted, `font-display: swap`, preloaded. |
| Photography, illustration, 3D, platform logos | None, and none needed | The grammar forbids the first three and §4.4 forbids the fourth. |

Nothing on this page is generated by an image model at request time; the sample footage above is
pre-generated content checked into the repository, not a live call. The product is the picture, and the
picture now actually exists.

---

## 9. What this direction is accountable for

Three claims, each checkable against a screenshot rather than an opinion. Unchanged in kind from v1.0,
with the first claim now able to withstand the audit's own sharpest question.

1. **It is one product, and it now shows one.** Every colour, size, radius, duration, easing, icon and
   component class on the public page is the same token or the same class the app uses, and the stage
   carries a real picture, not a placeholder, the specific gap the audit's visual-quality score (4/10)
   was built on.
2. **It reads with most colour removed.** §4.3, as a one-line CSS override and a screenshot.
3. **It is not a template.** §7, and the fingerprint row in `LIVETAP_SCROLL_STORY.md` §8, updated for
   this rebuild rather than left describing a build that no longer ships.

---

## 10. Research basis, and what was rejected

Unchanged from v1.0; the typography, colour and style research that grounded the original direction did
not change in the rebuild, because the audit's findings were about the stage, the intro and the scroll
mechanism, not about the token system or the type pairing.

### 10.1 What was used

| Query | Result taken |
|---|---|
| `--domain typography` "display typeface paired with Inter text face technical grotesque" | **"Modern Dark Cinema (Inter System)"**: dark, cinematic, technical, "Best For: Developer tools, fintech, AI dashboards, streaming platforms." Its tracking scheme is the one this page follows. Its Inter-only conclusion is not taken; the display slot goes to Archivo. |
| `--domain style` "dark dimensional product interface depth layers" | **`dimensional-layering`**: dark mode supported, low cost, four-level elevation. This page uses the app's three elevation steps rather than four. |
| `--domain ux` "reduced motion scroll performance touch target size accessibility" | All three adopted: 44px targets everywhere, `prefers-reduced-motion` honoured, and the explicit finding that parallax and scroll-jacking cause nausea, answered in this rebuild by removing parallax from the page entirely (§2.1), which is a stronger answer than v1.0's "present the final state under reduced motion only." |
| `--design-system` pattern block | "Scroll-Triggered Storytelling"'s conversion guidance, adopted as engineering rules. Its progress-indicator recommendation is rejected: banned by the owner's rules and by the taste floor. |
| Priority table | Carried into `PLAN.md` §8.4 as an acceptance list. |

### 10.2 What was rejected, and why

Unchanged from v1.0: a `--variance 6 --motion 8 --density 5` run matched "Luxury/Premium Brand" on the
words *premium* and *dark* and returned a light palette, a luxury-fashion serif pairing and a GSAP
snippet this project does not use. None of it was used, for the reasons v1.0 recorded, it is the
opposite of a dark broadcasting tool, and its own `source_identities.style: null` marks it a
variance-dial fallback rather than a database match. The colour system in §4 remains the app's existing
verified-contrast palette, stronger evidence than any search result.
