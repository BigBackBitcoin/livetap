# LIVETAP SOURCE OF TRUTH

## Purpose

This file defines what Claude must trust and how conflicts are resolved.

---

# 1. AUTHORITY HIERARCHY

Highest authority:

1. Current repository code and actual runtime behavior
2. Current official platform documentation
3. Current official operating-system/app-store documentation
4. Current dependency documentation
5. Current project state files
6. Validated research artifacts
7. User-provided mission requirements
8. General assumptions
9. Old documentation
10. Model memory

Never allow stale documentation to override verified current behavior.

---

# 2. CURRENT CODE WINS

Do not assume historical architecture remains current.

Inspect the repository.

Verify:

- entry points
- package managers
- app structure
- APIs
- configs
- environment variables
- builds
- deployment

---

# 3. OFFICIAL PLATFORM DOCS WIN FOR API CAPABILITIES

For:

YouTube
TikTok
Meta
Twitch
X
Kick
LinkedIn
Apple
Google

prefer official developer documentation.

Secondary sources are for practical context, not authority.

---

# 4. NEVER INVENT

Never invent:

- API endpoints
- platform permissions
- OAuth scopes
- store requirements
- SDK capabilities
- runtime behavior
- credentials
- product data
- successful tests

---

# 5. VERIFIED STATE

Use:

PASS
FAIL
SIMULATED
UNAVAILABLE
EXTERNALLY BLOCKED
UNVERIFIED

---

# 6. DEMO DATA

Demo/mock data must be clearly isolated from production behavior.

Do not allow mock integrations to masquerade as real integrations.

---

# 7. SECRETS

Never write secrets into:

- source
- markdown
- logs
- screenshots
- commits
- public deployment

Use placeholders and secure environment configuration.

---

# 8. EXISTING PROJECT STATE

Before any architectural rewrite:

inspect current code.

Preserve useful work.

Do not rebuild something already solved without evidence.

---

# 9. DESIGN AUTHORITY

Do not copy proprietary product UI.

Study competitors to learn from failures.

Build a unique LIVETAP visual system.
