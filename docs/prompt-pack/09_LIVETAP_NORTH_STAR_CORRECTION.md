# LIVETAP — STRATEGIC NORTH-STAR CORRECTION (received 2026-09-11, mid-build)

Additive correction to CONTROL PROMPT #01. No restart. No discarding work. No approval pauses.

## 1. Thesis
LIVETAP is NOT primarily an OBS clone.

**LIVETAP = THE EASIEST OPERATING SYSTEM FOR GOING LIVE.**

OBS-class capability is infrastructure. The competitive advantage is the experience above the infrastructure.

## 2. North-star journey
"I want to go live." → "What am I making?" → "Where do I want to broadcast?" → "Here is the best production setup." → GO LIVE → LIVE.

The user never needs to understand encoding, bitrate, RTMP, codecs, keyframes, scenes, sources, muxing, transcoding, aspect-ratio engineering, or destination-specific configuration unless they choose Pro Mode.

## 3. Do not optimize for feature count
Not "OBS + Streamlabs + Restream + TikTok Studio + YouTube Studio + Riverside". Every feature must reduce friction or add meaningful production capability.

## 4. Differentiation priorities
1. Simplicity  2. Destination intelligence  3. Automatic formatting (16:9 / 9:16 / 1:1 from one production)  4. Destination failure isolation  5. Universal creator workflow (production, broadcasting, chat, recording, media, health, destinations in one place)  6. Progressive disclosure.

## 5. Automatic Production (research + prototype aggressively)
Infer layout, framing, safe areas, text positioning, overlays, aspect ratio, output resolution, destination settings from content type + destinations. Examples: TALKING HEAD, GAMING, PODCAST, PRESENTATION, VERTICAL LIVE. Do not blindly implement all of it — determine what produces real user value.

## 6. Content-type onboarding (investigate)
"What are you doing?" 🎥 Talking · 🎮 Gaming · 🎙 Podcast · 💻 Presentation · 🎤 Event · 📱 Vertical Live → "Where are you going live?" → Camera / Mic / Screen → GO LIVE. Goal: validate whether intent-based onboarding is dramatically better than traditional broadcasting software.

## 7–8. Platform strategy and destination abstraction
Adapters are modular; platforms are not equivalent; never expose nonexistent capability. The UI shows "YouTube READY / Instagram AUTH REQUIRED / X UNAVAILABLE". The system knows why; the user shouldn't have to.

## 9. Free / open-source strategy
LIVETAP CORE: open source, self-hostable, desktop-first, local production, local recording, core adapters.
LIVETAP CLOUD (potential future, paid): managed multistreaming, relay, transcoding, cloud recording, remote guests, CDN, analytics, AI tooling, team collaboration. Do not build monetization now; architect the boundary so cloud can be added without rebuilding.

## 10. MVP destination strategy
Do not perfect every integration simultaneously. Candidate launch set: YouTube, Twitch, TikTok (validate with research; do not blindly adopt).

## 11. Validation over feature count
Measure OBS vs LIVETAP: time to first successful stream, configuration decisions, clicks, terminology exposure, failure recovery, multistream setup complexity.

## 12. The "pretty OBS" failure mode
If the implementation starts looking like a redesigned OBS dashboard: STOP. Re-evaluate navigation, hierarchy, terminology, default controls, onboarding, disclosure, destination abstraction, Moment abstraction.

## 13. Apple quality, correctly interpreted
Obvious interaction, minimal cognitive load, excellent hierarchy, strong defaults, predictable behaviour, smooth transitions, graceful failure, accessibility, careful details, no unnecessary complexity. NOT glass effects, giant type, decorative animation.

## 14. New research question
"What would make an OBS user switch to LIVETAP rather than merely try it?" → switching triggers, not complaints.

## 15. Ruthless product review at each milestone
1 Could a first-time creator figure this out? 2 Could an experienced creator trust it? 3 Is it faster than existing workflows? 4 Is the power visible only when needed? 5 Does it feel fundamentally different from OBS? 6 Would someone switch? If not: redesign and continue.

## 16. Priority rules
Better workflow > more features. Better reliability > more integrations. Better automation > more configuration. Better information hierarchy > visual decoration.

## 17–19
Preserve the current build; refactor only where necessary; update persistent state; record: **LIVETAP is an easy live-production operating system, not merely an OBS replacement.** Keep building.
