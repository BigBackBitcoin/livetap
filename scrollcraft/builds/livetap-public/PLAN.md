# PLAN, LIVETAP public experience

**Build** `livetap-public` · **Grammar** Live surface · **Status** Shipped, then rebuilt · **Owner** Design Direction
**Reads from** `BRIEF.md` (self-authored, not interviewed), and now also from
`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md` and `LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md`, the
audit that drove the rebuild this revision documents.
**Design documents** `docs/design/LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` ·
`LIVETAP_INTERACTION_SYSTEM.md` · `LIVETAP_MOTION_SYSTEM.md`

Everything above this file is the design. Nothing here overrides those four; where it looks like it
does, the design documents win and this file is wrong.

**Revision note.** This plan originally described a build with a chaos-lattice hero, a seventeen-step
automatic story, an atmosphere canvas and eight per-act Scroll Craft devices. That build shipped, an
independent audit scored it 59/150 and named its own choreography as the cause of most of what it
disliked, and the page was rebuilt. This revision documents the plan **as it now stands**, most
sections below describe the shipped architecture directly rather than a proposal for it, because the
build this plan describes already exists at `apps/web`.

---

## 0. Where the page lives, and what already exists

| Fact | Evidence |
|---|---|
| `/` is a framework-free static document | `apps/web/index.html` plus `apps/web/vite.config.ts`, two entries: `landing: index.html`, `app: app.html` |
| `/` imports the whole design system | `apps/web/src/landing.css` → `@import '@livetap/ui/styles.css'` |
| A pre-paint theme script exists | `apps/web/public/theme.js`, a classic script in `<head>` |
| The app's onboarding route is `/app/start` | `apps/web/src/App.tsx` |
| `animejs` is a real dependency | `apps/web/package.json`, `"animejs": "^4.5.0"` |
| The rewrite from `apps/web/vercel.json` that once mis-routed `/app/*` to the static document is fixed | Verified against the deployment, not just the config file |

The page's files, as they exist today:

| File | What it holds |
|---|---|
| `apps/web/index.html` | The body: the icon sprite, the chrome (rail / status bar), the fixed live surface, the fixed band layer, the act stack. |
| `apps/web/src/landing.css` | Layout and page-local tokens. Imports `@livetap/ui/styles.css` and `./public/scrollcraft.css`. |
| `apps/web/src/public/acts.css` | The act stack, the band layer, the close. Documented in its own header comment as the fix for two named audit findings (pale narration, and nothing ever covering the headline). |
| `apps/web/src/public/scrollcraft.js` / `.css` | The engine, vendored verbatim, never edited. |
| `apps/web/src/public/main.ts` | The page's own logic: data wiring, state machines, `watchActs()`, the drag, the guided demo, the tour. |
| `apps/web/src/public/data.ts` | Every array the page computes from, each one commented with its `packages/*` source. |
| `apps/web/src/public/picture.ts` / `picture.css` | The picture engine: camera, sample clips, `compose()`. |
| `apps/web/src/public/outputs.ts` | The six OUTPUTS canvases. |
| `apps/web/src/public/versus.ts` / `versus.css` | The VERSUS chapter's two playable lanes. |
| `apps/web/src/public/capture.ts` | The conditional early-access form, `/api/early-access`. |

---

## 1. The page skeleton, as built

Three fixed layers and one act stack. `ScrollCraft.mount(document.body)` is called after the mobile
span rewrite (§5.1) and after `document.fonts.ready`.

```html
<body id="lt-page" data-lt-demo="true">
  <a class="lt-skip-link" href="#surface">Skip to the live surface</a>
  <div class="sc-grain" aria-hidden="true"></div>  <!-- vendored, forced display:none in acts.css -->
  <h1 class="lt-sr-only">LIVETAP, go live everywhere without becoming a broadcast engineer</h1>

  <svg class="ltp-sprite" aria-hidden="true"><!-- every icon, once --></svg>

  <!-- CHROME. Desktop: 88px left rail. Phone: 44px top row + bottom status bar. -->
  <header class="ltp-rail" role="banner">
    <a class="ltp-rail__brand" href="/" aria-label="LIVETAP home"><!-- mark + wordmark --></a>
    <nav class="ltp-rail__nav" aria-label="Sections">
      <!-- Stage / Break it / Shapes / Outputs / Versus -->
    </nav>
    <div class="ltp-rail__foot"><!-- theme toggle, Tour, GitHub --></div>
  </header>
  <div class="ltp-statusbar" role="status" aria-live="off">
    <!-- demo line, destination count, format count, health pill, clock, "Free. Open source." -->
  </div>

  <!-- THE ONE FIXED LIVE SURFACE. Mounted at first paint, never unmounted. -->
  <section id="surface" class="ltp-surface" data-lt-surface data-lt-source="demo"
           data-sc-verify-state="16:9|------|0|0|simple" aria-labelledby="surface-h">
    <h2 id="surface-h" class="lt-sr-only">The live surface, a demo you can operate</h2>
    <svg class="ltp-signal" data-lt-signal aria-hidden="true"><!-- one path per destination --></svg>
    <div class="ltp-monitor">
      <div class="ltp-stagewrap">
        <div class="ltp-stage" data-lt-stage data-lt-format="16:9" data-lt-active-moment="main-camera">
          <!-- the composed canvas: color / screen / camera / guest / text layers, guides,
               LIVE badge, shape badge, and the "Use my camera" control -->
        </div>
        <p class="ltp-stage__state" data-lt-stateline></p>
        <p class="ltp-stage__detail" data-lt-statedetail></p>
      </div>
      <ul class="ltp-dests" data-lt-dests><!-- six tiles --></ul>
    </div>
    <div class="ltp-desk">
      <div class="ltp-toolbar">
        <!-- GO LIVE, the format segments, camera/mic/screen toggles, Simple/Pro -->
      </div>
      <div class="ltp-prolayers" data-lt-prolayers hidden><!-- four rows --></div>
      <div class="ltp-desk__row">
        <div class="ltp-moments" role="group" aria-label="Moments" data-lt-moments></div>
        <section class="ltp-chat" data-lt-chat aria-labelledby="chat-h"><!-- log + note --></section>
      </div>
    </div>
    <div class="ltp-interaction" data-lt-interaction></div>
    <!-- four live regions: dest, broadcast, tour, plus the chat log's own -->
  </section>

  <!-- THE FIXED BAND LAYER. New in this revision: replaces the per-act cue copy. -->
  <div class="ltp-bands" data-lt-bands>
    <span class="ltp-act__plate" aria-hidden="true"></span>
    <div class="ltp-band ltp-band--hero" data-lt-band="act-hero"><!-- statement, lede, hero actions --></div>
    <div class="ltp-band" data-lt-band="act-break"><!-- "Break it yourself.", one-tap CTA --></div>
    <div class="ltp-band" data-lt-band="act-shape"><!-- mirrored format control --></div>
    <div class="ltp-band" data-lt-band="act-moments"><!-- mirrored Moments --></div>
    <div class="ltp-band ltp-band--tall" data-lt-band="act-outputs"><!-- outputs host --></div>
    <div class="ltp-band ltp-band--tall" data-lt-band="act-versus"><!-- versus host --></div>
    <div class="ltp-band" data-lt-band="act-pro"><!-- mirrored Simple/Pro --></div>
  </div>

  <!-- THE ACT STACK: eight acts, one declared rest. Transparent, pointer-events:none except
       their own controls, so the fixed surface stays operable everywhere. -->
  <main class="ltp-acts">
    <section id="act-hero"    data-sc-act="pin"  data-sc-span="1.2"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section class="ltp-rest" data-sc-act="flow" data-lt-rest="a" aria-hidden="true"></section>
    <section id="act-break"   data-sc-act="pin" data-sc-span="2.4" data-lt-peak><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-shape"   data-sc-act="pin" data-sc-span="1.4"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-moments" data-sc-act="pin" data-sc-span="1.4"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-outputs" data-sc-act="pin" data-sc-span="1.4"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-versus"  data-sc-act="pin" data-sc-span="1.6"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-pro"     data-sc-act="pin" data-sc-span="1.2"><div data-sc-stage class="ltp-act__stage"></div></section>
    <section id="act-make"    data-sc-act="pin" data-sc-span="1.4"><div data-sc-stage class="ltp-act__stage">
      <div class="ltp-close" data-sc-cue="0.02 1 0 0"><!-- "What are you making?", intent chips,
        Open LIVETAP / Watch on GitHub for the first build / Code, footer --></div>
    </div></section>
  </main>

  <script src="/src/public/scrollcraft.js"></script>
  <script type="module" src="/src/public/main.ts"></script>
</body>
```

Deliberate omissions, unchanged from v1.0's list and still true:

- **No `<span data-sc-progress>`.** No progress readout, no section counter.
- **No `data-sc-spotlight`, no `data-sc-kinetic`, no `<video data-sc-scrub>`.** The grammar bans all
  three, and the stage's real footage plays on its own clock, never on `--sc-p`.
- **No `<h1>` making a claim.** The document's `<h1>` is visually hidden.
- **No `data-sc-pan`, `data-sc-reveal`, `data-sc-count`, `data-sc-parallax`, `data-sc-tilt` or
  `data-sc-drift` anywhere.** This is new in this revision, and it is the single largest structural
  change from the original plan: every act is `pin`, full stop.

---

## 2. The act stack, chapter by chapter

Eight acts, one rest. Spans are fixed by `LIVETAP_SCROLL_STORY.md` §5.

| # | Chapter | `data-sc-act` | Span | What lives in its band |
|---|---|---|---|---|
| 1 | HERO | `pin` | 1.2 | The product statement, the lede, "Use my camera" / "Try the web demo" |
| · | REST | `flow` | 0.4 (`min-block-size: 40svh`) | Nothing. Authored silence. |
| 2 | BREAK IT | `pin` | 2.4 | "Break it yourself.", the one-tap CTA, the drag/keyboard hint |
| 3 | SHAPES | `pin` | 1.4 | The mirrored 16:9/9:16/1:1 control |
| 4 | MOMENTS | `pin` | 1.4 | The mirrored Moment strip |
| 5 | OUTPUTS | `pin` | 1.4 | The six output canvases, mounted by `outputs.ts` |
| 6 | VERSUS | `pin` | 1.6 | The two playable lanes, mounted by `versus.ts` |
| 7 | PRO | `pin` | 1.2 | The mirrored Simple/Pro control |
| 8 | MAKE | `pin` | 1.4 | The close: the question, the six intent chips, the toolbar, the footer |

Total **12.4 viewport-heights**, inside the 8-to-14 budget.

### 2.1 Which chapter is active

`watchActs()` in `main.ts` (not a Scroll Craft device) computes the act whose box contains the point 45%
down the viewport, on a single passive `scroll`/`resize` listener plus one `requestAnimationFrame`. It
then:

- toggles `is-here` on the matching `[data-lt-band]` panel (the cross-fade is a CSS `transition` on
  that class, 200ms, none under reduced motion)
- toggles `is-here` on the matching rail item
- arms or disarms the peak's drag apparatus on entry to / exit from `act-break`
- shows or hides the SHAPES safe-area guides
- dims the monitor while `act-make` is active

`data-lt-rest="a"` additionally carries an Anime `onScroll` observer in method mode (`enter: 'center
top'`, `leave: 'center bottom'`) that sets `data-sc-verify-hold="true"` on the surface only while the
rest is actually the thing on screen.

### 2.2 What is gone from the original per-act plan

The original plan gave each act its own device: `pin` for the chaos open, `pan` for a destination
shelf, `flow`+`in` staggers for a source-switch-on sequence, `reveal="iris"` for the format guides,
`count` for two computed counters, `parallax` for the Pro layer, pointer `tilt` for the close's cards.
**None of that exists in the shipped page.** `LIVETAP_SCROLL_STORY.md` §5.1 records why: the audit
found the choreography itself was jamming the main thread, and the fix was removal, not retuning.

---

## 3. The data the page computes from

`apps/web/src/public/data.ts`, every array commented with its `packages/*` source, unit-tested against
the real values. Additions since the original plan are marked **new**.

### 3.1 `DESTINATIONS`

Same six platforms, same `method` / `aspects` / `preferred` / `autoStarts` / `chat` / `note` fields as
originally planned, plus **`ceilingMbps` (new)**, each platform's own published bitrate ceiling, used
by the OUTPUTS chapter's "up to N Mbps" line.

### 3.2 `STATES`, `TRANSITIONS`, `STATE_CODE`

The ten-state union, its transition table and its `StatusChip` code mapping, unchanged from the app.

### 3.3 `FORMATS` and `SAFE_AREAS`

Unchanged: `SAFE_AREAS`, `insetToSafeArea()` and `chooseAspect()`, copied verbatim from
`packages/core/src/production/intents.ts`.

### 3.4 `INTENTS`

Six intents, Talking, Gaming, Podcast, Presentation, Event, Vertical Live, each with a `preference`,
a `master` aspect, a `firstMoment` and three `whatYouGet` bullets, unchanged in shape from the original
plan. Rendered as `<button class="ltp-intentchip">`, icon plus title plus tagline, **not tilted toward
the pointer**, the `data-sc-tilt` device named in the original plan is not implemented.

### 3.5 `MOMENTS`

The six Moments, placements copied verbatim from `defaultMoments()`. Unchanged from the original plan.

### 3.6 `CHAT`

18 names, 28 messages, a weighted badge pool, trimmed from `packages/adapters/src/mock/corpus.ts`,
unchanged from the original plan.

### 3.7 The seeded RNG

`createSeededRandom` from Anime.js, used for the chat author/message/badge picks and the arrival
interval jitter. A fixed seed makes every run of the page identical.

---

## 4. Component sharing with the app

Unchanged in principle from the original plan: **reuse the class, not a copy of the class.**
`apps/web/src/landing.css` imports `@livetap/ui/styles.css`; the public page adds only `--ltp-*`
derivations and layout.

| Class family | Used for |
|---|---|
| `.lt-chip`, `.lt-dot`, `.lt-golive`, `.lt-moment`, `.lt-btn`, `.lt-iconbtn`, `.lt-badge`, `.lt-pill`, `.lt-meter`, `.lt-errorcard`, `.lt-toggle`, `.lt-field`, `.lt-input` | Same roles as the app: chips, the GO LIVE button, Moment cards, buttons, badges, the health pill, the mic meter, the peak's error card, the Pro toggle, the stream-key field |
| `.lt-sr-only`, `.lt-skip-link`, `.lt-touch`, `.lt-num`, `.lt-mono` | Unchanged utility classes |

**New in this revision, not reused from `@livetap/ui`:** `.ltp-outputs*` (the six output canvases) and
`.ltp-versus*` (the two playable lanes) are page-local, because they have no equivalent in the app:
the app does not render a multi-platform preview grid or a competitor comparison.

### 4.1 The icon SVGs

Unchanged mechanism: a build-time inline sprite in `index.html`, path bodies extracted from
`packages/ui/src/components/Icons.tsx`, referenced by `<use href="#i-camera">`. The glyph list is
updated to match the current rail: `tv`, `alert`, `chart`, `globe`, `sliders` for the five nav items,
plus the original system, Moment and intent glyphs.

---

## 5. Mobile composition

Below 640px. A second composition of the same layers, not the desktop layout compressed.

### 5.1 The span rewrite, as shipped

```ts
function rewriteSpans(): void {
  if (!phone.matches) return;
  $$('[data-sc-span]').forEach((act) => {
    const v = Number(act.dataset.scSpan) * 0.85;
    act.dataset.scSpan = String(Math.max(1.2, Math.round(v * 100) / 100));
  });
}
```

Result: 1.2 → 1.2, 2.4 → 2.04, 1.4 → 1.2 (×4), 1.6 → 1.36. Plus the one rest at a fixed 40svh, giving
about **11.0svh** total on a phone. The peak is still the largest span by a clear margin.

### 5.2 Per chapter

| Aspect | Mobile composition |
|---|---|
| Chrome | No rail. A 44px top row with the mark alone. Status bar at the bottom, `56px + env(safe-area-inset-bottom)`. |
| Band | A plate over the desk's lower edge, `clamp(196px, 26svh, 228px)`. |
| Surface | Stage pinned to the top, 9:16 by default (the Vertical Live shape). Destination row below it as a horizontal scroll-snap strip. |
| HERO | Guided demo connects two destinations instead of three. |
| SHAPES / MOMENTS / PRO | Mirrored controls in the band, identical mechanism to desktop. |
| OUTPUTS / VERSUS | Same components, narrower layout. |
| MAKE | Six intent chips in a responsive grid, no pointer tilt on any breakpoint. |

### 5.3 What does not change

Depth is preserved: the stage is still the brightest, sharpest plane; the tiles still overlap it; the
band still reserves its own space. Parallax was never present on any breakpoint in this build, so there
is nothing mobile-specific left to turn off (`LIVETAP_VISUAL_DIRECTION.md` §6.1).

---

## 6. Tests to write / kept

| # | Test | Why |
|---|---|---|
| 1 | **Siblings never flicker.** Sample every non-broken tile's computed style before, during and after a break; assert no change. | The peak's entire claim. |
| 2 | **Copied constants match `packages/core`.** Deep-equal `data.ts` against the real `SAFE_AREAS`, `INTENT_PROFILES` and `defaultMoments()`. | The one place the page duplicates the product. |
| 3 | **`chooseAspect` matches `chooseAspectForDestination`.** | The OUTPUTS and SHAPES chapters' honesty. |
| 4 | **No raw hex in `landing.css` / `acts.css`.** | Tokens only. |
| 5 | **`watchActs()` writes no animated property.** | Keeps the third scroll reader (`LIVETAP_MOTION_SYSTEM.md` §2.2) from becoming a second choreography system. |
| 6 | **JS budget.** Assert the `/` entry's gzipped JS stays inside its budget in CI. | `LIVETAP_MOTION_SYSTEM.md` §6.1. |
| 7 | **Reduced motion loses no information.** Snapshot every announcement, label and number in both modes; assert identical. | |
| 8 | **44px targets** at 390 and 1440. | The app currently fails this on the format segments in Simple mode; this page must not reproduce it. |
| 9 | **No em dash in visible copy.** | Scroll Craft hard rule. |
| 10 | **Long-task budget.** `apps/web/e2e/audit-closure.spec.ts` asserts fewer than three long tasks in six idle seconds and 40+ fps. | The audit's own root-cause finding, turned into a gate (`LIVETAP_MOTION_SYSTEM.md` §8.1). |
| 11 | **GO LIVE never dead-ends.** Tapping it with nothing connected must connect the intent's suggested destinations and proceed, never `aria-disabled`. | Closes audit P0 #7. |
| 12 | **The stage never renders empty.** At every intent, format and Moment, the composed canvas has content, the sample picture, the guest clip, the screen asset, or the visitor's own camera. | Closes audit P0 #4. |

---

## 7. Assets

| Asset | Status |
|---|---|
| The LIVETAP mark, inline SVG | Exists. |
| `creator.mp4` / `creator.webm` / `creator.webp` | Exists. The stage's real picture from first paint. |
| `guest.mp4` / `guest.webm` / `guest.webp` | Exists. The Guest Moment's second clip. |
| `screen.svg` | Exists. The Screen Share Moment's drawn asset. |
| `hero-a.webp` | Exists. Now used only as the apple-touch-icon and the Open Graph image. |
| `hero-b.webp` | Exists, unused by this page. |
| The icon set | Exists, shared per §4.1. |
| `apps/web/public/fonts/archivo-latin.woff2` | Exists, subset, self-hosted, preloaded. |
| Photography, illustration, 3D, platform logos | None, and none needed. |

---

## 8. Acceptance checklist

### 8.1 The audit closure

- [ ] Every P0 and P1 finding in `docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md` is CLOSED, on
      the deployed experience, not just in a unit test.
- [ ] `audit-closure.spec.ts` passes: fewer than three long tasks in six idle seconds, 40+ fps.
- [ ] Zero console errors at desktop, phone and reduced motion.

### 8.2 The cheap-website tests (`LIVETAP_VISUAL_DIRECTION.md` §7)

- [ ] **1 · Text** No run of prose over two lines.
- [ ] **2 · Static** No full screen would survive unchanged as a JPEG.
- [ ] **3 · Feature list** Zero bulleted feature-card grids; the close's chips are operable controls.
- [ ] **4 · Depth** Three independent planes visible at every scroll position.
- [ ] **5 · Demonstration** Every claim is demonstrated by an operable element or a real picture.
- [ ] **C · Category-defining** The visitor can name an action **they performed**.

### 8.3 Scroll Craft hard rules

- [ ] No em dash anywhere visible.
- [ ] No progress readout, no section counter, no scroll cue.
- [ ] Every act earns its span; total 12.4vh, inside 8 to 14.
- [ ] The close resolves and holds; the footer is inside the stage.
- [ ] One bespoke signature move, and it is the peak and the tell-someone sentence.
- [ ] The registry row for `livetap-public` is updated to match this build
      (`scrollcraft/FINGERPRINTS.md`, and `LIVETAP_SCROLL_STORY.md` §8).
- [ ] The engine is copied verbatim and never edited.

### 8.4 Measurements

- [ ] LCP ≤ 1.8 s throttled; the LCP element is the stage's held frame.
- [ ] CLS ≤ 0.02.
- [ ] `/` JS ≈ 53 KB gz, CSS ≈ 15 KB gz (`LIVETAP_MOTION_SYSTEM.md` §6.1).
- [ ] No frame over 16.7 ms in the scroll-linked work, at 1440 and 390.
- [ ] **Read the sheet:** the peak reads as the peak now that it arrives second.
- [ ] **Read the sheet:** the last screen stands still with content on it.

### 8.5 After shipping

- [ ] Update the `livetap-public` row in `scrollcraft/FINGERPRINTS.md` in place, this is a revision
      of an existing build, not a new one, so the row is replaced, not appended a second time
      (`LIVETAP_SCROLL_STORY.md` §8).
