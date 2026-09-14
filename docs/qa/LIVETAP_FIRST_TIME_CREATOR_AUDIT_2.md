LIVETAP FIRST-TIME STREAMER AUDIT — RETEST

Independent blind pass on https://livetap.vercel.app/ at 1440×900, real Chromium, real wheel/keyboard/click. No project documentation, code, or closure report was read before or during the blind pass. No fixes were made. Note on evidence limits: window resizing was a no-op in this environment (viewport stayed 1534×855), so the 375/390/412/768 mobile pass could not be executed, and github.com / raw.githubusercontent.com would not load, so the cited evidence files could not be opened.

A. RAW FIRST IMPRESSION

A real thing appeared, not a brochure. Left rail, a stage with an actual photograph of a person at a mic, six platform tiles wired to that stage with curved connectors, a big blue GO LIVE (DEMO) button, 16:9/9:16/1:1, Camera/Microphone/Screen, Simple/Pro, a numbered row of Moments, a chat panel, and a status bar reading "Demo surface. Nothing is broadcast anywhere · 3 destinations · 2 formats · Idle". My honest reaction was "this is a live production app, and I can touch it." That is a different league from a landing page.

B. 5-SECOND RESULT

What I saw: "Go live everywhere. Without becoming a broadcast engineer." — readable, high contrast, unambiguous. What I thought LIVETAP is: software that sends one production to several platforms at once. What I thought I should do: press GO LIVE (DEMO) or "Use my camera". Did anything look broken: no. Is the product visibly present: yes. Is there a clear visual output: yes — a convincing sample picture, labelled honestly as a sample. Does it feel premium: partly. It feels competent and dense rather than premium. There is zero idle motion — after five seconds and again after fifteen, pixel-for-pixel nothing moved, so it reads as a screenshot of an app rather than a running app.

C. 15-SECOND RESULT

Do I already understand why this product exists? Yes, and that is the biggest win here. Three tiles say "Ready", three say "Not connected / Paste stream key", each tile carries its own aspect ratio, and the headline under the stage says "Ready on YouTube, Twitch and TikTok". I understood multistreaming without reading a paragraph. Production comprehension is weaker: the Moments row is visible but I did not know that "Moments" meant scenes until I clicked one. Confidence is high; trust is high because of the repeated, unprompted "Nothing is broadcast from this page."

D. 60-SECOND RESULT

Within a minute I had pressed GO LIVE, watched a 3‑2‑1 countdown with a Cancel, seen tiles flip to red "Live", seen a live timer and health ("Excellent") in the status bar, and seen simulated chat arrive with platform and role badges. Then my camera came up — genuinely live, in the stage and mirrored into all three destination thumbnails. That minute is strong. What I did not get in that minute was any feeling that the page was responding to my scrolling, and I never found a next step beyond "keep playing".

E. FIRST CONFUSION

The page appeared frozen when I scrolled. I wanted to see what was below the hero. I put the cursor in the centre of the page (over the stage, 764×343) and turned the wheel three ticks, then three more. Nothing changed — not the headline, not the stage, not the left rail, nothing. I then pressed PageDown: also nothing. Expected: the page moves, or at minimum something acknowledges the input. Actual: total silence for six wheel ticks plus a PageDown. Only a ten-tick burst flipped the section. Over the destination rail (225×380) even thirteen accumulated ticks produced nothing at all. What should have happened: any wheel delta anywhere should produce visible progress — a parallax, a progress rail, a partial transition — so the page never feels dead.

F. FIRST DISINTEREST

The "Outputs" and "Instead of OBS" sections, where the layout collapses into overlapping layers. In "One production. Six correct pictures." the six output tiles render on top of the stage and the destination rail — you can see the YouTube tile ghosting through behind them — the tiles sit at three different vertical baselines, and X, Facebook and Instagram are flat grey rectangles with a faint label and no picture. Three of six "correct pictures" are grey placeholders. In "Instead of OBS." the comparison panel overlays the stage, competitor text is rendered on top of the ghosted words "Ready on YouTube, Twitch and TikTok", the heading "Why not the others?" is sliced in half at the panel edge, and the panel has its own inner scrollbar — the exact hidden-scroll-area pattern the product is supposed to have eliminated. That is the moment I stopped reading. Cause: broken composition and lack of visible output, not text volume.

G. FIRST WOW

Two, both real.

The first: pressing GO LIVE and then, seconds later, seeing my own camera appear in the stage and simultaneously in the YouTube, Twitch and TikTok thumbnails, with the caption "Live from your camera. Local only, never uploaded." One production, three visible outputs, my own face. Compelling, felt unique, increased desire to use it.

The second, stronger: Break it. I clicked ✕ on the Twitch tile. The tile went amber "Reconnecting", its connector line vanished, the other two stayed red and live, health dropped Excellent → Fair, and a card appeared saying "Twitch stopped accepting the picture" with WHY ("The connection to Twitch dropped. Your other destinations are not affected"), DOING ("LIVETAP is reconnecting on its own. Attempt 1 of 10") and YOU CAN ("Wait for it, or stop this destination and keep the others live"). Then it healed itself and health returned to Excellent, and the Pro session log recorded "2:40 TikTok lost the connection / 2:45 TikTok live again". No competitor shows me this. This is the strongest thing on the site and it is placed second of eight acts, which is early enough.

H. MISSING WOW

There is no wow in format switching, no wow in the ending, and no wow on first paint. 9:16 and 1:1 are functionally correct but visually spoiled (section L). The final act removes the stage entirely and leaves a white void with orphaned controls. And nothing on first load moves, so the single best asset — a live production surface — is introduced as a still life.

I. PRODUCT CLARITY — strong

Headline, subhead, stage caption, status bar and per-tile format labels all say the same thing in plain language. "Demo surface. Nothing is broadcast anywhere" is always visible. The one clarity failure is the left navigation rail: "Stage" and "Outputs" are fine, but "Break it", "Shapes" and "Versus" are internal nicknames. A first-time creator does not know what "Shapes" or "Versus" contains.

J. STREAM OUTPUT EXPERIENCE — mixed, and it inverts where it matters

On the marketing page: yes, I can see the stream. Sample footage is convincing, camera is live, Moments visibly change the picture, destination thumbnails mirror the program, Guest shows real two-up footage.

In the actual product at /app/studio: no. The program preview is a flat purple/teal placeholder card reading "DEMO PREVIEW / Main Camera" with text overflowing both edges ("EMO PREVIE", "ated picture — this build is not broadca"). A camera device was selected ("HD Pro Webcam C920") and permission had already been granted in the same session, yet the Studio never renders real video. Formats: switching 16:9/9:16/1:1 in Studio only resizes the placeholder. Multiple platform outputs: the Studio right rail lists one destination as a text row.

So the landing page is more of a product than the product is. Under §12 this is a recorded failure on the Studio path.

K. CAMERA EXPERIENCE — works, with a long unexplained gap

Clicking "Use my camera" flipped both CTAs to "Asking your browser" and held that state for roughly twenty seconds with no timeout, no cancel, no "still waiting", no "if you dismissed the prompt, click here". During that window I pressed Escape and clicked elsewhere and the button stayed stuck. It did eventually resolve into a genuinely good state: live local video, "Stop my camera", and the honest "Local only, never uploaded". Framing is not subject-aware — in 9:16 the crop put my head at the bottom edge with a wall filling the top third. The in-canvas "Stop my camera" chip and the privacy caption are burned into the middle-left of the output in every Moment and every format, and in vertical they cover the subject completely.

Denial and insecure-context handling could not be exercised because the environment auto-resolved the permission. The app-side equivalent is excellent: the Health tab's "Unplug the camera" demo produced "Your camera disconnected." with WHY / DOING ("LIVETAP switched to your fallback layer so your stream stays up") / YOU CAN, a "Choose a camera" button and "Hide this message". That is best-in-class error copy.

L. FORMAT EXPERIENCE — real transformation, spoiled presentation

16:9 → 9:16 → 1:1 genuinely re-renders and re-crops, with dashed safe-zone guides and, in 1:1, an honest explanatory line: "Square is the canvas you compose in. No destination here asks for it, so LIVETAP sends each one the shape it accepts." That line is the best sentence on the site.

Defects, all reproducible by switching format with the camera live:

In 9:16 the "Stop my camera" button is clipped mid-word ("Stop my cam") and overhangs the canvas.
The privacy caption wraps to four to six lines and covers 40–100% of the vertical frame. With Pro panels open in Vertical Live, the entire 9:16 output was a ~65px sliver completely covered by six lines of caption text — the product output was invisible.
The "9:16" corner label renders underneath the LIVE pill.
A rotated, clipped label strip appears on the right edge of the vertical canvas.
The white stage container keeps 16:9 proportions, so 9:16 and 1:1 sit in large empty white margins with the destination connector lines terminating in blank space. It reads as unfinished rather than composed.
M. MULTISTREAM EXPERIENCE — the clearest thing on the site

Six named tiles, each with connection method, accepted aspect ratio, a live thumbnail of the actual program, and a status pill; curved connectors that are green when ready and red when live; a status bar count that updates ("3 destinations" → "4 destinations"); and in Pro, "WHAT EACH PLATFORM ACCEPTS" with per-platform ceilings (YouTube 40 / Twitch 6 / TikTok 4.5 / Instagram 6 Mbps). Clicking Instagram opened a stream-key popover pre-filled with demo.livetap.invalid and the line "A demo value. The key changes every session, so LIVETAP never stores it." Platform, format, status, quality and health are all legible. One gap: after connecting Instagram mid-broadcast it stayed "Ready" forever while the headline still said "Live on YouTube, Twitch and TikTok" and the button said "Live on 3", with no way to add it and no explanation of why not.

N. FAILURE / RECOVERY EXPERIENCE — flagship, and it contains the worst bug

The passes are described in G. The failures:

Critical — a labelled recovery action fires the wrong control. Reproduction: go live, open "Break it", click the ✕ on the Twitch tile, then click "Stop this destination" inside the explanation card. Expected: Twitch stops, others stay live. Actual (first run): Twitch remained Live and the canvas shape changed to 1:1 — the click landed on the 1:1 radio underneath the card. Second run, same steps on the TikTok tile: TikTok remained Live and the production switched Moment to Screen Share — the click landed on the Moments row underneath. The card is a non-modal overlay with no pointer barrier that auto-dismisses on reconnect, so its primary button passes clicks through to whatever live control sits beneath it. Severity: critical. On a real broadcast this changes your aspect ratio or your on-air scene while you are trying to contain a failure. Fix: make the card modal or pointer-isolated, keep it mounted until dismissed, and never place its actions over live controls.

High — drag is advertised and does not work. "Or drag any live tile off the stage" is printed twice. A press-move-release drag from the Twitch tile to the centre of the page produced no movement, no drop target, no rejection, no message. Silent failure of an explicitly advertised interaction.

Moderate — the explanation card covers the stage and the shape controls while it is open; and after recovery the YouTube tile's hint still reads "Go live to break it" while the tile is clearly badged Live.

O. MOMENTS EXPERIENCE — genuine, and would be used

All six change the production, not just a label. Starting Soon renders a title card and automatically mutes the microphone (the desk switches to "Microphone Muted"); Main Camera is full-frame; Screen Share renders a convincing editor capture with a camera picture-in-picture and flips Screen to On; Guest renders a real two-up with separate guest footage; Break shows "Back in a moment" and mutes; Ending shows "Thanks for watching". Destination thumbnails follow every change. Transitions are understandable and a creator would use this.

Against it: the Starting Soon / Break / Ending cards are plain white with black type — no branding, no countdown, no motion, nothing a StreamYard user would consider a "look"; the in-canvas camera chip collides with the card text every time (in Break it overlaps "a moment"; in 1:1 it clipped "Thanks for watching" to "Thanks for …g"); and Ending un-mutes the mic, which is backwards.

P. SIMPLE / PRO EXPERIENCE — right idea, broken execution

Pro reveals exactly the right four things: QUALITY (1080p, 30 fps), WHAT EACH PLATFORM ACCEPTS, AUDIO, and THIS SESSION — a timestamped log including "2:40 TikTok lost the connection", "2:45 TikTok live again", "4:08 Vertical Live chosen". Simple genuinely hides all numbers. I understood what Pro meant without being told.

But switching to Pro breaks the layout while live: the stage shrinks and rises, the destination tiles drop onto the control bar, and the END button is completely covered by the TikTok tile — only its outline and a sliver of "Live on 3" remain. I clicked where END should be and the tile intercepted it, selecting TikTok and showing a clipped hint ("Live. END stops it, or dr…"). The stop control for a live broadcast is unreachable in Pro mode. Severity: critical. The Moments row and chat are also clipped off the bottom, and the Simple label sits under the Facebook tile. Separately, each act shows a second copy of the format / Moments / Simple-Pro controls, so two identical control sets are on screen at once with no indication which is authoritative.

Q. OBS SWITCHING EXPERIENCE — the argument lands

"Instead of OBS." names fourteen OBS concepts as greyed chips, cites "Counted from the OBS Quick Start Guide", states "1,443 localised strings in the front end", and says plainly that multistreaming is not in the product and needs a plugin. Against it, LIVETAP shows six taps, two questions, zero broadcasting words, marked "Measured" and attributed to golden-path tests. No invented statistics, and the claims are the kind that can be checked. As an OBS user I would accept "it sets itself up and multistreams natively" as a reason to try it.

Two caveats. The evidence citations point at docs/qa/FRICTION_BENCHMARK.md and docs/research/COMPETITOR_FAILURE_DATABASE_A.md — repository file paths, not clickable sources, and neither github.com nor raw.githubusercontent.com would load during this audit, so a visitor cannot actually verify them. And the "6 taps" claim does not survive the real path: step 1 of setup auto-advances with no Continue button, while steps 2 and 3 each require scrolling to find their button, so the measured path omits the two moments where I was stuck.

R. MOBILE EXPERIENCE — NOT VERIFIED, therefore NOT CREDITED

resize_window reported success at 390, 400, 500, 800 and 1100 px but the rendered viewport never changed from 1534×855, and no touch emulation was available, so I could not test 375 / 390 / 412 / 768, touch swipe, or tap-target sizes. Per the zero-credit-for-invisible-capabilities rule I am scoring this low rather than assuming. Two indirect signals are negative: the desktop layout already collides at 1440 (tiles over the control bar, panels over the stage), which suggests an absolutely-positioned composition rather than a fluid one; and Vertical Live — the mode a phone-first creator would choose — produced the worst output rendering I saw anywhere.

S. CTA / CONVERSION EXPERIENCE — honest, and empty

Honesty is exemplary: "There is no download yet: desktop and mobile builds are not published… This hosted build is a demo: every destination is simulated and nothing is broadcast anywhere", plus "No tracking cookies. Nothing to accept." Nothing implies a download exists. The LinkedIn card in setup goes further — "LinkedIn does not let an app like LIVETAP go live for you, so LIVETAP will not pretend it can" — which is the most trust-building sentence in the whole experience.

The problem is what remains. The primary next step is "Open LIVETAP for Talking" (into the demo I already used) and the secondary is "Watch on GitHub for the first build". There is no email capture, no beta list, no notify-me. A creator who is convinced has nowhere to put their interest except a GitHub star, and GitHub was unreachable from the page during this session. Conversion is effectively unbuilt.

T. TRUST EXPERIENCE

Earned: repeated "nothing is broadcast", "local only, never uploaded", demo keys that are explicitly invalid and explicitly not stored, an admission that a platform is unsupported, no cookie wall, no fake download, no invented numbers, real device names, a real session log, and error copy that always answers what happened / why / what now.

Destroyed or damaged: a button labelled "Stop this destination" that changed my aspect ratio and my on-air scene instead; an END button hidden behind a tile while live; "Stream is excellent — everything is running smoothly" displayed at the same moment as "Your camera disconnected."; a tile reading "Go live to break it" while badged Live; advertised drag that does nothing; a preflight row reading "Ready — with one thing to know" that does nothing when you click the row (only the 8-pixel caret works); "Checking your picture and sound" that never finishes; and a missing-glyph tofu box in the setup summary.

And a blocker. Late in the session I reloaded the landing page and clicked the theme toggle in the left rail. The tab became unresponsive and never recovered: no screenshot or script could run against it for 90+ seconds. A hard reload, a different route (/privacy), a brand-new tab, and a cache-busted ?reset=1 all loaded the document (the tab title updated correctly) but left the main thread blocked and the page unrenderable for the remainder of the session. I could not clear it. Reproduction: use the site (camera on, go live, Pro, Vertical Live), reload /, click the dark-theme button. Expected: theme changes. Actual: page wedges, and the wedged state persists across new tabs and cache-busting, which points at persisted state being replayed into a blocking loop on boot. Severity: blocker — a creator who hits this concludes the software crashed.

Would I trust it with my camera and mic? Locally, yes. With my YouTube/Twitch/TikTok credentials and a live audience? Not yet.

U. VISUAL QUALITY

Typography is good — a confident display face, real hierarchy, no decorative noise. Colour discipline is good. Restraint is good. Everything else is not. Composition fails repeatedly: panels overlay the stage instead of replacing it, so text lands on ghosted product imagery; tiles overlap the control bar and cover the END button; text clips mid-word in at least six places ("Stop my cam", "Why not the others?", "EMO PREVIE", "ated picture — this build is not broadca", "Thanks for …g", "Live. END stops it, or dr…"); the vertical and square canvases float in empty white boxes; three of six output tiles are grey placeholders; the final act is a white void with orphaned controls; and there is no motion anywhere except state changes.

Apple-quality test: clarity, restraint and defaults pass; hierarchy, transitions, layering and visual consistency fail. It is not imitating Apple, which is to its credit — it is trying to be its own thing and the craft has not caught up.

Cheap-website test: passes. You could not swap the logo and sell this to another startup. It is not cards-and-text, it does not look AI-generated, it does not look templated. It looks like a real, unfinished application.

Product-versus-marketing test: I used a product. On the landing page I went live, broke a destination, watched it heal, switched formats, switched scenes, connected a platform and read a session log. That is the goal, and it was met on the marketing surface. Ironically the /app/studio half felt more like a mockup.

V. BIGGEST REMAINING PROBLEMS
Blocker — the site wedged the browser after the theme toggle and stayed unrenderable across new tabs and cache-busting for the rest of the session.
Critical — "Stop this destination" performs a different action. Clicks fall through the failure card to the shape control or the Moments row, changing a live production's format or on-air scene. Reproduced twice.
Critical — END is occluded in Pro mode while live. The TikTok tile covers it and intercepts the click.
Critical — the Studio shows no camera output. The actual product's program preview is a placeholder with overflowing text even with a camera device selected and permission granted.
High — scrolling gives no feedback below a large threshold, and is dead over the destination rail. Six wheel ticks plus PageDown over the stage produced zero visible change; thirteen ticks over the tile rail produced nothing.
High — layered panels overlay the live surface, producing ghosted text, clipped headings, and an undiscoverable inner scroll area in "Instead of OBS."
High — vertical output is unusable at desktop width, covered entirely by the privacy caption; three of six output tiles are grey placeholders.
High — advertised drag-to-break does nothing and says nothing.
Medium — silent or contradictory states: row click does nothing while the caret works; "Checking your picture and sound" never resolves; "Stream is excellent" during a camera disconnect; "Go live to break it" on a live tile; step 1 of setup has no Continue; Vertical Live state leaks into a "Talking" setup summary; duplicate control sets on screen.
Medium — no conversion mechanism at all, and cited evidence lives in unreachable repository files.
Unknown — mobile is unverified, and the desktop layout's collision behaviour is not encouraging.
W. BIGGEST REMAINING OPPORTUNITIES

The recovery experience is a category-defining asset and it is under-exploited — it belongs in the first five seconds, running by itself, as the thing that makes a stranger stop. Second, the persistent in-canvas camera chip and caption should move out of the output entirely; the single change of rendering the program clean would fix most of the format and Moments damage at once. Third, the acts should replace the stage or dock beside it rather than float over it, which removes the ghosting, clipping and click-through bugs as a class. Fourth, the Studio should render what the landing page already renders — the capability provably exists forty pixels away. Fifth, ship a notify-me field; the honesty about there being no build is admirable and currently costs you every interested creator.

X. SCORECARD
Category	Score
First Impression	7
Product Clarity	7
Differentiation	7
Interactive Experience	5
Visual Quality	4
Premium Feel	4
Streamer Appeal	6
Professional Credibility	4
Beginner Friendliness	6
OBS Switching Motivation	6
Multistreaming Clarity	8
Mobile Appeal	3 (unverified — no credit given)
Trust	5
Desire to Try	6
Desire to Download / Join Beta	3
TOTAL	81 / 150

Streamer conversion test (§32): C — I would try the demo, and I already did. I would not give an email (there is no field), would not connect an account (it is simulated and I watched a control misfire), and would not download (there is nothing to download, stated honestly). I would leave intending to check back, which is the most this build can currently capture.

Professional creator test (§33): no. I would not run an important stream on this. The reasons are specific, not vague: a stop control I cannot reach in Pro mode, a recovery button that changed my scene, a health readout that said everything was fine while my camera was disconnected, and a page that hung hard enough that I could not get it back.

Y. PREVIOUS 59/150 VS CURRENT 81/150

Independently assessed, not copied from any closure report.

Previous finding	Status now	Evidence
Broken first five seconds	Fixed	Full product surface, real picture, readable statement, no broken elements at 5s.
Hidden/broken scrolling	Partially fixed	Page does scroll and each act changes; but six ticks plus PageDown over the stage produced nothing, the tile rail swallows the wheel entirely, and "Instead of OBS." still contains an inner scroll area with a heading clipped in half.
Unclear product statement	Fixed	Headline, subhead, stage caption and status bar are consistent and plain.
Empty production stage	Fixed on the landing page, FAILED in the Studio	Landing stage shows sample footage and live camera; /app/studio shows a purple placeholder with overflowing text.
Silent control failures	FAILED	Drag-to-break silent; "Stop this destination" fires the wrong control twice; preflight row click inert; "Checking your picture and sound" never resolves; hidden END intercepts clicks.
Buried failure/recovery experience	Fixed	Act 2 of 8, with an explicit "Break YouTube for me" button, ✕ affordances, keyboard hint, and full WHY/DOING/YOU CAN copy.
Lack of actual camera output	Fixed on landing, FAILED in Studio	Live camera in stage and in all destination thumbnails; nothing in Studio.
Lack of real format output	Partially fixed	Real re-crop with safe zones and an honest square explanation; but clipped chrome, captions covering the frame, and a 65px invisible vertical output.
Weak mobile experience	UNVERIFIED	Viewport could not be resized in this environment. No credit.
Weak OBS switching argument	Fixed	Counted, labelled, cited, honest, no invented statistics — though citations are unreachable repo paths.
Misleading/unavailable download path	Fixed	Explicitly states no build exists; nothing implies otherwise. Best-handled item in the audit.
Generic ending section	Not fixed, changed shape	Real production profiles that alter shape, moment and platform ceilings — but the stage is absent, so the promise "the stage, the shape and the destinations change to match" is invisible at the moment you choose, and the act ends in a white void with orphaned controls and, while live, no stop control at all.

Net: five clear fixes, four partials, two regressions or failures, one unverifiable. Plus one new blocker (page hang) and one new critical (click-through on the recovery card) that did not exist in the previous finding list. 59 → 81 is a large, real improvement of +22, driven almost entirely by the landing surface becoming an operable product.

On documentation-versus-experience (§36): the closure documents and cited QA files could not be loaded from the browser in this session, so the only claims I could test were the ones published on the site itself. Two mismatch: "6 taps · 2 questions" does not match the real setup path, which auto-advances without an affordance at step 1 and hides its buttons below the fold at steps 2 and 3; and "Tap a Moment. The picture changes" plus "The stage, the shape and the destinations change to match" are true on the desk but not demonstrable in the act where the choice is act