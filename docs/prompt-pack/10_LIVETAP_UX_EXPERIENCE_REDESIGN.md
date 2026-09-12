# LIVETAP — EMERGENCY UX / INTERACTIVE EXPERIENCE REDESIGN (received 2026-09-12)

Additive correction to the running mission. Apply in place; no restart; no approval pauses; implement, do not plan.

## Verdict on the current public site
Below the quality bar: behaves like a conventional SaaS marketing site (too much text, static sections, feature lists, cards on backgrounds, weak product demonstration, no depth, no interaction, no motion choreography, no product-state storytelling, "AI-generated landing page" look). Cosmetic fixes are not acceptable.

## North star
EXPERIENCE THE PRODUCT, not READ ABOUT THE PRODUCT. The first visit communicates CONNECT → PRODUCE → ADAPT → MULTISTREAM → GO LIVE → RECOVER → CONTROL through interaction and visual storytelling.

## Required tools
- UI/UX Pro Max skill (installed 2026-09-12 from nextlevelbuilder/ui-ux-pro-max-skill via the `skills` CLI into `.agents/skills/ui-ux-pro-max`).
- Scroll Craft skill (nateherk-design 0.2.0): premium scroll-driven storytelling, layered composition, dimensional hero, independent planes, cinematic progression, purposeful motion, mobile-specific composition, reduced-motion handling.
- Anime.js (current v4 API): timelines, transitions, destination/live state changes, reveals, staged assembly, micro-interactions, scroll-linked animation where appropriate. Motion must communicate state, hierarchy, cause/effect, transformation, progression. Do not animate everything.
- Premium image/video generation where genuinely useful.

## Hero
A cinematic live control environment, not a SaaS hero. Seven layers: atmosphere; product stage (living production canvas); destinations (YouTube, TikTok, Twitch, Instagram, Facebook, X); production controls (camera, mic, screen, Moment, layout); system state (LIVE, health, audience, connections, status); interaction feedback (motion, transitions, pulses, connection paths); foreground navigation/CTA. Real spatial depth, not seven stacks of cards. The hero tells the 17-step story automatically (canvas → camera → mic → YouTube READY → Twitch READY → TikTok READY → layout adapts → LIVE → indicators → chat → one destination degrades → others stay LIVE → reconnect → all healthy).

## The product is the marketing
Interactive playgrounds: destinations (toggle platforms, composition reacts), format (16:9/9:16/1:1 physically reorganizes), Moments (transform the environment), failure/recovery (LIVE → DEGRADED → RECONNECTING → LIVE, siblings stay live), chat (realistic mock audience with platform badges), Pro mode reveal (simple on the surface, serious power underneath).

## Scroll story (eight acts)
1 CHAOS (many platforms/windows/controls; collapse into LIVETAP) · 2 CONNECT · 3 PRODUCE · 4 ADAPT · 5 MULTISTREAM · 6 RESILIENCE · 7 POWER · 8 ACTION (DOWNLOAD / TRY DEMO / GITHUB only after the experience).

## Rules
Reduce text aggressively (replace with visual storytelling, controls, state, simulations). Alive but premium: status pulses, active connections, signal paths, chat flow; no RGB, no neon, no noise, no purple AI gradients, no rainbow. Multilayer depth (parallax, scale, perspective, opacity, blur, z-depth) where appropriate; selective 3D only where it materially helps; performance first. Product demo over device mockups. Every interaction: immediate response, visible state change, meaningful motion, cause/effect, accessible, reduced-motion alternative. Mobile is a different composition, not a compressed desktop. Respect prefers-reduced-motion. Measure LCP, CLS, bundle, animation, memory, scroll smoothness, mobile. Original identity (not Apple). Real type system (display/hero/headline/body/metadata/status/navigation/CTA). Optional interactive tour the visitor operates. 15-second test (six facts, mostly visual). Cheap-website tests 1–5 and category-defining test must pass. Site and app share typography, colour, motion, components, terminology. Preserve routes, auth, app shell, API contracts, mocks, deployment (KEEP / REFACTOR / REPLACE / REMOVE by evidence).

## Artifacts
docs/design/LIVETAP_VISUAL_DIRECTION.md · LIVETAP_INTERACTION_SYSTEM.md · LIVETAP_SCROLL_STORY.md · LIVETAP_MOTION_SYSTEM.md.

## Final deployment review
Build, test, deploy, open the actual Vercel deployment, review desktop, mobile, reduced motion, animations, scroll behaviour, interactive demos, regressions. Review the deployed experience, not only source.

## Quality bar
Not "a prettier landing page" but "I just experienced LIVETAP."
