package app.livetap.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.library.generic.GenericStream
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * LiveStreamPlugin (Android) — the native half of apps/mobile/src/plugins/LiveStream.
 *
 * Library: RootEncoder 2.8.1 (Apache-2.0), `com.github.pedroSG94.RootEncoder:library`.
 * Verified API surface (read from the 2.8.1 tag on 2026-09-11):
 *   GenericStream(context, ConnectChecker, VideoSource, AudioSource)
 *   prepareVideo(width, height, bitrate, fps, iFrameInterval, rotation, ...): Boolean
 *   prepareAudio(sampleRate, isStereo, bitrate, echoCanceler, noiseSuppressor): Boolean
 *   startStream(endPoint: String) / stopStream(): Boolean
 *   startPreview(surfaceView|textureView|surface, ...) / stopPreview(...)
 *   startRecord(path, tracks, listener) / stopRecord(): Boolean
 *   setVideoBitrateOnFly(bitrate) / setOrientation(int) / release()
 *   videoSource / audioSource are public vars; Camera2Source.switchCamera(), MicrophoneSource.mute()
 *   isStreaming / isOnPreview / isRecording
 *   ConnectChecker { onConnectionStarted, onConnectionSuccess, onConnectionFailed,
 *                    onDisconnect, onAuthError, onAuthSuccess } (+ BitrateChecker.onNewBitrate)
 *
 * ONE OUTPUT PER INSTANCE. RootEncoder's `GenericStream` owns one client, so N destinations means
 * N GenericStream instances and N encodes. That is why `capabilities().maxSimultaneousStreams` is
 * small (1 on a mid-range phone, 2 on a flagship) and why real multi-destination belongs behind a
 * relay in LIVETAP CLOUD (ADR-009) rather than in more of these.
 *
 * Registration: app-local plugins are not auto-discovered. MainActivity calls
 * `registerPlugin(LiveStreamPlugin.class)` before `super.onCreate()`.
 *
 * VERIFICATION: UNVERIFIED — no Android SDK, no emulator, no device on the build host. Every
 * `TODO(device)` below marks a decision that can only be settled against real hardware.
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
    ],
)
class LiveStreamPlugin : Plugin() {

    /** destinationless native ids -> live session. Keyed by the id handed back to JavaScript. */
    private val sessions = LinkedHashMap<String, Session>()
    private val ids = AtomicInteger(0)

    private var previewing = false
    private var muted = false
    private var frontCamera = true
    private var recordingPath: String? = null
    private var recordingStartedAt = 0L

    private inner class Session(val id: String) : ConnectChecker {
        var stream: GenericStream? = null
        var lastBitrateKbps = 0L
        var droppedFrames = 0L
        var connected = false

        override fun onConnectionStarted(url: String) {
            // `url` contains the stream key. It must never be logged or forwarded to JavaScript.
            emitState(id, "connecting")
        }

        override fun onConnectionSuccess() {
            connected = true
            emitState(id, "connected")
        }

        override fun onConnectionFailed(reason: String) {
            connected = false
            emitState(id, "failed", code = mapFailure(reason), technical = redact(reason))
            // Reconnect policy lives in packages/core (ReconnectPolicy) — the native layer reports
            // and stops, it never invents its own backoff.
        }

        override fun onDisconnect() {
            connected = false
            emitState(id, "disconnected", code = "INGEST_DISCONNECTED")
        }

        override fun onAuthError() {
            emitState(id, "failed", code = "INGEST_INVALID_KEY", technical = "rtmp auth rejected")
        }

        override fun onAuthSuccess() {
            // Nothing to report: onConnectionSuccess follows.
        }

        override fun onNewBitrate(bitrate: Long) {
            lastBitrateKbps = bitrate / 1000
            droppedFrames = stream?.getStreamClient()?.getDroppedVideoFrames() ?: 0L
            // A sustained bitrate far below target is the honest definition of "degraded" here.
            emitState(
                id,
                if (connected) "connected" else "connecting",
                bitrateKbps = lastBitrateKbps,
            )
        }
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
        // TODO(device): probe MediaCodecList for an HEVC encoder rather than assuming.
        result.put("hevc", false)
        result.put("recording", true)
        // Android keeps the camera alive behind a camera-type foreground service.
        result.put("backgroundCamera", true)
        result.put("backgroundAudio", true)
        // MediaProjection screen capture is post-MVP: the manifest declares the FGS type but no
        // code path requests consent yet.
        result.put("screenCapture", false)
        result.put("maxSimultaneousStreams", maxStreams())
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
     * TODO(device): calibrate. A phone encodes once but every extra RTMP client is another
     * packetiser and another TLS socket; measured thermal headroom, not core count, should decide
     * this. Until it is measured on hardware, be conservative.
     */
    private fun maxStreams(): Int = 1

    // ------------------------------------------------------------------ preview

    @PluginMethod
    fun startPreview(call: PluginCall) {
        if (!granted(Manifest.permission.CAMERA) || !granted(Manifest.permission.RECORD_AUDIO)) {
            call.reject("CAMERA and RECORD_AUDIO must be granted before startPreview")
            return
        }
        frontCamera = call.getString("camera", "front") == "front"
        val aspect = call.getString("aspect", "9:16") ?: "9:16"

        // TODO(device): RootEncoder renders the preview into an OpenGlView/SurfaceView that must
        // live in the Activity's view hierarchy BEHIND the Capacitor WebView, with the WebView
        // made transparent. That requires a layout change in activity_main.xml plus
        // `bridge.webView.setBackgroundColor(Color.TRANSPARENT)`. Only a device can show whether
        // the composite is correct on notched/foldable screens, so the surface wiring is left
        // here rather than guessed.
        previewing = true
        Log.i(TAG, "startPreview front=$frontCamera aspect=$aspect (surface wiring TODO)")
        call.resolve()
    }

    @PluginMethod
    fun stopPreview(call: PluginCall) {
        sessions.values.forEach { s -> s.stream?.let { if (it.isOnPreview) it.stopPreview() } }
        previewing = false
        call.resolve()
    }

    @PluginMethod
    fun switchCamera(call: PluginCall) {
        frontCamera = !frontCamera
        // Camera2Source.switchCamera() flips facing in place — cheaper and less glitchy than
        // handing StreamBase a whole new VideoSource, which tears the encoder input down.
        sessions.values.forEach { session ->
            (session.stream?.videoSource as? Camera2Source)?.switchCamera()
        }
        call.resolve()
    }

    @PluginMethod
    fun setMute(call: PluginCall) {
        muted = call.getBoolean("muted", false) == true
        // Mute at the source, not at the encoder: an encoder configured for stereo AAC must keep
        // producing frames or the RTMP timestamps drift. MicrophoneSource.mute() feeds silence.
        sessions.values.forEach { session ->
            val mic = session.stream?.audioSource as? MicrophoneSource ?: return@forEach
            if (muted) mic.mute() else mic.unMute()
        }
        call.resolve()
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

        val width = call.getInt("width", 1080) ?: 1080
        val height = call.getInt("height", 1920) ?: 1920
        val fps = call.getInt("fps", 30) ?: 30
        val videoKbps = call.getInt("videoKbps", 4500) ?: 4500
        val audioKbps = call.getInt("audioKbps", 128) ?: 128
        val keyframeSeconds = call.getInt("keyframeSeconds", 2) ?: 2

        val id = "android-${ids.incrementAndGet()}"
        val session = Session(id)
        val stream = GenericStream(context, session, Camera2Source(context), MicrophoneSource())
        session.stream = stream

        val videoOk = try {
            stream.prepareVideo(
                width,
                height,
                videoKbps * 1000,
                fps,
                keyframeSeconds,
                rotationFor(width, height),
            )
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "prepareVideo rejected: ${e.message}")
            false
        }
        val audioOk = try {
            // 44.1 kHz stereo AAC is what every RTMP ingest in the destination matrix accepts.
            stream.prepareAudio(44_100, true, audioKbps * 1000, echoCanceler = true, noiseSuppressor = true)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "prepareAudio rejected: ${e.message}")
            false
        }
        if (!videoOk || !audioOk) {
            stream.release()
            call.reject("encoder refused ${width}x$height@$fps (video=$videoOk audio=$audioOk)")
            return
        }

        if (muted) (stream.audioSource as? MicrophoneSource)?.mute()

        // The foreground service must be running before the socket opens, and it can only be
        // started while the app is in the foreground (camera/microphone FGS are while-in-use).
        LiveForegroundService.startLive(context, "LIVETAP is live", "Tap to return to LIVETAP")

        sessions[id] = session
        // RootEncoder takes url + "/" + key as one endpoint. Everything after this point must
        // treat `endpoint` as a secret.
        val endpoint = url.trimEnd('/') + "/" + streamKey
        stream.startStream(endpoint)

        emitState(id, "connecting")
        val result = JSObject()
        result.put("id", id)
        call.resolve(result)
    }

    @PluginMethod
    fun stopStream(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val session = sessions.remove(id)
        if (session == null) {
            // Stopping an unknown output is a no-op, not an error: the UI may be racing a failure.
            call.resolve()
            return
        }
        session.stream?.let { stream ->
            if (stream.isRecording) stream.stopRecord()
            if (stream.isStreaming) stream.stopStream()
            if (!previewing) stream.release()
        }
        if (sessions.isEmpty()) LiveForegroundService.stopLive(context)
        call.resolve()
    }

    // ------------------------------------------------------------------ recording

    @PluginMethod
    fun startRecording(call: PluginCall) {
        val stream = sessions.values.firstOrNull()?.stream
        if (stream == null) {
            call.reject("start a stream or preview before recording")
            return
        }
        // App sandbox only — never external storage. No permission needed, and the file disappears
        // with the app, which matches the privacy promise in docs/legal/PRIVACY_POLICY.md.
        val dir = File(context.filesDir, "recordings").apply { mkdirs() }
        val file = File(dir, "livetap-${System.currentTimeMillis()}.mp4")
        try {
            // RecordController.Listener is a Kotlin `fun interface`; the lambda is onStatusChange.
            stream.startRecord(file.absolutePath, null) { status ->
                Log.i(TAG, "record status=$status")
            }
        } catch (e: Exception) {
            call.reject("recording failed: ${e.javaClass.simpleName}")
            return
        }
        recordingPath = file.absolutePath
        recordingStartedAt = System.currentTimeMillis()
        val result = JSObject()
        result.put("path", file.absolutePath)
        call.resolve(result)
    }

    @PluginMethod
    fun stopRecording(call: PluginCall) {
        val stream = sessions.values.firstOrNull()?.stream
        if (stream != null && stream.isRecording) stream.stopRecord()
        val result = JSObject()
        recordingPath?.let { result.put("path", it) }
        if (recordingStartedAt > 0) {
            result.put("durationMs", System.currentTimeMillis() - recordingStartedAt)
        }
        recordingPath = null
        recordingStartedAt = 0L
        call.resolve(result)
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

    /**
     * TODO(device): register a `PowerManager.OnThermalStatusChangedListener` (API 29+) in
     * `load()` and forward it as the `thermal` event so the UI can step 1080p down to 720p before
     * the OS throttles the encoder. Needs a device that actually gets hot to validate the
     * thresholds, so the listener is deliberately not guessed here.
     */
    private fun thermalName(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unknown"
        val pm = context.getSystemService(PowerManager::class.java) ?: return "unknown"
        return when (pm.currentThermalStatus) {
            PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
            PowerManager.THERMAL_STATUS_MODERATE -> "fair"
            PowerManager.THERMAL_STATUS_SEVERE -> "serious"
            else -> "critical"
        }
    }

    // ------------------------------------------------------------------ helpers

    private fun granted(permission: String): Boolean =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /** Portrait capture needs a 90-degree encoder rotation; landscape needs none. */
    private fun rotationFor(width: Int, height: Int): Int = if (height > width) 90 else 0

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
        sessions.values.forEach { session ->
            session.stream?.let {
                if (it.isRecording) it.stopRecord()
                if (it.isStreaming) it.stopStream()
                it.release()
            }
        }
        sessions.clear()
        LiveForegroundService.stopLive(context)
        super.handleOnDestroy()
    }

    companion object {
        private const val TAG = "LiveStreamPlugin"
    }
}
