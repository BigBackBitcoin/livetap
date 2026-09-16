# tools/ — the local toolchains

**The contents of this directory are gitignored. They are not absent.**

If you have just run `java -version` or checked `$JAVA_HOME` and found nothing,
and are about to conclude that this machine cannot build Android: it can. The
toolchain is here, it is simply not on `PATH` and never has been, because
nothing here is installed system-wide.

Two separate autonomous sessions have now made exactly that mistake, in the same
way, on the same machine — reasoning from an observable that is missing for a
reason unrelated to the thing being measured. It is the same error shape as
concluding a product is broken because this server has no camera.

```
tools/jdk21/<jdk>/       Temurin JDK 21        — Gradle needs it
tools/android-sdk/       platform-tools, platforms/android-36, build-tools
tools/node22/node/       Node 22               — electron-builder needs >= 20.19
tools/mediamtx/          the relay, for local end-to-end runs
tools/ffmpeg             acquired by acquire-ffmpeg.mjs at packaging time
```

Only the acquisition scripts and this file are committed. If the directory is
genuinely empty, recreate it:

```bash
bash tools/acquire-android-toolchain.sh
```

## Building the artifacts with them

`build-android.sh` finds the portable JDK and SDK by itself, and honours
`JAVA_HOME` / `ANDROID_HOME` when you would rather point it elsewhere:

```bash
JAVA_HOME=$PWD/tools/jdk21/jdk-21.0.12.1+1 \
ANDROID_HOME=$PWD/tools/android-sdk \
VITE_LIVETAP_RELAY_URL=https://relay.example.com \
VITE_LIVETAP_BROKER_URL=https://livetap.example \
  bash apps/mobile/scripts/build-android.sh
```

The relay and broker origins are not optional for a real build. `VITE_` values
are compiled in, so an APK built without them is permanently capped at one
destination and can never complete OAuth — see `apps/mobile/scripts/build-android.sh`,
which now says so as it runs.

electron-builder needs Node >= 20.19 and the system Node here is older. **A
`PATH` prefix does not work**: npm's Windows shim invokes the Node it was
installed with, so call the CLI directly.

```bash
tools/node22/node/node.exe node_modules/electron-builder/out/cli/cli.js \
  --config electron-builder.yml --win --publish never
```

Run it from `apps/desktop/`, after `npm run build -w @livetap/desktop`.
