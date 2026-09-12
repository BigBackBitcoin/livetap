# SWITCHING TRIGGERS — What makes an OBS user actually SWITCH to LIVETAP

**Research question:** not "what annoys OBS users" (that is COMPETITOR_FAILURE_DATABASE_A/_B) but *what specific moment or condition causes a person to stop opening OBS and start opening something else.*

**Research date:** 2026-09-11. **Sources preferred:** 2024–2026.

**Segments covered:** OBS experts · Twitch/YouTube streamers · podcasters/interview shows · social/short-form creators · mobile creators (TikTok/IG vertical) · professional producers & agencies (with church/event volunteer crews noted as an adjacent seventh).

---

## 0. Method and evidence rules (read this before trusting any number)

**What I could use.** This session's `WebSearch` quota was already exhausted (200/200) before this task began, and it returned no results. `reddit.com` is not crawlable by this agent (confirmed again: `old.reddit.com` returns a `Blocked` page, `www.reddit.com/*.json` returns the JS shell). Google, Bing-RSS, Mojeek, Brave, Ecosia, Qwant, Yep and eight SearXNG instances all returned CAPTCHA, 403, 405 or 429. I did **not** attempt to defeat any CAPTCHA.

**So the evidence base here is built from indexes and APIs that were reachable, and it is deliberately weighted toward primary artefacts:**

| Evidence channel | What it gave me | Reliability |
|---|---|---|
| OBS source repo (`raw.githubusercontent.com/obsproject/obs-studio`) | Exact wizard wording, exact failure strings, exact settings-string counts, the importer source files | **Primary, highest** |
| OBS forum resource pages (server-rendered) | Download counts, star ratings, and verbatim user reviews of the multistream / vertical plugins | **Primary** |
| Apple App Store customer-review RSS (`itunes.apple.com/us/rss/customerreviews/`) | ~70 dated, verbatim mobile-creator reviews of PRISM (id 1319056339) and Streamlabs mobile (id 1294578643) | **Primary** (self-selected sample) |
| Vendor help centres / docs (Kick, Ecamm, Meld, Streamlabs, TikTok, OBS KB) | Documented steps, documented limits, documented policies | **Primary, but vendor-framed** |
| Twitch blog | Dual Format announcement + the mobile-viewer statistic | **Primary, vendor** |
| Streamlabs × Stream Hatchet quarterly reports | Platform hours/channels for destination-set sizing | **Secondary, vendor-published** |
| YouTube search index (title + channel + view count) | The *language* creators use about switching, and demand size per narrative | **Weak on content, strong on demand signal.** A title is evidence that a narrative sells; it is not evidence the claim inside is true. |
| Hacker News Algolia API (story + full comment trees) | Dated, attributable developer/creator sentiment with comment IDs | **Primary** |
| Userpilot onboarding articles | Named intent-onboarding examples and one activation figure | **Secondary, marketing-adjacent** |

**Rules applied.** Every claim carries a URL. Every quotation was copied from a page I actually retrieved in this session; nothing is reconstructed from memory. Where a page is vendor marketing it is labelled as such. Where I could not verify something it is marked **UNVERIFIED**. The "trigger moment" sentences in Section 1 are **my composite labels, not quotations** — they are labelled as such every time, because inventing a user quote would poison this document.

**Relationship to the existing databases.** I read the executive summaries of `COMPETITOR_FAILURE_DATABASE_A.md` (OBS, Streamlabs, Restream, StreamYard, Riverside, Ecamm, Twitch Studio) and `COMPETITOR_FAILURE_DATABASE_B.md` (vMix, Wirecast, Lightstream, PRISM, Meld, XSplit, platform-native tools). Those catalogue *failures*. This document does not repeat them; it converts them into *switch events* and adds new primary evidence they do not contain — plugin download volumes, plugin review text, Kick's multistreaming payout penalty, Twitch Dual Format, OBS's own string counts and importer source, and the App Store mobile review corpus.

---

## 1. Executive summary — the top 10 switching triggers, ranked by evidence strength

Ranking is by **weight and directness of evidence**, not by my guess at market size. "Feasibility" is judged for an open-source, desktop-first, local-first tool with a web and mobile surface.

---

### T1. The multistream tax comes due
**Rank 1 — strongest evidence in the entire study.**

**Trigger moment (composite label, not a quote):** *"I wanted to be on two platforms at once, and discovered my options were a $27/month subscription or bolting a plugin whose documentation is in Japanese onto the software that runs my show."*

**Segments:** Twitch/YouTube streamers (primary), podcasters, short-form creators, cam/adult creators (an unexpectedly explicit constituency).

**Evidence.** OBS ships a single RTMP destination per profile, so multistreaming means a third-party plugin. The canonical one, `obs-multi-rtmp`, shows **2,888,784 downloads and 4,939,282 views** on the OBS resource page, at **4.07 stars from 84 ratings** ([resource page](https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/)). That download figure is the single largest quantified statement of unmet demand I found anywhere. Its own listing explains: *"The page is written in Japanese because it's a plugin originally build for vtubers."* Its homepage is indeed Japanese-only, and its documented fix for a lost dock is to open `%appdata%\obs-studio\global.ini`, find the `DockState=` line, delete it and save ([sorayuki.github.io/obs-multi-rtmp](https://sorayuki.github.io/obs-multi-rtmp/)).

The reviews are where the trigger lives. Verbatim, from that resource page:

- *"the newest version routinely causes catastrophic issues multistreaming between youtube and twitch. I am routinely running into error: can't connect to server, I resubmit all my information, and maybe one of out of every 50 times, it works. it's just awful."*
- *"I stream primarily on Youtube and wanted to stream on Twitch on the side. No matter what I do or change in the settings, it displays "Error: Failed to connect to server" what a waste of time this has been..."*
- *"Doesn't Load in the current version of OBS. I even updated it to the latest version and OBS says to update or remove the plug in."*
- *"It misses the automated setup like native OBS – for beginners, but honestly, if you already found this plugin by its name, it probably means that you know at least what you are doing."*

The commercial alternative, Aitum Multistream (**395,461 downloads**), draws the sharpest single requirement statement I found: *"It's not true multistream if you have to click every damned time (this is an outright dealbreaker for multi-pc streamers, especially so for those who stream to more than 2 or 3 services)."* And: *"Does not offer the ability to start add-on services to start streaming at the same time the main OBS Studio "start streaming" button is clicked."* ([reviews](https://obsproject.com/forum/resources/aitum-multistream.1991/reviews)). Another: *"Solid EXCEPT that it doesn't work with Kick and Twitch at the same time. Tried troubleshooting this for hours... and I work in IT."*

Demand in creator media matches: "Multistream to Twitch, YouTube, Tiktok, all at the same time! EASY!" (Senpai, **413,821 views**), "How to Multi-Stream (to Twitch, Kick, Tiktok, YouTube, WHEREVER!)" (Senpai, 243,351), "How to Multistream with OBS Studio (Twitch Youtube Tiktok Kick)" (Gael LEVEL, 92,309).

**Underlying need.** One GO LIVE button that starts and stops every destination at once, with per-destination quality that respects each platform's ceiling. A user explicitly asked for exactly that: *"in OBS I have set up Youtube as hautpstreaming platform and I stream there with 1440p and 15000 kb/s, I would like to limit these settings in the plugin for Twitch, because there only 1080p and 6000 kb/s are allowed."*

**LIVETAP feature.** Multi-destination as a first-class core concept, not a plugin: destination list, one GO LIVE, per-destination encode ladder (resolution/bitrate/codec derived from the platform's published limits), individual destination stop without killing the show, and an upfront honest arithmetic panel — "3 destinations × 6 Mbps = 18 Mbps upload required; your measured upload is 11 Mbps."

**Feasibility: HIGH.** libobs already supports multiple simultaneous outputs; the hard part is not encoding, it is the *product* work everyone skipped — shared-encoder reuse, per-destination scaling, coherent start/stop semantics, and legible errors. Meld proves the shape is shippable: *"Add platforms mid-stream by enabling new outputs while live"* and *"Stop individual streams without affecting others"* ([Meld multistream docs](https://meldstudio.co/docs/outputs/multistream/)). Be honest in the UI about the CPU cost — one plugin reviewer already is: *"each RTMP output puts on more stress to my machine, so I try to keep myself contained to 2 platforms."*

---

### T2. The show died and the software would not say why
**Rank 2.**

**Trigger moment (composite label, not a quote):** *"Twenty minutes into a live show it stopped, the viewers left, and the only thing the app told me was that something failed."*

**Segments:** all; decisive for event/church crews, agencies and podcasters who cannot re-shoot a live moment.

**Evidence — verbatim user statements, dated.** From the App Store review feed for **PRISM (id 1319056339)**, retrieved 2026-09-11:
- *"Today we used this app for the first time. Everything was going great and then the next thing you know it crashes and all of my viewers logged off. I have high speed internet so that's definitely not the problem."* (2 stars)
- *"...hoping they come with a feature that tells you if you are still live."* (5 stars — a happy user asking for a truth indicator)

From **Streamlabs mobile (id 1294578643)**, same feed:
- *"Ever since the new update or whatever, it says it's "live" when really it doesn't livestream anything."* (1 star)
- *"Error 403 keeps displaying when I try to go live. I've watched several videos and read plenty of "fixes" but nothing works."* (1 star)
- *"now connection drops and makes you go offline, so disappointing it used to be a great app regret updating it"* (1 star)

**Evidence — the incumbent's own strings.** OBS's localisation file carries **21 distinct stream-start failure messages**, and several are unactionable by construction: `FailedToStartStream.NoConfigSupplied="Missing config"`, `FailedToStartStream.InvalidCustomConfig="Invalid custom config"`, `FailedToStartStream.StatusMissingHTML="Go live request returned an unspecified error"`, `FailedToStartStream.MissingCanvas="A configured extra canvas is missing"` ([en-US.ini](https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/data/locale/en-US.ini)). DB-A already documented that OBS's remedy is to send the human to a second website with a log file.

Kick, meanwhile, publishes the *actual* failure taxonomy that the encoder should have known: wrong/reset stream key, non-CBR, H.265 unsupported, outdated encoder version, firewall/antivirus, and blocked ports on corporate or school networks ([Kick troubleshooting](https://help.kick.com/en/articles/14994318-obs-or-streamlabs-not-connecting-to-kick)). Every one of those is machine-checkable before GO LIVE.

**Underlying need.** Certainty. Before: "will this work?" During: "am I actually live?" After failure: "what broke and what do I press?"

**LIVETAP feature.** Three concrete things. (a) **Pre-flight check** that runs the Kick/YouTube list automatically — key valid, codec/rate-control legal for every selected destination, camera and mic producing non-silent signal, upload headroom ≥ sum of bitrates, disk space for the local recording — and blocks GO LIVE with one plain sentence per failure and a fix button. (b) **A single unambiguous live-state indicator per destination**, sourced from the platform's own API where available rather than from local RTMP state, because "it says live but nothing is going out" is a real reported failure. (c) **Named failures with one action each**, plus automatic reconnect with a visible countdown and an always-on local recording so a dead stream is never a lost show.

**Feasibility: HIGH.** This is product discipline, not technology. Pre-flight validation and a local safety recording are cheap. The honest caveat: "am I really live?" verification depends on each platform exposing a broadcast-status API — solid for YouTube and Twitch, thinner for key-only destinations, where LIVETAP can only report RTMP-level truth and must say so.

---

### T3. The vertical mandate arrives from the platform, not the creator
**Rank 3 — the fastest-moving trigger in 2026.**

**Trigger moment (composite label, not a quote):** *"My platform started rewarding vertical, and doing vertical in my current setup means a second canvas, a second profile, or a second copy of the whole app."*

**Segments:** mobile/short-form creators (primary), Twitch/YouTube streamers (newly), podcasters repurposing clips.

**Evidence.** Twitch launched **Dual Format streaming on 2026-06-17**, stating *"70% of new viewers are coming to Twitch on mobile"* and that vertical *"layouts stand out in the mobile feed and drive more clicks into your stream."* It is built on *"Enhanced Broadcasting technology, which uses the client to encode multiple variants of your stream,"* with *"server side transcoding for Partners and many Affiliates to offset the strain"* ([Twitch blog](https://blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/)). Read that as a platform instructing the client-side encoder to become multi-canvas.

The OBS ecosystem's answer, Aitum Vertical, has **984,167 downloads**, 4.15 stars, first released 2023-05-10 and still shipping (last update 2026-05-21). Its pitch names the job precisely: *"Make content for TikTok, YouTube Shorts, Instagram Live, and more without the fuss."* ([resource page](https://obsproject.com/forum/resources/aitum-vertical.1715/)). Roughly a million downloads for "make OBS do a second aspect ratio" is a feature-shaped hole, not an edge case.

Creator demand confirms it: "The Big Problem With OBS VERTICAL Streaming (And How To Fix It)" (nutty, 117,621 views), "How To Vertical Stream & Record In OBS Studio! (Tiktok & Twitch Aitum Plugin)" (oMace, 125,701), "How to Stream Vertical AND Horizontal to YouTube (OBS Guide 2026)" (Tech Grant, 22,558).

Meld already treats this as a core capability: *"Each output can be configured independently, allowing you to create and broadcast content in both landscape and portrait formats from the same project."*

**Underlying need.** One show, two shapes, no duplicated work — and the vertical version must not be a letterboxed crop.

**LIVETAP feature.** Native multi-canvas: a 16:9 program and a 9:16 program that share sources, with per-canvas framing (each source gets a position in both canvases) and linked scene switching so cutting a scene cuts both. Destination selection sets canvas automatically: choose TikTok or IG and you get 9:16; choose Twitch and you are offered both.

**Feasibility: MEDIUM-HIGH.** Aitum demonstrates it is achievable as a *plugin*, so it is certainly achievable as an architecture decision — but only if multi-canvas is designed in at the start. Retrofitting a second canvas onto a single-canvas renderer is the kind of thing that produces the "extra canvas is missing" class of bug OBS already has a string for. Encode cost is real and must be surfaced.

---

### T4. The accounts fell off and took the moment with them
**Rank 4.**

**Trigger moment (composite label, not a quote):** *"I opened the app to catch something happening right now, and it made me log in and verify again."*

**Segments:** mobile creators (acute), all others (chronic).

**Evidence.** Verbatim from the PRISM review feed: *"I keep having to log in and verify myself. I end up missing the moment I'm trying to share."* And from Streamlabs mobile: *"now I can't even log into TikTok with it for absolutely no reason when I click TikTok it's bugged and everything is moved up and I can't scroll down and do it, and using Google to log in just doesn't do anything."* Also: *"I got the app and I try to put my YouTube channel as what it told me to do but when I do nothing happen still ask me the same thing and so I try it again and again and again."*

Kick's official troubleshooting ends by advising users to abandon the encoder's own connection path: *"If OBS continues to give you trouble, Streamlabs Desktop has a built-in KICK integration that handles the connection for you."* That is a platform telling users that **managed account connection is the fix for connection failure** — precisely LIVETAP's thesis. DB-B already logged PRISM's open issue "Authentication methods not unified across platforms."

**Underlying need.** Connect once; stay connected; if a token dies, be told before GO LIVE, not at GO LIVE.

**LIVETAP feature.** A Connections surface that is a living thing: per-account status (valid / expiring / re-auth needed), silent refresh in the background, re-auth prompted at app launch rather than at showtime, and connections that survive app updates and machine moves. Pre-flight re-checks every token.

**Feasibility: HIGH for the engineering, MEDIUM for the coverage.** Refresh-token handling is routine. The real constraint is which platforms grant an open-source desktop client an OAuth app at all: YouTube and Twitch are straightforward; Kick is key-based; TikTok and Instagram live-streaming APIs are gated (see Section 6). Do not promise "connect your accounts" for platforms where the honest answer is "paste a key."

---

### T5. An update broke the show
**Rank 5.**

**Trigger moment (composite label, not a quote):** *"The app updated itself and the thing I do every week stopped working an hour before I went on."*

**Segments:** OBS experts and pros (plugin-coupled setups), mobile creators (forced store updates).

**Evidence.** Streamlabs mobile, verbatim: *"Latest Update BROKE APP :: Streaming does not work for scheduled streams as of v5.0.3. Ruined my stream night."* And *"After the update is trash not sure why yall changed the connection or whatever."* And *"it was working completely fine. My volume was fine but now my stream can't hear me and I've messed around with all the settings."*

On desktop the coupling is structural: multi-RTMP reviewers report *"It has been working well on my M1 Macbook until OBS Studio 28 but when I updated to OBS Studio 29 the plugin shows in Finder but OBS will not recognize it"* and *"Needs to be updated to OBS 29, when I opened it, it didn't show up."* DB-A already catalogued the OBS 31.x/32.x plugin-crash waves. The dependency runs both ways: the plugin listing itself now requires **minimum OBS 30.2.0**, so staying on an old OBS is not a safe harbour either.

**Underlying need.** My working configuration must be a thing I own, not a thing that dissolves when software changes underneath it.

**LIVETAP feature.** (a) A core that needs no third-party binary to do the common jobs (multistream, vertical, background removal, scene automation) — every plugin a user must install is a future break. (b) Versioned show configuration with rollback: "restore the setup that worked on your last successful stream." (c) Never auto-update inside a scheduled show window; offer "update after my next stream."

**Feasibility: HIGH**, and it is partly a *policy* feature rather than a code feature — which makes it cheap and differentiating.

---

### T6. First run did not produce a stream, it produced homework
**Rank 6.**

**Trigger moment (composite label, not a quote):** *"I installed it to go live tonight and instead spent the evening learning what a keyframe interval is."*

**Segments:** all newcomers; converts from platform-native tools; volunteer crews.

**Evidence — primary, from OBS itself.** The wizard's first question is *"Specify what you want to use the program for"*, and its only three options are `"Optimize for streaming, recording is secondary"`, `"Optimize just for recording, I will not be streaming"`, `"I will only be using the virtual camera"` ([en-US.ini](https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/data/locale/en-US.ini)). OBS *does* ask about intent — but intent is consumed to pick encoder settings, never to produce a scene. The wizard's bandwidth test also warns it *"is about to stream randomized video data without audio to your channel."*

Scale of the vocabulary: the OBS front-end ships **1,443 localised strings**, of which **135 are under `Basic.Settings.Output`** alone, 51 under `Advanced`, 41 under `Stream`, 33 under `Audio`. The Quick Start Guide — *"Get Started in 5 Easy Steps"*, whose step 5 is *"There is no Step 5!"* — names 14 distinct concepts before first stream (Auto-Configuration Wizard, Scene, Source, Display Capture, Window Capture, macOS Screen Capture, Game Capture, Video Capture, Sources Dock, Audio Mixer, Settings→Audio, Settings→Output, Controls Dock, Start Streaming) and closes by telling you not to go live yet: it *"strongly encourage[s] running a test for a few minutes to make sure that there are no issues, rather than just jumping in to your first stream or recording"* ([Quick Start Guide](https://obsproject.com/kb/quick-start-guide), dated 2021-08-25 — and headed by OBS's own notice that the knowledge base is *"still currently a work in progress"* and that they *"ask that you avoid linking users to any knowledge base pages at this time"*).

Sentiment, attributable: *"OBS is super complicated for non tech-savvy users"* ([HN 22613322](https://news.ycombinator.com/item?id=22613322)); *"As a seasoned user, I love the UI. But also I'm a seasoned user. It is a highly complicated software... A dead-simple mode might suffice"* (kawfey, [HN 22749402](https://news.ycombinator.com/item?id=22749402)); *"OBS was a lot more complicated"* than recording a presentation in Office ([HN 39969689](https://news.ycombinator.com/item?id=39969689)). Descript's comparison says it plainly: *"Beginners may be turned off by the learning curve"* ([Descript](https://www.descript.com/blog/article/obs-vs-streamlabs)).

The tutorial economy is the demand proxy: a single beginner OBS tutorial has **1,558,364 views** (Primal Video), settings guides 997,308 and 786,043 views (Cpaws Music). People are paying with hours.

**Underlying need.** A working, on-air-looking show in the first two minutes, with the technical layer chosen for me and inspectable later.

**LIVETAP feature.** Intent-first onboarding (validated with caveats in Section 5): answer one question about what you are doing, get a real scene, a destination and a canvas already configured, then GO LIVE. Zero encoder vocabulary on the default path; an "Advanced" drawer that exists but is never required.

**Feasibility: HIGH.** The risk is not building it, it is *maintaining* the promise — every future feature will want a slot on the first screen.

---

### T7. The destination I need is not in the list
**Rank 7.**

**Trigger moment (composite label, not a quote):** *"My audience is on a platform my software does not support, so I changed software, not audience."*

**Segments:** short-form/mobile creators (TikTok), cam/adult creators (arbitrary RTMP), agencies (client platforms), Kick-curious gamers.

**Evidence.** Straight comparison-shopping in the wild, verbatim from the PRISM feed: *"I don't like how there's pop-up ads in this app. **Streamlabs works just fine. Streamlabs has TikTok too.**"* And: *"My content is TikTok and I wanna stream my Vtuber content and I can't so please please make it compatible with TikTok please."* From the Aitum Multistream reviews: *"As a cam model it was so hard to find a multi stream plugin that lets me put in my live cam sites and multiple RTMPs to any cam site I could ever need."*

TikTok is where the tutorial volume concentrates — "How To Stream on TikTok Using OBS and Stream Key" (MidnightMan, **576,037 views**), "How To Livestream On TikTok PC" (235,988), plus a whole genre of "without a stream key" workarounds (49,263 / 41,559 / 36,777 views) that only exists because access is gated.

**Underlying need.** Go where my audience is, today, without changing tools.

**LIVETAP feature.** Destinations as a maintained, tested, versioned catalogue — OAuth where the platform allows it, a first-class **Custom RTMP/RTMPS** destination with saveable named presets everywhere else, and per-destination published limits baked in (Kick: CBR only, no H.265) so pre-flight can enforce them.

**Feasibility: HIGH for Custom RTMP and key-based platforms; MEDIUM-to-LOW for TikTok/Instagram OAuth** (Section 6). Custom RTMP is the highest-leverage single destination in the product: it silently unlocks Kick, LinkedIn-via-partner, cam sites, Restream/Castr relays, and any client's private ingest.

---

### T8. The rebuild tax (new machine, second machine, new OS)
**Rank 8.**

**Trigger moment (composite label, not a quote):** *"I got a new computer and realised I would have to rebuild two years of scenes by hand — so I evaluated alternatives while I was at it."*

**Segments:** OBS experts, pros/agencies (multi-operator, multi-machine), podcasters with a fixed set.

**Evidence.** OBS's Scene Collections *"save all Scenes and Sources that have been added to it"* and *"contain Global Audio Sources from Settings -> Audio"*, but *"Scene Collections do not store output settings. Use Profiles"* ([OBS KB](https://obsproject.com/kb/scene-collections)). Streamlabs documents the resulting gap explicitly: scene collections import *"seamlessly"*, but *"not all settings can be transferred automatically. This means that while scene collections can be imported easily, other settings like your output configurations, hotkeys, and audio settings will need to be manually set up again"* ([Streamlabs](https://streamlabs.com/content-hub/post/import-scenes-streamlabs-plugin-for-OBS)). So even the *supported* migration path drops hotkeys — the exact thing an expert's muscle memory is built on.

Ecamm shows the delightful version of the same job: select scenes, drag them to the Desktop, and each becomes a portable `.ecammlive` file (or use the share button to bundle several); double-click to import. The only caveat is documented honestly: *"If a video file is referenced in a Scene, the video file itself is not contained within the Scene File"* ([Ecamm](https://support.ecamm.com/en/articles/3819218-moving-scenes-and-overlays-to-another-mac)).

**Underlying need.** My show should be a file I can carry, back up, hand to a colleague, and restore.

**LIVETAP feature.** A single portable show bundle (scenes + sources + framing for both canvases + hotkeys + destination references, with assets either embedded or referenced with a visible missing-asset report), one-click export/import, and an OBS scene-collection importer (Section 4).

**Feasibility: HIGH.** Defining the file format early is the whole trick.

---

### T9. The trust event: an ad, a charge, or a clawback
**Rank 9 — lower evidence volume, but the highest-velocity switch when it fires.**

**Trigger moment (composite label, not a quote):** *"The software I use to run my business showed me a discount banner / charged me / cost me money, and I uninstalled it that day."*

**Segments:** all; strongest among monetising streamers and agencies.

**Evidence.** A verbatim Aitum Vertical review shows the whole arc in three sentences: *"I really do appreciate the giant "30% OFF THE APP - USE CODE 'LOVE'" appearing in my OBS Studio. Great feature."* / *"If I wanted to pay for your software, I would have. **This just got me to uninstall it.** It's been lying around inactive but open for ages in my OBS."* ([reviews](https://obsproject.com/forum/resources/aitum-vertical.1715/)). Another, from the same family of feeling: *"Ah, yes, OBS Studio: A shining example of exemplary FOSS software."*

On mobile, PRISM's move to a paid model produced: *"They are still thieves. Don't pay for this. Read why. :: Well, here we are nearly June, and they still haven't fixed anything. The low frame rates all started after they went to a paid model."* And *"WHY DOES THE FPS KEEP DROPPING!!! ... I'm paying for this by the way. FIX YOUR APP!!!"* On HN, Streamlabs' upsell mechanics drew a detailed complaint about being unable to filter free assets out of a Prime-dominated store ([eggbrain, HN 22750441](https://news.ycombinator.com/item?id=22750441)). DB-A already documents Streamlabs' $4.4M auto-renewal class-action settlement.

And a platform-side version of the same shock: Kick reduces partner payouts by half while you multistream — *"If you Multistream with the toggle enabled, your payout will be reduced by 50% for the duration of the Multistreaming session"* ([Kick](https://help.kick.com/en/articles/11091744-multistreaming-on-the-kick-partner-program)).

**Underlying need.** Predictability, and a tool that does not have commercial designs on my broadcast.

**LIVETAP feature.** Open-source core; no upsell surface inside the live UI, ever; no destination count as a pricing axis; local-first data so leaving is possible. Say all of this on the download page, because this trigger is won at the moment of comparison, not the moment of use.

**Feasibility: HIGH** — a governance commitment. Its whole value is that it is credible and irreversible, so any future monetisation must be designed to never violate it (support/hosting/cloud relay, not destination gating).

---

### T10. The second-class-platform trigger
**Rank 10 — narrow but a hard switch when it fires.**

**Trigger moment (composite label, not a quote):** *"I changed OS, or I am on Linux, and my tool is either absent or an afterthought."*

**Segments:** pro producers on Windows-only stacks, Linux-using technical creators, Mac podcasters.

**Evidence.** From DB-B: vMix is Windows-only with reviewers flagging the absence of Linux; Meld Studio has no Linux build; Switcher Studio's production app is Apple-only. From DB-A: macOS has no OS-level desktop-audio capture without a virtual device. New here: OBS's own importer source carries per-OS source-type remapping because a scene collection is not portable across operating systems — `studio.cpp` maps `game_capture`→`syphon-input`, `wasapi_input_capture`→`coreaudio_input_capture`, `pulse_output_capture`→`coreaudio_output_capture`, and so on ([studio.cpp](https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/importers/studio.cpp)).

**Underlying need.** The same show on whatever machine I own.

**LIVETAP feature.** True tri-platform desktop parity (Windows/macOS/Linux), and — copying OBS's own trick — an OS-aware source remapping layer inside the show-file importer so a Windows show opens on a Mac with its capture sources rewired rather than broken.

**Feasibility: MEDIUM.** Cross-platform capture is the single biggest recurring engineering cost in this category; the remapping table is cheap once capture works.

---

### Triggers considered and demoted (with reasons, so nobody re-litigates them)

- **"OBS is bloated / heavy."** The evidence points the other way: OBS is the *light* one (DB-A records ~1% CPU / 232 MB idle versus Streamlabs ~5% / 1.2 GB), and HN commenters praise it as *"extremely flexible and surprisingly reliable."* Performance is a reason people switch *to* OBS, not away. Do not build the pitch on it — but do not lose it either: an Electron-heavy LIVETAP would hand this trigger to the incumbent.
- **"Better-looking overlays / themes."** Real demand, but it is served by Streamlabs/StreamElements *inside* OBS, so it does not force an app switch. Treat as retention, not acquisition.
- **"Chat in one place."** Shows up in creator media ("Meld Adds a Built-In Chat Dock (Finally!)", "Comparing Meld Chat to Restream & OBS Plugins") and one PRISM reviewer's wish list, but it is a *delight* multiplier on top of a real trigger rather than a trigger itself.

---

## 2. Anti-triggers — what stops a frustrated OBS user from leaving

These are ranked by how reliably they kill a switch. Every one of them is also a design constraint.

### A1. The plugin ecosystem is accumulated capital (strongest anti-trigger, and it is quantifiable)

Leaving OBS means leaving all of this behind. Download counts from OBS resource pages, retrieved 2026-09-11:

| Plugin | Downloads | What leaving costs the user |
|---|---|---|
| [obs-multi-rtmp](https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/) | 2,888,784 | multistream |
| [Move](https://obsproject.com/forum/resources/move.913/) | 2,564,134 | animated transitions; the "polished show" look |
| [Background Removal](https://obsproject.com/forum/resources/background-removal-virtual-green-screen-low-light-enhance.1260/) | 1,589,463 | no-greenscreen keying |
| [Aitum Vertical](https://obsproject.com/forum/resources/aitum-vertical.1715/) | 984,167 | vertical output |
| [Downstream Keyer](https://obsproject.com/forum/resources/downstream-keyer.1254/) | 431,912 | persistent lower-thirds/branding |
| [Aitum Multistream](https://obsproject.com/forum/resources/aitum-multistream.1991/) | 395,461 | multistream (commercial) |
| [obs-shaderfilter](https://obsproject.com/forum/resources/obs-shaderfilter.1736/) | 309,728 | custom visual effects |
| [PTZ Controls](https://obsproject.com/forum/resources/ptz-controls.1284/) | 210,355 | camera control (events, churches) |
| [Touch Portal](https://obsproject.com/forum/resources/touch-portal.755/) | 210,337 | hardware control surface |

**Design consequence.** LIVETAP cannot win on feature-completeness against that. It must win by making the *top four jobs* (multistream, vertical, keying, clean lower-thirds) native and boring — those four alone represent the plugins with over 400k downloads each. Anything below that line, concede for now and say so honestly.

### A2. Muscle memory, hotkeys and hardware surfaces

An expert's speed lives in their fingers and their Stream Deck. The tutorial corpus shows how deep that goes: "OBS Studio: Ultimate Stream Deck Guide" (133,930 views), "Setup Elgato Stream Deck With OBS Studio Plugins" (119,389), "The Best Way to Switch Scenes in OBS Studio - Elgato Stream Deck" (49,391). And note OBS ships only **6** `Basic.Settings.Hotkeys.*` strings while supporting per-source and per-scene bindings — the configuration is deep but sparsely labelled, i.e. it is memorised, not read. Meanwhile the documented Streamlabs-to-OBS migration path explicitly *does not* carry hotkeys.

**Design consequence.** Import hotkeys if at all possible (Section 4), ship a Stream Deck / control-surface integration path early, and never renumber or rename a user's bound actions across versions.

### A3. Automation and bot integrations (obs-websocket gravity)

Chat bots, alert systems, Advanced Scene Switcher automations and stream-deck macros all talk to OBS over a stable local API. A tool without an equivalent is a downgrade for anyone whose show has moving parts. A plugin reviewer's aside captures how load-bearing it gets: *"It saves RTMP credentials to each Profile in OBS so for Multiple Channels there's easy setup on the same system."*

**Design consequence.** Ship a documented local control API (and ideally an obs-websocket-shaped compatibility surface) in v1, not v3.

### A4. "It works, and the show is tonight"

Risk aversion in a live context is rational and near-absolute. HN's kawfey states the expert's position exactly: *"if you do anything with streaming or recording it's worth it to learn the deeper idiosyncrasies of OBS."* Switching costs are paid in the one currency a live producer cannot borrow: a failed broadcast.

**Design consequence.** Support running LIVETAP *alongside* OBS. Ship a "Rehearsal" mode that proves the whole pipeline without going live. Encourage adoption at the lowest-risk moment (a new show, a new platform, a new machine) rather than mid-season. Never ask a user to make their flagship stream the experiment.

### A5. Trust in free and open, and suspicion of the new thing

OBS asks for nothing: no account, no telemetry consent, no payment, no watermark. LIVETAP's "connect your accounts" is, from a cold start, a *larger* ask than OBS's stream-key paste. The plugin-store review threads show this anxiety is live — multi-RTMP reviewers argue about VirusTotal results and installer safety, and one simply says *"dont know what people are smoking saying its a virus."*

**Design consequence.** Be more transparent than necessary: signed builds, reproducible builds if possible, published scopes for every OAuth request, a visible "what leaves this machine" statement, and a working stream-key-only path for people who will not OAuth.

### A6. The incumbent's counter-move: hybridisation

Streamlabs no longer asks OBS users to leave — it sells them a plugin. Its own words: the plugin *"allows you to integrate Streamlabs' most popular features directly into OBS without having to switch platforms,"* aimed at streamers *"already comfortable with OBS Studio and aren't quite ready to make the switch,"* who can *"still use the OBS interface you're familiar with"* ([Streamlabs](https://streamlabs.com/content-hub/post/find-your-fit-streamlabs-desktop-vs-obs-plugin)). Every new LIVETAP capability can be neutralised by an OBS plugin that delivers 70% of it without a switch. This is, historically, how OBS absorbs its challengers.

**Design consequence.** Compete on things a plugin structurally cannot fix — the first-run experience, the coherence of one GO LIVE across destinations and canvases, and the absence of encoder vocabulary. A plugin cannot un-teach "keyframe interval."

### A7. Honest reviewers talk people out of switching

The same YouTube corpus that sells switching also sells staying: "MELD STUDIO, is it worth switching from OBS ? A in-depth look as to why not" (SANGWHiCH), "Meld isn't competing with OBS…" (nutty, 27,857 views), "OBS still does some things better" (a chapter inside the 202k-view Senpai switching video itself), and chapters titled "What I Still Can't Do (Zoom to Mouse + Dual Record)" and "Camera Conflicts with OBS + Meld Open at Once" (LiveEnvy).

**Design consequence.** Publish your own honest gap list. The reviewers will find it anyway, and pre-empting it converts a takedown into a credibility win. Also: fix camera-device exclusivity early — "I can't run both apps at once" blocks the safest possible trial path.

### A8. The physics do not care which app you use

Local multistream costs encode cycles and upload bandwidth no matter whose logo is on the window: *"each RTMP output puts on more stress to my machine, so I try to keep myself contained to 2 platforms"*; Meld says it plainly — *"The total required upload bandwidth is the sum of all active output bitrates."* Twitch's Dual Format announcement concedes the same by adding server-side transcoding *"to offset the strain."*

**Design consequence.** Do not market away from physics. Show the arithmetic, offer per-destination downscaling by default, and (later, optionally) a cloud relay for users whose upload cannot carry three destinations — that is also the honest monetisation path that does not violate A5/T9.

---

## 3. Per-segment table

**MVD = "minimum viable delight": the smallest thing that would make this segment choose LIVETAP for their next show.**

| Segment | Primary JTBD (their framing) | Current tool(s) | Top 3 switching triggers | Minimum viable delight | The one thing that makes them leave LIVETAP |
|---|---|---|---|---|---|
| **OBS experts / power users** | "Run a reliable multi-scene show I fully control, and automate it." | OBS + 3-10 plugins + Stream Deck + obs-websocket bots | T1 multistream tax (plugin fragility: *"maybe one out of every 50 times, it works"*); T5 update broke my plugins; T8 rebuild tax across machines | Native one-button multistream with **per-destination bitrate/resolution** and a documented control API — the two things their plugin stack does worst. Import my scene collection and my hotkeys. | A missing plugin-equivalent with no escape hatch, or a control API that breaks between versions. They will return to OBS the same evening. |
| **Twitch / YouTube gaming streamers** | "Be live fast, on more than one platform, without tanking my game's framerate." | OBS or Streamlabs Desktop; multi-RTMP plugin; Twitch Enhanced Broadcasting | T1 multistream tax; T3 vertical mandate (Twitch Dual Format, *"70% of new viewers... on mobile"*); T2 dying mid-show | Twitch + YouTube (+ Kick) from one GO LIVE, 16:9 and 9:16 together, with a visible "your GPU/upload can support this" check before the game launches | Measurable in-game FPS cost versus OBS, or a dropped/failed stream they cannot explain. Performance is OBS's home turf. |
| **Podcasters / interview shows** | "Record a clean two-to-four-person show, stream it live, and get usable files and clips." | OBS (hard mode), Ecamm (Mac), Riverside/StreamYard (browser), vMix (pro) | T6 first-run homework (*"an encoder expert to get pro-grade results"* — StreamYard on OBS); T2 show death with no local backup; T8 rebuild tax | Podcast intent produces a two-camera + shared-screen scene set, per-guest audio tracks recorded locally, and an always-on local recording that survives a stream failure | Audio that goes wrong invisibly (the number-one silent killer in DB-A) or no separate tracks for post. They will pay Riverside instead. |
| **Social / short-form creators** | "Go live wherever the algorithm is paying attention this month, vertically." | TikTok LIVE Studio, Streamlabs, PRISM, OBS + Aitum Vertical | T3 vertical mandate; T7 destination gap (*"Streamlabs has TikTok too"*); T1 multistream tax | 9:16 canvas by default, TikTok + YouTube (Shorts) + IG-capable output, and "stream vertical and horizontal from one show" without a second app | Being blocked at the destination step by an API they cannot see, with no explanation of the platform's own eligibility gate. |
| **Mobile creators (TikTok/IG vertical)** | "Capture what is happening right now, from my phone, and not lose it." | Phone-native LIVE, PRISM (4.62 stars, 6,188 ratings), Streamlabs mobile (3.87 stars, 1,174 ratings), Larix | T4 auth/session loss (*"I end up missing the moment I'm trying to share"*); T2 crash mid-stream (*"it crashes and all of my viewers logged off"*); T9 ads/paywall inside the live UI | Open app, already connected, one tap live — plus survival of app-switching and screen-lock, and a local recording kept even if the stream dies | Thermal throttling / FPS collapse after 20-30 minutes (the dominant PRISM complaint) or a stream that silently reports "live" while sending nothing. |
| **Professional producers / agencies** | "Deliver a client's broadcast with no surprises, on a schedule, with a redundancy story." | vMix, Wirecast, OBS + hardware, Ecamm (Mac) | T2 unexplained failure mid-event; T1/T7 many destinations incl. client-private RTMP; T10 OS/hardware lock-in | Pre-flight validation and a rehearsal mode they can show a client, Custom RTMP with named presets per client, PTZ/control-surface support, and a portable show file handed between operators | No redundancy story (no backup ingest, no failover, no reconnect log). Or no support channel when it breaks — DB-A records OBS being marked down for exactly this: *"no traditional support team."* |
| **(Adjacent) Church / event volunteer crews** | "Let a rotating, non-technical volunteer run the same service stream every week identically." | OBS with a frozen scene collection; ProPresenter alongside | T6 first-run/teachability; T2 failure nobody on site can diagnose; T8 handover between volunteers | A locked "operator mode": the saved show, a big GO LIVE, and nothing else clickable; plus a one-page failure card generated by the app | A layout a volunteer can break, or an error message the volunteer cannot act on while the service is running. |

---

## 4. Migration expectations, and what to actually build

### 4.1 What an OBS user assumes will come with them

Ranked by how loudly its absence is felt, based on what the documented migration paths do and do not carry:

| Asset | Where it lives in OBS | Do they expect it to migrate? | Reality of the best existing path (Streamlabs to OBS) |
|---|---|---|---|
| Scenes, sources, layout/transforms | Scene collection (JSON) | Yes, absolutely | Migrates — *"scene collections can be imported seamlessly"* |
| Per-source filters (chroma key, colour correction, noise suppression, compressor) | Inside the scene collection | Yes | Partially — filter *items* are carried in OBS's own Streamlabs importer (`sl.cpp` reads `source["filters"]["items"]` and emits an `out_filters` array) |
| Global audio devices | Scene collection (*"contain Global Audio Sources from Settings -> Audio"*) | Yes | Documented as **not** transferring: *"audio settings will need to be manually set up again"* |
| Hotkeys | Scene collection + profile | **Yes — and this is the muscle-memory asset** | Documented as **not** transferring |
| Output/encoder settings | Profile | Mixed; experts yes | **Not** transferring |
| Stream keys / connected accounts | Profile / service config | Would like to, know they cannot | Not transferred (and should not be) |
| Browser-source overlay URLs (StreamElements/Streamlabs widgets) | Source settings in the collection | Yes | Carried if browser sources are carried |
| Plugin-backed sources and filters | Third-party binaries | Hope so, expect not | Cannot transfer |
| Stream Deck / control-surface mappings | External app | Yes, tacitly | Out of scope for any importer |

Two facts make this section actionable. First, **OBS itself ships four importers** — `classic.cpp`, `sl.cpp`, `studio.cpp`, `xsplit.cpp` under [`frontend/importers/`](https://api.github.com/repos/obsproject/obs-studio/contents/frontend/importers) — so "import a competitor's scenes" is a table-stakes feature in this category, established by the incumbent. Second, the importers reveal the technique: a per-source-type translation table. `studio.cpp` is literally a list of `DirectTranslation(before, after)` and `ClearTranslation(before, after)` macros mapping `text_gdiplus` to `text_ft2_source`, `game_capture` to `syphon-input`, `wasapi_output_capture` to `coreaudio_output_capture`; and `sl.cpp` walks `root["sources"]["items"]`, rewrites `capture_source_list` into `monitor`/`window`/`cursor`, and rebuilds scene items with names and an `id_counter`. That is a few hundred lines of mapping per format, not a research project.

### 4.2 Is an OBS scene-collection JSON importer worth building? Yes — with a truth report.

**Feasibility: HIGH / well-understood.** A scene collection is a single JSON document containing a `sources` array (each with `id`, `versioned_id`, `name`, `settings`, `filters`) plus scene sources whose settings hold `items` with per-item transform data. You do not need to reverse-engineer it: OBS's own `studio.cpp` importer reads exactly this structure and is GPL-licensed reference material — and note that GPL reuse is a live licensing consideration, so read it as documentation of the schema and write your own mapper.

**Value: HIGH, and asymmetric.** It attacks anti-triggers A1 and A2 and the T8 rebuild tax simultaneously, and it converts the most valuable segment (experts, who have the most scenes) at the moment they are most open (new machine, new season, new platform). It also removes the single most common "I'll try it later" excuse.

**Recommendation — three tiers:**

**Tier 1 — build for v1.**

1. Scene-collection JSON import covering the source types that constitute the overwhelming majority of real shows: display capture, window capture, game capture, video capture device (webcam/capture card), image, image slideshow, media source, text, colour source, browser source, audio input capture, audio output capture, and nested scenes/groups.
2. Transforms: position, scale, rotation, crop, bounding-box mode, visibility, lock, z-order.
3. A conservative filter subset: chroma key, colour key, colour correction, crop/pad, scaling, LUT; audio gain, noise suppression, noise gate, compressor, limiter.
4. **The truth report.** After import, show a plain-language ledger: "17 sources imported. 2 sources could not be imported because they come from plugins (StreamFX Blur, Move Transition). 1 media file was not found at its old path. Your output settings were deliberately not imported — LIVETAP chooses these for you; you can inspect them in Advanced." This single screen is the difference between an importer that builds trust and one that silently produces a broken show. Nobody in this category does it well.
5. OS remapping on import (Windows / macOS / Linux capture types), copying OBS's own approach — nearly free once the mapping table exists, and it directly addresses T10.

**Tier 2 — build for v1.1, in this order.**

6. **Hotkeys.** Highest emotional value per line of code, because it is the one thing every existing migration path drops (A2). Map OBS's scene-switch and source-visibility bindings onto LIVETAP equivalents; report anything unmapped.
7. Audio mixer state: per-source volume, mute, and monitoring mode — with a deliberate warning on monitoring, since DB-A identifies "Monitor and Output" as the documented cause of echo.
8. Export back to OBS scene-collection JSON. Counter-intuitive but strategically important: it removes the switch's irreversibility, which is exactly what anti-trigger A4 is made of. "You can always go back" is a conversion feature.

**Tier 3 — explicitly do not build, and say why in the docs.**

9. Profiles / encoder settings. Importing these imports the problem. LIVETAP's proposition is that it decides these; inheriting a user's hand-tuned `Basic.Settings.Output` values (135 strings' worth) would drag the entire vocabulary across the border.
10. Plugin-backed sources, shader filters, StreamFX chains. Name them in the truth report; do not emulate them.
11. Stream keys and account credentials. Make users re-connect; it is the safer choice and it showcases T4.

**Also build the native portable format now**, Ecamm-style: a single `.livetap` show bundle a user can drag to the desktop, hand to a colleague or restore on a new machine — including per-canvas framing — with the same honest caveat Ecamm publishes about externally-referenced video files.

---

## 5. Intent-based onboarding: validating "What are you doing? Talking / Gaming / Podcast / Presentation / Event / Vertical Live"

### 5.1 Evidence FOR

**The strongest single argument is that OBS already asks the question — and wastes the answer.** OBS's wizard opens with *"Specify what you want to use the program for"*. But its three options are `"Optimize for streaming, recording is secondary"`, `"Optimize just for recording, I will not be streaming"`, `"I will only be using the virtual camera"` ([en-US.ini](https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/data/locale/en-US.ini)). The user's answer is converted into *encoder settings* and then they are dropped onto a blank canvas: the Quick Start's very next step is *"When you start OBS Studio, you start with a blank scene by default"* ([Quick Start Guide](https://obsproject.com/kb/quick-start-guide)). The intent question exists, points at the wrong output, and the guide then tells the user to go find Stream Layout Tutorials 1, 2 and 3. The gap is not "should we ask intent" — it is "intent should produce a *show*, not a bitrate."

**Cross-category precedent with exact wording** (secondary source, Userpilot's onboarding write-ups): Canva asks *"What will you be using Canva for?"* (personal / work and business / education / nonprofit) — described as removing *"the 'what do I do now?' moment"* and replacing it *"with something actionable"*; Loom asks *"How are you planning to use Loom?"*; Airtable progressively asks where you work, industry, and team; Monday and Asana both branch into role and then into **templates** ([welcome-survey](https://userpilot.com/blog/welcome-survey/), [good-onboarding-surveys](https://userpilot.com/blog/good-onboarding-surveys/)). The only activation number I could verify in either article is a single vendor case study — Kontentino, *"a 10% increase in new user activation"* in the first month after adding a three-question welcome survey. **Treat that as directional, not as a benchmark: n=1, vendor-published.**

**Whitespace in this category is real and verifiable.** I checked the two most credible modern competitors' own first-run documentation:

- Meld Studio's install docs cover download / run / launch (3 steps on Windows, 4 on macOS) and contain **no** setup wizard, template gallery, preset offering or account-connection flow ([Meld install](https://meldstudio.co/docs/getstarted/install/)).
- Ecamm's entire "Getting Started" collection — 19 articles from "Download Ecamm" and "What Can Ecamm Do?" through "Using Scenes" and "Your First Facebook Live Broadcast" — mentions **no** templates, presets or guided first run ([Ecamm getting started](https://support.ecamm.com/en/collections/1870659-getting-started-with-ecamm)). Its marketing sells the capability without the on-ramp: *"Saved scenes means you can compose scenes in advance."*
- TikTok's own LIVE Studio FAQ documents no templates either; what it documents instead is an eligibility wall — *"If you meet the requirements, simply click Get access to go LIVE. If not, you'll see the unmet requirements displayed in gray"* ([TikTok FAQ](https://www.tiktok.com/live/studio/help/article/FAQ/FAQ)).

So intent-to-template onboarding is proven in adjacent creative software and essentially unoccupied in live production.

**Segment-fit evidence.** The intents in the proposed list map onto observable content genres with measurable demand: gaming (the multistream corpus above), podcast/multi-cam ("How to Film Pro Multi-Cam Podcasts and Live Streams", Riverside, 29,746 views; "Best Multicam Live Streaming Setup for Podcasting", Tom Buck, 13,479), presentation/event (the church-volunteer corpus: "OBS for Churches: How to Set Up a Professional Livestream", 131,250 views), vertical (T3's ~1M Aitum Vertical downloads).

### 5.2 Evidence AGAINST (and the specific failure modes to avoid)

1. **An intent question that changes nothing is pure friction.** Every answer must visibly alter the next screen — scene set, canvas orientation, destination default, audio defaults — or it reads as a marketing survey and directly inflates "time to first stream", the very metric LIVETAP is trying to win (Section 7).
2. **Users pick wrong, and mis-branching is worse than not branching.** A gamer doing a Just Chatting stream, or a podcaster who also screen-shares, will be misfiled. Mitigation: every intent must be switchable *after* the fact without losing work, and the scene sets should overlap heavily rather than being disjoint products.
3. **Six branches is a QA multiplier.** Each intent times each canvas times each destination times each OS is a support matrix. Six is at the top of what a small open-source team can keep genuinely working, and a half-broken template is worse than a blank canvas because it teaches distrust on day one.
4. **"Vertical Live" is not the same kind of thing as the other five.** Talking, Gaming, Podcast, Presentation and Event are *content jobs*; Vertical is an *output shape*. A vertical podcast and a vertical gaming stream are both real. Putting an orientation in a list of genres forces a false choice and hides the fact that vertical is orthogonal — and, per T3, increasingly *additive* rather than exclusive (Twitch Dual Format streams both at once).
5. **No published evidence exists that intent onboarding lifts activation in live-streaming software specifically.** I found none. **UNVERIFIED** — treat the whole mechanism as a hypothesis to instrument, not a settled win.
6. **Destination choice already carries most of the intent signal**, and it is a choice the user must make anyway: pick TikTok and vertical is implied; pick Twitch and gaming is likely; pick a Custom RTMP client ingest and you are a professional. There is a real design argument for making *destination* the first question and inferring the rest.

### 5.3 Recommendation

**Keep intent as the first question. Change its shape, and bind it to a hard promise.**

1. **Five content intents, not six:** **Talking · Gaming · Podcast (2+ people) · Screen or Slides · Event / Multi-camera.** Merge "Presentation" into "Screen or Slides" (it is the same scene set: capture + presenter + lower-third) and keep "Event" for the multi-camera/volunteer case, which is genuinely a different scene set and a different operator model.
2. **Move "Vertical" out of the list and onto the same screen as an orientation control** with three states: Wide (16:9) · Vertical (9:16) · **Both**. Default it from the chosen destinations. "Both" is the option that wins T3 and that no incumbent offers cleanly.
3. **Hard promise: one screen, then a working show.** The answer must produce a populated scene set, a canvas, sensible audio defaults and a destination slot — visible and on-air-looking — before any second question. If implementing an intent cannot meet that bar, cut the intent rather than shipping a stub.
4. **Always offer an escape:** a persistent "Skip — just get me live" that lands on the Talking preset with the default camera and mic. Experts and returning users must never be interviewed twice; remember the answer per show, and let it be changed later from show settings without rebuilding.
5. **Instrument it properly from day one,** since the category evidence is absent: measure time-to-first-successful-stream, first-stream success rate, and 7-day return-to-stream rate, split by intent chosen versus skipped. That data does not exist publicly for this category; generating it is itself a competitive asset.
6. **Do not ask role, company, industry, or audience size.** The cross-category examples that collect those (Airtable, Monday) are B2B SaaS optimising sales segmentation. LIVETAP is optimising for a person who wants to be live in two minutes.

---

## 6. MVP destination set validation

### 6.1 The demand evidence

**Where the audiences and channels actually are** (Streamlabs x Stream Hatchet, vendor-published; Q1 2026 and Q4 2025):

| Platform | Hours watched Q1 2026 | Hours streamed Q1 2026 | Unique channels Q1 2026 | Trend |
|---|---|---|---|---|
| Twitch | 4.55B | 215.8M | 8.74M | hours watched down 14.94% YoY in Q4 2025 |
| YouTube Gaming | 2.22B | 29.0M | 1.07M | roughly flat YoY; hours streamed up 11.30% YoY in Q4 2025 |
| Kick | 1.27B | 15.61M | 766,495 | **hours watched up 106% YoY, hours streamed up 97.5% YoY (Q4 2025)** |

Sources: [Q1 2026 report](https://streamlabs.com/content-hub/post/streamlabs-and-stream-hatchet-q1-2026-live-streaming-report), [Q4 2025 report](https://streamlabs.com/content-hub/post/streamlabs-and-stream-hatchet-q4-2025-live-streaming-report). Note the gap: these reports **do not measure TikTok LIVE, Instagram Live or Facebook** — so this table under-represents exactly the platforms where mobile/short-form creators live. Do not use it alone to dismiss TikTok.

**Which combinations creators actually ask for**, measured by demand for the how-to (YouTube titles and view counts, retrieved 2026-09-11):

| Combination named in the title | Example | Views |
|---|---|---|
| Twitch + YouTube + **TikTok** | "Multistream to Twitch, YouTube, Tiktok, all at the same time! EASY!" (Senpai) | 413,821 |
| Twitch + Kick + TikTok + YouTube | "How to Multi-Stream (to Twitch, Kick, Tiktok, YouTube, WHEREVER!)" (Senpai) | 243,351 |
| Twitch + YouTube + TikTok | "How to Multi-Stream on Streamlabs for FREE (Twitch, YouTube, TikTok)" (MidnightMan) | 139,016 |
| Twitch + YouTube + TikTok + Kick | "How to Multistream with OBS Studio (Twitch Youtube Tiktok Kick)" (Gael LEVEL) | 92,309 |
| Kick + Twitch + YouTube | "How to Multistream on Kick, Twitch and YouTube with OBS (59 sec guide)" (Derek Szyszka) | 88,071 |
| Twitch + YouTube + Kick | "Multistream to Twitch, YouTube & Kick — The Easy Method (2026)" (Cpaws Music) | 60,333 |

**Twitch + YouTube is the invariant core. TikTok is the most-requested third. Kick is the most-requested fourth and is growing fastest.** Facebook and Instagram are essentially absent from this gaming-adjacent corpus.

**What competitors chose to ship** — a useful revealed preference:

- **Meld Studio:** Twitch, YouTube, TikTok, Kick, X, Custom RTMP ([docs](https://meldstudio.co/docs/outputs/multistream/)). Auth split: *"Some platforms require OAuth authentication (Twitch, YouTube)"* and *"Others use stream keys (Kick, Custom RTMP)."*
- **Ecamm Live:** *"as many as 10 destinations, including YouTube, Facebook, LinkedIn, Amazon Live, Instagram Live, Twitch, X, and more"* ([FAQ](https://support.ecamm.com/en/articles/4125577-multistreaming-faq)) — a professional/business skew, not a gaming one.
- **StreamYard** (vendor guidance) recommends a *layered* stack: YouTube or Twitch as *"a long-form video home base"*, plus *"a business or professional layer: LinkedIn, Facebook Page, or both"*, plus X — and confirms the policy unlock: *"Twitch's updated Monetized Streamer Agreement"* now allows simulcasting, making *"the 'YouTube + Twitch together' strategy more compelling"* ([StreamYard](https://streamyard.com/blog/where-to-multistream-every-major-platform-compared)). It also notes a 4-hour cap on LinkedIn Live sessions.

### 6.2 The constraints that should actually decide this

1. **TikTok's ingest is gated, and TikTok is loud about tooling neutrality but silent about keys.** TikTok's FAQ says *"TikTok LIVE Studio and OBS have similar functions. However, LIVE Studio is developed by TikTok"* and — usefully — *"we will not alter your traffic due to your use of specific streaming tools such as LIVE Studio or OBS."* It says nothing about stream keys or RTMP, and access requirements *"may vary depending on your country/region."* The existence of a whole tutorial genre about streaming to TikTok *"without a stream key"* (49k, 42k, 37k views) is evidence of a gate, not of an API. **Conclusion: TikTok can be supported as a key/preset destination today; an official OAuth integration should not be promised.**
2. **Kick is cheap to add and strategically awkward for creators.** Technically it is stream-key + CBR + H.264, no H.265 ([Kick troubleshooting](https://help.kick.com/en/articles/14994318-obs-or-streamlabs-not-connecting-to-kick)) — trivial to support. But Kick's partner policy states: *"If you Multistream with the toggle enabled, your payout will be reduced by 50% for the duration of the Multistreaming session"*, and the feature is *"exclusively available to Streamers in the KICK Partner Program."* Crucially, the penalty applies to long-form platforms and **not** to vertical ones: *"You do not need to enable it if you are streaming to short-form or vertical livestreaming platforms, such as YouTube Shorts, TikTok Live, or Instagram Live"* ([Kick](https://help.kick.com/en/articles/11091744-multistreaming-on-the-kick-partner-program)). This is a product-relevant fact LIVETAP can surface where no competitor does.
3. **Instagram and Facebook are high-risk, low-demand for this launch.** DB-B documents Instagram requiring a public account with over 1,000 followers to go live (reported August 2025) and Facebook's history of Live API breakage — RTMPS-only from 2019, Live Encoder API discontinued 2021, third-party Group apps removed 2024. Ecamm reaches Instagram and Facebook via relays (Restream/Switchboard/OneStream) rather than directly — and pays a real cost for it: *"Dual Mode streaming (HD and Vertical simultaneously) is not supported when using Restream as a destination."*
4. **Custom RTMP is the highest-leverage destination in the product.** It covers Kick, X, LinkedIn-via-partner, relays (Restream/Castr/Switchboard), client-private ingests, and the cam-site constituency that asks for it by name (*"lets me put in my live cam sites and multiple RTMPs to any cam site I could ever need"*).

### 6.3 Recommendation

**Launch set: YouTube + Twitch + TikTok + Custom RTMP — with the honesty that TikTok is key-based.**

| Destination | Launch status | Auth | Reasoning |
|---|---|---|---|
| **YouTube** | Launch, OAuth | OAuth | Largest non-Twitch audience, the only major platform whose hours *streamed* grew YoY, durable VOD/Shorts value, and the one every creator guide calls non-negotiable. Pre-flight must surface the 50-subscriber mobile gate documented in DB-B. |
| **Twitch** | Launch, OAuth | OAuth | 8.74M unique channels, 215.8M hours streamed — by far the largest creator population. Simulcasting is now permitted, and Dual Format (2026-06-17) makes the vertical story land here first. |
| **TikTok** | Launch, **key/preset only** | Stream key via a named preset | Highest third-platform demand in the creator corpus, and the only way to reach the short-form/mobile segment. Ship it as a preset with TikTok's published constraints pre-filled, and state plainly in the UI that TikTok LIVE access is granted by TikTok, not by LIVETAP. Do not build a marketing promise on an API you do not control. |
| **Custom RTMP / RTMPS** | Launch, first-class | Key | Unlocks everything else, costs almost nothing, and is the professional/agency requirement. Must support saved named presets, per-preset codec/bitrate constraints, and RTMPS. |
| **Kick** | **Launch + 1** (fast follow, weeks not quarters) | Key (+ named preset) | Fastest-growing platform (hours watched up 106% YoY), 766k channels, trivially key-based. Deferred only because the partner payout penalty means the *feature* needs a warning UI, not because the plumbing is hard. Shipping the 50%-payout warning alongside it would be a genuine trust win. |
| **X** | Later | Key | Meld ships it; demand is thin in the creator corpus; Custom RTMP covers it in the meantime. |
| **Facebook / Instagram** | **Defer** | — | Instagram's 1,000-follower gate plus the absence of a general RTMP path, and Facebook's documented API churn, make these a support-cost sink for a small team. Custom RTMP plus a relay covers the users who need them. Revisit when there is pull from the podcaster/business segment rather than the gaming one. |
| **LinkedIn** | Defer | — | Requires a preferred-partner relationship and has a 4-hour session cap; reachable via Custom RTMP plus a relay. |

**Two design requirements that matter more than the list itself:** (a) every destination must carry its published constraints as data (Kick: CBR only, no H.265; each platform's max bitrate/resolution/fps) so pre-flight can enforce them, and (b) the catalogue must be updatable **without shipping a new build**, because DB-B's clearest lesson is that platform APIs and ingest rules change under you and the tools push the breakage onto the user.

---

## 7. Proposed friction benchmark

### 7.1 How the OBS baselines were derived (so they can be challenged)

Every OBS number below is counted by me from a cited document or from the OBS source, not estimated from memory. Where I had to reason rather than count, the cell says **ESTIMATE** and shows the reasoning. **No published, measured "time to first stream" figure exists for OBS or for any competitor in this category** — I looked for one and found nothing. That is itself an opportunity: LIVETAP can be the first to publish a measured number.

**Counting sources:**

- [OBS Quick Start Guide](https://obsproject.com/kb/quick-start-guide) (dated 2021-08-25): 5 numbered steps of which step 5 is *"There is no Step 5!"* → **4 real steps**. Concepts named before first stream, counted: Auto-Configuration Wizard, Scene, Source, Display Capture Source, Window Capture Source, macOS Screen Capture Source, Game Capture, Video Capture Source, Sources Dock, Audio Mixer, Settings→Audio, Settings→Output, Controls Dock, Start Streaming/Start Recording = **14**.
- [OBS `en-US.ini`](https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/data/locale/en-US.ini): **1,443** localised strings total; `Basic.Settings.Output` **135**; `Basic.Settings.General` 60; `Basic.Settings.Advanced` 51; `Basic.Settings.Stream` 41; `Basic.Settings.Audio` 33; `Basic.Settings.Video` 20; `Basic.Settings.Hotkeys` 6. Stream-start failure strings: **21**.
- [Kick: OBS/Streamlabs not connecting](https://help.kick.com/en/articles/14994318-obs-or-streamlabs-not-connecting-to-kick): **5 diagnostic causes** (stream key, encoder settings, software version, firewall/antivirus, network/ports) with **14 discrete user actions** counted across them, plus a sixth "use a different tool" fallback.
- [obs-multi-rtmp listing](https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/) plus [its homepage](https://sorayuki.github.io/obs-multi-rtmp/): download installer, run installer (must not change the install directory, per a review), restart OBS, open the dock, add a target, paste URL, paste key, choose shared vs standalone encoder, set bitrate if standalone, press that target's start button *in addition to* OBS's own Start Streaming = **10 actions for the second destination**, plus roughly 4 per further destination, plus a documented recovery procedure that involves hand-editing `global.ini`.
- [Meld multistream docs](https://meldstudio.co/docs/outputs/multistream/): Settings → General → Stream settings → "+ Add output" → configure → repeat = **4 steps per destination**, OAuth for Twitch/YouTube.
- [Streamlabs scene import](https://streamlabs.com/content-hub/post/import-scenes-streamlabs-plugin-for-OBS): **4 steps** to import scenes; output settings, hotkeys and audio settings then require a manual rebuild.

### 7.2 The benchmark

| # | Metric | Definition (must be measured identically for both) | OBS baseline | Source of baseline | LIVETAP target | Why this target |
|---|---|---|---|---|---|---|
| 1 | **Time to first successful stream (TTFS)** | Wall-clock from first app launch to 60 continuous seconds of confirmed-live output to one destination, by a user who has never used the tool, with platform accounts already existing | **20-45 min ESTIMATE** (4 documented steps, of which the wizard's bandwidth test *"may take a few minutes"*, plus leaving the app to fetch a stream key, plus the guide's own instruction to run a multi-minute test first) | Quick Start Guide; `PerformBandwidthTest` string | **<= 3 min (P50), <= 6 min (P90)** | Must beat "open the platform's own app and tap Go Live", which is the real competitor for newcomers |
| 2 | **Configuration decisions before GO LIVE** | Count of choices the user cannot avoid making (excluding typing credentials) | **>= 8** (usage priority; base resolution; FPS preference; service; connect-account vs stream-key; bandwidth test yes/no; hardware encoding preference; apply-or-adjust settings) | `Basic.AutoConfig.*` strings | **<= 2** (what are you doing; where are you going) | Every avoidable decision is a place to lose a first-time user |
| 3 | **Clicks/taps to GO LIVE (first run)** | Discrete pointer/keyboard actions, fresh install to live | **>= 25 ESTIMATE** (wizard ~10 incl. apply/restart; add and place 2 sources ~8; verify audio ~3; Settings→Output check ~3; start ~1) | Quick Start Guide steps 1-4 | **<= 8** | The "connect, pick, GO LIVE" promise has to be literally countable |
| 4 | **Clicks/taps to GO LIVE (returning user, unchanged show)** | Same, second session | **2-4** (launch, Start Streaming; more if a profile/collection switch is needed) | Controls Dock | **1** | This is the promise in the product name |
| 5 | **Terminology exposed on the default path** | Distinct technical nouns the user must read to reach first stream | **14** concepts in the quick start; **135** strings behind Settings→Output; **1,443** total | Quick Start Guide; `en-US.ini` counts | **<= 6 on the default path** ("scene", "camera", "microphone", "destination", "vertical/wide", "go live"); **0** encoder terms unless the Advanced drawer is opened | Zero exposure to bitrate, CBR/VBR, keyframe interval, rate control, encoder preset, psycho-visual tuning |
| 6 | **Failure-recovery steps (cannot connect)** | Actions from failure message to either a working stream or a definite, actionable diagnosis | **14 actions across 5 causes**, plus DB-A's documented path of uploading a log file to a second website | Kick troubleshooting doc; OBS log-analyzer workflow | **1 action** — pre-flight names the single cause and offers the fix button; <= 3 if the failure occurs mid-stream | The product should know what the platform's own help page knows |
| 7 | **Unactionable error strings** | Stream-start failures that name no cause and imply no user action | **>= 5 of 21** ("Missing config", "Invalid custom config", "Go live request returned an unspecified error", "A configured extra canvas is missing", "Received unknown status value") | `en-US.ini` | **0** — every failure carries a cause sentence and one action | Named causes are the difference between recoverable and switched-away |
| 8 | **Multistream setup steps (2nd destination)** | Actions to add a second destination to a working show | **10**, and it requires installing third-party software; each further destination adds ~4 | multi-rtmp listing plus homepage | **2** (pick destination, authorise or paste key) — and **0 extra GO LIVE presses**, ever | Directly answers *"It's not true multistream if you have to click every damned time"* |
| 9 | **Multistream reliability** | Successful simultaneous start across all selected destinations, first attempt | **UNVERIFIED / poor**; the one quantified user claim is *"maybe one out of every 50 times, it works"* (single review, one user's experience) | multi-rtmp reviews | **>= 99%** first-attempt success across the launch set, measured and published | This is the trigger; it must be the strongest guarantee |
| 10 | **Vertical + wide from one show** | Actions to produce both aspect ratios simultaneously | **Plugin install plus per-scene linking**; without a plugin, a second profile/collection or a second OBS instance | Aitum Vertical listing; DB-A | **1 toggle** ("Both"), with per-canvas framing available but not required | Twitch's own 2026 Dual Format direction |
| 11 | **Migration effort (bring an existing show)** | Time and manual rebuild required to reproduce an existing OBS show | **Scenes import in 4 steps; output settings, hotkeys and audio must be rebuilt by hand** | Streamlabs import doc; OBS KB | **Scenes + filters + transforms + hotkeys imported; a truth report lists everything that did not come across** | Attacks anti-triggers A1/A2 at the exact moment of decision |
| 12 | **Time to recover after a mid-show drop** | From connection loss to back on air, unattended | **UNVERIFIED**; user reports describe unrecovered drops and false "live" states | App Store review corpus | **< 10 s automatic reconnect, visible countdown, local recording never interrupted** | Turns T2 from a switching trigger into a non-event |

**Measurement protocol (worth writing down before anyone quotes these numbers).** Run 10 first-time users per platform (Windows/macOS/Linux), each with pre-existing platform accounts and no prior use of the tool under test; stopwatch from first launch; record every click; stop at 60 s of platform-confirmed live. Publish P50 and P90, the failure rate, and the raw click counts. Re-run against OBS with the same protocol, and publish that too — an honest head-to-head that shows OBS winning on flexibility and LIVETAP winning on time-to-live is far more persuasive to this audience than a marketing claim, and it directly addresses anti-trigger A7.

---

## 8. Sources

**Primary — OBS project (source, docs, community resources)**

- OBS Quick Start Guide (dated 2021-08-25) — https://obsproject.com/kb/quick-start-guide
- OBS Scene Collections KB — https://obsproject.com/kb/scene-collections
- OBS front-end localisation strings (`frontend/data/locale/en-US.ini`) — https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/data/locale/en-US.ini
- OBS importers directory listing — https://api.github.com/repos/obsproject/obs-studio/contents/frontend/importers
- OBS Studio importer (`studio.cpp`) — https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/importers/studio.cpp
- OBS Streamlabs importer (`sl.cpp`) — https://raw.githubusercontent.com/obsproject/obs-studio/master/frontend/importers/sl.cpp
- obs-multi-rtmp resource page (2,888,784 downloads; 4.07 stars; reviews) — https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/ and reviews page 2 — https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/reviews?page=2
- obs-multi-rtmp homepage (Japanese; `global.ini` dock-recovery procedure) — https://sorayuki.github.io/obs-multi-rtmp/
- obs-multi-rtmp README — https://raw.githubusercontent.com/sorayuki/obs-multi-rtmp/master/README.md
- Aitum Vertical resource page (984,167 downloads; the in-plugin-ad review) — https://obsproject.com/forum/resources/aitum-vertical.1715/
- Aitum Multistream reviews (395,461 downloads; the "not true multistream" review) — https://obsproject.com/forum/resources/aitum-multistream.1991/reviews
- Move (2,564,134) — https://obsproject.com/forum/resources/move.913/
- Background Removal (1,589,463) — https://obsproject.com/forum/resources/background-removal-virtual-green-screen-low-light-enhance.1260/
- Downstream Keyer (431,912) — https://obsproject.com/forum/resources/downstream-keyer.1254/
- obs-shaderfilter (309,728) — https://obsproject.com/forum/resources/obs-shaderfilter.1736/
- PTZ Controls (210,355) — https://obsproject.com/forum/resources/ptz-controls.1284/
- Touch Portal (210,337) — https://obsproject.com/forum/resources/touch-portal.755/
- OBS resource index (categories) — https://obsproject.com/forum/resources/

**Primary — platform policy and product documentation**

- Twitch: "Introducing Dual Format and 2k Streaming on Twitch", 2026-06-17 ("70% of new viewers are coming to Twitch on mobile") — https://blog.twitch.tv/en/2026/06/17/introducing-dual-format-and-2k-streaming-on-twitch/
- Kick: Multistreaming on the KICK Partner Program (50% payout reduction) — https://help.kick.com/en/articles/11091744-multistreaming-on-the-kick-partner-program
- Kick: OBS or Streamlabs not connecting to KICK (CBR-only, no H.265, 5 causes) — https://help.kick.com/en/articles/14994318-obs-or-streamlabs-not-connecting-to-kick
- TikTok LIVE Studio FAQ (tooling neutrality; eligibility gating) — https://www.tiktok.com/live/studio/help/article/FAQ/FAQ
- Meld Studio multistream docs (OAuth vs keys; 4 steps; mid-stream add) — https://meldstudio.co/docs/outputs/multistream/
- Meld Studio install docs (no guided first run documented) — https://meldstudio.co/docs/getstarted/install/
- Ecamm multistreaming FAQ (10 destinations; Restream dual-mode limitation) — https://support.ecamm.com/en/articles/4125577-multistreaming-faq
- Ecamm: moving scenes/overlays to another Mac (`.ecammlive` portable scene files) — https://support.ecamm.com/en/articles/3819218-moving-scenes-and-overlays-to-another-mac
- Ecamm getting-started collection (19 articles; no templates) — https://support.ecamm.com/en/collections/1870659-getting-started-with-ecamm
- Ecamm Live product page (marketing) — https://www.ecamm.com/mac/ecammlive/
- Streamlabs: Import scenes / Streamlabs plugin for OBS (hotkeys and audio do not transfer) — https://streamlabs.com/content-hub/post/import-scenes-streamlabs-plugin-for-OBS
- Streamlabs: "Find your fit — Streamlabs Desktop vs OBS plugin" (the hybrid counter-move) — https://streamlabs.com/content-hub/post/find-your-fit-streamlabs-desktop-vs-obs-plugin

**Primary — user voice (verbatim, dated)**

- Apple App Store customer reviews, PRISM Live Streaming App (id 1319056339), most recent as of 2026-09-11 — https://itunes.apple.com/us/rss/customerreviews/id=1319056339/sortby=mostrecent/json
- Apple App Store customer reviews, Streamlabs Live Streaming App (id 1294578643), most recent as of 2026-09-11 — https://itunes.apple.com/us/rss/customerreviews/id=1294578643/sortby=mostrecent/json
- App metadata (PRISM 4.62 stars / 6,188 ratings; Streamlabs 3.87 stars / 1,174 ratings) — https://itunes.apple.com/search?term=prism+live+studio&entity=software
- Hacker News, "OBS Studio: Open-source software for video recording and live streaming" (1,518 points, 362 comments, 2020-04-01) — https://news.ycombinator.com/item?id=22748247 ; cited comments: kawfey https://news.ycombinator.com/item?id=22749402 , eggbrain https://news.ycombinator.com/item?id=22750441 , geerlingguy https://news.ycombinator.com/item?id=22752012
- Hacker News, "How I Teach Classes Remotely" comment ("OBS is super complicated for non tech-savvy users") — https://news.ycombinator.com/item?id=22613322
- Hacker News, comment comparing OBS with Office screen recording — https://news.ycombinator.com/item?id=39969689

**Secondary — market data, vendor comparisons, onboarding precedent**

- Streamlabs x Stream Hatchet Q1 2026 live streaming report — https://streamlabs.com/content-hub/post/streamlabs-and-stream-hatchet-q1-2026-live-streaming-report
- Streamlabs x Stream Hatchet Q4 2025 live streaming report — https://streamlabs.com/content-hub/post/streamlabs-and-stream-hatchet-q4-2025-live-streaming-report
- StreamYard: "Where to multistream — every major platform compared" (vendor) — https://streamyard.com/blog/where-to-multistream-every-major-platform-compared
- StreamYard vs OBS (vendor) — https://streamyard.com/blog/professional-video-recording-software-streamyard-vs-obs
- Descript: OBS vs Streamlabs — https://www.descript.com/blog/article/obs-vs-streamlabs
- Userpilot: welcome surveys (Canva / Loom / Airtable / Monday wording; Kontentino +10% activation) — https://userpilot.com/blog/welcome-survey/
- Userpilot: good onboarding surveys (Asana) — https://userpilot.com/blog/good-onboarding-surveys/

**Demand-signal corpus (YouTube search index, retrieved 2026-09-11; the titles, channels and view counts are the evidence, not the claims made inside the videos)**

- "I Switched From OBS to Meld Studio.. you probably should, too" — Senpai, 202,238 views — https://youtu.be/CthvqSeqsdg
- "Is Meld Actually Better Than OBS?" — nutty, 65,307 views — https://youtu.be/q9IUZKg_TXA
- "Meld isn't competing with OBS…" — nutty, 27,857 views — https://youtu.be/uH2Jg_DIaoA
- "MELD STUDIO, is it worth switching from OBS ? A in-depth look as to why not" — SANGWHiCH, 476 views — https://youtu.be/2Eko_aL9Hy0
- "I'm Finally Switching from OBS to Meld Studio… Here's Why" — LiveEnvy, 2,269 views — https://youtu.be/RVS_sBqWBPM
- "Which Streaming Software is Best? ECAMM Live vs. OBS" — Tom Buck, 66,329 views — https://youtu.be/Dxa3BJCyb6Q
- "I Ditched OBS for Ecamm Live and Cleared Up My Blur Problem" — BackChannel, 672 views — https://youtu.be/T8TjC0OuinQ
- "Ecamm Live vs OBS Studio: Why I switched from OBS Studio to Ecamm Live" — Capterra, 2,345 views — https://youtu.be/7eHPxuaEWQE
- "Twitch Studio Is Gone!! What now?" — Michael Feyrer Jr., 23,211 views — https://youtu.be/P6JMZc_rIow
- "Multistream to Twitch, YouTube, Tiktok, all at the same time! EASY!" — Senpai, 413,821 views — https://youtu.be/4VpCvbqJPcA
- "How to Multi-Stream (to Twitch, Kick, Tiktok, YouTube, WHEREVER!)" — Senpai, 243,351 views — https://youtu.be/qfX-5asUO-U
- "How to Multi-Stream on Streamlabs for FREE (Twitch, YouTube, TikTok)" — MidnightMan, 139,016 views — https://youtu.be/LLyaMGpKReo
- "How to Multistream with OBS Studio (Twitch Youtube Tiktok Kick)" — Gael LEVEL, 92,309 views — https://youtu.be/86xwqfIq25I
- "How to Multistream on Kick, Twitch and YouTube with OBS (59 sec guide)" — Derek Szyszka, 88,071 views — https://youtu.be/BbLAZSYTSfQ
- "Multistream to Twitch, YouTube & Kick — The Easy Method (2026)" — Cpaws Music, 60,333 views — https://youtu.be/V3jhUXj2M4k
- "The Big Problem With OBS VERTICAL Streaming (And How To Fix It)" — nutty, 117,621 views — https://youtu.be/4oiaQS107Rg
- "How To Vertical Stream & Record In OBS Studio! (Tiktok & Twitch Aitum Plugin)" — oMace, 125,701 views — https://youtu.be/L2-0F-WyYaQ
- "How To Stream on TikTok Using OBS and Stream Key (EASY)" — MidnightMan, 576,037 views — https://youtu.be/3HQ-mZ36G2M
- "How To Livestream On TikTok PC (Full Guide)" — Your Fix Guide, 235,988 views — https://youtu.be/aLd1E73iCtw
- "Stream on TikTok WITHOUT a Stream Key or 1000 Followers" — Andi Stone, 49,263 views — https://youtu.be/1vysfSH-Wfg
- "How to Use OBS Studio - Complete OBS Tutorial for Beginners (2025!)" — Primal Video, 1,558,364 views — https://youtu.be/9z9GiEM4uvA
- "Best OBS Studio Settings for RECORDING in 2026 (For Beginners)" — Cpaws Music, 997,308 views — https://youtu.be/RezNh9TllJc
- "Best OBS Studio Settings for STREAMING in 2026 (For Beginners)" — Cpaws Music, 786,043 views — https://youtu.be/gLD38bLE1O0
- "OBS for Churches: How to Set Up a Professional Livestream" — REACHRIGHT, 131,250 views — https://youtu.be/jYexniWG5SA
- "OBS Studio: Ultimate Stream Deck Guide" — Awall Digital, 133,930 views — https://youtu.be/KbEUNg6GxFo
- "Setup Elgato Stream Deck With OBS Studio Plugins! | Full Beginners Guide" — Starix Gaming, 119,389 views — https://youtu.be/MCEngqjShX0
- "The Best Way to Switch Scenes in OBS Studio - Elgato Stream Deck" — Trui, 49,391 views — https://youtu.be/Y72q1MnEAlY
- "How to Film Pro Multi-Cam Podcasts and Live Streams" — Riverside, 29,746 views — https://youtu.be/rplQnysEA2Q
- "Best Multicam Live Streaming Setup for Podcasting" — Tom Buck, 13,479 views — https://youtu.be/RktEsHlWU_A

**Internal**

- `docs/research/COMPETITOR_FAILURE_DATABASE_A.md` — executive summary read; cited here for the Streamlabs $4.4M settlement, the OBS log-analyzer workflow, the OBS idle-resource comparison, macOS desktop audio, audio monitoring as the silent killer, and the multistream pricing gates.
- `docs/research/COMPETITOR_FAILURE_DATABASE_B.md` — executive summary read; cited here for Instagram's 1,000-follower gate, Facebook Live API churn, PRISM's auth-unification issue, mobile thermal/backgrounding limits, and vMix/Meld OS coverage.

**Explicitly unverified / not obtained**

- Any measured time-to-first-stream figure for OBS or any competitor: **none exists publicly that I could find** — all TTFS baselines in Section 7 are labelled ESTIMATE with their reasoning shown.
- Reddit threads: **not retrievable** by this agent (blocked). Thread titles that surfaced in search-engine result lists were deliberately **not** cited as evidence, because I could not read their contents.
- Twitch's simulcasting policy text: the official help article and the relevant policy blog posts could not be retrieved (error page / partial content). The claim that Twitch now permits simulcasting rests on StreamYard's vendor summary of the Monetized Streamer Agreement plus the Dual Format announcement — **treat the exact policy wording as UNVERIFIED**.
- Ecamm scene-template gallery: no such documented feature was found; any claim that Ecamm ships intent-based templates is **unsupported** by its own help centre.
- Capterra / G2 / Trustpilot review text for Ecamm, Meld and vMix beyond what DB-A and DB-B already captured: not re-retrieved this session, because search access was unavailable.
- YouTube video transcripts and descriptions: not retrievable (the watch pages returned a bot-interstitial). Only titles, channels, view counts and publish ages were captured, and they are treated as demand signals rather than as claims.
