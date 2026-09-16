package app.livetap.capacitor.livestream

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.MediaCodecList
import android.media.MediaCodec
import android.os.Build
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.pedro.common.ConnectChecker
import com.pedro.encoder.CodecErrorCallback
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.encoder.input.video.CameraCallbacks
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.encoder.utils.CodecUtil
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.generic.GenericStream
import com.pedro.library.view.OpenGlView
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * LiveStreamPlugin (Android) — the native half of @livetap/capacitor-live-stream.
 *
 * Library: RootEncoder 2.8.1 (Apache-2.0), `com.github.pedroSG94.RootEncoder:library`.
 * The API surface used below was read out of the resolved artifact on this build host with
 * `javap` against
 * ~/.gradle/caches/modules-2/files-2.1/com.github.pedroSG94.RootEncoder/library/2.8.1, not from
 * documentation, so every call here exists in the bytecode this module compiles against:
 *   GenericStream(context, ConnectChecker, VideoSource, AudioSource)
 *   prepareVideo(width, height, bitrate, fps, iFrameInterval, rotation): Boolean
 *   prepareAudio(sampleRate, isStereo, bitrate, echoCanceler, noiseSuppressor): Boolean
 *   startPreview(SurfaceView) / stopPreview()      (OpenGlView IS a SurfaceView)
 *   startStream(endPoint: String) / stopStream(): Boolean
 *   startRecord(path, tracks, listener) / stopRecord(): Boolean
 *   setEncoderErrorCallback(CodecErrorCallback) / release() / isStreaming / isOnPreview / isRecording
 *   Camera2Source.switchCamera() / .cameraFacing / .setCameraCallback(CameraCallbacks)
 *   MicrophoneSource.mute() / .unMute()
 *
 * ONE ENCODER, ONE SURFACE, ONE SOCKET
 * `GenericStream` owns a single encoder graph and a single client, and the library refuses
 * `prepareVideo` while a stream, a recording OR a preview is running ("Stream, record and preview
 * must be stopped before prepareVideo"). So there is exactly ONE `GenericStream` per process here,
 * created on the first `startPreview`/`startStream` and reused: the preview is the encoder graph,
 * and GO LIVE attaches a socket to the graph that is already running. That is also why
 * `capabilities().maxSimultaneousStreams` is 1 and why real multi-destination on a phone belongs
 * behind a relay in LIVETAP CLOUD (ADR-009) rather than in more of these.
 *
 * THE PREVIEW SURFACE
 * The preview is an `OpenGlView` inserted as child 0 of the Capacitor WebView's own parent, with
 * the WebView made transparent on top of it. It is built in code rather than declared in the host
 * app's `activity_main.xml` because a library module cannot reference the host app's `R`, and
 * `getIdentifier("livetap_preview", ...)` would make this plugin silently picture-less in any app
 * that forgot the layout. The view is created once and hidden rather than detached, so starting
 * and stopping preview never races the view hierarchy.
 *
 * Registration: automatic, and that is the reason this file lives in a package rather than in
 * apps/mobile. `npx cap sync android` scans every dependency whose package.json carries a
 * `capacitor` block, finds the `@CapacitorPlugin(name = "LiveStream")` annotation below, and writes
 * `{"pkg": "@livetap/capacitor-live-stream", "classpath": "app.livetap.capacitor.livestream.LiveStreamPlugin"}`
 * into `apps/mobile/android/app/src/main/assets/capacitor.plugins.json`, which BridgeActivity loads.
 * No `registerPlugin(...)` call in MainActivity, and nothing to re-add after a sync.
 *
 * VERIFICATION: this file COMPILES against RootEncoder 2.8.1 and ships in the debug APK's dex (see
 * docs/architecture/MOBILE_ARCHITECTURE.md for the command that proves it). Nothing below has been
 * RUN: the build host has no emulator image and no nested virtualisation, so camera output,
 * permission dialogs, the foreground-service notification and real RTMP from a handset are all
 * owner-hardware checks. docs/release/ANDROID_MANUAL_TEST.md is the journey that settles them.
 */
@CapacitorPlugin(
    name = "LiveStream",
    permissions = [
        com.getcapacitor.annotation.Permission(
            alias = "camera",
            strings = [Manifest.permission.CAMERA],
        ),
        com.getcapacitor.annotation.Permission(
            alias = "microphone",
            strings = [Manifest.permission.RECORD_AUDIO],
        ),
        // Without this the Android 13+ live notification never appears, and that notification is
        // the creator's only handle on a broadcast once they leave the app. It is requested
        // separately and best-effort by MobileEngine: a refused notification loses the handle, it
        // does not stop the broadcast, so it must never block GO LIVE.
        com.getcapacitor.annotation.Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS],
        ),
    ],
)
class LiveStreamPlugin : Plugin(), ConnectChecker {

    /** Encoder configuration currently loaded into the one `GenericStream`. */
    private data class EncoderConfig(
        val width: Int,
        val height: Int,
        val fps: Int,
        val videoKbps: Int,
        val audioKbps: Int,
        val keyframeSeconds: Int,
    )

    /** One RTMP/RTMPS push, keyed by the id handed back to JavaScript. */
    private class Session(val id: String) {
        var lastBitrateKbps = 0L
        var droppedFrames = 0L
        var connected = false
    }

    private val sessions = LinkedHashMap<String, Session>()
    private val ids = AtomicInteger(0)

    private var stream: GenericStream? = null
    private var previewView: OpenGlView? = null
    private var prepared: EncoderConfig? = null

    private var previewing = false
    private var muted = false
    private var wantFront = true
    private var recordingPath: String? = null
    private var recordingStartedAt = 0L
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

    override fun load() {
        // The notification's "End broadcast" action must end the BROADCAST, not just the service.
        // Stopping only the service leaves the encoder running with an open RTMP socket and no
        // foreground service, which on Android 14+ means the push dies at an arbitrary moment with
        // nothing reaching JavaScript and the destination card still reading LIVE.
        LiveForegroundService.onStopRequested = { endEverythingFromNotification() }
        registerThermalListener()
        super.load()
    }

    // ------------------------------------------------------------------ capabilities

    @PluginMethod
    fun capabilities(call: PluginCall) {
        val result = JSObject()
        result.put("camera", granted(Manifest.permission.CAMERA) && hasCameraHardware())
        result.put("microphone", granted(Manifest.permission.RECORD_AUDIO))
        result.put("rtmp", true)
        result.put("rtmps", true)
        // RootEncoder supports SRT, but SRT with a passphrase enables AES in-library, which
        // changes the iOS export-compliance answer. Kept false until legal signs off so that the
        // two platforms expose the same capability set (APP_STORE_READINESS item A22).
        result.put("srt", false)
        result.put("hevc", hasHevcEncoder())
        result.put("recording", true)
        // Android keeps the camera alive behind a camera-type foreground service.
        result.put("backgroundCamera", true)
        result.put("backgroundAudio", true)
        // MediaProjection screen capture is post-MVP: the manifest declares the FGS type but no
        // code path requests consent yet.
        result.put("screenCapture", false)
        result.put("maxSimultaneousStreams", maxStreams())
        // The plugin is compiled and shipped, and it has never been run on a handset. Say so.
        result.put("verification", "UNVERIFIED")
        result.put(
            "platformNote",
            "RootEncoder 2.8.1; API ${Build.VERSION.SDK_INT}; thermal=${thermalName()}; " +
                "not yet run on a physical device",
        )
        call.resolve(result)
    }

    private fun hasCameraHardware(): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    /**
     * Asked of the platform instead of assumed. HEVC halves the bitrate for the same picture on the
     * destinations that accept it, and guessing wrong in either direction is a bad broadcast.
     */
    private fun hasHevcEncoder(): Boolean = try {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
            info.isEncoder && info.supportedTypes.any { it.equals("video/hevc", ignoreCase = true) }
        }
    } catch (e: RuntimeException) {
        Log.w(TAG, "MediaCodecList query failed: ${e.javaClass.simpleName}")
        false
    }

    /**
     * One. Not a thermal estimate: `GenericStream` owns one encoder and one client, so a second
     * simultaneous push would mean a second full encode of the same camera. Two destinations from a
     * phone go through a relay (ADR-009), which is one encode and one uplink whatever the count.
     */
    private fun maxStreams(): Int = 1

    // ------------------------------------------------------------------ preview

    @PluginMethod
    fun startPreview(call: PluginCall) {
        val missing = missingCapturePermissions()
        if (missing.isNotEmpty()) {
            call.reject(
                "camera and microphone must be granted before startPreview (missing: $missing)",
                PERMISSION_DENIED,
            )
            return
        }
        wantFront = call.getString("camera", "front") == "front"
        val aspect = call.getString("aspect", "9:16") ?: "9:16"
        val size = previewSize(aspect)

        onUi(call) {
            val config = EncoderConfig(
                size.first,
                size.second,
                PREVIEW_FPS,
                PREVIEW_VIDEO_KBPS,
                PREVIEW_AUDIO_KBPS,
                PREVIEW_KEYFRAME_SECONDS,
            )
            val s = ensurePrepared(config)
            if (s == null) {
                call.reject("encoder refused ${config.width}x${config.height}@${config.fps}")
                return@onUi
            }
            val view = ensurePreviewView()
            showPreviewSurface(view)
            if (!s.isOnPreview) s.startPreview(view)
            previewing = true
            applyFacing()
            applyMute()
            call.resolve()
        }
    }

    @PluginMethod
    fun stopPreview(call: PluginCall) {
        onUi(call) {
            stream?.let { if (it.isOnPreview) it.stopPreview() }
            previewing = false
            hidePreviewSurface()
            // A preview with no live output left is the last thing holding the camera open. Release
            // it so the OS torch/camera indicator goes out and another app can use the lens.
            if (sessions.isEmpty()) releaseStream()
            call.resolve()
        }
    }

    @PluginMethod
    fun switchCamera(call: PluginCall) {
        onUi(call) {
            wantFront = !wantFront
            // Camera2Source.switchCamera() flips facing in place — cheaper and less glitchy than
            // handing StreamBase a whole new VideoSource, which tears the encoder input down.
            (stream?.videoSource as? Camera2Source)?.switchCamera()
            call.resolve()
        }
    }

    @PluginMethod
    fun setMute(call: PluginCall) {
        muted = call.getBoolean("muted", false) == true
        onUi(call) {
            applyMute()
            call.resolve()
        }
    }

    // ------------------------------------------------------------------ streaming

    @PluginMethod
    fun startStream(call: PluginCall) {
        val url = call.getString("url")
        val streamKey = call.getString("streamKey")
        if (url.isNullOrBlank() || streamKey.isNullOrBlank()) {
            call.reject("url and streamKey are required")
            return
        }
        if (!url.startsWith("rtmp://") && !url.startsWith("rtmps://")) {
            call.reject("mobile supports rtmp/rtmps only")
            return
        }
        if (sessions.size >= maxStreams()) {
            call.reject("device allows ${maxStreams()} simultaneous push(es); use a relay (ADR-009)")
            return
        }
        if (missingCapturePermissions().isNotEmpty()) {
            call.reject("camera and microphone must be granted before startStream", PERMISSION_DENIED)
            return
        }

        val config = EncoderConfig(
            width = call.getInt("width", 1080) ?: 1080,
            height = call.getInt("height", 1920) ?: 1920,
            fps = call.getInt("fps", 30) ?: 30,
            videoKbps = call.getInt("videoKbps", 4500) ?: 4500,
            audioKbps = call.getInt("audioKbps", 128) ?: 128,
            keyframeSeconds = call.getInt("keyframeSeconds", 2) ?: 2,
        )

        onUi(call) {
            val s = ensurePrepared(config)
            if (s == null) {
                call.reject("encoder refused ${config.width}x${config.height}@${config.fps}")
                return@onUi
            }
            if (s.isStreaming) {
                call.reject("a broadcast is already running on this device")
                return@onUi
            }

            val id = "android-${ids.incrementAndGet()}"
            sessions[id] = Session(id)

            // The foreground service must be running before the socket opens, and camera/microphone
            // FGS types are while-in-use, so this can only ever be reached from the GO LIVE tap.
            LiveForegroundService.startLive(context, "LIVETAP is live", "Tap to return to LIVETAP")

            // RTMP credentials, when the ingest demands them. No platform does -- YouTube, Twitch
            // and Kick all authenticate with the stream key itself -- but the LIVETAP relay does,
            // and that is what lets this device reach more than one destination: it encodes once
            // and publishes once to the relay, which fans out, rather than opening an RTMP socket
            // per destination past what `maxStreams()` allows.
            //
            // Applied through the encoder's own auth rather than embedded in the endpoint, because
            // a password inside a URL survives in encoder logs and diagnostics. Like `streamKey`,
            // neither value is ever logged or put in an event.
            val username = call.getString("username")
            val password = call.getString("password")
            if (!username.isNullOrBlank()) {
                s.getStreamClient().setAuthorization(username, password)
            }

            // RootEncoder takes url + "/" + key as one endpoint. Everything from here on must treat
            // `endpoint` as a secret: it is never logged and never put in an event.
            s.startStream(url.trimEnd('/') + "/" + streamKey)

            emitState(id, "connecting")
            val result = JSObject()
            result.put("id", id)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun stopStream(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        if (sessions.remove(id) == null) {
            // Stopping an unknown output is a no-op, not an error: the UI may be racing a failure.
            call.resolve()
            return
        }
        onUi(call) {
            stream?.let { s ->
                if (s.isRecording) s.stopRecord()
                if (s.isStreaming) s.stopStream()
            }
            recordingPath = null
            recordingStartedAt = 0L
            if (sessions.isEmpty()) {
                LiveForegroundService.stopLive(context)
                // The preview outlives the broadcast on purpose: the creator ends a stream and is
                // still looking at themselves, ready to go again. Only when nothing wants the
                // camera is the whole graph released.
                if (!previewing) releaseStream()
            }
            call.resolve()
        }
    }

    // ------------------------------------------------------------------ recording

    @PluginMethod
    fun startRecording(call: PluginCall) {
        val s = stream
        if (s == null) {
            call.reject("start a stream or preview before recording")
            return
        }
        // App sandbox only — never external storage. No permission needed, and the file disappears
        // with the app, which matches the privacy promise in docs/legal/PRIVACY_POLICY.md.
        val dir = File(context.filesDir, "recordings").apply { mkdirs() }
        val file = File(dir, "livetap-${System.currentTimeMillis()}.mp4")
        onUi(call) {
            try {
                // RecordController.Listener is a Kotlin `fun interface`; the lambda is onStatusChange.
                s.startRecord(file.absolutePath, null) { status ->
                    Log.i(TAG, "record status=$status")
                }
            } catch (e: Exception) {
                call.reject("recording failed: ${e.javaClass.simpleName}")
                return@onUi
            }
            recordingPath = file.absolutePath
            recordingStartedAt = System.currentTimeMillis()
            val result = JSObject()
            result.put("path", file.absolutePath)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        onUi(call) {
            stream?.let { if (it.isRecording) it.stopRecord() }
            val result = JSObject()
            recordingPath?.let { result.put("path", it) }
            if (recordingStartedAt > 0) {
                result.put("durationMs", System.currentTimeMillis() - recordingStartedAt)
            }
            recordingPath = null
            recordingStartedAt = 0L
            call.resolve(result)
        }
    }

    // ------------------------------------------------------------------ ConnectChecker

    override fun onConnectionStarted(url: String) {
        // `url` contains the stream key. It must never be logged or forwarded to JavaScript.
        activeId()?.let { emitState(it, "connecting") }
    }

    override fun onConnectionSuccess() {
        val id = activeId() ?: return
        sessions[id]?.connected = true
        emitState(id, "connected")
    }

    override fun onConnectionFailed(reason: String) {
        val id = activeId() ?: return
        sessions[id]?.connected = false
        emitState(id, "failed", code = mapFailure(reason), technical = redact(reason))
        // Reconnect policy lives in packages/core (ReconnectPolicy) — the native layer reports
        // and stops, it never invents its own backoff.
    }

    override fun onDisconnect() {
        val id = activeId() ?: return
        sessions[id]?.connected = false
        emitState(id, "disconnected", code = "INGEST_DISCONNECTED")
    }

    override fun onAuthError() {
        val id = activeId() ?: return
        emitState(id, "failed", code = "INGEST_INVALID_KEY", technical = "rtmp auth rejected")
    }

    override fun onAuthSuccess() {
        // Nothing to report: onConnectionSuccess follows.
    }

    override fun onNewBitrate(bitrate: Long) {
        val id = activeId() ?: return
        val session = sessions[id] ?: return
        session.lastBitrateKbps = bitrate / 1000
        session.droppedFrames = try {
            stream?.getStreamClient()?.getDroppedVideoFrames() ?: 0L
        } catch (e: IllegalStateException) {
            0L
        }
        emitState(
            id,
            if (session.connected) "connected" else "connecting",
            bitrateKbps = session.lastBitrateKbps,
        )
    }

    // ------------------------------------------------------------------ events

    private fun emitState(
        id: String,
        state: String,
        code: String? = null,
        bitrateKbps: Long? = null,
        technical: String? = null,
    ) {
        val payload = JSObject()
        payload.put("id", id)
        payload.put("state", state)
        code?.let { payload.put("code", it) }
        bitrateKbps?.let { payload.put("bitrateKbps", it) }
        technical?.let { payload.put("technical", it) }
        sessions[id]?.let { payload.put("droppedFrames", it.droppedFrames) }
        notifyListeners("streamState", payload)
    }

    private fun emitDeviceLost(kind: String, recoverable: Boolean, technical: String?) {
        val payload = JSObject()
        payload.put("kind", kind)
        payload.put("recoverable", recoverable)
        technical?.let { payload.put("technical", it) }
        notifyListeners("deviceLost", payload)
    }

    /**
     * The OS reports thermal pressure before it throttles the encoder, which is the only warning a
     * phone gives that a broadcast is about to fall apart. Forwarded verbatim so the step-down
     * decision is taken once, in the orchestrator, on evidence rather than on a guess about how hot
     * a given handset runs.
     */
    private fun registerThermalListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val pm = context.getSystemService(PowerManager::class.java) ?: return
        val listener = PowerManager.OnThermalStatusChangedListener { status ->
            val payload = JSObject()
            payload.put("level", thermalLevelOf(status))
            notifyListeners("thermal", payload)
        }
        thermalListener = listener
        pm.addThermalStatusListener(listener)
    }

    private fun unregisterThermalListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val listener = thermalListener ?: return
        thermalListener = null
        context.getSystemService(PowerManager::class.java)?.removeThermalStatusListener(listener)
    }

    // ------------------------------------------------------------------ the one stream

    /**
     * Load `config` into the single `GenericStream`, creating it on first use.
     *
     * The library refuses `prepareVideo` while a stream, a record or a PREVIEW is running, so a
     * format change bounces the preview around the reconfigure. That is the whole reason this is a
     * function and not two lines at each call site: GO LIVE at the destination's real resolution
     * has to reconfigure the graph the preview is already using.
     *
     * Returns null when the device's encoder refuses the format, which is a real outcome on a phone
     * asked for 1080p60 it cannot do.
     */
    private fun ensurePrepared(config: EncoderConfig): GenericStream? {
        val s = stream ?: createStream()
        if (prepared == config) return s
        if (s.isStreaming) return if (prepared == null) null else s

        val wasPreviewing = s.isOnPreview
        if (wasPreviewing) s.stopPreview()
        if (s.isRecording) s.stopRecord()

        val videoOk = try {
            s.prepareVideo(
                config.width,
                config.height,
                config.videoKbps * 1000,
                config.fps,
                config.keyframeSeconds,
                rotationFor(config.width, config.height),
            )
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "prepareVideo rejected: ${e.message}")
            false
        }
        val audioOk = try {
            // 44.1 kHz stereo AAC is what every RTMP ingest in the destination matrix accepts.
            s.prepareAudio(44_100, true, config.audioKbps * 1000, echoCanceler = true, noiseSuppressor = true)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "prepareAudio rejected: ${e.message}")
            false
        }
        if (!videoOk || !audioOk) {
            prepared = null
            Log.e(TAG, "encoder refused ${config.width}x${config.height}@${config.fps}")
            return null
        }
        prepared = config
        if (wasPreviewing) previewView?.let { s.startPreview(it) }
        applyMute()
        return s
    }

    private fun createStream(): GenericStream {
        val camera = Camera2Source(context)
        val created = GenericStream(context, this, camera, MicrophoneSource())
        camera.setCameraCallback(object : CameraCallbacks {
            override fun onCameraChanged(facing: CameraHelper.Facing) {
                // Deliberately does NOT write back to `wantFront`. That field is the creator's
                // intent; this is the hardware's current state. Collapsing the two would mean a
                // flip that did not take effect silently rewrote the intent to match the failure.
                Log.i(TAG, "camera facing is now $facing")
            }

            override fun onCameraError(error: String) {
                // Camera2 errors are terminal for the session: RootEncoder does not reopen the
                // device by itself, so claiming the picture is coming back would be a lie.
                emitDeviceLost("camera", recoverable = false, technical = redact(error))
            }

            override fun onCameraOpened() {
                // The one moment `getCameraFacing()` is worth asking. Before the device is open it
                // answers with a default, so a front-camera request made at startPreview can land
                // before there is anything to flip. Re-applying here is what makes "front" mean
                // front on the first frame instead of the second tap. Posted to the UI thread
                // because this callback arrives on a camera thread and everything else that drives
                // the stream runs on the main one.
                activity.runOnUiThread { applyFacing() }
            }

            override fun onCameraDisconnected() {
                emitDeviceLost(
                    "camera",
                    recoverable = false,
                    technical = "the camera was taken by another app or the OS",
                )
            }
        })
        created.setEncoderErrorCallback(object : CodecErrorCallback {
            override fun onCodecError(type: CodecUtil.CodecTypeError, e: MediaCodec.CodecException) {
                val id = activeId() ?: return
                emitState(
                    id,
                    "failed",
                    code = "ENCODER_FAILED",
                    technical = "$type: ${e.diagnosticInfo}",
                )
            }
        })
        stream = created
        prepared = null
        return created
    }

    private fun releaseStream() {
        val s = stream ?: return
        stream = null
        prepared = null
        try {
            if (s.isRecording) s.stopRecord()
            if (s.isStreaming) s.stopStream()
            if (s.isOnPreview) s.stopPreview()
            s.release()
        } catch (e: IllegalStateException) {
            Log.w(TAG, "release raced a teardown: ${e.javaClass.simpleName}")
        }
    }

    /** The single live output, if there is one. `maxStreams()` is 1, so there is at most one. */
    private fun activeId(): String? = sessions.keys.firstOrNull()

    /**
     * The notification's "End broadcast" action. Ends every push, drops the service, and tells
     * JavaScript, so the destination card stops saying LIVE the moment the bytes stop.
     */
    private fun endEverythingFromNotification() {
        val ended = sessions.keys.toList()
        sessions.clear()
        stream?.let { s ->
            if (s.isRecording) s.stopRecord()
            if (s.isStreaming) s.stopStream()
        }
        recordingPath = null
        recordingStartedAt = 0L
        ended.forEach { id ->
            emitState(
                id,
                "disconnected",
                code = "INGEST_DISCONNECTED",
                technical = "ended from the Android notification",
            )
        }
    }

    // ------------------------------------------------------------------ the preview surface

    /**
     * Create the GL surface once and slide it in behind the WebView.
     *
     * Index 0 of the WebView's own parent, not of the activity's content view: Capacitor inflates
     * `activity_main.xml` and puts its WebView wherever that layout says, so the only reliably
     * "behind the WebView" position is the sibling slot before it. A `SurfaceView` renders below
     * the window's own surface, so a transparent WebView on top of it composites correctly without
     * `setZOrderOnTop`, which would put the camera ABOVE the UI.
     */
    private fun ensurePreviewView(): OpenGlView {
        previewView?.let { return it }
        val view = OpenGlView(activity)
        // Adjust letterboxes rather than stretching. A 16:9 sensor squashed into a 9:16 preview is
        // the exact dishonesty this product exists to avoid: what the creator sees has to be what
        // the encoder is fed.
        view.setAspectRatioMode(AspectRatioMode.Adjust)
        view.visibility = View.GONE
        val web = bridge.webView
        (web.parent as? ViewGroup)?.addView(
            view,
            0,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        previewView = view
        return view
    }

    private fun showPreviewSurface(view: OpenGlView) {
        view.visibility = View.VISIBLE
        // The WebView has to stop painting its own background or it hides the camera behind it.
        // The studio screen draws its chrome over a transparent stage on this host; see
        // docs/architecture/MOBILE_ARCHITECTURE.md "Preview compositing".
        bridge.webView.setBackgroundColor(Color.TRANSPARENT)
    }

    private fun hidePreviewSurface() {
        previewView?.visibility = View.GONE
        // Back to the app background declared in capacitor.config.ts (android.backgroundColor), so
        // a non-preview screen is not see-through onto the bare window.
        bridge.webView.setBackgroundColor(APP_BACKGROUND)
    }

    // ------------------------------------------------------------------ helpers

    /** Run `block` on the UI thread and turn anything it throws into a rejected call. */
    private fun onUi(call: PluginCall, block: () -> Unit) {
        activity.runOnUiThread {
            try {
                block()
            } catch (e: Exception) {
                Log.e(TAG, "native call failed: ${e.javaClass.simpleName}: ${e.message}")
                call.reject(redact("${e.javaClass.simpleName}: ${e.message}"))
            }
        }
    }

    private fun applyFacing() {
        val camera = stream?.videoSource as? Camera2Source ?: return
        val wanted = if (wantFront) CameraHelper.Facing.FRONT else CameraHelper.Facing.BACK
        // There is no "open facing X" on Camera2Source in 2.8.1, only a flip, so the wanted facing
        // is reached by comparing and switching once. Reading it before the device is open returns
        // the default, which is why this runs after startPreview rather than before it.
        val current = try {
            camera.getCameraFacing()
        } catch (e: IllegalStateException) {
            return
        }
        if (current != wanted) camera.switchCamera()
    }

    private fun applyMute() {
        // Mute at the source, not at the encoder: an encoder configured for stereo AAC must keep
        // producing frames or the RTMP timestamps drift. MicrophoneSource.mute() feeds silence.
        val mic = stream?.audioSource as? MicrophoneSource ?: return
        if (muted) mic.mute() else mic.unMute()
    }

    private fun missingCapturePermissions(): List<String> = buildList {
        if (!granted(Manifest.permission.CAMERA)) add("camera")
        if (!granted(Manifest.permission.RECORD_AUDIO)) add("microphone")
    }

    private fun granted(permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Preview geometry per aspect. These are the shape the GL surface is configured with, not the
     * broadcast format: `startStream` re-prepares the graph with the width/height/fps/bitrate that
     * core's `resolveFormats()` resolved for the actual destination, so nothing here reaches the
     * wire.
     */
    private fun previewSize(aspect: String): Pair<Int, Int> = when (aspect) {
        "16:9" -> 1280 to 720
        "1:1" -> 720 to 720
        else -> 720 to 1280
    }

    /** Portrait capture needs a 90-degree encoder rotation; landscape needs none. */
    private fun rotationFor(width: Int, height: Int): Int = if (height > width) 90 else 0

    private fun thermalName(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unknown"
        val pm = context.getSystemService(PowerManager::class.java) ?: return "unknown"
        return thermalLevelOf(pm.currentThermalStatus)
    }

    private fun thermalLevelOf(status: Int): String = when (status) {
        PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
        PowerManager.THERMAL_STATUS_MODERATE -> "fair"
        PowerManager.THERMAL_STATUS_SEVERE -> "serious"
        else -> "critical"
    }

    /**
     * Map RootEncoder's free-text failure reason onto a core `ErrorCode`. The reason string comes
     * from the library and may echo the endpoint, so it is redacted before it ever leaves here.
     */
    private fun mapFailure(reason: String): String {
        val r = reason.lowercase()
        return when {
            "unauthorized" in r || "auth" in r -> "INGEST_INVALID_KEY"
            "timeout" in r || "timed out" in r -> "INGEST_TIMEOUT"
            "refused" in r || "reset" in r -> "INGEST_REFUSED"
            "unreachable" in r || "resolve" in r || "network" in r -> "NETWORK_OFFLINE"
            else -> "PLATFORM_ERROR"
        }
    }

    /** Strip anything that could be a stream key before a message crosses into JavaScript. */
    private fun redact(message: String): String =
        message.replace(Regex("rtmps?://\\S+"), "rtmp://<redacted>")

    override fun handleOnDestroy() {
        LiveForegroundService.onStopRequested = null
        unregisterThermalListener()
        sessions.clear()
        releaseStream()
        LiveForegroundService.stopLive(context)
        super.handleOnDestroy()
    }

    companion object {
        private const val TAG = "LiveStreamPlugin"

        /** Rejection code the JS layer matches on to send the creator back to the permission step. */
        private const val PERMISSION_DENIED = "PERMISSION_DENIED"

        /** Mirrors `android.backgroundColor` in apps/mobile/capacitor.config.ts. */
        private const val APP_BACKGROUND = 0xFF0B0B0F.toInt()

        // Preview-only encoder settings. Deliberately modest: the preview exists to show a picture
        // and to hold the camera open, and re-preparing at the destination's real format is one
        // call away in startStream.
        private const val PREVIEW_FPS = 30
        private const val PREVIEW_VIDEO_KBPS = 2500
        private const val PREVIEW_AUDIO_KBPS = 128
        private const val PREVIEW_KEYFRAME_SECONDS = 2
    }
}
