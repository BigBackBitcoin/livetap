# REPORT: livetap-public

**Built** 2026-09-12 · **Rebuilt** 2026-09-14, after an independent audit · **Grammar** Live surface
**Page** `/` in `apps/web`
**Local URL** `http://localhost:4173/` (the real Vite production build)
**Brief** `BRIEF.md`, self-authored, not interviewed, plus
`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md` and its closure matrix, which is the newer and more
specific source wherever the two disagree.

**Revision note.** The build this report first described shipped, and a first-time-creator audit of
the deployed page scored it 59/150. Its browser (Windows, Chrome, `prefers-reduced-motion: reduce`)
had a jammed main thread: every eval into the tab timed out, the wheel did nothing over 95% of the
page, an intro collage never cleared and covered the headline for the auditor's full eighteen-second
wait, and controls "refused" clicks because their handlers never got a turn to run
(`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md` §0). The page was rebuilt to close every
actionable finding, and this report now describes that rebuild. Sections below that are unchanged from
the first build say so; sections that changed are rewritten in full rather than patched around the
edges.

---

## 1. The grammar, and why the other seven lost

**Live surface.** Unchanged. The page behaves like the product, running, with scroll driving its
state. It is the only grammar whose close is an input and whose nav is the product's own chrome, which
is the only way to carry the brief's answer to question 5: *the visitor should feel like they are using
LIVETAP*.

| Grammar | Why it lost |
|---|---|
| **Filmic one-shot** | Forbids any chrome that implies the page is a tool, which is the one thing this page must imply. |
| **Chaptered editorial** | Turns a demonstration into a read. |
| **Continuous world** | Requires worldflight and real geography LIVETAP has none of. |
| **Typographic poster** | Bans the product from the frame, when the product is the picture. |
| **Gallery / catalog** | Labels objects instead of operating them. |
| **Split stage** | Needs a permanent divider for an argument this page does not have. |
| **Rhythmic cutlist** | Bans `pin`, so the peak could not hold still while the visitor drags a tile. |

Nav, hero and close still follow from the grammar, but the hero itself changed completely: it is no
longer the chaos lattice over an automatic seventeen-step story. It is a real product statement over a
real picture, with a 4.2-second guided demo that hands over fast (§4, and
`LIVETAP_SCROLL_STORY.md` §2.2).

---

## 2. The signature move, as implemented

**Drag a LIVE destination off the stage. Its connection path strains and snaps, it counts down, it
heals, and no sibling flickers.** The mechanics are unchanged from the first build and were never
implicated in the audit's findings, because a drag is pointer-driven and runs off the scroll thread.
**One addition in this revision:** a one-tap band button, "Go live, then break YouTube" (or "Break
{name} for me" once something is live), that fires the identical state machine without requiring the
visitor to find the grip, the fastest way to feel the peak on the whole page.

| Part | How it works |
|---|---|
| **Invitation** | Only while the peak act is on screen, and only on a `LIVE` tile, a 44×44px grip appears with a line reading "Drag me off the stage." |
| **Grab / Drag / Tension** | `createDraggable(tile, { trigger: grip, container: surface, containerFriction: 0.35, dragSpeed: 0.92, releaseEase: spring({ stiffness: 150, damping: 18 }) })`, unchanged. |
| **Break** | Fires the first time tension reaches 1, while the tile is still held. |
| **What snaps** | The path is cut and recoils; the tile settles at the `DEGRADED` tint; the chip goes `LIVE` → `DEGRADED` (700ms) → `RECONNECTING` with "Attempt 1 of 10, retrying in 4 s" and a counting ring. |
| **Under the threshold** | Anime's own release spring carries the tile home; nothing changes. |
| **Keyboard** | `Delete` / `Backspace`, or arrow nudges that raise tension incrementally over seven presses. |
| **Touch** | The same grip, the same threshold scaled by viewport width. |
| **Reduced motion** | `createDraggable` is never constructed. The one-tap CTA, `Delete`, and the tile's own drop control fire the same break. |
| **Siblings** | Nothing in the sequence repaints anything but the broken tile, sampled and asserted by `apps/web/e2e/experience.spec.ts`. |

---

## 3. The fingerprint gate

**The registry at `scrollcraft/FINGERPRINTS.md` already carries the `livetap-public` row**, from the
first build. Because this is a revision of the same page, not a new build under a new name, the row is
**updated in place** rather than appended a second time, the append-only rule protects distinct builds
from losing their history, and this build's history is one row, revised.

What changed in the row: the hero device (a real picture from first paint, not a lattice), the
act-sequence shape (8 acts plus **one** rest at 12.4vh, peak at 2.4 and positioned **second**, not 8
plus two rests at 12.8vh with the peak at 2.8 sixth), and the world description (real sample footage,
not "drawn signal field, no photography"). What did not change: Live surface as the grammar, app chrome
as the nav treatment, a real first-run question as the close, and drag-to-break as the signature move.

---

## 4. The score

Total **12.4 viewport-heights** across **8 acts plus 1 declared rest**, inside the 8-to-14 budget.

| # | Chapter | `data-sc-act` | Span | What is on screen |
|---|---|---|---|---|
| 1 | **HERO** | `pin` | **1.2** | The product statement, the lede, a real picture already on the stage, the 4.2s guided demo |
| · | REST | `flow` | 0.4 | Authored silence, directly in front of the peak |
| 2 | **BREAK IT** | `pin` | **2.4** | The peak. One tap, a drag, or `Delete`. |
| 3 | **SHAPES** | `pin` | **1.4** | The mirrored 16:9/9:16/1:1 control, chat/button safe zones drawn on the picture |
| 4 | **MOMENTS** | `pin` | **1.4** | The mirrored six-Moment strip |
| 5 | **OUTPUTS** | `pin` | **1.4** | Six live canvases, one production, six shapes and ceilings |
| 6 | **VERSUS** | `pin` | **1.6** | "Instead of OBS.", two playable lanes, four competitor lines |
| 7 | **PRO** | `pin` | **1.2** | The mirrored Simple/Pro control, four panels |
| 8 | **MAKE** | `pin` | **1.4** | "What are you making?", six intent chips, the toolbar, the footer |

Every act is `pin`; there is no other device on the page. This is the single largest divergence from
the first build's score, which used nine device families (`pin`, `pan`, `reveal`, `count`, `parallax`,
bespoke pointer, `drift`, `flow`+`in`, pointer `tilt`) across eight acts and two rests. §7 below
explains why that variety was traded away, and it was traded on purpose: the audit's root cause was
that variety, not a lack of it.

**The peak is 2.4 against a next-largest of 1.6 (VERSUS), a 1.5× margin**, and it is now the **second**
act on the page rather than the sixth, a cold open, directly addressing the audit's *"failure demo
buried two-thirds down… move it much higher."*

---

## 5. The feel check

Read once in order, one word per act, against the rebuilt page. This is explicitly **not** a cold pass:
the rebuild was iterated against the same audit findings more than once, and that is stated per
`feel.md` rather than hidden.

| Act | Intended | Felt | Note |
|---|---|---|---|
| HERO | recognition | **recognition** | The picture and the statement are both on screen at once; nothing covers either. |
| REST | stillness | **stillness** | Matches. |
| BREAK IT | dread, then trust | **dread, then trust** | Still the largest visual change on the sheet, and now the second thing a visitor sees rather than something they had to scroll two-thirds down to find. |
| SHAPES | clarity | **clarity** | The mirrored control removes the old "the control that causes this lives elsewhere" complaint the first build's feel check recorded. |
| MOMENTS | competence | **competence** | Matches. |
| OUTPUTS | pride | **pride** | New chapter; the six canvases read as the promised "one production, six correct pictures" rather than a sentence about it. |
| VERSUS | conviction | **conviction** | New chapter; naming OBS and three competitors by name lands as intended. |
| PRO | respect | **respect, once used** | Same caveat the first build's check recorded: a visitor who never touches the toggle never sees the depth the act is about. Still true, still the design's own instruction ("one toggle"). |
| MAKE | readiness | **readiness** | Matches. The footer is inside the stage; the last screen holds. |

**Does the peak read as the peak?** Yes, and more so than before, it is now encountered early, with
almost nothing competing for the visitor's attention ahead of it.
**Is there silence in front of it?** Yes, the page's one rest.
**Does the end resolve?** Yes.

---

## 6. Measured sizes

Approximate figures for the current build. Re-measure with `vite build --reportCompressedSize` before
citing these in a release note.

| Item | Approximate size (gz) | Budget |
|---|---|---|
| The public page's own JS (engine + Anime.js + page logic, including the new picture/outputs/versus modules) | **~53 KB** | 60 KB |
| The public page's CSS (design system + `landing.css` + `acts.css`) | **~15 KB** | 20 KB |
| Video and image assets (`creator.*`, `guest.*`, `screen.svg`) | **~360 KB total**, format-negotiated so a visitor downloads one video variant per clip | (no fixed budget) |
| `archivo-latin.woff2` | **~29 KB** | one font file |

**JavaScript on `/` stays inside its 60 KB budget even though this build carries real logic the first
version did not plan for**, the picture/compose engine, the six output canvases, the two playable
Versus lanes, because it spends almost nothing on choreography: no chaos collapse, no atmosphere
canvas, no `pan`/`reveal`/`count`/`parallax`/`tilt` devices.

---

## 7. What the audit found, and what changed because of it

`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT.md` (score 59/150) and its closure matrix are the record of
this revision's findings; they are not repeated in full here. In outline, the findings that changed the
page most:

1. **The main thread was jammed.** Root cause of nearly everything else (§0 above). Fixed by removing
   the chaos lattice, the atmosphere canvas, the grain layer and every per-act Scroll Craft device
   except `pin`, and by replacing per-act cue copy with one fixed band layer switched by a single
   passive scroll listener (`LIVETAP_MOTION_SYSTEM.md` §2.2).
2. **The stage was an empty rectangle.** Fixed by `picture.ts`: a real sample clip plays from first
   paint, "Use my camera" is real and local-only, and every output and thumbnail is a re-crop of the
   same composition.
3. **The failure demo was buried two-thirds down.** Fixed by moving BREAK IT to the second position on
   the page, right after the hero, with a one-tap alternative to finding the drag grip.
4. **No product statement, and no comparison to OBS.** Fixed by the hero's product statement and lede,
   and by the new VERSUS chapter naming OBS, Restream, StreamYard, Streamlabs and Riverside by name.
5. **GO LIVE and Screen Share failed silently.** Fixed: GO LIVE now always works, connecting suggested
   destinations if none are ready; Screen Share switches the screen input on instead of refusing.
6. **The close was a generic six-card bullet grid, and Download pointed at nothing.** Fixed: the six
   intent chips are operable controls that re-compose the stage, and the Download link is gone in
   favour of an honest "no build exists yet" footer and a GitHub watch path.

`docs/qa/LIVETAP_FIRST_TIME_CREATOR_AUDIT_CLOSURE.md` carries the full P0/P1 table with evidence for
each item; every row is CLOSED against the deployed experience, not a unit test in isolation.

---

## 8. What was verified, and how

| Verified | Method |
|---|---|
| The guided demo reaches three destinations at `READY` (two on phones) in 4.2s, then hands over and never goes live by itself | E2E |
| GO LIVE with nothing connected still succeeds, by connecting the intent's suggested destinations first | E2E |
| A tapped destination signs in, turns `Ready`, and draws its own path | E2E |
| The shape control physically re-flows the stage, mirrored identically in the toolbar and in the SHAPES band | E2E |
| A Moment recomposes the stage and the frame does not move; Screen Share switches the screen input on | E2E |
| Six output canvases render the same composition, each in its own platform's shape with its own ceiling | E2E |
| Both VERSUS lanes play, and playing the LIVETAP lane moves the real surface | E2E |
| Pro adds panels and the stage's box is identical before and after | E2E |
| The close carries the chosen intent into `./app/start?intent=` | E2E |
| The drag, the one-tap CTA and `Delete` all put exactly one tile into `RECONNECTING` while the others stay `LIVE`, then all are `LIVE` again, with every sibling property sampled | E2E |
| Reduced motion: no grip, no positional animation, `DEGRADED` skipped, identical information | E2E with `reducedMotion: 'reduce'` |
| No horizontal overflow at 375, 834 and 1440 | E2E |
| Every interactive element is at least 44 × 44px | E2E |
| The copied constants match `packages/core` and `packages/adapters` | unit test |
| No raw hex, no em dash in copy, no banned device, no emoji | unit tests |
| Fewer than three long tasks in six idle seconds, 40+ fps | `audit-closure.spec.ts`, the audit's own gate |
| Gzipped transfer sizes | `vite build --reportCompressedSize` |

### What was not verified

- **No throttled LCP, CLS or INP trace captured at authoring time for this revision.** The structural
  work and the long-task gate are both real measurements; a full Core Web Vitals trace on the rebuilt
  page is still owed.
- **No Windows High Contrast pass on this revision.** The forced-colours rules are unchanged and were
  verified once against the first build; they were not re-verified after the rebuild.
- **No real handset.** Verified at 390×844 and 375×812 in Chrome's device emulation.
- **The reduced-motion "read once at load" gap is a known, unclosed item.** A visitor who toggles their
  OS-level reduce-motion setting mid-visit does not see the page change until they reload
  (`LIVETAP_MOTION_SYSTEM.md` §5). Recorded rather than fixed in this revision.

---

## 9. Assets

New in this revision: `creator.mp4` / `creator.webm` / `creator.webp` (the stage's real picture from
first paint), `guest.mp4` / `guest.webm` / `guest.webp` (the Guest Moment), and `screen.svg` (Screen
Share), all generated content checked into the repository rather than fetched at request time. The
LIVETAP mark (inline SVG, ripples never animated here) and `archivo-latin.woff2` (self-hosted, subset,
`font-display: swap`) are unchanged from the first build. `hero-a.webp`, the first build's stage plate,
is now used only as the apple-touch-icon and the Open Graph image. The product is the picture, and for
the first time, the page actually has one.
