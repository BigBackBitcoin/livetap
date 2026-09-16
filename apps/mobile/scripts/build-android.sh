#!/usr/bin/env bash
# Build the LIVETAP Android debug APK, end to end, from a clean checkout.
#
#   bash apps/mobile/scripts/build-android.sh            # debug APK
#   bash apps/mobile/scripts/build-android.sh clean      # wipe build output first
#
# Requires a JDK 21 and an Android SDK. If they are not on PATH this script uses the portable
# copies under tools/, which `bash tools/acquire-android-toolchain.sh` downloads. Nothing is
# installed system-wide.
#
# Output: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk, signed with the SDK's
# debug key. That is enough to sideload onto a personal device with "install from unknown
# sources"; it is NOT enough for Play, which needs an upload key the repo must never contain
# (BLOCKERS.md B-005).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

JDK_DIR="$(ls -d "$ROOT"/tools/jdk21/*/ 2>/dev/null | head -1 || true)"
if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
  echo "[android] using JAVA_HOME=$JAVA_HOME"
elif [ -n "$JDK_DIR" ]; then
  export JAVA_HOME="${JDK_DIR%/}"
  echo "[android] using portable JDK at $JAVA_HOME"
else
  echo "[android] no JDK 21. Run: bash tools/acquire-android-toolchain.sh" >&2
  exit 1
fi

if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/platforms" ]; then
  echo "[android] using ANDROID_HOME=$ANDROID_HOME"
elif [ -d "$ROOT/tools/android-sdk/platforms" ]; then
  export ANDROID_HOME="$ROOT/tools/android-sdk"
  echo "[android] using portable SDK at $ANDROID_HOME"
else
  echo "[android] no Android SDK. Run: bash tools/acquire-android-toolchain.sh" >&2
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Gradle reads sdk.dir from local.properties. Forward slashes on purpose: a Java properties file
# treats a backslash as an escape, so C:\Users becomes C:Users and the build fails much later with
# "The filename, directory name, or volume label syntax is incorrect".
SDK_FWD="$(cd "$ANDROID_HOME" && pwd -W 2>/dev/null || echo "$ANDROID_HOME")"
printf 'sdk.dir=%s\n' "$SDK_FWD" > apps/mobile/android/local.properties

# VITE_LIVETAP_MOCK_MODE=false is the difference between an app and a demo of an app.
# `envMockMode()` in apps/web/src/state/mockMode.ts treats anything other than the literal string
# "false" as mock mode, and Vite constant-folds it at build time, so the previous bundle shipped a
# hardcoded `return true`: simulated adapters, a simulated engine, and a phone that could never put
# a byte on the wire however real the destination was.
#
# LIVETAP_ANDROID_VARIANT=debug is read by capacitor.config.ts to turn on
# webContentsDebuggingEnabled for this variant only. A sideloaded alpha with a white screen and no
# inspector cannot be diagnosed.
# The rest of the production configuration, passed THROUGH to the Vite build.
#
# These were not passed at all, which quietly capped the product. `VITE_` variables are read at
# build time, so an APK built without them has them compiled in as empty:
#
#   VITE_LIVETAP_RELAY_URL absent  -> the phone can only ever reach ONE destination. It has one
#                                     encoder and one RTMP socket; the relay is what makes the
#                                     second destination possible, and the app cannot be told where
#                                     the relay is after the fact.
#   VITE_LIVETAP_BROKER_URL absent -> OAuth is broken. Inside an APK a relative /api/oauth/token
#                                     resolves to the in-APK asset server, so the token exchange
#                                     has nowhere to go. apps/web/.env.example has always said this
#                                     surface needs a real origin; nothing supplied one.
#
# Absent is still allowed, because a sideloaded demo build is a legitimate thing to want. What is
# not allowed is being quiet about it.
RELAY_URL="${VITE_LIVETAP_RELAY_URL:-}"
RELAY_TOKEN="${VITE_LIVETAP_RELAY_TOKEN:-}"
BROKER_URL="${VITE_LIVETAP_BROKER_URL:-}"

if [ -z "$RELAY_URL" ]; then
  echo "[android] WARNING: VITE_LIVETAP_RELAY_URL is not set."
  echo "[android]          This APK will reach ONE destination only. Multi-destination needs a relay."
else
  echo "[android] relay: $RELAY_URL"
fi
if [ -z "$BROKER_URL" ]; then
  echo "[android] WARNING: VITE_LIVETAP_BROKER_URL is not set."
  echo "[android]          Connecting a platform account will fail: /api/oauth/token has no origin inside an APK."
else
  echo "[android] broker: $BROKER_URL"
fi

echo "[android] 1/3 building the web application (real adapters, real engine)"
VITE_LIVETAP_MOCK_MODE=false   VITE_LIVETAP_RELAY_URL="$RELAY_URL"   VITE_LIVETAP_RELAY_TOKEN="$RELAY_TOKEN"   VITE_LIVETAP_BROKER_URL="$BROKER_URL"   npm run build -w @livetap/web >/dev/null

echo "[android] 2/3 staging it as the app bundle and syncing Capacitor"
node apps/mobile/scripts/stage-web.mjs
( cd apps/mobile && LIVETAP_ANDROID_VARIANT=debug npx cap sync android )

echo "[android] 3/3 gradle assembleDebug"
cd apps/mobile/android
if [ "${1:-}" = "clean" ]; then ./gradlew clean --no-daemon; fi
./gradlew assembleDebug --no-daemon

APK="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "[android] FAILED: no APK at $APK" >&2
  exit 1
fi
echo "[android] APK: $APK ($(stat -c %s "$APK") bytes)"
"$ANDROID_HOME/build-tools/36.0.0/aapt.exe" dump badging "$APK" 2>/dev/null |
  grep -E "^package:|^launchable-activity:|^uses-permission: name='android.permission.(CAMERA|RECORD_AUDIO|INTERNET|POST_NOTIFICATIONS)'" || true

# Assert on the artifact, not on the build log. Every line below is a claim this repo makes about
# the APK elsewhere, checked against the APK itself so it cannot quietly stop being true.
node "$ROOT/apps/mobile/scripts/verify-apk.mjs" "$APK"

echo "[android] install with: adb install -r \"$APK\""
