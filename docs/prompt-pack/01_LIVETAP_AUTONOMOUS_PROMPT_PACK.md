# LIVETAP AUTONOMOUS PROMPT PACK
## Full Mission Specification

This document is the execution specification behind CONTROL PROMPT #01.

Claude Code should load this document and treat it as the canonical implementation directive.

---

# 1. PRODUCT NORTH STAR

LIVETAP is:

> One tap. Everywhere.

The core experience:

CONNECT ACCOUNTS
→ SELECT PLATFORMS
→ SELECT CAMERA/MIC
→ SELECT MOMENT
→ GO LIVE

The user should not need to understand broadcasting infrastructure.

---

# 2. PRODUCT MISSION

Build an open-source, free, cross-platform broadcasting system that delivers professional capabilities through radically simpler UX.

LIVETAP should combine:

- broadcasting
- multistreaming
- creator studio
- recording
- chat
- analytics
- scenes/Moments
- overlays
- media
- stream health
- creator assistance

without creating an intimidating professional-production interface.

---

# 3. CORE PRODUCT PRINCIPLES

1. Hide complexity.
2. Progressive disclosure.
3. Default to the simplest safe workflow.
4. Advanced users must retain meaningful control.
5. Never fabricate platform capabilities.
6. One destination failure should not destroy healthy destinations.
7. Security before convenience.
8. Open source with legal discipline.
9. Mobile is a real product, not merely a responsive webpage.
10. Product quality is measured by actual workflows, not number of features.

---

# 4. EXPERIENCE ARCHITECTURE

Primary spaces:

HOME
STUDIO
MOMENTS
DESTINATIONS
CHAT
MEDIA
RECORDINGS
ANALYTICS
SETTINGS

Do not implement all screens merely because they are named here.

The research and product teams must determine what the MVP actually needs.

---

# 5. MOMENTS

A beginner-friendly abstraction over scenes.

Default Moments:

Starting Soon
Main Camera
Screen Share
Guest
Break
Ending

Each Moment may internally contain:

- camera
- microphone
- screen
- browser source
- image
- video
- text
- overlay
- audio state

Advanced users can access the underlying scene/source graph.

---

# 6. DESTINATIONS

Every connected social network becomes a destination.

Destination card should make these states obvious:

Disconnected
Connecting
Ready
Live
Degraded
Reconnecting
Failed

Capabilities must be driven by the platform capability matrix.

---

# 7. UNIVERSAL BROADCAST MODEL

Conceptual:

UI
↓
Broadcast Orchestrator
↓
Moment / Scene Graph
↓
Media Pipeline
↓
Encoder
↓
Distribution Router
↓
Destination Adapters

Design the abstraction so destination-specific complexity does not infect the UI.

---

# 8. DESTINATION ADAPTER CONTRACT

Use a capability-driven adapter model.

Typical methods may include:

authenticate()
disconnect()
validate()
createBroadcast()
createStream()
startBroadcast()
stopBroadcast()
getStatus()
publishMetadata()
publishThumbnail()
getChat()
sendChat()
getAnalytics()

Do not require unsupported methods from providers that do not support them.

---

# 9. PLATFORM RESEARCH

Research current documentation before implementing each provider.

At minimum:

YouTube
TikTok
Instagram
Facebook
Twitch
X
Kick
LinkedIn

For each determine:

AUTH
BROADCAST CREATION
STREAM CREATION
STREAM KEY
START
STOP
METADATA
THUMBNAILS
CHAT
MODERATION
ANALYTICS
LIVE STATUS
APP REVIEW
ELIGIBILITY
LIMITATIONS

Build:

docs/research/PLATFORM_CAPABILITY_MATRIX.md

---

# 10. MEDIA ENGINE

Evaluate:

FFmpeg
GStreamer
libobs
WebRTC
SRT
RTMP
WHIP/WHEP
WebCodecs
GPU APIs
native capture

Choose using evidence.

Do not prematurely lock the system to a technology without benchmarking/fit analysis.

---

# 11. MULTIFORMAT

Support:

16:9
9:16
1:1

Support destination-specific requirements without making the creator manually build separate production pipelines.

---

# 12. CHAT

Aggregate supported chats.

Platform-specific permissions must be respected.

Never fake moderation features.

---

# 13. RECORDING

MVP recording should include:

- local recording
- presets
- file management
- recording status
- recovery behavior

Replay/clip functionality is desirable where technically feasible without destabilizing the core.

---

# 14. AUDIO

Support:

- microphone
- system audio where platform permits
- mute
- monitoring
- volume
- basic processing

Evaluate:

noise suppression
compressor
limiter
EQ
routing

Avoid exposing all controls by default.

---

# 15. CREATOR FEATURES

Evaluate and prioritize:

- overlays
- lower thirds
- text
- images
- video
- browser sources
- transitions
- scene switching
- hotkeys
- clips
- replay
- captions
- automated framing
- stream diagnostics

Prioritize by actual user value.

---

# 16. SIMPLE MODE

Simple mode should answer:

Where am I going live?
What am I broadcasting?
What camera/mic am I using?
Am I ready?
How do I go live?

Everything else is secondary.

---

# 17. PRO MODE

Pro mode provides access to:

- encoder controls
- bitrate
- resolution
- framerate
- codec
- advanced scenes
- source graph
- filters
- audio routing
- hotkeys
- advanced diagnostics
- hardware encoding
- replay
- recording controls

---

# 18. ERROR HANDLING

Errors should tell creators:

WHAT HAPPENED
WHY IT HAPPENED
WHAT LIVETAP IS DOING
WHAT THE USER CAN DO

Bad:

"RTMP error 104"

Better:

"Twitch stopped receiving your stream. LIVETAP is reconnecting."

---

# 19. STREAM HEALTH

Monitor:

- connection
- bitrate
- dropped frames
- encoder health
- destination health
- latency
- reconnect state

Beginner presentation should be simple.

Advanced diagnostics can reveal technical details.

---

# 20. DESKTOP

Target:

macOS
Windows

Use secure native integration.

Support where practical:

camera
mic
display capture
window capture
hardware acceleration
secure storage
crash recovery
update infrastructure

---

# 21. MOBILE

Target:

iOS
Android

Prioritize mobile-first workflows for:

- camera live streaming
- vertical broadcasting
- mobile microphone
- screen broadcast where OS permits
- destination selection
- basic scenes
- chat
- stream status
- account management

Respect OS limitations.

---

# 22. SECURITY

Requirements:

OAuth / PKCE
secure credential storage
OS vault
least privilege
CSP
secure IPC
dependency scanning
secret scanning
SAST where available
safe shell boundaries
secure update architecture

Security review must happen before release.

---

# 23. PRIVACY

Document:

- data collection
- credential storage
- network flows
- local vs cloud processing
- data retention
- deletion
- account revocation

Create:

docs/legal/PRIVACY_ARCHITECTURE.md

---

# 24. OPEN-SOURCE

Produce:

LICENSE
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
THIRD_PARTY_NOTICES.md

Document licensing implications of every major component.

---

# 25. UI QUALITY

Use objective rules plus visual verification.

Require:

- coherent typography
- spacing consistency
- strong hierarchy
- accessible touch targets
- keyboard navigation
- responsive layouts
- restrained motion
- clear focus states
- dark/light mode

Use screenshots/visual regression where available.

"Apple-quality" is the aspiration.

Evidence and measurable constraints are the verification mechanism.

---

# 26. MARKETING EXPERIENCE

Landing page should explain:

WHAT IS LIVETAP
WHY IT IS EASIER
HOW MULTISTREAMING WORKS
HOW TO DOWNLOAD
WHY OPEN SOURCE MATTERS

Use Scroll Craft when genuinely available.

Do not build generic SaaS copy.

---

# 27. IMAGE / VIDEO ASSETS

Use Higgsfield or the best available generation capability when available.

Generated assets must support the product narrative.

Do not use decorative visuals purely to increase visual noise.

---

# 28. GITHUB

Search GitHub aggressively.

Evaluate every important candidate for:

license
maintenance
security
maturity
performance
compatibility

Never copy proprietary code.

---

# 29. AUTOMATED QA

Minimum:

unit
integration
E2E
browser
visual regression
security
dependency
network resilience

Test:

connect
disconnect
go live
stop
reconnect
destination failure
camera failure
mic failure
network degradation
app restart
recording
scene changes
chat
account revocation

---

# 30. STORE READINESS

Create:

docs/release/APP_STORE_READINESS.md
docs/release/GOOGLE_PLAY_READINESS.md

Audit every store dependency.

Do not claim PASS without evidence.

---

# 31. DEPLOYMENT

Web application must deploy to Vercel.

The deployed build should contain:

- production landing page
- application shell
- realistic mock mode
- polished responsive UX
- no broken routes

---

# 32. PERSISTENT STATE

Maintain:

PROJECT_STATE.md
CURRENT_PHASE.md
ARCHITECTURE_DECISIONS.md
DECISIONS_LOG.md
IMPLEMENTATION_STATUS.md
RESEARCH_INDEX.md
BLOCKERS.md
HANDOFF.md

---

# 33. BLOCKER HANDLING

Do not stop for ordinary blockers.

Research.
Prototype.
Mock.
Substitute.
Continue.

Only truly human-exclusive dependencies go into BLOCKERS.md.

---

# 34. RELEASE CANDIDATE

Before final declaration:

- web deployed
- repo committed
- tests passing
- security reviewed
- major UX flows tested
- platform truth documented
- desktop status documented
- mobile status documented
- store readiness audited
- external dependencies consolidated

---

# 35. PRODUCT TEST

Ask:

Would an OBS beginner understand this?

Would an OBS expert respect the underlying power?

Would a creator switch?

Would the app feel like one coherent product?

Would failure on one platform unnecessarily kill everything?

Would a user trust their accounts and credentials to it?

If any answer is no, fix it.
