#!/usr/bin/env bash
# Acquire a portable JDK 21 and the Android SDK pieces this repo needs, into tools/.
# Nothing is installed system-wide and nothing here is committed (tools/ is gitignored).
#
#   bash tools/acquire-android-toolchain.sh
#
# Produces:
#   tools/jdk21/<jdk>/bin/java
#   tools/android-sdk/{cmdline-tools/latest,platform-tools,platforms/android-36,build-tools/36.x}
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$ROOT/tools"
mkdir -p "$T"
say() { echo "[toolchain] $*"; }

# ---------------------------------------------------------------- JDK 21 (Temurin)
if [ ! -x "$(ls -d "$T"/jdk21/*/bin/java.exe 2>/dev/null | head -1)" ]; then
  say "downloading Temurin JDK 21 (x64, windows)"
  curl -sL -o "$T/jdk21.zip" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" || exit 1
  say "jdk zip $(stat -c %s "$T/jdk21.zip" 2>/dev/null || echo ?) bytes"
  rm -rf "$T/jdk21" && mkdir -p "$T/jdk21"
  unzip -q "$T/jdk21.zip" -d "$T/jdk21" || exit 1
  rm -f "$T/jdk21.zip"
fi
JAVA_HOME="$(dirname "$(dirname "$(ls -d "$T"/jdk21/*/bin/java.exe | head -1)")")"
export JAVA_HOME
say "JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -2

# ------------------------------------------------------- Android command-line tools
SDK="$T/android-sdk"
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  say "downloading Android command-line tools"
  curl -sL -o "$T/cmdline.zip" \
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" || exit 1
  say "cmdline zip $(stat -c %s "$T/cmdline.zip" 2>/dev/null || echo ?) bytes"
  rm -rf "$SDK/cmdline-tools" && mkdir -p "$SDK/cmdline-tools"
  unzip -q "$T/cmdline.zip" -d "$SDK/cmdline-tools" || exit 1
  # The zip unpacks to cmdline-tools/; sdkmanager insists on being at cmdline-tools/latest/.
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -f "$T/cmdline.zip"
fi

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"

say "accepting licenses"
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses > "$T/sdk-licenses.log" 2>&1
tail -2 "$T/sdk-licenses.log"

say "installing platform-tools, platforms;android-36, build-tools;36.0.0"
"$SDKMANAGER" --sdk_root="$SDK" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  > "$T/sdk-install.log" 2>&1
code=$?
tail -4 "$T/sdk-install.log"
say "sdkmanager exit=$code"

say "installed packages:"
ls "$SDK" 2>/dev/null
ls "$SDK/platforms" 2>/dev/null
ls "$SDK/build-tools" 2>/dev/null
say "done"
