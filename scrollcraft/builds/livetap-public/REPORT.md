# REPORT: livetap-public, revision 3 (2026-09-14, the full Scroll Craft pass)

Local: `cd apps/web && npx vite build && PORT=4174 node scripts/preview-server.mjs` then http://localhost:4174. Production: https://livetap.vercel.app.

**Brief:** self-authored, not interviewed. The owner asked for the full skill to run without being blocked ("do not stop until scroll craft is complete and do not block it from changing anything"), after saying "the spacing and flow seems off". The eight answers from the first brief still hold; the revision-3 section of `BRIEF.md` records the owner's words, the revised journey, the feeling curve and the peak.

## Grammar, and why the other seven lost

**Live surface**, kept. The page is the product's own console running real state on labelled sample data, and "watch what it does" is still the honest pitch. Filmic one-shot: the argument is not linear and the visitor has to operate things, not be carried. Chaptered editorial: nothing here is read, everything is done. Continuous world: there is no geography. Typographic poster: the picture is the asset, not a sentence. Gallery: six looks are a range but the page is an argument with a peak, not a collection. Split stage: OBS-versus-LIVETAP is one chapter, not the whole page, and the divider would have nothing to do for six others. Rhythmic cutlist: the peak needs a held pin and a drag, which the cutlist bans.

## What was wrong, in the skill's own terms

Revision 2 (the audit closure) had one `pin` device eight times and one fixed band layer switched by a scroll listener. Five sections that behave identically are one section shown five times; eight were eight. Spacing had no rhythm because every chapter had the same geometry, and flow had no shape because nothing on the page arrived with scroll.

## The signature move

Kept: drag a `LIVE` destination off the stage with the pointer (or press one band button, or Delete on a focused tile); its path strains and snaps, it counts down and heals, and no sibling flickers. Second on the page, one tap from the top.

## Fingerprint gate

This is a revision of the one build in the registry, at the same URL, so its row is updated in place rather than gated against itself (see the registry's own note). Against a hypothetical second build the shape it now occupies is: Live surface / app chrome / fixed console with real footage and a greeting statement band / pin, rest, pin (peak), pin + iris, pan lane, pin + count, flow + in, pin + up wipe, rest, pin + tilt at 12.6vh / first-run question with tilting chips / drag-to-break.

## Journey and feeling curve

Recognition, dread then trust (peak), surprise, breadth, pride, clarity, respect, readiness. One line per act with its cause is in `BRIEF.md` (revision 3).

## Score

| Beat | Act | Device | Span | Why this one |
|---|---|---|---|---|
| Recognition | Hero | `pin`, greet cue | 1.3 | The console is already running a picture; the statement greets at progress zero and hands over at 4.2 s |
| held breath | rest A | `flow`, silence | 0.25 | The console alone before the peak |
| Dread, trust | Break it | `pin` + pointer drag | 2.8 | The largest span by a visible margin; the visitor causes the failure and watches it survive |
| Surprise | Shapes | `reveal` (iris, once) | 1.4 | The legend irises open; a change of state for a chapter about the picture changing state |
| Breadth | Moments | `pan` | 1.8 | Six looks travel sideways, each a live thumbnail of that look; lateral reads as range |
| Pride | Outputs | `count` | 1.4 | The visitor's own numbers land: destinations and shapes, re-targeted from real picks |
| Clarity | Versus | `flow` + `in` | 0.9 | Administrative content at short stagger, not a pin with dwell |
| Respect | Pro | `reveal` (up) | 1.2 | The control wipes up; Pro opens underneath without moving anything learned |
| settling | rest B | `flow`, silence | 0.25 | The console alone before the question |
| Readiness | Make | `pin` + `tilt`, greet-and-hold | 1.3 | The first-run question; chips lean to the pointer; it holds |

Seven device families, no family twice in a row, one iris, one pan, two real counters, 12.6 viewport-heights (the harness measures 13.0 with its own rounding of the flow act). Not in the 6-to-7-acts-at-13.6-to-13.8 band.

Bands live inside their own acts again, with cues that open at 0.02 and close at 0.95 of the chapter's travel, so copy is never on screen while a stage slides through a seam (the audit's "narration clipped at the top edge" was copy that stayed lit through the exit slide). Anchors: lead, lead, trail, rail, panel, panel, lead, centred. The two tall panels keep their ground on the band and carry the cue on an inner block, because the harness hides cued copy to measure what is under it.

## Assets

Nothing generated this pass (no key set, none needed). The creator and guest clips and the screen asset from revision 2 are reused; the Moments lane composes each look's thumbnail from the same footage through `picture.compose()`.

## Verified

- Harness, desktop 1440x900 after the fixes: 13.0 viewport-heights, `pin > flow > pin > pin > pan > pin > flow > pin > flow > pin`, no dead scroll, every cue clears 4.5:1 at its worst frame (`lab/r4-desk/`). Two earlier desktop passes failed contrast on the two tall panels at 1.11:1 because the panel ground was on the cued element; fixed by moving the cue inward.
- Harness, mobile 390x844 and reduced motion: no dead scroll, every cue clears 4.5:1 at its worst frame on both (`lab/r4-mobile/`, `lab/r4-reduced/`). Under reduced motion the lane is a native sideways scroll region and the videos hold their posters.
- The pan lane measured by hand: 702 px of overflow at 1440, 1254 px at 390. The first build of the lane measured minus 966 px because the class name `ltp-rail` collided with the app's own left rail in `landing.css`; renamed to `ltp-lane`.
- Feel check, cold, on `lab/r4-desk/sheet.png`: recognition, waiting (too long), dread and trust (the band; the break itself needs the visitor), surprise, breadth, pride, clarity, respect, settling, readiness. Diff against the brief: the pre-peak silence read as waiting rather than a held breath, so both rests went from 0.4 to 0.25 viewport-heights. Everything else matched.
- The peak on the sheet: the break chapter holds the most scroll room, and its band is the loudest on the page, but the largest VISUAL change on a harness sheet is the Moments lane and the Outputs panel, because the peak's change (a tile snapping off and healing) only happens when a visitor acts. That is the honest limit of a static sheet for an interactive peak; the E2E suite performs the drag and asserts the change.
- The end resolves and holds: the last frames carry the question, the chips, the way in and the footer.

## Not verified

- The owner's own browser (its extension could not be scripted on any page on this host).
- A real device's frame cost for the pan lane and the six live thumbnails.
