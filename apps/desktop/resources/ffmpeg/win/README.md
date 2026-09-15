# Windows FFmpeg binary

Put `ffmpeg.exe` and `ffprobe.exe` here with:

```bash
node tools/acquire-ffmpeg.mjs --platform win
```

It copies them from the ffmpeg already on PATH (resolving shims to the real executable),
runs each copy to prove it starts, copies the build's licence text in beside them, and
records the exact build and its SHA-256 in `../BUILD_INFO.txt`. On a machine with no
ffmpeg it prints the download URL and this destination and exits non-zero rather than
downloading 220 MB unattended. `npm run package:win`/`package:mac` run it automatically via
`prepackage`, so a packaging run either ships a working ffmpeg or stops and says why.

Dropping the binaries in by hand works too — the script and the packaging step only care
that they are here and that they run.

`electron-builder.yml` copies this directory to `resources/ffmpeg/` inside the installed app, and
`src/main/ffmpeg/ffmpegPath.ts` resolves
`process.resourcesPath/ffmpeg/win/ffmpeg.exe` in a packaged build.

The binaries are NOT committed (`.gitignore` excludes them): they are ~220 MB each in the gyan.dev full build and GPL-licensed (see
`docs/architecture/DESKTOP_ARCHITECTURE.md` for the licensing decision and the required
THIRD_PARTY_NOTICES text). Use a **GPL** build — never a `--enable-nonfree` build, which cannot be
redistributed at all.

Verified working on this host: `ffmpeg 9.0.1-full_build` from gyan.dev, which has libx264,
rtmp/rtmps/srt protocols and the tee/fifo muxers.

A packaged build with no binary here still starts, but `capabilities()` reports
`verification: UNAVAILABLE` and main logs an error — it never pretends streaming works.
