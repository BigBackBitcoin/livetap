# LIVETAP PLATFORM INTEGRATION DIRECTIVE

## OBJECTIVE

Create reliable, honest platform integrations.

Do not promise functionality that current official platform APIs do not support.

---

# PROVIDERS

YouTube
TikTok
Instagram
Facebook
Twitch
X
Kick
LinkedIn
Other meaningful live platforms discovered during research

---

# CAPABILITY MATRIX

For every platform document:

OAuth
PKCE
Broadcast Creation
Stream Creation
Stream Key
Start
Stop
Metadata
Thumbnail
Chat Read
Chat Write
Moderation
Analytics
Live Status
Scheduling
Application Review
Eligibility
Regional Restrictions
Account Restrictions

Classify each capability:

NATIVE API
RTMP DESTINATION
OAUTH + API
USER-ASSISTED
PARTNER APPROVAL REQUIRED
EXPERIMENTAL
UNAVAILABLE

---

# ADAPTER PRINCIPLE

Build adapters.

Do not spread provider-specific logic throughout the product.

Conceptual interface:

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

Capability discovery should control UI exposure.

---

# OAUTH

Use secure provider authorization.

Prefer PKCE where appropriate.

Never place production long-lived secrets in browser storage.

Store credentials securely.

---

# DESTINATION STATES

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

---

# FAILURE ISOLATION

If a destination fails:

1. preserve the master production
2. preserve healthy destinations
3. reconnect automatically when reasonable
4. surface a readable explanation
5. allow removal of the failed destination

---

# MOCK PROVIDERS

Implement realistic mocks for development.

Mock connection lifecycle.
Mock live state.
Mock failure.
Mock recovery.
Mock chat.
Mock analytics.

Mock mode must be visibly separated from production integrations.

---

# REQUIRED ARTIFACT

docs/research/PLATFORM_CAPABILITY_MATRIX.md
docs/architecture/DESTINATION_ADAPTERS.md
