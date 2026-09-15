#!/usr/bin/env node
/**
 * TEAM F (SECURITY), 2026-09-15. Is Electron `safeStorage` encryption actually available
 * on THIS machine, and does the ciphertext it produces really not contain the plaintext?
 *
 * `apps/desktop/src/main/vault.ts` refuses to store anything when
 * `safeStorage.isEncryptionAvailable()` is false, which is the right call and is unit
 * tested against a fake. What a unit test cannot answer is what the REAL platform backend
 * does on the machine the owner is about to install on. That is a per-machine fact, so it
 * belongs in a command rather than in a document.
 *
 *   node infra/dev-harness/secret-scan/safestorage-probe.cjs
 *
 * Prints booleans, byte lengths and the selected backend. Never a value. The string it
 * encrypts is a fixed marker and is not a credential.
 *
 * Exit 0 when encryption is available AND the round trip is real; exit 1 otherwise, so
 * this can gate a release step.
 */
const { app, safeStorage } = require('electron');

app.disableHardwareAcceleration();

const MARKER = 'PROBE-not-a-real-secret-0123456789';

app.whenReady().then(() => {
  const out = { platform: process.platform, electron: process.versions.electron };
  try {
    out.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
  } catch (error) {
    out.isEncryptionAvailable = `threw: ${String(error && error.message)}`;
  }
  try {
    out.backend =
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : 'n/a (not Linux; Windows uses DPAPI, macOS uses Keychain)';
  } catch {
    out.backend = 'threw';
  }

  let healthy = out.isEncryptionAvailable === true;
  if (healthy) {
    try {
      const ciphertext = safeStorage.encryptString(MARKER);
      out.cipherIsBuffer = Buffer.isBuffer(ciphertext);
      out.cipherBytes = ciphertext.length;
      out.cipherContainsPlaintext = ciphertext.toString('latin1').includes(MARKER);
      out.roundTripEqualsPlaintext = safeStorage.decryptString(ciphertext) === MARKER;
      healthy = out.cipherIsBuffer && !out.cipherContainsPlaintext && out.roundTripEqualsPlaintext;
    } catch (error) {
      out.encryptError = String(error && error.message);
      healthy = false;
    }
  }

  console.log(`PROBE ${JSON.stringify(out, null, 2)}`);
  console.log(
    healthy
      ? '\nPASS  safeStorage is available and the ciphertext does not contain the plaintext.'
      : '\nFAIL  safeStorage is NOT usable here. The vault will refuse to store anything, which is\n' +
          '      correct, but it means desktop sign-in and saved stream keys cannot work on this machine.',
  );
  app.exit(healthy ? 0 : 1);
});
