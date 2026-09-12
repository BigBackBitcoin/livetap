# LIVETAP ARCHITECTURE + MEDIA ENGINE DIRECTIVE

## OBJECTIVE

Create a technically credible architecture capable of professional live broadcasting while preserving an extremely simple interface.

---

# ARCHITECTURAL LAYERS

UI
↓
Application State
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

---

# KEY DESIGN RULE

Platform-specific complexity must be isolated behind adapters.

The UI must not need to know how a platform's API internally works.

---

# MEDIA OPTIONS TO EVALUATE

FFmpeg
GStreamer
libobs
WebRTC
MediaMTX
OvenMediaEngine
SRT
RTMP
WHIP/WHEP
WebCodecs
native platform APIs

Evaluate:

performance
licensing
cross-platform
hardware acceleration
developer environment
maturity
security
stability
build complexity

---

# OUTPUT FORMATS

16:9
9:16
1:1

Architecture should permit platform-specific transformation.

---

# CAPTURE

Desktop:

display
window
camera
microphone
system audio where supported

Mobile:

camera
microphone
screen where supported

---

# ENCODING

Evaluate hardware encoders:

Apple VideoToolbox
NVENC
Intel Quick Sync
AMD hardware encoding
software encoding

Never claim a hardware encoder is verified unless the actual environment supports it.

---

# RECORDING

Recording should share production architecture where possible.

Avoid redundant encoding work.

---

# RESILIENCE

Implement:

reconnect
health checks
backoff
destination isolation
encoder recovery
stream recovery
network degradation handling

---

# PERFORMANCE

Measure where possible:

startup
CPU
GPU
memory
preview latency
encoder load
network usage

If hardware is unavailable, document what remains unverified.

---

# SECURITY

Media pipelines can expose process-execution and file-access risks.

Constrain:

shell execution
file paths
IPC
renderer input
browser sources
local media access

Do not trust arbitrary user-controlled command strings.

---

# REQUIRED ARTIFACTS

docs/architecture/MEDIA_ENGINE.md
docs/architecture/MULTISTREAM_ARCHITECTURE.md
docs/architecture/DESTINATION_ADAPTERS.md
docs/architecture/DESKTOP_ARCHITECTURE.md
docs/architecture/MOBILE_ARCHITECTURE.md
