# LIVETAP — FRICTION BENCHMARK

**Measured:** 2026-09-11, §6 re-measured 2026-09-12 · **Surface:** `apps/web` (mock mode, Chromium,
production build served by `apps/web/scripts/preview-server.mjs`, which applies the host's own route
rewrites and returns a real 404 for an unmatched path)
**How to reproduce:** `npm run e2e -w @livetap/web` — every LIVETAP number below is asserted by a test, not estimated by a person.

---

## 1. Why this document exists

The north-star correction (`docs/prompt-pack/09_LIVETAP_NORTH_STAR_CORRECTION.md` §11) asks for measurement
rather than feature count: *time to first successful stream, configuration decisions, clicks, terminology
exposure, failure recovery, multistream setup complexity.* This file records those numbers for LIVETAP,
next to what the research says about the incumbent, so the claim "easier" is falsifiable.

If a change makes any LIVETAP number worse, the golden-path E2E fails and this file is out of date.

---

## 2. The LIVETAP numbers (measured)

| Measure | LIVETAP | Where it is measured |
|---|---|---|
| **Taps from the app's first screen to LIVE** | **6** | `e2e/golden-path.spec.ts` — `Taps` counts every click and asserts `≤ 6` |
| **Taps to a two-platform multistream** (the same 6) | **6** | same test: YouTube **and** TikTok both reach `LIVE` |
| **Screens seen between launch and on air** | **4** (intent → destinations → camera+setup → Studio) | same test, 5 DOM captures (Studio counted idle and live) |
| **Questions the user is asked** | **2** ("What are you making?", "Where are you going live?") | the device step confirms, it does not interrogate |
| **Settings screens opened before going live** | **0** | Settings is not on the path |
| **Protocol / broadcasting words shown in Simple mode** | **0** | golden-path test scans the rendered DOM of every screen on the path for `/rtmp\|bitrate\|codec\|keyframe\|scene\|source/i` |
| **Values the user must choose (resolution, fps, encoder, rate control, keyframe interval)** | **0** — all derived by `buildAutomaticProduction` | `src/__tests__/store.test.ts`, "builds the automatic production" |
| **Formats produced from one production** | **2** for YouTube + TikTok (16:9 and 9:16), automatically | golden-path asserts `YouTube 16:9` and `TikTok 9:16` on the setup screen |
| **Actions to recover one dropped destination** | **0** (automatic; the reconnect is LIVETAP's, not the user's) | `e2e/failure-isolation.spec.ts` |
| **Other destinations affected by one failing** | **0** | same test watches YouTube stay `LIVE` throughout TikTok's drop and return |
| **Error messages without a stated cause and a next step** | **0** | the failure-isolation test asserts WHAT, WHY, DOING and YOU CAN are all present, with exactly one primary action |
| **Static guard on Simple-mode copy** | passes | `src/__tests__/no-obs-words.test.ts` scans every UI string literal outside `screens/pro/` |

The six taps are, in order: **Talking → YouTube → TikTok → Continue → Open Studio → GO LIVE.**
The three-second countdown after the sixth tap is a wait, not a tap, and it is cancellable.

One note on the failure numbers, so they are not read as faster than they are. The **demo** drop is
scripted to stay down for about **4 seconds** before it recovers, not the 1.3 seconds it used to: the
card that drop exists to demonstrate cannot be read in 1.3 seconds (PRODUCT_REVIEW §4 P2-11). The
timing is set in `apps/web/src/state/store.ts` for the demo path only, by widening the reconnect
policy for the single turn in which the orchestrator schedules the retry. A real drop still uses the
real policy — 1 s, doubling, ±20% jitter, 10 attempts — and the user still takes **0** actions either
way.

---

## 3. The OBS baseline (cited)

`docs/research/SWITCHING_TRIGGERS.md` has no §7 — its sections are §0, §1 and then the ranked triggers
**T1–T10**. The first-run evidence is **T6**, and the multistream evidence is **T1**; both are used here,
with `COMPETITOR_FAILURE_DATABASE_A.md` for the settings-first findings.

| Measure | OBS Studio | Source |
|---|---|---|
| Concepts named before a first stream | **14** (Auto-Configuration Wizard, Scene, Source, Display Capture, Window Capture, macOS Screen Capture, Game Capture, Video Capture, Sources Dock, Audio Mixer, Settings→Audio, Settings→Output, Controls Dock, Start Streaming) | SWITCHING_TRIGGERS.md **T6**, quoting the OBS Quick Start Guide |
| Localised UI strings in the front-end | **1,443**, of which **135** are under `Basic.Settings.Output` alone, 51 under `Advanced`, 41 under `Stream`, 33 under `Audio` | SWITCHING_TRIGGERS.md **T6** |
| What the first question is used for | Intent *is* asked — and consumed to pick encoder settings, never to produce a scene. The user still starts with an empty canvas. | SWITCHING_TRIGGERS.md **T6** |
| What the guide says to do before going live | "strongly encourage[s] running a test for a few minutes… rather than just jumping in to your first stream" | SWITCHING_TRIGGERS.md **T6**, quoting the OBS Quick Start Guide |
| Multistreaming | **Not in the product.** One RTMP destination per profile; a second platform needs a third-party plugin. `obs-multi-rtmp`: **2,888,784 downloads**, 4.07★ from 84 ratings, documentation in Japanese, and a documented fix that involves editing `global.ini` by hand | SWITCHING_TRIGGERS.md **T1** |
| Multistream start semantics with the commercial plugin | Reported as **one click per destination**: *"It's not true multistream if you have to click every damned time"* | SWITCHING_TRIGGERS.md **T1**, Aitum Multistream reviews |
| Error vocabulary on a failed destination | *"Failed to connect to server"* — one string across four different user actions; *"Encoding overloaded! Consider turning down video settings."* | COMPETITOR_FAILURE_DATABASE_A.md §1.5, §5.1 |
| Diagnosis path | Export a log file and paste its URL into a separate web analyzer | COMPETITOR_FAILURE_DATABASE_A.md §1.4, §5.5 |
| Demand proxy for "how do I do this" | A single beginner tutorial at **1,558,364 views**; settings guides at 997,308 and 786,043 | SWITCHING_TRIGGERS.md **T6** |

A tap-for-tap count for OBS is deliberately **not** asserted here. The research does not contain an
instrumented click count, and inventing one would be exactly the kind of number this project refuses to
publish. The honest comparison is the one above: LIVETAP asks 2 questions and shows 0 broadcasting terms
before air; the incumbent names 14 concepts, ships 1,443 strings, and cannot multistream without a plugin.

---

## 4. Side by side

| | LIVETAP (measured) | OBS Studio (cited) |
|---|---|---|
| Taps to LIVE on one platform | 6 | not instrumented; 14 concepts named first |
| Taps to LIVE on **two** platforms at once | **6 — the same six** | plugin install, then per-destination start clicks |
| Broadcasting terms before air | **0** | 14 concepts, 135 output settings |
| Encoder decisions before air | **0** | rate control, CBR/VBR, keyframe interval, preset |
| One destination fails mid-stream | that destination reconnects; the rest never notice | *"Failed to connect to server"* |
| Where you diagnose | in the app, while it is wrong | export a log, open a second website |

---

## 5. What this benchmark does not yet measure

Named so nobody mistakes silence for a passing grade:

1. **Wall-clock time to first stream.** The E2E measures taps, not seconds, and a synthetic click is faster
   than a person reading. Needs a moderated first-run study with real creators.
2. **Time to first stream on a real platform.** Every number here is mock mode. The OAuth path is built
   (`api/oauth/*`, `/oauth/callback`) but no deployment with real credentials has been measured.
3. **Recovery time in the field.** Failure isolation is measured against a scripted engine event, which is
   the same event a real drop raises — but not against a real network.
4. **The desktop and mobile shells.** Both are other teams' surfaces and are not in these numbers.
5. **A real OBS tap count.** Would need an instrumented session on a clean machine; worth doing, and worth
   doing honestly, before the comparison is used in marketing.

---

## 6. Bundle and build (re-measured 2026-09-12, production build)

**How to reproduce:** `npm run build:web`, then gzip each emitted file at level 9. The numbers below
are files on disk, not estimates, and the resource lists are the ones Chromium actually requested
(recorded with `page.on('response')` against the production build served by
`apps/web/scripts/preview-server.mjs`).

### `/` — the marketing page

| Artefact | Raw | Gzipped |
|---|---|---|
| `index.html` (the whole page: copy, both diagrams, inline SVG marks) | 24.0 KB | **5.4 KB** |
| `landing-*.css` (the design system: tokens, resets, components, landing layout) | 38.2 KB | **7.1 KB** |
| `theme.js` (carries a theme chosen inside the app; the page's only script) | 1.1 KB | **0.6 KB** |
| **Total** | **63.3 KB** | **13.0 KB** |
| — of which **JavaScript** | 1.1 KB | **0.6 KB** |

**Budget: 60 KB gzipped. Measured: 13.0 KB. Met, with the hero image excluded as before.**

The open issue in the previous revision of this section is closed, and it was closed the way that
section said it would have to be: the marketing page renders as static HTML with no framework.
React 19's DOM renderer is 69.2 KB gzipped on its own, so no React page could ever have met a
60 KB budget however well the rest of it was split — the previous measurement was 90.5 KB, of which
69.2 KB was the renderer and 7.0 KB was LIVETAP's own landing code. The page now ships **0.6 KB** of
JavaScript, which exists only so that a visitor who chose light or dark inside the app is not shown
the other one when they come back to `/`.

Nothing about the page's content changed to get there: same copy, same structure, same hero image,
same honest demo statement, same single accent CTA, same footer links, same skip link and
accessible diagram description. What changed is that `/` is its own document
(`apps/web/index.html`) and the application moved to `apps/web/app.html`, built as two Vite
entries. `e2e/landing-and-layout.spec.ts` asserts the page ships exactly one script, that the
script is not a module and not inline, and that the page's text is present in the served HTML
rather than produced by a renderer — so this number cannot quietly regress.

### `/app/*` — the application

| Artefact | Raw | Gzipped |
|---|---|---|
| Studio, reached by the golden path (25 chunks) | 459.7 KB | **150.1 KB** |
| Studio, loaded directly (the same, without the onboarding chunk) | ~452.5 KB | **~147.3 KB** |
| — of which React 19 | 218.0 KB | 67.4 KB |
| — of which the router | 39.4 KB | 14.1 KB |
| — of which `livetap-engine` (core, adapters, media) | 127.4 KB | 39.7 KB |
| — of which LIVETAP's own screens, store and design system | — | 29.0 KB |
| `app-*.css` (the whole application) | 51.4 KB | **9.0 KB** |
| `app.html`, and `404.html` copied from it | 2.0 KB | 1.0 KB |

The code-splitting goal still holds and is now absolute rather than nearly so: the marketing page
downloads **none** of the orchestrator, the adapters, the media engine, the router or React,
because it cannot — they are in the other document.

### The 404

`dist/404.html` is a copy of `app.html`, written by a plugin in `apps/web/vite.config.ts` after
every build. Vercel serves a `404.html` from the output directory with a real 404 status for any
path that matches neither a file nor a rewrite, and the rewrites are now a list of the
application's own route prefixes (`/app`, `/oauth`, `/privacy`, `/terms`) rather than a catch-all.
So `/nope-not-a-page` returns **404** and renders the routed not-found screen, where it used to
return 200 (PRODUCT_REVIEW §4 P2-9). The E2E asserts the status code, and asserts that each
application prefix still returns 200.
