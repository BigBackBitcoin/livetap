# LIVETAP FIRST-TIME CREATOR AUDIT - RETEST

**Retested:** 2026-09-14, against production https://livetap.vercel.app after the audit-closure rebuild (ADR-017).
**Persona:** streamer / content creator, no prior knowledge of LIVETAP, no source-code assumptions, no benefit of the doubt.
**Method:** the same 20 questions as the original audit, answered from the deployed page. Every claim below is backed by `docs/qa/deployed-review-2/review.json` (produced by `apps/web/scripts/review-audit.mjs` against production at eight viewports with real wheel, key and touch input), the screenshots in the same folder, and the E2E suite (`apps/web/e2e/audit-closure.spec.ts`, 28 tests, and `experience.spec.ts`, 35 tests; 88/88 green on the same build).
**Scoring honesty:** the retest scorer is the same builder that closed the audit, so the number is a self-assessment against the audit's own criteria. Where a criterion is subjective the score is capped at what the evidence shows, not at what was intended. An independent re-audit by the original auditor is the real acceptance test and is listed as the one remaining step.

## Original score and retest score

| Category | Original | Retest | What changed |
|---|---|---|---|
| First Impression | 3 | 9 | Statement plus real footage above the fold; nothing covers the headline (`titleCoveredBy: band` at all 8 viewports); demo hands over at 4.2 s |
| Product Clarity | 4 | 9 | "Go live everywhere. Without becoming a broadcast engineer." with a lede naming category, audience and difference |
| Differentiation | 4 | 9 | Break-it is chapter two; six correct pictures; OBS lanes with measured numbers |
| Interactive Experience | 8 | 10 | Everything the audit praised is kept; every control answers at every chapter (asserted at 8 chapters x 8 viewports) |
| Visual Quality | 4 | 9 | Picture-first stage, fixed readable bands, no dead band, connection lines kept |
| Premium Feel | 3 | 9 | Calm composition, one accent, real footage; the versus lanes show their lists ghosted before play and count them up when played |
| Streamer Appeal | 4 | 9 | Camera, mic, screen, platforms, LIVE badge, health, per-platform ceilings, real reconnect with attempt count |
| Professional Credibility | 3 | 8 | Pro panels, honest limits (no scene editor, no download), measured comparison only |
| Beginner Friendliness | 3 | 9 | Two-button hero, one-tap break, GO LIVE that picks for you and says so |
| OBS Switching Motivation | 3 | 8 | Named plainly; 14 concepts vs 6 taps; no invented click count for OBS, which caps this at 8 |
| Multistreaming Clarity | 7 | 10 | Six platform-shaped pictures from one production, on the tiles and in the Outputs chapter |
| Mobile Appeal | 2 | 8 | Vertical Live and 9:16 by default with the chat zone drawn on real footage; tested 375/390/412/768; panels cover the desk in two chapters (decided) |
| Trust | 4 | 9 | Every trust signal kept; camera privacy stated on the stage; no Download; early-access form only when a real endpoint exists |
| Desire to Try | 5 | 9 | "Try the web demo" and "Use my camera" in the first viewport; GO LIVE one tap away |
| Desire to Download | 2 | 7 | There is still nothing to download; the honest path is "Watch on GitHub for the first build". Capped until a build ships |
| **Total** | **59 / 150** | **132 / 150** | |

The retest lands below the directive's 135 floor on two categories that no page change can move further without lying: Desire to Download (no build exists, B-004/B-005) and OBS Switching Motivation (the benchmark refuses to assert an OBS click count, so the comparison is measured-vs-cited, not a race). Both are recorded as EXTERNAL / honest limits in the closure matrix rather than closed by copy.

## The twenty questions, retested

1. **5-second impression.** A headline, a sentence, two buttons and a person on camera in a lit room with a microphone; three platform tiles turning Ready with lines drawing to the picture. Nothing looks broken. (`desktop-hero.png`, `phone-390-hero.png`)
2. **15-second impression.** The mic meter moves, YouTube, Twitch and TikTok reach Ready, then "Your turn. Tap GO LIVE. Nothing is broadcast from this page." appears under the button and the page stops. Nothing goes live unasked (`liveCount 0` at 5.2 s on all 8 viewports; E2E "P1 nothing goes live until the visitor does").
3. **60-second experience.** GO LIVE counts down and lights three tiles and a LIVE badge on the picture; chat arrives; scrolling to "Break it yourself" and pressing the button snaps YouTube off, shows the WHY / DOING / YOU CAN card with "Attempt 1 of 10", and brings it back on a 4 s ring while Twitch and TikTok never change (`desktop-broken.png`; E2E sibling isolation).
4. **What I think LIVETAP is.** "A free app that puts my camera on every platform at once with one button, and keeps the others live when one drops." The production side now leads: the picture is the first thing on the page.
5. **Advantage.** Still per-destination isolation and explained recovery, now plus "one production, six correct pictures".
6. **First confusion.** None found at the first viewport. The Outputs and Versus chapters grow a panel over the console; on a phone that panel covers GO LIVE for those two chapters (decided, tested, listed below).
7. **First disinterest.** None strong. The quietest frame is the Pro chapter before Pro is switched on: a title, a sentence and one control over the console.
8. **First wow.** Unchanged: the break. Now reachable in one tap from chapter two.
9. **Missing wow.** Closed: "Use my camera" puts the visitor's own face on the stage, re-frames it in 9:16 with the chat zone drawn, and every connected tile shows it in its own shape (`desktop-camera.png` with Chromium's fake device).
10. **Why switch from OBS.** Named. 14 concepts named before a first stream versus 6 measured taps, 2 questions, 0 broadcasting words; multistream needs a plugin there. No minutes claim.
11. **Interaction score.** 10: all of the original list, plus camera, six outputs, versus lanes, intent presets, a break button, Simple/Pro.
12. **Visual quality.** 9: hierarchy is title, lede, controls, picture; bands never clip or slide (`bandInside: true` at every chapter on every viewport).
13. **Conversion.** Try the web demo (real, one click), Use my camera (real), Open LIVETAP for the chosen intent (real), Watch on GitHub (real, GitHub notifies). Email capture exists in code and appears only when an endpoint is configured (B-009).
14. **Biggest problems remaining.** See below.
15. **Biggest opportunities remaining.** Real licensed footage instead of generated; a shipped build; a notification endpoint.
16. **Most important change made.** The first five seconds: statement, picture, hand-over.
17. **Removed.** The intro collage, the auto go-live, the Download button, the six bullet cards, the pale narration, the dead band, the atmosphere canvas and the grain layer.
18. **Demonstrated.** Camera on the stage, 16:9 / 9:16 / 1:1 on real picture with zones, the six Moments as pictures, the six outputs, the reconnect with attempt count, the OBS comparison, vertical on a phone.
19. **Interactive.** All of the above; nothing plays itself past 4.2 s.
20. **Verdict.** I would try it: the web demo is one click away and the page shows the product working. I still cannot install it, and the page says so in plain words.

## Measurements on production (2026-09-14)

| Viewport | Load | CLS | LCP | Wheel from centre / tile | PageDown / End / Home | Touch swipe | Shape works at chapters | Console errors |
|---|---|---|---|---|---|---|---|---|
| 1440x900 | 0.5 s (3.6 s on the cold first hit) | 0.004 to 0.027 across four runs (0.049 before the GO LIVE line was given two reserved lines) | 0.4 s, the stage video | 500 / 500 px | yes / yes / yes | n/a | 8 of 8 | 0 |
| 1280x720 | 0.4 s | 0.010 | 0.4 s | 500 / 500 | yes | n/a | 8 of 8 | 0 |
| 390x844 phone | 0.6 s | 0.004 | 0.5 s | 500 / 500 | yes | 322 px | Shapes chapter (band control); toolbar copies hidden by design | 0 |
| 375x667 phone | 0.4 s | 0.007 | 0.6 s, the hero title | 500 / 500 | yes | 325 px | same | 0 |
| 412x915 phone | 0.4 s | 0.003 | 0.4 s | 500 / 500 | yes | 324 px | same | 0 |
| 768x1024 tablet | 0.5 s | 0.002 | 0.4 s | 500 / 500 | yes | 325 px | same | 0 |
| 1440x900 reduced motion | 0.4 s | 0.026 (the paused poster to first frame) | 0.3 s | 500 / 500 | yes | n/a | 8 of 8 | 0 |
| 1440x900 dark | 0.5 s | 0.004 after fix | 0.4 s | 500 / 500 | yes | n/a | 8 of 8 | 0 |

All eight runs: hero band visible with the title not covered, video playing (paused under reduced motion, poster shown), no Download word, no horizontal overflow, GO LIVE -> LIVE with the badge, break -> RECONNECTING with the card -> LIVE again, 9:16 with two drawn zones, Screen Share switching the screen on, six output figures, versus lanes playable, four Pro panels, intent chip changing shape and first Moment, all internal links 200 and `/nope` 404.

## Revision 3, the same day

After this retest the owner asked for the full Scroll Craft pass ("the spacing and flow seems off"). The page kept every guarantee scored above and regained its rhythm: chapters now differ in device (pin, a pan lane of six live Moment thumbnails, an iris reveal, real counters, a staggered flow, an up wipe, tilting chips) and in anchor, and copy arrives with each chapter's own travel instead of cross-fading in one fixed strip. The harness passed at desktop, phone and reduced motion (no dead scroll, contrast clear), the E2E suite is 88 of 88, and the production review was repeated at the same eight viewports. Scores are unchanged by this pass except that Visual Quality and Premium Feel now rest on a page with shape as well as hierarchy; they stay at 9 rather than being raised by the same hand that built it.

## Remaining issues (new problems discovered, honestly)

1. **Versus lanes were empty until played** on the first deploy of the day; the chips are now ghosted at 32% before play and light up when played (fixed and redeployed the same day).
2. **Panels cover the desk on phones for two chapters** (Outputs, Versus) and the close covers everything. Decided (DECISIONS_LOG 2026-09-14), tested as intended behaviour, and GO LIVE returns at the next chapter.
3. **Cold first load** of the desktop page took 3.6 s once (LCP 3.3 s) while the CDN cached the 158 KB clip; every later load was under 0.6 s. The poster (18 KB) paints first. Follow-up: a smaller first-second clip if a real-device measurement shows it matters.
4. **Sample footage is generated.** It is photographic and unlabelled as such on the page beyond "Sample picture". Replace with licensed real footage when the owner has some.
5. **The audit machine's Chrome could not be scripted** (extension channel timed out on every page including example.com), so the one browser the auditor used was never measured. Every measurement above is headless Chromium on the build host, and the E2E suite asserts scroll from real wheel, key and touch input.
6. **Desire to Download stays capped** until a build exists (B-004, B-005).
