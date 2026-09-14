package app.livetap.capacitor.livestream

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * LivetapSecureStore: where a stream key or an OAuth token actually lives on Android.
 *
 * WHY THIS EXISTS AT ALL
 * `apps/web/src/state/secrets.ts` keeps secrets in an in-memory `Map` unless it finds a
 * `window.livetap.vault` bridge, which on desktop is Electron `safeStorage`. On Android there was
 * no bridge, so every token died with the process while `AndroidManifest.xml` carried a comment
 * claiming "OAuth tokens live in the Android Keystore-backed secure store". This is that store,
 * and the comment is now true.
 *
 * WHY NOT A THIRD-PARTY PLUGIN
 * `@aparajita/capacitor-secure-storage` was the vetted candidate (MOBILE_ARCHITECTURE "Secure
 * storage"). It would add a dependency, a Gradle module and a `cap sync` step to four engineers'
 * shared `node_modules` for machinery the platform already ships. AES-256/GCM under an
 * AndroidKeyStore key needs nothing but `javax.crypto` and `android.security.keystore`.
 *
 * WHAT THE KEYSTORE DOES AND DOES NOT BUY
 * The AES key is generated inside the AndroidKeyStore and never leaves it: on a device with a
 * secure element the raw key material is not extractable even from a rooted process, and it is
 * destroyed when the app is uninstalled or the device is factory reset. It does NOT protect against
 * code running as this app, which is why `android:allowBackup="false"` matters just as much: the
 * ciphertext below must not travel to a cloud backup where the key cannot follow it.
 *
 * VERIFICATION: COMPILES and ships in the debug APK's dex. Never RUN. Key generation, GCM round
 * trips and the uninstall-clears-it property are all handset checks in
 * docs/release/ANDROID_MANUAL_TEST.md.
 */
@CapacitorPlugin(name = "LivetapSecureStore")
class SecureStorePlugin : Plugin() {

    @PluginMethod
    fun set(call: PluginCall) {
        val id = call.getString("id")
        val value = call.getString("value")
        if (id.isNullOrEmpty() || value == null) {
            call.reject("id and value are required")
            return
        }
        try {
            prefs().edit().putString(id, encrypt(value)).apply()
            call.resolve()
        } catch (e: GeneralSecurityException) {
            // Never echo the value or the exception message: both can carry the secret.
            Log.e(TAG, "set failed: ${e.javaClass.simpleName}")
            call.reject("the secure store refused to write", e.javaClass.simpleName)
        }
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrEmpty()) {
            call.reject("id is required")
            return
        }
        val stored = prefs().getString(id, null)
        val result = JSObject()
        if (stored == null) {
            // A missing secret is an answer, not an error: the UI asks the creator to paste again.
            call.resolve(result)
            return
        }
        try {
            result.put("value", decrypt(stored))
            call.resolve(result)
        } catch (e: GeneralSecurityException) {
            // The key is gone (device restore, credential reset). The ciphertext is now permanently
            // unreadable, so drop it rather than leaving a row that will fail forever.
            Log.w(TAG, "decrypt failed, dropping entry: ${e.javaClass.simpleName}")
            prefs().edit().remove(id).apply()
            call.resolve(result)
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val id = call.getString("id")
        if (id.isNullOrEmpty()) {
            call.reject("id is required")
            return
        }
        prefs().edit().remove(id).apply()
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        prefs().edit().clear().apply()
        call.resolve()
    }

    private fun prefs(): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val body = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        // IV first: GCM needs a fresh one per message and it is not secret, only unique.
        return encode(cipher.iv) + SEPARATOR + encode(body)
    }

    private fun decrypt(stored: String): String {
        val parts = stored.split(SEPARATOR)
        if (parts.size != 2) throw GeneralSecurityException("malformed record")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, decode(parts[0])))
        return String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8)
    }

    /** One app-wide key, created on first use and then reused for the life of the install. */
    private fun secretKey(): SecretKey {
        val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keystore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // Deliberately NOT setUserAuthenticationRequired: a broadcast must be able to
                // reconnect while the phone is in a pocket with the screen locked, and a key that
                // needs a fingerprint would drop the stream instead.
                .build(),
        )
        return generator.generateKey()
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(text: String): ByteArray = try {
        Base64.decode(text, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
        throw GeneralSecurityException("malformed record")
    }

    companion object {
        private const val TAG = "LivetapSecureStore"
        private const val PREFS = "livetap.secure"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "livetap.vault.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val SEPARATOR = ":"
    }
}
