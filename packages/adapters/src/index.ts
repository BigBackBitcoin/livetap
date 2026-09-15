/**
 * @livetap/adapters — platform profiles and destination adapters.
 *
 * Three kinds of adapter live here:
 *  - `mock/`   realistic, offline stand-ins for all nine platforms (mock mode).
 *  - `custom/` the real adapter for a user-supplied RTMP/RTMPS/SRT/WHIP endpoint.
 *  - `real/`   the platform adapters for YouTube, Twitch, Kick and Facebook.
 *
 * `paste/` is not a fourth kind of adapter. It is the small set of facts the paste path needs —
 * where each platform prints its two values, which ingest addresses are documented enough to
 * pre-fill, and what a destination with no account genuinely cannot do — so that `custom/`'s
 * adapter can serve any platform honestly while wearing that platform's own profile.
 *
 * Everything is capability-driven: `profiles/` is the single source of truth for what LIVETAP
 * may claim, and every adapter derives `supports()` from its profile.
 * See docs/architecture/DESTINATION_ADAPTERS.md.
 */
export * from './profiles/index.js';
export * from './mock/index.js';
export * from './custom/index.js';
export * from './paste/index.js';
export * from './real/index.js';
export * from './oauth/index.js';
export * from './testing/index.js';
