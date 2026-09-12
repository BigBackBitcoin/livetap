# LIVETAP QA / SECURITY / RELEASE GATE

## PURPOSE

This is the adversarial final gate.

The build is not complete because code compiles.

---

# 1. USER JOURNEYS

Test:

new user
connect account
select destinations
camera
mic
screen
Moment
preview
GO LIVE
stop
reconnect

---

# 2. DESTINATION FAILURE

Test:

destination unavailable
destination authentication failure
destination disconnect
destination timeout
destination reconnect
one destination fails while others remain healthy

---

# 3. MEDIA FAILURE

Test:

camera missing
camera removed
microphone missing
microphone removed
screen capture denied
encoder failure
recording failure
disk pressure

---

# 4. NETWORK FAILURE

Simulate:

packet loss
high latency
low bandwidth
disconnect
reconnect
destination-specific network failure

---

# 5. AUTH SECURITY

Test:

expired token
revoked token
invalid token
missing scope
unauthorized action
wrong account
logout
disconnect account
token replacement

---

# 6. WEB SECURITY

Check:

XSS
CSRF
insecure storage
unsafe redirects
IDOR
authorization
sensitive logging
secret exposure
dependency vulnerabilities

---

# 7. DESKTOP SECURITY

Check:

IPC
shell execution
filesystem boundaries
arbitrary URLs
browser sources
local file access
auto-update trust
signing configuration

---

# 8. MOBILE SECURITY

Check:

permissions
secure storage
deep links
auth redirects
token handling
screenshot/privacy considerations
background behavior

---

# 9. SUPPLY CHAIN

Run:

dependency audit
secret scan
license scan
static analysis
lockfile verification

---

# 10. PERFORMANCE

Measure where possible:

startup
memory
CPU
GPU
preview
encoding
network
recording

Use:

PASS
FAIL
UNVERIFIED
ENVIRONMENT-LIMITED

Never invent hardware results.

---

# 11. STORE READINESS

Audit:

Apple App Store
Google Play

For every requirement:

PASS
FAIL
BLOCKED_EXTERNAL_DEPENDENCY
UNVERIFIED

---

# 12. DEPLOYMENT

Verify:

Vercel deployment
production build
routes
environment configuration
mock mode
error pages
responsive behavior

---

# 13. UX RELEASE REVIEW

Review screenshots at:

desktop
tablet
mobile

Check:

hierarchy
spacing
typography
overflow
touch targets
motion
focus
dark mode
light mode

---

# 14. RUTHLESS PRODUCT TEST

Ask:

Is this genuinely easier than OBS?

Does the user understand the next action?

Is multistreaming actually simple?

Does the product feel cohesive?

Is Pro mode powerful enough?

Does failure feel recoverable?

Would a creator trust it?

Would a user switch?

If not, fix the product.

---

# 15. FINAL RELEASE STATUS

Only declare:

LIVETAP MVP READY

when the release candidate is:

tested
secured
documented
committed
deployed

External dependencies should be clearly separated from completed work.
