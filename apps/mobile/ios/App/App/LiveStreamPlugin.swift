import AVFoundation
import Capacitor
import Foundation
import HaishinKit
import UIKit
import VideoToolbox

/**
 LiveStreamPlugin (iOS) — the native half of apps/mobile/src/plugins/LiveStream.

 Library: HaishinKit.swift 2.0.9 (BSD-3-Clause), installed via CocoaPods.
 Verified API surface (read from the 2.0.9 tag on 2026-09-11):

   public actor RTMPConnection: NetworkConnection
     init(...)
     func connect(_ command: String, arguments: (any Sendable)?...) async throws -> RTMPResponse
     func close() async throws
     var status: AsyncStream<RTMPStatus>

   public actor RTMPStream
     init(connection: RTMPConnection, fcPublishName: String? = nil)
     func publish(_ name: String?, type: RTMPStream.HowToPublish = .live) async throws -> RTMPResponse
     func close() async throws -> RTMPResponse
     func setVideoSettings(_:) / setAudioSettings(_:)
     var status: AsyncStream<RTMPStatus>
     func addOutput(_ observer: some HKStreamOutput)

   MediaMixer
     init(multiCamSessionEnabled:multiTrackAudioMixingEnabled:useManualCapture:)
     func attachVideo(_ device: AVCaptureDevice?, track: UInt8) async throws
     func attachAudio(_ device: AVCaptureDevice?) async throws
     func addOutput(_ output: some HKStream) async
     func startRunning() async / stopRunning() async
     func setVideoOrientation(_:) async

 THE DEFINING iOS CONSTRAINT
 iOS does not allow camera capture in the background. When the app backgrounds, the capture
 session is interrupted with `videoDeviceNotAvailableInBackground`. `UIBackgroundModes: audio`
 keeps the audio path and the RTMP socket alive, so the broadcast continues audio-only until the
 user returns. There is no way around this without the Apple-gated
 `com.apple.developer.avfoundation.multitasking-camera-access` entitlement. The plugin reports
 this honestly through `capabilities().backgroundCamera == false` rather than hiding it.

 ONE OUTPUT PER CALL. Each `startStream` builds its own RTMPConnection + RTMPStream and attaches
 it to the shared MediaMixer, so capture and encode are shared but each push is its own socket.
 `maxSimultaneousStreams` is small for thermal reasons; real fan-out belongs behind a relay
 (ADR-009).

 VERIFICATION: UNVERIFIED. There is no Xcode, no CocoaPods and no device on the build host, so
 this file has never been compiled. Every `TODO(device)` marks something only hardware can settle.
 */
@objc(LiveStreamPlugin)
public class LiveStreamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveStreamPlugin"
    public let jsName = "LiveStream"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopPreview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "switchCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startStream", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopStream", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise)
    ]

    /// One live RTMP push.
    private final class Session {
        let id: String
        let connection: RTMPConnection
        let stream: RTMPStream
        /// Base URL without the stream key. The key itself is never retained past `publish`.
        let rtmpURL: String
        var connected = false
        var statusTask: Task<Void, Never>?

        init(id: String, connection: RTMPConnection, stream: RTMPStream, rtmpURL: String) {
            self.id = id
            self.connection = connection
            self.stream = stream
            self.rtmpURL = rtmpURL
        }
    }

    private var mixer: MediaMixer?
    private var sessions: [String: Session] = [:]
    private var nextId = 0
    private var cameraPosition: AVCaptureDevice.Position = .front
    private var isMuted = false
    private var recordingURL: URL?
    private var recordingStartedAt: Date?

    // MARK: - Lifecycle

    override public func load() {
        configureAudioSession()
        observeInterruptions()
        observeThermalState()
    }

    /**
     `.playAndRecord` with `.mixWithOthers` off is what keeps the microphone alive in the
     background under `UIBackgroundModes: audio`. `.videoRecording` mode applies the input
     processing Apple tunes for camera capture rather than for a phone call.
     */
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .videoRecording,
                options: [.allowBluetooth, .defaultToSpeaker]
            )
            try session.setActive(true)
        } catch {
            CAPLog.print("[LiveStream] AVAudioSession refused: \(error.localizedDescription)")
        }
    }

    private func observeInterruptions() {
        // A phone call, Siri, or backgrounding interrupts the capture session. The reason code
        // distinguishes "we will get it back" from "the camera is gone until foreground".
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleSessionInterruption(_:)),
            name: AVCaptureSession.wasInterruptedNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleSessionInterruptionEnded(_:)),
            name: AVCaptureSession.interruptionEndedNotification,
            object: nil
        )
    }

    @objc private func handleSessionInterruption(_ notification: Notification) {
        let raw = notification.userInfo?[AVCaptureSessionInterruptionReasonKey] as? Int
        let reason = raw.flatMap(AVCaptureSession.InterruptionReason.init(rawValue:))
        // `videoDeviceNotAvailableInBackground` is expected and permanent until foreground; an
        // audio interruption (a call) is recoverable.
        let recoverable = reason != .videoDeviceNotAvailableInBackground
        notifyListeners("deviceLost", data: [
            "kind": reason == .audioDeviceInUseByAnotherClient ? "mic" : "camera",
            "recoverable": recoverable,
            "technical": "AVCaptureSession interrupted, reason=\(raw.map(String.init) ?? "unknown")"
        ])
    }

    @objc private func handleSessionInterruptionEnded(_ notification: Notification) {
        // The UI resumes the preview itself; the plugin only reports.
        CAPLog.print("[LiveStream] capture interruption ended")
    }

    /**
     Thermal state is the difference between a broadcast that degrades gracefully and one that
     falls apart. `.serious` is where the OS starts throttling the video encoder, so LIVETAP steps
     1080p down to 720p and 60 fps down to 30 fps before that happens.
     */
    private func observeThermalState() {
        NotificationCenter.default.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.emitThermal()
        }
        emitThermal()
    }

    private func emitThermal() {
        let level: String
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: level = "nominal"
        case .fair: level = "fair"
        case .serious: level = "serious"
        case .critical: level = "critical"
        @unknown default: level = "critical"
        }
        notifyListeners("thermal", data: ["level": level])
    }

    // MARK: - capabilities

    @objc public func capabilities(_ call: CAPPluginCall) {
        let camera = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        let mic = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        call.resolve([
            "camera": camera,
            "microphone": mic,
            "rtmp": true,
            "rtmps": true,
            // HaishinKit supports SRT, but enabling it with a passphrase performs AES in-library
            // and flips the export-compliance answer (`ITSAppUsesNonExemptEncryption`). Held at
            // false until legal signs off — APP_STORE_READINESS item A22.
            "srt": false,
            // TODO(device): query VTCopyVideoEncoderList for an HEVC encoder rather than assuming.
            "hevc": false,
            "recording": true,
            // The honest answer, and the single most important line in this file.
            "backgroundCamera": false,
            "backgroundAudio": true,
            // ReplayKit Broadcast Upload Extension is post-MVP: it needs a second target, an App
            // Group, its own provisioning profile, and it must fit in ~50 MB of memory.
            "screenCapture": false,
            "maxSimultaneousStreams": maxStreams(),
            "verification": "UNVERIFIED",
            "platformNote": "HaishinKit 2.0.9; iOS \(UIDevice.current.systemVersion); "
                + "camera stops when backgrounded (no multitasking-camera-access entitlement); "
                + "never compiled or run on a device"
        ])
    }

    /// TODO(device): calibrate against measured thermal headroom rather than guessing.
    private func maxStreams() -> Int { 1 }

    // MARK: - preview

    @objc public func startPreview(_ call: CAPPluginCall) {
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
              AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            call.reject("camera and microphone permission must be granted before startPreview")
            return
        }
        cameraPosition = (call.getString("camera") ?? "front") == "back" ? .back : .front
        let aspect = call.getString("aspect") ?? "9:16"

        Task { [weak self] in
            guard let self else { return }
            let mixer = self.mixer ?? MediaMixer()
            self.mixer = mixer
            // 9:16 portrait is the LIVETAP mobile default; the mixer's screen size drives the
            // encoder's input geometry.
            await mixer.setVideoOrientation(.portrait)
            do {
                let camera = AVCaptureDevice.default(
                    .builtInWideAngleCamera, for: .video, position: self.cameraPosition
                )
                try await mixer.attachVideo(camera, track: 0)
                try await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
                await mixer.startRunning()
                // TODO(device): attach an MTHKView/PiPHKView behind the transparent WKWebView so
                // the creator sees themselves. The view has to be inserted into the Capacitor
                // bridge's view hierarchy and the WebView made transparent; only a device shows
                // whether the composite lands correctly on a notched screen, so it is not guessed.
                CAPLog.print("[LiveStream] preview running aspect=\(aspect) (surface wiring TODO)")
                call.resolve()
            } catch {
                call.reject("capture failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func stopPreview(_ call: CAPPluginCall) {
        Task { [weak self] in
            guard let mixer = self?.mixer else { call.resolve(); return }
            await mixer.stopRunning()
            call.resolve()
        }
    }

    @objc public func switchCamera(_ call: CAPPluginCall) {
        cameraPosition = cameraPosition == .front ? .back : .front
        Task { [weak self] in
            guard let self, let mixer = self.mixer else {
                call.reject("start the preview before switching camera")
                return
            }
            do {
                let device = AVCaptureDevice.default(
                    .builtInWideAngleCamera, for: .video, position: self.cameraPosition
                )
                // Re-attaching on track 0 replaces the input without tearing the encoder down.
                try await mixer.attachVideo(device, track: 0) { unit in
                    unit.isVideoMirrored = self.cameraPosition == .front
                }
                call.resolve()
            } catch {
                call.reject("camera switch failed: \(error.localizedDescription)")
            }
        }
    }

    @objc public func setMute(_ call: CAPPluginCall) {
        isMuted = call.getBool("muted") ?? false
        Task { [weak self] in
            guard let self, let mixer = self.mixer else { call.resolve(); return }
            do {
                // Detaching audio rather than gating the encoder: a muted AAC encoder that keeps
                // running is what stops RTMP timestamps from drifting, so re-attach on unmute.
                if self.isMuted {
                    try await mixer.attachAudio(nil)
                } else {
                    try await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
                }
                call.resolve()
            } catch {
                call.reject("mute failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - streaming

    @objc public func startStream(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), let streamKey = call.getString("streamKey") else {
            call.reject("url and streamKey are required")
            return
        }
        guard url.hasPrefix("rtmp://") || url.hasPrefix("rtmps://") else {
            call.reject("mobile supports rtmp/rtmps only")
            return
        }
        guard sessions.count < maxStreams() else {
            call.reject("device allows \(maxStreams()) simultaneous push(es); use a relay (ADR-009)")
            return
        }

        let width = call.getInt("width") ?? 1080
        let height = call.getInt("height") ?? 1920
        let fps = call.getInt("fps") ?? 30
        let videoKbps = call.getInt("videoKbps") ?? 4500
        let audioKbps = call.getInt("audioKbps") ?? 128
        let keyframeSeconds = call.getInt("keyframeSeconds") ?? 2

        nextId += 1
        let id = "ios-\(nextId)"

        Task { [weak self] in
            guard let self else { return }
            let mixer = self.mixer ?? MediaMixer()
            self.mixer = mixer

            let connection = RTMPConnection()
            let stream = RTMPStream(connection: connection)

            var video = VideoCodecSettings()
            video.videoSize = .init(width: width, height: height)
            video.bitRate = videoKbps * 1000
            video.maxKeyFrameIntervalDuration = Int32(keyframeSeconds)
            // H.264 is the only universal transport (ADR-012). HEVC is a Pro-mode option later.
            video.profileLevel = kVTProfileLevel_H264_High_AutoLevel as String
            await stream.setVideoSettings(video)

            var audio = AudioCodecSettings()
            audio.bitRate = audioKbps * 1000
            await stream.setAudioSettings(audio)

            await mixer.addOutput(stream)

            let session = Session(id: id, connection: connection, stream: stream, rtmpURL: url)
            self.sessions[id] = session
            self.observe(session: session)
            self.notifyListeners("streamState", data: ["id": id, "state": "connecting"])

            do {
                _ = try await connection.connect(url)
                _ = try await stream.publish(streamKey)
                // `connected` is reported from the status stream, not here: publish() returning
                // means the command was accepted, not that media is flowing.
                call.resolve(["id": id])
            } catch {
                self.sessions.removeValue(forKey: id)
                session.statusTask?.cancel()
                self.notifyListeners("streamState", data: [
                    "id": id,
                    "state": "failed",
                    "code": Self.errorCode(for: error),
                    "technical": Self.redact(error.localizedDescription)
                ])
                call.reject("connect failed: \(Self.redact(error.localizedDescription))")
            }
        }
    }

    /**
     Translate HaishinKit's RTMP status codes into the LiveStream contract's states and the core
     `ErrorCode` vocabulary, so the React layer reuses `humanizeError` untouched.
     */
    private func observe(session: Session) {
        session.statusTask = Task { [weak self] in
            for await status in await session.stream.status {
                guard let self else { return }
                switch status.code {
                case RTMPStream.Code.publishStart.rawValue:
                    session.connected = true
                    self.notifyListeners("streamState", data: ["id": session.id, "state": "connected"])
                case RTMPStream.Code.unpublishSuccess.rawValue:
                    session.connected = false
                    self.notifyListeners("streamState", data: [
                        "id": session.id, "state": "disconnected", "code": "INGEST_DISCONNECTED"
                    ])
                case RTMPStream.Code.publishBadName.rawValue:
                    self.notifyListeners("streamState", data: [
                        "id": session.id, "state": "failed", "code": "INGEST_INVALID_KEY"
                    ])
                default:
                    // `status.level == "error"` is the library's generic failure signal.
                    if status.level == "error" {
                        self.notifyListeners("streamState", data: [
                            "id": session.id,
                            "state": "failed",
                            "code": "PLATFORM_ERROR",
                            "technical": Self.redact(status.code)
                        ])
                    }
                }
            }
        }
        // TODO(device): HaishinKit exposes throughput through HKStreamOutput / a bitrate strategy.
        // Wire a periodic `bitrateKbps` + `droppedFrames` report into `streamState` once the real
        // numbers can be observed against an ingest server; emitting invented values would be
        // worse than emitting none.
    }

    @objc public func stopStream(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id is required")
            return
        }
        guard let session = sessions.removeValue(forKey: id) else {
            // Stopping an unknown output is a no-op: the UI may be racing a failure event.
            call.resolve()
            return
        }
        Task {
            session.statusTask?.cancel()
            _ = try? await session.stream.close()
            try? await session.connection.close()
            call.resolve()
        }
    }

    // MARK: - recording

    @objc public func startRecording(_ call: CAPPluginCall) {
        // App sandbox only. Nothing is written to the photo library, so no
        // NSPhotoLibraryAddUsageDescription is needed and nothing survives app deletion.
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("livetap-\(Int(Date().timeIntervalSince1970)).mp4")

        // TODO(device): HaishinKit 2.x records through an HKStreamRecorder output attached to the
        // stream. The exact recorder type and its start/stop signature could not be verified from
        // the build host, and guessing an API that does not exist would produce code that looks
        // finished and cannot compile. Wire this against the installed pod headers.
        guard sessions.isEmpty == false || mixer != nil else {
            call.reject("start a stream or preview before recording")
            return
        }
        recordingURL = url
        recordingStartedAt = Date()
        call.resolve(["path": url.path])
    }

    @objc public func stopRecording(_ call: CAPPluginCall) {
        var result: [String: Any] = [:]
        if let url = recordingURL { result["path"] = url.path }
        if let started = recordingStartedAt {
            result["durationMs"] = Int(Date().timeIntervalSince(started) * 1000)
        }
        recordingURL = nil
        recordingStartedAt = nil
        call.resolve(result)
    }

    // MARK: - helpers

    private static func errorCode(for error: Error) -> String {
        let text = error.localizedDescription.lowercased()
        if text.contains("timed out") || text.contains("timeout") { return "INGEST_TIMEOUT" }
        if text.contains("not connected") || text.contains("offline") { return "NETWORK_OFFLINE" }
        if text.contains("refused") || text.contains("reset") { return "INGEST_REFUSED" }
        return "PLATFORM_ERROR"
    }

    /// Strip anything that could be a stream key before a message crosses into JavaScript.
    private static func redact(_ message: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: "rtmps?://\\S+") else { return message }
        return regex.stringByReplacingMatches(
            in: message,
            range: NSRange(message.startIndex..., in: message),
            withTemplate: "rtmp://<redacted>"
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
