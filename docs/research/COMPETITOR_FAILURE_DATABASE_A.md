# COMPETITOR FAILURE DATABASE — Part A

**Scope:** OBS Studio, Streamlabs Desktop, Restream, StreamYard, Riverside, Ecamm Live, Twitch Studio.
**Purpose:** Catalogue what breaks, what confuses, and what costs money in the incumbent live-broadcast tools, so LIVETAP ("Connect your accounts. Pick where you want to go live. Tap GO LIVE.") can design against documented failure, not guesses.
**Method:** ~38 web searches + direct page fetches across OBS forums/KB, GitHub issues (obsproject/obs-studio), Capterra, G2, Trustpilot, vendor help centers, vendor pricing pages, class-action filings, and trade press. Preference given to 2024–2026 material.
**Evidence rule:** every bullet carries a source URL. Claims that could not be confirmed from a primary/first-party or clearly-dated secondary source are labelled **UNVERIFIED**. No quotes are invented; where a review is paraphrased it is marked as paraphrase.

---

## 1. Executive summary — the 10 biggest reasons these tools feel intimidating or frustrating

1. **The first-run experience asks configuration questions before it delivers any outcome.** OBS puts "rate control / CBR / keyframe interval / bitrate / encoder preset / psycho-visual tuning" in front of a user whose actual goal is "be live." Guides have to explain why keyframe interval must be 2 and why CBR beats VBR for live ingest — knowledge the software never teaches in-product. https://www.dacast.com/blog/best-obs-studio-settings/ , https://www.shoutcastnet.com/obs-rate-control-cbr-vbr-2026.php
2. **The "easy button" is not trustworthy, which destroys confidence in everything else.** OBS's Auto-Configuration Wizard is the one beginner on-ramp, and forum threads show it producing unusable output (one user reports it recommending ~27 kbps video bitrate, 30 fps, 853x480 scaled output) or leaving the stream "still super choppy" afterwards. https://obsproject.com/forum/threads/obs-auto-configuration-wizard.90611/ , https://obsproject.com/forum/threads/i-used-the-auto-configuration-wizard-but-when-i-try-to-stream-its-still-super-choppy.107804/
3. **The vocabulary is invented and non-obvious.** Scene vs. Source vs. Scene Collection vs. Profile is a four-way distinction with no real-world analogue; a Scene Collection holds scenes/sources, a Profile holds settings, and "there is no connection between a profile and a scene collection." Users routinely lose scenes by switching the wrong one. https://obsproject.com/kb/scene-collections , https://www.versluis.com/2019/03/about-obs-scenes-collections-and-profiles/
4. **Diagnostics are outsourced to the user.** OBS's answer to failure is "Help → Log Files → Upload Current Log File, paste the URL into obsproject.com/tools/analyzer." The product knows the problem; it makes the human carry the log to a second website to be told. https://github.com/obsproject/loganalyzer , https://obsproject.com/forum/threads/please-post-a-log-with-your-issue-heres-how.23074/
5. **Error messages name the symptom, never the cause or the fix.** "Encoding overloaded! Consider turning down video settings or using a faster encoding preset" fires at >0.1% skipped frames, and "Failed to connect to server" can mean firewall, wrong ingest, bad key, or a dead destination — three different user actions, one string. https://obsproject.com/forum/threads/how-to-debug-encoding-overloaded.168625/ , https://streamertoolkits.com/tools/obs-log-analyzer
6. **Silent, invisible failures at the exact moment of maximum stakes.** Black-screen Display Capture on dual-GPU laptops is a textures-across-GPUs problem the UI never surfaces — the preview is just black, and the fix is an OS-level GPU preference outside the app. https://obsproject.com/forum/threads/2-gpus-black-screen-when-setting-is-display-capture.125848/ , https://www.gumlet.com/learn/obs-black-screen/
7. **Audio is the number-one silent killer and the settings that cause it are buried.** Advanced Audio Properties' three-way "Monitor Off / Monitor Only / Monitor and Output" is the documented cause of echo and doubled voice in recordings, and macOS cannot capture desktop audio at all without a virtual audio device. https://obs-versions.com/blog/obs-audio-monitoring-guide , https://obsproject.com/forum/threads/how-to-capture-desktop-audio-on-mac.148146/
8. **Multistreaming is the default user intent and nobody ships it simply for free.** OBS's RTMP output is single-destination by design and needs the third-party obs-multi-rtmp plugin; Streamlabs gates multistream behind Ultra ($27/mo); Restream's free tier is 2 channels with a watermark; StreamYard's Core tier is 3 destinations at $44.99/mo. https://obs-versions.com/multi-rtmp , https://checkthat.ai/brands/streamlabs/pricing , https://restream.io/pricing , https://streamyard.com/pricing
9. **Updates break working setups, because plugins are the load-bearing feature.** OBS 31.x and 32.x generated waves of "unusable / crashing" threads traced to incompatible plugins (obs-multi-rtmp, downstream keyer) and residual AppData files after uninstall. The user's entire show is coupled to third-party code the vendor doesn't control. https://obsproject.com/forum/threads/obs-31-is-crashing-and-unusable.182468/ , https://obsproject.com/forum/threads/obs-32-0-1-unuseable.190897/
10. **Billing friction is a trust event, not a pricing detail.** Streamlabs paid **$4.4M** to settle a class action alleging users were enrolled in auto-renewing $5.99/mo Streamlabs Pro subscriptions by adding a GIF to a donation; Trustpilot shows recurring refund-refusal and support-silence themes. Creators generalise "they'll trap me" to the whole category. https://www.classaction.org/news/4.4-million-streamlabs-settlement-resolves-auto-renewal-class-action-lawsuit , https://www.trustpilot.com/review/streamlabs.com

---

## 2. Per-product findings

### 2.1 OBS Studio

#### Strengths
- Free, open-source, no watermark, no account, no per-destination fee; the reference implementation everyone else is measured against. Twitch itself named OBS first among recommended alternatives when killing its own encoder. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/
- Extremely light at idle relative to Electron-based competitors: a November 2025 comparison records OBS at ~1% CPU / 232 MB RAM vs Streamlabs at ~5% CPU / 1.2 GB RAM on an identical scene (secondary source, dated). https://tech-insider.org/streamlabs-vs-obs-vs-xsplit-2026/
- Unlimited scenes/sources/filters with per-source filter chains, global + per-scene hotkeys, and an audio mixer with per-track routing — a genuinely professional switcher for $0.
- Ships a first-party log analyzer that machine-reads logs and emits ranked issues with suggested fixes. https://github.com/obsproject/loganalyzer
- Multitrack Video / Twitch Enhanced Broadcasting landed in OBS 30.2 and expanded to macOS/Linux + Windows ARM in the 31.1 beta. https://alternativeto.net/news/2024/7/obs-studio-30-2-launched-with-multitrack-streaming-enhanced-rtmp-flv-composable-themes/ , https://alternativeto.net/news/2025/5/obs-studio-31-1-beta-adds-multitrack-video-support-to-mac-and-linux-and-windows-arm-support/

#### Weaknesses
- Single RTMP destination per profile by design; a second stream key replaces the first rather than adding a destination, so multistreaming requires obs-multi-rtmp. https://obs-versions.com/multi-rtmp , https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/
- No mobile client and none planned: "Developing OBS Studio for mobile devices is currently outside the scope of what the project is able to work on." https://obsproject.com/kb/mobile-streaming-apps
- Vertical (9:16) output requires a separate profile/scene collection at 1080x1920, a second OBS instance, or the third-party Aitum Vertical plugin. https://obsproject.com/forum/resources/aitum-vertical.1715/ , https://obs-versions.com/blog/obs-vertical-streaming-guide
- Browser Sources each spawn a Chromium instance; guides advise capping at 3–4 and enabling "Shutdown source when not visible" to avoid GPU/CPU overload from alerts and chat widgets. https://obsproject.com/forum/threads/browser-sources-overloading-gpu.184305/ , https://obs-versions.com/blog/obs-performance-tuning
- macOS has no OS-level desktop audio capture; users must install BlackHole/Loopback or use the newer macOS screen-capture source's application audio. https://obsproject.com/forum/threads/how-to-capture-desktop-audio-on-mac.148146/
- Open-source support model: "no traditional support team like some commercial software products" (Capterra, Edwin V., Dev Manager, July 2026 — paraphrase of review quote). https://www.capterra.com/p/164144/OBS/reviews/

#### Beginner complaints
- "steep learning curve and complex setup, which can be challenging for beginners" — Don M., Asst. Manager, March 2026. https://www.capterra.com/p/164144/OBS/reviews/
- "too much going on the screen for people who are new to technology" — Julian A., IT Technician, April 2025. https://www.capterra.com/p/164144/OBS/reviews/
- "gigantic learning curve" and "weeks of trying to overcome setup issues and finding the right plugins"; same reviewer reports "couldn't ever stream to youtube without errors" — Theresa B., Owner, March 2025. https://www.capterra.com/p/164144/OBS/reviews/
- Audio outcome discovered only after the fact: "filmed some videos that were way too quiet (whilst using a headset microphone)" — Amber L., July 2025. https://www.capterra.com/p/164144/OBS/reviews/
- Scene Collection vs Profile is a documented confusion point requiring third-party tutorials to disambiguate. https://obsproject.com/forum/threads/linking-scenes-to-profiles.135640/

#### Advanced complaints
- **Audio mixer meters burn CPU:** issue #12516 (opened 2025-08-18) — displaying the audio meters drastically increases CPU per audio source. https://github.com/obsproject/obs-studio/issues/12516
- **Audio capture CPU pathology:** issue #12797 — empty scene, no filters, fresh install on Linux (OBS 32.0.2) shows 70–80% system CPU from audio capture; dropping to <1% when audio devices are disabled; closed as duplicate of #12758. https://github.com/obsproject/obs-studio/issues/12797
- **Monitoring desync is a long-running unsolved class of bug:** #4531 (buffer buildup / offsync), #3577 (monitoring drifts out of sync over time), #13411 (dual-PC + capture card desync). https://github.com/obsproject/obs-studio/issues/4531 , https://github.com/obsproject/obs-studio/issues/3577 , https://github.com/obsproject/obs-studio/issues/13411
- **Global hotkeys aren't reliably global:** they fail in fullscreen games, and if OBS runs as admin while the game does not (or vice versa) Windows blocks the keystrokes; workaround lives in Settings → Advanced → Hotkey Focus Behavior. https://obsproject.com/forum/threads/hotkeys-not-working-globally.134656/ , https://obsproject.com/forum/threads/global-hotkeys-for-other-programs-dont-work-when-obs-is-focused.160876/
- **Multitrack Video / Enhanced Broadcasting is destination-locked and hardware-gated** (initially Windows + specific NVIDIA/AMD GPUs; AV1/4K restricted to the Twitch beta community). https://blog.twitch.tv/en/2024/01/08/introducing-the-enhanced-broadcasting-beta/ , https://alternativeto.net/news/2024/1/twitch-obs-and-nvidia-collaborate-to-bring-multi-encode-streaming-to-twitch/

#### Setup friction
- Auto-Configuration Wizard output is not trusted; forum threads document nonsensical recommendations and post-wizard choppiness requiring manual re-tuning against actual CPU/GPU/upload. https://obsproject.com/forum/threads/obs-auto-configuration-wizard.90611/ , https://obsproject.com/forum/threads/i-used-the-auto-configuration-wizard-but-when-i-try-to-stream-its-still-super-choppy.107804/
- Getting a stream key requires leaving the app, logging into the destination's creator dashboard, and pasting a secret — with no in-product validation that it is the right key for the right channel. (Implied by "Failed to connect to server" troubleshooting flows.) https://obsproject.com/forum/threads/please-post-a-log-with-your-issue-heres-how.23074/
- Desktop audio on macOS requires installing a separate virtual-audio driver before any system sound is captured. https://obsproject.com/forum/threads/how-to-capture-desktop-audio-on-mac.148146/
- Display Capture black screen on dual-GPU laptops requires changing Windows "Run with graphics processor" / Graphics Settings for the OBS executable, plus (sometimes) disabling Windows HDR and running as administrator. https://obsproject.com/forum/threads/2-gpus-black-screen-when-setting-is-display-capture.125848/ , https://www.gumlet.com/learn/obs-black-screen/
- Vertical output needs a whole parallel configuration (profile, collection, or second instance) or a plugin. https://obs-versions.com/blog/obs-vertical-streaming-guide

#### Failure causes (technical)
- **Encoding overload:** encoder cannot keep pace → skipped frames; triggered above 0.1% skipped. Fix is hardware encoder (NVENC/AMF), lower resolution, or lower fps. https://obsproject.com/forum/threads/how-to-debug-encoding-overloaded.168625/
- **Three different "frame loss" counters with three different causes:** dropped = network path, skipped = encoder lag, lagged/missed = render-side GPU pressure. The UI exposes the numbers but not the distinction. https://streamertoolkits.com/tools/obs-log-analyzer
- **Plugin ABI breakage across major versions:** OBS 31/32 crash threads resolved by removing incompatible plugins (obs-multi-rtmp, downstream keyer) and purging leftover AppData files before a clean reinstall. https://obsproject.com/forum/threads/obs-31-is-crashing-and-unusable.182484/ , https://obsproject.com/forum/threads/obs-32-0-1-unuseable.190897/
- **Recording loss on hard crash:** an OBS-only crash truncates the file (recoverable by remux if MKV); a full OS crash can leave a 0-byte file. Remux itself fails with "Recording remuxed, but the file may be incomplete" and no output file. https://obsproject.com/forum/threads/pc-hard-crashed-during-recording-how-do-i-actually-repair-the-file.139236/ , https://obsproject.com/forum/threads/corrupted-mkv-recordings.173052/
- **Echo/double audio:** mic set to "Monitor and Output" while Desktop Audio loopback is capturing puts the voice into the mix twice at different latencies. https://obs-versions.com/blog/obs-audio-monitoring-guide

#### Pricing friction
- None from OBS itself — $0, no tiers, no watermark, no account. The cost is paid entirely in time and in the paid/third-party ecosystem (plugins, overlay services, multistream relays) that surrounds it.
- Users who need multistream end up paying a third party (Restream/Streamlabs Ultra) on top of a free encoder, i.e. the free tool creates a paid dependency. https://obs-versions.com/multi-rtmp

#### Mobile limits
- No iOS/Android app, no lite version, no beta planned; OBS instead links out to PRISM Live Studio, IRL Pro, Moblin, and Streamlabs Mobile. https://obsproject.com/kb/mobile-streaming-apps
- Phones can only participate as a camera/remote via third-party bridges (NDI, obs.camera, IP camera apps). https://obs.camera/articles/obs-studio-mobile/

#### Multistream limits
- One RTMP destination per profile natively. https://obs-versions.com/multi-rtmp
- obs-multi-rtmp can share encoders with the main output to save CPU, but carries its own version-compatibility failures and user reports of routine connection errors on YouTube+Twitch pairs. https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/ , https://obsproject.com/forum/threads/multiple-rtmp-outputs-plugin-issue.172662/
- Multitrack Video solves *multiple renditions to one platform* (Twitch), not *multiple platforms* — a distinction most users don't know until it fails them. https://blog.twitch.tv/en/2024/01/08/introducing-the-enhanced-broadcasting-beta/

---

### 2.2 Streamlabs Desktop

#### Strengths
- Batteries-included: alerts, widgets, themes, app store, Collab Cam, Talk Studio, and cloud multistreaming bundled in one installer instead of assembled from plugins. https://checkthat.ai/brands/streamlabs/pricing
- Cloud multistreaming to Twitch, YouTube, TikTok, Kick, Facebook and custom RTMP without a local encoder-per-destination CPU tax (Ultra). https://checkthat.ai/brands/streamlabs/pricing
- Trustpilot aggregate is 4.3/5 across 1,558 reviews — the negatives below are a minority pattern, not the whole picture. https://www.trustpilot.com/review/streamlabs.com
- Ships a first-party crash-reporting toggle (Settings → Get Support → "Enable reporting additional information on a crash"), i.e. diagnostics are at least in-product. https://support.streamlabs.com/hc/en-us/articles/360044253653-Streamlabs-Desktop-Crash-Troubleshooting-Guide
- Documented dual-format (horizontal + vertical) Twitch workflow. https://streamlabs.com/content-hub/post/twitch-dual-format-streamlabs-desktop

#### Weaknesses
- Electron/Chromium architecture costs 10–25% more CPU than OBS for the same scene; idle CPU commonly 4–8% vs OBS's <1%. https://totaltech.blog/does-streamlabs-use-more-cpu-than-obs , https://tech-insider.org/streamlabs-vs-obs-vs-xsplit-2026/
- "So much is baked into the default application that it makes the entire app potentially more fragile than it needs to be" (paraphrase of AlternativeTo commentary). https://alternativeto.net/software/streamlabs-obs/about
- A dedicated public Known Issues category exists in the support center — an admission that breakage is steady-state. https://support.streamlabs.com/hc/en-us/categories/27279811363227-Known-Issues
- Long-running reputational overhang from the 2021 OBS branding/open-source dispute. https://junae.substack.com/p/streamlabs-and-obs-controversy

#### Beginner complaints
- Editor canvas goes black in Studio Mode while Output still shows sources; official workaround is to disable Windows HDR via ALT + WIN + B — an OS setting a beginner would never associate with their streaming app. https://support.streamlabs.com/hc/en-us/articles/32043200182427-Streamlabs-Desktop-Editor-Screen-in-Studio-Mode-is-Black
- Account linking failures: Trustpilot reviewer (Jul 26, 2026) unable to connect a YouTube account after a forced social-auth update, with a support ticket unanswered for a week (paraphrase). https://www.trustpilot.com/review/streamlabs.com
- Crash troubleshooting starts by asking the user to enable extra crash reporting and restart — the failure has to happen twice before it's diagnosable. https://support.streamlabs.com/hc/en-us/articles/360044253653-Streamlabs-Desktop-Crash-Troubleshooting-Guide
- Reddit sentiment that the paid tier isn't worth it: an r/streamlabs poster judged the offering not "worth $20 a month, let alone $27" (quoted in secondary source). https://checkthat.ai/brands/streamlabs/pricing

#### Advanced complaints
- Game crashes / FPS drops attributable to Streamlabs Desktop are common enough to warrant a dedicated vendor article. https://streamlabs.com/content-hub/post/game-crashes-or-fps-drops-with-streamlabs-desktop
- Known issue: blank/black horizontal editor canvas when filters are applied to scenes; documented fix is to delete the duplicated scene collection and rebuild from scratch — i.e. lose the work. https://support.streamlabs.com/hc/en-us/categories/27279811363227-Known-Issues
- Trustpilot themes include multi-streaming limitations and a non-functional Collab Cam (Jul 21, 2026 paraphrase). https://www.trustpilot.com/review/streamlabs.com
- Higher baseline resource draw directly reduces headroom for the encoder, compounding into dropped/skipped frames on the same hardware that runs OBS fine. https://totaltech.blog/does-streamlabs-use-more-cpu-than-obs

#### Setup friction
- Same Windows-level prerequisites as OBS (HDR off, GPU selection, admin rights) surface as Streamlabs-branded bugs. https://support.streamlabs.com/hc/en-us/articles/32043200182427-Streamlabs-Desktop-Editor-Screen-in-Studio-Mode-is-Black
- Themes/overlays install into the app but the multistream destination step still requires per-platform OAuth, and auth changes have broken existing links. https://www.trustpilot.com/review/streamlabs.com
- Uninstall/reinstall is a recommended remedy in the crash guide, meaning scene collections and settings are at risk during routine troubleshooting. https://support.streamlabs.com/hc/en-us/articles/360044253653-Streamlabs-Desktop-Crash-Troubleshooting-Guide

#### Failure causes (technical)
- Electron + embedded Chromium widget rendering competes with the encoder for CPU. https://totaltech.blog/does-streamlabs-use-more-cpu-than-obs
- Windows HDR interaction with the compositor produces the black-editor class of bug. https://support.streamlabs.com/hc/en-us/articles/32043200182427-Streamlabs-Desktop-Editor-Screen-in-Studio-Mode-is-Black
- Mobile: thermal throttling — iOS reviewers report phones overheating immediately on going live, causing freeze/buffer/quality drop; acknowledged by the developer as of 18 Apr 2025. https://apps.apple.com/us/app/streamlabs-live-streaming-app/id1294578643

#### Pricing friction
- **$4.4M class-action settlement** over Streamlabs Pro auto-renewal: users who added a GIF/effect to a donation were allegedly enrolled in a recurring $5.99/mo subscription; class period 3 Mar 2018 – 17 May 2022; preliminary approval 29 Aug 2024. Streamlabs also agreed to change website disclosures under the California CLRA. https://www.classaction.org/news/4.4-million-streamlabs-settlement-resolves-auto-renewal-class-action-lawsuit , https://topclassactions.com/lawsuit-settlements/closed-settlements/4-4m-streamlabs-pro-auto-renewal-class-action-settlement/
- Reported 27% Ultra price increase, with Ultra at $27/mo (or ~$189/yr) and Ultra+ at $79/mo (secondary source; not confirmed on streamlabs.com because the pricing page did not render for automated fetch — **price tiers UNVERIFIED against first-party page**). https://checkthat.ai/brands/streamlabs/pricing
- Refund friction: 72-hour auto-refund window, then manual request; Trustpilot reviewers report refusals after cancellation windows expired, and at least one reports being told cancellation was only possible within the first hour of enrollment. https://www.trustpilot.com/review/streamlabs.com , https://donotpay.com/learn/streamlabs-refund/ (secondary, **UNVERIFIED** for the one-hour claim)
- Multistreaming — the single most common creator intent — is a paid-tier feature. https://checkthat.ai/brands/streamlabs/pricing

#### Mobile limits
- iOS reviewers report the app crashing to home screen after ~15–20 minutes of continuous streaming, and after 5–10 minutes when screen-streaming. https://apps.apple.com/us/app/streamlabs-live-streaming-app/id1294578643
- Zoom function broke in an update; overheating-on-go-live regression reported and acknowledged April 2025. https://apps.apple.com/us/app/streamlabs-live-streaming-app/id1294578643
- Reports of invalid-broadcast-session errors when broadcasting to YouTube from mobile. https://apps.apple.com/us/app/streamlabs-live-streaming-app/id1294578643
- Streamlabs Mobile is listed by OBS as a freemium option — i.e. the mobile path also has a paywall. https://obsproject.com/kb/mobile-streaming-apps

#### Multistream limits
- Cloud multistream requires Ultra; free users get single-destination. https://checkthat.ai/brands/streamlabs/pricing
- Trustpilot negatives include "multi-streaming limitations" and streams dropping across platforms with support cycling the user through repetitive troubleshooting (Aug 6, 2026 paraphrase). https://www.trustpilot.com/review/streamlabs.com

---

### 2.3 Restream

#### Strengths
- Purpose-built for the exact LIVETAP job-to-be-done: one ingest, 30+ social destinations, cloud-side fanout so the local machine encodes once. https://restream.io/pricing
- Works both as a browser Studio and as a relay behind OBS, so it fits both beginner and pro workflows. https://restream.io/blog/restream-tools-and-features/
- Genuinely free entry point: 2 channels at $0. https://support.restream.io/en/articles/9127747-can-i-use-restream-for-free-yes
- Watermark applies only to Studio output on free; streaming from an external encoder shows the Restream logo on the preview but not on the outgoing stream. https://support.restream.io/en/articles/3935667-how-can-i-remove-restream-branding
- Strong aggregate review scores on G2/Capterra; the complaints below are the minority tail. https://www.capterra.com/p/184117/Restream/reviews/

#### Weaknesses
- Quality is bounded by the weakest destination: guides recommend ~6000 kbps because that's Twitch's cap, and because Twitch doesn't transcode for non-partners while YouTube does, identical input renders worse on YouTube. https://restream.io/blog/twitch-multistreaming-rules-explained/ , https://obsproject.com/forum/threads/multistream-quality-isnt-consistent.182005/
- 1080p in Studio is gated to Professional ($49/mo); Standard ($19/mo) tops out at 720p. https://restream.io/pricing
- Free plan Studio allows only 1 on-screen participant. https://restream.io/pricing
- Recording retention is short (15 days free/Standard, 30 days Professional) — reviewers flag limited storage duration. https://restream.io/pricing , https://www.capterra.com/p/184117/Restream/reviews/
- Reviewers report the scheduler being a separate paid subscription and Restream logos persisting even on a paid plan (paraphrase of Capterra/G2 reviewer feedback; the logo claim conflicts with the vendor help article, so **the "logo on paid plan" claim is UNVERIFIED**). https://www.capterra.com/p/184117/Restream/reviews/ , https://support.restream.io/en/articles/3935667-how-can-i-remove-restream-branding

#### Beginner complaints
- Capterra reviewers flag "a setup process that can feel complex" alongside video quality, latency, and frozen video. https://www.capterra.com/p/184117/Restream/reviews/
- "Constant prompts to upgrade" are called out as annoying. https://www.capterra.com/p/184117/Restream/reviews/
- The free watermark's behaviour is conditional (Studio yes / encoder no), which is exactly the kind of rule a beginner cannot predict. https://support.restream.io/en/articles/3935667-how-can-i-remove-restream-branding

#### Advanced complaints
- Inconsistent per-destination quality with no per-destination bitrate control in the common workflow. https://obsproject.com/forum/threads/multistream-quality-isnt-consistent.182005/
- Reliability: a streamer reports having to fall back to a direct stream key for one platform to get live again. https://www.capterra.com/p/184117/Restream/reviews/
- Documented outages: a major incident on 20 Oct 2025 lasting 5h20m plus a concurrent minor incident of 2h30m; a further acknowledged outage on 9 Jun 2026. https://statusgator.com/services/restream
- Dual-format (horizontal + vertical simultaneously) is a Professional-and-above feature. https://restream.io/pricing

#### Setup friction
- Destination count is a plan variable (2 free / 3 Standard / 5 Professional / 8 Business), so "add one more platform" is a billing decision, not a UI action. https://restream.io/pricing
- Twitch's simulcasting rules add non-obvious compliance constraints: Twitch must get equal-or-better quality ("quality parity"), you may not tell Twitch viewers to leave, and merged/unified chat from other platforms may not be shown on the Twitch stream. Exclusive contract holders cannot simulcast at all. https://restream.io/blog/twitch-multistreaming-rules-explained/ , https://hothardware.com/news/twitch-streamers-allowed-to-simulcast

#### Failure causes (technical)
- Relay architecture: one upstream failure or a single bad destination handshake can degrade or stall the whole session; users recover by bypassing Restream for that platform. https://www.capterra.com/p/184117/Restream/reviews/
- Bitrate ceiling arbitration — Twitch's 6000 kbps hard cap forces the whole fanout down, and YouTube's re-encode of that same feed compounds the loss. https://restream.io/blog/twitch-multistreaming-rules-explained/
- Multi-hour cloud incidents are a real, dated risk to a live show. https://statusgator.com/services/restream

#### Pricing friction
- Official pricing page: Free $0 / Standard $19 / Professional $49 / Business $239 per month; a Restream help-adjacent secondary source lists $16 / $39 / $199, which is most likely annual-equivalent pricing — **the discrepancy is UNVERIFIED**. https://restream.io/pricing , https://support.restream.io/en/articles/3935667-how-can-i-remove-restream-branding
- Reviewers report refund-policy problems, including refusal to honour a 7-day refund because the user had previously been a paid subscriber. https://www.capterra.com/p/184117/Restream/reviews/
- Scheduler billed separately and considered "quite expensive for what it does" by reviewers. https://www.capterra.com/p/184117/Restream/reviews/

#### Mobile limits
- Restream's value on mobile is destination fanout, not capture; the Studio is browser-first and the free tier's 1-participant / branded output makes a phone-only workflow visibly "free-tier." https://restream.io/pricing
- **UNVERIFIED:** no first-party page was located in this pass documenting Restream mobile app feature parity (recording, layouts, guest management) with desktop Studio.

#### Multistream limits
- Hard channel caps per tier; going from 3 to 5 destinations is a $19 → $49 jump. https://restream.io/pricing
- Single shared encode ladder means no per-destination resolution/bitrate tailoring in the standard flow — the Twitch cap governs everyone. https://restream.io/blog/twitch-multistreaming-rules-explained/
- Vertical + horizontal simultaneously requires Professional. https://restream.io/pricing

---

### 2.4 StreamYard

#### Strengths
- Zero-install for host and guests: browser-based studio, guests join by link. https://support.streamyard.com/hc/en-us/articles/360043291612-Guest-instructions
- Multistream to 3 destinations on Core and 8 on Advanced, with branding removal, custom layouts, overlays, AI clips, intro/outro videos and chat overlay. https://streamyard.com/pricing
- Free tier exists and includes 6 on-screen participants — more generous on-screen headcount than Restream's free tier. https://streamyard.com/pricing
- Dedicated iOS guest app so phone guests aren't stuck fighting mobile Safari. https://apps.apple.com/us/app/id1610111143
- Concrete, specific audio troubleshooting docs (48 kHz sample-rate guidance, echo-cancellation matrices, RodeCaster-specific fixes). https://support.streamyard.com/hc/en-us/articles/18253495647380-Audio-Quality-Issues

#### Weaknesses
- 1080p and branding removal are both gated to Core at $44.99/mo monthly ($35.99/mo annual) — the most expensive "remove the logo" toll in this set. https://streamyard.com/pricing
- Free tier is capped at 2 hours/month of local recording. https://streamyard.com/pricing
- Guest/attendee caps bite mid-event: a G2 reviewer reports discovering during a live session with 150 registered attendees that the studio limit was 15 (paraphrase). https://www.g2.com/products/streamyard/reviews?qs=pros-and-cons
- Limited deep customisation: "you can't customize deeply if you want to create more complex scenes" (paraphrase of G2 dislikes). https://www.g2.com/products/streamyard/reviews?qs=pros-and-cons
- Browser-only means no native game capture or window-level compositing the way a desktop encoder provides.

#### Beginner complaints
- Echo is the signature beginner failure, and the fix is a four-switch matrix (Echo Cancellation OFF, Reduce mic background noise OFF, Stereo Audio OFF, Automatically Adjust Mic Volume ON) that contradicts the intuitive setting names. https://support.streamyard.com/hc/en-us/articles/14015208551188-How-to-fix-Echo
- Guests must be told which browser to use (Chrome/Firefox on desktop, Chrome on Android, the app on iOS) before they join. https://support.streamyard.com/hc/en-us/articles/360043291612-Guest-instructions
- Browser extensions are a documented cause of audio problems; the fix is "disable any extensions you have installed that may affect StreamYard." https://support.streamyard.com/hc/en-us/articles/18253495647380-Audio-Quality-Issues

#### Advanced complaints
- No in-platform analytics; users must go to each destination's native insights. https://www.learningrevolution.net/streamyard-review/
- 4K is local-recording only and Advanced-tier only. https://streamyard.com/pricing
- G2 reviewers report "recent failures that cost them time and content" (paraphrase) and poor master-level control over guest audio/echo. https://www.g2.com/products/streamyard/reviews?qs=pros-and-cons
- Core and Advanced are explicitly individual-use plans per the usage policy — team workflows require Business/sales contact. https://streamyard.com/pricing

#### Setup friction
- Audio interface / USB mic must be set to 48 kHz at the OS level to match the studio — an OS-level prerequisite surfaced in a help article rather than in-product. https://support.streamyard.com/hc/en-us/articles/18253495647380-Audio-Quality-Issues
- Per-destination OAuth still required; destination count is plan-limited. https://streamyard.com/pricing

#### Failure causes (technical)
- WebRTC audio feedback loops (guest speakers → guest mic) are the root cause of the dominant echo complaint. https://support.streamyard.com/hc/en-us/articles/14015208551188-How-to-fix-Echo
- Browser variance: audio problems are explicitly attributed to the guest's browser choice. https://support.streamyard.com/hc/en-us/articles/18253495647380-Audio-Quality-Issues
- Hardware-specific loops (e.g. RodeCaster Pro) need device-specific routing changes. https://support.streamyard.com/hc/en-us/articles/24259384164244-How-to-fix-Guest-Echo-while-using-a-RodeCaster-Pro-with-StreamYard

#### Pricing friction
- $44.99/mo (monthly) for the first non-branded, 1080p, 3-destination tier; $88.99/mo for 8 destinations and 4K local. https://streamyard.com/pricing
- Branding removal + resolution + multistream + unlimited recording are bundled into one expensive jump, so a creator who only wants "no logo" pays for everything. https://streamyard.com/pricing
- Free plan's 2 hours/month local recording effectively forces an upgrade for anyone recording weekly. https://streamyard.com/pricing

#### Mobile limits
- Mobile is supported chiefly as a *guest* experience (iOS StreamYard Guest app; Chrome on Android); the full host studio is a desktop-browser assumption. https://support.streamyard.com/hc/en-us/articles/360043291612-Guest-instructions , https://apps.apple.com/us/app/id1610111143
- **UNVERIFIED:** no first-party doc located in this pass stating full host-side feature parity (layouts, banners, multistream management) on a phone.

#### Multistream limits
- 3 destinations on Core, 8 on Advanced; free tier's multistream is described as limited. https://streamyard.com/pricing
- Vertical/short-form destinations are not called out as a first-class simultaneous output in the tier table. https://streamyard.com/pricing

---

### 2.5 Riverside

#### Strengths
- Local-first recording: each participant records locally at up to 4K video / lossless WAV audio, then uploads — so network hiccups don't degrade the master files. https://riverside.com/faq
- Separate tracks for up to 10 participants (9 guests + host), uploaded to the host's account. https://support.riverside.com/hc/en-us/articles/5457425335965-Recordings-status-guide
- Ships a system connectivity test before recording. https://support.riverside.com/hc/en-us/articles/16444766029597-Troubleshooting-System-connectivity-test
- Explicit host and guest pre-flight checklists. https://support.riverside.com/hc/en-us/articles/5706937784861-Host-checklist-and-tips-Recording-on-computer
- Majority of G2 reviewers rate it five stars despite pricing concerns. https://www.g2.com/products/riverside/reviews

#### Weaknesses
- Chrome/Edge only on desktop — Safari and Firefox are unsupported, a hard blocker for guests you don't control. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers
- Local recording is staged in the browser's temporary storage before upload, so a guest who closes the tab, runs out of disk, or clears site data can destroy the high-quality track. https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space
- Requires ≥5 GB free browser storage plus a dual-core CPU and 4 GB RAM (8 GB recommended for 4K) — real prerequisites on a guest laptop. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers
- Separate-track downloads are metered by plan: 15 h/mo Pro, 20 h Grow, 25 h Webinar, unlimited Business (secondary source). https://saasflags.com/products/riverside-fm

#### Beginner complaints
- The single biggest operational trap: guests must stay until upload completes. A documented case describes a panelist losing internet and losing the whole session. https://saasflags.com/products/riverside-fm
- Recovery requires a separate support article and guest cooperation after the fact ("My guest's local recording track didn't finish uploading – how do they send it?"). https://support.riverside.com/hc/en-us/articles/5458387524509-My-guest-s-local-recording-track-didn-t-finish-uploading-how-do-they-send-it
- Optimisation advice is to close browser tabs and applications and to create a clean Chrome profile with no extensions — a pre-flight ritual, not a product behaviour. https://riverside.com/university-videos/how-to-optimize-your-computer-for-recording-online

#### Advanced complaints
- Support latency of 3–7 business days on tickets involving lost or corrupted recordings (secondary aggregation of G2/Capterra 2024–2025 reviews). https://saasflags.com/products/riverside-fm
- Complaint spikes in late 2023 and mid-2024 where the official "rely on local backups" workaround failed because the local backup itself never generated (secondary source). https://saasflags.com/products/riverside-fm
- The Pro → Business price jump is a recurring G2 complaint. https://www.g2.com/products/riverside/pricing

#### Setup friction
- Browser gate (Chrome/Edge or the mobile app) must be communicated to every guest before the session. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers
- Storage headroom check (5 GB) and RAM/CPU floor are pre-conditions, not runtime adaptations. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers
- Pending uploads occupy account storage until completed, so an abandoned session degrades the account until manually resolved. https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space

#### Failure causes (technical)
- Browser temporary storage as the staging layer for irreplaceable masters — eviction, quota, or tab closure equals data loss. https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space
- Upload completion is coupled to human behaviour (staying in the studio) rather than to a resumable background process. https://support.riverside.com/hc/en-us/articles/5457425335965-Recordings-status-guide
- Chromium-only media stack, so Safari/Firefox guests silently can't participate at full quality. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers

#### Pricing friction
- G2 reviewers from solo creators, students and early-stage podcasters flag paid tiers as steep; the Pro→Business jump is the named pain. https://www.g2.com/products/riverside/pricing
- Documented pattern of users billed $24–$288 after they believed accounts were cancelled, across 2024 and 2025 complaints (secondary aggregation). https://saasflags.com/products/riverside-fm
- Metering the *separate track downloads* (the reason people choose Riverside) by monthly hours is a paywall on the core value. https://saasflags.com/products/riverside-fm

#### Mobile limits
- A Riverside mobile app exists and is the supported path on phones, but the desktop-class experience is browser-bound. https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers
- **UNVERIFIED:** feature parity of the mobile app for multistream destinations and live-switching was not confirmed in this pass.

#### Multistream limits
- Riverside is recording-first; live multistreaming is a secondary capability and not the tier-defining feature. **UNVERIFIED:** exact per-tier simultaneous-destination counts were not confirmed against a first-party pricing page in this pass. https://www.g2.com/products/riverside/pricing

---

### 2.6 Ecamm Live

#### Strengths
- Standard ($16/mo, $192/yr) already includes multistreaming to 10 destinations, no watermark, custom overlays, screen sharing with PiP, automatic high-quality recording, in-app comments, web widget overlays and green screen — the cheapest "multistream included" tier in this set. https://appg2.ecamm.com/users/pricingplans
- Pro ($32/mo, $384/yr) adds Ecamm for Zoom, Interview mode, Virtual Mic & Webcam, 4K streaming, ISO audio/video recording, live monitoring to an external display, real-time bandwidth stats and VIP support. https://appg2.ecamm.com/users/pricingplans
- 14-day trial with full Standard+Pro features, no credit card, watermark only. https://appg2.ecamm.com/users/pricingplans
- Reviewers consistently rate the learning curve as materially easier than OBS and praise support responsiveness. https://www.capterra.com/p/196795/Ecamm-Live/reviews/

#### Weaknesses
- **Mac only. No Windows version.** This excludes the majority of the PC gaming/streaming population outright. https://appg2.ecamm.com/users/pricingplans , https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- Subscription-only; reviewers call $16–$32/mo steep for infrequent streamers, compounded by Mac hardware cost. https://www.softwareadvice.com/webinar/ecamm-live-profile/
- Heavy resource use: "Heavy usage of RAM especially while streaming" (Adithya S., Oct 13 2022) and "my whole computer slows down when Ecamm is running" (Verified Reviewer, Feb 8 2022). https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- Historical multistream gap: older reviews complain "Not able to stream to multiple platforms at once" (Ruth P., Feb 2 2023) and "multistreaming requires a third party tool that costs additional money" (Jim F., Feb 8 2022) — since resolved, but it left a durable perception. https://www.capterra.com/p/196795/Ecamm-Live/reviews/

#### Beginner complaints
- "The price is steep for someone who is starting a startup" — Alexander V R., Feb 8, 2022. https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- Mixed learning-curve reports: easier than OBS, but reviewers still describe needing about a week to get comfortable and having to "dig deep to find out why something isn't working." https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- Lighting/enhancement controls that don't deliver: "don't really help the video quality" — Greg L., Feb 8, 2022. https://www.capterra.com/p/196795/Ecamm-Live/reviews/

#### Advanced complaints
- Stability under load: "Multiple disconnections during live streams" with support unable to resolve — Fernando S., Mar 11, 2025. https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- A reviewer reports a broadcast crashing over a dozen times (paraphrase). https://slashdot.org/software/p/Ecamm-Live/
- Interview-mode hour limits requested as unlimited — Daniel R., Feb 8, 2022. https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- 4K, ISO recording, virtual cam and interview mode all sit behind the 2x price tier. https://appg2.ecamm.com/users/pricingplans

#### Setup friction
- Platform gate first: you must already own a Mac. https://appg2.ecamm.com/users/pricingplans
- Trial watermarks output, so the evaluation stream is visibly branded — you cannot evaluate on a real broadcast without paying. https://appg2.ecamm.com/users/pricingplans
- **UNVERIFIED:** no first-party doc located in this pass detailing a guided first-run wizard (destination connect → device check → go live).

#### Failure causes (technical)
- Heavy local compositing + encoding on a single Mac, with reviewers reporting system-wide slowdown and RAM pressure. https://www.capterra.com/p/196795/Ecamm-Live/reviews/
- Local multi-destination encoding (10 destinations from one machine) multiplies encode/upload load, a plausible contributor to the disconnection reports. **UNVERIFIED** as a stated root cause. https://www.capterra.com/p/196795/Ecamm-Live/reviews/

#### Pricing friction
- Standard $16/mo ($192/yr), Pro $32/mo ($384/yr), annual saves 20%; no free forever tier. https://appg2.ecamm.com/users/pricingplans
- Reviewers cite the total cost of ownership (subscription + Mac + hardware) as the biggest objection. https://www.softwareadvice.com/webinar/ecamm-live-profile/

#### Mobile limits
- No mobile broadcasting client; Ecamm is a macOS desktop application. https://appg2.ecamm.com/users/pricingplans
- Phones participate only as cameras/guests via Ecamm's own device integrations. **UNVERIFIED** for exact supported device paths in this pass.

#### Multistream limits
- Standard caps at 10 destinations; Pro is described as unlimited. https://appg2.ecamm.com/users/pricingplans
- All fanout is local (single Mac uplink), so destination count is bounded by upload bandwidth and CPU rather than by a cloud relay. **UNVERIFIED** as an explicit vendor statement.

---

### 2.7 Twitch Studio (discontinued)

#### Strengths
- It was the only first-party, guided, single-platform onboarding path: guided setup for webcam and game feed, customisable templates, free. https://blog.twitch.tv/en/2020/10/12/twitch-studio-updates-new-tools-to-help-you-stream-like-a-pro/
- Zero configuration of stream keys — authentication was native to the platform it streamed to.
- Simplicity was explicitly why people chose it; post-shutdown commentary records users saying they picked it because streaming was new to them. https://www.creatorhandbook.net/twitch-shuts-down-in-house-streaming-software/

#### Weaknesses
- **Discontinued.** Twitch ended support after **May 30, 2024** and removed download links. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/
- Single destination only — Twitch, by construction. No multistream, ever.
- "Lacks the advanced features and flexibility of OBS or Streamlabs" (secondary characterisation). https://upstream.so/blog/twitch-allows-unified-chat-simulcasting-rules/
- Its own vendor reported that most users "quickly switch over to other streaming software, like OBS to take advantage of more advanced features." https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/

#### Beginner complaints
- The product beginners chose *for* its simplicity was removed from under them, and the official replacement list (OBS, Streamlabs, XSplit, vMix, Elgato, Lightstream) is uniformly harder. https://streamlabs.com/content-hub/post/twitch-discontinuing-twitch-studio-support
- Users reported understanding the decision but losing the only guided path; the migration required relearning the entire scenes/sources/encoder model. https://www.creatorhandbook.net/twitch-shuts-down-in-house-streaming-software/

#### Advanced complaints
- Advanced users never adopted it: **less than 4% of total hours streamed** each month came from Twitch Studio. That number is the real verdict — a simple tool with no ceiling loses its users as they grow. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/

#### Setup friction
- Minimal by design (guided device setup, templates), which is the single most transferable lesson in this entire document. https://blog.twitch.tv/en/2020/10/12/twitch-studio-updates-new-tools-to-help-you-stream-like-a-pro/

#### Failure causes (strategic, not technical)
- Low usage → resource reallocation to Clips, mobile, Stream Together and the Discovery Feed. The tool died of strategy, not of bugs. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/
- **Platform-owned tooling is structurally fragile**: a first-party encoder only exists while it serves the platform's growth priorities. A creator's entire workflow was a line item in someone else's roadmap.

#### Pricing friction
- None — it was free. Which is exactly why there was no revenue to defend it.

#### Mobile limits
- Desktop only; Twitch's mobile investment went to the Twitch app's own "go live" features and Stream Together, not Studio. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/

#### Multistream limits
- Zero. Single-platform by definition — and the policy world moved the other way: Twitch dropped exclusivity in Oct 2023 and formally permitted simulcasting (with quality-parity and no-redirect rules) at TwitchCon Las Vegas. https://restream.io/blog/twitch-multistreaming-rules-explained/ , https://hothardware.com/news/twitch-streamers-allowed-to-simulcast

---

## 3. Master table

| # | Product | Feature | Strength | Weakness | User Pain | Technical Cause | UX Cause | LIVETAP Response |
|---|---------|---------|----------|----------|-----------|-----------------|----------|------------------|
| 1 | OBS | Auto-Config Wizard | Only guided on-ramp | Produces unusable settings (e.g. 27 kbps / 853x480 reported) | "I did the wizard and it's still choppy" ([src](https://obsproject.com/forum/threads/i-used-the-auto-configuration-wizard-but-when-i-try-to-stream-its-still-super-choppy.107804/)) | One-shot bandwidth/CPU probe, no runtime feedback | Wizard runs once, never re-validates, no visible confidence | Continuous adaptive bitrate + a pre-flight check that runs every time, showing a green/amber/red verdict with the reason |
| 2 | OBS | Rate control / CBR / keyframe | Full pro control | Beginners must learn HLS segment theory | Wrong keyframe interval blocks going live ([src](https://www.dacast.com/blog/best-obs-studio-settings/)) | Destination ingest requires 2s keyframes | Raw encoder params exposed as first-class settings | Ship destination-derived encoder presets; never show keyframe/rate-control unless the user opens "Expert" |
| 3 | OBS | Scene vs Source | Powerful composition model | Four-concept vocabulary | Users lose scenes switching the wrong collection ([src](https://obsproject.com/kb/scene-collections)) | Settings and scene graph stored in separate files | Invented nouns with no real-world analogue | One concept: "Look". A Look bundles camera, screen, overlay, audio. No profiles, no collections |
| 4 | OBS | Profile vs Scene Collection | Reuse across channels | "No connection between a profile and a scene collection" | Switching one silently keeps the other ([src](https://www.versluis.com/2019/03/about-obs-scenes-collections-and-profiles/)) | Orthogonal config namespaces | Two independent selectors, no coupling shown | Settings travel with the destination automatically; there is nothing to switch |
| 5 | OBS | Encoding overload warning | Honest early signal | Names symptom, not cause | "Encoding overloaded!" mid-stream ([src](https://obsproject.com/forum/threads/how-to-debug-encoding-overloaded.168625/)) | >0.1% encoder-skipped frames | Message prescribes a vague action set | Auto-step down resolution/fps, tell the user what was changed and offer one-tap revert |
| 6 | OBS | Dropped vs skipped vs lagged | Three precise counters | Three names, no explanation | Users treat all frame loss as "my internet" ([src](https://streamertoolkits.com/tools/obs-log-analyzer)) | Network / encoder / renderer are separate stages | Jargon exposed without a causal model | One health indicator with a plain-language cause: "Your upload dropped" vs "Your CPU can't keep up" |
| 7 | OBS | Log analyzer | First-party, genuinely good | Lives on a website, post-hoc | Copy a log URL to a second site to diagnose ([src](https://github.com/obsproject/loganalyzer)) | Diagnosis decoupled from runtime | Debugging is a manual export ritual | Run the analyzer in-app, continuously; surface findings as fixable cards before going live |
| 8 | OBS | Display Capture | Captures any monitor | Black screen on dual-GPU laptops | Preview is black, no error shown ([src](https://obsproject.com/forum/threads/2-gpus-black-screen-when-setting-is-display-capture.125848/)) | Textures not shareable across GPUs | Silent failure — nothing tells the user why | Detect black/zero-variance frames and show "This capture is blank — switch GPU?" with a one-click fix |
| 9 | OBS | Display Capture + HDR | — | Windows HDR breaks capture | Black screen after enabling HDR ([src](https://www.gumlet.com/learn/obs-black-screen/)) | HDR colour pipeline mismatch | OS setting invisible to the app's UI | Pre-flight detects HDR and offers to toggle it, explaining the tradeoff |
| 10 | OBS | Desktop audio (macOS) | — | Impossible without a virtual device | Recording has no system sound ([src](https://obsproject.com/forum/threads/how-to-capture-desktop-audio-on-mac.148146/)) | macOS doesn't expose system audio | User must install BlackHole/Loopback first | Bundle/guide the audio route in one tap; show a live "system audio detected" meter before going live |
| 11 | OBS | Advanced Audio Properties | Per-source routing | Monitor Off / Only / and Output confusion | Echo, voice recorded twice ([src](https://obs-versions.com/blog/obs-audio-monitoring-guide)) | Mic monitored into a loopback-captured device | Three similar-sounding options in a hidden dialog | Two switches only: "Hear it myself" and "Include in broadcast", with automatic loopback detection |
| 12 | OBS | Audio mixer UI | Real-time meters | Meters themselves spike CPU (#12516) | CPU cost for a visual affordance ([src](https://github.com/obsproject/obs-studio/issues/12516)) | Per-source meter processing on the UI thread | Always-on visualisation with no cost model | Meters render on GPU at low rate and pause when off-screen |
| 13 | OBS | Audio capture | Multi-device | 70–80% CPU on empty scene (#12797, Linux) | Machine unusable at idle ([src](https://github.com/obsproject/obs-studio/issues/12797)) | Audio backend inefficiency vs `pw-cat` | No in-app attribution of CPU to subsystem | In-app resource panel attributing CPU/GPU to each source, with a "disable heaviest" action |
| 14 | OBS | Audio monitoring | Low-latency preview | Drifts out of sync over time (#3577, #4531, #13411) | Monitoring desyncs mid-show ([src](https://github.com/obsproject/obs-studio/issues/4531)) | Monitor buffer accumulation / clock drift | No resync control surfaced | Continuous drift detection + one-tap "Resync audio" that never touches the outgoing stream |
| 15 | OBS | Hotkeys | Global, per-scene | Fail in fullscreen games / admin mismatch | Can't switch scenes while playing ([src](https://obsproject.com/forum/threads/hotkeys-not-working-globally.134656/)) | Windows blocks keystrokes across privilege levels | "Global" promised, conditionally delivered | Detect the privilege/fullscreen condition and say so; offer a phone remote as the reliable path |
| 16 | OBS | Browser Source | Any web overlay | Each source = a Chromium instance | Alerts overload the GPU ([src](https://obsproject.com/forum/threads/browser-sources-overloading-gpu.184305/)) | Multiple CEF processes, hardware video decode | No cost shown per source; no default shutdown-when-hidden | Native overlay primitives for alerts/chat; browser sources sandboxed with an explicit cost badge |
| 17 | OBS | Plugins | Infinite extensibility | ABI breaks each major version | OBS 31/32 "unusable" after update ([src](https://obsproject.com/forum/threads/obs-32-0-1-unuseable.190897/)) | Native ABI coupling, leftover AppData files | Update ships before plugin compatibility is known | Core features in core. No plugin required to multistream, go vertical, or add alerts |
| 18 | OBS | Recording | Local, high quality | MKV needed for crash safety; remux fails | "Recording remuxed, but the file may be incomplete" ([src](https://obsproject.com/forum/threads/corrupted-mkv-recordings.173052/)) | MP4 moov atom written at close | Container choice pushed onto the user | Always write a crash-safe container and auto-produce a shareable MP4; never ask about containers |
| 19 | OBS | Recording | — | Full OS crash can yield a 0-byte file | Entire session lost ([src](https://obsproject.com/forum/threads/pc-hard-crashed-during-recording-how-do-i-actually-repair-the-file.139236/)) | File handle open during forced reboot | No incremental durability guarantee | Segmented recording with periodic finalisation; the last segment is the only thing at risk |
| 20 | OBS | Multistream | — | Single RTMP output per profile | Second key replaces the first ([src](https://obs-versions.com/multi-rtmp)) | Output pipeline designed for one session | Feature simply absent from the UI | Multi-destination is the primary object in LIVETAP; adding a destination is a toggle |
| 21 | OBS | obs-multi-rtmp | Shares encoders, saves CPU | Third-party, version-fragile | Connection errors on Twitch+YouTube pairs ([src](https://obsproject.com/forum/threads/multiple-rtmp-outputs-plugin-issue.172662/)) | Independent RTMP sessions, no supervision | Failures surface per-plugin, not per-destination | Per-destination status row with retry, and a stream that survives one destination failing |
| 22 | OBS | Multitrack Video / TEB | Multiple renditions | Twitch-only; GPU/OS gated at launch | Users confuse it with multistream ([src](https://blog.twitch.tv/en/2024/01/08/introducing-the-enhanced-broadcasting-beta/)) | Vendor-specific ingest protocol | Name implies multi-platform | Name features by outcome: "Stream to more places" vs "Send more qualities to one place" |
| 23 | OBS | Vertical output | — | Needs second profile/instance/plugin | Can't do TikTok + Twitch together ([src](https://obs-versions.com/blog/obs-vertical-streaming-guide)) | Single global canvas resolution | Canvas is a global setting, not per-destination | Per-destination aspect with automatic safe-area reframing from one Look |
| 24 | OBS | Mobile | — | No app, none planned | Can't stream from a phone ([src](https://obsproject.com/kb/mobile-streaming-apps)) | Desktop-class pipeline assumptions | Project scope decision | Mobile-first go-live for camera/screen, with the same destinations and the same GO LIVE button |
| 25 | OBS | Support | Huge community | "No traditional support team" | Answers come from forums, quality varies ([src](https://www.capterra.com/p/164144/OBS/reviews/)) | Volunteer OSS model | Help is external to the product | In-product guided fixes for the top 20 documented failure modes, offline-capable |
| 26 | OBS | Onboarding overall | Free, no account | Weeks to get working | "weeks of trying to overcome setup issues" ([src](https://www.capterra.com/p/164144/OBS/reviews/)) | — | Configuration precedes outcome | First successful broadcast in under 3 minutes from install, or the onboarding has failed |
| 27 | Streamlabs | All-in-one bundle | Alerts/themes built in | Electron overhead | 4–8% idle CPU vs OBS <1% ([src](https://totaltech.blog/does-streamlabs-use-more-cpu-than-obs)) | Chromium runtime for widgets | Convenience purchased with permanent overhead | Native rendering for overlays; publish a live resource budget in the UI |
| 28 | Streamlabs | Studio Mode editor | Program/preview | Black editor canvas | Editor black, output fine ([src](https://support.streamlabs.com/hc/en-us/articles/32043200182427-Streamlabs-Desktop-Editor-Screen-in-Studio-Mode-is-Black)) | Windows HDR interaction | Fix is an OS shortcut (ALT+WIN+B) documented offsite | Detect HDR at launch and offer the toggle in-app with one tap |
| 29 | Streamlabs | Scene filters | Filter chains | Known issue: blank canvas with scene filters; fix = rebuild collection | Lose the scene you built ([src](https://support.streamlabs.com/hc/en-us/categories/27279811363227-Known-Issues)) | Filter pipeline on duplicated collections | "Delete and start over" as official remedy | Versioned Looks with instant rollback; never ask a user to rebuild |
| 30 | Streamlabs | Crash reporting | In-product toggle | Must reproduce the crash to diagnose | Crash twice before help ([src](https://support.streamlabs.com/hc/en-us/articles/360044253653-Streamlabs-Desktop-Crash-Troubleshooting-Guide)) | Extra telemetry off by default | Opt-in diagnostics behind a restart | Rich diagnostics on by default (privacy-reviewed, local-first), so the first crash is the diagnosable one |
| 31 | Streamlabs | Multistream | Cloud fanout | Ultra-gated (~$27/mo) | Core intent is paywalled ([src](https://checkthat.ai/brands/streamlabs/pricing)) | Cloud relay cost | Monetises the primary job-to-be-done | Multistream free in the open-source core; monetise hosting/scale, never the GO LIVE button |
| 32 | Streamlabs | Billing | — | $4.4M auto-renew class action settlement | Charged $5.99/mo for adding a GIF ([src](https://www.classaction.org/news/4.4-million-streamlabs-settlement-resolves-auto-renewal-class-action-lawsuit)) | Subscription enrolment bundled into a one-off action | Consent buried in a micro-interaction | No dark patterns: no auto-renew without an explicit checkbox, one-click cancel, no trial-to-paid surprise |
| 33 | Streamlabs | Refunds | 72h auto-refund | Refusals after the window | Refund denied because "product was used" ([src](https://www.trustpilot.com/review/streamlabs.com)) | — | Policy asymmetry favouring vendor | If LIVETAP ever charges, publish and honour a no-questions window; keep the core free forever |
| 34 | Streamlabs | Account linking | OAuth to many platforms | Auth updates break existing links | Can't reconnect YouTube after forced update ([src](https://www.trustpilot.com/review/streamlabs.com)) | Token/scope migration | Silent breakage, no proactive re-auth prompt | Token health checks on launch; re-auth prompt *before* the user taps GO LIVE, never after |
| 35 | Streamlabs | Mobile app | Real mobile streaming | Crashes after 15–20 min; overheating on go-live | Stream dies mid-broadcast ([src](https://apps.apple.com/us/app/streamlabs-live-streaming-app/id1294578643)) | Thermal throttling + memory pressure | No thermal awareness surfaced to the user | Thermal/battery-aware encoder that steps down gracefully and tells the user, instead of dying |
| 36 | Restream | Cloud fanout | Encode once, send to 30+ | Destination caps per plan | 3→5 destinations costs $19→$49 ([src](https://restream.io/pricing)) | Relay egress cost | Destination count as a pricing lever | Destination count is never a paywall in the core product |
| 37 | Restream | Quality | Consistent ingest | Twitch 6000 kbps cap governs all outputs | YouTube looks worse than Twitch ([src](https://restream.io/blog/twitch-multistreaming-rules-explained/)) | Shared encode ladder + YouTube re-encode | No per-destination quality control exposed | Per-destination bitrate/resolution profiles, with a plain-language explanation of each platform's cap |
| 38 | Restream | Free tier | Genuinely free, 2 channels | Watermark in Studio; 1 on-screen participant | Free output looks free ([src](https://restream.io/pricing)) | — | Branding as upgrade pressure | No watermark, ever, at any tier |
| 39 | Restream | Watermark rules | Encoder path is unbranded | Conditional: Studio yes, encoder no | Users can't predict if the logo appears ([src](https://support.restream.io/en/articles/3935667-how-can-i-remove-restream-branding)) | Compositing happens server-side only for Studio | Rule differs by path with no in-UI indicator | What you see in preview is exactly what viewers see — guaranteed, all paths |
| 40 | Restream | Reliability | Managed infrastructure | 5h20m major incident, 20 Oct 2025 | Cloud dependency can end your show ([src](https://statusgator.com/services/restream)) | Centralised relay | Single point of failure | Automatic failover to direct-to-platform push when the relay degrades; the show continues |
| 41 | Restream | Recording retention | Cloud recordings included | 15 days free/Standard, 30 days Pro | Recording expires before it's edited ([src](https://restream.io/pricing)) | Storage cost | Retention as a pricing lever | Always write a local master; cloud copies are a convenience, never the only copy |
| 42 | Restream | Scheduler | Powerful | Separate paid subscription | Pay twice for one workflow ([src](https://www.capterra.com/p/184117/Restream/reviews/)) | — | Feature unbundling | One product, one scope; no à-la-carte upsells inside a paid tier |
| 43 | Restream | Twitch compliance | Documented rules | Quality parity, no redirect, no merged chat on Twitch | Users risk violations unknowingly ([src](https://hothardware.com/news/twitch-streamers-allowed-to-simulcast)) | Platform policy, not technical | Rules live in a blog post, not the UI | Show per-destination policy warnings at configuration time, e.g. "Twitch requires equal-or-better quality" |
| 44 | StreamYard | Browser studio | No install, guests join by link | No native game/window capture depth | Gamers can't use it as a primary encoder ([src](https://streamyard.com/pricing)) | WebRTC/browser capture limits | Browser-only architecture | Native capture where it matters, browser-easy where it matters; one product, both |
| 45 | StreamYard | Branding removal | Available | Bundled into $44.99/mo Core | Pay for everything to remove a logo ([src](https://streamyard.com/pricing)) | — | Coarse feature bundling | No logo to remove |
| 46 | StreamYard | 1080p | Available on Core | Free tier is lower quality + branded | HD is a paid feature ([src](https://streamyard.com/pricing)) | Encoding/egress cost | Resolution as a pricing lever | Resolution limited only by the destination and the user's hardware |
| 47 | StreamYard | Guest capacity | 6 free / 10 Core / 15 Advanced | Discovered mid-event | 150 registered, 15 allowed ([src](https://www.g2.com/products/streamyard/reviews?qs=pros-and-cons)) | Per-tier WebRTC capacity | Limit not surfaced at planning time | Show hard limits at setup time, not at the moment they bite |
| 48 | StreamYard | Echo handling | Detailed docs | Correct settings are counter-intuitive | Echo Cancellation OFF is part of the fix ([src](https://support.streamyard.com/hc/en-us/articles/14015208551188-How-to-fix-Echo)) | Feedback loop through guest speakers | Setting names imply the opposite of the fix | Automatic loopback/echo detection with a single "Fix my audio" action and a plain explanation |
| 49 | StreamYard | Audio setup | 48 kHz guidance | OS-level prerequisite | Mic set wrong at OS level degrades everything ([src](https://support.streamyard.com/hc/en-us/articles/18253495647380-Audio-Quality-Issues)) | Sample-rate mismatch resampling | Requirement documented offsite | Detect sample-rate mismatch and offer to correct it, or resample transparently |
| 50 | StreamYard | Local recording | Unlimited on Core | 2 hours/month on free | Weekly show exceeds free tier fast ([src](https://streamyard.com/pricing)) | Storage/egress | Time-metered free tier | Local recording is always unlimited — it's the user's own disk |
| 51 | StreamYard | Analytics | — | None in-platform | Must check each destination separately ([src](https://www.learningrevolution.net/streamyard-review/)) | Platform APIs vary | Feature gap | Aggregate per-destination viewer/health stats in one panel |
| 52 | Riverside | Local recording | 4K + lossless WAV per participant | Staged in browser temp storage | A closed tab can destroy the master ([src](https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space)) | Browser storage quota/eviction | Durability depends on user behaviour | Write masters to real disk with resumable background upload; survive a close, a crash, and a reboot |
| 53 | Riverside | Upload completion | Separate tracks per guest | Guest must stay until upload finishes | Panelist lost internet, session lost ([src](https://saasflags.com/products/riverside-fm)) | No resumable background transfer | Human-in-the-loop durability | Uploads resume automatically on reconnect; the guest can leave immediately |
| 54 | Riverside | Browser support | Chrome/Edge optimised | Safari and Firefox unsupported | Guests blocked by their default browser ([src](https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers)) | Chromium-specific media APIs | Requirement discovered at join time | Detect and warn at invite time, with a working fallback path |
| 55 | Riverside | System requirements | Documented | 5 GB browser storage + RAM/CPU floor | Guest's laptop silently can't cope ([src](https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers)) | Local recording needs headroom | Prerequisites, not adaptation | Measure the guest's machine and adapt quality automatically instead of failing |
| 56 | Riverside | Separate tracks | The core value | Metered by plan hours | 15 h/mo on Pro ([src](https://saasflags.com/products/riverside-fm)) | Processing/storage cost | Core value metered | Never meter the artefact the user came for |
| 57 | Riverside | Support | — | 3–7 business days on lost recordings | Irreplaceable content, week-long wait ([src](https://saasflags.com/products/riverside-fm)) | — | Support SLA misaligned with data-loss severity | Make loss impossible by design so support latency doesn't matter |
| 58 | Ecamm | Platform | Polished Mac-native | Mac only, no Windows | Majority of PC streamers excluded ([src](https://appg2.ecamm.com/users/pricingplans)) | macOS-specific frameworks | Platform strategy | Cross-platform from day one: Windows, macOS, Linux, mobile |
| 59 | Ecamm | Multistream | 10 destinations on $16 Standard | Local fanout; no free tier | 14-day trial then pay ([src](https://appg2.ecamm.com/users/pricingplans)) | Single-machine encode/upload | No free forever tier | Free forever core with multistream; no trial cliff |
| 60 | Ecamm | Trial | Full features, no card | Watermarked output | Can't evaluate on a real broadcast ([src](https://appg2.ecamm.com/users/pricingplans)) | — | Watermark as conversion pressure | Evaluate on real broadcasts; nothing is watermarked |
| 61 | Ecamm | Resource use | — | RAM heavy; whole machine slows | "my whole computer slows down when Ecamm is running" ([src](https://www.capterra.com/p/196795/Ecamm-Live/reviews/)) | Local compositing + multi-destination encode | No visible resource budget | Show live CPU/GPU/RAM headroom and auto-shed load before the stream suffers |
| 62 | Ecamm | Stability | Praised support | Multiple disconnections during live streams (Mar 2025) | Show interrupted repeatedly ([src](https://www.capterra.com/p/196795/Ecamm-Live/reviews/)) | Local uplink saturation across destinations (likely) | No per-destination health indicator | Per-destination reconnect with backoff; one destination failing never stops the others |
| 63 | Ecamm | Pro-tier gating | 4K, ISO record, interview mode | All behind 2x price | Doubling cost for one needed feature ([src](https://appg2.ecamm.com/users/pricingplans)) | — | Coarse tiering | Feature completeness in the core; no tier required to record your own guests |
| 64 | Twitch Studio | Guided setup | Best beginner onboarding in the set | Discontinued 30 May 2024 | The simple tool disappeared ([src](https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/)) | — | Platform strategy trumped user need | Open source + local-first: LIVETAP can't be switched off by a platform's roadmap |
| 65 | Twitch Studio | Single destination | Zero stream-key friction | Twitch only, no multistream | Users outgrew it and left ([src](https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/)) | Platform-native auth only | Simplicity without a ceiling | Simple by default, with a real ceiling: same app scales from one tap to multi-destination + advanced |
| 66 | Twitch Studio | Adoption | Free, first-party | <4% of hours streamed | Proof that simple-but-limited loses users | — | No growth path | Progressive disclosure: beginners never see complexity, experts can always reach it |

---

## 4. Switching reasons — why creators would leave each tool for something simpler

**From OBS Studio.** They leave when the cost of ownership exceeds the value of control. The trigger events are: an update that breaks the plugins holding their setup together (OBS 31/32 crash threads, https://obsproject.com/forum/threads/obs-32-0-1-unuseable.190897/); discovering that multistreaming — the thing they assumed was built in — needs a third-party plugin (https://obs-versions.com/multi-rtmp); needing vertical output for TikTok and finding it requires a second instance or another plugin (https://obs-versions.com/blog/obs-vertical-streaming-guide); and losing a recording to a crash with no recoverable file (https://obsproject.com/forum/threads/pc-hard-crashed-during-recording-how-do-i-actually-repair-the-file.139236/). Reviewers describe "weeks of trying to overcome setup issues" and never successfully streaming to YouTube (https://www.capterra.com/p/164144/OBS/reviews/). **LIVETAP wins them by being free and open like OBS, but with multistream, vertical, and crash-safe recording in the core — no plugin gamble.**

**From Streamlabs Desktop.** They leave for two distinct reasons. Performance-motivated users leave because the same scene costs them 4–8% idle CPU instead of <1%, and that headroom is their game's frame rate (https://totaltech.blog/does-streamlabs-use-more-cpu-than-obs). Trust-motivated users leave because of billing: the $4.4M auto-renewal settlement, a reported 27% Ultra price rise, and Trustpilot refund refusals (https://www.classaction.org/news/4.4-million-streamlabs-settlement-resolves-auto-renewal-class-action-lawsuit , https://www.trustpilot.com/review/streamlabs.com). **LIVETAP wins them with native rendering, a published resource budget, and no billing at all for the core.**

**From Restream.** They leave when the relay becomes the risk. A 5h20m outage on 20 Oct 2025 is a cancelled show (https://statusgator.com/services/restream). They also leave on economics — going from 3 to 5 destinations is $19 → $49/mo — and on quality, when they realise every platform is throttled to Twitch's 6000 kbps ceiling (https://restream.io/pricing , https://restream.io/blog/twitch-multistreaming-rules-explained/). **LIVETAP wins them with direct-to-platform push (no relay to fail), unlimited destinations, and per-destination quality.**

**From StreamYard.** They leave at the $44.99/mo Core wall, where 1080p, logo removal, unlimited recording and 3 destinations are bundled into a single expensive step (https://streamyard.com/pricing). They also leave after a capacity surprise — discovering a 15-participant cap during a 150-attendee event (https://www.g2.com/products/streamyard/reviews?qs=pros-and-cons) — and gamers leave because a browser studio can't be a primary game encoder. **LIVETAP wins them with no watermark, no resolution paywall, and native capture alongside link-join guests.**

**From Riverside.** They leave after one data-loss event. The architecture puts irreplaceable masters in browser temporary storage and makes upload completion depend on a guest staying in the room; when that fails, support takes 3–7 business days (https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space , https://saasflags.com/products/riverside-fm). They also leave when a guest turns up on Safari or Firefox and simply can't join (https://support.riverside.com/hc/en-us/articles/5252134218013-System-requirements-and-supported-browsers). **LIVETAP wins them with real-disk masters, resumable background upload, and no browser gate.**

**From Ecamm Live.** They leave when they get a PC, when they need a free tier, or when disconnections during live streams outlast support's patience (https://www.capterra.com/p/196795/Ecamm-Live/reviews/). The 14-day trial → $16–$32/mo cliff with no free plan pushes casual streamers out (https://appg2.ecamm.com/users/pricingplans). **LIVETAP wins them by being cross-platform and free forever, with per-destination reconnect so one bad platform doesn't end the show.**

**From Twitch Studio.** They already left — involuntarily, on 30 May 2024 (https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/). This is the most valuable cohort in the entire document: people who explicitly chose simplicity, were forced into OBS/Streamlabs, and have been under-served ever since. **LIVETAP wins them by being the guided, single-tap experience Twitch Studio was — plus multistream, plus open source, so no platform can retire it.**

---

## 5. UX principles derived from these failures

1. **Outcome before configuration.** The first thing a new user does is go live, not configure an encoder. Every setting that can be inferred (bitrate, resolution, fps, keyframe interval, encoder, rate control) is inferred and never shown by default. *Derived from OBS's settings-first onboarding and the "gigantic learning curve" reviews.* https://www.capterra.com/p/164144/OBS/reviews/
2. **One noun, not four.** There is no Scene vs Source vs Scene Collection vs Profile. There is one user-facing object — a **Look** — that carries its cameras, screen, overlays, audio, and per-destination settings together. Nothing can be switched independently into an inconsistent state. https://obsproject.com/kb/scene-collections
3. **Never ship an "easy mode" you don't trust.** If a guided setup can produce a bad result, it must measure continuously and correct itself rather than firing once and walking away. Auto-config runs every session, shows its verdict, and adapts live. *Derived from Auto-Configuration Wizard failures.* https://obsproject.com/forum/threads/obs-auto-configuration-wizard.90611/
4. **Every error names the cause, the consequence, and one button that fixes it.** Ban strings like "Encoding overloaded! Consider turning down video settings" and "Failed to connect to server." Replace with: what happened, why, what viewers saw, and a single action. https://obsproject.com/forum/threads/how-to-debug-encoding-overloaded.168625/
5. **Diagnose in-product, in real time, never by log export.** The OBS log analyzer proves automated diagnosis works; it just lives on the wrong side of the product boundary. LIVETAP runs the analyzer continuously and surfaces findings as dismissable, fixable cards before GO LIVE. https://github.com/obsproject/loganalyzer
6. **No silent failures. Ever.** A black capture, a muted mic, a missing system-audio route, and a dead destination must all raise a visible, specific alert with a fix — not a black rectangle or a flat meter. *Derived from dual-GPU black screen and macOS desktop-audio gaps.* https://obsproject.com/forum/threads/2-gpus-black-screen-when-setting-is-display-capture.125848/
7. **Audio gets two switches, not three modes.** "Hear it myself" and "Include in broadcast." Loopback/echo conditions are detected automatically and offered a one-tap fix. The words "Monitor and Output" never appear. https://obs-versions.com/blog/obs-audio-monitoring-guide
8. **Pre-flight is mandatory and honest.** Before GO LIVE: upload headroom, encoder headroom, thermal state, every device producing signal, every destination authenticated and accepting. Green/amber/red with reasons. Amber still lets you go live — it just tells you what will suffer. *Derived from Riverside's checklist culture done right, and from OBS's absence of one.* https://support.riverside.com/hc/en-us/articles/5706937784861-Host-checklist-and-tips-Recording-on-computer
9. **The core job is never paywalled.** Multistream, 1080p, unlimited destinations, unlimited local recording, and no watermark are in the free, open-source core. Every competitor monetises exactly the thing the user came for; that is the opening. https://checkthat.ai/brands/streamlabs/pricing , https://streamyard.com/pricing , https://restream.io/pricing
10. **No dark patterns in billing, ever.** No auto-enrolment from a micro-interaction, no trial-to-paid surprise, one-click cancel, published refund terms. *Derived directly from the $4.4M Streamlabs settlement and Riverside post-cancellation billing complaints.* https://www.classaction.org/news/4.4-million-streamlabs-settlement-resolves-auto-renewal-class-action-lawsuit
11. **Recording is durable by construction.** Segmented, crash-safe writing with periodic finalisation; a shareable MP4 produced automatically; masters on real disk, never in browser temp storage; uploads resumable and background. Losing a session must require losing the drive. https://obsproject.com/forum/threads/corrupted-mkv-recordings.173052/ , https://support.riverside.com/hc/en-us/articles/5458227676957-Troubleshooting-Complete-pending-uploads-to-restore-storage-space
12. **Destinations are independent and self-healing.** Each destination has its own status row, its own quality profile, and its own retry/backoff. One platform rejecting the stream never takes down the others, and a relay outage falls back to direct push. https://statusgator.com/services/restream , https://obsproject.com/forum/threads/multiple-rtmp-outputs-plugin-issue.172662/
13. **Surface the platform's rules at configuration time.** Twitch's quality-parity and no-redirect simulcasting rules, per-platform bitrate ceilings, vertical requirements, and codec support are shown next to the destination toggle — not left in a blog post to be violated accidentally. https://hothardware.com/news/twitch-streamers-allowed-to-simulcast
14. **Show the cost of every source.** Each source displays its CPU/GPU/memory contribution, and the app offers to shed the heaviest load before the encoder starts skipping. *Derived from Chromium-per-browser-source overload and Electron overhead.* https://obsproject.com/forum/threads/browser-sources-overloading-gpu.184305/
15. **Core features live in core; plugins may extend but never carry the show.** Multistream, vertical output, alerts, and recording must not depend on third-party native code that breaks on the next major version. https://obsproject.com/forum/threads/obs-32-0-1-unuseable.190897/
16. **Simple by default, with a real ceiling.** Twitch Studio died because <4% of hours used it and users "quickly switch over to other streaming software… to take advantage of more advanced features." Progressive disclosure means a beginner never meets a codec dropdown and an expert never hits a wall — in the same application. https://www.tubefilter.com/2024/05/20/twitch-shuts-down-twitch-studio/

---

## Appendix: confidence notes

- **UNVERIFIED — Streamlabs tier pricing.** streamlabs.com/pricing did not render usable content for automated fetch; Ultra $27/mo, Ultra+ $79/mo and the 27% increase come from a dated secondary source (https://checkthat.ai/brands/streamlabs/pricing) and should be re-confirmed against the vendor page before external use.
- **UNVERIFIED — Restream price discrepancy.** restream.io/pricing returned $0/$19/$49/$239 monthly; a secondary source lists $16/$39/$199, most plausibly annual-equivalent. Re-confirm the billing period before quoting.
- **UNVERIFIED — "Restream logos even on a paid plan."** A reviewer claim that contradicts the vendor help article; not reconciled.
- **UNVERIFIED — mobile feature parity** for Restream, StreamYard (host side), and Riverside; no first-party parity documentation was located in this pass.
- **UNVERIFIED — Ecamm local-fanout as the stated root cause** of the reported live disconnections; this is inference from architecture, not a vendor statement.
- **Reddit coverage is thin.** Direct r/obs, r/Twitch, r/streaming and r/youtube threads were largely not retrievable through the available search tooling; Reddit-sourced sentiment in this document is quoted via dated secondary aggregations and is labelled as such. Primary Reddit sourcing is a gap worth closing in a follow-up pass.
- G2 and classaction.org pages returned HTTP 403 to automated fetch; their content here comes from search-result summaries plus corroborating sources (topclassactions.com, terms.law for the settlement; softwaresuggest/G2 pros-and-cons summaries for StreamYard).
