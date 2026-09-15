/**
 * The one test that fails if a credential can reach a log line.
 *
 * LIVETAP now handles real access tokens, real refresh tokens, real client
 * secrets and real stream keys. Any of those in `main.log`, in a crash report,
 * in a diagnostics export or on a terminal is a leak that survives the process
 * that made it, and the 2026-09 security review found two of them in one file
 * (SEC-D3: the ffmpeg argv logged verbatim, and ffmpeg's own stderr logged
 * verbatim, both of which carry the full publish URL).
 *
 * Unit tests for the redaction helpers already exist and live with those
 * helpers. This file is the gate above them, and it asks three different
 * questions, because each one catches a failure the others cannot:
 *
 *   1  THE CORPUS. Given a realistic secret in the realistic shape it travels
 *      in, do both redactors actually mask it? A regex that covers `token=`
 *      but not `?access_token=` passes its own unit test and leaks in
 *      production.
 *
 *   2  THE DRIFT. `packages/core`'s `redactSecrets` and
 *      `packages/adapters`'s `redact` are two lists of field names in two
 *      packages, and the second one's own comment says they must not disagree.
 *      A reader who sees one of them let a value through cannot tell whether
 *      the other would have masked it, so this test makes them agree by
 *      construction.
 *
 *   3  THE CALL SITES. Scan every shipped source file for a logging call whose
 *      arguments mention something credential-bearing without a redactor
 *      wrapped around it. This is the check that fires on the NEXT SEC-D3,
 *      when someone adds `log.info(argv.join(' '))` to a file no test covers.
 *      Its own detector is proven on a set of deliberately bad snippets, so a
 *      clean scan means the scan works, not that the pattern stopped matching.
 *
 * This runs under `npm test`, which is what makes it a gate rather than a
 * document.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { redactArgv, redactSecrets } from '@livetap/core';
import { redact } from '@livetap/adapters';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Credential values shaped like the real thing.
 *
 * None of these is a live credential. Each one is the SHAPE a real one takes,
 * because the redactors match on shape: a Google access token starts `ya29.`,
 * a YouTube stream key is four dash-separated groups, a Twitch key starts
 * `live_`, and a Kick client secret is a long opaque string.
 */
const SECRETS = {
  googleAccessToken: 'ya29.a0AfB_byDEXAMPLEnotarealtokenJUSTASHAPE1234567890abcdefgh',
  refreshToken: '1//04EXAMPLErefreshTOKENshapeONLY-nevervalid_abcdefghijklmn',
  clientSecret: 'GOCSPX-EXAMPLEclientSECRETshapeOnly1234',
  youtubeStreamKey: 'abcd-efgh-ijkl-mnop-qrst',
  twitchStreamKey: 'live_123456789_EXAMPLEstreamKEYshapeOnlyNeverValid',
  srtPassphrase: 'EXAMPLEpassphraseSHAPEonly',
};

/**
 * Every realistic way one of those values travels through this product on its
 * way to somewhere it could be logged. Each entry is a template plus the
 * secret it carries.
 */
const CARRIERS = [
  {
    what: 'the composed RTMP publish URL, which is the last element of the ffmpeg sender argv',
    text: `rtmp://a.rtmp.youtube.com/live2/${SECRETS.youtubeStreamKey}`,
    secret: SECRETS.youtubeStreamKey,
  },
  {
    what: "ffmpeg's own stderr, which echoes the publish URL on most connection failures",
    text: `[flv @ 000001c] Cannot open connection tcp://live.twitch.tv:1935 for rtmps://live.twitch.tv/app/${SECRETS.twitchStreamKey}`,
    secret: SECRETS.twitchStreamKey,
  },
  {
    what: 'an Authorization header on its way into an HTTP error message',
    text: `POST /liveBroadcasts failed, Authorization: Bearer ${SECRETS.googleAccessToken}`,
    secret: SECRETS.googleAccessToken,
  },
  {
    what: 'a token endpoint request body',
    text: `grant_type=refresh_token&refresh_token=${SECRETS.refreshToken}&client_secret=${SECRETS.clientSecret}`,
    secret: SECRETS.refreshToken,
  },
  {
    what: 'the same body, checked for the client secret rather than the refresh token',
    text: `grant_type=refresh_token&refresh_token=${SECRETS.refreshToken}&client_secret=${SECRETS.clientSecret}`,
    secret: SECRETS.clientSecret,
  },
  {
    what: 'an authorization code exchange carrying the PKCE verifier',
    text: `code=4/0AEXAMPLEauthCODE&code_verifier=${SECRETS.clientSecret}&redirect_uri=http://127.0.0.1:53871/callback`,
    secret: SECRETS.clientSecret,
  },
  {
    what: 'an SRT target, where the credential is a query parameter rather than a path segment',
    text: `srt://ingest.example.com:9000?streamid=live&passphrase=${SECRETS.srtPassphrase}`,
    secret: SECRETS.srtPassphrase,
  },
  {
    what: 'a WHIP endpoint with a bearer token in the query string',
    text: `https://relay.livetap.example/whip/session?token=${SECRETS.googleAccessToken}`,
    secret: SECRETS.googleAccessToken,
  },
  {
    what: 'userinfo in a URL, which is how the relay hook authenticates to MediaMTX',
    text: `rtsp://relayhook:${SECRETS.clientSecret}@127.0.0.1:8554/live`,
    secret: SECRETS.clientSecret,
  },
  {
    what: "the ffmpeg whip muxer's -authorization flag",
    text: `-f whip -authorization ${SECRETS.googleAccessToken} https://relay.livetap.example/whip`,
    secret: SECRETS.googleAccessToken,
    // Argv-only. This flag exists in an ffmpeg command line and nowhere else,
    // so it is the engine redactor's job; the HTTP layer never sees one. Its
    // redactor does not mask this shape today, which is why the responsibility
    // is written down here rather than left to be discovered.
    redactors: ['core'],
  },
];

const coreCarriers = CARRIERS.filter((c) => !c.redactors || c.redactors.includes('core'));
const httpCarriers = CARRIERS.filter((c) => !c.redactors || c.redactors.includes('http'));

describe('no credential can reach a log line', () => {
  describe("packages/core redactSecrets, the desktop engine's last line of defence", () => {
    for (const carrier of coreCarriers) {
      it(`masks ${carrier.what}`, () => {
        const out = redactSecrets(carrier.text);
        expect(out).not.toContain(carrier.secret);
        // A redactor that answered by deleting the whole string would pass the
        // line above and destroy every diagnostic in the product.
        expect(out.length).toBeGreaterThan(10);
        expect(out).toContain('••••');
      });
    }

    it('masks the publish URL in a whole sender argv, which is how it reaches main.log', () => {
      const argv = [
        '-hide_banner',
        '-i',
        'pipe:0',
        '-c',
        'copy',
        '-f',
        'flv',
        `rtmp://a.rtmp.youtube.com/live2/${SECRETS.youtubeStreamKey}`,
      ];
      const joined = redactArgv(argv).join(' ');
      expect(joined).not.toContain(SECRETS.youtubeStreamKey);
      // The rest of the argv is what makes a broadcast failure diagnosable.
      expect(joined).toContain('-c copy -f flv');
    });
  });

  describe("packages/adapters redact, the HTTP layer's last line of defence", () => {
    for (const carrier of httpCarriers) {
      it(`masks ${carrier.what}`, () => {
        const out = redact(carrier.text);
        expect(out).not.toContain(carrier.secret);
        expect(out).toContain('••••');
      });
    }
  });

  describe('the two redactors do not disagree about what is a secret', () => {
    // If one of them masks a field and the other does not, a reader who sees a
    // value survive one of them cannot tell whether the other would have
    // caught it. Both must mask every field either of them knows about.
    const FIELDS = [
      'access_token',
      'refresh_token',
      'id_token',
      'client_secret',
      'code_verifier',
      'stream_key',
      'streamkey',
      'streamid',
      'passphrase',
      'password',
      'signature',
      'authorization',
      'secret',
      'token',
      'code',
      'key',
      'auth',
      'pwd',
      'sig',
    ];
    for (const field of FIELDS) {
      it(`both mask ${field}=`, () => {
        const value = 'EXAMPLEvalueThatMustNeverSurvive1234567890';
        const text = `GET /x?${field}=${value}&harmless=1`;
        expect(redactSecrets(text)).not.toContain(value);
        expect(redact(text)).not.toContain(value);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The call-site scan
// ---------------------------------------------------------------------------

/**
 * Directories that hold build output, vendored code or platform scaffolding
 * rather than source this repo writes. Scanning a minified bundle produces
 * only noise: the identifiers are single letters and the string literals are
 * whatever the bundler emitted.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'www',
  'android',
  'ios',
  'recordings',
  '__screenshots__',
  'test-results',
  'playwright-report',
  '.vercel',
  '.next',
  '.git',
  'out',
  'release',
]);

/** Logging calls, in every spelling this repo uses. */
const LOG_CALL = /(?:^|[^\w.])(?:console|log|logger|diag|electronLog)\s*\.\s*(?:log|info|warn|error|debug|verbose|trace)\s*\(/g;

/**
 * Identifiers that carry, or can carry, a credential.
 *
 * `argv` is here because an ffmpeg argv's last element is a publish URL, and
 * `ingest` because an IngestTarget holds a stream key. Both were the actual
 * SEC-D3 leaks: neither is called `secret`, and a list of only obviously named
 * fields would have missed both.
 */
const SECRET_BEARING =
  /\b(?:argv|streamKey|stream_key|accessToken|access_token|refreshToken|refresh_token|clientSecret|client_secret|codeVerifier|code_verifier|passphrase|credential|credentials|ingest|publishUrl|apiKey)\b/;

/** A redactor anywhere inside the call is what makes the call safe. */
const REDACTED = /redactSecrets|redactArgv|redactIngest|redactUrl|\bredact\(/;

function sourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, found);
      continue;
    }
    if (!/\.(ts|tsx|mjs|cjs)$/.test(entry.name)) continue;
    if (/\.test\./.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

/** The full text of a call, from its opening paren to the matching close. */
function callText(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex, openIndex + 400);
}

/** Every logging call in `source` that names something secret-bearing unredacted. */
function unredactedLogCalls(source) {
  const hits = [];
  LOG_CALL.lastIndex = 0;
  let match;
  while ((match = LOG_CALL.exec(source))) {
    const open = source.indexOf('(', match.index + match[0].length - 1);
    if (open === -1) continue;
    const call = callText(source, open);
    if (!SECRET_BEARING.test(call) || REDACTED.test(call)) continue;
    hits.push({
      line: source.slice(0, match.index).split('\n').length,
      call: call.replace(/\s+/g, ' ').slice(0, 160),
    });
  }
  return hits;
}

describe('no shipped source file logs a credential-bearing value unredacted', () => {
  // Proving the detector works before trusting its silence. Without this, a
  // regex that quietly stopped matching would read as a clean repo.
  it('catches the leaks the 2026-09 security review actually found', () => {
    const sec_d3_argv = "log.info('[ffmpeg] spawn', argv.join(' '));";
    const sec_d3_stderr = 'log.error(`[ffmpeg] ${chunk}`, { argv });';
    const token = 'console.debug("token refreshed", { accessToken, refreshToken });';
    const ingest = 'logger.warn(`publishing to ${ingest.url}`);';
    for (const snippet of [sec_d3_argv, sec_d3_stderr, token, ingest]) {
      expect(unredactedLogCalls(snippet), snippet).toHaveLength(1);
    }
  });

  it('does not flag the same calls once a redactor is wrapped around them', () => {
    const safe = [
      "log.info('[ffmpeg] spawn', redactArgv(argv).join(' '));",
      'log.error(`[ffmpeg] ${redactSecrets(chunk)}`, { argv: redactArgv(argv) });',
      'logger.warn(`publishing to ${redactUrl(ingest.url)}`);',
      "console.info('destination ready', destination.label);",
    ];
    for (const snippet of safe) {
      expect(unredactedLogCalls(snippet), snippet).toHaveLength(0);
    }
  });

  it('finds no such call anywhere in apps/, packages/ or infra/', () => {
    const files = ['apps', 'packages', 'infra'].flatMap((root) => sourceFiles(join(REPO_ROOT, root)));
    // A scan that found nothing because it walked nothing is not a pass.
    expect(files.length).toBeGreaterThan(100);

    const leaks = [];
    for (const file of files) {
      for (const hit of unredactedLogCalls(readFileSync(file, 'utf8'))) {
        leaks.push(`${relative(REPO_ROOT, file).split(sep).join('/')}:${hit.line}  ${hit.call}`);
      }
    }
    expect(leaks, `a credential could reach a log line here:\n  ${leaks.join('\n  ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEAM F (SECURITY), 2026-09-15: who owns which shape
// ---------------------------------------------------------------------------

/**
 * HANDOFF item 4 asked for a decision, not a note. Here it is, with the test that
 * enforces it — and with a SECOND asymmetry, in the opposite direction, that the
 * original note did not record and that matters more.
 *
 * THE DECISION
 * ------------
 * The two redactors guard different doors, so they do not need identical rule sets.
 * They need identical rule sets FOR THE SHAPES THAT CAN REACH THEM.
 *
 *   packages/core `redactSecrets` guards the LOG FILE. Everything the desktop engine
 *   writes goes through it: the ffmpeg argv, ffmpeg's stderr, engine diagnostics. So it
 *   owns every shape that can appear in an FFMPEG COMMAND LINE OR IN FFMPEG'S OUTPUT.
 *   That is a superset of what travels over HTTP, because ffmpeg speaks rtmp, rtmps,
 *   rtsp, srt, whip-over-https and file: as well.
 *
 *   packages/adapters `redact` guards an HTTP ERROR MESSAGE. It sees platform API URLs,
 *   response bodies and status text. It owns every shape that can appear THERE.
 *
 * Applying that rule to the two asymmetries:
 *
 *   1. `-authorization <token>` (the ffmpeg WHIP muxer's flag). Argv only. **core owns
 *      it, adapters does not need it.** The integrator changes NOTHING. This confirms
 *      what HANDOFF item 4 guessed, and now it is a decision with a test under it.
 *
 *   2. URL userinfo (`scheme://user:password@host`). `redact` masks it for rtsp, srt,
 *      http, https, ws and wss. `redactSecrets` masks it for **rtsp only**. But a WHIP
 *      target is an https URL that ffmpeg receives as an argv element, and an SRT target
 *      can carry userinfo too — both of which are exactly the log file's problem. So
 *      **core owns it and core is missing it.** The integrator must change
 *      `packages/core/src/validation/ingest.ts:81`.
 *
 * SEC-F17 below is the failing test for (2). It is deliberately left red rather than
 * softened, because a green suite over a real gap is worse than a red one.
 */

const OWNERSHIP_VALUE = 'EXAMPLEownershipVALUEthatMustNeverSurvive12345';

/** Shapes that can only appear in an ffmpeg command line or in ffmpeg's own stderr. */
const ARGV_ONLY_SHAPES = [
  {
    what: 'the WHIP muxer -authorization flag',
    text: `-f whip -authorization ${OWNERSHIP_VALUE} https://relay.livetap.example/whip`,
  },
  {
    what: 'an RTMP publish URL whose last path segment is the stream key',
    text: `rtmp://a.rtmp.youtube.com/live2/${OWNERSHIP_VALUE}`,
  },
];

/** Shapes that can appear in EITHER an ffmpeg argv or an HTTP error. Both must mask these. */
const SHARED_SHAPES = [
  {
    what: 'rtsp userinfo, which is how the relay hook authenticates to MediaMTX',
    text: `rtsp://relayhook:${OWNERSHIP_VALUE}@127.0.0.1:8554/live`,
  },
  {
    what: 'an SRT passphrase in a query parameter',
    text: `srt://ingest.example.com:9000?streamid=live&passphrase=${OWNERSHIP_VALUE}`,
  },
  {
    what: 'a bearer token',
    text: `Authorization: Bearer ${OWNERSHIP_VALUE}`,
  },
];

/**
 * Userinfo in the schemes ffmpeg speaks that are NOT rtsp. These reach the log file
 * through the sender argv, so core owns them.
 */
const USERINFO_SHAPES = [
  {
    what: 'https userinfo, which is how a WHIP target carries a credential',
    text: `https://relayhook:${OWNERSHIP_VALUE}@relay.livetap.example/whip/session`,
  },
  {
    what: 'srt userinfo',
    text: `srt://relayhook:${OWNERSHIP_VALUE}@127.0.0.1:9000`,
  },
  {
    what: 'wss userinfo, which is how a chat socket can carry one',
    text: `wss://relayhook:${OWNERSHIP_VALUE}@chat.example.com/ws`,
  },
];

describe('SEC-F17 redactor ownership: which module owns which shape, decided', () => {
  describe('argv-only shapes are the ENGINE redactor\'s, and only its', () => {
    for (const shape of ARGV_ONLY_SHAPES) {
      it(`packages/core masks ${shape.what}`, () => {
        expect(redactSecrets(shape.text)).not.toContain(OWNERSHIP_VALUE);
      });
    }

    it('packages/adapters is NOT required to mask -authorization, and does not', () => {
      // Pinning the decision, not the omission. If someone adds the rule to `redact` this
      // test fails and they must come here and change the decision deliberately, which is
      // the point of writing it down.
      const argv = ARGV_ONLY_SHAPES[0].text;
      expect(redact(argv)).toContain(OWNERSHIP_VALUE);
    });

    it('an ffmpeg argv never reaches the HTTP redactor, which is why that is safe', () => {
      // `redact` is called from exactly two places in packages/adapters/src/real/http.ts:
      // the HttpError constructor (a request URL) and errorMessage (a response body). The
      // scan below proves no OTHER call site exists that could hand it an argv.
      const http = readFileSync(join(REPO_ROOT, 'packages/adapters/src/real/http.ts'), 'utf8');
      const callSites = http.match(/(?<![\w.])redact\(/g) ?? [];
      // One definition plus two call sites.
      expect(callSites.length).toBeLessThanOrEqual(3);
      expect(http).not.toMatch(/redact\(\s*argv/);
    });
  });

  describe('shapes that can reach either door must be masked by both', () => {
    for (const shape of SHARED_SHAPES) {
      it(`both mask ${shape.what}`, () => {
        expect(redactSecrets(shape.text), 'packages/core').not.toContain(OWNERSHIP_VALUE);
        expect(redact(shape.text), 'packages/adapters').not.toContain(OWNERSHIP_VALUE);
      });
    }
  });

  describe('URL userinfo: the asymmetry HANDOFF item 4 did not record', () => {
    for (const shape of USERINFO_SHAPES) {
      it(`packages/adapters already masks ${shape.what}`, () => {
        expect(redact(shape.text)).not.toContain(OWNERSHIP_VALUE);
      });
    }

    /**
     * OPEN, MEDIUM. FAILING ON PURPOSE.
     *
     * `packages/core/src/validation/ingest.ts:81` masks userinfo for `rtsp`/`rtsps` only:
     *     .replace(/(rtsps?:\/\/)[^\s@|'"]*@/gi, '$1' + MASK + '@')
     * The HTTP redactor's equivalent (packages/adapters/src/real/http.ts:79) covers
     * `rtsp`, `srt`, `http`, `https`, `ws` and `wss`.
     *
     * core is the one guarding main.log, and the sender argv for a WHIP output is an
     * https URL. So the module with the WIDER exposure has the NARROWER rule.
     *
     * THE FIX, for the integrator: widen that one regex in packages/core to the same
     * scheme set adapters already uses. Nothing else changes; the adapters redactor is
     * correct as it stands.
     */
    for (const shape of USERINFO_SHAPES) {
      it(`packages/core MUST mask ${shape.what} — it does not today`, () => {
        expect(redactSecrets(shape.text)).not.toContain(OWNERSHIP_VALUE);
      });
    }
  });
});
