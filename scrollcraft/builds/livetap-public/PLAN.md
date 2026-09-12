# PLAN — LIVETAP public experience

**Build** `livetap-public` · **Grammar** Live surface · **Status** Ready to build · **Owner** Design Direction
**Reads from** `BRIEF.md` (self-authored, not interviewed)
**Design documents** `docs/design/LIVETAP_VISUAL_DIRECTION.md` · `LIVETAP_SCROLL_STORY.md` ·
`LIVETAP_INTERACTION_SYSTEM.md` · `LIVETAP_MOTION_SYSTEM.md`

This is the build team's document. Everything above it is the design. Nothing here overrides those
four; where it looks like it does, the design documents win and this file is wrong.

---

## 0. Where the page lives, and what already exists

The repo has already done the structural work this build would otherwise have had to do.

| Fact | Evidence |
|---|---|
| `/` is **already** a framework-free static document | `apps/web/index.html` plus `apps/web/vite.config.ts`, which builds two entries: `landing: index.html` and `app: app.html` |
| `/` already imports the whole design system | `apps/web/src/landing.css` → `@import '@livetap/ui/styles.css'` (52 KB raw, 9.2 KB gz, measured in `docs/qa/FRICTION_BENCHMARK.md` §6) |
| A pre-paint theme script already exists | `apps/web/public/theme.js`, a ~400-byte classic script in `<head>`, because the CSP is `script-src 'self'` |
| The app's onboarding route is `/app/start` | `apps/web/src/App.tsx` |
| A real 404 already exists | `vite.config.ts`'s `real404()` plugin copies `app.html` to `404.html` |
| Demo honesty is already injected at build time | `vite.config.ts`'s `demoHonesty()` plugin fills two named comments in `index.html` |

**So this build replaces the content of two files and adds three**, rather than restructuring the
deployment:

| File | Action |
|---|---|
| `apps/web/index.html` | **Replace** the body. Keep the head verbatim except for the font preload and the stylesheet name. Keep the `<!--lt:demo-hero-->` and `<!--lt:demo-browser-->` comment hooks, or move them into the new markup, so `demoHonesty()` keeps working. |
| `apps/web/src/landing.css` | **Replace**. Keeps `@import '@livetap/ui/styles.css'` as its first line. |
| `apps/web/src/public/scrollcraft.js` | **Add**, copied verbatim from the skill's `engine/`. Never edited. |
| `apps/web/src/public/scrollcraft.css` | **Add**, copied verbatim. Themed only by overriding its six colour tokens and two font tokens from the `--lt-*` set. |
| `apps/web/src/public/main.ts` | **Add**. The page's own logic: data, state machines, the hero timeline, the drag, the canvas, the tour. |

### 0.1 One live deployment defect to fix first

`apps/web/vercel.json` rewrites **every** non-API path to `/index.html`:

```json
"rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]
```

`vite.config.ts` documents the intended behaviour as the opposite: *"The host rewrites the
application's routes — `/app/*`, `/oauth/*`, `/privacy`, `/terms` — to `/app.html`, and serves `/` as
the static document. Nothing else is rewritten, which is what makes the 404 below a real 404."*

As deployed, `/app/start` would serve the marketing document, so ACT 8's handoff cannot work and
neither can any app route. Fix the rewrite before building anything else:

```json
"rewrites": [
  { "source": "/app/(.*)",   "destination": "/app.html" },
  { "source": "/app",        "destination": "/app.html" },
  { "source": "/oauth/(.*)", "destination": "/app.html" },
  { "source": "/privacy",    "destination": "/app.html" },
  { "source": "/terms",      "destination": "/app.html" }
]
```

Verify with an actual request to the deployment, not with the config file.

### 0.2 Dependencies to add

```bash
npm i animejs -w @livetap/web          # 4.5.0, zero runtime dependencies
```

Import from the root export or the subpaths. **Never** the prebuilt bundle
(`dist/bundles/anime.esm.min.js` is 40.8 KB gzipped and would spend two thirds of the page's budget on
one library). See `LIVETAP_MOTION_SYSTEM.md` §1 and §6.1.

---

## 1. The page skeleton

Three fixed things and one act stack. The fixed surface is what makes the page one persistent console
rather than ten pinned stages (`LIVETAP_SCROLL_STORY.md` §5.2).

```html
<body id="lt-page" data-lt-demo="true">

  <a class="lt-skip-link" href="#surface">Skip to the live surface</a>
  <div class="sc-grain" aria-hidden="true"></div>

  <!-- LAYER 7 · FOREGROUND · fixed, outside the act stack, never parallaxed -->
  <header class="ltp-rail" role="banner">
    <a class="ltp-rail__brand" href="/" aria-label="LIVETAP home"><!-- §5.3 mark SVG --></a>
    <nav class="ltp-rail__nav" aria-label="Sections">
      <a class="ltp-rail__item" href="#act-stage"><!-- tv   --><span>Stage</span></a>
      <a class="ltp-rail__item" href="#act-connect"><!-- globe --><span>Destinations</span></a>
      <a class="ltp-rail__item" href="#act-moments"><!-- camera --><span>Moments</span></a>
      <a class="ltp-rail__item" href="#act-formats"><!-- chart --><span>Formats</span></a>
    </nav>
    <div class="ltp-rail__foot">
      <button class="lt-iconbtn lt-iconbtn--md" aria-label="Switch theme"><!-- sun/moon --></button>
      <a class="ltp-rail__item" href="https://github.com/…" rel="noreferrer noopener">
        <!-- external-link --><span>GitHub</span>
      </a>
    </div>
  </header>

  <div class="ltp-statusbar" role="status" aria-live="off">
    <span class="ltp-statusbar__demo lt-badge lt-badge--info">Demo surface. Nothing is broadcast anywhere.</span>
    <span class="ltp-statusbar__dests"><output id="st-dests">0 destinations</output></span>
    <span class="ltp-statusbar__formats"><output id="st-formats">1 format</output></span>
    <span class="ltp-statusbar__health"><output id="st-health">Checking</output></span>
    <span class="ltp-statusbar__clock lt-num"><output id="st-clock">0:00</output></span>
    <span class="ltp-statusbar__free">Free. Open source. Runs on your machine.</span>
  </div>

  <!-- LAYERS 1-6 · the ONE fixed live surface. Mounted at first paint, never unmounted. -->
  <div id="surface" class="ltp-surface"
       data-lt-surface
       data-sc-verify-state="16:9|------|0|0|simple"
       aria-label="The LIVETAP live surface, a demo">

    <canvas class="ltp-atmos" aria-hidden="true" data-sc-parallax="-0.4"></canvas>

    <svg class="ltp-signal" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <path data-lt-path="youtube"></path>
      <path data-lt-path="twitch"></path>
      <path data-lt-path="tiktok"></path>
      <path data-lt-path="instagram"></path>
      <path data-lt-path="x"></path>
      <path data-lt-path="facebook"></path>
    </svg>

    <div class="ltp-stage" data-lt-stage data-lt-format="16:9" data-lt-moment="main-camera">
      <div class="ltp-stage__frame">
        <img class="ltp-stage__plate" src="/brand/hero-a.webp" alt=""
             width="1536" height="864" loading="eager" decoding="async">
        <div class="ltp-layer" data-lt-layer="bg"></div>
        <div class="ltp-layer" data-lt-layer="screen"></div>
        <div class="ltp-layer" data-lt-layer="cam"></div>
        <div class="ltp-layer" data-lt-layer="guest"></div>
        <p   class="ltp-layer ltp-layer--text" data-lt-layer="title"></p>
        <div class="ltp-guides" data-lt-guides aria-hidden="true"></div>
      </div>
      <p class="ltp-stage__state" data-lt-stateline data-sc-cue="0 1 0 0">Idle. Nothing connected.</p>
    </div>

    <ul class="ltp-dests" data-lt-dests>
      <!-- one <li> per destination, template in §4.1 -->
    </ul>

    <div class="ltp-data">
      <div class="ltp-toolbar"><!-- GO LIVE, format control, mic/cam/screen, Pro toggle --></div>
      <div class="ltp-moments" data-lt-moments><!-- six lt-moment buttons --></div>
      <section class="ltp-chat" data-lt-chat aria-label="Chat">
        <ol class="ltp-chat__log" role="log" aria-live="polite" aria-relevant="additions"></ol>
        <p class="ltp-chat__note">TikTok, Instagram and X publish no live chat API, so nothing from them appears here.</p>
      </section>
      <div class="ltp-pro" data-lt-pro hidden><!-- four Pro rows, §4.7 --></div>
    </div>

    <div class="ltp-interaction" data-lt-interaction></div>
  </div>

  <!-- the act stack: transparent scroll markers that drive the surface -->
  <main class="ltp-acts">
    <!-- ten sections, §2 -->
  </main>

  <script src="/src/public/scrollcraft.js"></script>
  <script type="module" src="/src/public/main.ts"></script>
</body>
```

Three deliberate omissions:

- **No `<span data-sc-progress>`.** The engine's progress bar is a progress readout, and this page has
  no counter, no progress indicator and no scroll cue.
- **No `data-sc-spotlight`, no `data-sc-kinetic`, no `data-sc-magnet`, no `<video data-sc-scrub>`.** The
  Live surface grammar bans all four.
- **No `<h1>` making a claim.** The document's `<h1>` is visually hidden and reads
  `LIVETAP, a live production surface you can operate`. Real heading, real reading order, no display
  headline.

`ScrollCraft.mount(document.body)` is called by `main.ts` **after** the mobile span rewrite (§6.1) and
after `document.fonts.ready`, so nothing measures against the fallback face.

---

## 2. The act stack, section by section

Ten sections. Spans and devices are fixed by `LIVETAP_SCROLL_STORY.md` §5 and must not be retuned
without re-running that section's checks.

### ACT 1 · CHAOS · `pin` · span 1.3

```html
<section id="act-stage" data-sc-act="pin" data-sc-span="1.3" data-sc-drift="#0a0b0d"
         aria-labelledby="a1-h" class="ltp-act ltp-act--chaos">
  <h2 id="a1-h" class="lt-sr-only">Six destinations. Six of everything.</h2>
  <div data-sc-stage class="ltp-act__stage">

    <!-- six duplicate control panels. Each one is OPERABLE and each one is a duplicate of a
         control the surface already has. None imitates another company's interface. -->
    <div class="ltp-dup" data-lt-dup="key"     style="--i:0"><!-- lt-field + lt-input, "Stream key" --></div>
    <div class="ltp-dup" data-lt-dup="bitrate" style="--i:1"><!-- lt-input[type=number] --></div>
    <div class="ltp-dup" data-lt-dup="clock"   style="--i:2"><!-- lt-num running clock --></div>
    <div class="ltp-dup" data-lt-dup="golive"  style="--i:3"><!-- lt-golive, pressable, reports it cannot --></div>
    <div class="ltp-dup" data-lt-dup="meter"   style="--i:4"><!-- lt-meter + fader --></div>
    <div class="ltp-dup" data-lt-dup="dests"   style="--i:5"><!-- a one-row destination list --></div>

    <p class="sc-body" data-sc-cue="0 0.55">Six destinations. Six of everything.</p>
    <p class="sc-body" data-sc-cue="0.5 1">One surface. One of each.</p>
  </div>
</section>
```

The convergence is CSS reading `--sc-p`, with each panel's target being the surface's own instance of
that control (`LIVETAP_SCROLL_STORY.md` §6, `LIVETAP_MOTION_SYSTEM.md` §3.7). Each `.ltp-dup` carries
six stacked copies of itself inside, offset by `--i`, so "six of everything" is literal.

### REST A · `flow` · authored silence

```html
<section data-sc-act="flow" class="ltp-rest" data-sc-verify-hold="true" aria-hidden="true"></section>
```

`min-block-size: 70svh`. Nothing in it. The surface is what is on screen, settled, with its
destination row dim and one empty-state line. `main.ts` sets `data-sc-verify-hold="true"` only while
the rest is actually on screen, and clears it otherwise.

### ACT 2 · CONNECT · `pan` · span 1.6

```html
<section id="act-connect" data-sc-act="pan" data-sc-span="1.6" aria-labelledby="a2-h" class="ltp-act">
  <h2 id="a2-h" class="lt-sr-only">Pick where you are going live</h2>
  <div data-sc-stage>
    <div class="ltp-shelf" data-sc-pan="0.06">
      <div class="ltp-shelf__lead sc-stack" data-sc-in>
        <p class="sc-body">Tap the places you want to go live. Each one is its own connection.</p>
      </div>
      <!-- six destination cards; the tiles in the surface mirror their state -->
      <article class="ltp-shelfcard" data-lt-pick="youtube"   data-sc-in></article>
      <article class="ltp-shelfcard" data-lt-pick="twitch"    data-sc-in></article>
      <article class="ltp-shelfcard" data-lt-pick="tiktok"    data-sc-in></article>
      <article class="ltp-shelfcard" data-lt-pick="instagram" data-sc-in></article>
      <article class="ltp-shelfcard" data-lt-pick="x"         data-sc-in></article>
      <article class="ltp-shelfcard" data-lt-pick="facebook"  data-sc-in></article>
      <div class="ltp-shelf__trail sc-stack" data-sc-in>
        <p class="sc-body">LIVETAP opens a separate connection to each one, so they cannot take each other down.</p>
      </div>
    </div>
  </div>
</section>
```

**Measure the overflow before trusting this act.** A rail narrower than the viewport travels zero and
the harness still reports no dead scroll. Six cards at `clamp(15rem, 20vw, 18rem)` plus the lead and
trail blocks should give roughly 900px of overflow at 1440. Assert
`rail.scrollWidth - innerWidth >= innerWidth * 0.5` at 1440, 1024 and 390.

### ACT 3 · PRODUCE · `pin` · span 1.4

```html
<section id="act-moments" data-sc-act="pin" data-sc-span="1.4" aria-labelledby="a3-h" class="ltp-act">
  <h2 id="a3-h" class="lt-sr-only">Camera, microphone, screen, and six Moments</h2>
  <div data-sc-stage class="ltp-act__col">
    <div class="ltp-sources" data-sc-stagger="70">
      <div class="ltp-source" data-lt-source="camera" data-sc-in></div>
      <div class="ltp-source" data-lt-source="mic"    data-sc-in></div>
      <div class="ltp-source" data-lt-source="screen" data-sc-in></div>
    </div>
    <p class="sc-body" data-sc-cue="0.42 1">Tap a Moment to change what viewers see.</p>
  </div>
</section>
```

The Moment strip itself lives in the fixed surface, not in this act, because it stays available from
here to the end of the page. This act's `--sc-p` is what reveals it.

### ACT 4 · ADAPT · `flow` · `reveal`

```html
<section id="act-formats" data-sc-act="flow" aria-labelledby="a4-h" class="ltp-act">
  <h2 id="a4-h" class="lt-sr-only">One production, three shapes</h2>
  <div class="sc-wrap" data-sc-in data-sc-stagger="60">
    <div class="ltp-formats" role="radiogroup" aria-label="Canvas shape">
      <button role="radio" aria-checked="true"  data-lt-format-set="16:9" class="lt-touch">16:9</button>
      <button role="radio" aria-checked="false" data-lt-format-set="9:16" class="lt-touch">9:16</button>
      <button role="radio" aria-checked="false" data-lt-format-set="1:1"  class="lt-touch">1:1</button>
    </div>
    <div data-sc-reveal="iris" data-sc-reveal-at="0.18 0.62" class="ltp-guidelegend">
      <p class="sc-body">9:16 keeps the bottom 28% and the right 16% clear for chat.</p>
    </div>
  </div>
</section>
```

The page's only `iris`, used once. A flow section directly after a pinned act takes **reduced block
padding**, or the pinned stage's viewport of scroll-off plus full section padding delays this act's
first content by another screen.

### ACT 5 · MULTISTREAM · `pin` · `count` · span 1.4

```html
<section data-sc-act="pin" data-sc-span="1.4" aria-labelledby="a5-h" class="ltp-act">
  <h2 id="a5-h" class="lt-sr-only">Going live everywhere at once</h2>
  <div data-sc-stage class="ltp-act__col">
    <p class="sc-body" data-sc-cue="0 0.4 0">
      Going live on <span class="sc-nums lt-num" data-sc-count="0 3" data-sc-count-at="0.06 0.3">0</span>
      destinations, in <span class="sc-nums lt-num" data-sc-count="0 2" data-sc-count-at="0.1 0.34">0</span> formats.
    </p>
    <p class="sc-body" data-sc-cue="0.36 1">Every connection is separate. That is the whole point.</p>
  </div>
</section>
```

**Both counters carry real, computed values** written into `data-sc-count` by `main.ts` from the
visitor's own picks before `ScrollCraft.mount()`. If the visitor has connected nothing, the counters
are removed from the DOM rather than counting to zero. No bitrate, viewer or fps counter exists
anywhere on the page.

### REST B · `flow` · authored silence, and the silence before the peak

```html
<section data-sc-act="flow" class="ltp-rest" data-sc-verify-hold="true" aria-hidden="true"></section>
```

`min-block-size: 60svh`. The show is running and nothing is happening.

### ACT 6 · RESILIENCE · `pin` · span 2.8 · **the peak**

```html
<section id="act-break" data-sc-act="pin" data-sc-span="2.8" data-sc-drift="#07080a"
         aria-labelledby="a6-h" class="ltp-act ltp-act--peak" data-lt-peak>
  <h2 id="a6-h" class="lt-sr-only">Break it yourself</h2>
  <div data-sc-stage class="ltp-act__col">
    <p class="sc-body" data-sc-cue="0 0.3 0">Drag a live destination off the stage.</p>
    <p class="sc-body" data-sc-cue="0.26 0.62">Its connection snaps. The others do not notice.</p>
    <p class="sc-body" data-sc-cue="0.58 1">LIVETAP pulls it back on its own.</p>
    <div class="ltp-errorslot" data-lt-errorslot></div>
  </div>
</section>
```

The drag apparatus is armed on this act's entry and disarmed on its exit, by an `onScroll` observer in
method mode. The last 0.5 of the span is the peak's resolution hold, and `main.ts` sets
`data-sc-verify-hold="true"` on the surface for exactly that window.

### ACT 7 · POWER · `flow` · `parallax`

```html
<section data-sc-act="flow" aria-labelledby="a7-h" class="ltp-act">
  <h2 id="a7-h" class="lt-sr-only">The depth underneath</h2>
  <div class="sc-wrap">
    <button class="lt-toggle lt-touch" aria-pressed="false" data-lt-pro-toggle>Pro</button>
    <div class="ltp-prolayers" data-sc-parallax="-0.6" data-sc-stagger="60">
      <div class="ltp-prorow" data-sc-in data-lt-prorow="encoder"></div>
      <div class="ltp-prorow" data-sc-in data-lt-prorow="bitrate"></div>
      <div class="ltp-prorow" data-sc-in data-lt-prorow="audio"></div>
      <div class="ltp-prorow" data-sc-in data-lt-prorow="diagnostics"></div>
    </div>
  </div>
</section>
```

`data-sc-parallax` goes on the **wrapper**; Anime writes opacity on the rows. Two nodes, never one.

### ACT 8 · ACTION · `pin` · `tilt` · span 1.2 · last element on the page

```html
<section id="act-start" data-sc-act="pin" data-sc-span="1.2" aria-labelledby="a8-h"
         class="ltp-act ltp-act--close">
  <div data-sc-stage class="ltp-close">
    <h2 id="a8-h" class="ltp-close__q" data-sc-cue="0.04">What are you making?</h2>

    <div class="ltp-intents" role="group" aria-labelledby="a8-h" data-sc-cue="0.06">
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="talking"      data-sc-tilt="5"></button>
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="gaming"       data-sc-tilt="5"></button>
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="podcast"      data-sc-tilt="5"></button>
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="presentation" data-sc-tilt="5"></button>
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="event"        data-sc-tilt="5"></button>
      <button class="ltp-intent lt-touch" aria-pressed="false" data-lt-intent="vertical"     data-sc-tilt="5"></button>
    </div>

    <div class="ltp-close__bar" data-sc-cue="0.08">
      <a class="lt-btn lt-btn--primary lt-btn--lg" href="/app/start" data-lt-open>Open LIVETAP</a>
      <a class="lt-btn lt-btn--secondary lt-btn--md" href="#lt-get">Download</a>
      <a class="lt-btn lt-btn--ghost lt-btn--md" href="https://github.com/…" rel="noreferrer noopener">GitHub</a>
    </div>

    <footer class="ltp-foot" data-sc-cue="0.1">
      <!-- mark, the three legal links, and "No tracking cookies. Nothing to accept." -->
    </footer>
  </div>
</section>
```

Every cue here is **one-value**, so nothing fades out before the page ends. The footer is **inside** the
stage, so there is no dead tail. `data-lt-open`'s `href` gains `?intent={contentType}` when a card is
picked. This is the last element in `<main>`; nothing follows it.

---

## 3. The data the page computes from

One module, `apps/web/src/public/data.ts`, about 1.5 KB gzipped. Every array carries a comment naming
its source in `packages/*`, and a unit test asserts the copies match the real values (§6).

### 3.1 `DESTINATIONS`

```ts
/** Source: packages/adapters/src/profiles/{youtube,twitch,tiktok,instagram,x,facebook}.ts
 *  `method` is DERIVED from capabilities.streamKey via the PRODUCT_SPEC §5b mapping,
 *  never hand-written. Order is fixed and is never re-sorted (app tenet 9). */
export const DESTINATIONS = [
  { id: 'youtube',   name: 'YouTube',   method: 'connect', aspects: ['16:9','9:16'], preferred: '16:9',
    autoStarts: false, chat: true,  note: '' },
  { id: 'twitch',    name: 'Twitch',    method: 'connect', aspects: ['16:9','9:16'], preferred: '16:9',
    autoStarts: true,  chat: true,  note: '' },
  { id: 'tiktok',    name: 'TikTok',    method: 'key',     aspects: ['9:16'],        preferred: '9:16',
    autoStarts: false, chat: false, note: 'You start and end the broadcast in TikTok. LIVETAP sends the video.' },
  { id: 'instagram', name: 'Instagram', method: 'key',     aspects: ['9:16'],        preferred: '9:16',
    autoStarts: false, chat: false, note: 'The key changes every session, so LIVETAP never stores it.' },
  { id: 'x',         name: 'X',         method: 'key',     aspects: ['16:9'],        preferred: '16:9',
    autoStarts: false, chat: false, note: 'Pushing video alone does not make you live. You start it on X.' },
  { id: 'facebook',  name: 'Facebook',  method: 'connect', aspects: ['16:9','9:16'], preferred: '16:9',
    autoStarts: true,  chat: true,
    note: 'Needs Facebook app review and business verification before it works for you.' },
] as const;

export const METHOD_LABEL = { connect: 'Connect account', key: 'Paste stream key' } as const;
export const METHOD_TONE  = { connect: 'success',          key: 'info' } as const;
export const DEMO_INGEST  = 'demo.livetap.invalid';   // the app's own demo ingest host
```

### 3.2 `STATES`

```ts
/** Source: packages/core/src/types/destination.ts (DESTINATION_STATES) and
 *  PRODUCT_SPEC §4.2 for the label, dot treatment and pulse rules. */
export const STATE_LABEL = {
  DISCONNECTED: 'Not connected', AUTHENTICATING: 'Signing in', READY: 'Ready',
  STARTING: 'Starting', LIVE: 'Live', DEGRADED: 'Live, rough',
  RECONNECTING: 'Reconnecting', FAILED: 'Failed', STOPPING: 'Stopping', ENDED: 'Ended',
} as const;
export const DOT = {
  DISCONNECTED: 'ring', AUTHENTICATING: 'solid', READY: 'solid', STARTING: 'solid',
  LIVE: 'pulse', DEGRADED: 'solid', RECONNECTING: 'pulse', FAILED: 'glyph',
  STOPPING: 'solid', ENDED: 'solid',
} as const;
export const PULSING = ['LIVE', 'RECONNECTING'] as const;
```

### 3.3 `FORMATS` and `SAFE_AREAS`

```ts
/** Source: packages/core/src/production/intents.ts — SAFE_AREAS, verbatim. */
export const SAFE_AREAS = {
  '16:9': { top: 0.05, bottom: 0.06, left: 0.05, right: 0.05 },
  '9:16': { top: 0.12, bottom: 0.28, left: 0.05, right: 0.16 },
  '1:1':  { top: 0.06, bottom: 0.12, left: 0.06, right: 0.06 },
} as const;

export const FORMATS = ['16:9', '9:16', '1:1'] as const;

/** Source: intents.ts — chooseAspectForDestination(), copied so the page can run it. */
export function chooseAspect(pref: readonly string[], d: { aspects: readonly string[]; preferred: string }) {
  for (const a of pref) if (d.aspects.includes(a)) return a;
  return d.preferred;
}
/** Source: intents.ts — insetToSafeArea(), copied verbatim including the rounding. */
export function insetToSafeArea(r, aspect) { /* identical body */ }
```

### 3.4 `INTENTS`

```ts
/** Source: packages/core/src/production/intents.ts — INTENT_PROFILES.
 *  `emoji` is deliberately NOT copied: the page renders <IntentIcon>, never an emoji. */
export const INTENTS = [
  { id: 'talking',      title: 'Talking',       tagline: 'Just you and the camera.',
    aspectPreference: ['16:9','9:16','1:1'], master: '16:9', firstMoment: 'main-camera',
    whatYouGet: ['Full-frame camera','Clean lower-third','Auto vertical crop for TikTok and Shorts'] },
  { id: 'gaming',       title: 'Gaming',        tagline: 'Your game, with you in the corner.',
    aspectPreference: ['16:9','9:16'],       master: '16:9', firstMoment: 'screen-share', /* … */ },
  { id: 'podcast',      title: 'Podcast',       tagline: 'You and a guest, side by side.',
    aspectPreference: ['16:9','1:1','9:16'], master: '16:9', firstMoment: 'guest', /* … */ },
  { id: 'presentation', title: 'Presentation',  tagline: 'Your screen, with you alongside.',
    aspectPreference: ['16:9','9:16'],       master: '16:9', firstMoment: 'screen-share', /* … */ },
  { id: 'event',        title: 'Event',         tagline: 'A stage, a camera, an audience.',
    aspectPreference: ['16:9','1:1','9:16'], master: '16:9', firstMoment: 'starting-soon', /* … */ },
  { id: 'vertical',     title: 'Vertical Live', tagline: 'Built for phones, first.',
    aspectPreference: ['9:16','1:1','16:9'], master: '9:16', firstMoment: 'main-camera', /* … */ },
] as const;

/** Source: intents.ts — renameForIntent(). */
export const RENAME = {
  gaming:       { 'screen-share': 'Gameplay' },
  presentation: { 'screen-share': 'Slides' },
  podcast:      { guest: 'Conversation' },
} as const;
```

### 3.5 `MOMENTS`

```ts
/** Source: packages/core/src/moments/defaults.ts — defaultMoments(), placements verbatim.
 *  Only the fields the page paints are copied: no audio device ids, no transitions it cannot run. */
export const MOMENTS = [
  { id: 'starting-soon', name: 'Starting Soon', icon: 'starting-soon', transition: 'fade', ms: 400,
    micMuted: true,
    layers: [ { k:'color' },
              { k:'text',  text:'Starting soon', at:{ default:{x:.1,y:.38,w:.8,h:.24} } },
              { k:'camera', visible:false,
                at:{ default:{x:.78,y:.72,w:.18,h:.24}, '9:16':{x:.6,y:.78,w:.34,h:.18} }, radius:24 } ] },
  { id: 'main-camera',  name: 'Main Camera',  icon: 'main-camera',  transition: 'fade', ms: 300,
    micMuted: false, layers: [ { k:'camera', at:{ default:{x:0,y:0,w:1,h:1} }, fit:'cover' } ] },
  { id: 'screen-share', name: 'Screen Share', icon: 'screen-share', transition: 'fade', ms: 300,
    micMuted: false,
    layers: [ { k:'color' },
              { k:'screen', at:{ default:{x:0,y:0,w:1,h:1}, '9:16':{x:0,y:.2,w:1,h:.4} }, fit:'contain' },
              { k:'camera', at:{ default:{x:.74,y:.7,w:.22,h:.26}, '9:16':{x:.1,y:.62,w:.8,h:.3} }, radius:20 } ] },
  { id: 'guest',        name: 'Guest',        icon: 'guest',        transition: 'slide', ms: 350,
    micMuted: false,
    layers: [ { k:'color' },
              { k:'camera', at:{ default:{x:.02,y:.15,w:.47,h:.7}, '9:16':{x:.05,y:.06,w:.9,h:.42} }, radius:20 },
              { k:'guest',  at:{ default:{x:.51,y:.15,w:.47,h:.7}, '9:16':{x:.05,y:.52,w:.9,h:.42} }, radius:20 } ] },
  { id: 'break',        name: 'Break',        icon: 'break',        transition: 'fade', ms: 500,
    micMuted: true,
    layers: [ { k:'color' }, { k:'text', text:'Back in a moment', at:{ default:{x:.1,y:.4,w:.8,h:.2} } } ] },
  { id: 'ending',       name: 'Ending',       icon: 'ending',       transition: 'fade', ms: 600,
    micMuted: false,
    layers: [ { k:'color' }, { k:'text', text:'Thanks for watching', at:{ default:{x:.1,y:.4,w:.8,h:.2} } } ] },
] as const;
```

The two background hex values in `defaultMoments()` (`#0B0F19`, `#101828`) are **not** copied. The
page's `color` layer uses `--lt-bg-0`, because a raw hex in the public page's CSS is a lint failure and
because the stage's background should be the product's ground.

### 3.6 `CHAT`

```ts
/** Source: packages/adapters/src/mock/corpus.ts — MOCK_DISPLAY_NAMES, MOCK_MESSAGES,
 *  MOCK_BADGE_POOL. Trimmed to 18 names and 28 messages to stay inside the JS budget;
 *  the trim keeps the corpus's mix of greetings, reactions, tech notes and questions. */
export const CHAT_NAMES = ['pixelnomad','Marta_Oduya','quietcoyote','DevonWasHere','lofi_gremlin',
  'Sam K.','northwindow','tanuki_tv','Priya R','saltandsolder','Kaz','midnight_diner',
  'HelenaBuilds','roux','TomasFPV','Yara','sundaycoder','OllieOnAir'] as const;

export const CHAT_MESSAGES = ['hello from Lisbon','audio is perfect today','that transition was clean',
  'wait how did you do that','been waiting all week for this','good morning everyone',
  'the new overlay looks so much better','chat is fast today','oh that is clever',
  'what camera are you on?','do you have the link for that?','this is genuinely useful thank you',
  'I just got here, what did I miss?','the lighting is so much nicer now',
  'quick question: does it work offline?','brb making tea','back','that plugin saved me hours last month',
  'greetings from the night shift','the captions are keeping up nicely','please do a part two',
  'thats a really tidy solution','is the vod going to be up later?','my cat is watching too',
  'what keyboard is that','the colour grade is lovely','signal looks rock solid from here',
  'how many destinations are you on right now?'] as const;

/** The real distribution: mostly nobody, a few regulars. */
export const CHAT_BADGES = [null,null,null,null,null,null,null,'subscriber','subscriber',
  'member','moderator','verified'] as const;

/** Only platforms whose capabilities.chatRead is an automated class. */
export const CHAT_PLATFORMS = ['youtube','twitch','facebook'] as const;
```

Every rendered row carries a `Demo` `lt-badge lt-badge--info`. Mock chat never renders without it.

### 3.7 The seeded RNG

One `createSeededRandom` from Anime.js, seeded with a constant, used for: the chat author, message and
badge picks; the arrival interval jitter; the mic meter level; and which destination the hero story
degrades. A fixed seed makes every run of the page identical, which is what makes the verification
screenshots comparable at all.

---

## 4. Component sharing with the app

The rule: **reuse the class, not a copy of the class.** `apps/web/src/landing.css` already imports
`@livetap/ui/styles.css`, which is tokens plus resets plus every component class. The public page adds
only `--ltp-*` derivations and layout, never a second definition of a component.

### 4.1 Reused verbatim from `packages/ui/src/components.css`

| Class family | Used for |
|---|---|
| `.lt-chip`, `.lt-chip--{state}`, `.lt-chip__text`, `.lt-chip__label`, `.lt-chip__status` | Every destination state, ten variants, no additions |
| `.lt-dot`, `.lt-dot--pulse`, `.lt-dot--ring` | The dot treatments, including the two pulsing states |
| `.lt-golive`, `.lt-golive--{state}`, `.lt-golive__label/count/cancel/timer` | The GO LIVE button and its in-place countdown |
| `.lt-moment`, `.lt-moment__icon`, `.lt-moment__name`, `.lt-moment__meta` | The six Moment cards |
| `.lt-btn`, `.lt-btn--{primary,secondary,ghost,live}`, `.lt-btn--{sm,md,lg}`, `.lt-btn--block` | Every button. The close bar uses `primary`, `secondary`, `ghost`. `--live` is not used on this page. |
| `.lt-iconbtn`, `.lt-iconbtn--{md,lg,secondary,active}` | The theme toggle, the `⋯` controls, the tour dismiss |
| `.lt-badge`, `.lt-badge--{info,success,neutral,warning,danger}` | The capability badge, the `Demo` badge, the chat platform badge |
| `.lt-pill`, `.lt-pill--{excellent,good,fair,poor,critical,unknown}`, `.lt-pill__chevron` | The health readout |
| `.lt-meter`, `.lt-meter__track/fill/peak/value`, `.lt-meter--{silent,hot,clipping}` | The mic level, including the chaos act's six duplicates |
| `.lt-errorcard`, `.lt-errorcard__{what,desc,list,term,actions,icon,tech}` | The peak's four-field card |
| `.lt-toggle`, `.lt-toggle__track/knob` | The Pro toggle |
| `.lt-field`, `.lt-field__{label,hint,error}`, `.lt-input` | The stream-key row and the chaos duplicates |
| `.lt-tabs`, `.lt-tablist`, `.lt-tab`, `.lt-tabpanel` | The Pro layer's four panels |
| `.lt-card`, `.lt-card--flat`, `.lt-card__{header,title,body,actions}` | The shelf cards and the Pro rows |
| `.lt-select`, `.lt-select-wrap` | The Pro layer's read-only pickers |
| `.lt-spinner` | `STARTING` and `STOPPING` |
| `.lt-tooltip`, `.lt-tooltip__bubble` | Never the only source of a label |

**Not reused:** `.lt-sheet*`. The public page has no sheets, no modals and no focus traps, by design.

### 4.2 Reused verbatim from `packages/ui/src/global.css`

`.lt-sr-only`, `.lt-skip-link`, `.lt-touch`, `.lt-num`, `.lt-mono`, `.lt-pulse`, `.lt-spin`,
`.lt-focus-inset`. `.lt-num` is mandatory on every number that updates on a timer, which on this page
is the clock, the countdown, the ring's digit, the bitrate readouts and the attempt count.

### 4.3 Tokens: all of them, and no new ones

`packages/ui/src/tokens.css` in full, both themes, unchanged. The page adds exactly the nine `--ltp-*`
derivations in `LIVETAP_VISUAL_DIRECTION.md` §4.1 and the one `--ltp-font-display`, all of them
`color-mix()` of an existing token or a font stack. **A lint rule rejects any raw hex, `rgb()` or
`hsl()` in `landing.css`.**

Scroll Craft's engine stylesheet is themed by mapping its six colour tokens and two font tokens onto
LIVETAP's, and nothing else in it is touched:

```css
:root {
  --sc-canvas: var(--lt-bg-0);         --sc-surface: var(--lt-bg-2);
  --sc-ink:    var(--lt-text-primary); --sc-ink-soft: var(--lt-text-secondary);
  --sc-accent: var(--lt-accent-focus); --sc-accent-ink: var(--lt-on-focus);
  --sc-font-display: var(--ltp-font-display);
  --sc-font-text:    var(--lt-font-sans);
}
```

`data-sc-*` selectors and `.sc-stage` / `.sc-copy` are **never** restyled. They are the mechanism.

### 4.4 The icon SVGs

The icons must be the app's paths, not a second drawing of them. The page is not React, so it cannot
import the components. Two acceptable routes, in order of preference:

1. **A build-time inline sprite.** A small Vite plugin reads the path bodies out of
   `packages/ui/src/components/Icons.tsx` and emits one `<svg hidden><symbol id="i-camera">…</symbol></svg>`
   block into `index.html`, referenced as `<svg class="lt-icon lt-icon--24"><use href="#i-camera"/></svg>`.
   One source of truth, zero JS, and a glyph change changes both surfaces.
2. **A generated `icons.svg` partial** committed alongside, with a unit test that re-extracts the paths
   from `Icons.tsx` and fails if the partial has drifted.

Either way the rules are the app's: `viewBox="0 0 24 24"`, `stroke-width="1.75"`, `stroke="currentColor"`,
`fill="none"`, round caps and joins, 20px or 24px, `aria-hidden="true"` beside a label. Glyphs needed:
`camera`, `mic`, `mic-off`, `screen`, `chat`, `chart`, `alert`, `check`, `x`, `refresh`, `play`, `stop`,
`record`, `users`, `tv`, `globe`, `sliders`, `chevron`, `external-link`, `spinner`. **No 25th glyph, and
no emoji anywhere.**

The mark is the DESIGN_SYSTEM §1.2 SVG, already inline in `index.html` twice today. Reuse it verbatim,
with `currentColor` for the frame and ripples and `--lt-accent-live-solid` for the dot, and **do not
animate the ripples.**

### 4.5 Terminology shared with the app

One label per intent, on the page and in the app: **Open LIVETAP**, **Download**, **GitHub**,
**GO LIVE**, **END**, **Ready**, **Live**, **Live, rough**, **Reconnecting**, **Not connected**,
**Demo**, **Connect account**, **Paste stream key**, **Moment**, **Stage**, **Destination**, **Format**,
**Pro**. No synonym for any of them appears anywhere on the page.

---

## 5. Mobile composition, per act

Below 640px. Not the desktop layout compressed: a second composition of the same layers
(`LIVETAP_VISUAL_DIRECTION.md` §6).

### 5.1 The span rewrite

`main.ts` rewrites `data-sc-span` **before** `ScrollCraft.mount()`, because the engine reads the
attribute once and CSS cannot override the height it sets:

```ts
if (matchMedia('(max-width: 639.98px)').matches) {
  for (const act of document.querySelectorAll<HTMLElement>('[data-sc-span]')) {
    const v = Number(act.dataset.scSpan) * 0.85;
    act.dataset.scSpan = String(Math.max(1.2, Math.round(v * 100) / 100));  // 1.2 is the pinned floor
  }
}
```

Result: 1.3 → 1.2, 1.6 → 1.36, 1.4 → 1.2, 1.4 → 1.2, 2.8 → 2.38, 1.2 → 1.2. Plus the two rests at
70svh and 60svh, giving about **11.0svh** total. The peak is still the largest by 1.75×.

### 5.2 Per act

| Act | Mobile composition |
|---|---|
| Chrome | No rail. A 44px top row with the mark alone. The status bar moves to the bottom, 64px plus `env(safe-area-inset-bottom)`, carrying the same readouts plus the one action. |
| Surface | Stage pinned to the top at 16:9, full width. Destination row below it as a horizontal scroll-snap row, 2.2 tiles visible, overlapping the stage's lower edge by 12px. Signal paths become short vertical stubs from the stage's lower edge into the row. |
| **1 CHAOS** | Four duplicate panels, not six, stacked in two columns. The argument is "six of everything" and the panels still each hold six internal copies, so the count survives the reduction in panel types. Jitter amplitude 1px. |
| REST A | 70svh. Identical. |
| **2 CONNECT** | The shelf becomes the surface's own scroll-snap row; the `pan` act still travels, and its reduced-motion fallback is a native scroll region. Cards drop the trailing note into a single `metadata` line. |
| **3 PRODUCE** | The three source rows stack full width at 44px each. The Moment strip is the app's own mobile strip: 2.2 cards at 140 × 104. |
| **4 ADAPT** | **16:9 and 9:16 are presented**; 1:1 stays in the control, reachable and labelled, but the act's own choreography demonstrates the two that a phone visitor cares about. The safe-area guides matter more here, not less: a phone is where 9:16 is real. |
| **5 MULTISTREAM** | Two destinations instead of three in the auto-story; the visitor's own picks are unchanged. Counters unchanged. |
| REST B | 60svh. Identical. |
| **6 PEAK** | The grip is a 44 × 44px target on the tile's leading edge. Threshold is 168 × (390/1440) ≈ 45px, reachable inside the tile row. The `ErrorCard` opens as a sibling **below** the tile row, not over the stage, and cannot leave the viewport. `⋯` carries `Drop from stage`. |
| **7 POWER** | One Pro panel (diagnostics), with the other three named in a list. No parallax. |
| **8 ACTION** | The six intent cards become a 2-column grid, 44px minimum, no `tilt` (the engine gates pointer devices to fine pointers). The close bar stacks: `Open LIVETAP` full width, then the two secondary items in a row. Footer inside the stage. |
| ATMOSPHERE | Canvas not created. A static CSS radial falloff replaces it. |
| Parallax | Off. Depth is overlap, scale-as-state and edge light. |
| Type | `display` 36, `hero` 28. One rung down. |

### 5.3 Landscape phones

`height < 480px` collapses the Moment strip into a single button, exactly as the app does, and the
stage plus the destination row keep priority. The two rests drop to 50svh so the page does not feel
padded out on a short viewport.

---

## 6. Tests to write

| # | Test | Why |
|---|---|---|
| 1 | **Siblings never flicker.** Sample every non-broken tile's computed `transform`, `opacity`, chip state, path `d` and `stroke-width` before, during and after a break; assert no change. | The peak's entire claim. |
| 2 | **Copied constants match `packages/core`.** Import the real `SAFE_AREAS`, `INTENT_PROFILES` and `defaultMoments()`; deep-equal against `data.ts`. | The one place the page duplicates the product. It must not drift. |
| 3 | **`chooseAspect` matches `chooseAspectForDestination`.** Run both over all six destinations × all six intents; assert identical output. | The format table is the honesty of ACT 4. |
| 4 | **The `pan` rail overflows.** Assert `rail.scrollWidth - innerWidth >= innerWidth * 0.5` at 1440, 1024 and 390. | The harness reports a zero-travel rail as healthy. |
| 5 | **No raw hex in `landing.css`.** Lint rule. | Tokens only, both themes, DESIGN_SYSTEM §11. |
| 6 | **No two systems on one property.** Dev-mode assertion before every `animate()` call: the target is not inside a `[data-sc-parallax]`, `[data-sc-cue]` or `[data-sc-pan]` subtree for the property being written. | The two-system contract, enforced rather than trusted. |
| 7 | **JS budget.** Assert the `/` entry's gzipped JS is ≤ 60 KB in CI, from Vite's own `reportCompressedSize`. | The budget is a number or it is nothing. |
| 8 | **Reduced motion loses no information.** Snapshot every announcement, every state label and every number in both modes; assert identical. | "Fewer and gentler, not zero." |
| 9 | **44px targets.** Measure every interactive element at 390 and 1440; assert ≥ 44 × 44 with ≥ 8px clear space. | The app currently fails this on the format segments; this page must not reproduce it. |
| 10 | **No banned vocabulary.** Extend `apps/web/src/__tests__/no-obs-words.test.ts` to cover the new markup, and widen its pattern beyond `rtmp\|bitrate\|codec\|keyframe\|scene\|source` to catch "encoder", which PRODUCT_REVIEW found leaking into Simple copy. | Protocol words never reach a Simple-mode reader. |
| 11 | **No em dash in visible copy.** Grep the markup and the data module. | Scroll Craft hard rule. |
| 12 | **One solid fill on screen.** Assert exactly one element with a solid accent background is visible at each act. | DESIGN_SYSTEM §0 rule 3, and the defect PRODUCT_REVIEW measured on the current landing page. |

---

## 7. Assets

| Asset | Status |
|---|---|
| The LIVETAP mark, inline SVG | **Exists.** DESIGN_SYSTEM §1.2, already inline in `index.html`. |
| The hero plate, `apps/web/public/brand/hero-a.webp` | **Exists.** Used as the stage's held frame, `loading="eager"`, `width`/`height` set. It is the LCP element. |
| The icon set | **Exists.** `packages/ui/src/components/Icons.tsx`, shared per §4.4. |
| `apps/web/public/fonts/archivo-subset.woff2` | **To produce.** One variable woff2, wght 400–800, subset to Latin basic plus digits, colon, middle dot and the arrow used in labels. Target ≤ 28 KB; if the subset exceeds 34 KB, ship two static weights instead and keep the file count at two. `font-display: swap`, preloaded with `crossorigin`, self-hosted because the CSP is `font-src 'self' data:`. |
| Photography, footage, video, generated imagery, 3D, platform logos | **None, and none needed.** |
| `hero-b.webp` | Exists in `public/brand/` and is **not used** by this page. Leave it; it is not this build's to delete. |

Total new bytes: one font file. No image generation, no `KIE_AI_API_KEY`, no credit spend.

---

## 8. Acceptance checklist

Every line is pass or fail against a screenshot, a measurement or a test. Nothing here is a judgement
call except the three marked **read the sheet**.

### 8.1 The 15-second test (`LIVETAP_INTERACTION_SYSTEM.md` §11)

- [ ] **F1** One production goes to several platforms at once — three lit paths, three `LIVE` chips, by 11.0 s without scrolling
- [ ] **F2** One button operates it — `GO LIVE (DEMO)`, the only solid fill, by 6.2 s
- [ ] **F3** One production, several shapes — per-destination format labels `16:9 / 16:9 / 9:16` plus `2 formats`, by 5.4 s
- [ ] **F4** Moments, not a scene tree — the six-card strip, in the landing view
- [ ] **F5** One platform failing does not stop the others — steps 14 to 17, by 21.0 s
- [ ] **F6** Free, open source, runs on your machine — the status bar line, at first paint
- [ ] Five of the six are carried by state on a surface, not by words

### 8.2 The cheap-website tests (`LIVETAP_VISUAL_DIRECTION.md` §7)

- [ ] **1 · Text** No run of prose over two lines. Every string is a label, a status, a value, a control, a hint or an empty state
- [ ] **2 · Static** No full screen would survive unchanged as a JPEG, at any scroll position
- [ ] **3 · Feature list** Zero bulleted feature lists, zero three-up feature-card grids, zero icon-plus-heading-plus-text cards as structure, zero rectangles whose only job is to hold content
- [ ] **4 · Depth** Three independent planes visible at every scroll position, with contrast and scale falling off away from the stage; no plane that is a card on a background
- [ ] **5 · Demonstration** Every claim is demonstrated by an operable element within one screen of the claim
- [ ] **C · Category-defining** After the visit, the visitor can name an action **they performed** that no other site let them perform

### 8.3 Scroll Craft hard rules

- [ ] No clay diorama, no low-poly, no photographic ground, no generated world
- [ ] No scroll cue, arrow or animated mouse icon
- [ ] No `01 / 06` counters, no section numbers, no progress readout
- [ ] At most one eyebrow per three sections (this page has zero)
- [ ] **No em dash anywhere visible**
- [ ] Copy anchors vary: lead, trail, centre, split. Not centred in every act
- [ ] No device family twice in a row (`LIVETAP_SCROLL_STORY.md` §5.1)
- [ ] Zero `scrub` acts (the grammar bans it, and there is no video)
- [ ] No two adjacent acts carry the same feeling
- [ ] One peak, largest span by a visible margin (2.8 against 1.6), with silence in front of it
- [ ] Every act earns its span; total 12.8vh, inside 8 to 14
- [ ] Not 6 to 7 acts at 13.6 to 13.8vh
- [ ] The close resolves and holds. No fade to nothing, no footer that just begins
- [ ] One bespoke signature move, and it is the peak and the tell-someone sentence
- [ ] Fingerprint gate cleared (registry empty; row appended after shipping, §8.6)
- [ ] The engine is copied verbatim and never edited; all bespoke behaviour is page JS on `--sc-p` and `data-lt-*`
- [ ] No full-frame dark overlay. Every scrim is a **sibling** of its copy, never a `::before` on it
- [ ] No text baked into an image
- [ ] No invented statistics. Two counters, both computed from the visitor's own actions
- [ ] No `transition: all`; no animation of `width`, `height`, `top`, `left`, `margin`, `padding`
- [ ] No gradient text, no neon glow, no zero-offset coloured halo shadows
- [ ] No audio of any kind
- [ ] Step 5 run: `shoot.mjs` at desktop, mobile and reduced motion, and **the sheets read**

### 8.4 UI/UX Pro Max priorities

The skill's table is **1 to 10**, not 1 to 7; all ten are listed so nothing is dropped by an
off-by-three.

- [ ] **1 · Accessibility (critical)** Contrast ≥ 4.5:1 on the rendered page, real alt text, keyboard navigation everywhere, `aria-label` on every icon-only control. **Focus rings never removed**
- [ ] **2 · Touch and interaction (critical)** ≥ 44 × 44px, ≥ 8px spacing, visible feedback on every action. **No hover-only affordance**, and no instant-with-no-feedback state change
- [ ] **3 · Performance (high)** WebP, `loading="lazy"` below the fold, every box's space reserved, **CLS ≤ 0.02**, no layout thrashing
- [ ] **4 · Style selection (high)** The style matches the product type, it is consistent, and **icons are SVG, never emoji**
- [ ] **5 · Layout and responsive (high)** Mobile-first breakpoints at 640 and 1024, viewport meta present, **no horizontal page scroll at 375**, no fixed pixel page width, zoom not disabled
- [ ] **6 · Typography and colour (medium)** 16px base body, body line height 1.5 (this page uses the app's 24/16 = 1.5), **semantic colour tokens with no raw hex in components**, no body text under 12px, no grey-on-grey
- [ ] **7 · Animation (medium)** Context-aware timing rather than one duration for everything, motion that conveys meaning, spatial continuity, **no animation of width or height**, and `prefers-reduced-motion` honoured
- [ ] **8 · Forms and feedback (medium)** Visible labels (never placeholder-as-label), errors beside the field, helper text, progressive disclosure. Applies to the stream-key row and the chaos duplicates
- [ ] **9 · Navigation (high)** Predictable back behaviour, deep linking that works (`/app/start?intent=`), and no overloaded nav
- [ ] **10 · Charts and data (low)** Not applicable: the page has no chart. The health readout carries a word, never colour alone

### 8.5 Measurements

- [ ] LCP ≤ 1.8 s throttled, ≤ 1.2 s on cable
- [ ] CLS ≤ 0.02
- [ ] INP ≤ 200 ms at p75
- [ ] `/` JS ≤ 60 KB gz, split per `LIVETAP_MOTION_SYSTEM.md` §6.1
- [ ] No frame over 16.7 ms in the scroll-linked work, at 1440 and 390
- [ ] No memory growth after 5 minutes idle
- [ ] Zero console errors, zero failed requests (a 404 on the font degrades silently and looks fine)
- [ ] Atmosphere canvas under 2 ms per frame, or the §6.4 reduction applied
- [ ] **Read the sheet:** the peak is the largest visual change and holds the most scroll room
- [ ] **Read the sheet:** REST B reads quieter than ACT 6
- [ ] **Read the sheet:** the last screen stands still with content on it
- [ ] The feel check run cold, and the intended-versus-felt curve diff reported

### 8.6 After shipping

- [ ] Append the row in `LIVETAP_SCROLL_STORY.md` §8.1 to `scrollcraft/FINGERPRINTS.md`, filling every
      column, and add the seven "what is taken" bullets from §8.2. Rows are append-only; never edit one
      to make room for a later build.
