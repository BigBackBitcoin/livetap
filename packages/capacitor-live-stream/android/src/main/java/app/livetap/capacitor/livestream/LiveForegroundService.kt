package app.livetap.capacitor.livestream

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * LiveForegroundService — keeps the encoder and the RTMP socket alive while LIVETAP is broadcasting.
 *
 * WHY THIS EXISTS
 * Android kills background work aggressively. Without a foreground service the encoder stops the
 * moment the user pulls down a notification or answers a message, and the broadcast dies. This is
 * the Android half of the asymmetry documented in
 * docs/research/DESKTOP_MOBILE_STORE_RESEARCH.md section 2.3: Android CAN keep the camera running in
 * the background behind an FGS; iOS cannot without an Apple-gated entitlement.
 *
 * ANDROID 14+ RULES THIS CLASS ENCODES
 * - This module's own `android/src/main/AndroidManifest.xml` declares the service with
 *   `foregroundServiceType="camera|microphone|mediaProjection"` and is merged into the host app's
 *   manifest by the manifest merger. The same set must also be declared in Play Console
 *   (Policy -> App content).
 * - `ServiceCompat.startForeground(..., type)` must be called with the type bitmask that matches
 *   the permissions actually held, or the platform throws
 *   `MissingForegroundServiceTypeException` / `SecurityException`.
 * - `camera` and `microphone` FGS types are **while-in-use**: this service can only be started
 *   while the app is in the foreground. `startLive()` must therefore be called from the
 *   `GO LIVE` tap, never from a background callback or a BOOT_COMPLETED receiver (Android 15
 *   additionally forbids the latter for `mediaProjection`).
 * - MediaProjection ordering is strict and is NOT handled here: the consent Intent from
 *   `MediaProjectionManager.createScreenCaptureIntent()` must be obtained first, then this
 *   service started with `EXTRA_MEDIA_PROJECTION`, and only then may
 *   `getMediaProjection(resultCode, data)` be called. The consent Intent is single-use — caching
 *   and replaying it throws. Screen capture is post-MVP; the plumbing is marked below.
 *
 * VERIFICATION: this class COMPILES (Android SDK 36 + JDK 21 are present on the build host) and
 * ships in the debug APK's dex, and the manifest merger's output is asserted against. It has never
 * been RUN: there is no emulator image and no nested virtualisation here, so the notification, its
 * "End broadcast" action and the Android 14+ startForeground type check are owner-hardware steps in
 * docs/release/ANDROID_MANUAL_TEST.md. See docs/architecture/MOBILE_ARCHITECTURE.md.
 */
class LiveForegroundService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                // End the BROADCAST, then the service. Stopping only the service used to leave every
                // GenericStream encoding with an open RTMP socket and no foreground service, which
                // on Android 14+ means the push dies at a moment the OS picks, with nothing reaching
                // JavaScript and the destination card still reading LIVE. onStartCommand runs on the
                // main thread, which is where the encoder teardown has to happen anyway.
                onStopRequested?.invoke()
                stopSelf()
                return START_NOT_STICKY
            }
        }

        val withScreen = intent?.getBooleanExtra(EXTRA_WITH_SCREEN, false) ?: false
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "LIVETAP is live"
        val detail = intent?.getStringExtra(EXTRA_DETAIL) ?: "Tap to return to LIVETAP"

        createChannel()

        val type = if (withScreen) {
            // TODO(device): the mediaProjection path is post-MVP. Starting with this type requires
            // a fresh consent Intent handed in by the Activity; see the ordering note above.
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }

        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(title, detail), type)
        } catch (e: Exception) {
            // A SecurityException here means a type-specific permission is missing or the service
            // was started from the background. Failing loudly beats a zombie service.
            Log.e(TAG, "startForeground refused: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }

        acquireWakeLock()
        return START_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    /**
     * A partial wake lock keeps the CPU encoding when the screen turns off. It does NOT keep the
     * screen on — the preview surface is allowed to go dark while audio and video keep flowing.
     * Released in onDestroy so a crashed broadcast cannot drain the battery silently.
     */
    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$TAG:broadcast").apply {
            setReferenceCounted(false)
            acquire(MAX_BROADCAST_MS)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Live broadcast",
            // LOW: the notification is a control surface and a legal requirement, not an alert.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while LIVETAP is broadcasting so you always know the camera is on."
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(title: String, detail: String): Notification {
        // The tap target is resolved from the package manager rather than named as a class. A
        // library module cannot reference the host app's MainActivity, and hard-coding one would
        // make this plugin usable by exactly one app. `getLaunchIntentForPackage` returns the
        // activity the launcher itself would start, which is the same thing the user expects.
        val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = open?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val stop = Intent(this, LiveForegroundService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this,
            1,
            stop,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(detail)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .apply { openPending?.let { setContentIntent(it) } }
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End broadcast", stopPending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    companion object {
        private const val TAG = "LiveForegroundService"
        private const val CHANNEL_ID = "livetap.broadcast"
        private const val NOTIFICATION_ID = 4201

        /** 6 hours. A broadcast longer than this has to re-acquire; the lock is not open-ended. */
        private const val MAX_BROADCAST_MS = 6L * 60L * 60L * 1000L

        const val ACTION_STOP = "app.livetap.capacitor.livestream.action.STOP_BROADCAST"

        /**
         * How the notification's "End broadcast" action reaches the encoder.
         *
         * A field rather than a bound Service or a LocalBroadcast because the service and the plugin
         * are the same process and the same main thread, and the alternatives both add a round trip
         * the user would feel: binding is asynchronous, and a broadcast is queued. LiveStreamPlugin
         * installs this in `load()` and clears it in `handleOnDestroy()`, so there is exactly one
         * owner and it is never a stale one.
         */
        @Volatile
        @JvmStatic
        var onStopRequested: (() -> Unit)? = null
        const val EXTRA_WITH_SCREEN = "withScreen"
        const val EXTRA_TITLE = "title"
        const val EXTRA_DETAIL = "detail"

        /**
         * Must be called while the app is in the foreground (camera/microphone FGS types are
         * while-in-use restricted).
         */
        fun startLive(context: Context, title: String, detail: String, withScreen: Boolean = false) {
            val intent = Intent(context, LiveForegroundService::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_DETAIL, detail)
                .putExtra(EXTRA_WITH_SCREEN, withScreen)
            context.startForegroundService(intent)
        }

        fun stopLive(context: Context) {
            context.stopService(Intent(context, LiveForegroundService::class.java))
        }
    }
}
