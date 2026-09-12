/**
 * @livetap/adapters — platform profiles and destination adapters.
 *
 * Three kinds of adapter live here:
 *  - `mock/`   realistic, offline stand-ins for all nine platforms (mock mode).
 *  - `custom/` the real adapter for a user-supplied RTMP/RTMPS/SRT/WHIP endpoint.
 *  - `real/`   the platform adapters for YouTube, Twitch, Kick and Facebook.
 *
 * Everything is capability-driven: `profiles/` is the single source of truth for what LIVETAP
 * may claim, and every adapter derives `supports()` from its profile.
 * See docs/architecture/DESTINATION_ADAPTERS.md.
 */
export * from './profiles/index.js';
export * from './mock/index.js';
export * from './custom/index.js';
export * from './real/index.js';
export * from './oauth/index.js';
export * from './testing/index.js';
