package app.livetap.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * App-local Capacitor plugins are not auto-discovered: the bridge registers the classes listed
     * in the generated `capacitor.plugins.json`, which only covers npm plugins. Registration must
     * therefore happen BEFORE `super.onCreate()`, because that is where BridgeActivity builds the
     * bridge from `initialPlugins`.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LiveStreamPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
