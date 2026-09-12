package app.livetap.mobile;

import com.getcapacitor.BridgeActivity;

/**
 * The single Capacitor activity.
 *
 * No manual plugin registration. LiveStream used to be registered here with
 * {@code registerPlugin(LiveStreamPlugin.class)} before {@code super.onCreate()}, because an
 * app-local plugin class is not discovered by anything. It now ships as the workspace package
 * {@code @livetap/capacitor-live-stream}, so {@code npx cap sync android} finds the
 * {@code @CapacitorPlugin(name = "LiveStream")} annotation and writes its classpath into
 * {@code src/main/assets/capacitor.plugins.json}, which {@code BridgeActivity} loads for us.
 *
 * That also fixed iOS, where no equivalent manual hook exists — see
 * docs/architecture/MOBILE_ARCHITECTURE.md §3.
 */
public class MainActivity extends BridgeActivity {}
