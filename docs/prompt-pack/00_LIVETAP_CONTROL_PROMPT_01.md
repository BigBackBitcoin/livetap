# LIVETAP CONTROL PROMPT #01
## AUTONOMOUS PRODUCT BUILD COMMAND FOR CLAUDE CODE

You are now taking command of the LIVETAP build.

This is NOT a request for a plan, prototype, design document, or progress report.

This is an autonomous product-engineering mission.

Your job is to research, architect, build, test, harden, deploy, and release LIVETAP.

You own the problem.

You own the teams.

You own the architecture.

You own the implementation.

You own QA.

You own security.

You own deployment.

You own release preparation.

The human should not have to manage your work.

---

# MISSION

Build LIVETAP:

> Connect your accounts. Pick where you want to go live. Tap GO LIVE.

LIVETAP is an open-source, free, professional live-broadcasting platform intended to combine the strongest capabilities of OBS, YouTube Studio, TikTok LIVE Studio, Streamlabs, Restream, StreamYard, Riverside, Ecamm and similar products while eliminating their biggest usability failures.

The product must provide:

- desktop application for macOS and Windows
- React-based web application
- mobile applications/workflows for iOS and Android
- professional broadcasting
- multistreaming
- scenes/Moments
- camera
- microphone
- screen/window capture
- overlays
- media
- recording
- unified chat where APIs permit
- stream health
- destination management
- creator tools
- simple mode
- pro mode
- app-store/Play-store-ready architecture
- open-source core
- secure OAuth/account handling

The mission is NOT to copy OBS.

Build something substantially easier.

---

# ABSOLUTE AUTONOMOUS RULE

DO NOT ask the human for routine decisions.

DO NOT stop at phase boundaries.

DO NOT ask for architecture approval.

DO NOT ask which technology to use.

DO NOT ask which UI concept to choose.

DO NOT ask whether to use a particular library.

DO NOT stop merely because a social platform needs credentials.

DO NOT stop merely because a platform needs app review.

DO NOT stop merely because physical devices are unavailable.

DO NOT stop merely because a paid service is unavailable.

Solve, simulate, mock, prototype, benchmark, substitute, or document.

Use autonomous teams/subagents to answer those questions.

The only legitimate human handoff is at the absolute external boundary where the environment cannot supply something that only the human can provide.

Examples:

- production credentials
- developer account authorization
- signing certificates
- mandatory platform approval
- legally material owner-only decision
- required physical-device access
- unavoidable paid service
- genuinely irreversible business decision with material consequence

Even then:

DO NOT STOP THE PROJECT.

Accumulate those dependencies while continuing everything else.

---

# PHASE MODEL

Use these as internal execution phases, NOT approval checkpoints:

PHASE 0 — Environment Discovery
PHASE 1 — Research / Competitive Intelligence
PHASE 2 — Architecture
PHASE 3 — Product / Design System
PHASE 4 — Core Web Experience
PHASE 5 — Broadcast / Media Engine
PHASE 6 — Platform Integrations
PHASE 7 — Desktop
PHASE 8 — Mobile
PHASE 9 — Security / QA / Hardening
PHASE 10 — Deployment
PHASE 11 — Release Audit

Advance automatically.

---

# FIRST ACTION

Before changing production code:

1. inspect the current repository
2. inspect all important project files
3. inspect available tools/plugins
4. inspect the host environment
5. create the persistent-state files required by the prompt pack
6. assemble your autonomous teams
7. begin research and discovery

Do not start coding blindly.

---

# REQUIRED PERSISTENT STATE

Create and maintain:

PROJECT_STATE.md
CURRENT_PHASE.md
ARCHITECTURE_DECISIONS.md
DECISIONS_LOG.md
IMPLEMENTATION_STATUS.md
RESEARCH_INDEX.md
BLOCKERS.md
HANDOFF.md

The repository is your persistent memory.

When context becomes large, write state to disk and recover from these files.

Never repeatedly rediscover completed work.

---

# TEAM COMMAND

Create/assign specialist workstreams when supported:

1. PRODUCT / COMPETITOR RESEARCH
2. UX / PRODUCT DESIGN
3. MEDIA / STREAMING ARCHITECTURE
4. SOCIAL PLATFORM INTEGRATIONS
5. DESKTOP
6. MOBILE
7. SECURITY / PRIVACY / OPEN-SOURCE LICENSING
8. QA / ADVERSARIAL TESTING
9. DEVOPS / RELEASE
10. RUTHLESS PRODUCT REVIEW

Teams must produce concrete artifacts and findings.

Do not create teams for theater.

Parallelize genuinely independent work.

---

# RESEARCH REQUIREMENTS

Research:

OBS
Streamlabs
Restream
StreamYard
Riverside
Ecamm
vMix
Wirecast
Lightstream
Prism Live Studio
Meld Studio
XSplit
Twitch Studio
YouTube Live Studio
TikTok LIVE Studio
and other major live platforms discovered during research.

Find:

- strengths
- weaknesses
- user complaints
- technical limitations
- onboarding failures
- confusing workflows
- pricing friction
- platform limitations
- reliability failures
- performance complaints
- mobile shortcomings
- multistream shortcomings

Search:

GitHub
GitHub issues
Reddit
product reviews
YouTube reviews
forums
support docs
developer docs
app stores

Do not research forever.

Research until additional research is unlikely to change the architecture or product decision.

---

# SOCIAL PLATFORM TRUTH

Investigate current official capabilities for:

YouTube
Instagram
Facebook
Twitch
TikTok
X
Kick
LinkedIn
and any other relevant platform.

Never fabricate integration capabilities.

For every destination classify each meaningful capability as:

NATIVE API
RTMP DESTINATION
OAUTH + API
USER-ASSISTED
PARTNER APPROVAL REQUIRED
EXPERIMENTAL
UNAVAILABLE

Research:

- OAuth
- PKCE
- broadcast creation
- stream creation
- stream keys
- start/stop
- metadata
- thumbnails
- chat
- moderation
- analytics
- live status
- application review
- eligibility
- restrictions

Use official documentation first.

---

# OPEN-SOURCE RESEARCH

Search GitHub and official projects for:

FFmpeg
GStreamer
libobs
MediaMTX
OvenMediaEngine
WebRTC
WHIP/WHEP
RTMP
SRT
WebCodecs
GPU encoders
native camera capture
native screen capture
audio routing
compositing
virtual camera
cross-platform media frameworks

Evaluate:

- license
- security
- maturity
- maintenance
- performance
- compatibility
- platform support
- long-term fit

Do not use a dependency simply because it is popular.

---

# TOOL RULE

If Scroll Craft is actually available in the environment:

use it where valuable for the marketing/interactive product storytelling experience.

If Higgsfield or another premium generation capability is actually available:

use it where valuable for high-quality visuals/animations/design assets.

If unavailable:

do not hallucinate access.

Do not block the build.

Use the strongest available alternative.

---

# CORE PRODUCT EXPERIENCE

The product must make this workflow trivial:

OPEN
→ CONNECT ACCOUNTS
→ CHOOSE DESTINATIONS
→ CHOOSE CAMERA/MIC
→ SELECT MOMENT
→ PREVIEW
→ GO LIVE

The underlying system can be extremely sophisticated.

The default UX must not expose that complexity.

---

# SIMPLE MODE / PRO MODE

Simple Mode:

- camera
- mic
- screen
- Moments
- destinations
- preview
- GO LIVE
- basic chat
- stream health

Pro Mode can expose:

- bitrate
- resolution
- codec
- keyframe interval
- audio routing
- encoder
- scenes
- sources
- filters
- advanced transitions
- replay
- hotkeys
- hardware acceleration
- deeper diagnostics

---

# DESTINATION FAILURE ISOLATION

One failed destination must not unnecessarily kill the rest.

Destination states:

DISCONNECTED
AUTHENTICATING
READY
STARTING
LIVE
DEGRADED
RECONNECTING
FAILED
STOPPING
ENDED

Implement automatic recovery when technically appropriate.

---

# MULTIFORMAT

Architect for:

16:9
9:16
1:1

Support destination-specific output where necessary.

Avoid wasteful repeated encoding.

A single production should be capable of supporting multiple destination formats when technically feasible.

---

# SECURITY

Treat security as a release blocker.

Use:

- OAuth 2.0 / PKCE where applicable
- secure credential storage
- OS keychain / credential vault
- encrypted secrets
- strict IPC
- CSP
- dependency auditing
- secret scanning
- least privilege
- secure update architecture
- secure defaults

Never:

- hardcode secrets
- commit credentials
- store sensitive long-lived tokens in localStorage
- trust renderer input
- execute arbitrary shell commands from user-controlled input

---

# LEGAL / OPEN SOURCE

Audit all third-party dependencies.

Pay special attention to:

OBS/libobs
FFmpeg
GStreamer
MediaMTX
GPL
AGPL
other copyleft components

Create:

LICENSE
THIRD_PARTY_NOTICES.md
SECURITY.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md

Document material licensing decisions.

Do not copy proprietary code, UI, branding, or protected assets.

---

# MOBILE AND STORES

This is NOT complete merely because a responsive website exists.

Prepare real iOS and Android applications/workflows.

Create:

docs/release/APP_STORE_READINESS.md
docs/release/GOOGLE_PLAY_READINESS.md

Audit:

- package/bundle IDs
- permissions
- privacy manifests where applicable
- privacy policy
- terms
- account deletion
- signing
- entitlements
- metadata
- screenshots
- age rating
- store build process

Do not fabricate store readiness.

Use PASS / FAIL / BLOCKED_EXTERNAL_DEPENDENCY / UNVERIFIED.

---

# TESTING

Build and run:

- unit tests
- integration tests
- E2E
- browser tests
- visual regression where feasible
- security tests
- network failure simulations
- dependency audits

Test:

- destination failures
- reconnect
- packet loss
- latency
- bandwidth degradation
- camera removal
- microphone removal
- encoder problems
- app restart
- crash recovery
- authentication failures

---

# MOCK MODE

Create realistic mock social destinations.

At minimum:

Mock YouTube
Mock TikTok
Mock Twitch
Mock Instagram
Mock Facebook

Mock:

connect
disconnect
start
live
fail
reconnect
chat
analytics

This enables full UX validation without production credentials.

---

# ENVIRONMENT TRUTH

Never claim hardware support is verified if the hardware is unavailable.

Use:

PASS
FAIL
SIMULATED
UNAVAILABLE
EXTERNALLY BLOCKED
UNVERIFIED

Example:

NVENC = UNVERIFIED if an NVIDIA GPU is unavailable.

---

# HUMAN DEPENDENCY QUEUE

Maintain BLOCKERS.md.

A blocker is NOT permission to stop.

Record:

- category
- exact requirement
- why autonomous resolution failed
- what has already been completed
- exact human action required
- what will resume after the action

Accumulate final dependencies.

Do not interrupt the user repeatedly.

---

# AUTONOMOUS DECISION RULE

When uncertain:

RESEARCH
→ PROTOTYPE
→ TEST
→ BENCHMARK
→ MOCK
→ FIND ALTERNATIVE
→ DOCUMENT

Only after those paths fail should the issue reach the human-dependency queue.

---

# RELEASE CONDITION

Do not tell the human:

"mostly done"

"foundation complete"

"architecture ready"

Instead reach:

RESEARCHED
→ ARCHITECTED
→ IMPLEMENTED
→ TESTED
→ SECURED
→ DEPLOYED
→ COMMITTED
→ RELEASE-AUDITED

Then report.

---

# REQUIRED FINAL OUTPUT

When the release candidate is mature, return:

LIVETAP MVP READY

Vercel URL
GitHub repository
Desktop status
iOS status
Android status
Platform integration matrix
Security status
App Store readiness
Google Play readiness
Known limitations
Remaining external dependencies
Exact test instructions
Final commit hash

If external dependencies remain, distinguish them clearly from finished work.

Do not claim capabilities that were not actually verified.

---

# FINAL COMMAND

You own this mission.

Do not wait for me.

Do not ask me to make ordinary engineering decisions.

Create teams.

Research.

Build.

Test.

Break it.

Fix it.

Redesign it.

Secure it.

Deploy it.

Commit it.

Prepare it for release.

Only surface the final human dependency package when the autonomous portion of the mission is exhausted.

UNTIL THEN:

KEEP BUILDING LIVETAP.
