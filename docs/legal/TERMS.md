# LIVETAP Terms of Use

**DRAFT — not legal advice, not yet reviewed by a lawyer.** Written by the engineering team to be
factually accurate about what the software is and is not, so that a lawyer reviews facts rather
than inventing them. Must be reviewed and hosted at a real URL before either store submission.

Last updated: 2026-09-11

---

## 1. What LIVETAP is

LIVETAP is software you run on your own device that captures your camera, microphone and screen and
broadcasts them live to streaming platforms you have connected. It is licensed under the **MIT
licence**; the source code is public.

**LIVETAP is not a streaming service.** We do not host, transmit, transcode, store or distribute
your broadcast. Your device sends it directly to the platforms you chose. We are not in the path.

## 2. No account, no subscription

There is no LIVETAP account and nothing to pay for. The app-store builds of LIVETAP CORE contain no
purchases, no subscriptions and no advertising.

If a hosted service (LIVETAP CLOUD) is ever offered, it will be a **separate, optional** product
with its own terms, and using it will be a deliberate choice, not a default.

## 3. Your content is yours

You keep every right you have in what you broadcast and record. We claim no licence to it, because
we never receive it.

You are responsible for what you broadcast. In particular, you are responsible for:

- having the right to broadcast it — including music, video, images, games, fonts and anything else
  in your stream that someone else made;
- the consent of anyone who appears in it;
- complying with the terms and community guidelines of **every** platform you are broadcasting to,
  which differ from each other and from these terms;
- complying with the law where you are.

A broadcast that breaks a platform's rules is between you and that platform. We cannot intervene in
it, restore your account, or appeal on your behalf.

## 4. The platforms you connect are not us

When you connect a destination, you authorise LIVETAP to act on your behalf at that platform using
your own account. That platform's terms and privacy policy govern your relationship with it.

Platforms change their APIs, their eligibility rules, their ingest endpoints and their permissions
without consulting us, and some of them require partner approval or business verification that we
do not control. A destination can therefore stop working, or never start working, for reasons
entirely outside LIVETAP. LIVETAP's design commitment is to tell you honestly what a destination
can and cannot do — never to imply a capability that does not exist — but it is not a commitment
that any particular platform will keep working.

## 5. What we do not promise

Being plain about this matters more than the usual boilerplate, because live broadcasting is
unforgiving:

- **LIVETAP does not guarantee that your stream will start, stay up, or look good.** Live streaming
  depends on your device, your network, your battery, your phone's temperature, and the platform's
  ingest servers. Every one of those can fail, and several of them will.
- **LIVETAP does not guarantee recordings.** A recording can fail, be truncated, or be lost to a
  crash, a full disk or a dead battery. If a recording matters, do not rely on a single copy.
- **On iOS, a camera broadcast stops when you leave the app.** That is an iOS restriction, not a
  LIVETAP bug, and it is documented in the app and in
  `docs/architecture/MOBILE_ARCHITECTURE.md`.
- **Phones get hot.** LIVETAP will reduce quality automatically to keep a broadcast alive rather
  than let the operating system throttle it silently, which means your quality can drop mid-stream.

The software is provided **"as is", without warranty of any kind**, as stated in the MIT licence.
To the extent the law allows, we are not liable for lost broadcasts, lost recordings, lost revenue,
lost followers, or any other loss arising from using it. Some jurisdictions do not allow these
exclusions; where that is so, they apply only as far as permitted.

## 6. Acceptable use

Do not use LIVETAP to broadcast or record:

- content that is illegal where you are or where your audience is;
- content that sexually exploits or endangers children;
- content that incites violence, or that harasses or threatens a real person;
- someone's private communications, or a person in a private setting, without their consent;
- content you do not have the rights to.

We cannot police your broadcast — we never see it — so this section is about what the software is
*for*, and about the fact that the platforms you broadcast to certainly will police it, and can
remove your account there.

## 7. Live chat shown inside LIVETAP

Where LIVETAP displays chat from a platform, that chat is other people's content, delivered by that
platform. LIVETAP's job is to show it to you and give you the controls to deal with it — reporting,
blocking and filtering — and to hand moderation actions back to the platform that owns the chat.
See `docs/release/APP_STORE_READINESS.md` for the specific controls that must exist before the iOS
app ships with chat enabled.

## 8. Open source

LIVETAP CORE is MIT-licensed. You may use, modify and redistribute it under that licence. It
includes third-party components under their own permissive licences, listed in
`docs/legal/THIRD_PARTY_LICENSES.md`. The MIT licence governs the code; these terms govern your use
of the builds we distribute through the app stores.

## 9. Changes

These terms may change. Material changes will be published here with a new date. If you do not
agree to a change, stop using the app — and, because LIVETAP holds nothing of yours, there is
nothing you need to retrieve first.

## 10. Contact

**`TODO: support@<domain>` — required before submission.**

---

### Open items before publication

- [ ] Legal review.
- [ ] Governing law and legal entity (or an explicit statement that LIVETAP is an unincorporated
      open-source project, if that is the case).
- [ ] Real contact address and a real hosted URL.
- [ ] Confirm the chat-moderation commitments in §7 match what is actually built before enabling
      chat on iOS.
