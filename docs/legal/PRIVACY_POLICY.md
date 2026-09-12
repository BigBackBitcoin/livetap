# LIVETAP Privacy Policy

**DRAFT — not legal advice, not yet reviewed by a lawyer.** This is an engineering draft written to
be accurate about what the software actually does, so that a lawyer can review facts rather than
invent them. It must be reviewed and given a real publication URL before either store submission.
The technical detail behind every claim here is in
[`docs/legal/PRIVACY_ARCHITECTURE.md`](./PRIVACY_ARCHITECTURE.md).

Last updated: 2026-09-11
Applies to: the LIVETAP web app, desktop app (Windows, macOS) and mobile apps (iOS, Android).

---

## The short version

**There is no LIVETAP account. There is no LIVETAP server that sees your video. There is no
analytics and no tracking.**

LIVETAP runs on your device. It captures your camera, microphone and screen, combines them, encodes
them, and sends the result **directly from your device to the streaming platforms you chose**. We
never receive it. We could not hand it over, sell it, or lose it, because we never have it.

---

## 1. Who we are and how to reach us

LIVETAP is open-source software (MIT licence). The source is public, so you do not have to take any
of this on trust — you can read the code that does it.

- Support and privacy contact: **`TODO: support@<domain>` — required before submission.** Apple
  Guideline 1.2 requires published contact information, and Google requires a privacy contact.
- Source code: **`TODO: repository URL`**

## 2. There is no LIVETAP account

You do not create an account with us. You do not give us an email address, a password, a phone
number or a name. There is nothing to sign in to.

What you *do* is connect your own accounts on other platforms (YouTube, Twitch, and so on) so that
LIVETAP can go live on your behalf. Those are **your** accounts with **those** companies.

## 3. What stays on your device

| Data | Where it lives | How long |
|---|---|---|
| Camera, microphone and screen content | Device memory while you are live. Recordings, if you turn them on, go to your own disk (desktop) or the app's private storage (mobile). | Until you delete them. Nothing is uploaded to us. |
| Access tokens for the platforms you connected | Your operating system's credential store: **iOS Keychain**, **Android Keystore**, **macOS Keychain**, **Windows DPAPI**, **Linux libsecret**. Never in plain files, never in browser storage. | Until you disconnect that destination, or the platform revokes it. |
| Stream keys you typed in yourself | The same secure store as above. | Until you remove that destination. |
| Non-secret destination details (channel name, avatar URL, broadcast IDs) | Ordinary local app storage. | Until you remove that destination. |
| Your settings, layouts and Moments | Ordinary local app storage. | Until you reset them. |
| Chat messages from the platforms | Shown to you live, in memory. Not written to disk by LIVETAP. | The length of your session. |

On the web, tokens are held **in memory for the session only**. Reloading the page means
reconnecting. That is deliberate: a long-lived token in browser storage is a token that any
script-injection bug can steal.

## 4. What we collect

**Nothing.**

No analytics. No telemetry. No crash reporting. No advertising identifiers. No cookies beyond what
is strictly needed to serve the web app. No "anonymous usage statistics". We do not operate a
server that your media or your tokens pass through.

If this ever changes — for example if we add opt-in crash reporting, or if LIVETAP CLOUD (an
optional, separate, possibly paid hosted service) is built — it will be **opt-in**, it will be
described here before it ships, and the app-store privacy declarations will be updated in the same
release. It will never be switched on quietly.

## 5. Where your data does go: the platforms you chose

When you connect a destination and go live, data flows from your device to that platform. Each
platform then handles it under **its own** privacy policy, which we do not control and cannot
change.

| Flow | What travels | Protocol |
|---|---|---|
| Your device → the platform's sign-in page | Your sign-in, in the platform's own page, in your system browser | HTTPS |
| Your device → the platform's API | Your broadcast title, description, category, thumbnail, and requests to start/stop | HTTPS, with your access token |
| Your device → the platform's ingest server | Your live video and audio | RTMPS (TLS) by default; plain RTMP only if you explicitly configure a custom destination that requires it |
| Your device → the platform's chat service | Chat messages you send | HTTPS / WebSocket |
| Desktop app → GitHub Releases | A request for the current version, to check for updates | HTTPS |

We use PKCE where the platform supports it, so no client secret ever has to sit on your device. A
small number of platforms require a server-side secret exchange; where that is true, LIVETAP tells
you the destination is unavailable rather than doing something unsafe.

If you configure a **relay** (for example a self-hosted MediaMTX), your media passes through the
server *you* chose and control. LIVETAP ships no default relay.

## 6. Permissions, and why each one is asked for

| Permission | Why | What happens if you say no |
|---|---|---|
| Camera | To capture your video for the broadcast | No camera in your stream. Audio-only and screen-share still work. |
| Microphone | To capture your audio | No audio in your stream. |
| Screen recording | To include your screen, a window, or a game | No screen share. Camera still works. |
| Notifications (Android 13+) | So the ongoing "you are live" notification can appear — it is how you end a broadcast when the app is not on screen | The broadcast still works, but you lose that control surface. |
| Local network / internet | To reach the platforms | LIVETAP cannot go live. |

LIVETAP asks for each of these **at the moment it needs it**, explains why in the app first, and
keeps working in a reduced form if you decline. It does not ask for contacts, location, photos,
health data, or your list of installed apps, and it does not read them.

## 7. Deleting your data

**There is no LIVETAP account to delete, because there is no LIVETAP account.** We hold nothing
about you on any server of ours.

What you can delete, and how:

- **Disconnect a destination** (Settings → Destinations → Disconnect). This immediately deletes
  that platform's access token and any stream key from your device's secure store. LIVETAP can no
  longer act on your behalf there.
- **Revoke LIVETAP's access at the platform.** Disconnecting removes the token from your device;
  revoking at the platform (for example Google's "Third-party apps with account access", or
  Twitch's Connections page) additionally invalidates it server-side. Do both if you want to be
  thorough. LIVETAP links you to the right page for each platform.
- **Reset LIVETAP** (Settings → Advanced → Reset). Deletes every setting, layout and stored
  credential from the device.
- **Uninstall.** On mobile, uninstalling removes the app's private storage, including recordings
  stored inside it. On desktop, recordings you chose to save to your own folders are yours and stay
  where you put them.
- **Recordings** are files. Delete them like any other file.

If you want written confirmation that we hold nothing about you, write to the contact address in
§1 and we will confirm it. There is a deliberate asymmetry here we want to be plain about: a
"delete my data" request to us can only ever be answered "we have none" — the data that matters is
on your device and at the platforms you chose, and only you and they can delete it.

## 8. Children

LIVETAP is a broadcasting tool for the platforms you connect it to, and those platforms set their
own minimum ages (commonly 13+). LIVETAP is not directed at children, and since we collect nothing,
we do not knowingly or unknowingly collect information from children.

## 9. Security

- Everything that leaves your device goes over TLS: HTTPS for APIs, RTMPS for ingest wherever the
  platform offers it.
- Credentials are stored using the operating system's own credential store, not in files we invent.
  On desktop, if the OS cannot provide encryption, LIVETAP **refuses to store the token** and tells
  you, rather than writing it out in the clear.
- The source is public, so the security of this design is auditable rather than asserted.
- No system is perfect. If you find a problem, the contact address in §1 is the place to report it.

## 10. Changes to this policy

Material changes will be published here with a new date, and — because this policy's whole claim is
"we collect nothing" — any change that starts collecting something will be called out in the app,
not just in this document.

---

### Open items before publication

- [ ] Legal review.
- [ ] Real support/privacy email address and a real hosted URL (both stores require a live URL).
- [ ] Decide and state the jurisdiction and the legal entity, if one exists.
- [ ] Keep in sync with the App Store "App Privacy Details" answers
      (`docs/release/APP_STORE_READINESS.md`) and the Play "Data safety" answers
      (`docs/release/GOOGLE_PLAY_READINESS.md`). Drift between those three is a common rejection
      and a real breach of trust.
