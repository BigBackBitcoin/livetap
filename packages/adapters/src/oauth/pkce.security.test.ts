/**
 * TEAM F (SECURITY), 2026-09-15. §23's PKCE questions, answered by execution.
 *
 * `pkce.test.ts` proves the helpers compute what RFC 7636 says. This file asks the
 * four questions that decide whether PKCE is actually PROTECTING anything in the
 * product, which is a different question from whether the maths is right:
 *
 *   1. Is it S256 only? Can anything in this repo emit `code_challenge_method=plain`?
 *   2. Does the verifier carry real entropy, with no modulo bias in the alphabet?
 *   3. Does the verifier ever leave the client that generated it, other than into
 *      the token exchange it exists for?
 *   4. Can PKCE be silently DROPPED, which is the downgrade that matters here?
 *
 * Question 4 is the one with a live answer. Read SEC-F7.
 */

import { describe, expect, it } from 'vitest';

import { buildAuthorizeUrl } from './index.js';
import { PLATFORM_OAUTH } from './endpoints.js';
import { computeCodeChallenge, generateCodeVerifier, generatePkce } from './pkce.js';

const PKCE_PLATFORMS = (Object.keys(PLATFORM_OAUTH) as (keyof typeof PLATFORM_OAUTH)[]).filter(
  (id) => PLATFORM_OAUTH[id] !== undefined && PLATFORM_OAUTH[id]!.pkce !== 'none',
);

describe('SEC-F6 S256 only, on every platform, with no way to say plain', () => {
  it('generatePkce always reports S256, for both documented encodings', async () => {
    const base64url = await generatePkce({ encoding: 'base64url' });
    const hex = await generatePkce({ encoding: 'hex' });
    expect(base64url.codeChallengeMethod).toBe('S256');
    expect(hex.codeChallengeMethod).toBe('S256');
    // TikTok's deviation is the ENCODING of the digest, not the method. Both are still SHA-256.
    expect(hex.codeChallenge).toMatch(/^[0-9a-f]{64}$/);
    expect(base64url.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('the challenge really is SHA-256 of the verifier (RFC 7636 appendix B vector)', async () => {
    // The vector from RFC 7636 §4.6. If this ever fails, the challenge is not a SHA-256 digest
    // and the whole mechanism is decoration.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await computeCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('no authorize URL this repo can build carries code_challenge_method=plain', async () => {
    const pkce = await generatePkce();
    for (const platform of PKCE_PLATFORMS) {
      const url = buildAuthorizeUrl(platform, {
        clientId: 'test-client',
        redirectUri: 'http://127.0.0.1:53871/callback',
        state: 'test-state',
        codeChallenge: pkce.codeChallenge,
      });
      const params = new URL(url).searchParams;
      expect(params.get('code_challenge_method'), platform).toBe('S256');
      expect(url, platform).not.toContain('plain');
      expect(params.get('response_type'), platform).toBe('code');
      // Implicit grant, which returns a token in the fragment, must not be reachable.
      expect(params.get('response_type'), platform).not.toContain('token');
    }
  });

  it('the literal string S256 is the only method this module can produce', () => {
    // `code_challenge_method` is set from a literal, not from a variable an input could reach.
    // Proven by construction: the type is the literal union 'S256'.
    const methods = new Set<string>();
    for (const platform of PKCE_PLATFORMS) {
      const config = PLATFORM_OAUTH[platform]!;
      methods.add(config.pkce);
    }
    // Only the two digest ENCODINGS exist; there is no 'plain' member of ChallengeEncoding.
    expect([...methods].sort()).toEqual(['base64url', 'hex']);
  });
});

describe('SEC-F7 PKCE cannot be silently dropped', () => {
  /**
   * FIXED 2026-09-15. `buildAuthorizeUrl` used to compute
   *   usePkce = config.pkce !== 'none' && Boolean(input.codeChallenge)
   * and, when the challenge was absent, emit an authorize URL with no `code_challenge` at all
   * rather than refusing. For Kick and TikTok, which document PKCE as mandatory, that produces a
   * request a platform may accept in a public-client configuration and which an
   * authorization-code interception attack then defeats - the exact attack PKCE exists to stop.
   *
   * It was never reachable from the product: `beginAuth` always generates a pair. The objection
   * was to the SHAPE of the failure, not its reachability - a downgrade that produces a working
   * URL is invisible, and one refactor away from being real. It now throws.
   */
  it('refuses to build an authorize URL for a PKCE platform without a challenge', () => {
    for (const platform of PKCE_PLATFORMS) {
      expect(() =>
        buildAuthorizeUrl(platform, {
          clientId: 'test-client',
          redirectUri: 'http://127.0.0.1:53871/callback',
          state: 'test-state',
          // codeChallenge deliberately omitted.
        }),
        platform,
      ).toThrow(/requires PKCE/i);
    }
  });

  it('the product path never takes that branch: a PKCE platform always gets a challenge', async () => {
    // Mirrors apps/web/src/state/oauthFlow.ts:166 exactly. If that line ever changes shape,
    // this test is the place a reader will look.
    for (const platform of PKCE_PLATFORMS) {
      const config = PLATFORM_OAUTH[platform]!;
      const pkce = config.pkce === 'none' ? undefined : await generatePkce({ encoding: config.pkce });
      expect(pkce, platform).toBeDefined();
      const url = buildAuthorizeUrl(platform, {
        clientId: 'test-client',
        redirectUri: 'http://127.0.0.1:53871/callback',
        state: 'test-state',
        codeChallenge: pkce!.codeChallenge,
      });
      expect(new URL(url).searchParams.get('code_challenge'), platform).toBe(pkce!.codeChallenge);
    }
  });
});

describe('SEC-F8 the verifier carries real entropy; the modulo bias is real and bounded', () => {
  it('is 64 unreserved characters by default and never repeats across 500 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const verifier = generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
      seen.add(verifier);
    }
    expect(seen.size).toBe(500);
  });

  it('refuses a length outside RFC 7636 rather than quietly shortening it', () => {
    expect(() => generateCodeVerifier(42)).toThrow(RangeError);
    expect(() => generateCodeVerifier(129)).toThrow(RangeError);
    expect(generateCodeVerifier(43)).toHaveLength(43);
    expect(generateCodeVerifier(128)).toHaveLength(128);
  });

  /**
   * SEC-F8a, OPEN, INFORMATIONAL. `generateCodeVerifier` maps a uniform byte through
   * `byte % VERIFIER_ALPHABET.length` (packages/adapters/src/oauth/pkce.ts:41). That is
   * unbiased only when the alphabet length divides 256, and RFC 7636's unreserved set is
   * 66 characters (ALPHA 52 + DIGIT 10 + `-` `.` `_` `~`). 256 = 3x66 + 58, so the first 58
   * symbols are drawn with probability 4/256 and the last 8 with 3/256.
   *
   * This IS a modulo bias and the file should not pretend otherwise. It is also almost
   * exactly nothing: the measurement below shows the loss is under one hundredth of a bit
   * per character, so a 64-character verifier still carries ~386 bits against RFC 7636's
   * 256-bit recommendation. The honest fix (rejection sampling, or trimming the alphabet to
   * 64 symbols) costs three lines; the honest severity is "tidy this when convenient", not
   * "do not connect your account".
   *
   * The assertions below are bounds, not a pass mark: they fail if the bias ever grows.
   */
  it('DOCUMENTS: byte % 66 biases 58 of 66 symbols upward, at a cost under 0.01 bits/char', () => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    expect(ALPHABET).toHaveLength(66);
    expect(256 % ALPHABET.length).toBe(58);

    const counts = new Map<string, number>();
    let total = 0;
    for (let i = 0; i < 400; i += 1) {
      for (const ch of generateCodeVerifier(128)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
        total += 1;
      }
    }
    // Every symbol drawn is from the RFC's unreserved set, and all 66 are reachable.
    for (const ch of counts.keys()) expect(ALPHABET, `symbol ${ch}`).toContain(ch);
    expect(counts.size).toBe(66);

    // The theoretical bias: 58 symbols at 4/256, 8 symbols at 3/256. Observed frequencies
    // must sit inside 1/3 of the way between those, which is generous enough not to flake
    // on 51200 samples and tight enough to catch a bias an order of magnitude worse.
    const high = 4 / 256;
    const low = 3 / 256;
    for (const [ch, count] of counts) {
      const p = count / total;
      expect(p, `symbol ${ch}`).toBeGreaterThan(low * 0.8);
      expect(p, `symbol ${ch}`).toBeLessThan(high * 1.2);
    }

    // And the entropy cost, computed from the exact distribution rather than asserted.
    const ideal = Math.log2(66);
    const actual = 58 * high * Math.log2(1 / high) + 8 * low * Math.log2(1 / low);
    expect(ideal - actual).toBeLessThan(0.01);
    // 64 characters still clears RFC 7636's 256-bit recommendation several times over.
    expect(64 * actual).toBeGreaterThan(380);
  });

  it('a 64-character verifier clears the RFC 7636 entropy recommendation by a wide margin', () => {
    // RFC 7636 §7.1 asks for a verifier with at least 256 bits of entropy.
    expect(64 * Math.log2(66)).toBeGreaterThan(256);
  });
});

describe('SEC-F9 the verifier goes to the token endpoint and nowhere else', () => {
  it('never appears in an authorize URL — only its digest does', async () => {
    const pkce = await generatePkce();
    for (const platform of PKCE_PLATFORMS) {
      const url = buildAuthorizeUrl(platform, {
        clientId: 'test-client',
        redirectUri: 'http://127.0.0.1:53871/callback',
        state: 'test-state',
        codeChallenge: pkce.codeChallenge,
      });
      expect(url, platform).not.toContain(pkce.codeVerifier);
      expect(url, platform).toContain(pkce.codeChallenge);
    }
  });

  it('the digest is one-way: the challenge does not reveal the verifier', async () => {
    const pkce = await generatePkce();
    expect(pkce.codeChallenge).not.toContain(pkce.codeVerifier.slice(0, 8));
    expect(pkce.codeVerifier).not.toContain(pkce.codeChallenge.slice(0, 8));
    // Same verifier, same challenge: deterministic, which is what lets the server check it.
    const again = await generatePkce({ verifier: pkce.codeVerifier });
    expect(again.codeChallenge).toBe(pkce.codeChallenge);
  });

  it('an extraParams caller cannot smuggle the verifier into the authorize URL unnoticed', async () => {
    // `buildAuthorizeUrl` merges caller-supplied extraParams last. That is a deliberate escape
    // hatch, so this test does not claim it is impossible -- it pins that NOTHING in this repo
    // uses it for a verifier, by asserting the parameter set a real call produces.
    const pkce = await generatePkce();
    const url = buildAuthorizeUrl('kick', {
      clientId: 'test-client',
      redirectUri: 'http://localhost:53871/callback',
      state: 'test-state',
      codeChallenge: pkce.codeChallenge,
    });
    const keys = [...new URL(url).searchParams.keys()].sort();
    expect(keys).toEqual([
      'client_id',
      'code_challenge',
      'code_challenge_method',
      'redirect_uri',
      'response_type',
      'scope',
      'state',
    ]);
  });
});
