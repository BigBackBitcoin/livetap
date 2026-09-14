# BRIEF — LIVETAP public experience

Self-authored, not interviewed. The human is unreachable in this autonomous run; the eight answers below are transcribed from the owner's written directive ("EMERGENCY UX / INTERACTIVE EXPERIENCE REDESIGN", 2026-09-12) and the north-star correction (docs/prompt-pack/09), in the owner's own words wherever they exist.

## The eight answers

1. **Vibe (3–5 words + references):** "Cinematic live control environment." Restraint, hierarchy, confidence, focus. References from other media: a broadcast truck's program monitor wall at night; a mission-control console where every light means one thing; the calm of a well-run live show's talkback. Explicitly NOT: gaming PC, RGB, neon, purple AI gradients, a SaaS template, an Apple imitation.

2. **The scroll journey, in their words:**
   ACT 1 CHAOS — "Multiple platforms. Multiple windows. Multiple controls. Multiple workflows. 'Why is going live this complicated?' Then collapse the chaos into LIVETAP."
   ACT 2 CONNECT — "Destinations appear. The user selects platforms. Connections animate into the LIVETAP system."
   ACT 3 PRODUCE — "Camera. Screen. Mic. Guest. Media. Moments. The production environment assembles."
   ACT 4 ADAPT — "The same live production intelligently transforms into 16:9, 9:16, 1:1."
   ACT 5 MULTISTREAM — "Multiple destinations become LIVE. The system feels like one coordinated broadcast."
   ACT 6 RESILIENCE — "One destination fails. The rest continue. The failed destination reconnects."
   ACT 7 POWER — "The simple interface expands into Pro Mode. The visitor discovers the depth underneath."
   ACT 8 ACTION — "Only after the visitor has experienced LIVETAP: DOWNLOAD, TRY DEMO, GITHUB."

3. **Energy curve:** loud and cluttered at the open (chaos), a sharp drop to calm when the chaos collapses into one surface, steadily rising through connect and produce, a held breath at adapt, full brightness at multistream, a jolt at the failure, calm confidence at the reconnect, a quiet widening at pro mode, resolved and still at the close.

4. **Feeling, stage by stage, and the ONE moment:**
   Chaos: recognition ("that is my Tuesday"). Collapse: relief. Connect: agency (I did that). Produce: competence. Adapt: surprise (it reframed itself). Multistream: pride (all of them, at once, from me). Failure: a beat of dread. Recovery: trust. Power: respect. Action: readiness.
   **The one moment:** the visitor drags a live destination off the stage with their own pointer, its connection path snaps, the other destinations keep pulsing LIVE, and LIVETAP pulls it back in with a countdown. They caused the failure and watched it survive.

5. **One thing no site they have seen does:** "The visitor should feel like they are using LIVETAP." Direct manipulation of a live broadcast's failure: you can break it yourself and it recovers in front of you, without the other platforms noticing.

6. **Distance from premium-minimal:** premium-minimal at the surface, with one deliberate exception: the chaos act is intentionally dense and overlapping (many windows), because the collapse only lands if the chaos was real. Everything after the collapse is restrained. "The site should still look premium if most color is removed."

7. **One unbroken world or distinct scenes:** one persistent surface (the LIVETAP production stage) that stays on screen the whole way and changes state act by act. Not a camera flight, not chapters: the same console, operated. The chaos prologue is the only thing that is not the surface, and it collapses INTO it.

8. **Assets they already have:** the product itself (the React studio, design tokens in packages/ui, the mock engine that computes real state), the LIVETAP mark (SVG in DESIGN_SYSTEM §1.2), one generated hero plate (apps/web/public/brand/hero-a.webp, dot-and-ripple). No footage. No photography needed: the grammar forbids it and the product is the picture.

## Feeling curve (one line per act)

| Act | Feeling | What on screen causes it |
|---|---|---|
| 1 Chaos | recognition, then relief | six overlapping fake windows (stream key dialogs, a mixer, three browser tabs, a bitrate field) jitter as you scroll; at the act's end they slide into one calm surface and the LIVETAP stage remains |
| 2 Connect | agency | six destination tiles orbit the stage; you tap them; each draws a signal path into the stage and turns READY; the ones you did not tap stay dim |
| 3 Produce | competence | camera, mic and screen tiles switch on in sequence; the Moment strip appears; picking a Moment re-composes the stage in place |
| 4 Adapt | surprise | the stage physically re-flows into 9:16 and 1:1 on your tap: the camera re-frames, text moves into safe areas, the per-destination format labels update |
| 5 Multistream | pride | GO LIVE, a 3-2-1 countdown you can cancel, then every path lights and every tile turns LIVE together; chat begins with platform badges |
| 6 Resilience (PEAK) | dread, then trust | drag one LIVE tile away from the stage: its path snaps, it goes DEGRADED then RECONNECTING with a visible countdown, the others never flicker, then it snaps back LIVE |
| 7 Power | respect | one toggle: the same surface gains a Pro layer (encoder, per-format bitrate, audio routing, diagnostics) sliding in behind, without moving anything the visitor already learned |
| 8 Action | readiness | the stage settles into the real onboarding's first question, "What are you making?", with the intent cards live; Download, GitHub and Try demo sit in the surface's own toolbar |

Authored silence: the beat between the chaos collapse and the first destination tap (one viewport, nothing moves until the visitor does), and the beat after the tile snaps back LIVE before Pro mode.

## The peak

Act 6. The sentence: "I dragged YouTube off the stream with my mouse and everything else stayed live, then it pulled itself back."

## Tell-someone sentence

"It's the site where you break your own live stream and watch it survive."

---

# Revision 3 brief (2026-09-14, after the audit closure): "the spacing and flow seem off"

Self-authored, not interviewed. The owner's words, verbatim: "Run the Full Scroll Craft skill/plugin please. do not stop until scroll craft is complete and do not block it from changing anything. its in our best interest to let the plugin fix us" and, before that, "the spacing and flow seems off". The eight answers above still hold; what changed is the structure the audit closure left behind: one `pin` device eight times and one fixed band that cross-fades, which is one section shown eight times. This revision keeps every audit guarantee (copy readable and inside the viewport, native scrolling, nothing goes live by itself, a real picture from first paint, no Download) and restores the score.

## Journey (revised beats)

1  Recognition   a real console, a real picture, my name for the thing in one sentence
2  Dread, trust  I break the stream myself and it survives (the peak, second on purpose)
3  Surprise      the picture re-frames itself into the shape each platform wants
4  Breadth       six looks travel past sideways, each one a picture, tap any
5  Pride         the numbers I made count up: destinations, shapes, one production
6  Clarity       the usual way beside this way, plainly, with measured numbers only
7  Respect       Pro wipes in underneath; nothing I learned moves
8  Readiness     the product's first question, answered on the stage, with the way in

## Feeling curve (revised, one line per act)

| Act | Feeling | What on screen causes it |
|---|---|---|
| 1 Hero (pin) | recognition, agency | statement and two buttons over a console already playing a picture; three tiles turn Ready in four seconds, then "Your turn" |
| rest A (flow, authored silence) | a held breath | only the console, ready, nothing moving until the visitor moves |
| 2 Break it (pin, PEAK) | dread, then trust | one tap or one drag snaps a live destination off; the card explains; the ring counts; it heals; the others never flicker |
| 3 Shapes (reveal) | surprise | the legend irises open; tapping 9:16 re-frames the picture with the chat zone drawn |
| 4 Moments (pan) | breadth | six Moment cards travel sideways under the wheel, each a live thumbnail of that look; tap any |
| 5 Outputs (count) | pride | "3 destinations, 2 shapes" counts up from zero on the visitor's own picks; six platform-shaped pictures |
| 6 Versus (flow + in) | clarity | the two lanes arrive staggered; play either; measured numbers only |
| 7 Pro (reveal) | respect | the Simple / Pro control wipes up; Pro opens four panels above the desk |
| rest B (flow, authored silence) | settling | the console alone, live or ready, before the question |
| 8 Make (pin + pointer) | readiness | the first-run question with six chips that tilt to the pointer and re-compose the stage; the way in holds |

Authored silence: rest A (0.25vh) before the peak and rest B (0.25vh) before the close (both were 0.4vh until the feel check read the pre-peak quiet as waiting); the seam between any two pinned chapters, where only the console is on screen, is the grammar's own beat and is not dead scroll (the console publishes `data-sc-verify-state`).

## The peak

Unchanged: act 2. "I dragged YouTube off the stream with my mouse and everything else stayed live, then it pulled itself back." Largest span on the page (2.8 against a next-largest of 1.8), a silence in front of it.

## Tell-someone sentence

"It's the site where you break your own live stream and watch it survive."
