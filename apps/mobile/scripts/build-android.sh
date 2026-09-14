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

echo "[android] 1/3 building the web application"
npm run build -w @livetap/web >/dev/null

echo "[android] 2/3 staging it as the app bundle and syncing Capacitor"
node apps/mobile/scripts/stage-web.mjs
( cd apps/mobile && npx cap sync android )

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
  grep -E "^package:|^launchable-activity:|^uses-permission: name='android.permission.(CAMERA|RECORD_AUDIO|INTERNET)'" || true
echo "[android] install with: adb install -r \"$APK\""
